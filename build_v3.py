from pathlib import Path
import base64, gzip, shutil

src = Path('index.html').read_text(encoding='utf-8')

css = r'''

/* V3 · pagos parciales, Uber y configuración */
.statuspill.partial{background:#fff6d8;color:#8a6500}
.rowActions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.miniBtn{padding:6px 9px;font-size:11px}
.vehicleControlCard{background:#fff;border:1px solid var(--l);border-radius:16px;margin-bottom:12px;overflow:hidden}
.vehicleCardHead{width:100%;display:flex;justify-content:space-between;gap:16px;align-items:center;text-align:left;background:transparent;color:inherit;padding:16px 18px;border-radius:0}
.vehicleCardHead span{display:grid;gap:4px}.vehicleCardHead small{font-weight:600;color:var(--m)}.cardTotals{text-align:right}.cardTotals b{font-size:18px;color:var(--n)}
.vehicleCardBody{padding:0 18px 18px;border-top:1px solid var(--l)}.vehicleCardBody.collapsed{display:none}.uberLayout{display:grid;grid-template-columns:.9fr 1.1fr;gap:16px;padding-top:16px}
.legacySummary{border:1px solid var(--l);border-radius:13px;overflow:hidden}.legacyRow{display:flex;justify-content:space-between;gap:16px;padding:11px 13px;border-bottom:1px solid var(--l);font-size:13px}.legacyRow:last-child{border-bottom:0}.legacyBalance{background:#f8fafc}.legacyRow b{color:var(--n)}
.uberForm{background:#f8fafc;border:1px solid var(--l);border-radius:13px;padding:14px}.uberInputGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.pendingWeeks{margin-top:14px}.pendingWeekLine{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--l);font-size:12px}.pendingWeekLine b{color:#b42318}
.movementList{display:grid;gap:6px;margin-top:10px}.movementRow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--l);font-size:12px}.smallPlaceholder{padding:14px}.configTable{min-width:1100px}.configTable input,.configTable select{min-width:120px;padding:7px;font-size:12px}
.headerActions{display:flex;gap:8px;align-items:center}.configButton{background:#171717;color:#d7b928;border:1px solid #3b2f0c}
body.dark .vehicleControlCard,body.dark .uberForm,body.dark .legacySummary{background:#0f0f10;color:#f5f5f5;border-color:#242424}body.dark .vehicleCardHead small{color:#aaa}body.dark .cardTotals b,body.dark .legacyRow b{color:#fff}body.dark .legacyBalance{background:#151515}body.dark .pendingWeekLine,body.dark .legacyRow,body.dark .vehicleCardBody,body.dark .movementRow{border-color:#242424}body.dark .uberForm{background:#111}
@media(max-width:850px){.uberLayout{grid-template-columns:1fr}.pendingWeekLine{grid-template-columns:1fr auto}.pendingWeekLine button{grid-column:1/-1}.vehicleCardHead{align-items:flex-start}.uberInputGrid{grid-template-columns:1fr}}
'''
if '/* V3 · pagos parciales' not in src:
    src = src.replace('</style>', css + '\n</style>', 1)

src = src.replace('Administración personal · V2.2', 'Administración personal · V3.0')
src = src.replace('<button id="themeToggle" class="themeToggle">🌙 Modo oscuro</button>', '<div class="headerActions"><button id="configButton" class="configButton" type="button">⚙️ Configuración</button><button id="themeToggle" class="themeToggle">🌙 Modo oscuro</button></div>')
src = src.replace('<button class="dark navbtn" data-v="resumen">Resumen</button><button class="light navbtn" data-v="semana">Semana actual</button>', '<button class="dark navbtn" data-v="resumen">Resumen</button><button class="light navbtn" data-v="semana">Semana actual</button><button class="light navbtn" data-v="uber">Uber / Plan de pagos</button>')
src = src.replace('<thead><tr><th>Estado</th><th>Vehículo</th><th>Fecha esperada</th><th>Esperado</th><th>Recibido</th><th>Fecha real</th><th>Acción</th></tr></thead>', '<thead><tr><th>Estado</th><th>Vehículo</th><th>Fecha esperada</th><th>Esperado</th><th>Recibido</th><th>Pendiente</th><th>Fecha real</th><th>Acción</th></tr></thead>')

insertion = r'''
<div class="modal" id="paymentModal">
  <div class="modalCard">
    <h2 id="paymentModalTitle">Registrar abono</h2>
    <div id="paymentModalInfo" class="note"></div>
    <label>Monto recibido</label><input id="paymentAmount" type="number" min="0" step="1000" inputmode="numeric">
    <label style="margin-top:10px">Nota (opcional)</label><input id="paymentNote" placeholder="Ej. Abono parcial">
    <h3>Movimientos registrados</h3><div id="paymentHistory"></div>
    <div class="actions"><button id="savePaymentButton" class="dark">Registrar abono</button><button id="cancelPaymentButton" class="light">Cancelar</button></div>
  </div>
</div>
</section>

<section id="uber" class="view">
  <div class="card">
    <div class="sectionHead"><div><h2>Uber / Plan de pagos</h2><div class="status">Centro de control semanal. Los pagos se sincronizan con Semana actual y el plan visible a clientes.</div></div><button class="light" onclick="loadPlanDashboardV3(true)">Actualizar</button></div>
    <div class="note">Uber muestra el cuadro del plan y permite cargar el screenshot semanal. Uso personal permanece compacto para evitar ruido.</div>
  </div>
  <div id="uberCards"><div class="placeholder">Abrí esta pestaña para cargar las cuentas.</div></div>
</section>

<section id="vehiculos" class="view">'''
marker = '</section>\n\n<section id="vehiculos" class="view">'
if '<section id="uber" class="view">' not in src:
    if marker not in src:
        raise RuntimeError('No se encontró punto de inserción Uber')
    src = src.replace(marker, insertion, 1)

config = r'''
<div class="modal" id="configModal">
  <div class="modalCard wideModal">
    <div class="sectionHead"><div><h2>⚙️ Configuración</h2><div class="status">Datos operativos que normalmente solo se configuran una vez.</div></div><button id="closeConfigButton" class="light">Cerrar</button></div>
    <div class="table" style="margin-top:14px"><table class="configTable"><thead><tr><th>Vehículo</th><th>Placa</th><th>Chofer</th><th>Tipo</th><th>Tab Plan pagos</th><th>Estado</th><th>Sincronizar plan</th><th>Acción</th></tr></thead><tbody id="configVehiclesBody"></tbody></table></div>
    <div class="note">Al finalizar o cancelar un contrato, no se elimina el historial: solo deja de aparecer en la operación diaria.</div>
  </div>
</div>
'''
script_marker = '<script src="/app.js?v=2.2"></script>'
if 'id="configModal"' not in src:
    src = src.replace(script_marker, config + '\n<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" defer></script>\n<script src="/app.js?v=3.0"></script>\n<script src="/app-v3.js?v=3.0"></script>')

Path('dist').mkdir(exist_ok=True)
Path('dist/index.html').write_text(src, encoding='utf-8')
shutil.copy2('app.js', 'dist/app.js')
raw = Path('.v3/app-v3.js.gz.b64').read_text().strip()
Path('dist/app-v3.js').write_bytes(gzip.decompress(base64.b64decode(raw)))
print('V3 build listo')
