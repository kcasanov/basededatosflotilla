'use strict';

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('es-CR', {
  style: 'currency', currency: 'CRC', maximumFractionDigits: 0
}).format(Math.round(Number(n) || 0));

// Reglas del modelo. Los datos operativos (vehículos, cuentas y pagos) vienen de Google Sheets.
const IVA_RATE = 0.13;
const WEEKLY_INSURANCE = 5000;
const MORNING_INSURANCE = 10000;
const INTEREST_FACTOR = 0.006;
const APP_BASE = location.pathname.startsWith('/kcasanova/baseflotilla') ? '/kcasanova/baseflotilla' : '';
const BACKEND_URL = APP_BASE + '/api';
const SESSION_KEY = 'flotilla_session';
const DEVICE_KEY = 'flotilla_device_id';

let months = 36;
let quotePlan = [];
let weekOffset = 0;
let pendingLatePayment = null;

let expenseConfig = [];
let contractVehicles = [];
let planPayments = [];
const paymentState = Object.create(null);

function crTodayUTC() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)));
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function parseDate(iso) { return iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00Z') : null; }
function normalizeSheetDate(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(value);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
function nextOrSameTuesday(date) {
  const d = new Date(date);
  const add = (2 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}
function previousOrSameTuesday(date) {
  const d = new Date(date);
  const sub = (d.getUTCDay() - 2 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - sub);
  return d;
}
function weekDate() {
  const base = nextOrSameTuesday(crTodayUTC());
  base.setUTCDate(base.getUTCDate() + weekOffset * 7);
  return base;
}
function fmtShort(value) {
  const iso = normalizeSheetDate(value);
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
  }).format(parseDate(iso));
}
function priorityLabel(p) { return p === 'critical' ? 'Crítica' : p === 'medium' ? 'Media' : 'Baja'; }
function priorityClass(p) { return p === 'critical' ? 'critical' : p === 'medium' ? 'medium' : 'low'; }
function priorityRank(p) { return p === 'critical' ? 0 : p === 'medium' ? 1 : 2; }
function monthEndDay(year, monthIndex) { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }
function monthKey(d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
function dateInRange(iso, from, to) { return (!from || iso >= from) && (!to || iso <= to); }
function isVehicleOperational(v, iso) {
  return v.status !== 'INACTIVO' && (!v.start || iso >= v.start) && (!v.end || iso <= v.end);
}
function paymentKey(vehicleId, scheduledDate) { return vehicleId + '|' + scheduledDate; }
function getPaymentState(vehicleId, scheduledDate) {
  return paymentState[paymentKey(vehicleId, scheduledDate)] || { received: 0, realDate: '', status: 'Pendiente', pagoId: '' };
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
async function backend(action, payload = {}) {
  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, deviceId: getDeviceId(), ...payload })
  });
  if (!res.ok) throw new Error('HTTP_' + res.status);
  return await res.json();
}

function mapPriority(v) {
  const s = String(v || '').toUpperCase();
  return s === 'CRITICA' ? 'critical' : s === 'MEDIA' ? 'medium' : 'low';
}
function mapAccountType(v) {
  const s = String(v || '').toUpperCase();
  if (s === 'AUTOMATICO_PLAN') return 'automatic';
  if (s === 'REMANENTE') return 'remainder';
  return 'weekly';
}
async function loadProductionData() {
  const sessionToken = sessionStorage.getItem(SESSION_KEY);
  if (!sessionToken) throw new Error('Sesión no disponible');
  const r = await backend('bootstrap', { sessionToken });
  if (!r.ok) throw new Error(r.message || 'No se pudieron cargar los datos');

  contractVehicles = Array.isArray(r.vehicles) ? r.vehicles.map(v => ({
    id: String(v.VehicleID || ''),
    name: String(v.Nombre || [v.Marca, v.Modelo].filter(Boolean).join(' ') || v.VehicleID || ''),
    plate: String(v.Placa || ''),
    brand: String(v.Marca || ''),
    model: String(v.Modelo || ''),
    year: Number(v['Año'] || 0),
    weekly: Number(v.CuotaSemanal || 0),
    start: normalizeSheetDate(v.FechaInicio),
    end: normalizeSheetDate(v.FechaFin),
    storedCurrentWeek: Number(v.SemanaActual || 0),
    storedTotalWeeks: Number(v.SemanaFinal || 0),
    status: String(v.Estado || 'ACTIVO').toUpperCase(),
    frequency: String(v.Frecuencia || 'SEMANAL').toUpperCase(),
    note: String(v.Nota || ''),
    createdAt: normalizeSheetDate(v.CreatedAt),
    updatedAt: normalizeSheetDate(v.UpdatedAt)
  })).filter(v => v.id) : [];

  expenseConfig = Array.isArray(r.accounts) ? r.accounts
    .filter(a => String(a.Activa).toUpperCase() !== 'FALSE')
    .map(a => {
      const type = mapAccountType(a.Tipo);
      const amount = Number(a.Monto || 0);
      return {
        id: String(a.CuentaID || ''),
        order: Number(a.Orden || 99),
        name: String(a.Nombre || a.CuentaID || ''),
        type,
        amount,
        rule: type === 'automatic' ? 'Según pagos programados' : type === 'remainder' ? 'Todo el remanente' : money(amount) + ' semanal',
        priority: mapPriority(a.Prioridad),
        from: normalizeSheetDate(a.VigenteDesde) || null,
        to: normalizeSheetDate(a.VigenteHasta) || null
      };
    }) : [];

  planPayments = Array.isArray(r.plans) ? r.plans.map(p => ({
    planId: String(p.PlanID || ''),
    vehicleId: String(p.VehicleID || ''),
    week: Number(p.Semana || 0),
    date: normalizeSheetDate(p.FechaProgramada),
    total: Number(p.CuotaTotal || 0),
    insurance: Number(p.Seguro || 0),
    iva: Number(p.IVA || 0),
    useful: Number(p.CuotaUtil || 0),
    interest: Number(p.Interes || 0),
    capital: Number(p.Capital || 0),
    startBalance: Number(p.SaldoInicial || 0),
    endBalance: Number(p.SaldoFinal || 0),
    status: String(p.EstadoPlan || 'Pendiente')
  })).filter(p => p.vehicleId && p.date) : [];

  Object.keys(paymentState).forEach(k => delete paymentState[k]);
  if (Array.isArray(r.payments)) {
    r.payments.forEach(p => {
      const date = normalizeSheetDate(p.FechaProgramada);
      const vehicleId = String(p.VehicleID || '');
      if (!date || !vehicleId) return;
      paymentState[paymentKey(vehicleId, date)] = {
        received: Number(p.MontoRecibido || 0),
        realDate: normalizeSheetDate(p.FechaReal),
        status: String(p.Estado || 'Pagado'),
        pagoId: String(p.PagoID || ''),
        note: String(p.Nota || '')
      };
    });
  }
}

function plansForVehicle(vehicleId) {
  return planPayments.filter(p => p.vehicleId === vehicleId).sort((a, b) => a.date.localeCompare(b.date));
}
function morningEventsBetween(v, start, end) {
  const out = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const hardStart = parseDate(v.start);
  const hardEnd = parseDate(v.end);
  while (cursor <= end) {
    const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth();
    const last = monthEndDay(y, m);
    [15, Math.min(30, last)].forEach(day => {
      const d = new Date(Date.UTC(y, m, day));
      if (d >= start && d <= end && (!hardStart || d >= hardStart) && (!hardEnd || d <= hardEnd)) {
        out.push({
          planId: paymentKey(v.id, isoDate(d)), vehicleId: v.id, vehicle: v.name,
          date: isoDate(d), amount: v.weekly, iva: v.weekly * IVA_RATE,
          insurance: MORNING_INSURANCE, source: 'derived'
        });
      }
    });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
function derivedWeeklyEventsBetween(v, start, end) {
  const out = [];
  const first = parseDate(v.start), final = parseDate(v.end);
  if (!first || !final) return out;
  let d = new Date(first);
  while (d < start) d.setUTCDate(d.getUTCDate() + 7);
  while (d <= end && d <= final) {
    out.push({
      planId: paymentKey(v.id, isoDate(d)), vehicleId: v.id, vehicle: v.name,
      date: isoDate(d), amount: v.weekly, iva: v.weekly * IVA_RATE,
      insurance: WEEKLY_INSURANCE, source: 'derived'
    });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}
function scheduledEventsForVehicle(v, start, end) {
  const plans = plansForVehicle(v.id).filter(p => {
    const d = parseDate(p.date);
    return d >= start && d <= end;
  });
  if (plans.length || plansForVehicle(v.id).length) {
    return plans.map(p => ({
      planId: p.planId || paymentKey(v.id, p.date), vehicleId: v.id, vehicle: v.name,
      date: p.date, amount: p.total || v.weekly, iva: p.iva || (p.total || v.weekly) * IVA_RATE,
      insurance: p.insurance || WEEKLY_INSURANCE, source: 'plan'
    }));
  }
  if (v.frequency === 'QUINCENAL_15_FIN_MES') return morningEventsBetween(v, start, end);
  return derivedWeeklyEventsBetween(v, start, end);
}
function allScheduledEventsBetween(start, end) {
  return contractVehicles.flatMap(v => scheduledEventsForVehicle(v, start, end)).sort((a, b) => a.date.localeCompare(b.date));
}
function rowsForTuesday(tuesday) {
  const next = new Date(tuesday); next.setUTCDate(next.getUTCDate() + 6);
  const events = allScheduledEventsBetween(tuesday, next);
  return events.map(ev => {
    const st = getPaymentState(ev.vehicleId, ev.date);
    const visualDate = (contractVehicles.find(v => v.id === ev.vehicleId)?.frequency === 'QUINCENAL_15_FIN_MES') ? isoDate(tuesday) : ev.date;
    return {
      ...ev,
      visualDate,
      merged: visualDate !== ev.date,
      received: st.received,
      realDate: st.realDate,
      status: st.status,
      pagoId: st.pagoId,
      key: paymentKey(ev.vehicleId, ev.date)
    };
  });
}
function rowsForCurrentWeek() { return rowsForTuesday(weekDate()); }
function trackingStartDate() {
  const created = contractVehicles.map(v => v.createdAt).filter(Boolean).sort()[0];
  if (created) return nextOrSameTuesday(parseDate(created));
  return nextOrSameTuesday(crTodayUTC());
}
function getLateRows() {
  if (!contractVehicles.length) return [];
  const cutoff = weekDate();
  const start = trackingStartDate();
  const end = new Date(cutoff); end.setUTCDate(end.getUTCDate() - 1);
  if (end < start) return [];
  return allScheduledEventsBetween(start, end).map(ev => {
    const st = getPaymentState(ev.vehicleId, ev.date);
    const missing = Math.max(0, ev.amount - st.received);
    const weeksLate = Math.max(1, Math.ceil((cutoff - parseDate(ev.date)) / 604800000));
    return { ...ev, ...st, missing, weeksLate, key: paymentKey(ev.vehicleId, ev.date) };
  }).filter(r => r.missing > 0.01);
}

function isFifthTuesday(tuesday) {
  return Math.floor((tuesday.getUTCDate() - 1) / 7) + 1 >= 5;
}
function currentExpenses(expectedRows, tuesday = weekDate()) {
  const iso = isoDate(tuesday);
  const automaticIVA = expectedRows.reduce((s, r) => s + Number(r.iva || 0), 0);
  const automaticInsurance = expectedRows.reduce((s, r) => s + Number(r.insurance || 0), 0);
  return expenseConfig
    .filter(e => dateInRange(iso, e.from, e.to))
    .map(e => {
      let need = 0;
      if (e.id === 'iva' || e.name === 'IVA') need = automaticIVA;
      else if (e.id === 'seguros' || e.name === 'Seguros') need = automaticInsurance;
      else if (e.type === 'weekly') {
        need = (e.id === 'casa' || e.name === 'Cuentas casa') && isFifthTuesday(tuesday) ? 0 : e.amount;
      }
      return { ...e, need, assigned: 0 };
    });
}
function allocateExpenses(rows, available) {
  let remaining = available;
  const regular = rows.filter(x => x.type !== 'remainder')
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.order - b.order);
  regular.forEach(e => { e.assigned = Math.min(e.need, remaining); remaining -= e.assigned; });
  const rem = rows.find(x => x.type === 'remainder');
  if (rem) { rem.need = Math.max(0, remaining); rem.assigned = Math.max(0, remaining); remaining = 0; }
  return rows;
}
function renderExpenseAllocation(expenses, available) {
  const used = expenses.reduce((s, e) => s + e.assigned, 0);
  const gap = expenses.filter(e => e.type !== 'remainder').reduce((s, e) => s + Math.max(0, e.need - e.assigned), 0);
  const rows = rowsForCurrentWeek();
  const expected = rows.reduce((s, r) => s + r.amount, 0);
  const received = rows.reduce((s, r) => s + r.received, 0);
  const latePending = getLateRows().reduce((s, r) => s + r.missing, 0);
  const incoming = Math.max(0, expected - received) + latePending;

  $('allocAvailable').textContent = money(available);
  $('allocUsed').textContent = money(used);
  $('allocGap').textContent = money(gap);
  $('allocGapNote').textContent = 'Gastos que todavía no logramos cubrir';
  $('allocIncoming').textContent = money(incoming);
  $('expenseBody').innerHTML = expenses.map(e => {
    const falta = Math.max(0, e.need - e.assigned);
    let state = falta <= .01 ? '🟢 Completa' : e.assigned > 0 ? '🟡 Parcial' : (e.priority === 'critical' ? '🔴 Pendiente' : '⚪ Pendiente');
    if ((e.id === 'pago_deudas' || e.name === 'Pago de deudas') && incoming > 0) state = '🟡 Pendiente de completar';
    return `<tr><td><span class="priority ${priorityClass(e.priority)}">${priorityLabel(e.priority)}</span></td><td>${e.name}</td><td>${money(e.need)}</td><td>${money(e.assigned)}</td><td>${money(falta)}</td><td>${state}</td></tr>`;
  }).join('');
}
function renderExpenseConfig() {
  $('expenseConfigBody').innerHTML = expenseConfig.slice().sort((a, b) => a.order - b.order).map(e => `<tr>
    <td>${e.order}</td><td>${e.name}</td><td>${e.type}</td><td>${e.rule}</td>
    <td><span class="priority ${priorityClass(e.priority)}">${priorityLabel(e.priority)}</span></td>
    <td>${e.from || '—'}${e.to ? ' → ' + e.to : ' → en adelante'}</td>
  </tr>`).join('');
}

function renderWeek() {
  const d = weekDate();
  $('weekLabel').textContent = 'Semana de cobro · martes ' + new Intl.DateTimeFormat('es-CR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(d);

  const rows = rowsForCurrentWeek();
  const expected = rows.reduce((s, r) => s + r.amount, 0);
  const received = rows.reduce((s, r) => s + r.received, 0);
  const lateRows = getLateRows();
  const late = lateRows.reduce((s, r) => s + r.missing, 0);
  const pending = Math.max(0, expected - received) + late;

  $('wkExpected').textContent = money(expected);
  $('wkReceived').textContent = money(received);
  $('wkLate').textContent = money(late);
  $('wkPending').textContent = money(pending);

  $('weeklyIncomeBody').innerHTML = rows.length ? rows.map(r => {
    const paid = r.received >= r.amount - .01;
    const partial = r.received > 0 && !paid;
    const label = paid ? 'Pagado' : partial ? 'Parcial' : 'Pendiente';
    return `<tr>
      <td><span class="statuspill ${paid ? 'ok' : 'pending'}">${label}</span></td>
      <td>${r.vehicle}${r.merged ? ' <span class="statuspill pending">fecha especial</span>' : ''}</td>
      <td>${fmtShort(r.date)}</td><td>${money(r.amount)}</td><td>${money(r.received)}</td><td>${fmtShort(r.realDate)}</td>
      <td>${paid ? `<button class="light" onclick="unmarkPaid('${encodeURIComponent(r.key)}')">Desmarcar</button>` : `<button class="light" onclick="markWeekRowPaid('${encodeURIComponent(r.key)}')">Marcar pagado</button>`}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7">No hay pagos programados para esta semana.</td></tr>';

  $('lateList').innerHTML = lateRows.length ? lateRows.map((r, i) => `<div class="lateItem">
    <div><b>${r.vehicle} · ${money(r.missing)}</b><div class="lateMeta">Debía pagar ${fmtShort(r.date)} · ${r.weeksLate} semana${r.weeksLate === 1 ? '' : 's'} de atraso</div></div>
    <button class="dark" onclick="openLatePayment(${i})">Marcar recibido</button>
  </div>`).join('') : '<div class="placeholder">No hay ingresos atrasados.</div>';

  const expenses = allocateExpenses(currentExpenses(rows, d), received);
  renderExpenseAllocation(expenses, received);
  renderSummary();
}
async function markWeekRowPaid(encodedKey) {
  const key = decodeURIComponent(encodedKey);
  const row = rowsForCurrentWeek().find(r => r.key === key);
  if (!row) return;
  const sessionToken = sessionStorage.getItem(SESSION_KEY);
  try {
    const response = await backend('markPayment', {
      sessionToken, planId: row.planId || row.key, vehicleId: row.vehicleId,
      fechaProgramada: row.date, fechaReal: isoDate(crTodayUTC()),
      montoEsperado: row.amount, montoRecibido: row.amount, estado: 'PAGADO'
    });
    if (!response.ok) throw new Error(response.message || 'No se pudo registrar el pago');
    paymentState[key] = { received: row.amount, realDate: isoDate(crTodayUTC()), status: 'PAGADO', pagoId: response.pagoId };
    renderWeek(); renderVehicles();
  } catch (e) { alert(e.message || 'Error registrando el pago'); }
}
async function unmarkPaid(encodedKey) {
  const key = decodeURIComponent(encodedKey), st = paymentState[key];
  if (!st) return;
  const sessionToken = sessionStorage.getItem(SESSION_KEY);
  try {
    if (st.pagoId) {
      const response = await backend('unmarkPayment', { sessionToken, pagoId: st.pagoId });
      if (!response.ok) throw new Error(response.message || 'No se pudo desmarcar');
    }
    delete paymentState[key];
    renderWeek(); renderVehicles();
  } catch (e) { alert(e.message || 'Error desmarcando el pago'); }
}
function distributeCurrentWeek() {
  const rows = rowsForCurrentWeek();
  const received = rows.reduce((s, r) => s + r.received, 0);
  renderExpenseAllocation(allocateExpenses(currentExpenses(rows, weekDate()), received), received);
}
function openLatePayment(i) {
  const rows = getLateRows();
  pendingLatePayment = rows[i] || null;
  if (!pendingLatePayment) return;
  $('latePaymentInfo').innerHTML = `<b>${pendingLatePayment.vehicle}</b><br>${money(pendingLatePayment.missing)} pendientes del ${fmtShort(pendingLatePayment.date)}.`;
  $('manualLateAccount').innerHTML = expenseConfig.map(e => `<option>${e.name}</option>`).join('');
  $('latePaymentModal').classList.add('show');
}
function closeLateModal() { $('latePaymentModal').classList.remove('show'); pendingLatePayment = null; }
async function confirmLatePayment() {
  const r = pendingLatePayment;
  if (!r) return;
  const mode = $('lateAllocationMode').value;
  const note = 'Asignación: ' + mode + (mode === 'manual' ? ' · ' + $('manualLateAccount').value : '');
  const sessionToken = sessionStorage.getItem(SESSION_KEY);
  try {
    const response = await backend('markPayment', {
      sessionToken, planId: r.planId || r.key, vehicleId: r.vehicleId,
      fechaProgramada: r.date, fechaReal: isoDate(crTodayUTC()),
      montoEsperado: r.amount, montoRecibido: r.amount, estado: 'PAGADO_ATRASADO', nota: note
    });
    if (!response.ok) throw new Error(response.message || 'No se pudo registrar');
    paymentState[r.key] = { received: r.amount, realDate: isoDate(crTodayUTC()), status: 'PAGADO_ATRASADO', pagoId: response.pagoId, note };
    closeLateModal(); renderWeek(); renderVehicles();
  } catch (e) { alert(e.message || 'Error registrando el pago atrasado'); }
}

function fullScheduleForVehicle(v) {
  const start = parseDate(v.start), end = parseDate(v.end);
  if (!start || !end) return [];
  return scheduledEventsForVehicle(v, start, end);
}
function vehicleLateRows(v) { return getLateRows().filter(x => x.vehicleId === v.id); }
function vehicleStats(v) {
  const schedule = fullScheduleForVehicle(v);
  const ref = weekDate();
  const currentCount = schedule.filter(x => parseDate(x.date) <= ref).length;
  const futureEvents = schedule.filter(x => parseDate(x.date) > ref);
  const historicalEvents = schedule.filter(x => parseDate(x.date) <= ref);
  return {
    schedule, currentCount, totalWeeks: schedule.length,
    remaining: futureEvents.length,
    historical: historicalEvents.reduce((s, x) => s + x.amount, 0),
    future: futureEvents.reduce((s, x) => s + x.amount, 0),
    total: schedule.reduce((s, x) => s + x.amount, 0)
  };
}
function renderVehicles() {
  $('vehiclesBody').innerHTML = contractVehicles.length ? contractVehicles.map(v => {
    const st = vehicleStats(v), lateRows = vehicleLateRows(v), lateAmt = lateRows.reduce((s, x) => s + x.missing, 0);
    return `<tr>
      <td>${v.name}</td><td>${money(v.weekly)}</td><td>${st.currentCount}</td><td>${st.totalWeeks}</td><td>${st.remaining}</td>
      <td>${money(st.historical)}</td><td>${money(st.future)}</td>
      <td>${lateRows.length ? `<span class="vehicleLateBadge clickable" onclick="openVehicle('${v.id}')">${lateRows.length} · ${money(lateAmt)}</span>` : '—'}</td>
      <td><button class="light" onclick="openVehicle('${v.id}')">Ver contrato</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="9">No hay vehículos registrados.</td></tr>';
}
function openVehicle(id) {
  const v = contractVehicles.find(x => x.id === id); if (!v) return;
  const st = vehicleStats(v), lateRows = vehicleLateRows(v), lateAmt = lateRows.reduce((s, x) => s + x.missing, 0);
  $('vehicleModalTitle').textContent = v.name;
  $('vehicleModalSub').textContent = `Contrato ${fmtShort(v.start)} → ${fmtShort(v.end)} · ${v.status}`;
  $('vehicleDetailKpis').innerHTML = `
    <div class="metric">Semana actual<b>${st.currentCount}</b></div>
    <div class="metric">Semana final<b>${st.totalWeeks}</b></div>
    <div class="metric">Semanas restantes<b>${st.remaining}</b></div>
    <div class="metric">Atrasado<b>${money(lateAmt)}</b></div>`;
  $('vehicleLateDetail').innerHTML = lateRows.length ? `<div class="lateList">${lateRows.map(x => `<div class="lateItem"><div><b>${fmtShort(x.date)} · ${money(x.missing)}</b><div class="lateMeta">${x.weeksLate} semana${x.weeksLate === 1 ? '' : 's'} de atraso</div></div></div>`).join('')}</div>` : '<div class="placeholder">No hay semanas atrasadas registradas.</div>';
  $('vehicleHistoryDetail').innerHTML = `<b>Programado hasta la semana actual:</b> ${money(st.historical)}<br>
    <b>Futuro programado:</b> ${money(st.future)}<br><b>Total programado del contrato:</b> ${money(st.total)}
    ${v.note ? '<br><br><b>Nota:</b> ' + v.note : ''}`;
  $('vehicleModal').classList.add('show');
}

function payInfo(iso) {
  if (!iso) return null;
  const sign = parseDate(iso); let add = (2 - sign.getUTCDay() + 7) % 7; if (add === 0) add = 7;
  const next = new Date(sign); next.setUTCDate(next.getUTCDate() + add);
  const deferred = add < 3, first = new Date(next); if (deferred) first.setUTCDate(first.getUTCDate() + 7);
  return { first, days: deferred ? add + 7 : add, deferred, add };
}
function quoteWeeks(m, iso) {
  const i = payInfo(iso); if (!i) return 0;
  const f = i.first;
  const ann = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + m, f.getUTCDate()));
  const bound = new Date(Date.UTC(ann.getUTCFullYear(), ann.getUTCMonth() + 1, ann.getUTCDate()));
  let n = 0, d = new Date(f);
  while (d <= bound) { n++; d.setUTCDate(d.getUTCDate() + 7); if (n > 320) break; }
  return n;
}
function quoteNet(cuota, factor = 1) {
  const total = cuota * factor, seg = WEEKLY_INSURANCE, iva = total * IVA_RATE;
  return { total, seg, iva, util: Math.max(0, total - seg - iva) };
}
function readQuote() {
  return {
    marca: $('marca').value.trim(), modelo: $('modelo').value.trim(), placa: $('placa').value.trim().toUpperCase(),
    anio: +$('anio').value || 0, km: +$('km').value || 0, valor: +$('valor').value || 0,
    prima: +$('prima').value || 0, cuota: +$('cuota').value || 0, firma: $('firma').value
  };
}
function quoteScenario(v, m) {
  const n = quoteWeeks(m, v.firma), i = payInfo(v.firma); if (!i || !v.cuota || !n) return { n, saldo: 0, util: 0 };
  const ff = i.days / 7, normal = quoteNet(v.cuota), first = quoteNet(v.cuota, ff);
  let saldo = first.util / Math.pow(1 + INTEREST_FACTOR, ff);
  if (n > 1) saldo += (normal.util * (1 - Math.pow(1 + INTEREST_FACTOR, -(n - 1))) / INTEREST_FACTOR) / Math.pow(1 + INTEREST_FACTOR, ff);
  return { n, saldo, util: normal.util };
}
function buildQuotePlan(v, c) {
  const out = [], i = payInfo(v.firma); if (!i || !v.cuota) return out;
  let saldo = c.saldo;
  for (let x = 1; x <= c.n; x++) {
    const factor = x === 1 ? i.days / 7 : 1, p = quoteNet(v.cuota, factor), interest = saldo * INTEREST_FACTOR * factor;
    let capital = Math.max(0, p.util - interest); if (x === c.n || capital > saldo) capital = saldo;
    const endBalance = Math.max(0, saldo - capital), date = new Date(i.first); date.setUTCDate(i.first.getUTCDate() + (x - 1) * 7);
    out.push({ semana: x, fecha: isoDate(date), saldoInicial: saldo, cuotaTotal: p.total, seguro: p.seg, iva: p.iva, cuotaUtil: p.util, interes: interest, capital, saldoFinal: endBalance, estado: 'Pendiente' });
    saldo = endBalance;
  }
  return out;
}
function renderQuotePlan() {
  $('tbody').innerHTML = quotePlan.map(r => `<tr><td>${r.semana}</td><td>${r.fecha}</td><td>${money(r.saldoInicial)}</td><td>${money(r.cuotaTotal)}</td><td>${money(r.seguro)}</td><td>${money(r.iva)}</td><td>${money(r.cuotaUtil)}</td><td>${money(r.interes)}</td><td>${money(r.capital)}</td><td>${money(r.saldoFinal)}</td><td>${r.estado}</td></tr>`).join('');
}
function recalcQuote() {
  const v = readQuote(), c = quoteScenario(v, months);
  $('sem').textContent = c.n; $('saldo').textContent = money(c.saldo);
  [24, 30, 32, 36].forEach(m => { const x = quoteScenario(v, m); $('s' + m).textContent = v.cuota ? money(x.saldo) + ' · ' + x.n + ' pagos' : '—'; });
  const i = payInfo(v.firma); if (i) $('first').innerHTML = '<b>Primera cuota:</b> ' + isoDate(i.first) + ' · ' + i.days + ' días' + (i.deferred ? ' (periodo acumulado)' : '');
  quotePlan = buildQuotePlan(v, c);
  const interestTotal = quotePlan.reduce((s, r) => s + r.interes, 0);
  $('interesesTotal').textContent = money(interestTotal); $('netoSinAhorros').textContent = money(c.saldo + interestTotal);
  renderQuotePlan();
}
function quotePayload() {
  const v = readQuote(), c = quoteScenario(v, months);
  return {
    version: 'PERSONAL_V2_2',
    vehicle: { placa: v.placa, marca: v.marca, modelo: v.modelo, anio: v.anio, kilometraje: v.km, valorMercado: v.valor },
    contract: { prima: v.prima, cuota: v.cuota, seguro: WEEKLY_INSURANCE, ivaPct: IVA_RATE, tasaFactor: INTEREST_FACTOR, plazoMeses: months, fechaFirma: v.firma },
    projection: { saldoInicial: c.saldo, semanas: c.n }, plan: quotePlan
  };
}
async function saveVehicle() {
  const p = quotePayload(), s = $('saveStatus');
  if (!p.vehicle.placa || !p.vehicle.marca || !p.vehicle.modelo || !p.contract.cuota || !p.contract.fechaFirma) {
    s.textContent = 'Completá placa, marca, modelo, cuota y fecha de firma.'; s.className = 'status bad'; return;
  }
  try {
    s.textContent = 'Guardando vehículo y plan…'; s.className = 'status';
    const r = await backend('createVehicle', { sessionToken: sessionStorage.getItem(SESSION_KEY), payload: p });
    if (!r.ok) throw new Error(r.message || 'No se pudo guardar');
    s.textContent = `Guardado correctamente · ${r.planRows || 0} pagos creados.`; s.className = 'status ok';
    await loadProductionData(); renderAll();
  } catch (e) { s.textContent = e.message || 'Error al guardar.'; s.className = 'status bad'; }
}
function downloadQuoteJson() {
  const p = quotePayload(), b = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = 'Flotilla_' + (p.vehicle.placa || 'vehiculo') + '.json'; a.click(); URL.revokeObjectURL(u);
}

function projectionWindow() {
  const now = crTodayUTC(), mode = $('projectionRange').value;
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end;
  if (mode === 'quarter') end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
  else if (mode === 'semester') end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 6, 0));
  else if (mode === 'year') end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, 0));
  else {
    start = parseDate($('projectionStart').value) || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = parseDate($('projectionEnd').value) || new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 0));
  }
  return { start, end };
}
function tuesdaysInMonth(y, m) {
  const out = [], last = monthEndDay(y, m);
  for (let day = 1; day <= last; day++) {
    const d = new Date(Date.UTC(y, m, day)); if (d.getUTCDay() === 2) out.push(d);
  }
  return out;
}
function projectMonth(y, m, extraCars = 0, extraWeekly = 80000) {
  const start = new Date(Date.UTC(y, m, 1)), end = new Date(Date.UTC(y, m + 1, 0));
  const events = allScheduledEventsBetween(start, end);
  const income = events.reduce((s, e) => s + e.amount, 0);
  const iva = events.reduce((s, e) => s + e.iva, 0);
  const insurance = events.reduce((s, e) => s + e.insurance, 0);
  let fixed = 0;
  const tuesdays = tuesdaysInMonth(y, m);
  tuesdays.forEach(t => {
    const iso = isoDate(t);
    expenseConfig.filter(e => e.type === 'weekly' && dateInRange(iso, e.from, e.to)).forEach(e => {
      if ((e.id === 'casa' || e.name === 'Cuentas casa') && isFifthTuesday(t)) return;
      fixed += e.amount;
    });
  });
  const expenses = fixed + iva + insurance;
  const net = income - expenses;
  const extraPayments = tuesdays.length * extraCars;
  const extraIncome = extraPayments * extraWeekly;
  const extraNet = extraIncome - extraIncome * IVA_RATE - extraPayments * WEEKLY_INSURANCE;
  return { income, expenses, net, scenarioNet: net + extraNet, extraNet, tuesdays: tuesdays.length };
}
function calcProjection() {
  const { start, end } = projectionWindow();
  const extra = +$('extraCars').value || 0, extraWeekly = +$('extraCarWeekly').value || 80000;
  $('customStartWrap').style.display = $('projectionRange').value === 'custom' ? 'block' : 'none';
  $('customEndWrap').style.display = $('projectionRange').value === 'custom' ? 'block' : 'none';
  const vals = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const key = monthKey(cursor), x = projectMonth(cursor.getUTCFullYear(), cursor.getUTCMonth(), extra, extraWeekly);
    vals.push([key, x]); cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  const income = vals.reduce((s, [, x]) => s + x.income, 0), expenses = vals.reduce((s, [, x]) => s + x.expenses, 0), net = vals.reduce((s, [, x]) => s + x.net, 0), extraImpact = vals.reduce((s, [, x]) => s + x.extraNet, 0);
  $('projIncome').textContent = money(income); $('projExpenses').textContent = money(expenses); $('projNet').textContent = money(net); $('projExtra').textContent = money(extraImpact);
  $('projectionBody').innerHTML = vals.map(([k, x]) => `<tr><td>${k}</td><td>${money(x.income)}</td><td>${money(x.expenses)}</td><td>${money(x.net)}</td><td>${money(x.scenarioNet)}</td></tr>`).join('');
  const max = Math.max(1, ...vals.map(([, x]) => Math.abs(x.scenarioNet)));
  $('projectionBars').innerHTML = vals.map(([k, x]) => `<div class="barRow"><div>${k}</div><div class="barTrack"><div class="barFill" style="width:${Math.max(2, Math.abs(x.scenarioNet) / max * 100)}%"></div></div><div>${money(x.scenarioNet)}</div></div>`).join('');
  const impacts = [1, 2, 3].map(n => vals.reduce((s, [k]) => {
    const [yy, mm] = k.split('-').map(Number); return s + projectMonth(yy, mm - 1, n, extraWeekly).extraNet;
  }, 0));
  $('scenarioSummary').innerHTML = `<div class="note"><b>Neto base:</b> ${money(net)}<br><br><b>+1 carro:</b> ${money(net + impacts[0])}<br><b>+2 carros:</b> ${money(net + impacts[1])}<br><b>+3 carros:</b> ${money(net + impacts[2])}<br><br><span style="color:#667085">Simulación sobre la programación vigente cargada en Google Sheets.</span></div>`;
}
function monthProjectionSummary() {
  const d = weekDate(); return projectMonth(d.getUTCFullYear(), d.getUTCMonth(), 0, 0);
}
function renderSummary() {
  const rows = rowsForCurrentWeek(), expected = rows.reduce((s, r) => s + r.amount, 0), received = rows.reduce((s, r) => s + r.received, 0), lateRows = getLateRows(), late = lateRows.reduce((s, r) => s + r.missing, 0);
  $('sumWeekExpected').textContent = money(expected); $('sumWeekReceived').textContent = money(received); $('sumLate').textContent = money(late);
  const wd = weekDate(), weekEnd = new Date(wd); weekEnd.setUTCDate(wd.getUTCDate() + 6);
  const fmtLong = new Intl.DateTimeFormat('es-CR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  $('sumWeekLabel').textContent = 'Semana de cobro · martes ' + fmtLong.format(wd); $('sumWeekPeriod').textContent = 'Periodo mostrado: ' + fmtLong.format(wd) + ' al ' + fmtLong.format(weekEnd);
  $('sumWeekRows').innerHTML = rows.length ? rows.map(r => `<div class="summaryRow"><span>${r.vehicle}</span><span>${r.received >= r.amount ? '🟢' : '🟡'} ${money(r.received)} / ${money(r.amount)}</span></div>`).join('') : '<div class="placeholder">No hay pagos programados.</div>';
  $('sumLateRows').innerHTML = lateRows.length ? lateRows.map(r => `<div class="lateItem"><div><b>${r.vehicle} · ${money(r.missing)}</b><div class="lateMeta">${r.weeksLate} semana${r.weeksLate === 1 ? '' : 's'} de atraso · ${fmtShort(r.date)}</div></div></div>`).join('') : '<div class="placeholder">No hay atrasos pendientes.</div>';
  const p = monthProjectionSummary();
  $('sumMonthIncome').textContent = money(p.income); $('sumMonthExpenses').textContent = money(p.expenses); $('sumMonthNet').textContent = money(p.net); $('sumMonthNet2').textContent = money(p.net); $('sumTuesdays').textContent = p.tuesdays;
  const pct = p.income ? Math.max(2, Math.min(100, Math.abs(p.net) / p.income * 100)) : 0;
  $('sumMonthBar').innerHTML = `<div class="barRow"><div>Neto</div><div class="barTrack"><div class="barFill" style="width:${pct}%"></div></div><div>${money(p.net)}</div></div>`;
  $('sumQuickText').textContent = `Este mes tiene ${p.tuesdays} martes. Proyectás ${money(p.income)} de ingresos y ${money(p.net)} netos después de gastos.`;
}

function goToView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active')); $(id).classList.add('active');
  document.querySelectorAll('.navbtn').forEach(x => x.className = 'light navbtn');
  const b = [...document.querySelectorAll('.navbtn')].find(x => x.dataset.v === id); if (b) b.className = 'dark navbtn';
}
function applyTheme(t) {
  document.body.classList.toggle('dark', t === 'dark'); $('themeToggle').textContent = t === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro'; localStorage.setItem('flotilla_theme', t);
}
function renderAll() { renderExpenseConfig(); renderWeek(); renderVehicles(); calcProjection(); renderSummary(); }

function authMsg(text, ok = false) {
  const el = $('loginMessage'); el.textContent = text || ''; el.style.color = ok ? '#93dfb2' : '#f0b7b7';
}
function unlockApp() {
  document.body.classList.remove('auth-locked'); $('authGate').classList.add('hidden'); $('appShell').style.display = ''; renderAll();
}
function lockApp() {
  sessionStorage.removeItem(SESSION_KEY); document.body.classList.add('auth-locked'); $('authGate').classList.remove('hidden');
}
async function validateExistingSession() {
  const token = sessionStorage.getItem(SESSION_KEY); if (!token) return false;
  try {
    const r = await backend('validateSession', { sessionToken: token });
    if (r.ok) { await loadProductionData(); unlockApp(); return true; }
  } catch (e) {}
  sessionStorage.removeItem(SESSION_KEY); return false;
}
function setTokenRequired(required, message) {
  $('tokenFields').style.display = required ? 'block' : 'none'; $('requestTokenButton').style.display = required ? 'block' : 'none';
  if (message) authMsg(message); if (required) $('loginToken').focus();
}
async function requestSecurityToken() {
  authMsg('Enviando token…', true);
  try { const r = await backend('requestToken', {}); authMsg(r.ok ? 'Token enviado al correo autorizado.' : (r.message || 'No se pudo enviar el token.'), r.ok); }
  catch (e) { authMsg('No se pudo contactar el backend.'); }
}
async function submitLogin() {
  const pin = $('loginPin').value.trim(), token = $('loginToken').value.trim();
  if (!pin) { authMsg('Ingresá el PIN.'); return; }
  $('loginButton').disabled = true; authMsg('Validando…', true);
  try {
    const r = await backend('login', { pin, token });
    if (r.ok && r.sessionToken) {
      sessionStorage.setItem(SESSION_KEY, r.sessionToken); $('loginPin').value = ''; $('loginToken').value = '';
      await loadProductionData(); unlockApp(); return;
    }
    if (r.tokenRequired) { setTokenRequired(true, r.message || 'Se requiere PIN + token.'); if (r.tokenSent) authMsg('PIN incorrecto dos veces. Te envié un token al correo autorizado.'); }
    else authMsg(r.message || 'PIN incorrecto.');
  } catch (e) { authMsg('No se pudo contactar el backend.'); }
  finally { $('loginButton').disabled = false; }
}

function init() {
  document.querySelectorAll('.navbtn').forEach(b => b.addEventListener('click', () => goToView(b.dataset.v)));
  $('prevWeek').onclick = () => { weekOffset--; renderWeek(); renderVehicles(); };
  $('nextWeek').onclick = () => { weekOffset++; renderWeek(); renderVehicles(); };
  $('autoAllocate').onclick = distributeCurrentWeek;
  $('lateAllocationMode').onchange = () => { $('manualLateArea').style.display = $('lateAllocationMode').value === 'manual' ? 'block' : 'none'; };
  $('cancelLatePayment').onclick = closeLateModal; $('confirmLatePayment').onclick = confirmLatePayment;
  $('closeVehicleModal').onclick = () => $('vehicleModal').classList.remove('show');
  $('addExpense').onclick = () => alert('Las cuentas se administran desde la pestaña Cuentas del archivo Base de datos flotilla.');

  $('recalc').onclick = recalcQuote; $('toggle').onclick = () => { $('planBox').style.display = $('planBox').style.display === 'none' ? 'block' : 'none'; };
  $('save').onclick = saveVehicle; $('json').onclick = downloadQuoteJson;
  document.querySelectorAll('.scen').forEach(b => b.onclick = () => { months = +b.dataset.m; document.querySelectorAll('.scen').forEach(x => x.classList.remove('active')); b.classList.add('active'); recalcQuote(); });
  ['marca','modelo','placa','anio','km','valor','prima','cuota','firma'].forEach(id => $(id).addEventListener('change', recalcQuote));

  ['projectionRange','projectionStart','projectionEnd','extraCars','extraCarWeekly'].forEach(id => $(id).addEventListener('change', () => { calcProjection(); renderSummary(); }));
  $('themeToggle').onclick = () => applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
  applyTheme(localStorage.getItem('flotilla_theme') || 'light');

  $('loginButton').addEventListener('click', submitLogin); $('requestTokenButton').addEventListener('click', requestSecurityToken);
  $('loginPin').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
  $('loginToken').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });

  $('firma').value = isoDate(crTodayUTC()); recalcQuote();
  validateExistingSession();
}

window.markWeekRowPaid = markWeekRowPaid;
window.unmarkPaid = unmarkPaid;
window.openLatePayment = openLatePayment;
window.openVehicle = openVehicle;
window.goToView = goToView;

document.addEventListener('DOMContentLoaded', init);
