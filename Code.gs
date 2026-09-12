const SPREADSHEET_ID = '11SrpxYfydVP7uZdmcr2yPHl8nbtQPTKbD_JwI5_AU94';
const MAX_FAILS_BEFORE_TOKEN = 2;
const TOKEN_TTL_MIN = 10;
const SESSION_PREFIX = 'session_';

/**
 * SEGURIDAD
 * Configurar en Apps Script > Project Settings > Script properties:
 * PIN_SALT    = texto aleatorio largo
 * PIN_HASH    = SHA-256 hexadecimal de PIN_SALT + ":" + PIN
 * AUTH_EMAIL  = correo autorizado para recibir tokens
 *
 * No guardar el PIN ni el token en Sheets ni en este archivo.
 */
function doGet() {
  return json_({ok:true, service:'Base de Datos Flotilla', version:'2.1'});
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');
    let result;

    switch (action) {
      case 'login': result = login_(body); break;
      case 'requestToken': result = requestToken_(body); break;
      case 'validateSession': result = validateSession_(body); break;
      case 'bootstrap': result = protected_(body, bootstrap_); break;
      case 'markPayment': result = protected_(body, markPayment_); break;
      case 'unmarkPayment': result = protected_(body, unmarkPayment_); break;
      case 'createVehicle': result = protected_(body, createVehicle_); break;
      default: result = {ok:false, message:'Acción no válida'};
    }
    return json_(result);
  } catch (err) {
    return json_({ok:false, message:'Error del servidor', detail:String(err && err.message || err)});
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function props_() { return PropertiesService.getScriptProperties(); }
function cache_() { return CacheService.getScriptCache(); }

function hash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2)).join('');
}
function randomToken_(digits) {
  let out='';
  for(let i=0;i<digits;i++) out += Math.floor(Math.random()*10);
  return out;
}
function randomSession_() {
  return Utilities.getUuid() + Utilities.getUuid().replace(/-/g,'');
}
function safeDevice_(raw) {
  return String(raw || 'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100) || 'unknown';
}

function login_(body) {
  const p = props_();
  const device = safeDevice_(body.deviceId);
  const pin = String(body.pin || '');
  const suppliedToken = String(body.token || '');
  const salt = p.getProperty('PIN_SALT');
  const expectedHash = p.getProperty('PIN_HASH');
  const email = p.getProperty('AUTH_EMAIL');

  if (!salt || !expectedHash || !email) {
    return {ok:false, message:'La seguridad del backend todavía no está configurada.'};
  }

  const failKey = 'fails_' + device;
  const tokenModeKey = 'tokenmode_' + device;
  const fails = Number(cache_().get(failKey) || 0);
  const tokenRequired = cache_().get(tokenModeKey) === '1' || fails >= MAX_FAILS_BEFORE_TOKEN;
  const pinOk = hash_(salt + ':' + pin) === expectedHash;

  if (!pinOk) {
    const nextFails = fails + 1;
    cache_().put(failKey, String(nextFails), 21600);
    if (nextFails >= MAX_FAILS_BEFORE_TOKEN) {
      const alreadyRequired = cache_().get(tokenModeKey) === '1';
      cache_().put(tokenModeKey, '1', 21600);
      const sent = alreadyRequired ? false : issueToken_(device, email);
      log_('AUTH', device, 'PIN_FAIL_TOKEN_REQUIRED', 'Intento incorrecto #' + nextFails);
      return {ok:false, tokenRequired:true, tokenSent:sent, message:'PIN incorrecto. Ahora se requiere PIN + token.'};
    }
    log_('AUTH', device, 'PIN_FAIL', 'Intento incorrecto #' + nextFails);
    return {ok:false, tokenRequired:false, message:'PIN incorrecto.'};
  }

  if (tokenRequired) {
    const tokenHash = cache_().get('token_' + device);
    if (!suppliedToken || !tokenHash || hash_(suppliedToken) !== tokenHash) {
      log_('AUTH', device, 'TOKEN_FAIL', 'PIN correcto pero token ausente/incorrecto');
      return {ok:false, tokenRequired:true, message:'Ingresá el token temporal enviado al correo autorizado.'};
    }
    cache_().remove('token_' + device);
  }

  cache_().remove(failKey);
  cache_().remove(tokenModeKey);

  const session = randomSession_();
  props_().setProperty(
    SESSION_PREFIX + hash_(session),
    JSON.stringify({device:device, createdAt:Date.now(), lastSeen:Date.now()})
  );
  log_('AUTH', device, 'LOGIN_OK', 'Sesión iniciada');
  return {ok:true, sessionToken:session};
}

function requestToken_(body) {
  const device = safeDevice_(body.deviceId);
  const email = props_().getProperty('AUTH_EMAIL');
  if (!email) return {ok:false, message:'Correo autorizado no configurado.'};

  const failKey = 'fails_' + device;
  const tokenModeKey = 'tokenmode_' + device;
  const tokenRequired = cache_().get(tokenModeKey) === '1' ||
    Number(cache_().get(failKey) || 0) >= MAX_FAILS_BEFORE_TOKEN;

  if (!tokenRequired) {
    return {ok:false, message:'El token solo se habilita después de 2 intentos de PIN incorrectos.'};
  }

  const cooldownKey = 'token_cooldown_' + device;
  if (cache_().get(cooldownKey)) {
    return {ok:false, message:'Esperá un minuto antes de solicitar otro token.'};
  }

  cache_().put(tokenModeKey, '1', 21600);
  cache_().put(cooldownKey, '1', 60);
  const sent = issueToken_(device, email);
  return {ok:sent, message:sent ? 'Token enviado.' : 'No se pudo enviar el token.'};
}

function issueToken_(device, email) {
  try {
    const token = randomToken_(6);
    cache_().put('token_' + device, hash_(token), TOKEN_TTL_MIN * 60);
    MailApp.sendEmail({
      to: email,
      subject: 'Token de acceso · Base de Datos Flotilla',
      htmlBody:
        '<div style="font-family:Arial,sans-serif">' +
        '<h2>Token de seguridad</h2>' +
        '<div style="font-size:32px;font-weight:800;letter-spacing:6px">' + token + '</div>' +
        '<p>Válido por ' + TOKEN_TTL_MIN + ' minutos y para un solo uso.</p>' +
        '<p>Si no intentaste ingresar, podés ignorar este mensaje.</p></div>'
    });
    return true;
  } catch (e) {
    log_('AUTH', device, 'TOKEN_SEND_ERROR', String(e));
    return false;
  }
}

function validateSession_(body) {
  const session = String(body.sessionToken || '');
  const device = safeDevice_(body.deviceId);
  if (!session) return {ok:false};

  const key = SESSION_PREFIX + hash_(session);
  const raw = props_().getProperty(key);
  if (!raw) return {ok:false};

  try {
    const data = JSON.parse(raw);
    if (data.device !== device) return {ok:false};
    data.lastSeen = Date.now();
    props_().setProperty(key, JSON.stringify(data));
    return {ok:true};
  } catch (e) {
    props_().deleteProperty(key);
    return {ok:false};
  }
}

function protected_(body, handler) {
  const session = String(body.sessionToken || '');
  const device = safeDevice_(body.deviceId);
  if (!session) return {ok:false, authRequired:true, message:'Sesión no válida.'};

  const key = SESSION_PREFIX + hash_(session);
  const raw = props_().getProperty(key);
  if (!raw) return {ok:false, authRequired:true, message:'Sesión no válida.'};

  try {
    const data = JSON.parse(raw);
    if (data.device !== device) {
      return {ok:false, authRequired:true, message:'La sesión pertenece a otro dispositivo.'};
    }
    data.lastSeen = Date.now();
    props_().setProperty(key, JSON.stringify(data));
  } catch (e) {
    props_().deleteProperty(key);
    return {ok:false, authRequired:true, message:'Sesión no válida.'};
  }

  return handler(body, device);
}

function bootstrap_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return {
    ok:true,
    vehicles: sheetObjects_(ss.getSheetByName('Vehiculos')),
    accounts: sheetObjects_(ss.getSheetByName('Cuentas')),
    payments: sheetObjects_(ss.getSheetByName('Pagos_Reales')),
    plans: sheetObjects_(ss.getSheetByName('Plan_Pagos'))
  };
}

function markPayment_(body, device) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Pagos_Reales');
  const now = new Date();
  const pagoId = body.pagoId || Utilities.getUuid();
  sh.appendRow([
    pagoId,
    body.planId || '',
    body.vehicleId || '',
    body.fechaProgramada || '',
    body.fechaReal || Utilities.formatDate(now, 'America/Costa_Rica', 'yyyy-MM-dd'),
    Number(body.montoEsperado || 0),
    Number(body.montoRecibido || 0),
    body.estado || 'PAGADO',
    body.nota || '',
    now,
    now
  ]);
  log_('PAGO', pagoId, 'MARK_PAID', JSON.stringify({vehicleId:body.vehicleId, amount:body.montoRecibido}), device);
  return {ok:true, pagoId:pagoId};
}

function unmarkPayment_(body, device) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Pagos_Reales');
  const data = sh.getDataRange().getValues();
  const pagoId = String(body.pagoId || '');
  for (let r=data.length-1; r>=1; r--) {
    if (String(data[r][0]) === pagoId) {
      sh.deleteRow(r+1);
      log_('PAGO', pagoId, 'UNMARK_PAID', 'Pago eliminado', device);
      return {ok:true};
    }
  }
  return {ok:false, message:'Pago no encontrado.'};
}

function createVehicle_(body, device) {
  const payload = body.payload || {};
  const v = payload.vehicle || {};
  const c = payload.contract || {};
  const projection = payload.projection || {};
  const plan = Array.isArray(payload.plan) ? payload.plan : [];

  if (!v.placa || !v.marca || !v.modelo || !c.cuota || !c.fechaFirma || !plan.length) {
    return {ok:false, message:'Faltan datos requeridos del vehículo o del plan.'};
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const vehicles = ss.getSheetByName('Vehiculos');
  const plans = ss.getSheetByName('Plan_Pagos');
  const now = new Date();

  const normalizedPlate = String(v.placa).trim().toUpperCase();
  const existing = vehicles.getDataRange().getValues();
  for (let r = 1; r < existing.length; r++) {
    if (String(existing[r][2]).trim().toUpperCase() === normalizedPlate) {
      return {ok:false, message:'Ya existe un vehículo con esa placa.'};
    }
  }

  const vehicleId = 'veh_' + normalizedPlate.replace(/[^A-Z0-9]/g,'_') + '_' + Date.now();
  const firstDate = plan[0].fecha || '';
  const lastDate = plan[plan.length - 1].fecha || '';
  const displayName = String(v.marca) + ' ' + String(v.modelo);

  vehicles.appendRow([
    vehicleId,
    displayName,
    normalizedPlate,
    v.marca || '',
    v.modelo || '',
    Number(v.anio || 0),
    Number(c.cuota || 0),
    firstDate,
    lastDate,
    0,
    Number(projection.semanas || plan.length),
    'ACTIVO',
    'SEMANAL',
    'Creado desde la aplicación',
    now,
    now
  ]);

  const rows = plan.map((p, idx) => ([
    vehicleId + '-' + String(idx + 1).padStart(4,'0'),
    vehicleId,
    Number(p.semana || idx + 1),
    p.fecha || '',
    Number(p.saldoInicial || 0),
    Number(p.cuotaTotal || 0),
    Number(p.seguro || 0),
    Number(p.iva || 0),
    Number(p.cuotaUtil || 0),
    Number(p.interes || 0),
    Number(p.capital || 0),
    Number(p.saldoFinal || 0),
    0,
    0,
    p.estado || 'Pendiente'
  ]));

  if (rows.length) {
    plans.getRange(plans.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  log_('VEHICULO', vehicleId, 'CREATE', JSON.stringify({
    placa: normalizedPlate,
    marca: v.marca,
    modelo: v.modelo,
    semanas: rows.length
  }), device);

  return {ok:true, vehicleId:vehicleId, planRows:rows.length};
}

function sheetObjects_(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(v => v !== '')).map(row => {
    const o={}; headers.forEach((h,i)=>o[h]=row[i]); return o;
  });
}

function log_(entity, entityId, action, detail, user) {
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Historial');
    sh.appendRow([Utilities.getUuid(), new Date(), entity, entityId, action, detail, user || 'system', 'AppsScript']);
  } catch(e) {}
}

/**
 * Utilidad para generar el hash sin revelar el PIN:
 * 1) En Apps Script, abrí el editor.
 * 2) Ejecutá temporalmente:
 *    Logger.log(makePinHash_('TU_SALT_LARGO','TU_PIN'));
 * 3) Copiá el resultado a Script Property PIN_HASH.
 * 4) Nunca guardés el PIN en el código.
 */
function makePinHash_(salt, pin) {
  return hash_(String(salt) + ':' + String(pin));
}
