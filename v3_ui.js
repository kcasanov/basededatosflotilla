'use strict';

// V3: pagos parciales + configuración operativa + Plan de pagos/Uber.
// No contiene datos de vehículos, choferes ni pestañas: todo se carga desde Google Sheets.

let v3Data = { vehicles: [], payments: [], uberWeeks: [], planSnapshots: [], availablePlanTabs: [] };
let v3BackendReady = false;
let v3PaymentTarget = null;
let v3ActiveUberVehicleId = '';
let v3OcrText = '';

function v3InjectUI() {
  const style = document.createElement('style');
  style.textContent = `
  .v3grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.v3card{border:1px solid var(--l);border-radius:14px;padding:14px;background:#fff;cursor:pointer}.v3card:hover{transform:translateY(-1px)}
  .v3card h3{margin:0 0 4px}.v3muted{font-size:12px;color:var(--m)}.v3money{font-size:22px;font-weight:900;margin-top:9px}.v3row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--l)}
  .v3pill{display:inline-block;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:900}.v3pill.uber{background:#e8f5ec;color:#137333}.v3pill.personal{background:#eef4fb;color:#305a8a}.v3pill.warn{background:#fff4e5;color:#9a6700}
  .v3actions{display:flex;gap:6px;flex-wrap:wrap}.v3small{padding:7px 9px;font-size:11px}.v3configTable{min-width:1280px}.v3configTable input,.v3configTable select{min-width:120px;padding:7px;font-size:12px}
  .v3receipt{background:#fff;color:#111;border:1px solid #ddd;border-radius:14px;padding:18px;max-width:520px}.v3receipt h2{margin:0 0 4px;color:#111}.v3receipt table{min-width:0}.v3receipt th{background:#111;color:#fff}.v3receipt td,.v3receipt th{font-size:14px;padding:10px}.v3receipt td:last-child{text-align:right;font-weight:800}
  .v3pendingCard{border-left:4px solid #d7b928}.v3upload{border:1px dashed #b8bec8;border-radius:12px;padding:14px;text-align:center}.v3split{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  body.dark .v3card{background:#0f0f10;border-color:#242424}.body.dark .v3muted{color:#aaa}body.dark .v3receipt{background:#fff;color:#111}
  @media(max-width:900px){.v3grid{grid-template-columns:1fr 1fr}.v3split{grid-template-columns:1fr}}@media(max-width:600px){.v3grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const headerFlex = document.querySelector('.headerFlex');
  if(headerFlex){const version=[...headerFlex.querySelectorAll('div')].find(x=>x.textContent&&x.textContent.includes('V2.2'));if(version)version.textContent=version.textContent.replace('V2.2','V3.0');}
  if (headerFlex && !document.getElementById('v3ConfigBtn')) {
    const group = document.createElement('div');
    group.className = 'actions'; group.style.marginTop='0';
    const config = document.createElement('button'); config.id='v3ConfigBtn'; config.className='themeToggle'; config.textContent='⚙️ Configuración';
    const theme = document.getElementById('themeToggle');
    if (theme) { theme.parentNode.insertBefore(group, theme); group.appendChild(config); group.appendChild(theme); }
    else { group.appendChild(config); headerFlex.appendChild(group); }
  }

  const nav = document.querySelector('.nav');
  if (nav && !document.querySelector('[data-v="planpagos"]')) {
    const btn=document.createElement('button'); btn.className='light navbtn'; btn.dataset.v='planpagos'; btn.textContent='Uber / Plan de pagos';
    const semana=nav.querySelector('[data-v="semana"]'); semana ? semana.insertAdjacentElement('afterend',btn) : nav.appendChild(btn);
  }

  const wrap=document.querySelector('#appShell .wrap:last-of-type');
  if (wrap && !document.getElementById('planpagos')) {
    const section=document.createElement('section'); section.id='planpagos'; section.className='view';
    section.innerHTML=`
      <div class="card">
        <div class="sectionHead"><div><h2>Uber / Plan de pagos</h2><div class="status">Control interno conectado al mismo estado de cobro de Semana actual.</div></div><button id="v3RefreshPlan" class="light">Actualizar</button></div>
        <div id="v3PlanNotice" class="note" style="display:none"></div>
        <div id="v3PlanCards" class="v3grid" style="margin-top:14px"></div>
      </div>
      <div id="v3PlanDetail"></div>`;
    const veh=document.getElementById('vehiculos'); veh ? wrap.insertBefore(section,veh) : wrap.appendChild(section);
  }

  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal" id="v3PaymentModal"><div class="modalCard">
    <div class="sectionHead"><div><h2>Registrar abono</h2><div id="v3PaymentSub" class="status"></div></div><button class="light" onclick="v3ClosePaymentModal()">Cerrar</button></div>
    <div id="v3PaymentInfo" class="note"></div>
    <label>Monto recibido</label><input id="v3PaymentAmount" type="number" min="1" step="1000">
    <label style="margin-top:10px">Nota (opcional)</label><input id="v3PaymentNote" placeholder="Ej. Abono parcial">
    <div class="actions"><button id="v3SavePayment" class="dark">Guardar abono</button><button id="v3CompletePayment" class="light">Completar saldo</button></div>
    <div id="v3PaymentStatus" class="status"></div>
  </div></div>

  <div class="modal" id="v3MovementsModal"><div class="modalCard wideModal">
    <div class="sectionHead"><div><h2>Historial de abonos</h2><div id="v3MovementsSub" class="status"></div></div><button class="light" onclick="v3CloseMovements()">Cerrar</button></div>
    <div id="v3MovementsList"></div>
  </div></div>

  <div class="modal" id="v3ConfigModal"><div class="modalCard wideModal">
    <div class="sectionHead"><div><h2>⚙️ Cuentas activas</h2><div class="status">Configuración ocasional: chofer, tipo de cobro y vínculo con Plan de pagos.</div></div><button class="light" onclick="v3CloseConfig()">Cerrar</button></div>
    <div id="v3ConfigNotice" class="note"></div><div class="table" style="margin-top:12px"><table class="v3configTable"><thead><tr><th>Vehículo</th><th>Placa</th><th>Chofer</th><th>Tipo</th><th>Tab Plan</th><th>Integración</th><th>Estado</th><th>Guardar</th></tr></thead><tbody id="v3ConfigBody"></tbody></table></div>
  </div></div>

  <div class="modal" id="v3UberModal"><div class="modalCard wideModal">
    <div class="sectionHead"><div><h2 id="v3UberTitle">Actualizar Uber</h2><div id="v3UberSub" class="status"></div></div><button class="light" onclick="v3CloseUber()">Cerrar</button></div>
    <div class="v3split">
      <div>
        <div class="v3upload"><b>Screenshot de Uber</b><div class="v3muted" style="margin:5px 0 10px">Se procesa en este navegador. Siempre podés corregir los valores antes de guardar.</div><input id="v3UberImage" type="file" accept="image/*"><button id="v3ReadUber" class="light" style="margin-top:8px">Leer screenshot</button><div id="v3OcrStatus" class="status"></div></div>
        <div class="grid" style="margin-top:12px">
          <div><label>Semana</label><input id="v3UberWeek" type="number"></div><div><label>Fecha programada</label><input id="v3UberDate" type="date"></div>
          <div><label>Ganancias totales</label><input id="v3UberGains" type="number" step="0.01"></div><div><label>Devoluciones y gastos</label><input id="v3UberRefunds" type="number" step="0.01"></div>
          <div><label>Ajustes periodos anteriores</label><input id="v3UberAdjustments" type="number" step="0.01"></div><div><label>Efectivo al chofer (Ganancias)</label><input id="v3UberCash" type="number" step="0.01"></div>
        </div>
        <div id="v3UberCarry" class="note"></div>
        <div class="actions"><button id="v3SaveUber" class="dark">Guardar semana</button><button id="v3CaptureUber" class="light" disabled>Capturar comprobante</button></div><div id="v3UberSaveStatus" class="status"></div>
      </div>
      <div><div id="v3UberReceipt" class="v3receipt"><h2>Plan de pagos</h2><div id="v3ReceiptSub" class="v3muted"></div><table><tbody id="v3ReceiptRows"></tbody></table></div></div>
    </div>
  </div></div>`);
}

v3InjectUI();