/*
 * Base de Datos Flotilla · Aportes directos al archivo global de Drive
 *
 * El aporte se ejecuta después del pago y solo con autorización en la interfaz.
 * La Central lee el mismo archivo global; Flotilla no llama a su Apps Script.
 *
 * Script Properties: FLOTILLA_GLOBAL_SYNC_ENABLED=TRUE y, en pruebas,
 * FLOTILLA_GLOBAL_SPREADSHEET_ID=<copia distinta del archivo global>.
 */

var GLOBAL_ACCOUNTS_SPREADSHEET_ID_ = '1JzFD2DDcCNWebZQ9F3Xw_zztU_mBfjD4';

function globalSpreadsheetId_() {
  if (!isTestMode_()) return GLOBAL_ACCOUNTS_SPREADSHEET_ID_;
  var id = String(props_().getProperty('FLOTILLA_GLOBAL_SPREADSHEET_ID') || '').trim();
  if (!id || id === GLOBAL_ACCOUNTS_SPREADSHEET_ID_) {
    throw new Error('Pruebas: configurá una copia distinta del archivo global.');
  }
  return id;
}

function globalSyncReady_() {
  if (String(props_().getProperty('FLOTILLA_GLOBAL_SYNC_ENABLED') || '').toUpperCase() !== 'TRUE') return false;
  try { globalSpreadsheetId_(); return true; } catch (_) { return false; }
}

function authorizeCentralConnection() {
  var result = centralApiGetAccounts_();
  Logger.log(JSON.stringify(result));
  return result;
}

function syncCentralCurrentWeekNow() {
  return {ok:false, message:'Elegí una cuenta desde Flotilla para confirmar su sincronización.'};
}

function syncCentralAction_(body, device) {
  var weekDate = ymd_(body.weekDate) || centralCurrentTuesday_();
  var cuentaId = String(body.cuentaId || '').trim();
  if (!['casa','omoda','coopealianza','u','seguros'].includes(cuentaId)) {
    return {ok:false, message:'Seleccioná una cuenta válida para sincronizar.'};
  }
  return syncCentralCurrentWeek_(device || 'system', weekDate, cuentaId);
}

function syncCentralCurrentWeekSafe_(device, weekDate) {
  try {
    return syncCentralCurrentWeek_(device || 'system', weekDate || centralCurrentTuesday_());
  } catch (err) {
    log_('CENTRAL_SYNC', String(weekDate || 'current_week'), 'SYNC_ERROR', String(err && err.message || err), device || 'system');
    return {ok:false, message:String(err && err.message || err)};
  }
}

function syncCentralCurrentWeek_(device, weekDate, onlyAccount, lockAlreadyHeld) {
  weekDate = ymd_(weekDate) || centralCurrentTuesday_();
  if (!globalSyncReady_()) return {ok:true, disabled:true, weekDate:weekDate, message:'Aportes al archivo global desactivados.'};
  if (!['casa','omoda','coopealianza','u','seguros'].includes(String(onlyAccount || ''))) {
    return {ok:false, weekDate:weekDate, message:'Falta seleccionar una cuenta para sincronizar.'};
  }

  var start = centralConfigValue_('CENTRAL_SYNC_START', '2026-09-29');
  if (start && weekDate < start) {
    return {ok:true, skipped:true, weekDate:weekDate, message:'Semana anterior al inicio de sincronización.'};
  }

  var lock = null;
  if (!lockAlreadyHeld) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return {ok:false, busy:true, weekDate:weekDate, message:'Ya hay otra sincronización en proceso.'};
  }
  try {
    var model = centralBuildWeekModel_(weekDate);
    var mappings = centralActiveMappings_();
    var desired = centralDesiredItems_(model, mappings).filter(function(item) {
      return !onlyAccount || item.cuentaId === onlyAccount;
    });
    if (!desired.length) return centralSummarizeResult_({ok:true, configured:true, weekDate:weekDate, results:[]});

    var snapshot = centralApiGetAccounts_();
    if (!snapshot.ok) throw new Error(snapshot.error || 'No se pudieron leer las cuentas del archivo global.');
    var accounts = snapshot.accounts || [];
    var results = [];

    desired.forEach(function(item) {
      var map = item.map;
      var centralId = String(map.CentralAccountID || '').trim();
      if (!centralId) {
        results.push({syncKey:item.syncKey, skipped:true, reason:'CentralAccountID vacío'});
        return;
      }

      var prior = centralSyncState_(weekDate, item.syncKey);
      var desiredAmount = centralRoundUp500_(item.desiredAmount);
      var pending = prior && String(prior.Status || '') === 'PENDING' && String(prior.OperationID || '');
      var syncedBefore = pending
        ? num_(prior.SyncedAmount)
        : centralGlobalSyncedAmount_(weekDate, item.syncKey, centralId);
      var delta = centralRound_(desiredAmount - syncedBefore);
      if (!pending && Math.abs(delta) < 0.01) {
        results.push({syncKey:item.syncKey, centralAccountId:centralId, desiredAmount:desiredAmount, delta:0, status:'SIN_CAMBIOS'});
        return;
      }

      var account = centralFindAccount_(accounts, centralId);
      if (!account) {
        results.push({syncKey:item.syncKey, error:'Cuenta no encontrada en el archivo global: ' + centralId});
        return;
      }

      if (pending && Math.abs(num_(prior.DesiredAmount) - desiredAmount) > 0.005) {
        results.push({syncKey:item.syncKey, error:'Hay una operación pendiente de verificar; no se puede cambiar su monto todavía.'});
        return;
      }

      if (pending) {
        var check = centralApiGetOperation_(String(prior.OperationID));
        if (!check.ok) {
          results.push({syncKey:item.syncKey, error:check.error || 'No se pudo verificar la operación pendiente.'});
          return;
        }
        if (check.found) {
          var previousOperation = check.operation || {};
          if (String(previousOperation.accountId || '') !== centralId ||
              Math.abs(num_(previousOperation.movement) - num_(prior.Delta)) > 0.005 ||
              Math.abs(num_(previousOperation.newBalance) - num_(prior.TargetBalance)) > 0.005) {
            results.push({syncKey:item.syncKey, error:'La operación registrada en Central no coincide; requiere revisión manual.'});
            return;
          }
          centralUpsertSyncState_(weekDate, item, desiredAmount, desiredAmount, num_(prior.Delta), 'OK', prior);
          results.push({syncKey:item.syncKey, centralAccountId:centralId, desiredAmount:desiredAmount, delta:0, status:'RECUPERADA'});
          return;
        }
        if (Math.abs(num_(account.balance) - num_(prior.BeforeBalance)) > 0.005) {
          results.push({syncKey:item.syncKey, error:'El saldo del archivo global cambió durante una operación pendiente; requiere revisión manual.'});
          return;
        }
      }

      var beforeBalance = pending ? num_(prior.BeforeBalance) : num_(account.balance);
      var afterBalance = centralRound_(beforeBalance + delta);
      if (afterBalance < -0.01) {
        centralUpsertSyncState_(weekDate, item, desiredAmount, syncedBefore, delta, 'ERROR_SALDO_NEGATIVO');
        results.push({syncKey:item.syncKey, error:'La corrección dejaría saldo negativo en ' + centralId});
        return;
      }
      afterBalance = Math.max(0, afterBalance);

      var operationId = pending ? String(prior.OperationID) :
        'FLOTILLA_' + weekDate.replace(/-/g, '') + '_' + item.syncKey + '_' + Utilities.getUuid();
      var operation = {OperationID:operationId, BeforeBalance:beforeBalance, TargetBalance:afterBalance};
      if (!pending) {
        centralUpsertSyncState_(weekDate, item, desiredAmount, syncedBefore, delta, 'PENDING', operation);
        SpreadsheetApp.flush();
      }
      var updated = centralApiPost_({
        action:'updateBalance',
        id:centralId,
        balance:afterBalance,
        context:{
          type:'Fondeo automático Flotilla',
          operationId:operationId,
          expectedBalance:beforeBalance,
          month:weekDate.slice(0,7),
          week:weekDate
        }
      });

      if (!updated.ok) {
        // La respuesta puede perderse después de la escritura: se conserva
        // PENDING para verificar el historial del archivo global antes de reintentar.
        results.push({syncKey:item.syncKey, error:updated.error || 'No se pudo actualizar Central'});
        return;
      }

      account.balance = afterBalance;
      centralUpsertSyncState_(weekDate, item, desiredAmount, desiredAmount, delta, 'OK', operation);
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
    if (lock) lock.releaseLock();
  }
}

function centralSyncedAccountIdsForWeek_(weekDate) {
  var ss = SpreadsheetApp.openById(mainSpreadsheetId_());
  var sh = ss.getSheetByName('Central_Sync');
  if (!sh || sh.getLastRow() < 2) return [];
  var allowed = ['casa','omoda','coopealianza','u','seguros'];
  var seen = {};
  return sheetObjects_(sh).filter(function(row) {
    if (ymd_(row.WeekDate) !== weekDate) return false;
    var cuentaId = String(row.CuentaID || '').trim();
    if (allowed.indexOf(cuentaId) < 0) return false;
    var active = Math.abs(num_(row.SyncedAmount)) > 0.005 || String(row.Status || '').toUpperCase() === 'PENDING';
    if (!active || seen[cuentaId]) return false;
    seen[cuentaId] = true;
    return true;
  }).map(function(row) {
    return String(row.CuentaID || '').trim();
  });
}

function reconcileGlobalAfterPaymentReversal_(device, scheduledDate, realDate, lockAlreadyHeld) {
  var allocation = centralPaymentDistribution_(scheduledDate, realDate);
  var weekDate = allocation.weekDate || centralCurrentTuesday_(ymd_(realDate));
  if (allocation.debtRecovery) {
    return {ok:true, weekDate:weekDate, results:[], totalRemoved:0, debtRecovery:true, message:'La reversa solo afecta Pago de deudas; no había aporte global que ajustar.'};
  }
  if (!globalSyncReady_()) {
    return {ok:true, disabled:true, weekDate:weekDate, results:[], totalRemoved:0, message:'Aportes al archivo global desactivados.'};
  }

  var accounts = centralSyncedAccountIdsForWeek_(weekDate);
  if (!accounts.length) {
    return {ok:true, weekDate:weekDate, results:[], totalRemoved:0, message:'No había aportes autorizados en esa semana.'};
  }

  var results = [], totalRemoved = 0, errors = [];
  accounts.forEach(function(cuentaId) {
    var response = syncCentralCurrentWeek_(device || 'system', weekDate, cuentaId, !!lockAlreadyHeld);
    results.push({cuentaId:cuentaId, response:response});
    totalRemoved += num_(response && response.totalRemoved);
    if (!response || response.ok === false || (response.results || []).some(function(r){return !!r.error;})) {
      errors.push({
        cuentaId:cuentaId,
        message:response && (response.message || (response.results || []).find(function(r){return r.error;})?.error) || 'No se pudo reconciliar.'
      });
    }
  });

  var moved = [];
  results.forEach(function(entry) {
    (entry.response && entry.response.moved || []).forEach(function(change) {
      moved.push({
        cuentaId:entry.cuentaId,
        centralAccountId:String(change.centralAccountId || ''),
        beforeBalance:centralRound_(change.beforeBalance),
        delta:centralRound_(change.delta),
        afterBalance:centralRound_(change.afterBalance)
      });
    });
  });

  return {
    ok:errors.length===0,
    weekDate:weekDate,
    accounts:accounts,
    results:results,
    moved:moved,
    totalRemoved:centralRound_(totalRemoved),
    errors:errors,
    message:errors.length ? 'El pago se reversó, pero uno o más aportes globales quedaron pendientes de revisión.' : 'Aportes globales reconciliados.'
  };
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
  var ss = SpreadsheetApp.openById(mainSpreadsheetId_());
  var vehicles = sheetObjects_(ss.getSheetByName('Vehiculos')).filter(function(v) {
    var op = String(v.OperacionEstado || 'ACTIVO').toUpperCase();
    return op !== 'FINALIZADO' && op !== 'CANCELADO' && String(v.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO';
  });
  var plans = sheetObjects_(ss.getSheetByName('Plan_Pagos'));
  var weekStart = new Date(weekDate + 'T00:00:00Z');
  weekStart.setUTCDate(weekStart.getUTCDate() - 1);
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
  var cash = centralCashAllocationForWeek_(sheetObjects_(ss.getSheetByName('Pagos_Reales')), weekDate);
  var available = cash.operational;
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
    else if (type === 'SEMANAL') need = (id === 'casa' && centralIsFifthTuesday_(new Date(weekDate + 'T00:00:00Z'))) ? 0 : num_(a.Monto);
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
    rem.need = Math.max(0, remaining + cash.debtRecovery);
    rem.assigned = Math.max(0, remaining + cash.debtRecovery);
  }

  return {weekDate:weekDate, rows:rows, accounts:accounts, available:cash.total, operationalAvailable:cash.operational, debtRecovery:cash.debtRecovery};
}
function centralPreviousCalendarMonthDate_(date) {
  var d = new Date(date);
  var firstTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  var lastDay = new Date(Date.UTC(firstTarget.getUTCFullYear(), firstTarget.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(firstTarget.getUTCFullYear(), firstTarget.getUTCMonth(), Math.min(d.getUTCDate(), lastDay)));
}
function centralPaymentDistribution_(scheduledDate, realDate) {
  var scheduled = ymd_(scheduledDate), real = ymd_(realDate);
  if (!scheduled || !real) return {weekDate:'',debtRecovery:false};
  var scheduledObj = new Date(scheduled + 'T00:00:00Z');
  var realObj = new Date(real + 'T00:00:00Z');
  var debtRecovery = scheduledObj < centralPreviousCalendarMonthDate_(realObj);
  return {
    weekDate:centralCurrentTuesday_(debtRecovery ? real : scheduled),
    debtRecovery:debtRecovery
  };
}
function centralCashAllocationForWeek_(payments, weekDate) {
  var result = {operational:0,debtRecovery:0,total:0};
  payments.forEach(function(p) {
    var allocation = centralPaymentDistribution_(p.FechaProgramada, p.FechaReal || p.CreatedAt);
    if (allocation.weekDate !== weekDate) return;
    var amount = num_(p.MontoRecibido);
    if (allocation.debtRecovery) result.debtRecovery += amount;
    else result.operational += amount;
  });
  result.total = result.operational + result.debtRecovery;
  return result;
}
function centralCashReceivedForWeek_(payments,start,end) {
  var startDate = new Date(String(start) + 'T00:00:00Z');
  startDate.setUTCDate(startDate.getUTCDate() + 1);
  var weekDate = Utilities.formatDate(startDate,'UTC','yyyy-MM-dd');
  return centralCashAllocationForWeek_(payments,weekDate).total;
}

function centralDesiredItems_(model, mappings) {
  var out = [];

  ['casa','omoda','coopealianza','u'].forEach(function(cuentaId) {
    var expense = model.accounts.find(function(a){return a.id === cuentaId;});
    var map = mappings.find(function(m){
      return String(m.CuentaID || '') === cuentaId && !String(m.VehicleID || '');
    });
    // La copia existente no tenía Cuentas casa en Central_Map.
    if (!map && cuentaId === 'casa') map = {SyncKey:'casa',CuentaID:'casa',CentralAccountID:'cuentas_casa'};
    if (map && cuentaId === 'u') {
      var weekNumber = Math.ceil(Number(String(model.weekDate || '').slice(8,10)) / 7);
      if (weekNumber < 1 || weekNumber > 5) return;
      map = Object.assign({}, map, {CentralAccountID:'semana_' + weekNumber});
    }
    if (expense && map) {
      out.push({
        syncKey:String(map.SyncKey || cuentaId),
        cuentaId:cuentaId,
        vehicleId:'',
        desiredAmount:centralFullyFunded_(expense) ? num_(expense.need) : 0,
        map:map
      });
    }
  });

  var insurance = model.accounts.find(function(a){return a.id === 'seguros';});
  var assignedInsurance = centralFullyFunded_(insurance) ? num_(insurance.need) : 0;
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

function centralFullyFunded_(account) {
  return !!account && num_(account.need) > 0.005 &&
    num_(account.assigned) >= num_(account.need) - 0.005;
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

function centralCurrentTuesday_(date) {
  var parts = (date ? ymd_(date) : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')).split('-').map(Number);
  var d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7 + 1);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function centralIsFifthTuesday_(date) {
  return Math.floor((date.getUTCDate() - 1) / 7) + 1 >= 5;
}

function centralConfigValue_(key, fallback) {
  var ss = SpreadsheetApp.openById(mainSpreadsheetId_());
  var rows = sheetObjects_(ss.getSheetByName('Config'));
  var hit = rows.find(function(r){return String(r.Clave || '') === String(key);});
  return hit && hit.Valor !== '' && hit.Valor != null ? String(hit.Valor) : fallback;
}

function centralActiveMappings_() {
  var ss = SpreadsheetApp.openById(mainSpreadsheetId_());
  return sheetObjects_(ss.getSheetByName('Central_Map')).filter(function(r){return bool_(r.Activo);});
}

function centralSyncState_(weekDate, syncKey) {
  var ss = SpreadsheetApp.openById(mainSpreadsheetId_());
  var sh = ss.getSheetByName('Central_Sync');
  if (!sh) return null;
  var key = String(weekDate) + '|' + String(syncKey);
  return sheetObjects_(sh).find(function(r){return String(r.StateKey || '') === key;}) || null;
}

function centralUpsertSyncState_(weekDate, item, desired, synced, delta, status, operation) {
  var ss = SpreadsheetApp.openById(mainSpreadsheetId_());
  var sh = ss.getSheetByName('Central_Sync');
  if (!sh) throw new Error('Falta la hoja Central_Sync para registrar la operación.');
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String), idx = {};
  if (headers.length < 13) {
    sh.getRange(1,11,1,3).setValues([['OperationID','BeforeBalance','TargetBalance']]);
    values = sh.getDataRange().getValues();
    headers = values[0].map(String);
  }
  headers.forEach(function(h,i){idx[h]=i;});
  var key = String(weekDate) + '|' + String(item.syncKey), row = -1;
  for (var r=1;r<values.length;r++) {
    if (String(values[r][idx.StateKey]) === key) {row=r+1;break;}
  }
  operation = operation || {};
  var data = [
    key,weekDate,item.cuentaId,item.vehicleId,String(item.map.CentralAccountID || ''),
    desired,synced,delta,status,new Date(),
    String(operation.OperationID || ''),num_(operation.BeforeBalance),num_(operation.TargetBalance)
  ];
  if (row < 0) sh.appendRow(data);
  else sh.getRange(row,1,1,data.length).setValues([data]);
}

// Estos nombres se conservan para el cálculo existente; todas las operaciones
// leen y escriben el archivo global directamente, sin llamadas HTTP a Central.
function centralGlobalSheets_() {
  var ss = SpreadsheetApp.openById(globalSpreadsheetId_());
  var accounts = ss.getSheetByName('Cuentas mensuales');
  var history = ss.getSheetByName('Historial');
  if (!accounts || !history) throw new Error('Faltan Cuentas mensuales o Historial en el archivo global.');
  return {accounts:accounts,history:history};
}

function centralGlobalAccount_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 4) return null;
  var rows = sheet.getRange(4,1,last-3,5).getValues();
  var key = String(id || '').trim().toLowerCase();
  for (var i=0;i<rows.length;i++) {
    if (String(rows[i][3] || '').trim().toLowerCase() === key &&
        String(rows[i][2] || '').trim().toLowerCase() === 'cuenta') {
      return {row:i+4,id:String(rows[i][3]),name:String(rows[i][0]),balance:num_(rows[i][1])};
    }
  }
  return null;
}

function centralGlobalSyncedAmount_(weekDate, syncKey, centralId) {
  try {
    var history = centralGlobalSheets_().history, last = history.getLastRow();
    if (last < 2) return 0;
    var rows = history.getRange(2,1,last-1,10).getValues();
    var prefix = 'FLOTILLA_' + String(weekDate || '').replace(/-/g,'') + '_' + String(syncKey || '') + '_';
    var accountKey = String(centralId || '').trim().toLowerCase();
    return centralRound_(rows.reduce(function(sum,row) {
      var operationId = String(row[1] || '');
      var accountId = String(row[4] || '').trim().toLowerCase();
      if (operationId.indexOf(prefix) !== 0 || accountId !== accountKey) return sum;
      return sum + num_(row[6]);
    },0));
  } catch (e) {
    throw new Error('No se pudo verificar el historial real del archivo global: ' + String(e && e.message || e));
  }
}

function centralApiGetOperation_(operationId) {
  try {
    var history = centralGlobalSheets_().history, last = history.getLastRow();
    if (last < 2) return {ok:true,found:false};
    var ids = history.getRange(2,2,last-1,1).getValues();
    for (var i=ids.length-1;i>=0;i--) {
      if (String(ids[i][0] || '') !== String(operationId)) continue;
      var row = history.getRange(i+2,5,1,4).getValues()[0];
      return {ok:true,found:true,operation:{accountId:String(row[0]),movement:num_(row[2]),newBalance:num_(row[3])}};
    }
    return {ok:true,found:false};
  } catch (e) { return {ok:false,error:String(e && e.message || e)}; }
}

function centralApiGetAccounts_() {
  try {
    var sheet = centralGlobalSheets_().accounts, last = sheet.getLastRow();
    if (last < 4) return {ok:true,accounts:[]};
    return {ok:true,accounts:sheet.getRange(4,1,last-3,5).getValues()
      .filter(function(r){return String(r[3] || '') && String(r[2] || '').toLowerCase() === 'cuenta';})
      .map(function(r){return {id:String(r[3]),name:String(r[0]),balance:num_(r[1])};})};
  } catch (e) { return {ok:false,error:String(e && e.message || e)}; }
}

function centralApiPost_(payload) {
  try {
    if (payload.action !== 'updateBalance') return {ok:false,error:'Solo se permite sumar a una cuenta existente.'};
    var sheets = centralGlobalSheets_();
    var account = centralGlobalAccount_(sheets.accounts,payload.id);
    if (!account) return {ok:false,error:'Cuenta no encontrada en el archivo global: ' + payload.id};
    var ctx = payload.context || {};
    if (!ctx.operationId || !isFinite(Number(payload.balance))) return {ok:false,error:'Operación o saldo inválido.'};
    var previous = centralApiGetOperation_(ctx.operationId);
    if (!previous.ok) return previous;
    if (previous.found) return {ok:true,alreadyApplied:true,balance:account.balance};
    if (Math.abs(account.balance - num_(ctx.expectedBalance)) > 0.005) {
      return {ok:false,error:'El saldo del archivo global cambió; recargá antes de aplicar el aporte.'};
    }
    var target = centralRound_(payload.balance), movement = centralRound_(target-account.balance);
    if (target < 0 || Math.abs(movement) < 0.005) return {ok:false,error:'El movimiento no cambia un saldo válido.'};
    sheets.accounts.getRange(account.row,2).setValue(target);
    sheets.history.appendRow([new Date(),ctx.operationId,'Aporte Flotilla',account.name,account.id,
      account.balance,movement,target,String(ctx.month || ''),String(ctx.week || '')]);
    SpreadsheetApp.flush();
    return {ok:true,balance:target,movement:movement};
  } catch (e) { return {ok:false,error:String(e && e.message || e)}; }
}

function centralFindAccount_(accounts, id) {
  var key = String(id || '').trim().toLowerCase();
  return (accounts || []).find(function(a){return String(a.id || '').trim().toLowerCase() === key;}) || null;
}

function centralRound_(value) {
  return Math.round(num_(value) * 100) / 100;
}

function centralRoundUp500_(value) {
  var amount = Math.max(0, centralRound_(value));
  return Math.ceil((amount - 0.000001) / 500) * 500;
}
