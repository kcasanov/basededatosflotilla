from pathlib import Path
import shutil

# 1) app.js: support current Netlify root and future nested domain route.
p = Path('app.js')
s = p.read_text(encoding='utf-8')
old = "const BACKEND_URL = '/api';"
new = "const APP_BASE = location.pathname.startsWith('/kcasanova/baseflotilla') ? '/kcasanova/baseflotilla' : '';\nconst BACKEND_URL = APP_BASE + '/api';"
if old in s:
    s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# 2) app-v3: preload public plan data, merge historical pending weeks, stop closed contracts,
# and default Uber editor to current week.
p = Path('app-v3.js')
s = p.read_text(encoding='utf-8')
old = """  planDashboardLoadedV3 = false;\n};\n\nfunction openPaymentRowsV3(vehicleId) {"""
new = """  planDashboardLoadedV3 = false;\n  try {\n    const pd = await backend('getPlanDashboard', { sessionToken });\n    if (pd && pd.ok) {\n      planDashboardV3 = Array.isArray(pd.cards) ? pd.cards : [];\n      planDashboardLoadedV3 = true;\n    }\n  } catch (e) {\n    planDashboardLoadedV3 = false;\n  }\n};\n\nfunction openPaymentRowsV3(vehicleId) {"""
if old not in s:
    raise RuntimeError('app-v3 preload marker not found')
s = s.replace(old, new, 1)

marker = """function paymentStatusV3(row) {\n  const pending = Math.max(0, Number(row.amount || 0) - Number(row.received || 0));\n  return { pending, paid: pending <= .01, partial: Number(row.received || 0) > 0 && pending > .01 };\n}\n\nconst renderWeekV22 = renderWeek;"""
replacement = """function paymentStatusV3(row) {\n  const pending = Math.max(0, Number(row.amount || 0) - Number(row.received || 0));\n  return { pending, paid: pending <= .01, partial: Number(row.received || 0) > 0 && pending > .01 };\n}\n\n// Une atrasos históricos del Plan de pagos con los atrasos nacidos en esta app.\nconst getLateRowsV22 = getLateRows;\ngetLateRows = function () {\n  const base = getLateRowsV22();\n  const map = new Map(base.map(r => [r.key, r]));\n  const cutoff = weekDate();\n  planDashboardV3.forEach(card => {\n    const v = contractVehicles.find(x => x.id === card.vehicleId);\n    if (!v || !Array.isArray(card.legacyPending)) return;\n    card.legacyPending.forEach(p => {\n      const date = normalizeSheetDate(p.date);\n      if (!date || parseDate(date) >= cutoff) return;\n      const key = paymentKey(v.id, date), st = getPaymentState(v.id, date);\n      const amount = Number(p.quota || v.weekly || 0), missing = Math.max(0, amount - Number(st.received || 0));\n      if (missing <= .01) return;\n      const weeksLate = Math.max(1, Math.ceil((cutoff - parseDate(date)) / 604800000));\n      map.set(key, {\n        planId:key, vehicleId:v.id, vehicle:v.name, date, amount, iva:amount * IVA_RATE, insurance:WEEKLY_INSURANCE,\n        received:Number(st.received || 0), realDate:st.realDate || '', status:st.status || 'Pendiente', pagoId:st.pagoId || '',\n        missing, weeksLate, key, source:'legacy'\n      });\n    });\n  });\n  return [...map.values()].sort((a,b) => a.date.localeCompare(b.date));\n};\n\n// Finalizado/cancelado deja de generar obligaciones nuevas, pero conserva historial.\nallScheduledEventsBetween = function(start, end) {\n  return contractVehicles\n    .filter(v => !['FINALIZADO','CANCELADO'].includes(v.operationStatus || 'ACTIVO'))\n    .flatMap(v => scheduledEventsForVehicle(v, start, end))\n    .sort((a,b) => a.date.localeCompare(b.date));\n};\n\nconst renderWeekV22 = renderWeek;"""
if marker not in s:
    raise RuntimeError('app-v3 late rows marker not found')
s = s.replace(marker, replacement, 1)

old = """  const targetOptions = targetRows.map(r => `<option value=\"${r.date}\">${fmtShort(r.date)} · ${paymentStatusV3(r).pending > .01 ? 'pendiente '+money(paymentStatusV3(r).pending) : 'pagada'}</option>`).join('');"""
new = """  const currentWeekIso = isoDate(weekDate());\n  const preferredDate = targetRows.some(r => r.date === currentWeekIso) ? currentWeekIso : (targetRows.length ? targetRows[targetRows.length - 1].date : '');\n  const targetOptions = targetRows.map(r => `<option value=\"${r.date}\" ${r.date === preferredDate ? 'selected' : ''}>${fmtShort(r.date)} · ${paymentStatusV3(r).pending > .01 ? 'pendiente '+money(paymentStatusV3(r).pending) : 'pagada'}</option>`).join('');"""
if old not in s:
    raise RuntimeError('app-v3 target marker not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# 3) Backend: make Uber resaves idempotent and avoid double-subtracting carried debt.
p = Path('Code.gs')
s = p.read_text(encoding='utf-8')
old = """  const legacyRows=legacyObligationsTo_(legacySh,targetDate),fallback=serverScheduleTo_(vehicle,targetDate);\n  const obligations=legacyRows.length?legacyRows.map(r=>({planId:vehicleId+'|'+r.date,week:r.week,date:r.date,amount:r.amount||num_(vehicle.CuotaSemanal),legacyState:String(r.state||''),legacyRow:r.row})):fallback.map(r=>Object.assign({},r,{legacyState:''}));\n  if(!obligations.length)return{ok:false,message:'No encontré cuotas programadas hasta esa fecha.'};\n  const target=obligations.find(o=>o.date===targetDate)||obligations[obligations.length-1],week=target.week||weekNumberForDate_(vehicle,targetDate),quota=num_(target.amount||vehicle.CuotaSemanal);\n  const uberId='uber_'+vehicleId+'_'+targetDate;\n  removeUberRun_(main,uberId);\n  const carryIn=previousCarry_(main,vehicleId,targetDate,legacySh,week);\n  const reimbursements=returns+adjust+carryIn;\n  const rawAvailable=Math.max(0,gains+reimbursements-cash);"""
new = """  const uberId='uber_'+vehicleId+'_'+targetDate;\n  removeUberRun_(main,uberId);\n  reconcileVisibleLegacyBox_(main,vehicle,legacySh,targetDate,device);\n\n  const legacyRows=legacyObligationsTo_(legacySh,targetDate),fallback=serverScheduleTo_(vehicle,targetDate);\n  const obligations=legacyRows.length?legacyRows.map(r=>({planId:vehicleId+'|'+r.date,week:r.week,date:r.date,amount:r.amount||num_(vehicle.CuotaSemanal),legacyState:String(r.state||''),legacyRow:r.row})):fallback.map(r=>Object.assign({},r,{legacyState:''}));\n  if(!obligations.length)return{ok:false,message:'No encontré cuotas programadas hasta esa fecha.'};\n  const target=obligations.find(o=>o.date===targetDate)||obligations[obligations.length-1],week=target.week||weekNumberForDate_(vehicle,targetDate),quota=num_(target.amount||vehicle.CuotaSemanal);\n  const carryIn=previousCarry_(main,vehicleId,targetDate,legacySh,week);\n  const reimbursements=returns+adjust+carryIn;\n  const rawAvailable=Math.max(0,gains+returns+adjust-cash);"""
if old not in s:
    raise RuntimeError('Code.gs Uber marker not found')
s = s.replace(old, new, 1)

start = s.index('function removeUberRun_(main,uberId){')
end = s.index('function upsertUberWeek_(main,row)', start)
helpers = r'''function removeUberRun_(main,uberId){
  const pay=main.getSheetByName('Pagos_Reales'),pv=pay.getDataRange().getValues(),ph=pv[0].map(String),uIdx=ph.indexOf('UberSemanaID'),affected=[];
  if(uIdx>=0)for(let r=pv.length-1;r>=1;r--)if(String(pv[r][uIdx])===uberId){
    affected.push({vehicleId:String(pv[r][2]||''),date:ymd_(pv[r][3]),expected:num_(pv[r][5])});
    pay.deleteRow(r+1);
  }
  const ush=main.getSheetByName('Uber_Semanas');
  if(ush){const uv=ush.getDataRange().getValues();for(let r=uv.length-1;r>=1;r--)if(String(uv[r][0])===uberId)ush.deleteRow(r+1);}
  affected.forEach(a=>syncLegacyStatusForPayment_(a.vehicleId,a.date,a.expected));
  return affected;
}

function reconcileVisibleLegacyBox_(main,vehicle,legacySh,targetDate,device){
  try{
    const boxWeek=num_(legacySh.getRange('B1').getValue()),boxQuota=num_(legacySh.getRange('B5').getValue())||num_(vehicle.CuotaSemanal),boxSaldo=num_(legacySh.getRange('B6').getValue());
    if(!boxWeek)return;
    const row=legacyObligationsTo_(legacySh,targetDate).find(r=>num_(r.week)===boxWeek);
    if(!row||!row.date||row.date>=targetDate)return;
    const expected=num_(row.amount||boxQuota),targetReceived=boxSaldo>=-0.01?expected:Math.max(0,Math.min(expected,expected+boxSaldo));
    const current=sumReceived_(main,String(vehicle.VehicleID||''),row.date),diff=Math.max(0,targetReceived-current);
    if(diff>0.01){
      const now=new Date(),status=targetReceived>=expected-0.01?'PAGADO':'PARCIAL';
      main.getSheetByName('Pagos_Reales').appendRow([Utilities.getUuid(),String(vehicle.VehicleID||'')+'|'+row.date,String(vehicle.VehicleID||''),row.date,Utilities.formatDate(now,TZ,'yyyy-MM-dd'),expected,diff,status,'Conciliación inicial desde saldo del cuadro público',now,now,'LEGACY_RECONCILE','']);
      log_('PAGO',String(vehicle.VehicleID||'')+'|'+row.date,'LEGACY_RECONCILE',JSON.stringify({expected:expected,received:targetReceived,balance:boxSaldo}),device);
    }
    const effective=Math.max(current,targetReceived);
    setLegacyStatus_(legacySh,row.date,effective>=expected-0.01?'Pagado':'Pendiente');
  }catch(e){log_('SYNC',String(vehicle.VehicleID||''),'LEGACY_RECONCILE_ERROR',String(e),device);}
}

function previousCarry_(main,vehicleId,targetDate,legacySh,targetWeek){
  try{
    const rows=legacyObligationsTo_(legacySh,targetDate).filter(r=>r.date<targetDate&&String(r.state||'').toUpperCase()!=='PAGADO');
    const debt=rows.reduce((sum,r)=>sum+Math.max(0,num_(r.amount)-sumReceived_(main,vehicleId,r.date)),0);
    if(debt>0.01)return -debt;
  }catch(e){}
  const sh=main.getSheetByName('Uber_Semanas');
  if(sh){
    const rows=sheetObjects_(sh).filter(r=>String(r.VehicleID)===vehicleId&&ymd_(r.FechaProgramada)<targetDate).sort((a,b)=>ymd_(b.FechaProgramada).localeCompare(ymd_(a.FechaProgramada)));
    if(rows.length)return Math.min(0,num_(rows[0].SaldoSemana));
  }
  return 0;
}
'''
s = s[:start] + helpers + s[end:]
p.write_text(s, encoding='utf-8')

# 4) Generate the final HTML once from the migration builder.
import subprocess
subprocess.run(['python', 'build_v3.py'], check=True)
shutil.copy2('dist/index.html', 'index.html')
p = Path('index.html')
s = p.read_text(encoding='utf-8')
s = s.replace('src="/app.js?v=3.0"', 'src="./app.js?v=3.0"')
s = s.replace('src="/app-v3.js?v=3.0"', 'src="./app-v3.js?v=3.0"')
p.write_text(s, encoding='utf-8')
shutil.rmtree('dist', ignore_errors=True)

# 5) Netlify can now deploy production files directly.
Path('netlify.toml').write_text('''[build]\n  command = "mkdir -p dist && cp index.html app.js app-v3.js dist/"\n  publish = "dist"\n\n[functions]\n  directory = "netlify/functions"\n''', encoding='utf-8')

# 6) Remove staging/migration artifacts. This script deletes itself after running.
for name in ['build_v3.py', 'v3_core.js', 'v3_uber.js', 'v3_ui.js']:
    Path(name).unlink(missing_ok=True)
shutil.rmtree('.v3', ignore_errors=True)
Path('.github/workflows/sync-v3-sources.yml').unlink(missing_ok=True)
Path('.github/workflows/finalize-v3.yml').unlink(missing_ok=True)
Path('finalize_v3.py').unlink(missing_ok=True)
