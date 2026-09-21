'use strict';
const v22LoadProductionData = loadProductionData;
loadProductionData = async function() {
  await v22LoadProductionData();
  const token=sessionStorage.getItem(SESSION_KEY); if(!token) return;
  try {
    const r=await backend('bootstrapV3',{sessionToken:token});
    if(!r.ok) throw new Error(r.message||'Backend V3 no disponible');
    v3BackendReady=String(r.version||'').startsWith('3.');
    v3Data={vehicles:Array.isArray(r.vehicles)?r.vehicles:[],payments:Array.isArray(r.payments)?r.payments:[],uberWeeks:Array.isArray(r.uberWeeks)?r.uberWeeks:[],planSnapshots:Array.isArray(r.planSnapshots)?r.planSnapshots:[],availablePlanTabs:Array.isArray(r.availablePlanTabs)?r.availablePlanTabs:[]};
    const cfg=new Map(v3Data.vehicles.map(x=>[String(x.VehicleID||''),x]));
    contractVehicles.forEach(v=>{const c=cfg.get(v.id)||{};v.driver=String(c.Chofer||'');v.collectionType=String(c.TipoCobro||'').toUpperCase();v.planTab=String(c.PlanSheetTab||'');v.operationStatus=String(c.OperacionEstado||c.Estado||'ACTIVO').toUpperCase();v.planIntegration=String(c.PlanIntegracionActiva||'').toUpperCase()==='TRUE'||c.PlanIntegracionActiva===true;});
    rebuildV3PaymentState();
  } catch(e) {
    v3BackendReady=false;
    console.warn('V3 backend:',e);
  }
};

function rebuildV3PaymentState(){
  Object.keys(paymentState).forEach(k=>delete paymentState[k]);
  const grouped={};
  v3Data.payments.forEach(p=>{
    const vehicleId=String(p.VehicleID||''),date=normalizeSheetDate(p.FechaProgramada); if(!vehicleId||!date)return;
    const key=paymentKey(vehicleId,date); if(!grouped[key]) grouped[key]={received:0,expected:0,realDate:'',status:'PENDIENTE',movements:[]};
    const g=grouped[key], amount=Number(p.MontoRecibido||0); g.received+=amount;g.expected=Math.max(g.expected,Number(p.MontoEsperado||0));
    const real=normalizeSheetDate(p.FechaReal); if(real>=g.realDate) g.realDate=real;
    g.movements.push({pagoId:String(p.PagoID||''),amount,realDate:real,status:String(p.Estado||''),note:String(p.Nota||''),origin:String(p.Origen||'MANUAL')});
  });
  Object.entries(grouped).forEach(([k,g])=>{g.status=g.expected&&g.received>=g.expected-.01?'PAGADO':g.received>0?'PARCIAL':'PENDIENTE';g.pagoId=g.movements.length===1?g.movements[0].pagoId:'';paymentState[k]=g;});
}

const v22RenderAll=renderAll;
renderAll=function(){v22RenderAll();v3RenderPlanDashboard();};

renderWeek=function(){
  const d=weekDate();
  $('weekLabel').textContent='Semana de cobro · martes '+new Intl.DateTimeFormat('es-CR',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}).format(d);
  const rows=rowsForCurrentWeek(),expected=rows.reduce((s,r)=>s+r.amount,0),received=rows.reduce((s,r)=>s+r.received,0),lateRows=getLateRows(),late=lateRows.reduce((s,r)=>s+r.missing,0),pending=Math.max(0,expected-received)+late;
  $('wkExpected').textContent=money(expected);$('wkReceived').textContent=money(received);$('wkLate').textContent=money(late);$('wkPending').textContent=money(pending);
  $('weeklyIncomeBody').innerHTML=rows.length?rows.map(r=>{
    const missing=Math.max(0,r.amount-r.received),paid=missing<=.01,partial=r.received>0&&!paid,label=paid?'Pagado':partial?'Parcial':'Pendiente';
    return `<tr><td><span class="statuspill ${paid?'ok':'pending'}">${label}</span></td><td>${r.vehicle}${r.merged?' <span class="statuspill pending">fecha especial</span>':''}</td><td>${fmtShort(r.date)}</td><td>${money(r.amount)}</td><td>${money(r.received)}${!paid?`<span class="miniNote">Falta ${money(missing)}</span>`:''}</td><td>${fmtShort(r.realDate)}</td><td><div class="v3actions">${paid?'':`<button class="dark v3small" onclick="v3OpenPayment('${encodeURIComponent(r.key)}')">Abonar</button>`}<button class="light v3small" onclick="v3OpenMovements('${encodeURIComponent(r.key)}')">${r.received?'Ver abonos':'Detalle'}</button></div></td></tr>`;
  }).join(''):'<tr><td colspan="7">No hay pagos programados para esta semana.</td></tr>';
  $('lateList').innerHTML=lateRows.length?lateRows.map(r=>`<div class="lateItem"><div><b>${r.vehicle} · ${money(r.missing)}</b><div class="lateMeta">Recibido ${money(r.received)} de ${money(r.amount)} · debía pagar ${fmtShort(r.date)} · ${r.weeksLate} semana${r.weeksLate===1?'':'s'} de atraso</div></div><button class="dark" onclick="v3OpenPayment('${encodeURIComponent(r.key)}')">Registrar abono</button></div>`).join(''):'<div class="placeholder">No hay ingresos atrasados.</div>';
  renderExpenseAllocation(allocateExpenses(currentExpenses(rows,d),received),received);renderSummary();
};

function v3FindScheduledByKey(key){
  const current=rowsForCurrentWeek().find(r=>r.key===key); if(current)return current;
  const late=getLateRows().find(r=>r.key===key); if(late)return late;
  const [vehicleId,date]=String(key).split('|'),v=contractVehicles.find(x=>x.id===vehicleId),snap=v3SnapshotFor(vehicleId);
  const pr=snap&&Array.isArray(snap.pendingRows)?snap.pendingRows.find(x=>normalizeSheetDate(x.date)===date):null;
  if(v&&pr){const st=getPaymentState(vehicleId,date);return {planId:key,vehicleId,vehicle:v.name,date,amount:Number(pr.quota||v.weekly),received:Number(st.received||0),realDate:st.realDate||'',status:st.status||'Pendiente',key};}
  return null;
}
function v3OpenPayment(encodedKey){
  const key=decodeURIComponent(encodedKey),row=v3FindScheduledByKey(key);if(!row)return;
  v3PaymentTarget=row;const missing=Math.max(0,row.amount-row.received);
  $('v3PaymentSub').textContent=row.vehicle+' · '+fmtShort(row.date);$('v3PaymentInfo').innerHTML=`Esperado <b>${money(row.amount)}</b> · Recibido <b>${money(row.received)}</b> · Pendiente <b>${money(missing)}</b>`;
  $('v3PaymentAmount').value=Math.round(missing);$('v3PaymentAmount').max=Math.max(0,Math.round(missing));$('v3PaymentNote').value='';$('v3PaymentStatus').textContent='';$('v3PaymentModal').classList.add('show');
}
function v3ClosePaymentModal(){$('v3PaymentModal').classList.remove('show');v3PaymentTarget=null;}
async function v3SavePayment(useFull=false){
  const r=v3PaymentTarget;if(!r)return;const missing=Math.max(0,r.amount-r.received),amount=useFull?missing:Number($('v3PaymentAmount').value||0);if(amount<=0){$('v3PaymentStatus').textContent='Ingresá un monto válido.';return;}
  $('v3PaymentStatus').textContent='Guardando…';
  try{const x=await backend('markPayment',{sessionToken:sessionStorage.getItem(SESSION_KEY),planId:r.planId||r.key,vehicleId:r.vehicleId,fechaProgramada:r.date,fechaReal:isoDate(crTodayUTC()),montoEsperado:r.amount,montoRecibido:amount,estado:amount>=missing?'PAGADO':'PARCIAL',nota:$('v3PaymentNote').value.trim(),origen:'MANUAL'});if(!x.ok)throw new Error(x.message||'No se pudo registrar');await loadProductionData();v3ClosePaymentModal();renderAll();}catch(e){$('v3PaymentStatus').textContent=e.message||'Error guardando abono';}
}
function v3OpenMovements(encodedKey){
  const key=decodeURIComponent(encodedKey),row=v3FindScheduledByKey(key)||(()=>{const [vehicleId,date]=key.split('|');const v=contractVehicles.find(x=>x.id===vehicleId);return v?{key,vehicleId,date,vehicle:v.name,amount:getPaymentState(vehicleId,date).expected||v.weekly}:null;})();if(!row)return;
  const st=getPaymentState(row.vehicleId,row.date),moves=st.movements||[];$('v3MovementsSub').textContent=row.vehicle+' · '+fmtShort(row.date)+' · '+money(st.received)+' recibidos';
  $('v3MovementsList').innerHTML=moves.length?moves.map(m=>`<div class="lateItem"><div><b>${money(m.amount)}</b><div class="lateMeta">${fmtShort(m.realDate)} · ${m.origin||'MANUAL'}${m.note?' · '+m.note:''}</div></div><button class="light" onclick="v3DeleteMovement('${m.pagoId}')">Eliminar</button></div>`).join(''):'<div class="placeholder">Todavía no hay abonos registrados.</div>';$('v3MovementsModal').classList.add('show');
}
function v3CloseMovements(){$('v3MovementsModal').classList.remove('show');}
async function v3DeleteMovement(id){if(!confirm('¿Eliminar este abono?'))return;try{const r=await backend('unmarkPayment',{sessionToken:sessionStorage.getItem(SESSION_KEY),pagoId:id});if(!r.ok)throw new Error(r.message||'No se pudo eliminar');await loadProductionData();v3CloseMovements();renderAll();}catch(e){alert(e.message||'Error eliminando abono');}}

function v3RenderPlanDashboard(){
  const box=$('v3PlanCards');if(!box)return;
  if(!v3BackendReady){$('v3PlanNotice').style.display='block';$('v3PlanNotice').innerHTML='<b>Actualización pendiente:</b> el frontend V3 está listo, pero Apps Script debe desplegarse con Code.gs V3 antes de usar pagos parciales/Uber.';box.innerHTML='<div class="placeholder">Esperando backend V3.</div>';return;}
  $('v3PlanNotice').style.display='none';
  const active=contractVehicles.filter(v=>v.operationStatus!=='FINALIZADO'&&v.operationStatus!=='CANCELADO');
  box.innerHTML=active.length?active.map(v=>{
    const type=v.collectionType||'SIN CONFIGURAR',snap=v3SnapshotFor(v.id),externalPending=snap&&Array.isArray(snap.pendingRows)?snap.pendingRows:[],internalLate=vehicleLateRows(v),lateCount=externalPending.length||internalLate.length,lateAmt=externalPending.length?externalPending.reduce((sum,p)=>{const st=getPaymentState(v.id,normalizeSheetDate(p.date));return sum+Math.max(0,Number(p.quota||v.weekly)-Number(st.received||0));},0):internalLate.reduce((sum,x)=>sum+x.missing,0),current=rowsForCurrentWeek().find(x=>x.vehicleId===v.id),missing=current?Math.max(0,current.amount-current.received):0;
    return `<div class="v3card ${lateCount?'v3pendingCard':''}" onclick="v3OpenPlanCard('${v.id}')"><div class="sectionHead"><div><h3>${v.name}</h3><div class="v3muted">${v.driver||'Sin chofer'}${v.plate?' · '+v.plate:''}</div></div><span class="v3pill ${type==='UBER'?'uber':type==='PERSONAL'?'personal':'warn'}">${type==='UBER'?'Uber':type==='PERSONAL'?'Personal':'Configurar'}</span></div><div class="v3money">${current?money(current.amount):money(v.weekly)}</div><div class="v3muted">Cuota vigente</div>${lateCount?`<div class="v3row"><span>Semanas pendientes</span><b>${lateCount} · ${money(lateAmt)}</b></div>`:''}${current&&missing>0?`<div class="v3row"><span>Pendiente actual</span><b>${money(missing)}</b></div>`:''}</div>`;
  }).join(''):'<div class="placeholder">No hay cuentas activas.</div>';
}
function v3OpenPlanCard(vehicleId){
  const v=contractVehicles.find(x=>x.id===vehicleId);if(!v)return;
  const snap=v3SnapshotFor(vehicleId), externalPending=(snap&&Array.isArray(snap.pendingRows)?snap.pendingRows:[]).map(pr=>{const key=paymentKey(v.id,normalizeSheetDate(pr.date)),st=getPaymentState(v.id,normalizeSheetDate(pr.date));return {key,date:normalizeSheetDate(pr.date),week:Number(pr.week||0),amount:Number(pr.quota||v.weekly),received:Number(st.received||0),missing:Math.max(0,Number(pr.quota||v.weekly)-Number(st.received||0))};});
  if(v.collectionType==='UBER'){
    const box=snap&&snap.box||[];
    const boxHtml=box.length?`<div class="v3receipt"><h2>${v.name}</h2><div class="v3muted">${v.driver||'Sin chofer'} · ${v.planTab||''}</div><table><tbody>${box.map(r=>`<tr><td>${r[0]||''}</td><td>${r[1]||''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="placeholder">No hay cuadro A1:B6 disponible.</div>';
    const pendingHtml=externalPending.length?externalPending.map(r=>`<div class="lateItem"><div><b>Semana ${r.week||'—'} · ${fmtShort(r.date)}</b><div class="lateMeta">Cuota ${money(r.amount)} · Registrado internamente ${money(r.received)} · Pendiente ${money(r.missing)}</div></div><button class="dark" onclick="v3OpenUber('${v.id}','${encodeURIComponent(r.key)}')">Actualizar Uber</button></div>`).join(''):'<div class="placeholder">No hay semanas pendientes en el Plan de pagos.</div>';
    $('v3PlanDetail').innerHTML=`<div class="card"><div class="sectionHead"><div><h2>${v.name}</h2><div class="status">Cuenta Uber · tocá una semana pendiente para actualizarla</div></div><button class="dark" onclick="v3OpenUber('${v.id}')">Actualizar semana actual</button></div><div class="v3split" style="margin-top:14px"><div>${boxHtml}</div><div><h3>Semanas pendientes</h3>${pendingHtml}</div></div></div>`;
    return;
  }
  const late=externalPending.length?externalPending:vehicleLateRows(v),current=rowsForCurrentWeek().find(x=>x.vehicleId===vehicleId);
  $('v3PlanDetail').innerHTML=`<div class="card"><div class="sectionHead"><div><h2>${v.name}</h2><div class="status">${v.driver||'Sin chofer'} · Uso personal</div></div></div>${late.length?`<h3>Semanas pendientes</h3>${late.map(r=>{const amount=r.amount||r.quota||v.weekly,received=r.received||0,missing=r.missing!=null?r.missing:Math.max(0,amount-received),key=r.key||paymentKey(v.id,r.date);return `<div class="lateItem"><div><b>${fmtShort(r.date)} · falta ${money(missing)}</b><div class="lateMeta">Recibido ${money(received)} / ${money(amount)}</div></div><button class="dark" onclick="v3OpenPayment('${encodeURIComponent(key)}')">Abonar</button></div>`;}).join('')}`:'<div class="placeholder">No tiene semanas pendientes.</div>'}${current&&!late.some(r=>r.date===current.date)?`<h3>Semana actual</h3><div class="lateItem"><div><b>${money(current.received)} / ${money(current.amount)}</b><div class="lateMeta">Pendiente ${money(Math.max(0,current.amount-current.received))}</div></div>${current.received>=current.amount-.01?'🟢 Pagado':`<button class="dark" onclick="v3OpenPayment('${encodeURIComponent(current.key)}')">Abonar</button>`}</div>`:''}</div>`;
}
