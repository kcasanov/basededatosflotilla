'use strict';

let businessWeekOffset = 0;
let activeBusinessView = 'bizSemana';
let activeManagedEntityV5 = 'NEGOCIO';
function managedExpenseConfigV5() { return activeManagedEntityV5 === 'CATA' ? cataExpenseConfig : businessExpenseConfig; }
function managedLabelV5() { return activeManagedEntityV5 === 'CATA' ? 'Cata' : 'Sociedad'; }
let lastPersonalView = 'resumen';

function bizVehicleList() {
  return contractVehicles.filter(function(v) {
    return v.entity === activeManagedEntityV5 && !['FINALIZADO','CANCELADO'].includes(v.operationStatus || 'ACTIVO');
  });
}
function bizTuesday() {
  const d = operationalTuesday();
  d.setUTCDate(d.getUTCDate() + businessWeekOffset * 7);
  return d;
}
function bizEventsBetween(start, end) {
  return bizVehicleList().flatMap(function(v) {
    return scheduledEventsForVehicle(v, start, end);
  }).sort(function(a,b){ return a.date.localeCompare(b.date); });
}
function bizRowsForTuesday(tuesday) {
  const start = new Date(tuesday); start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(tuesday); end.setUTCDate(end.getUTCDate() + 5);
  return bizEventsBetween(start, end).map(function(ev) {
    const st = effectivePaymentState(ev);
    return Object.assign({}, ev, {
      visualDate: ev.date,
      merged: false,
      received: Number(st.received || 0),
      realDate: st.realDate || '',
      status: st.status || 'Pendiente',
      historicalApplied: !!st.historicalApplied,
      pagoId: st.pagoId || '',
      key: paymentKey(ev.vehicleId, ev.date)
    });
  });
}
function bizCashForWeek(tuesday) {
  const target = isoDate(tuesday);
  let operational = 0, debtRecovery = 0;
  const ids = new Set(bizVehicleList().map(function(v){ return v.id; }));
  Object.entries(paymentState).forEach(function(entry) {
    const key = entry[0], state = entry[1];
    const parts = key.split('|'), vehicleId = parts[0] || '', scheduled = parts[1] || '';
    if (!ids.has(vehicleId)) return;
    const movements = state.movements && state.movements.length ? state.movements : [{date:state.realDate,amount:state.received}];
    movements.forEach(function(m) {
      const alloc = paymentDistributionForMovement(scheduled, m.date);
      if (alloc.week !== target) return;
      const amount = Number(m.amount || 0);
      if (alloc.debtRecovery) debtRecovery += amount; else operational += amount;
    });
  });
  return {operational:operational,debtRecovery:debtRecovery,total:operational+debtRecovery};
}
function bizTrackingStart() {
  const created = bizVehicleList().map(function(v){ return v.createdAt; }).filter(Boolean).sort()[0];
  return created ? nextOrSameTuesday(parseDate(created)) : nextOrSameTuesday(crTodayUTC());
}
function bizLateRows() {
  const vehicles = bizVehicleList();
  if (!vehicles.length) return [];
  const cutoff = bizTuesday(), start = bizTrackingStart(), end = new Date(cutoff);
  end.setUTCDate(end.getUTCDate() - 1);
  if (end < start) return [];
  return bizEventsBetween(start, end).map(function(ev) {
    const st = effectivePaymentState(ev);
    const missing = st.historicalApplied ? 0 : Math.max(0, Number(ev.amount || 0) - Number(st.received || 0));
    const weeksLate = Math.max(1, Math.ceil((cutoff - parseDate(ev.date)) / 604800000));
    return Object.assign({}, ev, st, {missing:missing,weeksLate:weeksLate,key:paymentKey(ev.vehicleId,ev.date)});
  }).filter(function(r){ return r.missing > .5; });
}
function bizTuesdaysInMonth(y,m) {
  return tuesdaysInMonth(y,m);
}
function bizExpenseNeed(e, rows, tuesday) {
  const iso = isoDate(tuesday);
  if (!dateInRange(iso,e.from,e.to)) return 0;
  if (e.type === 'automatic') return rows.reduce(function(s,r){ return s + Number(r.iva || (r.amount||0)*IVA_RATE); },0);
  if (e.type === 'remainder') return 0;
  if (e.periodicity === 'MENSUAL') return Number(e.amount||0) / Math.max(1,bizTuesdaysInMonth(tuesday.getUTCFullYear(),tuesday.getUTCMonth()).length);
  return Number(e.amount||0);
}
function bizCurrentExpenses(rows,tuesday) {
  return managedExpenseConfigV5().filter(function(e){ return dateInRange(isoDate(tuesday),e.from,e.to); }).map(function(e){
    return Object.assign({},e,{need:bizExpenseNeed(e,rows,tuesday),assigned:0});
  });
}
function bizAllocate(rows,available,debtRecovery) {
  let remaining = Math.max(0,Number(available||0));
  const regular = rows.filter(function(x){return x.type!=='remainder';}).sort(function(a,b){
    return priorityRank(a.priority)-priorityRank(b.priority) || Number(a.order||99)-Number(b.order||99);
  });
  regular.forEach(function(e){ e.assigned=Math.min(e.need,remaining); remaining-=e.assigned; });
  const rem = rows.find(function(x){return x.type==='remainder';});
  if(rem){ rem.need=Math.max(0,remaining+Number(debtRecovery||0)); rem.assigned=rem.need; remaining=0; }
  return rows;
}
function bizStatusHtml(r) {
  if(r.historicalApplied) return '<span class="statuspill ok">Aplicado en plan</span>';
  const pending=Math.max(0,Number(r.amount||0)-Number(r.received||0));
  if (pending<=.5) return '<span class="statuspill ok">Pagado</span>';
  if (Number(r.received||0)>0) return '<span class="statuspill partial">Parcial</span>';
  return '<span class="statuspill pending">Pendiente</span>';
}
function openBusinessPaymentV4(encodedKey) {
  const key=decodeURIComponent(encodedKey), row=bizRowsForTuesday(bizTuesday()).concat(bizLateRows()).find(function(r){return r.key===key;});
  if(!row) return alert('No encontré esa cuota.');
  if(row.historicalApplied)return alert('Esta cuota ya figura aplicada en el plan externo.');
  selectedPaymentV3=row;
  const pending=Math.max(0,Number(row.amount||0)-Number(row.received||0));
  $('savePaymentButton').disabled=pending<=.5;
  $('paymentModalTitle').textContent=row.vehicle;
  $('paymentModalInfo').innerHTML='<b>Cuota:</b> '+money(row.amount)+' · <b>Recibido:</b> '+money(row.received)+' · <b>Pendiente:</b> '+money(pending<=.5?0:pending)+'<br><span class="miniNote">Semana '+fmtShort(row.date)+' · '+managedLabelV5()+'</span>';
  $('paymentAmount').value=pending>.5?Math.ceil(pending):0;
  $('paymentNote').value='';
  $('paymentHistory').innerHTML=paymentHistoryHtmlV3(row.key);
  $('paymentModal').classList.add('show');
}
function renderBusinessWeek() {
  if(!$('bizIncomeBody')) return;
  const d=bizTuesday(), rows=bizRowsForTuesday(d), expected=rows.reduce(function(s,r){return s+Number(r.amount||0);},0);
  const cash=bizCashForWeek(d), received=cash.total, lateRows=bizLateRows();
  const late=lateRows.reduce(function(s,r){return s+Number(r.missing||0);},0);
  const pending=rows.reduce(function(s,r){return s+(r.historicalApplied?0:Math.max(0,Number(r.amount||0)-Number(r.received||0)));},0)+late;
  $('bizWeekLabel').textContent='Semana de cobro · martes '+new Intl.DateTimeFormat('es-CR',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}).format(d);
  $('bizExpected').textContent=money(expected);
  $('bizReceived').textContent=money(received);
  $('bizLate').textContent=money(late);
  $('bizPending').textContent=money(pending);
  $('bizIncomeBody').innerHTML=rows.length?rows.map(function(r){
    const miss=r.historicalApplied?0:Math.max(0,Number(r.amount||0)-Number(r.received||0));
    return '<tr><td>'+bizStatusHtml(r)+'</td><td>'+escapeHtmlV3(r.vehicle)+'</td><td>'+fmtShort(r.date)+'</td><td>'+money(r.amount)+'</td><td>'+money(r.received)+'</td><td><b>'+money(miss)+'</b></td><td>'+fmtShort(r.realDate)+'</td><td><button class="dark miniBtn" onclick="openBusinessPaymentV4(\''+encodeURIComponent(r.key)+'\')">'+(r.historicalApplied?'Aplicado en plan':miss<=.5?'Ver pagos':'Abonar')+'</button></td></tr>';
  }).join(''):'<tr><td colspan="8">No hay pagos programados para esta semana.</td></tr>';
  $('bizLateList').innerHTML=lateRows.length?lateRows.map(function(r){
    return '<div class="lateItem"><div><b>'+escapeHtmlV3(r.vehicle)+' · pendiente '+money(r.missing)+'</b><div class="lateMeta">Debía pagar '+fmtShort(r.date)+' · '+r.weeksLate+' semana'+(r.weeksLate===1?'':'s')+' de atraso</div></div><button class="dark" onclick="openBusinessPaymentV4(\''+encodeURIComponent(r.key)+'\')">Abonar</button></div>';
  }).join(''):'<div class="placeholder">No hay ingresos atrasados de '+managedLabelV5()+'.</div>';
  const allocated=bizAllocate(bizCurrentExpenses(rows,d),cash.operational,cash.debtRecovery);
  const used=allocated.reduce(function(s,e){return s+Number(e.assigned||0);},0);
  const gap=allocated.filter(function(e){return e.type!=='remainder';}).reduce(function(s,e){return s+Math.max(0,e.need-e.assigned);},0);
  const rem=allocated.find(function(e){return e.type==='remainder';});
  $('bizAllocAvailable').textContent=money(received);
  $('bizAllocUsed').textContent=money(used);
  $('bizAllocGap').textContent=money(gap);
  $('bizAllocRemainder').textContent=money(rem?rem.assigned:0);
  $('bizExpenseBody').innerHTML=allocated.map(function(e){
    const falta=Math.max(0,e.need-e.assigned),state=e.type==='remainder'?'<span class="statuspill ok">Remanente</span>':falta<=.01?'<span class="statuspill ok">Cubierto</span>':e.assigned>0?'<span class="statuspill partial">Parcial</span>':'<span class="statuspill pending">Pendiente</span>';
    return '<tr><td><span class="priority '+priorityClass(e.priority)+'">'+priorityLabel(e.priority)+'</span></td><td>'+escapeHtmlV3(e.name)+'</td><td>'+money(e.need)+'</td><td>'+money(e.assigned)+'</td><td>'+money(falta)+'</td><td>'+state+'</td></tr>';
  }).join('');
}
function rawBizPeriod(type,periodicity) {
  if(type==='automatic') return 'AUTOMATICO';
  if(type==='remainder') return 'REMANENTE';
  return periodicity==='MENSUAL'?'MENSUAL':'SEMANAL';
}
function renderBusinessExpenseConfig() {
  if(!$('bizExpenseConfigBody')) return;
  const rows=managedExpenseConfigV5().slice().sort(function(a,b){return priorityRank(a.priority)-priorityRank(b.priority)||Number(a.order||99)-Number(b.order||99);});
  $('bizExpenseConfigBody').innerHTML=rows.map(function(e){
    const p=rawBizPeriod(e.type,e.periodicity),disabled=(p==='AUTOMATICO'||p==='REMANENTE')?' disabled':'';
    return '<tr data-biz-expense="'+escapeAttrV3(e.id)+'"><td><input data-b="order" type="number" min="1" value="'+Number(e.order||1)+'" style="width:70px"></td><td><input data-b="name" value="'+escapeAttrV3(e.name)+'"></td><td><select data-b="period"><option value="SEMANAL" '+(p==='SEMANAL'?'selected':'')+'>Semanal</option><option value="MENSUAL" '+(p==='MENSUAL'?'selected':'')+'>Mensual</option><option value="AUTOMATICO" '+(p==='AUTOMATICO'?'selected':'')+'>Automático</option><option value="REMANENTE" '+(p==='REMANENTE'?'selected':'')+'>Remanente</option></select></td><td><input data-b="amount" type="number" min="0" step="500" value="'+Number(e.amount||0)+'"'+disabled+'></td><td><select data-b="priority"><option value="CRITICA" '+(e.priority==='critical'?'selected':'')+'>Crítica</option><option value="MEDIA" '+(e.priority==='medium'?'selected':'')+'>Media</option><option value="BAJA" '+(e.priority==='low'?'selected':'')+'>Baja</option></select></td><td><div class="rowActions"><button class="dark miniBtn" onclick="saveBusinessExpenseV4(\''+escapeAttrV3(e.id)+'\')">Guardar</button>'+(e.type==='automatic'||e.type==='remainder'?'':'<button class="light miniBtn" onclick="deleteBusinessExpenseV4(\''+escapeAttrV3(e.id)+'\')">Quitar</button>')+'</div></td></tr>';
  }).join('');
  document.querySelectorAll('[data-biz-expense] [data-b="period"]').forEach(function(sel){
    sel.onchange=function(){const row=sel.closest('[data-biz-expense]'),amount=row.querySelector('[data-b="amount"]'); amount.disabled=['AUTOMATICO','REMANENTE'].includes(sel.value);};
  });
}
async function saveBusinessExpenseV4(id) {
  const row=document.querySelector('[data-biz-expense="'+CSS.escape(id)+'"]'); if(!row)return;
  const get=function(k){return row.querySelector('[data-b="'+k+'"]');},period=get('period').value;
  const tipo=period==='AUTOMATICO'?'AUTOMATICO_PLAN':period==='REMANENTE'?'REMANENTE':'SEMANAL';
  const payload={sessionToken:sessionStorage.getItem(SESSION_KEY),accountId:id,nombre:get('name').value.trim(),tipo:tipo,monto:Number(get('amount').value||0),prioridad:get('priority').value,orden:Number(get('order').value||1),vigenteDesde:(managedExpenseConfigV5().find(function(e){return e.id===id;})||{}).from||'',vigenteHasta:(managedExpenseConfigV5().find(function(e){return e.id===id;})||{}).to||'',entidad:activeManagedEntityV5,periodicidad:period};
  try{const r=await backend('updateAccount',payload);if(!r.ok)throw new Error(r.message||'No se pudo guardar');await loadProductionData();renderAll();renderBusinessAll();}
  catch(e){alert(e.message||'Error guardando gasto de Negocio');}
}
async function createBusinessExpenseV4() {
  const name=$('bizNewName').value.trim(),period=$('bizNewPeriod').value;
  if(!name)return alert('Ingresá un nombre.');
  const tipo=period==='AUTOMATICO'?'AUTOMATICO_PLAN':period==='REMANENTE'?'REMANENTE':'SEMANAL';
  try{
    const r=await backend('createAccount',{sessionToken:sessionStorage.getItem(SESSION_KEY),nombre:name,tipo:tipo,monto:Number($('bizNewAmount').value||0),prioridad:$('bizNewPriority').value,orden:Number($('bizNewOrder').value||99),vigenteDesde:isoDate(crTodayUTC()),vigenteHasta:'',entidad:activeManagedEntityV5,periodicidad:period});
    if(!r.ok)throw new Error(r.message||'No se pudo crear');
    $('bizNewName').value='';$('bizNewAmount').value='0';
    await loadProductionData();renderAll();renderBusinessAll();
  }catch(e){alert(e.message||'Error creando gasto de Negocio');}
}
async function deleteBusinessExpenseV4(id) {
  const e=managedExpenseConfigV5().find(function(x){return x.id===id;}); if(!e)return;
  if(!confirm('¿Quitar '+e.name+' de los gastos de '+managedLabelV5()+'? El historial no se elimina.'))return;
  try{const r=await backend('deleteAccount',{sessionToken:sessionStorage.getItem(SESSION_KEY),accountId:id});if(!r.ok)throw new Error(r.message||'No se pudo quitar');await loadProductionData();renderAll();renderBusinessAll();}
  catch(err){alert(err.message||'Error quitando gasto');}
}
function bizProjectMonth(y,m,extraCars,extraWeekly) {
  const start=new Date(Date.UTC(y,m,1)),end=new Date(Date.UTC(y,m+1,0)),events=bizEventsBetween(start,end),tuesdays=bizTuesdaysInMonth(y,m);
  const income=events.reduce(function(s,e){return s+Number(e.amount||0);},0);
  const iva=events.reduce(function(s,e){return s+Number(e.iva||((e.amount||0)*IVA_RATE));},0);
  let fixed=0;
  managedExpenseConfigV5().forEach(function(e){
    if(e.type==='remainder'||e.type==='automatic')return;
    const mid=isoDate(new Date(Date.UTC(y,m,15))); if(!dateInRange(mid,e.from,e.to))return;
    fixed+=e.periodicity==='MENSUAL'?Number(e.amount||0):Number(e.amount||0)*tuesdays.length;
  });
  const expenses=iva+fixed,net=income-expenses,extraPayments=tuesdays.length*extraCars,extraIncome=extraPayments*extraWeekly,extraNet=extraIncome-extraIncome*IVA_RATE-extraPayments*WEEKLY_INSURANCE;
  return {income:income,expenses:expenses,net:net,scenarioNet:net+extraNet,extraNet:extraNet,tuesdays:tuesdays.length};
}
function renderBusinessProjection() {
  if(!$('bizProjectionBody'))return;
  const now=crTodayUTC(),mode=$('bizProjectionRange').value;
  let start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),end;
  if(mode==='quarter')end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+3,0));
  else if(mode==='semester')end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+6,0));
  else end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+12,0));
  const extra=Number($('bizExtraCars').value||0),extraWeekly=Number($('bizExtraWeekly').value||85000),vals=[];
  let cursor=new Date(start);
  while(cursor<=end){vals.push([monthKey(cursor),bizProjectMonth(cursor.getUTCFullYear(),cursor.getUTCMonth(),extra,extraWeekly)]);cursor=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1));}
  const income=vals.reduce(function(s,x){return s+x[1].income;},0),expenses=vals.reduce(function(s,x){return s+x[1].expenses;},0),net=vals.reduce(function(s,x){return s+x[1].net;},0),extraImpact=vals.reduce(function(s,x){return s+x[1].extraNet;},0);
  $('bizProjIncome').textContent=money(income);$('bizProjExpenses').textContent=money(expenses);$('bizProjNet').textContent=money(net);$('bizProjExtra').textContent=money(extraImpact);
  $('bizProjectionBody').innerHTML=vals.map(function(x){return '<tr><td>'+x[0]+'</td><td>'+money(x[1].income)+'</td><td>'+money(x[1].expenses)+'</td><td>'+money(x[1].net)+'</td><td>'+money(x[1].scenarioNet)+'</td></tr>';}).join('');
  const max=Math.max(1,...vals.map(function(x){return Math.abs(x[1].scenarioNet);}));
  $('bizProjectionBars').innerHTML=vals.map(function(x){return '<div class="barRow"><div>'+x[0]+'</div><div class="barTrack"><div class="barFill" style="width:'+Math.max(2,Math.abs(x[1].scenarioNet)/max*100)+'%"></div></div><div>'+money(x[1].scenarioNet)+'</div></div>';}).join('');
  const impacts=[1,2,3].map(function(n){return vals.reduce(function(s,x){const p=x[0].split('-').map(Number);return s+bizProjectMonth(p[0],p[1]-1,n,extraWeekly).extraNet;},0);});
  $('bizScenarioSummary').innerHTML='<div class="note"><b>Neto base:</b> '+money(net)+'<br><br><b>+1 carro:</b> '+money(net+impacts[0])+'<br><b>+2 carros:</b> '+money(net+impacts[1])+'<br><b>+3 carros:</b> '+money(net+impacts[2])+'<br><br><span style="color:#667085">Solo utiliza vehículos y gastos de '+managedLabelV5()+'.</span></div>';
}
function renderBusinessAll() {
  renderBusinessWeek();renderBusinessExpenseConfig();renderBusinessProjection();
}
function showBusinessView(id) {
  activeBusinessView=id;
  document.querySelectorAll('.businessView').forEach(function(v){v.style.display=v.id===id?'block':'none';});
  document.querySelectorAll('.bizNavBtn').forEach(function(b){b.className=(b.dataset.biz===id?'dark':'light')+' bizNavBtn';});
  if(id==='bizSemana')renderBusinessWeek();if(id==='bizGastos')renderBusinessExpenseConfig();if(id==='bizProyecciones')renderBusinessProjection();
}
function managedHeadingsV5() {
  const label=managedLabelV5(),weekTitle=$('bizSemana')?.querySelector('.weekTop h2');
  if(weekTitle)weekTitle.textContent='Ingresos semanales '+label;
  const expensesTitle=$('bizGastos')?.querySelector('h2');
  if(expensesTitle)expensesTitle.textContent='Gastos y prioridades · '+label;
  const projectionTitle=$('bizProyecciones')?.querySelector('h2');
  if(projectionTitle)projectionTitle.textContent='Proyecciones · '+label;
  const allocationTitle=$('bizSemana')?.querySelector('.sectionHead h2');
  if(allocationTitle)allocationTitle.textContent='Distribución de gastos · '+label;
  const projectionNote=$('bizProyecciones')?.querySelector('.sectionHead .status');
  if(projectionNote)projectionNote.textContent='Solo vehículos y gastos asignados a '+label+'.';
  const incomeNote=$('bizSemana')?.querySelector('.sectionHead .status');
  if(incomeNote)incomeNote.textContent='Solo se distribuye dinero realmente recibido por '+label+'.';
}
function applyScopeV4(scope) {
  if(!['PERSONAL','NEGOCIO','CATA'].includes(scope))scope='PERSONAL';
  const managed=scope!=='PERSONAL',nav=document.querySelector('#appShell > .nav'),bizNav=$('businessNav'),shell=$('businessShell');
  if(managed)activeManagedEntityV5=scope;
  localStorage.setItem('flotilla_scope',scope);
  if($('scopeSelector'))$('scopeSelector').value=scope;
  if($('appSubtitle'))$('appSubtitle').textContent=scope==='CATA'?'Administración Cata · V5':scope==='NEGOCIO'?'Administración negocio · V5':'Administración personal · V5';
  if(nav)nav.style.display=managed?'none':'flex';
  if(bizNav)bizNav.style.display=managed?'flex':'none';
  document.querySelectorAll('#appShell .view').forEach(function(v){if(managed)v.classList.remove('active');});
  if(shell)shell.style.display=managed?'block':'none';
  if(managed){managedHeadingsV5();showBusinessView(activeBusinessView);renderBusinessAll();}
  else{if(shell)shell.style.display='none';goToView(lastPersonalView||'resumen');}
}
function installBusinessUIV4() {
  if($('businessShell'))return;
  const style=document.createElement('style');
  style.textContent='.scopeSwitcher{display:flex;align-items:center;gap:8px;margin-left:auto}.scopeSwitcher label{color:#d8d8d8;margin:0}.scopeSwitcher select{min-width:170px;background:#171717;color:#d7b928;border:1px solid #3b2f0c}.businessNav{display:none;gap:7px;overflow:auto;background:#fff;padding:10px 16px;border-bottom:1px solid var(--l)}body.dark .businessNav{background:#000;border-bottom:1px solid #6f590d}.businessView{display:none;margin-top:20px}.bizConfigTable{min-width:980px}.bizAddGrid{display:grid;grid-template-columns:1.2fr .8fr .8fr .7fr .5fr auto;gap:8px;align-items:end}@media(max-width:900px){.headerFlex{flex-wrap:wrap}.scopeSwitcher{order:3;width:100%;margin-left:0}.scopeSwitcher select{flex:1}.bizAddGrid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.bizAddGrid{grid-template-columns:1fr}}';
  document.head.appendChild(style);
  const nav=document.createElement('div');nav.id='businessNav';nav.className='businessNav';
  nav.innerHTML='<button class="dark bizNavBtn" data-biz="bizSemana">Semana actual</button><button class="light bizNavBtn" data-biz="bizGastos">Gastos y prioridades</button><button class="light bizNavBtn" data-biz="bizProyecciones">Proyecciones</button>';
  const personalNav=document.querySelector('#appShell > .nav');personalNav.after(nav);
  const wrap=document.querySelector('#appShell > .wrap'),shell=document.createElement('div');shell.id='businessShell';shell.style.display='none';
  shell.innerHTML='<section id="bizSemana" class="businessView"><div class="card"><div class="weekTop"><button class="light" id="bizPrevWeek">← Semana anterior</button><div style="text-align:center"><h2 style="margin-bottom:2px">Ingresos semanales sociedad</h2><div id="bizWeekLabel" class="status">—</div></div><button class="light" id="bizNextWeek">Semana siguiente →</button></div><div class="weekKpis"><div class="metric">Esperado<b id="bizExpected">₡0</b></div><div class="metric">Recibido<b id="bizReceived">₡0</b></div><div class="metric">Atrasos<b id="bizLate">₡0</b></div><div class="metric">Pendiente<b id="bizPending">₡0</b></div></div><h3>Ingresos de la sociedad</h3><div class="table"><table class="weeklyTable"><thead><tr><th>Estado</th><th>Vehículo</th><th>Fecha esperada</th><th>Esperado</th><th>Recibido</th><th>Pendiente</th><th>Fecha real</th><th>Acción</th></tr></thead><tbody id="bizIncomeBody"></tbody></table></div><div style="margin-top:18px"><h3>Ingresos atrasados</h3><div id="bizLateList" class="lateList"></div></div></div><div class="card"><div class="sectionHead"><div><h2>Distribución de gastos · Sociedad</h2><div class="status">Solo se distribuye dinero realmente recibido por Negocio.</div></div><button class="dark" onclick="renderBusinessWeek()">Recalcular distribución</button></div><div class="weekKpis"><div class="metric">Disponible<b id="bizAllocAvailable">₡0</b></div><div class="metric">Asignado<b id="bizAllocUsed">₡0</b></div><div class="metric">Pendiente por fondear<b id="bizAllocGap">₡0</b></div><div class="metric">Remanente / reinversión<b id="bizAllocRemainder">₡0</b></div></div><div class="table"><table class="expenseTable"><thead><tr><th>Prioridad</th><th>Cuenta</th><th>Necesario</th><th>Asignado</th><th>Falta</th><th>Estado</th></tr></thead><tbody id="bizExpenseBody"></tbody></table></div></div></section><section id="bizGastos" class="businessView"><div class="card"><div class="sectionHead"><div><h2>Gastos y prioridades · Sociedad</h2><div class="status">Separados completamente de las cuentas personales.</div></div></div><div class="bizAddGrid" style="margin-top:14px"><div><label>Nombre</label><input id="bizNewName" placeholder="Ej. Mantenimiento"></div><div><label>Periodicidad</label><select id="bizNewPeriod"><option value="SEMANAL">Semanal</option><option value="MENSUAL">Mensual</option></select></div><div><label>Monto</label><input id="bizNewAmount" type="number" value="0" step="500"></div><div><label>Prioridad</label><select id="bizNewPriority"><option value="CRITICA">Crítica</option><option value="MEDIA">Media</option><option value="BAJA">Baja</option></select></div><div><label>Orden</label><input id="bizNewOrder" type="number" value="99" min="1"></div><button class="dark" id="bizAddExpense">+ Agregar</button></div><div class="table" style="margin-top:16px"><table class="bizConfigTable"><thead><tr><th>Orden</th><th>Cuenta</th><th>Periodicidad</th><th>Monto</th><th>Prioridad</th><th>Acción</th></tr></thead><tbody id="bizExpenseConfigBody"></tbody></table></div></div></section><section id="bizProyecciones" class="businessView"><div class="card"><div class="sectionHead"><div><h2>Proyecciones · Negocio</h2><div class="status">Solo vehículos y gastos asignados a la sociedad.</div></div></div><div class="toolbar" style="margin-top:12px"><div><label>Vista</label><select id="bizProjectionRange" class="smallselect"><option value="quarter">Trimestre</option><option value="semester">Semestre</option><option value="year" selected>Año</option></select></div><div><label>Simular nuevos carros</label><select id="bizExtraCars" class="smallselect"><option value="0">Sin carros nuevos</option><option value="1">+1 carro</option><option value="2">+2 carros</option><option value="3">+3 carros</option></select></div><div><label>Cuota semanal estimada</label><input id="bizExtraWeekly" class="smallselect" type="number" value="85000" step="5000"></div></div><div class="weekKpis"><div class="metric">Ingresos proyectados<b id="bizProjIncome">₡0</b></div><div class="metric">Gastos proyectados<b id="bizProjExpenses">₡0</b></div><div class="metric">Disponible neto<b id="bizProjNet">₡0</b></div><div class="metric">Impacto carros nuevos<b id="bizProjExtra">₡0</b></div></div><div class="projectionGrid"><div class="card innerCard"><h3>Disponible neto por mes</h3><div id="bizProjectionBars" class="barChart"></div></div><div class="card innerCard"><h3>Escenarios</h3><div id="bizScenarioSummary"></div></div></div><div class="table" style="margin-top:14px"><table class="projectionTable"><thead><tr><th>Periodo</th><th>Ingresos</th><th>Gastos</th><th>Disponible neto</th><th>Neto con escenario</th></tr></thead><tbody id="bizProjectionBody"></tbody></table></div></div></section>';
  wrap.appendChild(shell);
  document.querySelectorAll('.bizNavBtn').forEach(function(b){b.onclick=function(){showBusinessView(b.dataset.biz);};});
  $('bizPrevWeek').onclick=function(){businessWeekOffset--;renderBusinessWeek();};
  $('bizNextWeek').onclick=function(){businessWeekOffset++;renderBusinessWeek();};
  $('bizAddExpense').onclick=createBusinessExpenseV4;
  ['bizProjectionRange','bizExtraCars','bizExtraWeekly'].forEach(function(id){$(id).addEventListener('change',renderBusinessProjection);});
  document.querySelectorAll('.navbtn').forEach(function(b){b.addEventListener('click',function(){lastPersonalView=b.dataset.v||lastPersonalView;});});
  // El formulario compartido estaba oculto dentro de Semana personal.
  // Se monta a nivel de app para abrirlo desde Sociedad y Cata sin cambiar de vista.
  const sharedPaymentModal=$('paymentModal');
  if(sharedPaymentModal && sharedPaymentModal.parentElement!==$('appShell'))$('appShell').appendChild(sharedPaymentModal);
  const selector=$('scopeSelector');if(selector){selector.value=localStorage.getItem('flotilla_scope')||'PERSONAL';selector.onchange=function(){applyScopeV4(selector.value);};}
  applyScopeV4(selector?selector.value:'PERSONAL');
}
const renderAllBeforeBusinessV4=renderAll;
renderAll=function(){renderAllBeforeBusinessV4();renderBusinessAll();};
window.renderAll=renderAll;
document.addEventListener('DOMContentLoaded',installBusinessUIV4);
window.openBusinessPaymentV4=openBusinessPaymentV4;
window.saveBusinessExpenseV4=saveBusinessExpenseV4;
window.deleteBusinessExpenseV4=deleteBusinessExpenseV4;
window.renderBusinessWeek=renderBusinessWeek;
