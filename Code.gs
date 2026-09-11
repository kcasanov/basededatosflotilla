const SPREADSHEET_ID = '11SrpxYfydVP7uZdmcr2yPHl8nbtQPTKbD_JwI5_AU94';
const MAX_FAILS_BEFORE_TOKEN = 2;
const TOKEN_TTL_MIN = 10;
const SESSION_TTL_HOURS = 18;

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
function props_(){ return PropertiesService.getScriptProperties(); }
function cache_(){ return CacheService.getScriptCache(); }
function hash_(text){
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8);
  return bytes.map(b=>('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');
}
function randomToken_(digits){ let out=''; for(let i=0;i<digits;i++) out+=Math.floor(Math.random()*10); return out; }
function randomSession_(){ return Utilities.getUuid()+Utilities.getUuid().replace(/-/g,''); }
function safeDevice_(raw){ return String(raw||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100)||'unknown'; }

function login_(body){
  const p=props_(),device=safeDevice_(body.deviceId),pin=String(body.pin||''),suppliedToken=String(body.token||'');
  const salt=p.getProperty('PIN_SALT'),expectedHash=p.getProperty('PIN_HASH'),email=p.getProperty('AUTH_EMAIL');
  if(!salt||!expectedHash||!email) return {ok:false,message:'La seguridad del backend todavía no está configurada.'};
  const failKey='fails_'+device,tokenModeKey='tokenmode_'+device;
  const fails=Number(cache_().get(failKey)||0),tokenRequired=cache_().get(tokenModeKey)==='1'||fails>=MAX_FAILS_BEFORE_TOKEN;
  const pinOk=hash_(salt+':'+pin)===expectedHash;
  if(!pinOk){
    const nextFails=fails+1; cache_().put(failKey,String(nextFails),21600);
    if(nextFails>=MAX_FAILS_BEFORE_TOKEN){
      cache_().put(tokenModeKey,'1',21600);
      const sent=issueToken_(device,email);
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
  const session=randomSession_(); cache_().put('session_'+hash_(session),device,SESSION_TTL_HOURS*3600);
  log_('AUTH',device,'LOGIN_OK','Sesión iniciada');
  return {ok:true,sessionToken:session};
}

function requestToken_(body){
  const device=safeDevice_(body.deviceId),email=props_().getProperty('AUTH_EMAIL');
  if(!email) return {ok:false,message:'Correo autorizado no configurado.'};
  cache_().put('tokenmode_'+device,'1',21600);
  const sent=issueToken_(device,email);
  return {ok:sent,message:sent?'Token enviado.':'No se pudo enviar el token.'};
}
function issueToken_(device,email){
  try{
    const token=randomToken_(6); cache_().put('token_'+device,hash_(token),TOKEN_TTL_MIN*60);
    MailApp.sendEmail({to:email,subject:'Token de acceso · Base de Datos Flotilla',htmlBody:'<div style="font-family:Arial,sans-serif"><h2>Token de seguridad</h2><div style="font-size:32px;font-weight:800;letter-spacing:6px">'+token+'</div><p>Válido por '+TOKEN_TTL_MIN+' minutos y para un solo uso.</p><p>Si no intentaste ingresar, podés ignorar este mensaje.</p></div>'});
    return true;
  }catch(e){ log_('AUTH',device,'TOKEN_SEND_ERROR',String(e)); return false; }
}
function validateSession_(body){
  const session=String(body.sessionToken||''); if(!session) return {ok:false};
  return {ok:!!cache_().get('session_'+hash_(session))};
}
function protected_(body,handler){
  const session=String(body.sessionToken||''),sessionKey='session_'+hash_(session),device=cache_().get(sessionKey);
  if(!session||!device) return {ok:false,authRequired:true,message:'Sesión vencida.'};
  cache_().put(sessionKey,device,SESSION_TTL_HOURS*3600);
  return handler(body,device);
}
function bootstrap_(){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  return {ok:true,vehicles:sheetObjects_(ss.getSheetByName('Vehiculos')),accounts:sheetObjects_(ss.getSheetByName('Cuentas')),payments:sheetObjects_(ss.getSheetByName('Pagos_Reales'))};
}
function markPayment_(body,device){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=ss.getSheetByName('Pagos_Reales'),now=new Date(),pagoId=body.pagoId||Utilities.getUuid();
  sh.appendRow([pagoId,body.planId||'',body.vehicleId||'',body.fechaProgramada||'',body.fechaReal||Utilities.formatDate(now,'America/Costa_Rica','yyyy-MM-dd'),Number(body.montoEsperado||0),Number(body.montoRecibido||0),body.estado||'PAGADO',body.nota||'',now,now]);
  log_('PAGO',pagoId,'MARK_PAID',JSON.stringify({vehicleId:body.vehicleId,amount:body.montoRecibido}),device);
  return {ok:true,pagoId:pagoId};
}
function unmarkPayment_(body,device){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=ss.getSheetByName('Pagos_Reales'),data=sh.getDataRange().getValues(),pagoId=String(body.pagoId||'');
  for(let r=data.length-1;r>=1;r--){ if(String(data[r][0])===pagoId){ sh.deleteRow(r+1); log_('PAGO',pagoId,'UNMARK_PAID','Pago eliminado',device); return {ok:true}; } }
  return {ok:false,message:'Pago no encontrado.'};
}
function sheetObjects_(sheet){
  if(!sheet) return []; const values=sheet.getDataRange().getValues(); if(values.length<2) return [];
  const headers=values[0].map(String);
  return values.slice(1).filter(row=>row.some(v=>v!=='')).map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]);return o;});
}
function log_(entity,entityId,action,detail,user){
  try{ const sh=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Historial'); sh.appendRow([Utilities.getUuid(),new Date(),entity,entityId,action,detail,user||'system','AppsScript']); }catch(e){}
}
function makePinHash_(salt,pin){ return hash_(String(salt)+':'+String(pin)); }
