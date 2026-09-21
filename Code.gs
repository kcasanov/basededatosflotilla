const SPREADSHEET_ID = '11SrpxYfydVP7uZdmcr2yPHl8nbtQPTKbD_JwI5_AU94';
const PLAN_PAGOS_FALLBACK_ID = '1OA-K2pNfP5GEhRDKhm4H4LBZBpNhWhbj0DnTMngjWq4';
const MAX_FAILS_BEFORE_TOKEN = 2;
const TOKEN_TTL_MIN = 10;
const SESSION_PREFIX = 'session_';
const TZ = 'America/Costa_Rica';

/**
 * Backend V3.0 · Base de Datos Flotilla
 * Seguridad en Script Properties:
 * PIN_SALT, PIN_HASH, AUTH_EMAIL
 */
function doGet() {
  return json_({ok:true, service:'Base de Datos Flotilla', version:'3.0'});
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');
    let result;
    switch (action) {
      case 'login': result = login_(body); break;
      case 'requestToken': result = requestToken_(body); break;
      case 'validateSession': result = validateSession_(body); break;
      case 'bootstrap': result = protected_(body, bootstrap_); break;
      case 'markPayment': result = protected_(body, markPayment_); break;
      case 'unmarkPayment': result = protected_(body, unmarkPayment_); break;
      case 'createVehicle': result = protected_(body, createVehicle_); break;
      case 'updateVehicleConfig': result = protected_(body, updateVehicleConfig_); break;
      case 'getPlanDashboard': result = protected_(body, getPlanDashboard_); break;
      case 'saveUberWeek': result = protected_(body, saveUberWeek_); break;
      default: result = {ok:false, message:'Acción no válida'};
    }
    return json_(result);
  } catch (err) {
    return json_({ok:false, message:'Error del servidor', detail:String(err && err.message || err)});
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function props_() { return PropertiesService.getScriptProperties(); }
function cache_() { return CacheService.getScriptCache(); }
function hash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2)).join('');
}
function randomToken_(digits) { let out=''; for(let i=0;i<digits;i++) out += Math.floor(Math.random()*10); return out; }
function randomSession_() { return Utilities.getUuid() + Utilities.getUuid().replace(/-/g,''); }
function safeDevice_(raw) { return String(raw || 'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100) || 'unknown'; }
function ymd_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(value);
  return isNaN(d) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1'; }

function login_(body) {
  const p = props_(), device = safeDevice_(body.deviceId), pin = String(body.pin || ''), suppliedToken = String(body.token || '');
  const salt = p.getProperty('PIN_SALT'), expectedHash = p.getProperty('PIN_HASH'), email = p.getProperty('AUTH_EMAIL');
  if (!salt || !expectedHash || !email) return {ok:false, message:'La seguridad del backend todavía no está configurada.'};
  const failKey='fails_'+device, tokenModeKey='tokenmode_'+device;
  const fails=Number(cache_().get(failKey)||0), tokenRequired=cache_().get(tokenModeKey)==='1'||fails>=MAX_FAILS_BEFORE_TOKEN;
  const pinOk=hash_(salt+':'+pin)===expectedHash;
  if (!pinOk) {
    const nextFails=fails+1; cache_().put(failKey,String(nextFails),21600);
    if(nextFails>=MAX_FAILS_BEFORE_TOKEN){
      const alreadyRequired=cache_().get(tokenModeKey)==='1'; cache_().put(tokenModeKey,'1',21600);
      const sent=alreadyRequired?false:issueToken_(device,email);
      log_('AUTH',device,'PIN_FAIL_TOKEN_REQUIRED','Intento incorrecto #'+nextFails);
      return {ok:false,tokenRequired:true,tokenSent:sent,message:'PIN incorrecto. Ahora se requiere PIN + token.'};
    }
    log_('AUTH',device,'PIN_FAIL','Intento incorrecto #'+nextFails);
    return {ok:false,tokenRequired:false,message:'PIN incorrecto.'};
  }
  if(tokenRequired){
    const tokenHash=cache_().get('token_'+device);
    if(!suppliedToken||!tokenHash||hash_(suppliedToken)!==tokenHash){
      log_('AUTH',device,'TOKEN_FAIL','PIN correcto pero token ausente/incorrecto');
      return {ok:false,tokenRequired:true,message:'Ingresá el token temporal enviado al correo autorizado.'};
    }
    cache_().remove('token_'+device);
  }
  cache_().remove(failKey); cache_().remove(tokenModeKey);
  const session=randomSession_();
  props_().setProperty(SESSION_PREFIX+hash_(session),JSON.stringify({device:device,createdAt:Date.now(),lastSeen:Date.now()}));
  log_('AUTH',device,'LOGIN_OK','Sesión iniciada');
  return {ok:true,sessionToken:session};
}
function requestToken_(body) {
  const device=safeDevice_(body.deviceId), email=props_().getProperty('AUTH_EMAIL');
  if(!email)return{ok:false,message:'Correo autorizado no configurado.'};
  const failKey='fails_'+device, tokenModeKey='tokenmode_'+device;
  const tokenRequired=cache_().get(tokenModeKey)==='1'||Number(cache_().get(failKey)||0)>=MAX_FAILS_BEFORE_TOKEN;
  if(!tokenRequired)return{ok:false,message:'El token solo se habilita después de 2 intentos de PIN incorrectos.'};
  const cooldownKey='token_cooldown_'+device;
  if(cache_().get(cooldownKey))return{ok:false,message:'Esperá un minuto antes de solicitar otro token.'};
  cache_().put(tokenModeKey,'1',21600); cache_().put(cooldownKey,'1',60);
  const sent=issueToken_(device,email); return{ok:sent,message:sent?'Token enviado.':'No se pudo enviar el token.'};
}
function issueToken_(device,email){
  try{
    const token=randomToken_(6); cache_().put('token_'+device,hash_(token),TOKEN_TTL_MIN*60);
    MailApp.sendEmail({to:email,subject:'Token de acceso · Base de Datos Flotilla',htmlBody:'<div style="font-family:Arial,sans-serif"><h2>Token de seguridad</h2><div style="font-size:32px;font-weight:800;letter-spacing:6px">'+token+'</div><p>Válido por '+TOKEN_TTL_MIN+' minutos y para un solo uso.</p><p>Si no intentaste ingresar, podés ignorar este mensaje.</p></div>'});
    return true;
  }catch(e){log_('AUTH',device,'TOKEN_SEND_ERROR',String(e));return false;}
}
function validateSession_(body){
  const session=String(body.sessionToken||''),device=safeDevice_(body.deviceId); if(!session)return{ok:false};
  const key=SESSION_PREFIX+hash_(session),raw=props_().getProperty(key); if(!raw)return{ok:false};
  try{const data=JSON.parse(raw);if(data.device!==device)return{ok:false};data.lastSeen=Date.now();props_().setProperty(key,JSON.stringify(data));return{ok:true};}
  catch(e){props_().deleteProperty(key);return{ok:false};}
}
function protected_(body,handler){
  const session=String(body.sessionToken||''),device=safeDevice_(body.deviceId); if(!session)return{ok:false,authRequired:true,message:'Sesión no válida.'};
  const key=SESSION_PREFIX+hash_(session),raw=props_().getProperty(key); if(!raw)return{ok:false,authRequired:true,message:'Sesión no válida.'};
  try{const data=JSON.parse(raw);if(data.device!==device)return{ok:false,authRequired:true,message:'La sesión pertenece a otro dispositivo.'};data.lastSeen=Date.now();props_().setProperty(key,JSON.stringify(data));}
  catch(e){props_().deleteProperty(key);return{ok:false,authRequired:true,message:'Sesión no válida.'};}
  return handler(body,device);
}

function bootstrap_(){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  return{ok:true,vehicles:sheetObjects_(ss.getSheetByName('Vehiculos')),accounts:sheetObjects_(ss.getSheetByName('Cuentas')),payments:sheetObjects_(ss.getSheetByName('Pagos_Reales')),plans:sheetObjects_(ss.getSheetByName('Plan_Pagos')),uberWeeks:sheetObjects_(ss.getSheetByName('Uber_Semanas'))};
}

function markPayment_(body,device){
  const amount=num_(body.montoRecibido);
  if(amount<=0)return{ok:false,message:'El abono debe ser mayor a ₡0.'};
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=ss.getSheetByName('Pagos_Reales'),now=new Date(),pagoId=body.pagoId||Utilities.getUuid();
  sh.appendRow([pagoId,body.planId||'',body.vehicleId||'',body.fechaProgramada||'',body.fechaReal||Utilities.formatDate(now,TZ,'yyyy-MM-dd'),num_(body.montoEsperado),amount,body.estado||'ABONO',body.nota||'',now,now,body.origen||'MANUAL',body.uberSemanaId||'']);
  syncLegacyStatusForPayment_(String(body.vehicleId||''),String(body.fechaProgramada||''),num_(body.montoEsperado));
  log_('PAGO',pagoId,'ADD_PAYMENT',JSON.stringify({vehicleId:body.vehicleId,amount:amount,origin:body.origen||'MANUAL'}),device);
  return{ok:true,pagoId:pagoId};
}
function unmarkPayment_(body,device){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=ss.getSheetByName('Pagos_Reales'),data=sh.getDataRange().getValues(),pagoId=String(body.pagoId||'');
  for(let r=data.length-1;r>=1;r--){
    if(String(data[r][0])===pagoId){
      const vehicleId=String(data[r][2]||''),date=ymd_(data[r][3]),expected=num_(data[r][5]);
      sh.deleteRow(r+1); syncLegacyStatusForPayment_(vehicleId,date,expected);
      log_('PAGO',pagoId,'DELETE_PAYMENT','Movimiento eliminado',device); return{ok:true};
    }
  }
  return{ok:false,message:'Pago no encontrado.'};
}

function createVehicle_(body,device){
  const payload=body.payload||{},v=payload.vehicle||{},c=payload.contract||{},projection=payload.projection||{},plan=Array.isArray(payload.plan)?payload.plan:[];
  if(!v.placa||!v.marca||!v.modelo||!c.cuota||!c.fechaFirma||!plan.length)return{ok:false,message:'Faltan datos requeridos del vehículo o del plan.'};
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),vehicles=ss.getSheetByName('Vehiculos'),plans=ss.getSheetByName('Plan_Pagos'),now=new Date(),normalizedPlate=String(v.placa).trim().toUpperCase();
  const existing=vehicles.getDataRange().getValues();
  for(let r=1;r<existing.length;r++)if(String(existing[r][2]).trim().toUpperCase()===normalizedPlate)return{ok:false,message:'Ya existe un vehículo con esa placa.'};
  const vehicleId='veh_'+normalizedPlate.replace(/[^A-Z0-9]/g,'_')+'_'+Date.now(),firstDate=plan[0].fecha||'',lastDate=plan[plan.length-1].fecha||'',displayName=String(v.marca)+' '+String(v.modelo);
  vehicles.appendRow([vehicleId,displayName,normalizedPlate,v.marca||'',v.modelo||'',num_(v.anio),num_(c.cuota),firstDate,lastDate,0,num_(projection.semanas||plan.length),'ACTIVO','SEMANAL','Creado desde la aplicación',now,now,'','PERSONAL','','ACTIVO',false,'']);
  const rows=plan.map((p,idx)=>([vehicleId+'-'+String(idx+1).padStart(4,'0'),vehicleId,num_(p.semana||idx+1),p.fecha||'',num_(p.saldoInicial),num_(p.cuotaTotal),num_(p.seguro),num_(p.iva),num_(p.cuotaUtil),num_(p.interes),num_(p.capital),num_(p.saldoFinal),0,0,p.estado||'Pendiente']));
  if(rows.length)plans.getRange(plans.getLastRow()+1,1,rows.length,rows[0].length).setValues(rows);
  log_('VEHICULO',vehicleId,'CREATE',JSON.stringify({placa:normalizedPlate,marca:v.marca,modelo:v.modelo,semanas:rows.length}),device);
  return{ok:true,vehicleId:vehicleId,planRows:rows.length};
}

function updateVehicleConfig_(body,device){
  const vehicleId=String(body.vehicleId||''); if(!vehicleId)return{ok:false,message:'VehicleID requerido.'};
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=ss.getSheetByName('Vehiculos'),values=sh.getDataRange().getValues(),headers=values[0].map(String),idx={}; headers.forEach((h,i)=>idx[h]=i);
  let row=-1; for(let r=1;r<values.length;r++)if(String(values[r][idx.VehicleID])===vehicleId){row=r+1;break;}
  if(row<0)return{ok:false,message:'Vehículo no encontrado.'};
  const type=String(body.tipoCobro||'').toUpperCase(),op=String(body.operacionEstado||'ACTIVO').toUpperCase();
  if(type&&['UBER','PERSONAL'].indexOf(type)<0)return{ok:false,message:'Tipo de cobro inválido.'};
  if(['ACTIVO','FINALIZADO','CANCELADO'].indexOf(op)<0)return{ok:false,message:'Estado operativo inválido.'};
  if (body.nombre !== undefined) sh.getRange(row,idx.Nombre+1).setValue(String(body.nombre||''));
  if (body.placa !== undefined) sh.getRange(row,idx.Placa+1).setValue(String(body.placa||'').trim().toUpperCase());
  const vals=[[String(body.chofer||''),type,String(body.planSheetTab||''),op,Boolean(body.planIntegracionActiva),String(body.configNota||'')]];
  sh.getRange(row,idx.Chofer+1,1,6).setValues(vals);
  log_('VEHICULO',vehicleId,'UPDATE_CONFIG',JSON.stringify({name:body.nombre||'',plate:body.placa||'',type:type,driver:body.chofer||'',tab:body.planSheetTab||'',state:op}),device);
  return{ok:true};
}

function planSpreadsheetId_(){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=ss.getSheetByName('Config'),rows=sheetObjects_(sh),match=rows.find(r=>String(r.Clave)==='PLAN_PAGOS_SPREADSHEET_ID');
  return match&&match.Valor?String(match.Valor):PLAN_PAGOS_FALLBACK_ID;
}
function vehicleObjectById_(vehicleId){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),rows=sheetObjects_(ss.getSheetByName('Vehiculos')); return rows.find(r=>String(r.VehicleID)===String(vehicleId))||null;
}
function getPlanDashboard_(){
  const main=SpreadsheetApp.openById(SPREADSHEET_ID),vehicles=sheetObjects_(main.getSheetByName('Vehiculos')).filter(v=>String(v.OperacionEstado||'ACTIVO').toUpperCase()==='ACTIVO');
  const legacy=SpreadsheetApp.openById(planSpreadsheetId_()),today=new Date(),cards=[];
  vehicles.forEach(v=>{
    const tab=String(v.PlanSheetTab||''),integration=bool_(v.PlanIntegracionActiva);
    const card={vehicleId:String(v.VehicleID||''),name:String(v.Nombre||''),plate:String(v.Placa||''),driver:String(v.Chofer||''),type:String(v.TipoCobro||''),planSheetTab:tab,integrationActive:integration,summary:[],legacyPending:[]};
    if(tab&&integration){
      const sh=legacy.getSheetByName(tab);
      if(sh){
        card.summary=sh.getRange(1,1,6,2).getDisplayValues();
        const lastRow=sh.getLastRow();
        if(lastRow>=8){
          const header=sh.getRange(8,1,1,Math.min(sh.getLastColumn(),26)).getDisplayValues()[0];
          const stateIdx=header.findIndex(x=>String(x).trim().toLowerCase()==='estado');
          const rows=sh.getRange(9,1,lastRow-8,Math.max(2,stateIdx+1)).getValues();
          rows.forEach((r,i)=>{
            const date=ymd_(r[1]); if(!date)return;
            const state=stateIdx>=0?String(r[stateIdx]||''):'';
            if(new Date(date+'T00:00:00')<=today&&state.toUpperCase()!=='PAGADO')card.legacyPending.push({row:i+9,week:num_(r[0]),date:date,state:state||'Pendiente'});
          });
        }
      }
    }
    cards.push(card);
  });
  return{ok:true,cards:cards};
}

function saveUberWeek_(body,device){
  const vehicleId=String(body.vehicleId||''),targetDate=ymd_(body.fechaProgramada); if(!vehicleId||!targetDate)return{ok:false,message:'Vehículo y fecha programada son requeridos.'};
  const vehicle=vehicleObjectById_(vehicleId); if(!vehicle)return{ok:false,message:'Vehículo no encontrado.'};
  if(String(vehicle.TipoCobro||'').toUpperCase()!=='UBER')return{ok:false,message:'Este vehículo no está configurado como Uber.'};
  const tab=String(vehicle.PlanSheetTab||''); if(!tab)return{ok:false,message:'Falta configurar la pestaña de Plan de pagos.'};
  const main=SpreadsheetApp.openById(SPREADSHEET_ID),legacy=SpreadsheetApp.openById(planSpreadsheetId_()),legacySh=legacy.getSheetByName(tab); if(!legacySh)return{ok:false,message:'No existe la pestaña '+tab+' en Plan de pagos.'};
  const gains=num_(body.gananciasTotales),returns=num_(body.devolucionesGastos),adjust=num_(body.ajustesAnteriores),cash=num_(body.efectivoChofer);
  const obligations=serverScheduleTo_(vehicle,targetDate); if(!obligations.length)return{ok:false,message:'No encontré cuotas programadas hasta esa fecha.'};
  const target=obligations.find(o=>o.date===targetDate)||obligations[obligations.length-1],week=target.week||weekNumberForDate_(vehicle,targetDate),quota=num_(target.amount||vehicle.CuotaSemanal);
  const uberId='uber_'+vehicleId+'_'+targetDate;
  removeUberRun_(main,uberId);
  const carryIn=previousCarry_(main,vehicleId,targetDate);
  const reimbursements=returns+adjust+carryIn;
  const rawAvailable=Math.max(0,gains+returns+adjust-cash);
  const saldoSemana=gains+reimbursements-cash-quota;

  // Únicas celdas del cuadro público que se escriben: B1:B5. B6 conserva su fórmula.
  legacySh.getRange('B1').setValue(week);
  legacySh.getRange('B2').setValue(gains);
  legacySh.getRange('B3').setValue(reimbursements);
  legacySh.getRange('B4').setValue(cash);
  legacySh.getRange('B5').setValue(quota);
  SpreadsheetApp.flush();
  const publicSaldo=num_(legacySh.getRange('B6').getValue());

  let available=rawAvailable; const allocations=[];
  const paymentSheet=main.getSheetByName('Pagos_Reales'),now=new Date();
  obligations.forEach(o=>{
    if(available<=0.005)return;
    const received=sumReceived_(main,vehicleId,o.date),missing=Math.max(0,num_(o.amount)-received); if(missing<=0.005)return;
    const use=Math.min(missing,available); if(use<=0)return;
    const after=received+use,status=after>=num_(o.amount)-0.01?'PAGADO':'PARCIAL',pagoId=Utilities.getUuid();
    paymentSheet.appendRow([pagoId,o.planId||vehicleId+'|'+o.date,vehicleId,o.date,Utilities.formatDate(now,TZ,'yyyy-MM-dd'),num_(o.amount),use,status,'Aplicado automáticamente desde Uber',now,now,'UBER',uberId]);
    allocations.push({date:o.date,week:o.week,amount:use,status:status}); available-=use;
  });

  // Estado público: Pagado solo al cubrir 100%; parcial sigue siendo Pendiente.
  obligations.forEach(o=>syncLegacyStatusForPayment_(vehicleId,o.date,num_(o.amount)));
  const targetReceived=sumReceived_(main,vehicleId,targetDate),targetState=targetReceived>=quota-0.01?'PAGADO':targetReceived>0?'PARCIAL':'PENDIENTE';
  upsertUberWeek_(main,[uberId,vehicleId,tab,week,targetDate,gains,returns,adjust,carryIn,reimbursements,cash,quota,isFinite(publicSaldo)?publicSaldo:saldoSemana,rawAvailable,targetState,String(body.ocrTexto||''),now,now]);
  log_('UBER',uberId,'SAVE_WEEK',JSON.stringify({vehicleId:vehicleId,date:targetDate,rawAvailable:rawAvailable,carryIn:carryIn,allocations:allocations}),device);
  return{ok:true,uberSemanaId:uberId,week:week,carryIn:carryIn,reimbursementsTotal:reimbursements,saldoSemana:isFinite(publicSaldo)?publicSaldo:saldoSemana,rawAvailable:rawAvailable,allocations:allocations,targetReceived:targetReceived,targetPending:Math.max(0,quota-targetReceived),targetState:targetState};
}
function removeUberRun_(main,uberId){
  const pay=main.getSheetByName('Pagos_Reales'),pv=pay.getDataRange().getValues(),ph=pv[0].map(String),uIdx=ph.indexOf('UberSemanaID');
  if(uIdx>=0)for(let r=pv.length-1;r>=1;r--)if(String(pv[r][uIdx])===uberId)pay.deleteRow(r+1);
  const ush=main.getSheetByName('Uber_Semanas'); if(!ush)return; const uv=ush.getDataRange().getValues();
  for(let r=uv.length-1;r>=1;r--)if(String(uv[r][0])===uberId)ush.deleteRow(r+1);
}
function previousCarry_(main,vehicleId,targetDate){
  const sh=main.getSheetByName('Uber_Semanas'); if(!sh)return 0; const rows=sheetObjects_(sh).filter(r=>String(r.VehicleID)===vehicleId&&ymd_(r.FechaProgramada)<targetDate).sort((a,b)=>ymd_(b.FechaProgramada).localeCompare(ymd_(a.FechaProgramada)));
  if(!rows.length)return 0; return Math.min(0,num_(rows[0].SaldoSemana));
}
function upsertUberWeek_(main,row){ main.getSheetByName('Uber_Semanas').appendRow(row); }

function serverScheduleTo_(vehicle,targetDate){
  const main=SpreadsheetApp.openById(SPREADSHEET_ID),plans=sheetObjects_(main.getSheetByName('Plan_Pagos')).filter(p=>String(p.VehicleID)===String(vehicle.VehicleID)&&ymd_(p.FechaProgramada)<=targetDate).sort((a,b)=>ymd_(a.FechaProgramada).localeCompare(ymd_(b.FechaProgramada)));
  if(plans.length)return plans.map(p=>({planId:String(p.PlanID||''),week:num_(p.Semana),date:ymd_(p.FechaProgramada),amount:num_(p.CuotaTotal||vehicle.CuotaSemanal)}));
  const start=ymd_(vehicle.FechaInicio),end=ymd_(vehicle.FechaFin); if(!start)return[];
  const out=[]; let d=new Date(start+'T00:00:00Z'),finish=new Date((end||targetDate)+'T00:00:00Z'),target=new Date(targetDate+'T00:00:00Z'),week=1;
  while(d<=finish&&d<=target&&week<400){out.push({planId:String(vehicle.VehicleID)+'|'+Utilities.formatDate(d,'UTC','yyyy-MM-dd'),week:week,date:Utilities.formatDate(d,'UTC','yyyy-MM-dd'),amount:num_(vehicle.CuotaSemanal)});d.setUTCDate(d.getUTCDate()+7);week++;}
  return out;
}
function weekNumberForDate_(vehicle,date){
  const start=ymd_(vehicle.FechaInicio); if(!start)return 0; return Math.floor((new Date(date+'T00:00:00Z')-new Date(start+'T00:00:00Z'))/604800000)+1;
}
function sumReceived_(main,vehicleId,date){
  const sh=main.getSheetByName('Pagos_Reales'),rows=sheetObjects_(sh); return rows.filter(r=>String(r.VehicleID)===vehicleId&&ymd_(r.FechaProgramada)===date).reduce((s,r)=>s+num_(r.MontoRecibido),0);
}
function syncLegacyStatusForPayment_(vehicleId,date,expected){
  try{
    const vehicle=vehicleObjectById_(vehicleId); if(!vehicle||!bool_(vehicle.PlanIntegracionActiva)||!vehicle.PlanSheetTab)return;
    const main=SpreadsheetApp.openById(SPREADSHEET_ID),received=sumReceived_(main,vehicleId,ymd_(date)),need=expected>0?expected:num_(vehicle.CuotaSemanal),state=received>=need-0.01?'Pagado':'Pendiente';
    const legacy=SpreadsheetApp.openById(planSpreadsheetId_()),sh=legacy.getSheetByName(String(vehicle.PlanSheetTab)); if(!sh)return;
    setLegacyStatus_(sh,ymd_(date),state);
  }catch(e){log_('SYNC',vehicleId,'LEGACY_STATUS_ERROR',String(e));}
}
function setLegacyStatus_(sh,date,state){
  if(sh.getLastRow()<8)return false;
  const header=sh.getRange(8,1,1,Math.min(26,sh.getLastColumn())).getDisplayValues()[0],stateIdx=header.findIndex(x=>String(x).trim().toLowerCase()==='estado'); if(stateIdx<0)return false;
  const last=sh.getLastRow(),dates=sh.getRange(9,2,last-8,1).getValues();
  for(let i=0;i<dates.length;i++)if(ymd_(dates[i][0])===date){sh.getRange(i+9,stateIdx+1).setValue(state);return true;}
  return false;
}

function sheetObjects_(sheet){
  if(!sheet)return[]; const values=sheet.getDataRange().getValues(); if(values.length<2)return[]; const headers=values[0].map(String);
  return values.slice(1).filter(row=>row.some(v=>v!=='')).map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]);return o;});
}
function log_(entity,entityId,action,detail,user){
  try{const sh=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Historial');sh.appendRow([Utilities.getUuid(),new Date(),entity,entityId,action,detail,user||'system','AppsScript']);}catch(e){}
}
function makePinHash_(salt,pin){return hash_(String(salt)+':'+String(pin));}
