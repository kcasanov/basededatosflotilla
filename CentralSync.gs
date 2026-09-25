/*
 * Base de Datos Flotilla · Integración Central de Cuentas · V3.3
 *
 * La sincronización con Central se ejecuta en una llamada separada del guardado
 * del pago. Así un fallo/timeout de Central nunca impide guardar el abono.
 *
 * Script Properties requeridas:
 *   CENTRAL_API_TOKEN
 *
 * Config requerida:
 *   CENTRAL_API_URL
 *   CENTRAL_SYNC_ENABLED
 *   CENTRAL_SYNC_START
 */

var _baseDoPostV33_ = doPost;
doPost = function(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(body.action || '') === 'syncCentral') {
      return json_(protected_(body, syncCentralAction_));
    }
  } catch (err) {
    return json_({ok:false, message:'Error del servidor', detail:String(err && err.message || err)});
  }
  return _baseDoPostV33_(e);
};

function authorizeCentralConnection() {
  var token = props_().getProperty('CENTRAL_API_TOKEN');
  if (!token) throw new Error('Falta CENTRAL_API_TOKEN en Script Properties.');
  var result = centralApiGetAccounts_(token);
  Logger.log(JSON.stringify(result));
  return result;
}

function syncCentralCurrentWeekNow() {
  return syncCentralCurrentWeek_('manual_apps_script', centralCurrentTuesday_());
}

function syncCentralAction_(body, device) {
  var weekDate = ymd_(body.weekDate) || centralCurrentTuesday_();
  return syncCentralCurrentWeek_(device || 'system', weekDate);
}

function syncCentralCurrentWeekSafe_(device, weekDate) {
  try {
    return syncCentralCurrentWeek_(device || 'system', weekDate || centralCurrentTuesday_());
  } catch (err) {
    log_('CENTRAL_SYNC', String(weekDate || 'current_week'), 'SYNC_ERROR', String(err && err.message || err), device || 'system');
    return {ok:false, message:String(err && err.message || err)};
  }
}

function syncCentralCurrentWeek_(device, weekDate) {
  weekDate = ymd_(weekDate) || centralCurrentTuesday_();
  var enabled = String(centralConfigValue_('CENTRAL_SYNC_ENABLED', 'FALSE')).toUpperCase() === 'TRUE';
  if (!enabled) return {ok:true, disabled:true, weekDate:weekDate, message:'Sincronización pausada.'};

  var start = centralConfigValue_('CENTRAL_SYNC_START', '2026-09-29');
  if (start && weekDate < start) {
    return {ok:true, skipped:true, weekDate:weekDate, message:'Semana anterior al inicio de sincronización.'};
  }

  var token = props_().getProperty('CENTRAL_API_TOKEN');
  if (!token) {
    log_('CENTRAL_SYNC', weekDate, 'NOT_CONFIGURED', 'Falta CENTRAL_API_TOKEN en Script Properties', device);
    return {ok:false, configured:false, weekDate:weekDate, message:'Falta CENTRAL_API_TOKEN en Script Properties.'};
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return {ok:false, busy:true, weekDate:weekDate, message:'Ya hay otra sincronización en proceso.'};
  try {
    var model = centralBuildWeekModel_(weekDate);
    var mappings = centralActiveMappings_();
    var desired = centralDesiredItems_(model, mappings);
    if (!desired.length) return centralSummarizeResult_({ok:true, configured:true, weekDate:weekDate, results:[]});

    var snapshot = centralApiGetAccounts_(token);
    if (!snapshot.ok) throw new Error(snapshot.error || 'No se pudieron leer las cuentas de Central.');
    var accounts = snapshot.accounts || [];
    var results = [];

    desired.forEach(function(item) {
      var map = item.map;
      var centralId = String(map.CentralAccountID || '').trim();
      if (!centralId) {
        results.push({syncKey:item.syncKey, skipped:true, reason:'CentralAccountID vacío'});
        return;
      }

      var account = centralFindAccount_(accounts, centralId);
      if (!account && String(item.cuentaId || '') === 'u') {
        var create = centralApiPost_(token, {
          action:'createAccount',
          id:centralId,
          name:'Fondo Universidad',
          balance:0,
          categoryId:String(map.CentralCategoryID || 'universidad')
        });
        if (!create.ok) {
          results.push({syncKey:item.syncKey, error:create.error || 'No se pudo crear Fondo Universidad'});
          return;
        }
        snapshot = centralApiGetAccounts_(token);
        if (!snapshot.ok) {
          results.push({syncKey:item.syncKey, error:snapshot.error || 'No se pudo refrescar Central'});
          return;
        }
        accounts = snapshot.accounts || [];
        account = centralFindAccount_(accounts, centralId);
      }

      if (!account) {
        results.push({syncKey:item.syncKey, error:'Cuenta no encontrada en Central: ' + centralId});
        return;
      }

      var prior = centralSyncState_(weekDate, item.syncKey);
      var syncedBefore = prior ? num_(prior.SyncedAmount) : 0;
      var desiredAmount = centralRound_(item.desiredAmount);
      var delta = centralRound_(desiredAmount - syncedBefore);

      if (Math.abs(delta) < 0.01) {
        results.push({
          syncKey:item.syncKey,
          centralAccountId:centralId,
          desiredAmount:desiredAmount,
          delta:0,
          status:'SIN_CAMBIOS'
        });
        return;
      }

      var beforeBalance = num_(account.balance);
      var afterBalance = centralRound_(beforeBalance + delta);
      if (afterBalance < -0.01) {
        centralUpsertSyncState_(weekDate, item, desiredAmount, syncedBefore, delta, 'ERROR_SALDO_NEGATIVO');
        results.push({syncKey:item.syncKey, error:'La corrección dejaría saldo negativo en ' + centralId});
        return;
      }
      afterBalance = Math.max(0, afterBalance);

      var operationId = 'FLOTILLA_' + weekDate.replace(/-/g, '') + '_' + item.syncKey;
      var updated = centralApiPost_(token, {
        action:'updateBalance',
        id:centralId,
        balance:afterBalance,
        context:{
          type:'Fondeo automático Flotilla',
          operationId:operationId,
          month:weekDate.slice(0,7),
          week:weekDate
        }
      });

      if (!updated.ok) {
        centralUpsertSyncState_(weekDate, item, desiredAmount, syncedBefore, delta, 'ERROR: ' + String(updated.error || ''));
        results.push({syncKey:item.syncKey, error:updated.error || 'No se pudo actualizar Central'});
        return;
      }

      account.balance = afterBalance;
      centralUpsertSyncState_(weekDate, item, desiredAmount, desiredAmount, delta, 'OK');
      log_('CENTRAL_SYNC', operationId, 'SYNC_ACCOUNT', JSON.stringify({
        weekDate:weekDate,
        cuentaId:item.cuentaId,
        vehicleId:item.vehicleId,
        centralAccountId:centralId,
        beforeBalance:beforeBalance,
        delta:delta,
        afterBalance:afterBalance
      }), device);

      results.push({
        syncKey:item.syncKey,
        centralAccountId:centralId,
        desiredAmount:desiredAmount,
        beforeBalance:beforeBalance,
        delta:delta,
        newBalance:afterBalance,
        status:'OK'
      });
    });

    return centralSummarizeResult_({ok:true, configured:true, weekDate:weekDate, results:results});
  } finally {
    lock.releaseLock();
  }
}

function centralSummarizeResult_(result) {
  var moved = (result.results || []).filter(function(r) {
    return r.status === 'OK' && Math.abs(num_(r.delta)) > 0.005;
  }).map(function(r) {
    var delta = centralRound_(r.delta);
    var after = centralRound_(r.newBalance);
    var before = r.beforeBalance !== undefined ? centralRound_(r.beforeBalance) : centralRound_(after - delta);
    return {
      syncKey:String(r.syncKey || ''),
      centralAccountId:String(r.centralAccountId || ''),
      beforeBalance:before,
      delta:delta,
      afterBalance:after
    };
  });
  result.moved = moved;
  result.totalAdded = centralRound_(moved.reduce(function(sum,r){return sum + Math.max(0,num_(r.delta));},0));
  result.totalRemoved = centralRound_(moved.reduce(function(sum,r){return sum + Math.max(0,-num_(r.delta));},0));
  result.totalNet = centralRound_(moved.reduce(function(sum,r){return sum + num_(r.delta);},0));
  return result;
}

function centralBuildWeekModel_(weekDate) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var vehicles = sheetObjects_(ss.getSheetByName('Vehiculos')).filter(function(v) {
    var op = String(v.OperacionEstado || 'ACTIVO').toUpperCase();
    return op !== 'FINALIZADO' && op !== 'CANCELADO' && String(v.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO';
  });
  var plans = sheetObjects_(ss.getSheetByName('Plan_Pagos'));
  var weekStart = new Date(weekDate + 'T00:00:00Z');
  var weekEnd = new Date(weekStart.getTime());
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  var rows = [];

  vehicles.forEach(function(v) {
    var vehicleId = String(v.VehicleID || '');
    var vPlans = plans.filter(function(p) { return String(p.VehicleID || '') === vehicleId; });
    if (vPlans.length) {
      vPlans.forEach(function(p) {
        var date = ymd_(p.FechaProgramada);
        if (!date) return;
        var d = new Date(date + 'T00:00:00Z');
        if (d < weekStart || d > weekEnd) return;
        rows.push({
          vehicleId:vehicleId,
          date:date,
          amount:num_(p.CuotaTotal || v.CuotaSemanal),
          iva:num_(p.IVA || num_(p.CuotaTotal || v.CuotaSemanal) * 0.13),
          insurance:num_(p.Seguro || centralDefaultInsurance_(v))
        });
      });
      return;
    }

    var frequency = String(v.Frecuencia || 'SEMANAL').toUpperCase();
    if (frequency === 'QUINCENAL_15_FIN_MES') {
      centralSpecialDatesForWindow_(v, weekStart, weekEnd).forEach(function(date) {
        rows.push({
          vehicleId:vehicleId,
          date:date,
          amount:num_(v.CuotaSemanal),
          iva:num_(v.CuotaSemanal) * 0.13,
          insurance:centralDefaultInsurance_(v)
        });
      });
      return;
    }

    var start = ymd_(v.FechaInicio), end = ymd_(v.FechaFin);
    if (!start || !end) return;
    var d = new Date(start + 'T00:00:00Z');
    var finish = new Date(end + 'T00:00:00Z');
    while (d < weekStart) d.setUTCDate(d.getUTCDate() + 7);
    while (d <= weekEnd && d <= finish) {
      var date = Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
      rows.push({
        vehicleId:vehicleId,
        date:date,
        amount:num_(v.CuotaSemanal),
        iva:num_(v.CuotaSemanal) * 0.13,
        insurance:centralDefaultInsurance_(v)
      });
      d.setUTCDate(d.getUTCDate() + 7);
    }
  });

  rows.forEach(function(r) { r.received = sumReceived_(ss, r.vehicleId, r.date); });
  var available = rows.reduce(function(sum,r) { return sum + num_(r.received); }, 0);
  var automaticIVA = rows.reduce(function(sum,r) { return sum + num_(r.iva); }, 0);
  var automaticInsurance = rows.reduce(function(sum,r) { return sum + num_(r.insurance); }, 0);

  var accounts = sheetObjects_(ss.getSheetByName('Cuentas')).filter(function(a) {
    var from = ymd_(a.VigenteDesde), to = ymd_(a.VigenteHasta);
    return (!from || weekDate >= from) && (!to || weekDate <= to) && String(a.Activa || '').toUpperCase() !== 'FALSE';
  }).map(function(a) {
    var id = String(a.CuentaID || '');
    var type = String(a.Tipo || 'SEMANAL').toUpperCase();
    var need = 0;
    if (id === 'iva') need = automaticIVA;
    else if (id === 'seguros') need = automaticInsurance;
    else if (type === 'SEMANAL') need = (id === 'casa' && centralIsFifthTuesday_(weekStart)) ? 0 : num_(a.Monto);
    return {
      id:id,
      type:type,
      need:need,
      assigned:0,
      priority:String(a.Prioridad || 'BAJA').toUpperCase(),
      order:num_(a.Orden || 99)
    };
  });

  var priorityRank = {CRITICA:0, MEDIA:1, BAJA:2};
  var regular = accounts.filter(function(a){return a.type !== 'REMANENTE';}).sort(function(a,b){
    var ar = priorityRank[a.priority] == null ? 2 : priorityRank[a.priority];
    var br = priorityRank[b.priority] == null ? 2 : priorityRank[b.priority];
    return ar - br || a.order - b.order;
  });
  var remaining = available;
  regular.forEach(function(a) {
    a.assigned = Math.min(a.need, remaining);
    remaining -= a.assigned;
  });
  var rem = accounts.find(function(a){return a.type === 'REMANENTE';});
  if (rem) {
    rem.need = Math.max(0, remaining);
    rem.assigned = Math.max(0, remaining);
  }

  return {weekDate:weekDate, rows:rows, accounts:accounts, available:available};
}

function centralDesiredItems_(model, mappings) {
  var out = [];

  ['omoda','coopealianza','u'].forEach(function(cuentaId) {
    var expense = model.accounts.find(function(a){return a.id === cuentaId;});
    var map = mappings.find(function(m){
      return String(m.CuentaID || '') === cuentaId && !String(m.VehicleID || '');
    });
    if (expense && map) {
      out.push({
        syncKey:String(map.SyncKey || cuentaId),
        cuentaId:cuentaId,
        vehicleId:'',
        desiredAmount:num_(expense.assigned),
        map:map
      });
    }
  });

  var insurance = model.accounts.find(function(a){return a.id === 'seguros';});
  var assignedInsurance = insurance ? num_(insurance.assigned) : 0;
  var totalInsurance = model.rows.reduce(function(sum,r){return sum + num_(r.insurance);},0);
  if (totalInsurance <= 0) return out;

  var mappedNeed = 0;
  model.rows.forEach(function(row) {
    var map = mappings.find(function(m){
      return String(m.CuentaID || '') === 'seguros' &&
             String(m.Modo || '').toUpperCase() === 'INSURANCE' &&
             String(m.VehicleID || '') === String(row.vehicleId);
    });
    if (!map || num_(row.insurance) <= 0) return;
    mappedNeed += num_(row.insurance);
    out.push({
      syncKey:String(map.SyncKey || ('seguro_' + row.vehicleId)),
      cuentaId:'seguros',
      vehicleId:String(row.vehicleId),
      desiredAmount:centralRound_(assignedInsurance * num_(row.insurance) / totalInsurance),
      map:map
    });
  });

  // El seguro del S1 no existe como cuenta en Central. La porción de Seguros
  // que no tiene subcuenta de vehículo alimenta Spark Celeste mientras este
  // todavía no tiene plan propio en Flotilla.
  var excessNeed = Math.max(0, totalInsurance - mappedNeed);
  var excessMap = mappings.find(function(m){
    return String(m.CuentaID || '') === 'seguros' && String(m.Modo || '').toUpperCase() === 'INSURANCE_EXCESS';
  });
  if (excessMap && excessNeed > 0.005) {
    out.push({
      syncKey:String(excessMap.SyncKey || 'seguro_sparkceleste'),
      cuentaId:'seguros',
      vehicleId:'',
      desiredAmount:centralRound_(assignedInsurance * excessNeed / totalInsurance),
      map:excessMap
    });
  }

  return out;
}

function centralDefaultInsurance_(vehicle) {
  return String(vehicle.Frecuencia || '').toUpperCase() === 'QUINCENAL_15_FIN_MES' ? 10000 : 5000;
}

function centralSpecialDatesForWindow_(vehicle, start, end) {
  var result = [];
  var cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  var hardStart = ymd_(vehicle.FechaInicio), hardEnd = ymd_(vehicle.FechaFin);
  while (cursor <= end) {
    var y = cursor.getUTCFullYear(), m = cursor.getUTCMonth();
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    [15,last].forEach(function(day) {
      var d = new Date(Date.UTC(y,m,day));
      var iso = Utilities.formatDate(d,'UTC','yyyy-MM-dd');
      if (d >= start && d <= end && (!hardStart || iso >= hardStart) && (!hardEnd || iso <= hardEnd)) result.push(iso);
    });
    cursor = new Date(Date.UTC(y,m+1,1));
  }
  return result;
}

function centralCurrentTuesday_() {
  var parts = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').split('-').map(Number);
  var d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
  var add = (2 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function centralIsFifthTuesday_(date) {
  return Math.floor((date.getUTCDate() - 1) / 7) + 1 >= 5;
}

function centralConfigValue_(key, fallback) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var rows = sheetObjects_(ss.getSheetByName('Config'));
  var hit = rows.find(function(r){return String(r.Clave || '') === String(key);});
  return hit && hit.Valor !== '' && hit.Valor != null ? String(hit.Valor) : fallback;
}

function centralActiveMappings_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return sheetObjects_(ss.getSheetByName('Central_Map')).filter(function(r){return bool_(r.Activo);});
}

function centralSyncState_(weekDate, syncKey) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('Central_Sync');
  if (!sh) return null;
  var key = String(weekDate) + '|' + String(syncKey);
  return sheetObjects_(sh).find(function(r){return String(r.StateKey || '') === key;}) || null;
}

function centralUpsertSyncState_(weekDate, item, desired, synced, delta, status) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('Central_Sync');
  if (!sh) return;
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String), idx = {};
  headers.forEach(function(h,i){idx[h]=i;});
  var key = String(weekDate) + '|' + String(item.syncKey), row = -1;
  for (var r=1;r<values.length;r++) {
    if (String(values[r][idx.StateKey]) === key) {row=r+1;break;}
  }
  var data = [
    key,weekDate,item.cuentaId,item.vehicleId,String(item.map.CentralAccountID || ''),
    desired,synced,delta,status,new Date()
  ];
  if (row < 0) sh.appendRow(data);
  else sh.getRange(row,1,1,data.length).setValues([data]);
}

function centralApiGetAccounts_(token) {
  var url = centralConfigValue_('CENTRAL_API_URL','');
  if (!url) return {ok:false,error:'Falta CENTRAL_API_URL.'};
  try {
    var response = UrlFetchApp.fetch(url + '?action=getAccounts&token=' + encodeURIComponent(token), {
      method:'get',
      muteHttpExceptions:true
    });
    var data = JSON.parse(response.getContentText());
    if (!data.ok) return {ok:false,error:data.error || 'Central rechazó getAccounts'};
    return {ok:true,accounts:Array.isArray(data.accounts)?data.accounts:[]};
  } catch (e) {
    return {ok:false,error:String(e && e.message || e)};
  }
}

function centralApiPost_(token, payload) {
  var url = centralConfigValue_('CENTRAL_API_URL','');
  if (!url) return {ok:false,error:'Falta CENTRAL_API_URL.'};
  try {
    var body = {};
    Object.keys(payload || {}).forEach(function(k){body[k]=payload[k];});
    body.token = token;
    var response = UrlFetchApp.fetch(url, {
      method:'post',
      contentType:'text/plain;charset=utf-8',
      payload:JSON.stringify(body),
      muteHttpExceptions:true
    });
    var data = JSON.parse(response.getContentText());
    if (!data.ok) return {ok:false,error:data.error || data.message || 'Central rechazó la operación'};
    return data;
  } catch (e) {
    return {ok:false,error:String(e && e.message || e)};
  }
}

function centralFindAccount_(accounts, id) {
  var key = String(id || '').trim().toLowerCase();
  return (accounts || []).find(function(a){return String(a.id || '').trim().toLowerCase() === key;}) || null;
}

function centralRound_(value) {
  return Math.round(num_(value) * 100) / 100;
}
