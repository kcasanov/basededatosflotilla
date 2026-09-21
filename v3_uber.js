'use strict';
function v3SnapshotFor(vehicleId){return v3Data.planSnapshots.find(x=>String(x.vehicleId)===String(vehicleId));}
function v3WeekNumberForEvent(v,event){const schedule=fullScheduleForVehicle(v);const i=schedule.findIndex(x=>x.date===event.date);return i>=0?i+1:0;}
function v3OpenUber(vehicleId,encodedKey){
  const v=contractVehicles.find(x=>x.id===vehicleId);if(!v)return;v3ActiveUberVehicleId=vehicleId;v3OcrText='';
  const current=rowsForCurrentWeek().find(x=>x.vehicleId===vehicleId),late=vehicleLateRows(v),snap=v3SnapshotFor(vehicleId),box=snap&&snap.box||[];
  const weekFromBox=Number((box[0]&&box[0][1]||'').toString().replace(/[^0-9.-]/g,''))||0;
  const requested=encodedKey?v3FindScheduledByKey(decodeURIComponent(encodedKey)):null;
  const event=requested||current||late[late.length-1]||null;const week=event?(event.week||v3WeekNumberForEvent(v,event)):weekFromBox;
  $('v3UberTitle').textContent=v.name+' · Uber';$('v3UberSub').textContent=(v.driver||'Sin chofer')+(v.planTab?' · '+v.planTab:'');$('v3UberWeek').value=week||weekFromBox||'';$('v3UberDate').value=event?event.date:'';
  $('v3UberGains').value=v3NumFromDisplay(box[1]&&box[1][1]);$('v3UberRefunds').value=0;$('v3UberAdjustments').value=0;$('v3UberCash').value=v3NumFromDisplay(box[3]&&box[3][1]);
  const carry=v3CarryForTarget(v,$('v3UberDate').value,week,snap);$('v3UberCarry').innerHTML=`Saldo arrastrado que entrará en Reembolsos: <b>${money(carry)}</b>. Si es negativo, se mantiene aunque el screenshot tenga devoluciones en ₡0.`;
  $('v3UberSaveStatus').textContent='';$('v3CaptureUber').disabled=true;v3RenderReceiptFromInputs(v,carry);$('v3UberModal').classList.add('show');
}
function v3CloseUber(){$('v3UberModal').classList.remove('show');v3ActiveUberVehicleId='';}
function v3LatestUberWeek(vehicleId,beforeDate){return v3Data.uberWeeks.filter(x=>String(x.VehicleID)===String(vehicleId)&&(!beforeDate||normalizeSheetDate(x.FechaProgramada)<beforeDate)).sort((a,b)=>normalizeSheetDate(b.FechaProgramada).localeCompare(normalizeSheetDate(a.FechaProgramada)))[0]||null;}
function v3CarryForTarget(v,date,week,snap){const last=v3LatestUberWeek(v.id,date);if(last)return Math.min(0,Number(last.SaldoSemana||0));const box=snap&&snap.box||[],boxWeek=Number((box[0]&&box[0][1]||'').toString().replace(/[^0-9.-]/g,''))||0,boxSaldo=v3NumFromDisplay(box[5]&&box[5][1]);return boxWeek&&Number(week||0)>boxWeek?Math.min(0,boxSaldo):0;}
function v3NumFromDisplay(x){if(typeof x==='number')return x;let s=String(x||'').replace(/[^0-9,.-]/g,'');if(!s)return 0;if(s.includes(',')&&s.includes('.')){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(s.includes(','))s=s.replace(',','.');return Number(s)||0;}
function v3RenderReceiptFromInputs(v,carryOverride){
  if(!v)return;const snap=v3SnapshotFor(v.id),box=snap&&snap.box||[],week=Number($('v3UberWeek').value||0),g=Number($('v3UberGains').value||0),refund=Number($('v3UberRefunds').value||0),adj=Number($('v3UberAdjustments').value||0),cash=Number($('v3UberCash').value||0),carry=carryOverride!==undefined?carryOverride:v3CarryForTarget(v,$('v3UberDate').value,week,snap),quota=v3NumFromDisplay(box[4]&&box[4][1])||v.weekly,reim=refund+adj+carry,saldo=g+reim-cash-quota;
  $('v3ReceiptSub').textContent=`${v.name} · Semana ${week||'—'}`;$('v3ReceiptRows').innerHTML=`<tr><td>Ganancias Totales</td><td>${money(g)}</td></tr><tr><td>Reembolsos</td><td>${money(reim)}</td></tr><tr><td>Efectivo</td><td>${money(cash)}</td></tr><tr><td>Cuota</td><td>${money(quota)}</td></tr><tr><td>Saldo Semana</td><td>${money(saldo)}</td></tr>`;
}

async function v3EnsureLib(src,globalName){if(window[globalName])return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('No se pudo cargar '+globalName));document.head.appendChild(s);});}
function v3ParseUberOcr(text){
  const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const find=(terms)=>{for(const line of lines){const n=norm(line);if(terms.some(t=>n.includes(t))){const nums=line.match(/[-+]?\s*[₡$]?\s*[0-9][0-9.,\s]*/g);if(nums&&nums.length)return v3NumFromDisplay(nums[nums.length-1]);}}return 0;};
  return {gains:find(['ganancias totales']),refunds:find(['devoluciones y gastos','devoluciones']),adjustments:find(['ajustes de periodos anteriores','ajustes de periodo','ajustes anteriores']),cash:find(['ganancias'])};
}
async function v3ReadUberScreenshot(){
  const file=$('v3UberImage').files&&$('v3UberImage').files[0];if(!file){$('v3OcrStatus').textContent='Seleccioná una imagen primero.';return;}
  $('v3OcrStatus').textContent='Leyendo screenshot…';
  try{await v3EnsureLib('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');const result=await Tesseract.recognize(file,'spa',{logger:m=>{if(m.status==='recognizing text')$('v3OcrStatus').textContent='Leyendo… '+Math.round((m.progress||0)*100)+'%';}});v3OcrText=result.data.text||'';const p=v3ParseUberOcr(v3OcrText);$('v3UberGains').value=p.gains||0;$('v3UberRefunds').value=p.refunds||0;$('v3UberAdjustments').value=p.adjustments||0;$('v3UberCash').value=p.cash||0;$('v3OcrStatus').textContent='Listo. Revisá los números antes de guardar.';v3RenderReceiptFromInputs(contractVehicles.find(v=>v.id===v3ActiveUberVehicleId));}catch(e){$('v3OcrStatus').textContent='No pude leerla automáticamente. Podés llenar los campos manualmente.';console.warn(e);}
}
async function v3SaveUber(){
  const v=contractVehicles.find(x=>x.id===v3ActiveUberVehicleId);if(!v)return;$('v3UberSaveStatus').textContent='Guardando y sincronizando…';
  try{const r=await backend('saveUberWeek',{sessionToken:sessionStorage.getItem(SESSION_KEY),vehicleId:v.id,semana:Number($('v3UberWeek').value||0),fechaProgramada:$('v3UberDate').value,gananciasTotales:Number($('v3UberGains').value||0),devolucionesGastos:Number($('v3UberRefunds').value||0),ajustesAnteriores:Number($('v3UberAdjustments').value||0),efectivoChofer:Number($('v3UberCash').value||0),ocrTexto:v3OcrText});if(!r.ok)throw new Error(r.message||'No se pudo guardar');$('v3UberCarry').innerHTML=`Saldo arrastrado de entrada: <b>${money(r.carryIn)}</b> · Nuevo saldo: <b>${money(r.saldoSemana)}</b>`;$('v3UberSaveStatus').textContent=`Guardado. ${r.allocations.length} cuota(s) recibieron dinero${r.unapplied>0?' · sobrante no arrastrado '+money(r.unapplied):''}.`;$('v3CaptureUber').disabled=false;if(Array.isArray(r.box))v3UpdateReceiptFromBox(v,r.box);await loadProductionData();renderWeek();renderVehicles();renderSummary();v3RenderPlanDashboard();}catch(e){$('v3UberSaveStatus').textContent=e.message||'Error guardando Uber';}
}
function v3UpdateReceiptFromBox(v,box){$('v3ReceiptSub').textContent=`${v.name} · Semana ${box[0]&&box[0][1]||$('v3UberWeek').value}`;$('v3ReceiptRows').innerHTML=(box.slice(1,6)).map(r=>`<tr><td>${r[0]||''}</td><td>${r[1]||'₡0'}</td></tr>`).join('');}
async function v3CaptureUber(){try{await v3EnsureLib('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js','html2canvas');const canvas=await html2canvas($('v3UberReceipt'),{backgroundColor:'#ffffff',scale:2});const a=document.createElement('a');a.download='Plan_'+(contractVehicles.find(v=>v.id===v3ActiveUberVehicleId)?.name||'vehiculo').replace(/[^a-z0-9]+/gi,'_')+'_Semana_'+($('v3UberWeek').value||'')+'.png';a.href=canvas.toDataURL('image/png');a.click();}catch(e){alert('No pude generar la imagen: '+(e.message||e));}}

function v3OpenConfig(){v3RenderConfig();$('v3ConfigModal').classList.add('show');}
function v3CloseConfig(){$('v3ConfigModal').classList.remove('show');}
function v3RenderConfig(){
  const tabs=v3Data.availablePlanTabs||[];$('v3ConfigNotice').innerHTML='Los contratos finalizados/cancelados se conservan en historial; no se borran.';
  let dl=document.getElementById('v3Tabs');if(!dl){dl=document.createElement('datalist');dl.id='v3Tabs';document.body.appendChild(dl);}dl.innerHTML=tabs.map(t=>`<option value="${v3Esc(t)}"></option>`).join('');
  $('v3ConfigBody').innerHTML=contractVehicles.map(v=>`<tr data-id="${v.id}"><td><input data-f="nombre" value="${v3Esc(v.name)}"></td><td><input data-f="placa" value="${v3Esc(v.plate||'')}"></td><td><input data-f="chofer" value="${v3Esc(v.driver||'')}"></td><td><select data-f="tipo"><option value="" ${!v.collectionType?'selected':''}>Sin configurar</option><option value="UBER" ${v.collectionType==='UBER'?'selected':''}>Uber</option><option value="PERSONAL" ${v.collectionType==='PERSONAL'?'selected':''}>Uso personal</option></select></td><td><input data-f="tab" list="v3Tabs" value="${v3Esc(v.planTab||'')}"></td><td style="text-align:center"><input data-f="integration" type="checkbox" ${v.planIntegration?'checked':''} style="width:auto"></td><td><select data-f="state"><option ${v.operationStatus==='ACTIVO'?'selected':''}>ACTIVO</option><option ${v.operationStatus==='FINALIZADO'?'selected':''}>FINALIZADO</option><option ${v.operationStatus==='CANCELADO'?'selected':''}>CANCELADO</option></select></td><td><button class="dark v3small" onclick="v3SaveConfigRow('${v.id}')">Guardar</button></td></tr>`).join('');
}
function v3Esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function v3SaveConfigRow(id){
  const tr=document.querySelector(`#v3ConfigBody tr[data-id="${CSS.escape(id)}"]`);if(!tr)return;const val=f=>tr.querySelector(`[data-f="${f}"]`);
  try{const r=await backend('saveVehicleOperation',{sessionToken:sessionStorage.getItem(SESSION_KEY),vehicleId:id,nombre:val('nombre').value.trim(),placa:val('placa').value.trim(),chofer:val('chofer').value.trim(),tipoCobro:val('tipo').value,planSheetTab:val('tab').value.trim(),planIntegracionActiva:val('integration').checked,operacionEstado:val('state').value,configNota:''});if(!r.ok)throw new Error(r.message||'No se pudo guardar');await loadProductionData();v3RenderConfig();renderAll();}catch(e){alert(e.message||'Error guardando configuración');}}

function v3Init(){
  $('v3ConfigBtn').onclick=v3OpenConfig;$('v3RefreshPlan').onclick=async()=>{await loadProductionData();renderAll();};$('v3SavePayment').onclick=()=>v3SavePayment(false);$('v3CompletePayment').onclick=()=>v3SavePayment(true);$('v3ReadUber').onclick=v3ReadUberScreenshot;$('v3SaveUber').onclick=v3SaveUber;$('v3CaptureUber').onclick=v3CaptureUber;
  ['v3UberWeek','v3UberDate','v3UberGains','v3UberRefunds','v3UberAdjustments','v3UberCash'].forEach(id=>$(id).addEventListener('input',()=>v3RenderReceiptFromInputs(contractVehicles.find(v=>v.id===v3ActiveUberVehicleId))));
}
document.addEventListener('DOMContentLoaded',v3Init);

window.v3OpenPayment=v3OpenPayment;window.v3ClosePaymentModal=v3ClosePaymentModal;window.v3OpenMovements=v3OpenMovements;window.v3CloseMovements=v3CloseMovements;window.v3DeleteMovement=v3DeleteMovement;window.v3OpenPlanCard=v3OpenPlanCard;window.v3OpenUber=v3OpenUber;window.v3CloseUber=v3CloseUber;window.v3OpenConfig=v3OpenConfig;window.v3CloseConfig=v3CloseConfig;window.v3SaveConfigRow=v3SaveConfigRow;
