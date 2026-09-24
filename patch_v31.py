from pathlib import Path

APP_V3_MARK = '/* V3.1 · Danny first, abonos desde Uber, gastos editables */'

app = Path('app-v3.js')
s = app.read_text(encoding='utf-8')
if APP_V3_MARK not in s:
    s += r'''

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
'''
app.write_text(s, encoding='utf-8')

code = Path('Code.gs')
c = code.read_text(encoding='utf-8')
if "case 'updateAccount':" not in c:
    marker = "      case 'updateVehicleConfig': result = protected_(body, updateVehicleConfig_); break;"
    if marker not in c:
        raise SystemExit('No se encontró el switch de updateVehicleConfig')
    c = c.replace(marker, marker + "\n      case 'updateAccount': result = protected_(body, updateAccount_); break;", 1)

if 'function updateAccount_(' not in c:
    c += r'''

function updateAccount_(body,device){
  const accountId=String(body.accountId||'').trim();
  if(!accountId)return{ok:false,message:'Cuenta requerida.'};
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID),sh=ss.getSheetByName('Cuentas');
  const values=sh.getDataRange().getValues(),headers=values[0].map(String),idx={};headers.forEach((h,i)=>idx[h]=i);
  let row=-1;for(let r=1;r<values.length;r++)if(String(values[r][idx.CuentaID])===accountId){row=r+1;break;}
  if(row<0)return{ok:false,message:'Cuenta no encontrada.'};
  const type=String(body.tipo||'SEMANAL').toUpperCase(),priority=String(body.prioridad||'BAJA').toUpperCase();
  if(['SEMANAL','AUTOMATICO_PLAN','REMANENTE'].indexOf(type)<0)return{ok:false,message:'Tipo de cuenta inválido.'};
  if(['CRITICA','MEDIA','BAJA'].indexOf(priority)<0)return{ok:false,message:'Prioridad inválida.'};
  const amount=Math.max(0,num_(body.monto)),order=Math.max(1,Math.round(num_(body.orden)||1));
  const name=String(body.nombre||'').trim();if(!name)return{ok:false,message:'Nombre requerido.'};
  const from=String(body.vigenteDesde||''),to=String(body.vigenteHasta||'');
  sh.getRange(row,idx.Nombre+1).setValue(name);
  sh.getRange(row,idx.Tipo+1).setValue(type);
  sh.getRange(row,idx.Monto+1).setValue(type==='SEMANAL'?amount:0);
  sh.getRange(row,idx.Prioridad+1).setValue(priority);
  sh.getRange(row,idx.Orden+1).setValue(order);
  sh.getRange(row,idx.VigenteDesde+1).setValue(from);
  sh.getRange(row,idx.VigenteHasta+1).setValue(to);
  log_('CUENTA',accountId,'UPDATE_ACCOUNT',JSON.stringify({name:name,type:type,amount:type==='SEMANAL'?amount:0,priority:priority,order:order,from:from,to:to}),device);
  return{ok:true};
}
'''
code.write_text(c, encoding='utf-8')

index = Path('index.html')
h = index.read_text(encoding='utf-8')
h = h.replace('Administración personal · V3.0','Administración personal · V3.1')
h = h.replace('./app.js?v=3.0','./app.js?v=3.1')
h = h.replace('./app-v3.js?v=3.0','./app-v3.js?v=3.1')
index.write_text(h, encoding='utf-8')
