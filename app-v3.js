'use strict';

/* Base de Datos Flotilla · V3.0
   Extensión de producción: abonos parciales, configuración operativa,
   Uber/Plan de pagos, OCR opcional y comprobantes PNG.
*/
let uberWeeksV3 = [];
let planDashboardV3 = [];
let selectedPaymentV3 = null;
let planDashboardLoadedV3 = false;

const loadProductionDataV22 = loadProductionData;
loadProductionData = async function () {
  await loadProductionDataV22();
  const sessionToken = sessionStorage.getItem(SESSION_KEY);
  if (!sessionToken) return;
  const r = await backend('bootstrap', { sessionToken });
  if (!r.ok) return;

  const rawVehicles = Array.isArray(r.vehicles) ? r.vehicles : [];
  contractVehicles.forEach(v => {
    const raw = rawVehicles.find(x => String(x.VehicleID || '') === v.id) || {};
    v.driver = String(raw.Chofer || '');
    v.paymentType = String(raw.TipoCobro || '').toUpperCase();
    v.planSheetTab = String(raw.PlanSheetTab || '');
    v.operationStatus = String(raw.OperacionEstado || 'ACTIVO').toUpperCase();
    v.planIntegrationActive = raw.PlanIntegracionActiva === true || String(raw.PlanIntegracionActiva).toUpperCase() === 'TRUE';
    v.configNote = String(raw.ConfigNota || '');
  });

  // V3: varios movimientos pueden pertenecer a la misma cuota.
  Object.keys(paymentState).forEach(k => delete paymentState[k]);
  (Array.isArray(r.payments) ? r.payments : []).forEach(p => {
    const date = normalizeSheetDate(p.FechaProgramada);
    const vehicleId = String(p.VehicleID || '');
    if (!date || !vehicleId) return;
    const key = paymentKey(vehicleId, date);
    const current = paymentState[key] || {
      received: 0, realDate: '', status: 'Pendiente', pagoId: '', paymentIds: [], movements: [], expected: Number(p.MontoEsperado || 0)
    };
    const amount = Number(p.MontoRecibido || 0);
    current.received += amount;
    current.expected = Number(p.MontoEsperado || current.expected || 0);
    current.realDate = normalizeSheetDate(p.FechaReal) || current.realDate;
    current.pagoId = String(p.PagoID || current.pagoId || '');
    current.paymentIds.push(String(p.PagoID || ''));
    current.movements.push({
      pagoId: String(p.PagoID || ''), amount,
      date: normalizeSheetDate(p.FechaReal),
      status: String(p.Estado || ''), note: String(p.Nota || ''),
      origin: String(p.Origen || 'MANUAL'), uberSemanaId: String(p.UberSemanaID || '')
    });
    current.status = current.expected && current.received >= current.expected - .01 ? 'PAGADO' : current.received > 0 ? 'PARCIAL' : 'PENDIENTE';
    paymentState[key] = current;
  });

  uberWeeksV3 = Array.isArray(r.uberWeeks) ? r.uberWeeks.map(x => ({
    id: String(x.UberSemanaID || ''), vehicleId: String(x.VehicleID || ''), tab: String(x.PlanSheetTab || ''),
    week: Number(x.Semana || 0), date: normalizeSheetDate(x.FechaProgramada), gains: Number(x.GananciasTotales || 0),
    returns: Number(x.DevolucionesGastos || 0), adjustments: Number(x.AjustesAnteriores || 0), carryIn: Number(x.SaldoArrastradoEntrada || 0),
    reimbursements: Number(x.ReembolsosTotal || 0), cash: Number(x.EfectivoChofer || 0), quota: Number(x.Cuota || 0),
    balance: Number(x.SaldoSemana || 0), rawAvailable: Number(x.MontoDisponibleBruto || 0), status: String(x.Estado || '')
  })) : [];
  planDashboardLoadedV3 = false;
};

function openPaymentRowsV3(vehicleId) {
  const current = rowsForCurrentWeek().filter(r => r.vehicleId === vehicleId);
  const late = getLateRows().filter(r => r.vehicleId === vehicleId);
  const map = new Map();
  [...late, ...current].forEach(r => map.set(r.key, r));
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function paymentStatusV3(row) {
  const pending = Math.max(0, Number(row.amount || 0) - Number(row.received || 0));
  return { pending, paid: pending <= .01, partial: Number(row.received || 0) > 0 && pending > .01 };
}

const renderWeekV22 = renderWeek;
renderWeek = function () {
  renderWeekV22();
  const rows = rowsForCurrentWeek();
  $('weeklyIncomeBody').innerHTML = rows.length ? rows.map(r => {
    const s = paymentStatusV3(r);
    const label = s.paid ? 'Pagado' : s.partial ? 'Parcial' : 'Pendiente';
    return `<tr>
      <td><span class="statuspill ${s.paid ? 'ok' : s.partial ? 'partial' : 'pending'}">${label}</span></td>
      <td>${escapeHtmlV3(r.vehicle)}${r.merged ? ' <span class="statuspill pending">fecha especial</span>' : ''}</td>
      <td>${fmtShort(r.date)}</td><td>${money(r.amount)}</td><td>${money(r.received)}</td><td><b>${money(s.pending)}</b></td><td>${fmtShort(r.realDate)}</td>
      <td><div class="rowActions"><button class="dark miniBtn" onclick="openPaymentV3('${encodeURIComponent(r.key)}')">${s.paid ? 'Ver / abonar' : 'Abonar'}</button>${r.received > 0 ? `<button class="light miniBtn" onclick="removeLastPaymentV3('${encodeURIComponent(r.key)}')">Deshacer último</button>` : ''}${isUberV3(r.vehicleId) ? `<button class="light miniBtn" onclick="openUberFromWeekV3('${r.vehicleId}')">Ver Uber</button>` : ''}</div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="8">No hay pagos programados para esta semana.</td></tr>';

  const lateRows = getLateRows();
  $('lateList').innerHTML = lateRows.length ? lateRows.map(r => {
    const received = Number(r.received || 0);
    return `<div class="lateItem">
      <div><b>${escapeHtmlV3(r.vehicle)} · pendiente ${money(r.missing)}</b><div class="lateMeta">Debía pagar ${fmtShort(r.date)} · recibido ${money(received)} · ${r.weeksLate} semana${r.weeksLate === 1 ? '' : 's'} de atraso</div></div>
      <button class="dark" onclick="openPaymentV3('${encodeURIComponent(r.key)}')">Abonar</button>
    </div>`;
  }).join('') : '<div class="placeholder">No hay ingresos atrasados.</div>';
};

function findPaymentRowV3(key) {
  return [...getLateRows(), ...rowsForCurrentWeek()].find(r => r.key === key) || null;
}
function openPaymentV3(encodedKey) {
  const key = decodeURIComponent(encodedKey);
  const row = findPaymentRowV3(key);
  if (!row) return alert('No encontré esa cuota. Recargá la semana e intentá nuevamente.');
  selectedPaymentV3 = row;
  const s = paymentStatusV3(row);
  $('paymentModalTitle').textContent = row.vehicle;
  $('paymentModalInfo').innerHTML = `<b>Cuota:</b> ${money(row.amount)} · <b>Recibido:</b> ${money(row.received)} · <b>Pendiente:</b> ${money(s.pending)}<br><span class="miniNote">Semana ${fmtShort(row.date)}</span>`;
  $('paymentAmount').value = Math.round(s.pending || 0);
  $('paymentNote').value = '';
  $('paymentHistory').innerHTML = paymentHistoryHtmlV3(row.key);
  $('paymentModal').classList.add('show');
  setTimeout(() => $('paymentAmount').focus(), 50);
}
function paymentHistoryHtmlV3(key) {
  const st = paymentState[key];
  if (!st || !Array.isArray(st.movements) || !st.movements.length) return '<div class="placeholder smallPlaceholder">Todavía no hay abonos.</div>';
  return `<div class="movementList">${st.movements.map(m => `<div class="movementRow"><span>${fmtShort(m.date)} · ${escapeHtmlV3(m.origin || 'MANUAL')}</span><b>${money(m.amount)}</b></div>`).join('')}</div>`;
}
function closePaymentV3() { $('paymentModal').classList.remove('show'); selectedPaymentV3 = null; }
async function savePaymentV3() {
  if (!selectedPaymentV3) return;
  const row = selectedPaymentV3, amount = Number($('paymentAmount').value || 0), st = getPaymentState(row.vehicleId, row.date), pending = Math.max(0, row.amount - st.received);
  if (!(amount > 0)) return alert('Ingresá un monto mayor a ₡0.');
  if (amount > pending + .01 && !confirm(`El abono es ${money(amount - pending)} mayor al pendiente. ¿Querés registrarlo igualmente?`)) return;
  $('savePaymentButton').disabled = true;
  try {
    const after = st.received + amount;
    const res = await backend('markPayment', {
      sessionToken: sessionStorage.getItem(SESSION_KEY), planId: row.planId || row.key, vehicleId: row.vehicleId,
      fechaProgramada: row.date, fechaReal: isoDate(crTodayUTC()), montoEsperado: row.amount, montoRecibido: amount,
      estado: after >= row.amount - .01 ? 'PAGADO' : 'PARCIAL', nota: $('paymentNote').value.trim(), origen: 'MANUAL'
    });
    if (!res.ok) throw new Error(res.message || 'No se pudo registrar el abono');
    closePaymentV3(); await loadProductionData(); renderAll();
  } catch (e) { alert(e.message || 'Error registrando el abono'); }
  finally { $('savePaymentButton').disabled = false; }
}
async function removeLastPaymentV3(encodedKey) {
  const key = decodeURIComponent(encodedKey), st = paymentState[key];
  if (!st || !Array.isArray(st.movements) || !st.movements.length) return;
  const last = st.movements[st.movements.length - 1];
  if (!confirm(`¿Eliminar el último abono de ${money(last.amount)}?`)) return;
  try {
    const r = await backend('unmarkPayment', { sessionToken: sessionStorage.getItem(SESSION_KEY), pagoId: last.pagoId });
    if (!r.ok) throw new Error(r.message || 'No se pudo eliminar');
    await loadProductionData(); renderAll();
  } catch (e) { alert(e.message || 'Error eliminando el abono'); }
}

function isUberV3(vehicleId) {
  const v = contractVehicles.find(x => x.id === vehicleId);
  return !!v && v.paymentType === 'UBER';
}

async function loadPlanDashboardV3(force = false) {
  if (planDashboardLoadedV3 && !force) { renderUberV3(); return; }
  const box = $('uberCards'); if (box) box.innerHTML = '<div class="placeholder">Cargando cuentas…</div>';
  try {
    const r = await backend('getPlanDashboard', { sessionToken: sessionStorage.getItem(SESSION_KEY) });
    if (!r.ok) throw new Error(r.message || 'No se pudo cargar Plan de pagos');
    planDashboardV3 = Array.isArray(r.cards) ? r.cards : [];
    planDashboardLoadedV3 = true;
    renderUberV3();
  } catch (e) {
    if (box) box.innerHTML = `<div class="placeholder bad">${escapeHtmlV3(e.message || 'No se pudo cargar el backend V3.')}</div>`;
  }
}
function dashboardCardV3(vehicleId) { return planDashboardV3.find(c => c.vehicleId === vehicleId) || null; }
function renderUberV3() {
  const box = $('uberCards'); if (!box) return;
  const vehicles = contractVehicles.filter(v => !['FINALIZADO','CANCELADO'].includes(v.operationStatus || 'ACTIVO'));
  if (!vehicles.length) { box.innerHTML = '<div class="placeholder">No hay vehículos activos.</div>'; return; }
  box.innerHTML = vehicles.map(v => {
    const open = openPaymentRowsV3(v.id), pending = open.filter(r => paymentStatusV3(r).pending > .01), pendingAmt = pending.reduce((s,r)=>s+paymentStatusV3(r).pending,0), dash = dashboardCardV3(v.id);
    const type = v.paymentType || 'SIN_CONFIGURAR', isUber = type === 'UBER';
    return `<article class="vehicleControlCard ${isUber ? 'uberCard' : 'personalCard'}" id="controlCard_${safeIdV3(v.id)}">
      <button class="vehicleCardHead" onclick="toggleVehicleCardV3('${v.id}')">
        <span><b>${escapeHtmlV3(v.name)}</b><small>${escapeHtmlV3(v.driver || 'Chofer sin configurar')} · ${type === 'UBER' ? 'Uber' : type === 'PERSONAL' ? 'Uso personal' : 'Sin configurar'}</small></span>
        <span class="cardTotals"><b>${money(v.weekly)}</b><small>${pending.length ? pending.length+' pendiente'+(pending.length===1?'':'s')+' · '+money(pendingAmt) : 'Al día'}</small></span>
      </button>
      <div class="vehicleCardBody ${isUber ? '' : 'collapsed'}" data-card-body="${v.id}">
        ${isUber ? uberBodyV3(v,dash,open) : personalBodyV3(v,open)}
      </div>
    </article>`;
  }).join('');
}
function personalBodyV3(v, rows) {
  const pending = rows.filter(r => paymentStatusV3(r).pending > .01);
  return `<div class="personalCompact"><div class="note">Uso personal: no se muestra el cuadro de Uber.</div>${pending.length ? pending.map(r=>`<div class="pendingWeekLine"><span>${fmtShort(r.date)} · cuota ${money(r.amount)}</span><b>Pendiente ${money(paymentStatusV3(r).pending)}</b><button class="light miniBtn" onclick="jumpToWeekV3('${r.date}')">Ver semana</button></div>`).join('') : '<div class="placeholder smallPlaceholder">No hay semanas pendientes.</div>'}</div>`;
}
function uberBodyV3(v, dash, rows) {
  const summary = dash && Array.isArray(dash.summary) && dash.summary.length ? dash.summary : [['Semana #','—'],['Ganancias Totales','—'],['Reembolsos','—'],['Efectivo','—'],['Cuota',money(v.weekly)],['Saldo Semana','—']];
  const targetRows = rows.length ? rows : rowsForCurrentWeek().filter(r=>r.vehicleId===v.id);
  const targetOptions = targetRows.map(r => `<option value="${r.date}">${fmtShort(r.date)} · ${paymentStatusV3(r).pending > .01 ? 'pendiente '+money(paymentStatusV3(r).pending) : 'pagada'}</option>`).join('');
  return `<div class="uberLayout">
    <div>
      <div class="legacySummary" id="legacySummary_${safeIdV3(v.id)}">${summary.map((r,i)=>`<div class="legacyRow ${i===5?'legacyBalance':''}"><span>${escapeHtmlV3(r[0]||'')}</span><b>${escapeHtmlV3(String(r[1]||''))}</b></div>`).join('')}</div>
      <div class="actions"><button class="light miniBtn" onclick="downloadUberReceiptV3('${v.id}')">Capturar cuadro</button><button class="light miniBtn" onclick="jumpToVehicleWeekV3('${v.id}')">Ir a Semana actual</button></div>
    </div>
    <div class="uberForm" data-uber-form="${v.id}">
      <label>Semana a actualizar</label><select data-field="targetDate">${targetOptions || '<option value="">No hay cuota visible</option>'}</select>
      <label>Screenshot de Uber</label><input data-field="screenshot" type="file" accept="image/*">
      <div class="actions"><button class="light miniBtn" onclick="readUberScreenshotV3('${v.id}')">Leer screenshot</button></div>
      <div data-field="ocrStatus" class="miniNote">La lectura automática es una ayuda; confirmá los montos antes de guardar.</div>
      <div class="uberInputGrid">
        <div><label>Ganancias totales</label><input data-field="gains" type="number" step="0.01"></div>
        <div><label>Devoluciones y gastos</label><input data-field="returns" type="number" step="0.01" value="0"></div>
        <div><label>Ajustes periodos anteriores</label><input data-field="adjustments" type="number" step="0.01" value="0"></div>
        <div><label>Efectivo al chofer</label><input data-field="cash" type="number" step="0.01"></div>
      </div>
      <textarea data-field="ocrText" style="display:none"></textarea>
      <div class="actions"><button class="dark" onclick="saveUberWeekV3('${v.id}')">Guardar semana Uber</button></div>
    </div>
  </div>
  <div class="pendingWeeks"><h3>Semanas pendientes</h3>${rows.filter(r=>paymentStatusV3(r).pending>.01).length ? rows.filter(r=>paymentStatusV3(r).pending>.01).map(r=>`<div class="pendingWeekLine"><span>${fmtShort(r.date)} · ${money(r.received)} de ${money(r.amount)}</span><b>${money(paymentStatusV3(r).pending)} pendiente</b><button class="light miniBtn" onclick="jumpToWeekV3('${r.date}')">Ver</button></div>`).join('') : '<div class="placeholder smallPlaceholder">Sin semanas pendientes.</div>'}</div>`;
}
function toggleVehicleCardV3(vehicleId) {
  const body = document.querySelector(`[data-card-body="${CSS.escape(vehicleId)}"]`); if (body) body.classList.toggle('collapsed');
}
function uberFormV3(vehicleId) { return document.querySelector(`[data-uber-form="${CSS.escape(vehicleId)}"]`); }
function fieldV3(form, name) { return form ? form.querySelector(`[data-field="${name}"]`) : null; }

async function readUberScreenshotV3(vehicleId) {
  const form = uberFormV3(vehicleId), fileInput = fieldV3(form,'screenshot'), status = fieldV3(form,'ocrStatus');
  const file = fileInput && fileInput.files && fileInput.files[0]; if (!file) return alert('Seleccioná primero el screenshot de Uber.');
  if (!window.Tesseract) { status.textContent = 'No cargó el lector automático. Podés ingresar los montos manualmente.'; return; }
  status.textContent = 'Leyendo screenshot…';
  try {
    const result = await Tesseract.recognize(file, 'spa+eng', { logger: m => { if (m.status === 'recognizing text') status.textContent = `Leyendo screenshot… ${Math.round((m.progress||0)*100)}%`; } });
    const text = result && result.data ? result.data.text : '';
    const parsed = parseUberOCRV3(text);
    if (parsed.gains !== null) fieldV3(form,'gains').value = parsed.gains;
    if (parsed.returns !== null) fieldV3(form,'returns').value = parsed.returns;
    if (parsed.adjustments !== null) fieldV3(form,'adjustments').value = parsed.adjustments;
    if (parsed.cash !== null) fieldV3(form,'cash').value = Math.abs(parsed.cash);
    fieldV3(form,'ocrText').value = text;
    status.textContent = 'Lectura lista. Revisá los cuatro montos antes de guardar.';
  } catch (e) { status.textContent = 'No pude leerlo automáticamente. Ingresá los montos manualmente.'; }
}
function parseUberOCRV3(text) {
  const lines = String(text||'').split(/\n+/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  function find(labelParts, exclusions=[]) {
    for (let i=0;i<lines.length;i++) {
      const low=lines[i].toLowerCase();
      if(labelParts.every(p=>low.includes(p)) && exclusions.every(p=>!low.includes(p))){
        const segment=[lines[i],lines[i+1]||'',lines[i+2]||''].join(' '), m=segment.match(/-?\s*[₡$]?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})|-?\s*\d+(?:[.,]\d{1,2})?/);
        if(m)return parseCRAmountV3(m[0]);
      }
    }
    return null;
  }
  return {
    gains: find(['ganancias','totales']),
    returns: find(['devoluciones','gastos']),
    adjustments: find(['ajustes','periodos','anteriores']),
    cash: find(['ganancias'],['totales','netas'])
  };
}
function parseCRAmountV3(raw) {
  let s=String(raw||'').replace(/[₡$\s]/g,''); const neg=s.includes('-'); s=s.replace(/-/g,'');
  if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',','.');
  else if(s.includes(',')) s=s.replace(',','.');
  const n=parseFloat(s.replace(/[^0-9.]/g,'')); return isFinite(n)?(neg?-n:n):null;
}

async function saveUberWeekV3(vehicleId) {
  const form=uberFormV3(vehicleId); if(!form)return;
  const date=fieldV3(form,'targetDate').value; if(!date)return alert('Seleccioná la semana que querés actualizar.');
  const payload={
    sessionToken:sessionStorage.getItem(SESSION_KEY),vehicleId,fechaProgramada:date,
    gananciasTotales:Number(fieldV3(form,'gains').value||0),devolucionesGastos:Number(fieldV3(form,'returns').value||0),
    ajustesAnteriores:Number(fieldV3(form,'adjustments').value||0),efectivoChofer:Math.abs(Number(fieldV3(form,'cash').value||0)),ocrTexto:fieldV3(form,'ocrText').value||''
  };
  if(!confirm(`Guardar actualización Uber para ${fmtShort(date)}?`))return;
  try{
    const r=await backend('saveUberWeek',payload); if(!r.ok)throw new Error(r.message||'No se pudo guardar');
    await loadProductionData(); await loadPlanDashboardV3(true); renderAll();
    alert(`Semana guardada. Disponible Uber: ${money(r.rawAvailable)} · pendiente de esa cuota: ${money(r.targetPending)}.`);
  }catch(e){alert(e.message||'Error guardando Uber');}
}

function jumpToWeekV3(date) {
  const base=nextOrSameTuesday(crTodayUTC()), target=nextOrSameTuesday(parseDate(date)); weekOffset=Math.round((target-base)/604800000); goToView('semana'); renderWeek(); renderVehicles();
}
function jumpToVehicleWeekV3(vehicleId) { weekOffset=0; goToView('semana'); renderWeek(); }
function openUberFromWeekV3(vehicleId) { goToView('uber'); loadPlanDashboardV3().then(()=>setTimeout(()=>{const el=$('controlCard_'+safeIdV3(vehicleId));if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},80)); }

function downloadUberReceiptV3(vehicleId) {
  const v=contractVehicles.find(x=>x.id===vehicleId),dash=dashboardCardV3(vehicleId); if(!v||!dash||!dash.summary||!dash.summary.length)return alert('Primero cargá el cuadro actualizado.');
  const rows=dash.summary, canvas=document.createElement('canvas'); canvas.width=900; canvas.height=650; const c=canvas.getContext('2d');
  c.fillStyle='#090909';c.fillRect(0,0,900,650);c.fillStyle='#d7b928';c.fillRect(0,0,900,105);
  c.fillStyle='#171200';c.font='700 34px Arial';c.fillText(v.name,42,53);c.font='20px Arial';c.fillText(`${v.driver||'Chofer'} · ${v.plate||'Sin placa'}`,42,84);
  let y=140;rows.forEach((r,i)=>{c.fillStyle=i===rows.length-1?'#1c1c1c':'#111';c.fillRect(40,y,820,68);c.fillStyle='#ddd';c.font='22px Arial';c.fillText(String(r[0]||''),65,y+42);c.fillStyle=i===rows.length-1?'#d7b928':'#fff';c.font='700 25px Arial';c.textAlign='right';c.fillText(String(r[1]||''),835,y+42);c.textAlign='left';y+=76;});
  c.fillStyle='#888';c.font='16px Arial';c.fillText('Comprobante generado desde Base de Datos Flotilla',40,625);
  const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download=`${safeFileV3(v.name)}_Semana_${safeFileV3(String(rows[0]&&rows[0][1]||''))}.png`;a.click();
}

function renderConfigV3() {
  const body=$('configVehiclesBody'); if(!body)return;
  body.innerHTML=contractVehicles.map(v=>`<tr data-config-row="${v.id}">
    <td><input data-c="name" value="${escapeAttrV3(v.name)}"></td><td><input data-c="plate" value="${escapeAttrV3(v.plate)}"></td><td><input data-c="driver" value="${escapeAttrV3(v.driver||'')}"></td>
    <td><select data-c="type"><option value="" ${!v.paymentType?'selected':''}>Sin configurar</option><option value="UBER" ${v.paymentType==='UBER'?'selected':''}>Uber</option><option value="PERSONAL" ${v.paymentType==='PERSONAL'?'selected':''}>Uso personal</option></select></td>
    <td><input data-c="tab" value="${escapeAttrV3(v.planSheetTab||'')}" placeholder="Ej. S1 Pro"></td>
    <td><select data-c="state"><option value="ACTIVO" ${v.operationStatus==='ACTIVO'?'selected':''}>Activo</option><option value="FINALIZADO" ${v.operationStatus==='FINALIZADO'?'selected':''}>Finalizado</option><option value="CANCELADO" ${v.operationStatus==='CANCELADO'?'selected':''}>Cancelado</option></select></td>
    <td style="text-align:center"><input data-c="integration" type="checkbox" ${v.planIntegrationActive?'checked':''} style="width:auto"></td>
    <td><button class="dark miniBtn" onclick="saveVehicleConfigV3('${v.id}')">Guardar</button></td>
  </tr>`).join('');
}
function openConfigV3(){renderConfigV3();$('configModal').classList.add('show');}
function closeConfigV3(){$('configModal').classList.remove('show');}
async function saveVehicleConfigV3(vehicleId){
  const row=document.querySelector(`[data-config-row="${CSS.escape(vehicleId)}"]`);if(!row)return;
  const get=n=>row.querySelector(`[data-c="${n}"]`),payload={sessionToken:sessionStorage.getItem(SESSION_KEY),vehicleId,nombre:get('name').value.trim(),placa:get('plate').value.trim(),chofer:get('driver').value.trim(),tipoCobro:get('type').value,planSheetTab:get('tab').value.trim(),operacionEstado:get('state').value,planIntegracionActiva:get('integration').checked};
  try{const r=await backend('updateVehicleConfig',payload);if(!r.ok)throw new Error(r.message||'No se pudo guardar');await loadProductionData();planDashboardLoadedV3=false;renderAll();renderConfigV3();}
  catch(e){alert(e.message||'Error guardando configuración');}
}

const goToViewV22=goToView;
goToView=function(id){goToViewV22(id);window.goToView=goToView;if(id==='uber')loadPlanDashboardV3();};
const renderAllV22=renderAll;
renderAll=function(){renderAllV22();renderUberV3();};

function initV3UI(){
  if($('savePaymentButton'))$('savePaymentButton').onclick=savePaymentV3;
  if($('cancelPaymentButton'))$('cancelPaymentButton').onclick=closePaymentV3;
  if($('paymentAmount'))$('paymentAmount').addEventListener('keydown',e=>{if(e.key==='Enter')savePaymentV3();});
  if($('configButton'))$('configButton').onclick=openConfigV3;
  if($('closeConfigButton'))$('closeConfigButton').onclick=closeConfigV3;
}

document.addEventListener('DOMContentLoaded',initV3UI);
window.openPaymentV3=openPaymentV3;
window.removeLastPaymentV3=removeLastPaymentV3;
window.openUberFromWeekV3=openUberFromWeekV3;
window.toggleVehicleCardV3=toggleVehicleCardV3;
window.readUberScreenshotV3=readUberScreenshotV3;
window.saveUberWeekV3=saveUberWeekV3;
window.downloadUberReceiptV3=downloadUberReceiptV3;
window.jumpToWeekV3=jumpToWeekV3;
window.jumpToVehicleWeekV3=jumpToVehicleWeekV3;
window.saveVehicleConfigV3=saveVehicleConfigV3;
window.goToView=goToView;

function safeIdV3(s){return String(s||'').replace(/[^a-zA-Z0-9_-]/g,'_');}
function safeFileV3(s){return String(s||'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'');}
function escapeHtmlV3(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escapeAttrV3(s){return escapeHtmlV3(s);}
