'use strict';

/* V3.3 · Carga visible + sincronización separada Flotilla → Central */
const backendBaseV33 = backend;
const CENTRAL_SYNC_ACTIONS_V33 = new Set(['markPayment','unmarkPayment','saveUberWeek']);
const LOADING_ACTIONS_V33 = new Set(['markPayment','unmarkPayment','saveUberWeek','updateAccount','updateVehicleConfig','createVehicle','syncCentral']);

function actionLabelV33(action) {
  const labels = {
    markPayment:'Guardando abono…',
    unmarkPayment:'Revirtiendo abono…',
    saveUberWeek:'Guardando semana Uber…',
    updateAccount:'Guardando cuenta…',
    updateVehicleConfig:'Guardando configuración…',
    createVehicle:'Guardando vehículo…',
    syncCentral:'Actualizando Central…'
  };
  return labels[action] || 'Procesando…';
}

function ensureGlobalLoaderV33() {
  let root = document.getElementById('globalLoaderV33');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'globalLoaderV33';
  root.innerHTML = `
    <div class="globalLoaderBarV33"><span></span></div>
    <div class="globalLoaderPillV33"><span class="globalLoaderSpinnerV33"></span><b id="globalLoaderTextV33">Procesando…</b></div>`;
  document.body.appendChild(root);
  if (!document.getElementById('globalLoaderStyleV33')) {
    const style = document.createElement('style');
    style.id = 'globalLoaderStyleV33';
    style.textContent = `
      #globalLoaderV33{display:none;position:fixed;inset:0;z-index:15000;pointer-events:none}
      #globalLoaderV33.show{display:block}
      .globalLoaderBarV33{position:absolute;left:0;right:0;top:0;height:5px;background:rgba(215,185,40,.18);overflow:hidden}
      .globalLoaderBarV33 span{position:absolute;top:0;bottom:0;width:34%;background:#d7b928;border-radius:0 999px 999px 0;animation:globalLoaderMoveV33 1.05s ease-in-out infinite}
      .globalLoaderPillV33{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:9px;background:#071a33;color:#fff;border:1px solid rgba(215,185,40,.55);border-radius:999px;padding:9px 14px;box-shadow:0 10px 28px rgba(0,0,0,.24);font-size:12px;white-space:nowrap}
      .globalLoaderSpinnerV33{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.28);border-top-color:#d7b928;animation:globalLoaderSpinV33 .75s linear infinite}
      @keyframes globalLoaderMoveV33{0%{left:-35%}50%{left:50%}100%{left:105%}}
      @keyframes globalLoaderSpinV33{to{transform:rotate(360deg)}}
      body.dark .globalLoaderPillV33{background:#111;border-color:#806d1b}
    `;
    document.head.appendChild(style);
  }
  return root;
}

let loaderDepthV33 = 0;
function showGlobalLoaderV33(text) {
  const root = ensureGlobalLoaderV33();
  loaderDepthV33++;
  const label = document.getElementById('globalLoaderTextV33');
  if (label) label.textContent = text || 'Procesando…';
  root.classList.add('show');
}
function updateGlobalLoaderV33(text) {
  const label = document.getElementById('globalLoaderTextV33');
  if (label) label.textContent = text || 'Procesando…';
}
function hideGlobalLoaderV33(force=false) {
  loaderDepthV33 = force ? 0 : Math.max(0, loaderDepthV33 - 1);
  if (loaderDepthV33 === 0) {
    const root = document.getElementById('globalLoaderV33');
    if (root) root.classList.remove('show');
  }
}

function syncWeekForActionV33(action, payload) {
  if (action === 'saveUberWeek' && payload && payload.fechaProgramada) {
    const d = parseDate(payload.fechaProgramada);
    if (d) return isoDate(nextOrSameTuesday(d));
  }
  return isoDate(weekDate());
}

backend = async function(action, payload = {}) {
  const loading = LOADING_ACTIONS_V33.has(action);
  if (loading) showGlobalLoaderV33(actionLabelV33(action));
  try {
    const response = await backendBaseV33(action, payload);

    // Pago primero, Central después. Si Central falla, el pago sigue guardado.
    if (response && response.ok && CENTRAL_SYNC_ACTIONS_V33.has(action)) {
      updateGlobalLoaderV33('Pago guardado. Actualizando Central…');
      try {
        const sync = await backendBaseV33('syncCentral', {
          sessionToken: payload.sessionToken || sessionStorage.getItem(SESSION_KEY),
          weekDate: syncWeekForActionV33(action, payload)
        });
        response.centralSync = sync;
        if (sync && sync.ok) showCentralSyncSummaryV33(sync);
        else if (sync && !sync.disabled && !sync.skipped) showCentralSyncWarningV33(sync.message || 'No se pudo actualizar la Central.');
      } catch (syncError) {
        response.centralSync = {ok:false, message:String(syncError && syncError.message || syncError)};
        showCentralSyncWarningV33('El abono sí quedó guardado, pero la Central no respondió. Podés reintentar la sincronización sin volver a registrar el pago.');
      }
    }
    return response;
  } finally {
    if (loading) hideGlobalLoaderV33();
  }
};
window.backend = backend;

function centralAccountLabelV33(id, syncKey) {
  const key = String(id || '').toLowerCase();
  const sync = String(syncKey || '').toLowerCase();
  const known = {
    omoda:'Omoda',
    coopealianza_nuevo:'Coopealianza',
    universidad_fondo:'Universidad',
    spark_blanco:'Seguro · Spark Blanco',
    spark_celeste:'Seguro · Spark Celeste',
    morning:'Seguro · Morning',
    i10:'Seguro · i10',
    accent:'Seguro · Accent',
    avante:'Seguro · Avante'
  };
  if (known[key]) return known[key];
  if (sync.startsWith('seguro_')) return 'Seguro · ' + String(id || syncKey || '').replace(/_/g,' ');
  return String(id || syncKey || 'Cuenta').replace(/_/g,' ');
}

function centralMovedRowsV33(sync) {
  if (Array.isArray(sync && sync.moved)) return sync.moved.filter(r => Math.abs(Number(r.delta || 0)) > .005);
  return Array.isArray(sync && sync.results) ? sync.results
    .filter(r => r.status === 'OK' && Math.abs(Number(r.delta || 0)) > .005)
    .map(r => ({
      syncKey:r.syncKey || '',
      centralAccountId:r.centralAccountId || '',
      beforeBalance:Number(r.beforeBalance != null ? r.beforeBalance : Number(r.newBalance || 0) - Number(r.delta || 0)),
      delta:Number(r.delta || 0),
      afterBalance:Number(r.newBalance || 0)
    })) : [];
}

function ensureCentralPopupV33() {
  let modal = document.getElementById('centralSyncPopupV33');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'centralSyncPopupV33';
  modal.className = 'centralSyncOverlayV33';
  modal.innerHTML = `
    <div class="centralSyncCardV33" role="dialog" aria-modal="true" aria-labelledby="centralSyncTitleV33">
      <div class="centralSyncCheckV33">✓</div>
      <h2 id="centralSyncTitleV33">Central actualizada</h2>
      <div id="centralSyncWeekV33" class="centralSyncSubV33"></div>
      <div id="centralSyncRowsV33" class="centralSyncRowsV33"></div>
      <div id="centralSyncInsuranceV33" class="centralSyncInsuranceV33"></div>
      <div class="centralSyncTotalV33"><span>Total para mover en el banco</span><strong id="centralSyncTotalV33">₡0</strong></div>
      <div id="centralSyncCorrectionV33" class="centralSyncCorrectionV33"></div>
      <div class="centralSyncNoteV33">La Central ya quedó actualizada. Este resumen es para hacer los movimientos reales en la aplicación bancaria.</div>
      <div class="centralSyncActionsV33"><button id="centralSyncCopyV33" type="button">Copiar total</button><button id="centralSyncCloseV33" type="button">Entendido</button></div>
    </div>`;
  document.body.appendChild(modal);

  if (!document.getElementById('centralSyncStyleV33')) {
    const style = document.createElement('style');
    style.id = 'centralSyncStyleV33';
    style.textContent = `
      .centralSyncOverlayV33{position:fixed;inset:0;z-index:14000;background:rgba(0,0,0,.62);display:none;align-items:center;justify-content:center;padding:18px}.centralSyncOverlayV33.show{display:flex}
      .centralSyncCardV33{width:min(620px,100%);max-height:88vh;overflow:auto;background:#fff;color:#172033;border-radius:20px;padding:22px;box-shadow:0 28px 80px rgba(0,0,0,.38);border:1px solid #d8eadf}
      .centralSyncCheckV33{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:#e8f5ec;color:#137333;font-size:28px;font-weight:900;margin-bottom:10px}.centralSyncCardV33 h2{margin:0;color:#137333}.centralSyncSubV33{color:#667085;font-size:12px;margin:5px 0 14px}
      .centralSyncRowsV33{display:grid;gap:8px}.centralSyncRowV33{display:grid;grid-template-columns:1fr auto;gap:8px;border:1px solid #e4e7ec;border-radius:12px;padding:11px 12px}.centralSyncRowV33 small{display:block;color:#667085;margin-top:3px}.centralSyncDeltaV33{font-weight:900;color:#137333;text-align:right}.centralSyncDeltaV33.negative{color:#b42318}
      .centralSyncInsuranceV33{margin-top:10px;padding:10px 12px;border-radius:11px;background:#f8fafc;color:#475467;font-size:12px}.centralSyncInsuranceV33:empty{display:none}
      .centralSyncTotalV33{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-top:14px;padding:15px;border-radius:13px;background:#e8f5ec;color:#0d522b}.centralSyncTotalV33 strong{font-size:24px}.centralSyncCorrectionV33{font-size:12px;color:#8a4b00;margin-top:8px}.centralSyncCorrectionV33:empty{display:none}
      .centralSyncNoteV33{font-size:12px;line-height:1.5;color:#475467;margin-top:13px}.centralSyncActionsV33{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.centralSyncActionsV33 button{padding:10px 13px;border:0;border-radius:9px;font-weight:800;cursor:pointer}.centralSyncActionsV33 button:first-child{background:#f2f4f7;color:#344054}.centralSyncActionsV33 button:last-child{background:#137333;color:#fff}
      body.dark .centralSyncCardV33{background:#111;color:#f5f5f5;border-color:#234a31}body.dark .centralSyncRowV33{border-color:#2a2a2a}body.dark .centralSyncSubV33,body.dark .centralSyncRowV33 small,body.dark .centralSyncNoteV33{color:#b8b8b8}body.dark .centralSyncInsuranceV33{background:#171717;color:#ccc}body.dark .centralSyncTotalV33{background:#12301e;color:#9ce5b6}
      .centralSyncWarningV33{position:fixed;right:18px;bottom:18px;z-index:14500;width:min(430px,calc(100% - 36px));background:#fff8e6;color:#7a4d00;border:1px solid #e8c66d;border-radius:14px;padding:14px 16px;box-shadow:0 18px 45px rgba(0,0,0,.22);font-size:12px;line-height:1.5}.centralSyncWarningV33 b{display:block;margin-bottom:4px}.centralSyncWarningV33 button{float:right;margin-top:8px;background:#7a4d00;color:#fff;border:0;border-radius:8px;padding:7px 10px;font-weight:800;cursor:pointer}
      @media(max-width:560px){.centralSyncRowV33{grid-template-columns:1fr}.centralSyncDeltaV33{text-align:left}.centralSyncActionsV33{flex-direction:column}.centralSyncActionsV33 button{width:100%}}
    `;
    document.head.appendChild(style);
  }
  document.getElementById('centralSyncCloseV33').onclick = () => modal.classList.remove('show');
  return modal;
}

function showCentralSyncSummaryV33(sync) {
  const moved = centralMovedRowsV33(sync);
  if (!moved.length) return;
  const modal = ensureCentralPopupV33();
  const totalAdded = Number(sync.totalAdded != null ? sync.totalAdded : moved.reduce((s,r)=>s+Math.max(0,Number(r.delta||0)),0));
  const totalRemoved = Number(sync.totalRemoved != null ? sync.totalRemoved : moved.reduce((s,r)=>s+Math.max(0,-Number(r.delta||0)),0));
  const insuranceTotal = moved.filter(r => String(r.syncKey || '').toLowerCase().startsWith('seguro_')).reduce((s,r)=>s+Number(r.delta||0),0);

  document.getElementById('centralSyncWeekV33').textContent = sync.weekDate ? `Semana ${fmtShort(sync.weekDate)}` : 'Movimiento generado desde Flotilla';
  document.getElementById('centralSyncRowsV33').innerHTML = moved.map(r => {
    const delta = Number(r.delta || 0), before = Number(r.beforeBalance || 0), after = Number(r.afterBalance || 0);
    return `<div class="centralSyncRowV33"><div><b>${escapeHtmlV3(centralAccountLabelV33(r.centralAccountId,r.syncKey))}</b><small>Antes ${money(before)} → ahora ${money(after)}</small></div><div class="centralSyncDeltaV33 ${delta<0?'negative':''}">${delta>=0?'+':'−'}${money(Math.abs(delta))}</div></div>`;
  }).join('');
  document.getElementById('centralSyncInsuranceV33').textContent = Math.abs(insuranceTotal) > .005 ? `Seguros actualizados en total: ${insuranceTotal>=0?'+':'−'}${money(Math.abs(insuranceTotal))}` : '';
  document.getElementById('centralSyncTotalV33').textContent = money(totalAdded);
  document.getElementById('centralSyncCorrectionV33').textContent = totalRemoved > .005 ? `También hubo una corrección/reversa por ${money(totalRemoved)}. No la sumés al movimiento nuevo.` : '';
  document.getElementById('centralSyncCopyV33').onclick = async () => {
    const text = `Total movimiento Flotilla → cuentas: ${money(totalAdded)}`;
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('centralSyncCopyV33');
      btn.textContent = 'Copiado ✓';
      setTimeout(()=>btn.textContent='Copiar total',1200);
    } catch(e) { alert(text); }
  };
  modal.classList.add('show');
}

function showCentralSyncWarningV33(message) {
  let box = document.getElementById('centralSyncWarningV33');
  if (!box) {
    box = document.createElement('div');
    box.id = 'centralSyncWarningV33';
    box.className = 'centralSyncWarningV33';
    document.body.appendChild(box);
  }
  box.innerHTML = `<b>Pago guardado; Central pendiente</b>${escapeHtmlV3(message || 'No se pudo sincronizar.') }<br><button type="button">Cerrar</button>`;
  box.querySelector('button').onclick = () => box.remove();
}

window.showCentralSyncSummaryV33 = showCentralSyncSummaryV33;
window.showCentralSyncWarningV33 = showCentralSyncWarningV33;
window.showGlobalLoaderV33 = showGlobalLoaderV33;
window.hideGlobalLoaderV33 = hideGlobalLoaderV33;
