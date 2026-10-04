'use strict';

/* Base de Datos Flotilla · V3.0
   Extensión de producción: abonos parciales, configuración operativa,
   Uber/Plan de pagos, OCR opcional y comprobantes PNG.
*/
let uberWeeksV3 = [];
let planDashboardV3 = [];
let selectedPaymentV3 = null;
let reversedMovements = [];
let backendCapabilities = {};
let planDashboardLoadedV3 = false;
let planDashboardRequestV3 = null;
let planDashboardErrorV3 = '';

const loadProductionDataV22 = loadProductionData;

function openPaymentRowsV3(vehicleId) {
  const v = contractVehicles.find(x => x.id === vehicleId);
  const current = rowsForCurrentWeek().filter(r => r.vehicleId === vehicleId);
  const late = getLateRows().filter(r => r.vehicleId === vehicleId);
  const map = new Map();
  [...late, ...current].forEach(r => map.set(r.key, r));

  // El plan público puede conocer atrasos anteriores al inicio de esta app.
  // Se incorporan como cuotas abiertas sin inventar pagos internos.
  const dash = dashboardCardV3(vehicleId);
  if (v && dash && Array.isArray(dash.legacyPending)) {
    dash.legacyPending.forEach(p => {
      const date = normalizeSheetDate(p.date); if (!date) return;
      const key = paymentKey(vehicleId, date), st = getPaymentState(vehicleId, date), amount = Number(p.quota || v.weekly || 0);
      if (!map.has(key)) map.set(key, {
        planId:key, vehicleId, vehicle:v.name, date, visualDate:date, amount,
        received:Number(st.received || 0), realDate:st.realDate || '', status:st.status || 'Pendiente',
        pagoId:st.pagoId || '', key, source:'legacy', legacyWeek:Number(p.week || 0)
      });
    });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function paymentStatusV3(row) {
  const pending = row.historicalApplied ? 0 : Math.max(0, Number(row.amount || 0) - Number(row.received || 0));
  return { pending, paid: pending <= .01, partial: Number(row.received || 0) > 0 && pending > .01 };
}
function duePendingWeekV3(row, today = isoDate(crTodayUTC())) {
  return row.date < today && paymentStatusV3(row).pending > .01;
}

// Une atrasos históricos del Plan de pagos con los atrasos nacidos en esta app.
const getLateRowsV22 = getLateRows;
getLateRows = function () {
  const base = getLateRowsV22();
  const map = new Map(base.map(r => [r.key, r]));
  const cutoff = weekDate();
  planDashboardV3.forEach(card => {
    const v = contractVehicles.find(x => x.id === card.vehicleId);
    if (!v || !Array.isArray(card.legacyPending)) return;
    card.legacyPending.forEach(p => {
      const date = normalizeSheetDate(p.date);
      if (!date || parseDate(date) >= cutoff) return;
      const key = paymentKey(v.id, date), st = getPaymentState(v.id, date);
      const amount = Number(p.quota || v.weekly || 0), missing = Math.max(0, amount - Number(st.received || 0));
      if (missing <= .01) return;
      const weeksLate = Math.max(1, Math.ceil((cutoff - parseDate(date)) / 604800000));
      map.set(key, {
        planId:key, vehicleId:v.id, vehicle:v.name, date, amount, iva:amount * IVA_RATE, insurance:WEEKLY_INSURANCE,
        received:Number(st.received || 0), realDate:st.realDate || '', status:st.status || 'Pendiente', pagoId:st.pagoId || '',
        missing, weeksLate, key, source:'legacy'
      });
    });
  });
  return [...map.values()].sort((a,b) => a.date.localeCompare(b.date));
};

// Finalizado/cancelado deja de generar obligaciones nuevas, pero conserva historial.
allScheduledEventsBetween = function(start, end) {
  return contractVehicles
    .filter(v => !['FINALIZADO','CANCELADO'].includes(v.operationStatus || 'ACTIVO'))
    .flatMap(v => scheduledEventsForVehicle(v, start, end))
    .sort((a,b) => a.date.localeCompare(b.date));
};

const renderWeekV22 = renderWeek;
renderWeek = function () {
  renderWeekV22();
  const rows = rowsForCurrentWeek();
  $('weeklyIncomeBody').innerHTML = rows.length ? rows.map(r => {
    const s = paymentStatusV3(r);
    const label = r.historicalApplied ? 'Aplicado' : s.paid ? 'Pagado' : s.partial ? 'Parcial' : 'Pendiente';
    return `<tr>
      <td><span class="statuspill ${s.paid ? 'ok' : s.partial ? 'partial' : 'pending'}">${label}</span></td>
      <td>${escapeHtmlV3(r.vehicle)}${r.merged ? ' <span class="statuspill pending">fecha especial</span>' : ''}</td>
      <td>${fmtShort(r.date)}</td><td>${money(r.amount)}</td><td>${money(r.received)}</td><td><b>${money(s.pending)}</b></td><td>${fmtShort(r.realDate)}</td>
      <td><div class="rowActions"><button class="dark miniBtn" ${r.historicalApplied ? 'disabled' : ''} onclick="openPaymentV3('${encodeURIComponent(r.key)}')">${r.historicalApplied ? 'Aplicado en plan' : s.paid ? 'Ver pagos' : 'Abonar'}</button>${r.received > 0 ? `<button class="light miniBtn" onclick="removeLastPaymentV3('${encodeURIComponent(r.key)}')">Deshacer último</button>` : ''}${isUberV3(r.vehicleId) ? `<button class="light miniBtn" onclick="openUberFromWeekV3('${r.vehicleId}')">Ver Uber</button>` : ''}</div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="8">No hay pagos programados para esta semana.</td></tr>';

  const lateRows = getLateRows();
  $('lateList').innerHTML = lateRows.length ? lateRows.map(r => {
    const received = Number(r.received || 0);
    return `<div class="lateItem">
      <div><b>${escapeHtmlV3(r.vehicle)} · pendiente ${money(r.missing)}</b><div class="lateMeta">Debía pagar ${fmtShort(r.date)} · recibido ${money(received)} · ${r.weeksLate} semana${r.weeksLate === 1 ? '' : 's'} de atraso</div></div>
      <button class="dark" onclick="openPaymentV3('${encodeURIComponent(r.key)}')">Abonar</button>
    </div>`;
  }).join('') : planDashboardLoadedV3 ? '<div class="placeholder">No hay ingresos atrasados.</div>' : '';
  if (!planDashboardLoadedV3) $('lateList').insertAdjacentHTML('afterbegin',
    `<div class="note">${escapeHtmlV3(planDashboardErrorV3 || 'Actualizando pagos pendientes…')}</div>`);
};

function findPaymentRowV3(key) {
  const parts=String(key||'').split('|'), vehicleId=parts[0]||'';
  return openPaymentRowsV3(vehicleId).find(r => r.key === key) || [...getLateRows(), ...rowsForCurrentWeek()].find(r => r.key === key) || null;
}
function openPaymentV3(encodedKey) {
  const key = decodeURIComponent(encodedKey);
  const row = findPaymentRowV3(key);
  if (!row) return alert('No encontré esa cuota. Recargá la semana e intentá nuevamente.');
  selectedPaymentV3 = row;
  const s = paymentStatusV3(row);
  $('savePaymentButton').disabled = s.paid;
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
  if (pending <= .01) return alert('Esta cuota ya está completamente pagada.');
  if (amount > pending + .01) return alert(`El máximo que falta de esta cuota es ${money(pending)}. Si existe dinero adicional, registralo en la siguiente semana correspondiente.`);
  $('savePaymentButton').disabled = true;
  const beforeCentral = centralFundingSnapshot();
  try {
    const after = st.received + amount;
    const res = await backend('markPayment', {
      sessionToken: sessionStorage.getItem(SESSION_KEY), planId: row.planId || row.key, vehicleId: row.vehicleId,
      fechaProgramada: row.date, fechaReal: isoDate(crTodayUTC()), montoEsperado: row.amount, montoRecibido: amount,
      estado: after >= row.amount - .01 ? 'PAGADO' : 'PARCIAL', nota: $('paymentNote').value.trim(), origen: 'MANUAL'
    });
    if (!res.ok) throw new Error(res.message || 'No se pudo registrar el abono');
    closePaymentV3(); await loadProductionData(); renderAll();
    window.refreshPlanInBackgroundV34?.();
    await offerCentralFunding(beforeCentral);
  } catch (e) { alert(e.message || 'Error registrando el abono'); }
  finally { $('savePaymentButton').disabled = false; }
}
async function removeLastPaymentV3(encodedKey) {
  const st=paymentState[decodeURIComponent(encodedKey)];
  const last=st?.movements?.filter(m=>String(m.origin).toUpperCase()==='MANUAL').slice(-1)[0];
  if(!last)return alert('Corregí este movimiento desde Uber / Plan de pagos.');
  return reverseMovement(last.pagoId);
}

function isUberV3(vehicleId) {
  const v = contractVehicles.find(x => x.id === vehicleId);
  return !!v && v.paymentType === 'UBER';
}

async function loadPlanDashboardV3(force = false) {
  if (planDashboardRequestV3) return planDashboardRequestV3;
  if (planDashboardLoadedV3 && !force) { renderUberV3(); return true; }
  const box = $('uberCards');
  if (box && $('uber')?.classList.contains('active')) box.innerHTML = '<div class="placeholder">Cargando cuentas…</div>';
  planDashboardRequestV3 = backend('getPlanDashboard', { sessionToken: sessionStorage.getItem(SESSION_KEY) });
  try {
    const r = await planDashboardRequestV3;
    if (!r.ok) throw new Error(r.message || 'No se pudo cargar Plan de pagos');
    planDashboardV3 = Array.isArray(r.cards) ? r.cards : [];
    planDashboardLoadedV3 = true;
    planDashboardErrorV3 = '';
    renderWeek(); renderSummary(); renderVehicles();
    if ($('uber')?.classList.contains('active')) renderUberV3();
    return true;
  } catch (e) {
    planDashboardErrorV3 = 'No se pudieron actualizar los pagos pendientes. Abrí Uber / Plan de pagos y pulsá Actualizar para reintentar.';
    if (box) box.innerHTML = `<div class="placeholder bad">${escapeHtmlV3(e.message || 'No se pudo cargar el backend V3.')}</div>`;
    renderWeek(); renderSummary();
    return false;
  } finally {
    planDashboardRequestV3 = null;
  }
}
function dashboardCardV3(vehicleId) { return planDashboardV3.find(c => c.vehicleId === vehicleId) || null; }
function renderUberV3() {
  const box = $('uberCards'); if (!box) return;
  const vehicles = contractVehicles.filter(v => !['FINALIZADO','CANCELADO'].includes(v.operationStatus || 'ACTIVO'));
  if (!vehicles.length) { box.innerHTML = '<div class="placeholder">No hay vehículos activos.</div>'; return; }
  box.innerHTML = vehicles.map(v => {
    const open = openPaymentRowsV3(v.id), pending = open.filter(r => duePendingWeekV3(r)), pendingAmt = pending.reduce((s,r)=>s+paymentStatusV3(r).pending,0), dash = dashboardCardV3(v.id);
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
  const pending = rows.filter(r => duePendingWeekV3(r));
  return `<div class="personalCompact"><div class="note">Uso personal: no se muestra el cuadro de Uber.</div>${pending.length ? pending.map(r=>`<div class="pendingWeekLine"><span>${fmtShort(r.date)} · cuota ${money(r.amount)}</span><b>Pendiente ${money(paymentStatusV3(r).pending)}</b><button class="light miniBtn" onclick="jumpToWeekV3('${r.date}')">Ver semana</button></div>`).join('') : '<div class="placeholder smallPlaceholder">No hay semanas pendientes.</div>'}</div>`;
}
function uberBodyV3(v, dash, rows) {
  const currentDate=isoDate(operationalTuesday()),saved=uberWeeksV3.find(u=>u.vehicleId===v.id&&u.date===currentDate),carry=uberCarryV3(v,currentDate);
  const pendingWeeks = rows.filter(r => duePendingWeekV3(r));
  const summary=[['Semana #',uberWeekNumberV3(v,currentDate)+' · '+fmtShort(currentDate)],['Ganancias Totales',saved?money(saved.gains):'—'],['Reembolsos',money(saved?saved.reimbursements:carry)],['Efectivo',saved?money(saved.cash):'—'],['Cuota',money(saved?.quota || v.weekly)],['Saldo Semana',saved?money(saved.balance):'—']];
  const targetRows = [...new Map([...rows, ...rowsForTuesday(operationalTuesday()).filter(r=>r.vehicleId===v.id), ...uberWeeksV3.filter(u=>u.vehicleId===v.id).map(u=>({date:u.date,amount:u.quota,received:getPaymentState(v.id,u.date).received}))].map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  const currentWeekIso = isoDate(operationalTuesday());
  const preferredDate = targetRows.some(r => r.date === currentWeekIso) ? currentWeekIso : (targetRows.length ? targetRows[targetRows.length - 1].date : '');
  const targetOptions = targetRows.map(r => `<option value="${r.date}" ${r.date === preferredDate ? 'selected' : ''}>Semana ${uberWeekNumberV3(v,r.date)} · ${fmtShort(r.date)} · ${paymentStatusV3(r).pending > .01 ? 'pendiente '+money(paymentStatusV3(r).pending) : 'pagada'}</option>`).join('');
  return `<div class="uberLayout">
    <div>
      <div class="legacySummary" id="legacySummary_${safeIdV3(v.id)}">${summary.map((r,i)=>`<div class="legacyRow ${i===5?'legacyBalance':''}"><span>${escapeHtmlV3(r[0]||'')}</span><b>${escapeHtmlV3(String(r[1]||''))}</b></div>`).join('')}</div>
      <div class="actions"><button class="light miniBtn" onclick="downloadUberReceiptV3('${v.id}')">Capturar cuadro</button><button class="light miniBtn" onclick="jumpToVehicleWeekV3('${v.id}')">Ir a Semana actual</button></div>
    </div>
    <div class="uberForm" data-uber-form="${v.id}"><div class="note">Vigente: Semana ${uberWeekNumberV3(v,currentWeekIso)} · ${fmtShort(currentWeekIso)}<br>Arrastre: ${money(uberCarryV3(v,currentWeekIso))}</div>
      <label>Semana a actualizar</label><select data-field="targetDate">${targetOptions || '<option value="">No hay cuota visible</option>'}</select>
      <label>Screenshot de Uber</label><input data-field="screenshot" type="file" accept="image/*">
      <div class="actions"><button class="light miniBtn" onclick="readUberScreenshotV3('${v.id}')">Leer screenshot</button></div>
      <div data-field="ocrStatus" class="miniNote">La lectura automática es una ayuda; confirmá los montos antes de guardar.</div>
      <details class="miniNote"><summary>Ver texto leído del screenshot</summary><pre data-field="ocrDebug" style="white-space:pre-wrap"></pre></details>
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
  <div class="pendingWeeks"><h3>Semanas Uber registradas</h3>${uberWeeksV3.filter(u=>u.vehicleId===v.id).sort((a,b)=>b.date.localeCompare(a.date)).map(u=>`<div class="movementRow"><span>Semana ${u.week} · ${fmtShort(u.date)}</span><b>${escapeHtmlV3(u.status)}</b></div>`).join('')}<h3>Semanas pendientes</h3>${pendingWeeks.length ? pendingWeeks.map(r=>`<div class="pendingWeekLine"><span>${fmtShort(r.date)} · ${money(r.received)} de ${money(r.amount)}</span><b>${money(paymentStatusV3(r).pending)} pendiente</b><button class="light miniBtn" onclick="jumpToWeekV3('${r.date}')">Ver</button></div>`).join('') : '<div class="placeholder smallPlaceholder">Sin semanas pendientes.</div>'}</div>`;
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
    fieldV3(form,'ocrDebug').textContent = text;
    const missing=Object.entries(parsed).filter(([,value])=>value===null).map(([key])=>({gains:'ganancias',returns:'devoluciones',adjustments:'ajustes',cash:'efectivo'})[key]);
    status.textContent = missing.length ? 'No se detectó: '+missing.join(', ')+'. Completá esos campos y revisá los montos.' :
      parsed.inferred ? 'El lector corrigió cifras usando ganancias netas. Confirmá los cuatro montos antes de guardar.' :
      'Lectura lista. Revisá los cuatro montos antes de guardar.';
  } catch (e) { status.textContent = 'No pude leerlo automáticamente. Ingresá los montos manualmente.'; }
}

function parseUberOCRV3(text) {
  const lines = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .split(/\n+/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  function amountOnLine(line, standalone = false) {
    // A bare "20" inside an OCR-corrupted word such as "perio20s" is not money.
    const matches = [...line.matchAll(/(^|[^\p{L}\d])([-−]?\s*[\p{Sc}]?\s*\d(?:[\d\s.,]*\d)?)(?=$|[^\p{L}\d])/gu)];
    for (const match of matches.reverse()) {
      const raw = match[2].trim();
      const looksMonetary = /[\p{Sc},.]|\d\s+\d{3}\b/u.test(raw);
      if (!looksMonetary && !(standalone && /^[-−]?\s*0$/.test(raw))) continue;
      const value = parseCRAmountV3(raw);
      if (value !== null) return value;
    }
    return null;
  }
  function find(label) {
    for (let i=0; i<lines.length; i++) {
      const match = lines[i].match(label);
      if (!match) continue;
      const sameLine = amountOnLine(lines[i].slice(match[0].length));
      if (sameLine !== null) return sameLine;
      const next = lines[i+1] || '';
      if (!/[\p{L}]/u.test(next)) return amountOnLine(next, true);
    }
    return null;
  }
  const gains = find(/^ganancias\s+totales\b/i);
  let returns = find(/^devoluc\S*\s+y\s+gastos\b/i);
  let adjustments = find(/^ajustes\s+(?:de\s+)?(?:peri\S*|semanas)\s+anteriores\b/i);
  const net = find(/^ganancias\s+netas\b/i);
  const deducted = find(/^ganancias\b(?!\s+(?:totales|netas)\b)/i);
  const directCash = find(/^efectivo(?:\s+al\s+chofer|\s+cobrado)?\b/i);
  let cash = directCash !== null ? Math.abs(directCash) : deducted !== null ? Math.abs(deducted) : null;
  let inferred = false;
  // OCR can mistake the minus/currency glyph for a leading digit. Recover
  // only when the remaining digits reconcile exactly with the net amount.
  if (gains !== null && net !== null && cash !== null &&
      (returns === null || adjustments === null)) {
    const expected = Math.round((gains + (returns || 0) + (adjustments || 0) - net) * 100) / 100;
    const zeroAdjustment = Math.round((gains + (returns || 0) - net) * 100) / 100;
    const cents = value => String(Math.round(value * 100));
    if (expected > 0 && cash > expected && cents(cash).endsWith(cents(expected))) {
      cash = expected;
      if (returns === null) returns = 0;
      if (adjustments === null) adjustments = 0;
      inferred = true;
    } else if (adjustments !== null && adjustments !== 0 && zeroAdjustment > 0 &&
               cash > zeroAdjustment && cents(cash).endsWith(cents(zeroAdjustment))) {
      // A spurious OCR amount on the adjustments line cannot reconcile with
      // the total, the net and the cash suffix; treat it as a missed zero.
      cash = zeroAdjustment;
      adjustments = 0;
      if (returns === null) returns = 0;
      inferred = true;
    }
  }
  if (gains !== null && returns !== null && adjustments !== null && net !== null) {
    const fromNet = Math.round((gains + returns + adjustments - net) * 100) / 100;
    if (cash === null && fromNet >= -0.01) cash = Math.max(0,fromNet);
    else if (cash !== null && Math.abs(cash - fromNet) > 1) cash = null;
  }
  const result = {gains, returns, adjustments, cash};
  Object.defineProperty(result,'inferred',{value:inferred});
  return result;
}
function parseCRAmountV3(raw) {
  let s=String(raw || '').replace(/[₡$\s]/g,'').replace('−','-');
  if (!/^-?\d[\d.,]*$/.test(s)) return null;
  const last=Math.max(s.lastIndexOf(','),s.lastIndexOf('.'));
  const decimal=last>=0 && s.length-last-1<=2;
  s=decimal?s.slice(0,last).replace(/[.,]/g,'')+'.'+s.slice(last+1):s.replace(/[.,]/g,'');
  const n=Number(s); return Number.isFinite(n)?n:null;
}
function uberWeekNumberV3(v,date) {
  const row=planPayments.find(p=>p.vehicleId===v.id&&p.date===date) || uberWeeksV3.find(p=>p.vehicleId===v.id&&p.date===date);
  if(row?.week)return row.week;
  const anchor=uberWeeksV3.filter(p=>p.vehicleId===v.id&&p.week).sort((a,b)=>b.date.localeCompare(a.date))[0];
  return anchor?anchor.week+Math.round((parseDate(date)-parseDate(anchor.date))/604800000):v.start?Math.floor((parseDate(date)-parseDate(v.start))/604800000)+1:'—';
}
function uberCarryV3(v,date) {
  const card=dashboardCardV3(v.id);
  const debts=(card?.legacyPending || []).filter(p=>p.date<date).reduce((sum,p)=>sum+Math.max(0,Number(p.quota || v.weekly)-getPaymentState(v.id,p.date).received),0);
  const summaryWeek=Number(card?.summary?.[0]?.[1] || 0),anchor=planPayments.find(p=>p.vehicleId===v.id&&p.week===summaryWeek) || uberWeeksV3.find(p=>p.vehicleId===v.id&&p.week===summaryWeek);
  const boxBalance=parseCRAmountV3(card?.summary?.[5]?.[1]);
  if(anchor?.date<date&&boxBalance<0)return Math.min(-debts,boxBalance);
  if(debts>.01)return -debts;
  const previous=uberWeeksV3.filter(p=>p.vehicleId===v.id&&p.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  return Math.min(0,previous?.balance || 0);
}

async function saveUberWeekV3(vehicleId) {
  if(!backendCapabilities.safeUber)return alert('El Apps Script activo debe actualizarse con Code.gs antes de guardar Uber.');
  const form=uberFormV3(vehicleId); if(!form)return;
  const date=fieldV3(form,'targetDate').value; if(!date)return alert('Seleccioná la semana que querés actualizar.');
  if(['gains','cash'].some(k=>!fieldV3(form,k).value.trim()))return alert('Completá ganancias y efectivo; ingresá 0 si corresponde.');
  const payload={
    sessionToken:sessionStorage.getItem(SESSION_KEY),vehicleId,fechaProgramada:date,
    gananciasTotales:Number(fieldV3(form,'gains').value||0),devolucionesGastos:Number(fieldV3(form,'returns').value||0),
    ajustesAnteriores:Number(fieldV3(form,'adjustments').value||0),efectivoChofer:Math.abs(Number(fieldV3(form,'cash').value||0)),ocrTexto:fieldV3(form,'ocrText').value||''
  };
  if(!confirm(`Guardar actualización Uber para ${fmtShort(date)}?`))return;
  const beforeCentral=centralFundingSnapshot();
  try{
    const r=await backend('saveUberWeek',payload); if(!r.ok)throw new Error(r.message||'No se pudo guardar');
    await loadProductionData(); await loadPlanDashboardV3(true); renderAll();
    alert(`Semana guardada. Disponible Uber: ${money(r.rawAvailable)} · saldo arrastrado: ${money(r.carryIn||0)} · pendiente de esa cuota: ${money(r.targetPending)}${Number(r.unapplied||0)>0?' · sobrante no arrastrado: '+money(r.unapplied):''}.`);
    await offerCentralFunding(beforeCentral);
  }catch(e){alert(e.message||'Error guardando Uber');}
}

function jumpToWeekV3(date) {
  const base=operationalTuesday(), target=operationalTuesday(parseDate(date)); weekOffset=Math.round((target-base)/604800000); goToView('semana'); renderWeek(); renderVehicles();
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
  try{const r=await backend('updateVehicleConfig',payload);if(!r.ok)throw new Error(r.message||'No se pudo guardar');await loadProductionData();renderAll();renderConfigV3();window.refreshPlanInBackgroundV34?.();}
  catch(e){alert(e.message||'Error guardando configuración');}
}

const goToViewV22=goToView;
goToView=function(id){goToViewV22(id);window.goToView=goToView;if(id==='uber')loadPlanDashboardV3();};
const renderAllV22=renderAll;
renderAll=function(){renderAllV22();renderUberV3();renderMovementHistory();};
const renderSummaryV22=renderSummary;
renderSummary=function(){
  renderSummaryV22();
  if(!planDashboardLoadedV3) {
    if(!getLateRows().length) $('sumLateRows').innerHTML='';
    $('sumLateRows').insertAdjacentHTML('afterbegin',
      `<div class="note">${escapeHtmlV3(planDashboardErrorV3 || 'Actualizando pagos pendientes…')}</div>`);
  }
};

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


/* V3.1 · Danny first, abonos desde Uber, gastos editables */
const renderUberV30 = renderUberV3;
renderUberV3 = function () {
  renderUberV30();
  const box = $('uberCards');
  if (!box) return;

  // Danny/S1 siempre primero porque es la cuenta operativa que se actualiza con mayor frecuencia.
  const danny = contractVehicles.find(v => String(v.driver || '').trim().toLowerCase() === 'danny');
  if (danny) {
    const card = $('controlCard_' + safeIdV3(danny.id));
    if (card) box.prepend(card);
  }

  // Cada semana pendiente puede abonarse directamente con el mismo modal de Semana actual.
  contractVehicles.forEach(v => {
    const card = $('controlCard_' + safeIdV3(v.id));
    if (!card) return;
    card.querySelectorAll('.pendingWeekLine').forEach(line => {
      if (line.querySelector('.quickAbonoV31')) return;
      const jump = [...line.querySelectorAll('button')].find(btn => /jumpToWeekV3/.test(btn.getAttribute('onclick') || ''));
      if (!jump) return;
      const match = (jump.getAttribute('onclick') || '').match(/jumpToWeekV3\('([^']+)'\)/);
      if (!match) return;
      const date = match[1];
      const row = openPaymentRowsV3(v.id).find(r => r.date === date && paymentStatusV3(r).pending > .01);
      if (!row) return;
      const abono = document.createElement('button');
      abono.className = 'dark miniBtn quickAbonoV31';
      abono.type = 'button';
      abono.textContent = 'Abonar';
      abono.onclick = () => openPaymentV3(encodeURIComponent(row.key));
      jump.textContent = 'Ver semana';
      line.appendChild(abono);
    });
  });
};

function moveLateBoxV31() {
  const section = $('semana'), late = $('lateBox');
  if (!section || !late) return;
  const cards = [...section.children].filter(el => el.classList && el.classList.contains('card') && el.id !== 'lateBox');
  if (cards.length < 2) return;
  late.classList.add('card');
  late.style.marginTop = '';
  cards[1].after(late);
}

function rawAccountTypeV31(type) {
  return type === 'automatic' ? 'AUTOMATICO_PLAN' : type === 'remainder' ? 'REMANENTE' : 'SEMANAL';
}
function rawPriorityV31(priority) {
  return priority === 'critical' ? 'CRITICA' : priority === 'medium' ? 'MEDIA' : 'BAJA';
}

renderExpenseConfig = function () {
  const body = $('expenseConfigBody');
  if (!body) return;
  body.innerHTML = expenseConfig.slice().sort((a, b) => a.order - b.order).map(e => {
    const rawType = rawAccountTypeV31(e.type), rawPriority = rawPriorityV31(e.priority);
    const amountDisabled = rawType !== 'SEMANAL' ? 'disabled' : '';
    return `<tr data-expense-row="${escapeAttrV3(e.id)}">
      <td><input data-e="order" type="number" min="1" step="1" value="${Number(e.order || 0)}" style="width:70px"></td>
      <td><input data-e="name" value="${escapeAttrV3(e.name)}" style="min-width:160px"></td>
      <td><select data-e="type"><option value="SEMANAL" ${rawType==='SEMANAL'?'selected':''}>Semanal</option><option value="AUTOMATICO_PLAN" ${rawType==='AUTOMATICO_PLAN'?'selected':''}>Automático plan</option><option value="REMANENTE" ${rawType==='REMANENTE'?'selected':''}>Remanente</option></select></td>
      <td><input data-e="amount" type="number" min="0" step="500" value="${Number(e.amount || 0)}" ${amountDisabled} style="width:120px"><div class="miniNote">${escapeHtmlV3(e.rule)}</div></td>
      <td><select data-e="priority"><option value="CRITICA" ${rawPriority==='CRITICA'?'selected':''}>Crítica</option><option value="MEDIA" ${rawPriority==='MEDIA'?'selected':''}>Media</option><option value="BAJA" ${rawPriority==='BAJA'?'selected':''}>Baja</option></select></td>
      <td><div class="expenseDatesV31"><input data-e="from" type="date" value="${escapeAttrV3(e.from || '')}"><span>→</span><input data-e="to" type="date" value="${escapeAttrV3(e.to || '')}"></div><button class="dark miniBtn" type="button" onclick="saveExpenseConfigV31('${escapeAttrV3(e.id)}')">Guardar</button></td>
    </tr>`;
  }).join('');
};

async function saveExpenseConfigV31(accountId) {
  const row = document.querySelector(`[data-expense-row="${CSS.escape(accountId)}"]`);
  if (!row) return;
  const get = name => row.querySelector(`[data-e="${name}"]`);
  const payload = {
    sessionToken: sessionStorage.getItem(SESSION_KEY),
    accountId,
    nombre: get('name').value.trim(),
    tipo: get('type').value,
    monto: Number(get('amount').value || 0),
    prioridad: get('priority').value,
    orden: Number(get('order').value || 0),
    vigenteDesde: get('from').value || '',
    vigenteHasta: get('to').value || ''
  };
  if (!payload.nombre || !(payload.orden > 0)) return alert('Revisá nombre y orden.');
  try {
    const r = await backend('updateAccount', payload);
    if (!r.ok) throw new Error(r.message || 'No se pudo guardar la cuenta');
    await loadProductionData();
    renderAll();
  } catch (e) {
    alert(e.message || 'Error guardando la cuenta');
  }
}

function initV31() {
  moveLateBoxV31();
  const add = $('addExpense');
  if (add) {
    add.textContent = '↻ Recargar';
    add.onclick = async () => {
      try { await loadProductionData(); renderAll(); }
      catch (e) { alert(e.message || 'No se pudieron recargar las cuentas'); }
    };
  }
  const style = document.createElement('style');
  style.textContent = `.expenseConfigTable input,.expenseConfigTable select{padding:7px 8px;font-size:12px;border:1px solid var(--l);border-radius:8px;background:inherit;color:inherit}.expenseDatesV31{display:flex;align-items:center;gap:6px;margin-bottom:7px}.expenseDatesV31 input{width:132px}.quickAbonoV31{margin-left:4px}body.dark .expenseConfigTable input,body.dark .expenseConfigTable select{background:#111;color:#f5f5f5;border-color:#2a2a2a}`;
  document.head.appendChild(style);
}

document.addEventListener('DOMContentLoaded', initV31);
window.saveExpenseConfigV31 = saveExpenseConfigV31;

// Consolidated progressive session and data loading.
'use strict';

/* V3.4 · Carga progresiva
   - Un solo bootstrap por actualización.
   - F5 pinta el último snapshot de la pestaña de inmediato.
   - La actualización fresca ocurre en segundo plano.
   - Uber / Plan de pagos se consulta en segundo plano y nunca bloquea la pantalla principal.
   - Un timeout ya no dispara tres esperas consecutivas.
*/
(() => {
  const backendNetworkV34 = backend;
  const SNAPSHOT_KEY_V34 = 'flotilla_bootstrap_snapshot_v34';
  let bootstrapOverrideV34 = null;
  let backgroundRefreshRunningV34 = false;
  let planBackgroundRunningV34 = false;
  let planRefreshQueuedV34 = false;

  function parseSnapshotV34() {
    try {
      const raw = sessionStorage.getItem(SNAPSHOT_KEY_V34);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.data && parsed.data.ok ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveSnapshotV34(data) {
    if (!data || !data.ok) return;
    try {
      sessionStorage.setItem(SNAPSHOT_KEY_V34, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {}
  }

  function clearSnapshotV34() {
    try { sessionStorage.removeItem(SNAPSHOT_KEY_V34); } catch (_) {}
  }

  // loadProductionDataV22 (capturado por app-v3.js) llama bootstrap internamente.
  // Le entregamos exactamente la respuesta que ya obtuvimos para evitar otra ida al backend.
  backend = async function(action, payload = {}) {
    if (action === 'bootstrap' && bootstrapOverrideV34) return bootstrapOverrideV34;
    return backendNetworkV34(action, payload);
  };
  window.backend = backend;

  function applyV3BootstrapV34(r) {
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

    // Varios movimientos pueden pertenecer a una misma cuota.
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
        createdAt: String(p.CreatedAt || p.FechaReal || ''), origin: String(p.Origen || 'MANUAL'), uberSemanaId: String(p.UberSemanaID || '')
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

    backendCapabilities = r.capabilities || {};
    reversedMovements = Array.isArray(r.reversedPayments) ? r.reversedPayments : [];
    planDashboardV3 = Array.isArray(r.planCards) ? r.planCards : [];
    // Full summary refreshes in background.
    planDashboardLoadedV3 = false;
  }

  async function applyBootstrapV34(r) {
    if (!r || !r.ok) {
      const err = new Error((r && r.message) || 'No se pudieron cargar los datos.');
      err.authRequired = !!(r && r.authRequired);
      throw err;
    }

    bootstrapOverrideV34 = r;
    try {
      // Procesa Vehiculos, Cuentas, Plan_Pagos y la estructura base con el parser estable de app.js.
      await loadProductionDataV22();
    } finally {
      bootstrapOverrideV34 = null;
    }
    applyV3BootstrapV34(r);
  }

  // Sustituye la cadena anterior app.js -> app-v3.js -> getPlanDashboard.
  // Ahora hay una sola consulta core y nada externo bloquea la pantalla principal.
  loadProductionData = async function(options = {}) {
    const sessionToken = sessionStorage.getItem(SESSION_KEY);
    if (!sessionToken) throw new Error('Sesión no disponible');

    let r = options.snapshot || null;
    if (!r) {
      r = await backendNetworkV34('bootstrap', { sessionToken });
      if (r && r.ok) saveSnapshotV34(r);
    }
    await applyBootstrapV34(r);
    return r;
  };
  window.loadProductionData = loadProductionData;

  function ensureFreshnessBadgeV34() {
    let badge = document.getElementById('freshnessBadgeV34');
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'freshnessBadgeV34';
    badge.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:12000;padding:8px 11px;border-radius:999px;font:700 11px Segoe UI,Arial,sans-serif;background:#171717;color:#d7b928;border:1px solid #514315;box-shadow:0 8px 24px rgba(0,0,0,.25);display:none';
    document.body.appendChild(badge);
    return badge;
  }

  function freshnessV34(text, mode) {
    const badge = ensureFreshnessBadgeV34();
    badge.textContent = text;
    badge.style.display = 'block';
    badge.style.color = mode === 'error' ? '#ffb4ab' : mode === 'ok' ? '#9ce5b6' : '#d7b928';
    clearTimeout(freshnessV34.timer);
    if (mode === 'ok') freshnessV34.timer = setTimeout(() => { badge.style.display = 'none'; }, 1800);
  }

  async function refreshPlanInBackgroundV34() {
    if (!sessionStorage.getItem(SESSION_KEY)) return;
    if (planBackgroundRunningV34) { planRefreshQueuedV34 = true; return; }
    planBackgroundRunningV34 = true;
    try {
      await loadPlanDashboardV3(true);
    } catch (_) {
      // El core ya está visible; un fallo del archivo externo no bloquea la app.
    } finally {
      planBackgroundRunningV34 = false;
      if (planRefreshQueuedV34) {
        planRefreshQueuedV34 = false;
        void refreshPlanInBackgroundV34();
      }
    }
  }

  async function refreshCoreInBackgroundV34() {
    if (backgroundRefreshRunningV34) return;
    const sessionToken = sessionStorage.getItem(SESSION_KEY);
    if (!sessionToken) return;
    backgroundRefreshRunningV34 = true;
    freshnessV34('Actualizando datos…');
    try {
      const r = await backendNetworkV34('bootstrap', { sessionToken });
      if (!r || !r.ok) {
        if (r && r.authRequired) {
          clearSnapshotV34();
          sessionStorage.removeItem(SESSION_KEY);
          lockApp();
          authMsg('La sesión terminó. Ingresá el PIN nuevamente.');
          return;
        }
        throw new Error((r && r.message) || 'No se pudo actualizar');
      }
      saveSnapshotV34(r);
      await applyBootstrapV34(r);
      renderAll();
      freshnessV34('Datos actualizados ✓', 'ok');
      void refreshPlanInBackgroundV34();
    } catch (_) {
      freshnessV34('Mostrando último dato guardado · actualización pendiente', 'error');
    } finally {
      backgroundRefreshRunningV34 = false;
    }
  }

  // En F5, si esta misma pestaña ya estaba autenticada, pinta el snapshot primero.
  // La red deja de bloquear la experiencia.
  validateExistingSession = async function() {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) return false;

    const snapshot = parseSnapshotV34();
    if (snapshot) {
      try {
        await loadProductionData({ snapshot: snapshot.data });
        unlockApp();
        const ageSec = Math.max(0, Math.round((Date.now() - Number(snapshot.savedAt || Date.now())) / 1000));
        freshnessV34(ageSec < 5 ? 'Datos listos · actualizando…' : `Datos cargados · hace ${ageSec}s`);
        setTimeout(refreshCoreInBackgroundV34, 40);
        void refreshPlanInBackgroundV34();
        return true;
      } catch (_) {
        clearSnapshotV34();
      }
    }

    if (typeof showGlobalLoaderV33 === 'function') showGlobalLoaderV33('Cargando datos…');
    try {
      // bootstrap es también una validación protegida de sesión; evitamos validateSession + bootstrap.
      const r = await loadProductionData();
      unlockApp();
      freshnessV34('Datos actualizados ✓', 'ok');
      void refreshPlanInBackgroundV34();
      return !!r;
    } catch (err) {
      if (err && err.authRequired) {
        clearSnapshotV34();
        sessionStorage.removeItem(SESSION_KEY);
        return false;
      }
      authMsg('La sesión se conserva, pero el backend no respondió. Refrescá para reintentar.', false);
      return false;
    } finally {
      if (typeof hideGlobalLoaderV33 === 'function') hideGlobalLoaderV33(true);
    }
  };

  submitLogin = async function() {
    const pin = $('loginPin').value.trim();
    const token = $('loginToken').value.trim();
    if (!pin) return authMsg('Ingresá el PIN.');

    $('loginButton').disabled = true;
    authMsg('Validando…', true);
    if (typeof showGlobalLoaderV33 === 'function') showGlobalLoaderV33('Validando acceso…');
    let authenticated = false;
    try {
      const r = await backendNetworkV34('login', { pin, token });
      if (!(r && r.ok && r.sessionToken)) {
        if (r && r.tokenRequired) {
          setTokenRequired(true, r.message || 'Se requiere PIN + token.');
          if (r.tokenSent) authMsg('PIN incorrecto dos veces. Te envié un token al correo autorizado.');
        } else authMsg((r && r.message) || 'PIN incorrecto.');
        return;
      }

      authenticated = true;
      sessionStorage.setItem(SESSION_KEY, r.sessionToken);
      clearSnapshotV34();
      $('loginPin').value = '';
      $('loginToken').value = '';
      authMsg('PIN correcto. Cargando datos…', true);
      if (typeof updateGlobalLoaderV33 === 'function') updateGlobalLoaderV33('PIN correcto. Cargando datos…');

      // Una sola oportunidad bloqueante. Si la red falla, no esperamos otro minuto.
      await loadProductionData();
      unlockApp();
      freshnessV34('Datos actualizados ✓', 'ok');
      void refreshPlanInBackgroundV34();
    } catch (err) {
      if (authenticated || sessionStorage.getItem(SESSION_KEY)) {
        authMsg('PIN correcto y sesión abierta. El backend tardó demasiado; refrescá para reintentar sin volver a ingresar el PIN.', false);
      } else {
        authMsg('No se pudo contactar el backend para validar el PIN.', false);
      }
    } finally {
      $('loginButton').disabled = false;
      if (typeof hideGlobalLoaderV33 === 'function') hideGlobalLoaderV33(true);
    }
  };

  window.validateExistingSession = validateExistingSession;
  window.submitLogin = submitLogin;
  window.refreshCoreInBackgroundV34 = refreshCoreInBackgroundV34;
  window.refreshPlanInBackgroundV34 = refreshPlanInBackgroundV34;
})();

let movementHistoryLimit = 10;
function movementHistoryRows() {
  return [...Object.entries(paymentState).flatMap(([key,st])=>(st.movements || []).map((m,index)=>({...m,key,index}))),...reversedMovements]
    .sort((a,b)=>String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)) || b.index-a.index);
}
function renderMovementHistory() {
  const box=$('movementHistory'); if(!box)return;
  const rows=movementHistoryRows();
  box.innerHTML=rows.slice(0,movementHistoryLimit).map(m=>{
    const vehicleId=m.key.split('|')[0],v=contractVehicles.find(v=>v.id===vehicleId);
    const action=m.reversed?'<span>Reversado</span>':'<button class="light miniBtn" data-payment-id="'+escapeHtmlV3(m.pagoId)+'">'+(String(m.origin).toUpperCase()==='MANUAL'?'Reversar':'Corregir desde Uber')+'</button>';
    return '<tr><td>'+escapeHtmlV3(v?.name || vehicleId)+'</td><td>'+fmtShort(m.reversed ? m.createdAt : m.date || m.createdAt)+'</td><td>'+fmtShort(m.key.split('|')[1])+'</td><td><b>'+money(m.amount)+'</b></td><td>'+action+'</td></tr>';
  }).join('') || '<tr><td colspan="5">No hay movimientos.</td></tr>';
  box.querySelectorAll('[data-payment-id]').forEach(btn=>btn.onclick=()=>reverseMovement(btn.dataset.paymentId));
  $('moreMovements').hidden=rows.length<=movementHistoryLimit;
}
async function reverseMovement(id) {
  if(!backendCapabilities.specificManualReversal)return alert('El Apps Script activo debe actualizarse antes de reversar pagos desde este historial.');
  const entry=Object.entries(paymentState).find(([,st])=>st.movements?.some(m=>m.pagoId===id));
  const m=entry?.[1].movements.find(m=>m.pagoId===id); if(!m)return;
  if(m.origin.toUpperCase()!=='MANUAL')return openUberFromWeekV3(entry[0].split('|')[0]);
  if(!confirm('¿Reversar este abono específico de '+money(m.amount)+' del '+fmtShort(m.date)+'?'))return;
  try {
    const r=await backend('unmarkPayment',{sessionToken:sessionStorage.getItem(SESSION_KEY),pagoId:id});
    if(!r.ok)throw new Error(r.message || 'No se pudo reversar');
    await loadProductionData(); await loadPlanDashboardV3(true); renderAll();
  }catch(e){alert(e.message);}
}
document.addEventListener('DOMContentLoaded',()=>{
  $('moreMovements').onclick=()=>{movementHistoryLimit+=10;renderMovementHistory();};
});
