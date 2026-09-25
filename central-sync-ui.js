'use strict';

/* V3.2 · Resumen visual de sincronización Flotilla → Central */
const backendV31Central = backend;
backend = async function(action, payload = {}) {
  const response = await backendV31Central(action, payload);
  if (response && response.centralSync) {
    const sync = response.centralSync;
    setTimeout(() => showCentralSyncSummaryV32(sync), 350);
  }
  return response;
};
window.backend = backend;

function centralAccountLabelV32(id, syncKey) {
  const key = String(id || '').toLowerCase();
  const sync = String(syncKey || '').toLowerCase();
  const known = {
    omoda: 'Omoda',
    coopealianza_nuevo: 'Coopealianza',
    universidad_fondo: 'Universidad',
    spark_blanco: 'Seguro · Spark Blanco',
    spark_celeste: 'Seguro · Spark Celeste',
    morning: 'Seguro · Morning',
    i10: 'Seguro · i10',
    accent: 'Seguro · Accent',
    avante: 'Seguro · Avante'
  };
  if (known[key]) return known[key];
  if (sync.startsWith('seguro_')) return 'Seguro · ' + String(id || syncKey || '').replace(/_/g, ' ');
  return String(id || syncKey || 'Cuenta').replace(/_/g, ' ');
}

function centralMovedRowsV32(sync) {
  if (Array.isArray(sync && sync.moved)) return sync.moved.filter(r => Math.abs(Number(r.delta || 0)) > .005);
  return Array.isArray(sync && sync.results) ? sync.results
    .filter(r => r.status === 'OK' && Math.abs(Number(r.delta || 0)) > .005)
    .map(r => ({
      syncKey: r.syncKey || '',
      centralAccountId: r.centralAccountId || '',
      beforeBalance: Number(r.newBalance || 0) - Number(r.delta || 0),
      delta: Number(r.delta || 0),
      afterBalance: Number(r.newBalance || 0)
    })) : [];
}

function showCentralSyncSummaryV32(sync) {
  const moved = centralMovedRowsV32(sync);
  if (!moved.length) return;

  let modal = document.getElementById('centralSyncPopupV32');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'centralSyncPopupV32';
    modal.className = 'centralSyncOverlayV32';
    modal.innerHTML = `
      <div class="centralSyncCardV32" role="dialog" aria-modal="true" aria-labelledby="centralSyncTitleV32">
        <div class="centralSyncCheckV32">✓</div>
        <h2 id="centralSyncTitleV32">Central actualizada</h2>
        <div id="centralSyncWeekV32" class="centralSyncSubV32"></div>
        <div id="centralSyncRowsV32" class="centralSyncRowsV32"></div>
        <div id="centralSyncInsuranceV32" class="centralSyncInsuranceV32"></div>
        <div class="centralSyncTotalV32">
          <span>Total para mover en el banco</span>
          <strong id="centralSyncTotalV32">₡0</strong>
        </div>
        <div id="centralSyncCorrectionV32" class="centralSyncCorrectionV32"></div>
        <div class="centralSyncNoteV32">La Central ya quedó actualizada. Este resumen es para que hagás los movimientos reales en la aplicación bancaria.</div>
        <div class="centralSyncActionsV32"><button id="centralSyncCopyV32" type="button">Copiar total</button><button id="centralSyncCloseV32" type="button">Entendido</button></div>
      </div>`;
    document.body.appendChild(modal);

    const style = document.createElement('style');
    style.id = 'centralSyncStyleV32';
    style.textContent = `
      .centralSyncOverlayV32{position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.62);display:none;align-items:center;justify-content:center;padding:18px}.centralSyncOverlayV32.show{display:flex}
      .centralSyncCardV32{width:min(620px,100%);max-height:88vh;overflow:auto;background:#fff;color:#172033;border-radius:20px;padding:22px;box-shadow:0 28px 80px rgba(0,0,0,.38);border:1px solid #d8eadf}
      .centralSyncCheckV32{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:#e8f5ec;color:#137333;font-size:28px;font-weight:900;margin-bottom:10px}.centralSyncCardV32 h2{margin:0;color:#137333}.centralSyncSubV32{color:#667085;font-size:12px;margin:5px 0 14px}
      .centralSyncRowsV32{display:grid;gap:8px}.centralSyncRowV32{display:grid;grid-template-columns:1fr auto;gap:8px;border:1px solid #e4e7ec;border-radius:12px;padding:11px 12px}.centralSyncRowV32 small{display:block;color:#667085;margin-top:3px}.centralSyncDeltaV32{font-weight:900;color:#137333;text-align:right}.centralSyncDeltaV32.negative{color:#b42318}
      .centralSyncInsuranceV32{margin-top:10px;padding:10px 12px;border-radius:11px;background:#f8fafc;color:#475467;font-size:12px}.centralSyncInsuranceV32:empty{display:none}
      .centralSyncTotalV32{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-top:14px;padding:15px;border-radius:13px;background:#e8f5ec;color:#0d522b}.centralSyncTotalV32 strong{font-size:24px}.centralSyncCorrectionV32{font-size:12px;color:#8a4b00;margin-top:8px}.centralSyncCorrectionV32:empty{display:none}
      .centralSyncNoteV32{font-size:12px;line-height:1.5;color:#475467;margin-top:13px}.centralSyncActionsV32{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.centralSyncActionsV32 button{padding:10px 13px;border:0;border-radius:9px;font-weight:800;cursor:pointer}.centralSyncActionsV32 button:first-child{background:#f2f4f7;color:#344054}.centralSyncActionsV32 button:last-child{background:#137333;color:#fff}
      body.dark .centralSyncCardV32{background:#111;color:#f5f5f5;border-color:#234a31}.centralSyncCardV32 body.dark{}body.dark .centralSyncRowV32{border-color:#2a2a2a}body.dark .centralSyncSubV32,body.dark .centralSyncRowV32 small,body.dark .centralSyncNoteV32{color:#b8b8b8}body.dark .centralSyncInsuranceV32{background:#171717;color:#ccc}body.dark .centralSyncTotalV32{background:#12301e;color:#9ce5b6}
      @media(max-width:560px){.centralSyncRowV32{grid-template-columns:1fr}.centralSyncDeltaV32{text-align:left}.centralSyncActionsV32{flex-direction:column}.centralSyncActionsV32 button{width:100%}}
    `;
    document.head.appendChild(style);
    document.getElementById('centralSyncCloseV32').onclick = () => modal.classList.remove('show');
  }

  const totalAdded = Number(sync.totalAdded != null ? sync.totalAdded : moved.reduce((s,r)=>s+Math.max(0,Number(r.delta||0)),0));
  const totalRemoved = Number(sync.totalRemoved != null ? sync.totalRemoved : moved.reduce((s,r)=>s+Math.max(0,-Number(r.delta||0)),0));
  const insuranceTotal = moved.filter(r => String(r.syncKey || '').toLowerCase().startsWith('seguro_')).reduce((s,r)=>s+Number(r.delta||0),0);

  document.getElementById('centralSyncWeekV32').textContent = sync.weekDate ? `Semana ${fmtShort(sync.weekDate)}` : 'Movimiento generado desde Flotilla';
  document.getElementById('centralSyncRowsV32').innerHTML = moved.map(r => {
    const delta = Number(r.delta || 0), before = Number(r.beforeBalance || 0), after = Number(r.afterBalance || 0);
    return `<div class="centralSyncRowV32"><div><b>${escapeHtmlV3(centralAccountLabelV32(r.centralAccountId,r.syncKey))}</b><small>Antes ${money(before)} → ahora ${money(after)}</small></div><div class="centralSyncDeltaV32 ${delta<0?'negative':''}">${delta>=0?'+':'−'}${money(Math.abs(delta))}</div></div>`;
  }).join('');
  document.getElementById('centralSyncInsuranceV32').textContent = Math.abs(insuranceTotal) > .005 ? `Seguros actualizados en total: ${insuranceTotal>=0?'+':'−'}${money(Math.abs(insuranceTotal))}` : '';
  document.getElementById('centralSyncTotalV32').textContent = money(totalAdded);
  document.getElementById('centralSyncCorrectionV32').textContent = totalRemoved > .005 ? `También hubo una corrección/reversa por ${money(totalRemoved)}. Revisá esa devolución por separado.` : '';
  document.getElementById('centralSyncCopyV32').onclick = async () => {
    const text = `Total movimiento Flotilla → cuentas: ${money(totalAdded)}`;
    try { await navigator.clipboard.writeText(text); document.getElementById('centralSyncCopyV32').textContent='Copiado ✓'; setTimeout(()=>document.getElementById('centralSyncCopyV32').textContent='Copiar total',1200); }
    catch(e) { alert(text); }
  };
  modal.classList.add('show');
}

window.showCentralSyncSummaryV32 = showCentralSyncSummaryV32;
