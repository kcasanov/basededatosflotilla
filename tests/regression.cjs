const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {innerHTML:'',textContent:'',value:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},contains(){return false;}},addEventListener(){},querySelectorAll(){return [];},querySelector(){return null;}});
  return elements.get(id);
};
const store = new Map();
const context = vm.createContext({console,Intl,Date,URL,AbortSignal,setTimeout,clearTimeout,encodeURIComponent,decodeURIComponent,
  location:{pathname:'/'},document:{getElementById:el,addEventListener(){},querySelectorAll(){return [];},querySelector(){return null;}},
  sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},localStorage:{getItem(){return 'device';}},
  alert(){},confirm(){return true;},window:{}});
context.window = context;
vm.runInContext(fs.readFileSync('app.js','utf8'),context);
vm.runInContext(fs.readFileSync('app-v3.js','utf8'),context);
const run = code => vm.runInContext(code, context);
let checks = 0;
function eq(actual, expected, label){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,label);checks++;}
for (const [date,expected] of [['2026-10-03','2026-09-29'],['2026-10-04','2026-09-29'],['2026-10-05','2026-10-06'],['2026-10-06','2026-10-06'],['2027-01-03','2026-12-29']]) {
  eq(run(`isoDate(operationalTuesday(parseDate('${date}')))`),expected,'Monday–Sunday calendar');
}
run("crTodayUTC=()=>parseDate('2026-10-03'); contractVehicles=[{id:'i10',name:'i10',weekly:100,start:'2026-06-02',createdAt:'2026-06-02',frequency:'SEMANAL',status:'ACTIVO'}]; planPayments=[{vehicleId:'i10',date:'2026-06-02',total:100,week:1,status:'Pendiente'},{vehicleId:'i10',date:'2026-06-09',total:100,week:2,status:'Pagado'}]; planDashboardV3=[{vehicleId:'i10',integrationActive:true,legacyPending:[{date:'2026-06-02',quota:100,week:1}]}];");
eq(run("effectivePaymentState({vehicleId:'i10',date:'2026-06-09',amount:100}).historicalApplied"),true,'historical applied');
eq(run("effectivePaymentState({vehicleId:'i10',date:'2026-06-09',amount:100}).received"),0,'no fabricated cash');
eq(run("getLateRows().map(r=>r.date)"),['2026-06-02'],'only explicitly pending');
eq(run("paymentStatusV3({amount:100,received:0,historicalApplied:true}).pending"),0,'no phantom debt');
eq(run("paymentStatusV3({amount:100,received:40}).pending"),60,'partial payment');
run("paymentState['i10|2026-09-08']={received:40,movements:[{date:'2026-10-03',amount:40}]}; paymentState['i10|2026-09-29']={received:80,movements:[{date:'2026-10-04',amount:60},{date:'2026-10-05',amount:20}]}; paymentState['i10|2026-10-06']={received:80,movements:[{date:'2026-10-04',amount:80}]}; paymentState['i10|2026-06-10']={received:90,movements:[{date:'2026-10-04',amount:90}]};");
eq(run("cashAllocationForWeek(parseDate('2026-09-08'))"),{operational:40,debtRecovery:0,total:40},'recent late payment stays with its scheduled week');
eq(run("cashAllocationForWeek(parseDate('2026-09-29'))"),{operational:80,debtRecovery:90,total:170},'scheduled-week cash plus old debt recovery are separated');
eq(run("cashAllocationForWeek(parseDate('2026-10-06'))"),{operational:80,debtRecovery:0,total:80},'advance payment funds the future scheduled week');
eq(run("allocateExpenses([{id:'iva',type:'weekly',need:50,assigned:0,priority:'critical',order:1},{id:'pago_deudas',type:'remainder',need:0,assigned:0,priority:'low',order:2}],80,90).map(x=>[x.id,x.assigned])"),[['iva',50],['pago_deudas',120]],'old recovery bypasses priorities and goes directly to debt');
eq(run("paymentDistributionForMovement('2026-09-04','2026-10-04').debtRecovery"),false,'exactly one calendar month old is not old recovery');
eq(run("paymentDistributionForMovement('2026-09-03','2026-10-04').debtRecovery"),true,'older than one calendar month becomes debt recovery');
run("delete paymentState['i10|2026-09-08']; delete paymentState['i10|2026-09-29']; delete paymentState['i10|2026-10-06']; delete paymentState['i10|2026-06-10'];");
const dueRow = date => ({date,amount:100,received:0});
for (const [today,expected] of [['2026-10-04',['2026-09-29']],['2026-10-06',['2026-09-29']],['2026-10-07',['2026-09-29','2026-10-06']]]) {
  eq(['2026-09-29','2026-10-06'].filter(date=>context.duePendingWeekV3(dueRow(date),today)),expected,'pending weeks start the day after Tuesday');
}
for(const [raw,value] of [['₡123.456,78',123456.78],['123,456.78',123456.78],['₡123.456',123456],['− 1 234,50',-1234.5],['0',0]])eq(run(`parseCRAmountV3(${JSON.stringify(raw)})`),value,'OCR currency');
eq(context.parseUberOCRV3('Ganancias totales ₡123.456,78\nDevoluciones y gastos\n₡1.000\nAjustes períodos anteriores -500,00\nGanancias netas 103.956,78\nEfectivo cobrado ₡20.000'),{gains:123456.78,returns:1000,adjustments:-500,cash:20000},'OCR labels');
eq(run("parseUberOCRV3('Ganancias netas 90.000').cash"),null,'net gains are not cash');
const screenshotText = 'Ganancias totales ₡156 085,24\nTarifa total ₡147 085,24\nIncentivo ₡8 500,00\nDevoluciones y gastos ₡0,00\nAjustes de periodos anteriores ₡0,00\nGanancias -₡51 543,52\nGanancias netas ₡104 541,72\nViajes 82';
eq(context.parseUberOCRV3(screenshotText),{gains:156085.24,returns:0,adjustments:0,cash:51543.52},'provided Uber screenshot amounts');
eq(context.parseUberOCRV3(screenshotText.replace('Ganancias -₡51 543,52\n','')).cash,51543.52,'cash inferred from net when OCR misses deduction');
eq(context.parseUberOCRV3(screenshotText.replace('periodos','perio20s')).adjustments,0,'digits inside corrupted label ignored');
eq(context.parseUberOCRV3(screenshotText.replace('₡0,00\nGanancias -','₡20,00\nGanancias -')).cash,null,'contradictory OCR amounts require manual check');
const actualOcrMistake = 'Ganancias totales ₡156 085,24\nDevoluciones y gastos\nAjustes de perio20s anteriores\n20\nGanancias -₡251543,52\nGanancias netas ₡104 541,72';
eq(context.parseUberOCRV3(actualOcrMistake),{gains:156085.24,returns:0,adjustments:0,cash:51543.52},'recover screenshot OCR errors by exact net reconciliation');
eq(context.parseUberOCRV3('Ajustes de periodos anteriores\n20').adjustments,null,'bare twenty is not a monetary adjustment');
eq(context.parseUberOCRV3(actualOcrMistake.replace('anteriores\n20','anteriores ₡20')),{gains:156085.24,returns:0,adjustments:0,cash:51543.52},'net reconciliation rejects misread currency twenty');
run("paymentState['i10|2026-06-02']={movements:Array.from({length:21},(_,i)=>({pagoId:'p'+i,amount:1,date:'2026-06-02',createdAt:'2026-06-02T00:00:'+String(i).padStart(2,'0')+'Z',origin:'MANUAL'}))};renderMovementHistory();");
eq((el('movementHistory').innerHTML.match(/data-payment-id/g)||[]).length,10,'10 movements initially');
eq(el('moreMovements').hidden,false,'load more visible');
run('movementHistoryLimit+=10;renderMovementHistory();');
eq((el('movementHistory').innerHTML.match(/data-payment-id/g)||[]).length,20,'load 10 more');
run('movementHistoryLimit+=10;renderMovementHistory();');
eq(el('moreMovements').hidden,true,'pagination exhausted');
eq((el('movementHistory').innerHTML.match(/<tr>/g)||[]).length,21,'history rows use the five-column table');
eq(['Vehículo','Fecha de actualización','Fecha de cuota pagada','Monto pagado','Acción'].every(label=>fs.readFileSync('index.html','utf8').includes('<th>'+label+'</th>')),true,'history headings');

class Sheet {
  constructor(rows){this.rows=structuredClone(rows);this.max=100;}
  getLastRow(){return this.rows.length;}
  getLastColumn(){return Math.max(...this.rows.map(r=>r.length));}
  getMaxRows(){return this.max;}
  insertRowsAfter(i,n){this.max+=n;}
  appendRow(r){this.rows.push([...r]);}
  deleteRow(n){this.rows.splice(n-1,1);}
  getDataRange(){return this.getRange(1,1,this.rows.length,this.getLastColumn());}
  getRange(a,b,n=1,m=1){
    if(typeof a==='string'){
      const match=a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      const col=t=>t.split('').reduce((s,c)=>s*26+c.charCodeAt(0)-64,0);
      b=col(match[1]);a=Number(match[2]);n=match[4]?Number(match[4])-a+1:1;m=match[3]?col(match[3])-b+1:1;
    }
    const sheet=this;
    const values=()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>sheet.rows[a+i-1]?.[b+j-1]??''));
    const set=rows=>{for(let i=0;i<n;i++){sheet.rows[a+i-1]??=[];for(let j=0;j<m;j++)sheet.rows[a+i-1][b+j-1]=rows[i][j];}return this;};
    return {getValues:values,getDisplayValues:()=>values().map(r=>r.map(String)),getFormulas:()=>values().map(r=>r.map(v=>typeof v==='string'&&v.startsWith('=')?v:'')),getValue:()=>values()[0][0],setValue:v=>set([[v]]),setValues:set,clearContent:()=>set(Array.from({length:n},()=>Array(m).fill('')))};
  }
}
const payHeaders=['PagoID','PlanID','VehicleID','FechaProgramada','FechaReal','MontoEsperado','MontoRecibido','Estado','Nota','CreatedAt','UpdatedAt','Origen','UberSemanaID'];
const uberHeaders=['UberSemanaID','VehicleID','PlanSheetTab','Semana','FechaProgramada','GananciasTotales','DevolucionesGastos','AjustesAnteriores','SaldoArrastradoEntrada','ReembolsosTotal','EfectivoChofer','Cuota','SaldoSemana','MontoDisponibleBruto','Estado','OCRTexto','CreatedAt','UpdatedAt'];
const vehicle={VehicleID:'i10',TipoCobro:'UBER',PlanSheetTab:'i10',PlanIntegracionActiva:true,CuotaSemanal:100,FechaInicio:'2026-09-15'};
let uuid=0;
const scriptProps=new Map();
const mainSheets={Pagos_Reales:new Sheet([payHeaders]),Uber_Semanas:new Sheet([uberHeaders]),Historial:new Sheet([['ID','Fecha','Entidad','EntidadID','Accion','Detalle','Usuario','Origen']]),Plan_Pagos:new Sheet([['PlanID','VehicleID','Semana','FechaProgramada','CuotaTotal']]),Central_Sync:new Sheet([['StateKey','WeekDate','CuentaID','VehicleID','CentralAccountID','DesiredAmount','SyncedAmount','Delta','Status','UpdatedAt']])};
const external=new Sheet([['Semana',777],['Ganancias',0],['Reembolsos',0],['Efectivo',0],['Cuota',100],['Saldo','=B2+B3-B4-B5'],[],['Semana','Fecha','Cuota Total','Estado'],[1,'2026-09-15',100,'Pagado'],[2,'2026-09-22',100,'Pendiente'],[3,'2026-09-29',100,'Pendiente']]);
const main={getSheetByName:n=>mainSheets[n]};
const server=vm.createContext({console,Date,JSON,Number,isFinite,SpreadsheetApp:{openById:id=>id==='main'?main:{getSheetByName:()=>external},flush(){}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>scriptProps.get(key)||null})},Utilities:{formatDate:d=>new Date(d).toISOString().slice(0,10),getUuid:()=>String(++uuid)}});
vm.runInContext(fs.readFileSync('Code.gs','utf8'),server);
vm.runInContext(fs.readFileSync('CentralSync.gs','utf8'),server);
external.rows[9][2]='₡100,00';
eq(server.legacyObligationsTo_(external,'2026-09-22').find(r=>r.date==='2026-09-22').amount,100,'localized currency in imported plan');
external.rows[9][2]=100;
eq(server.syncCentralCurrentWeek_('test','2026-09-29').disabled,true,'Central remains disabled');
const centralMappings=[
  {SyncKey:'omoda',CuentaID:'omoda',CentralAccountID:'omoda'},
  {SyncKey:'universidad',CuentaID:'u',CentralAccountID:'universidad_fondo'},
  {SyncKey:'seguro_i10',CuentaID:'seguros',VehicleID:'i10',Modo:'INSURANCE',CentralAccountID:'i10'}
];
const centralModel={weekDate:'2026-10-06',accounts:[
  {id:'casa',need:25000,assigned:24999},
  {id:'omoda',need:50000,assigned:49999},
  {id:'u',need:25000,assigned:25000},
  {id:'pago_deudas',need:3000,assigned:3000},
  {id:'seguros',need:5000,assigned:4999}
],rows:[{vehicleId:'i10',insurance:5000}]};
let centralItems=server.centralDesiredItems_(centralModel,centralMappings);
eq(centralItems.map(x=>[x.cuentaId,x.desiredAmount,x.map.CentralAccountID]),[['casa',0,'cuentas_casa'],['omoda',0,'omoda'],['u',25000,'semana_1'],['seguros',0,'i10']],'Drive mapping uses existing home and university accounts');
centralModel.accounts[0].assigned=25000;
centralModel.accounts[1].assigned=50000;
centralModel.accounts[4].assigned=5000;
centralItems=server.centralDesiredItems_(centralModel,centralMappings);
eq(centralItems.map(x=>[x.cuentaId,x.desiredAmount]),[['casa',25000],['omoda',50000],['u',25000],['seguros',5000]],'Drive waits for fully covered accounts');
for (const [amount,rounded] of [[0,0],[1,500],[500,500],[500.01,1000],[12287,12500],[12700,13000]]) {
  eq(server.centralRoundUp500_(amount),rounded,'Central rounds contributions upward to 500 colones');
}
for (const [day,week] of [['2026-10-04','2026-09-29'],['2026-10-05','2026-10-06'],['2026-10-06','2026-10-06']]) eq(server.centralCurrentTuesday_(day),week,'Central uses operational week');
const cashMovements=[{FechaProgramada:'2026-09-08',FechaReal:'2026-10-03',MontoRecibido:40},{FechaProgramada:'2026-09-29',FechaReal:'2026-10-04',MontoRecibido:60},{FechaProgramada:'2026-09-29',FechaReal:'2026-10-05',MontoRecibido:20},{FechaProgramada:'2026-10-06',FechaReal:'2026-10-04',MontoRecibido:80},{FechaProgramada:'2026-06-10',FechaReal:'2026-10-04',MontoRecibido:90}];
eq(server.centralCashAllocationForWeek_(cashMovements,'2026-09-08'),{operational:40,debtRecovery:0,total:40},'backend keeps recent late cash with scheduled week');
eq(server.centralCashAllocationForWeek_(cashMovements,'2026-09-29'),{operational:80,debtRecovery:90,total:170},'backend separates old recovery from operational cash');
eq(server.centralCashAllocationForWeek_(cashMovements,'2026-10-06'),{operational:80,debtRecovery:0,total:80},'backend assigns advance payment to future scheduled week');
eq(server.centralPaymentDistribution_('2026-09-04','2026-10-04').debtRecovery,false,'backend one-month boundary inclusive');
eq(server.centralPaymentDistribution_('2026-09-03','2026-10-04').debtRecovery,true,'backend older than one calendar month routes to debt');
scriptProps.set('FLOTILLA_TEST_MODE','TRUE');
eq(server.globalSyncReady_(),false,'test mode leaves Drive writes disabled by default');
assert.throws(()=>server.globalSpreadsheetId_(),/copia distinta/); checks++;
scriptProps.set('FLOTILLA_GLOBAL_SPREADSHEET_ID',vm.runInContext('GLOBAL_ACCOUNTS_SPREADSHEET_ID_',server));
assert.throws(()=>server.globalSpreadsheetId_(),/copia distinta/); checks++;
scriptProps.set('FLOTILLA_GLOBAL_SPREADSHEET_ID','global');
scriptProps.set('FLOTILLA_GLOBAL_SYNC_ENABLED','TRUE');
eq(server.globalSyncReady_(),true,'Drive sync enables only with an isolated target');
const globalAccounts=new Sheet([
  ['Cuentas mensuales'],[''],['Nombre de la cuenta','Saldo','Tipo','ID','Categoria ID'],
  ['cuentas casa',25000,'cuenta','cuentas_casa','tarjeta_siguiente_mes'],
  ['Semana 1',26000,'cuenta','semana_1','universidad']
]);
const globalHistory=new Sheet([['Fecha y hora','Operación ID','Tipo','Cuenta','ID cuenta','Saldo anterior','Movimiento','Saldo nuevo','Mes','Semana']]);
const globalWorkbook={getSheetByName:n=>({'Cuentas mensuales':globalAccounts,Historial:globalHistory})[n]};
const originalOpenById=server.SpreadsheetApp.openById;
server.SpreadsheetApp.openById=id=>id==='global'?globalWorkbook:originalOpenById(id);
eq(server.centralApiGetAccounts_().accounts.map(a=>[a.id,a.balance]),[['cuentas_casa',25000],['semana_1',26000]],'Drive reads existing account IDs and balances');
const housePayload={action:'updateBalance',id:'cuentas_casa',balance:50000,context:{operationId:'TEST-HOUSE-1',expectedBalance:25000,month:'2026-10',week:'2026-10-06'}};
eq(server.centralApiPost_(housePayload).ok,true,'Drive adds to the existing home balance');
eq([globalAccounts.rows[3][1],globalHistory.rows.length],[50000,2],'Drive persists balance and one history row');
eq(server.centralApiGetOperation_('TEST-HOUSE-1').operation.movement,25000,'Drive finds the exact recorded movement');
eq(server.centralApiPost_(housePayload).alreadyApplied,true,'Drive rejects duplicate operation IDs');
eq([globalAccounts.rows[3][1],globalHistory.rows.length],[50000,2],'duplicate does not add twice');
eq(server.centralApiPost_({...housePayload,context:{...housePayload.context,operationId:'TEST-HOUSE-2'}}).ok,false,'stale balance blocks overlapping writes');
server.SpreadsheetApp.openById=originalOpenById;
assert.throws(()=>server.mainSpreadsheetId_(),/configure una copia distinta/); checks++;
scriptProps.set('FLOTILLA_DATA_SPREADSHEET_ID',vm.runInContext('SPREADSHEET_ID',server));
assert.throws(()=>server.mainSpreadsheetId_(),/configure una copia distinta/); checks++;
scriptProps.set('FLOTILLA_DATA_SPREADSHEET_ID','main');
assert.throws(()=>server.planSpreadsheetId_(),/configure una copia distinta/); checks++;
scriptProps.set('FLOTILLA_PLAN_SPREADSHEET_ID',vm.runInContext('PLAN_PAGOS_FALLBACK_ID',server));
assert.throws(()=>server.planSpreadsheetId_(),/configure una copia distinta/); checks++;
scriptProps.set('FLOTILLA_PLAN_SPREADSHEET_ID','external');
eq(server.mainSpreadsheetId_(),'main','test mode uses copied main sheet');
eq(server.planSpreadsheetId_(),'external','test mode uses copied plan sheet');
const pendingItem={syncKey:'omoda',cuentaId:'omoda',vehicleId:'',map:{CentralAccountID:'omoda'}};
server.centralUpsertSyncState_('2026-09-29',pendingItem,50000,0,50000,'PENDING',{OperationID:'test-operation',BeforeBalance:100000,TargetBalance:150000});
eq(mainSheets.Central_Sync.rows[0].slice(10),['OperationID','BeforeBalance','TargetBalance'],'Central sync ledger adds durable operation columns');
const pendingState=server.centralSyncState_('2026-09-29','omoda');
eq([pendingState.Status,pendingState.OperationID,pendingState.BeforeBalance,pendingState.TargetBalance],['PENDING','test-operation',100000,150000],'pending Central operation survives in ledger');
server.centralUpsertSyncState_('2026-09-29',pendingItem,50000,50000,50000,'OK',pendingState);
eq(mainSheets.Central_Sync.rows.length,2,'Central retry updates one ledger row');
scriptProps.clear();
for (const [today,expected] of [['2026-10-04',['2026-09-29']],['2026-10-06',['2026-09-29']],['2026-10-07',['2026-09-29','2026-10-06']]]) {
  eq(server.pendingDueObligations_([{date:'2026-09-29',state:'Pendiente'},{date:'2026-10-06',state:'Pendiente'},{date:'2026-09-22',state:'Pagado'}],today).map(r=>r.date),expected,'backend sends only due pending weeks');
}
vm.runInContext("vehicleObjectById_=()=>vehicle;planSpreadsheetId_=()=> 'external';operationalTuesday_=()=> '2026-09-29';",server);
server.vehicle=vehicle;
// Keep sheet access identifiers independent of production spreadsheet IDs.
server.SpreadsheetApp.openById=id=>id===vm.runInContext('SPREADSHEET_ID',server)?main:{getSheetByName:()=>external};
const save = (date,gains,cash=0)=>server.saveUberWeek_({vehicleId:'i10',fechaProgramada:date,gananciasTotales:gains,devolucionesGastos:0,ajustesAnteriores:0,efectivoChofer:cash},'test');
let result=save('2026-09-29',150);
eq(result.ok,true,'Uber save');
eq(result.allocations.map(a=>[a.date,a.amount]),[['2026-09-22',100],['2026-09-29',50]],'FIFO oldest first');
eq(result.carryIn,-100,'negative carry');
eq(external.rows[0][1],777,'B1 unchanged');
eq(external.rows[5][1],'=B2+B3-B4-B5','B6 formula unchanged');
eq(mainSheets.Pagos_Reales.rows.some(r=>r[3]==='2026-09-15'),false,'historical paid never allocated');
result=save('2026-09-29',120);
eq(result.allocations.map(a=>[a.date,a.amount]),[['2026-09-22',100],['2026-09-29',20]],'correction replays without duplicates');
eq(mainSheets.Pagos_Reales.rows.length,3,'old Uber allocations removed');
const uberPayment=mainSheets.Pagos_Reales.rows[1][0];
eq(server.unmarkPayment_({pagoId:uberPayment},'test').ok,false,'server refuses Uber reversal');
mainSheets.Pagos_Reales.appendRow(['manual','','i10','2026-09-29','2026-10-03',100,10,'PARCIAL','',new Date(),new Date(),'MANUAL','']);
eq(server.unmarkPayment_({pagoId:'manual'},'test').ok,true,'specific manual reversal');
eq(mainSheets.Pagos_Reales.rows.length,3,'other payments preserved');
eq(server.reversedPayments_(main).length,1,'reversal retained in history');
vm.runInContext("operationalTuesday_=()=> '2026-10-06'",server);
server.closeUberWeeks_(main,'i10');
eq(mainSheets.Uber_Semanas.rows[1][14],'CERRADA_PENDIENTE','previous calendar week closed');
// Correct a previous week and verify downstream FIFO is recomputed.
result=save('2026-09-22',40);
eq(result.ok,true,'previous week correction');
eq(mainSheets.Pagos_Reales.rows.filter(r=>r[12]==='uber_i10_2026-09-29').map(r=>[r[3],r[6]]),[['2026-09-22',60],['2026-09-29',60]],'downstream replay');
eq(mainSheets.Uber_Semanas.rows.find(r=>r[4]==='2026-09-29')[8],-60,'downstream carry recomputed');
const before=JSON.stringify({payments:mainSheets.Pagos_Reales.rows,weeks:mainSheets.Uber_Semanas.rows,external:external.rows});
const append=mainSheets.Uber_Semanas.appendRow;
mainSheets.Uber_Semanas.appendRow=()=>{throw new Error('simulated write failure');};
eq(save('2026-09-22',80).ok,false,'failed correction reported');
mainSheets.Uber_Semanas.appendRow=append;
eq(JSON.stringify({payments:mainSheets.Pagos_Reales.rows,weeks:mainSheets.Uber_Semanas.rows,external:external.rows}),before,'rollback restores all allocation data');
eq(save('2026-10-13',100).ok,false,'future week rejected');
const syncCode=fs.readFileSync('CentralSync.gs','utf8');
const syncTest=vm.createContext({
  Date,JSON,Math,Number,isFinite,console,doPost(){},json_(){},protected_(){},
  num_:value=>Number(value)||0,ymd_:value=>String(value||''),
  props_:()=>({getProperty:()=>null}),
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  Utilities:{getUuid:(()=>{let n=0;return ()=>String(++n);})()},
  SpreadsheetApp:{flush(){}},log_(){}
});
vm.runInContext(syncCode,syncTest);
syncTest.globalSyncReady_=()=>true;
let syncNeed=50000,syncBalance=100000,syncState=null,syncOperation=null,syncPosts=0,syncPostMode='lostResponse',syncApplied=0;
syncTest.centralConfigValue_=()=>'';
syncTest.centralBuildWeekModel_=()=>({accounts:[{id:'omoda',need:syncNeed,assigned:syncNeed}],rows:[]});
syncTest.centralActiveMappings_=()=>[{SyncKey:'omoda',CuentaID:'omoda',CentralAccountID:'omoda'}];
syncTest.centralApiGetAccounts_=()=>({ok:true,accounts:[{id:'omoda',balance:syncBalance}]});
syncTest.centralSyncState_=()=>syncState;
syncTest.centralGlobalSyncedAmount_=()=>syncApplied;
syncTest.centralUpsertSyncState_=(week,item,desired,synced,delta,status,operation={})=>{
  syncState={...operation,DesiredAmount:desired,SyncedAmount:synced,Delta:delta,Status:status};
};
syncTest.centralApiGetOperation_=()=>syncOperation?{ok:true,found:true,operation:syncOperation}:{ok:true,found:false};
syncTest.centralApiPost_=(payload)=>{
  syncPosts++;
  if(syncPostMode==='failBefore')return {ok:false,error:'timeout'};
  const movement=payload.balance-syncBalance;
  syncBalance=payload.balance;
  syncApplied+=movement;
  syncOperation={accountId:payload.id,movement,newBalance:payload.balance};
  return syncPostMode==='lostResponse'?{ok:false,error:'timeout'}:{ok:true};
};
eq(syncTest.syncCentralCurrentWeek_('test','2026-09-29','omoda').results[0].error,'timeout','lost Central response remains pending');
eq([syncState.Status,syncBalance,syncPosts],['PENDING',150000,1],'pending operation records write before Central call');
eq(syncTest.syncCentralCurrentWeek_('test','2026-09-29','omoda').results[0].status,'RECUPERADA','retry recognizes already applied Central operation');
eq([syncState.Status,syncBalance,syncPosts],['OK',150000,1],'retry does not double credit Central');
syncNeed=51000;syncPostMode='success';syncOperation=null;
eq(syncTest.syncCentralCurrentWeek_('test','2026-09-29','omoda').results[0].delta,1000,'later increase sends only new amount');
eq([syncBalance,syncPosts],[151000,2],'later increase uses a new operation');
syncNeed=50000;syncBalance=100000;syncState=null;syncOperation=null;syncPosts=0;syncPostMode='failBefore';syncApplied=0;
syncTest.syncCentralCurrentWeek_('test','2026-09-29','omoda');
const retryId=syncState.OperationID;
syncPostMode='success';
eq(syncTest.syncCentralCurrentWeek_('test','2026-09-29','omoda').results[0].status,'OK','safe retry applies an operation that never reached Central');
eq([syncBalance,syncPosts,syncState.OperationID],[150000,2,retryId],'safe retry keeps original operation id');
syncNeed=0;syncOperation=null;syncPostMode='success';
const decrease=syncTest.syncCentralCurrentWeek_('test','2026-09-29','omoda');
eq(decrease.results[0].delta,-50000,'funding decrease creates a negative correction');
eq([decrease.totalRemoved,syncBalance,syncPosts],[50000,100000,3],'negative correction restores the global balance once');
syncNeed=50000;syncBalance=100000;syncPosts=0;syncOperation=null;syncApplied=0;
syncState={DesiredAmount:50000,SyncedAmount:50000,Delta:50000,Status:'OK',OperationID:'stale',BeforeBalance:100000,TargetBalance:150000};
const repaired=syncTest.syncCentralCurrentWeek_('test','2026-09-29','omoda');
eq([repaired.results[0].delta,syncBalance,syncApplied],[50000,150000,50000],'stale sync ledger cannot hide a missing global movement');
syncNeed=0;syncBalance=150000;syncPosts=0;syncOperation=null;syncApplied=50000;
syncState={DesiredAmount:50000,SyncedAmount:50000,Delta:50000,Status:'OK',OperationID:'prior',BeforeBalance:100000,TargetBalance:150000};
syncTest.centralCurrentTuesday_=()=> '2026-09-29';
syncTest.centralSyncedAccountIdsForWeek_=()=>['omoda'];
syncTest.centralPaymentDistribution_=()=>({weekDate:'2026-09-29',debtRecovery:false});
const reversalReconcile=syncTest.reconcileGlobalAfterPaymentReversal_('test','2026-09-29','2026-10-03',false);
eq([reversalReconcile.ok,reversalReconcile.weekDate,reversalReconcile.totalRemoved,syncBalance],[true,'2026-09-29',50000,100000],'payment reversal reconciles already-authorized global funding');
eq(reversalReconcile.moved.map(x=>[x.cuentaId,x.beforeBalance,x.delta,x.afterBalance]),[['omoda',150000,-50000,100000]],'payment reversal reports exact restored global balance');
syncTest.centralPaymentDistribution_=()=>({weekDate:'2026-09-29',debtRecovery:true});
eq(syncTest.reconcileGlobalAfterPaymentReversal_('test','2026-06-10','2026-10-03',false).debtRecovery,true,'old debt recovery reversal skips global accounts');
eq(syncTest.syncCentralCurrentWeek_('test','2026-09-29').ok,false,'Central refuses unconfirmed bulk sync');
syncTest.centralConfigValue_=()=>'';
syncTest.centralBuildWeekModel_=()=>({accounts:[{id:'omoda',need:50000,assigned:50000}],rows:[]});
syncTest.centralActiveMappings_=()=>[{SyncKey:'omoda',CuentaID:'omoda',CentralAccountID:'omoda'}];
syncTest.centralDesiredItems_=()=>[{syncKey:'omoda',cuentaId:'omoda',vehicleId:'',desiredAmount:50000,map:{CentralAccountID:'omoda'}}];
syncTest.centralApiGetAccounts_=()=>({ok:true,accounts:[{id:'omoda',balance:100000}]});
syncTest.centralGlobalSyncedAmount_=()=>0;
eq(syncTest.globalFundingStatusAction_({weekDate:'2026-09-29'},'test').items.map(x=>[x.cuentaId,x.pending,x.desiredAmount,x.appliedAmount]),[['omoda',true,50000,0]],'backend exposes a fully funded but unapplied global contribution');
syncTest.centralGlobalSyncedAmount_=()=>50000;
eq(syncTest.globalFundingStatusAction_({weekDate:'2026-09-29'},'test').items[0].pending,false,'backend hides pending state after global contribution exists');
run("planDashboardV3=[];planDashboardLoadedV3=false;globalThis.planRenders=0;backend=async action=>({ok:true,cards:[{vehicleId:'i10',integrationActive:true,legacyPending:[{date:'2026-06-02',quota:100,week:1}]}]});renderWeek=()=>planRenders++;renderSummary=()=>planRenders++;renderVehicles=()=>planRenders++;");
context.loadPlanDashboardV3(true).then(async()=>{
  eq(run('planDashboardLoadedV3'),true,'background plan marked ready');
  eq(run('planRenders'),3,'pending sections refreshed after plan load');
  run("rowsForTuesday=()=>[];currentExpenses=()=>[{id:'casa',name:'Cuentas casa',need:25000,assigned:0,priority:'critical',order:1,type:'weekly'},{id:'omoda',name:'Omoda',need:50000,assigned:0,priority:'critical',order:2,type:'weekly'},{id:'pago_deudas',name:'Pago de deudas',need:0,assigned:0,priority:'low',order:3,type:'remainder'}];cashAllocationForWeek=()=>({operational:75000,debtRecovery:0,total:75000});backendCapabilities={globalAccountSyncReady:true};globalThis.centralCalls=[];globalThis.alerts=[];globalThis.confirmQueue=[true,true];confirm=()=>confirmQueue.shift()??true;alert=x=>alerts.push(String(x));backend=async(action,payload)=>{centralCalls.push({action,payload});if(action==='getGlobalFundingStatus')return {ok:true,weekDate:payload.weekDate,items:[]};return {ok:true,results:[{status:'OK'}],moved:[{beforeBalance:100000,delta:25000,afterBalance:125000}]};};");
  eq(run("centralFundingSnapshot().casa.ready"),true,'fully funded home account is eligible for confirmation');
  eq(run("centralFundingSnapshot().omoda.ready"),true,'fully funded account is eligible for confirmation');
  eq(run("Object.keys(centralFundingSnapshot()).includes('pago_deudas')"),false,'debt remnant never prompts for Central');
  await context.offerCentralFunding({omoda:{ready:false}});
  eq(run("centralCalls.filter(x=>x.action==='syncGlobalAccount').map(x=>[x.action,x.payload.cuentaId,x.payload.weekDate])"),[['syncGlobalAccount','casa','2026-09-29'],['syncGlobalAccount','omoda','2026-09-29']],'confirmation submits each newly funded account to Drive');
  eq(run("alerts.every(x=>x.includes('Cuenta actualizada en el archivo global de Drive.')&&x.includes(money(100000))&&x.includes(money(125000)))"),true,'Drive confirmation shows previous and new balances');
  await context.offerCentralFunding({casa:{ready:true},omoda:{ready:true}});
  eq(run("centralCalls.filter(x=>x.action==='syncGlobalAccount').length"),2,'already funded accounts do not prompt again');
  run("globalFundingStatusByWeek['2026-09-29']={ok:true,items:[{cuentaId:'omoda',pending:true,desiredAmount:50000,appliedAmount:0}]};weekOffset=0;crTodayUTC=()=>parseDate('2026-10-04');");
  context.renderExpenseAllocation([{id:'omoda',name:'Omoda',need:50000,assigned:50000,priority:'critical',order:1,type:'weekly'}],50000);
  eq(el('expenseBody').innerHTML.includes('Pendiente de aplicar en file global'),true,'pending global contribution stays visible beside the account');
  console.log(`${checks} regression checks passed; no external API was called.`);
}).catch(error=>{console.error(error);process.exitCode=1;});
