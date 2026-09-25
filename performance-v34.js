'use strict';

/* V3.4 · Carga progresiva
   - Un solo bootstrap por actualización.
   - F5 pinta el último snapshot de la pestaña de inmediato.
   - La actualización fresca ocurre en segundo plano.
   - Uber / Plan de pagos se consulta solamente al abrir esa pestaña.
   - Un timeout ya no dispara tres esperas consecutivas.
*/
(() => {
  const backendNetworkV34 = backend;
  const SNAPSHOT_KEY_V34 = 'flotilla_bootstrap_snapshot_v34';
  let bootstrapOverrideV34 = null;
  let backgroundRefreshRunningV34 = false;

  function parseSnapshotV34() {
    try {
      const raw = sessionStorage.getItem(SNAPSHOT_KEY_V34);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.data && parsed.data.ok ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveSnapshotV34(data) {
    if (!data || !data.ok) return;
    try {
      sessionStorage.setItem(SNAPSHOT_KEY_V34, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {}
  }

  function clearSnapshotV34() {
    try { sessionStorage.removeItem(SNAPSHOT_KEY_V34); } catch (_) {}
  }

  // loadProductionDataV22 (capturado por app-v3.js) llama bootstrap internamente.
  // Le entregamos exactamente la respuesta que ya obtuvimos para evitar otra ida al backend.
  backend = async function(action, payload = {}) {
    if (action === 'bootstrap' && bootstrapOverrideV34) return bootstrapOverrideV34;
    return backendNetworkV34(action, payload);
  };
  window.backend = backend;

  function applyV3BootstrapV34(r) {
    const rawVehicles = Array.isArray(r.vehicles) ? r.vehicles : [];
    contractVehicles.forEach(v => {
      const raw = rawVehicles.find(x => String(x.VehicleID || '') === v.id) || {};
      v.driver = String(raw.Chofer || '');
      v.paymentType = String(raw.TipoCobro || '').toUpperCase();
      v.planSheetTab = String(raw.PlanSheetTab || '');
      v.operationStatus = String(raw.OperacionEstado || 'ACTIVO').toUpperCase();
      v.planIntegrationActive = raw.PlanIntegracionActiva === true || String(raw.PlanIntegracionActiva).toUpperCase() === 'TRUE';
      v.configNote = String(raw.ConfigNota || '');
    });

    // Varios movimientos pueden pertenecer a una misma cuota.
    Object.keys(paymentState).forEach(k => delete paymentState[k]);
    (Array.isArray(r.payments) ? r.payments : []).forEach(p => {
      const date = normalizeSheetDate(p.FechaProgramada);
      const vehicleId = String(p.VehicleID || '');
      if (!date || !vehicleId) return;
      const key = paymentKey(vehicleId, date);
      const current = paymentState[key] || {
        received: 0, realDate: '', status: 'Pendiente', pagoId: '', paymentIds: [], movements: [], expected: Number(p.MontoEsperado || 0)
      };
      const amount = Number(p.MontoRecibido || 0);
      current.received += amount;
      current.expected = Number(p.MontoEsperado || current.expected || 0);
      current.realDate = normalizeSheetDate(p.FechaReal) || current.realDate;
      current.pagoId = String(p.PagoID || current.pagoId || '');
      current.paymentIds.push(String(p.PagoID || ''));
      current.movements.push({
        pagoId: String(p.PagoID || ''), amount,
        date: normalizeSheetDate(p.FechaReal),
        status: String(p.Estado || ''), note: String(p.Nota || ''),
        origin: String(p.Origen || 'MANUAL'), uberSemanaId: String(p.UberSemanaID || '')
      });
      current.status = current.expected && current.received >= current.expected - .01 ? 'PAGADO' : current.received > 0 ? 'PARCIAL' : 'PENDIENTE';
      paymentState[key] = current;
    });

    uberWeeksV3 = Array.isArray(r.uberWeeks) ? r.uberWeeks.map(x => ({
      id: String(x.UberSemanaID || ''), vehicleId: String(x.VehicleID || ''), tab: String(x.PlanSheetTab || ''),
      week: Number(x.Semana || 0), date: normalizeSheetDate(x.FechaProgramada), gains: Number(x.GananciasTotales || 0),
      returns: Number(x.DevolucionesGastos || 0), adjustments: Number(x.AjustesAnteriores || 0), carryIn: Number(x.SaldoArrastradoEntrada || 0),
      reimbursements: Number(x.ReembolsosTotal || 0), cash: Number(x.EfectivoChofer || 0), quota: Number(x.Cuota || 0),
      balance: Number(x.SaldoSemana || 0), rawAvailable: Number(x.MontoDisponibleBruto || 0), status: String(x.Estado || '')
    })) : [];

    // El archivo externo Plan de pagos es pesado. Solo se carga cuando el usuario abre Uber.
    planDashboardLoadedV3 = false;
  }

  async function applyBootstrapV34(r) {
    if (!r || !r.ok) {
      const err = new Error((r && r.message) || 'No se pudieron cargar los datos.');
      err.authRequired = !!(r && r.authRequired);
      throw err;
    }

    bootstrapOverrideV34 = r;
    try {
      // Procesa Vehiculos, Cuentas, Plan_Pagos y la estructura base con el parser estable de app.js.
      await loadProductionDataV22();
    } finally {
      bootstrapOverrideV34 = null;
    }
    applyV3BootstrapV34(r);
  }

  // Sustituye la cadena anterior app.js -> app-v3.js -> getPlanDashboard.
  // Ahora hay una sola consulta core y nada externo bloquea la pantalla principal.
  loadProductionData = async function(options = {}) {
    const sessionToken = sessionStorage.getItem(SESSION_KEY);
    if (!sessionToken) throw new Error('Sesión no disponible');

    let r = options.snapshot || null;
    if (!r) {
      r = await backendNetworkV34('bootstrap', { sessionToken });
      if (r && r.ok) saveSnapshotV34(r);
    }
    await applyBootstrapV34(r);
    return r;
  };
  window.loadProductionData = loadProductionData;

  function ensureFreshnessBadgeV34() {
    let badge = document.getElementById('freshnessBadgeV34');
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'freshnessBadgeV34';
    badge.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:12000;padding:8px 11px;border-radius:999px;font:700 11px Segoe UI,Arial,sans-serif;background:#171717;color:#d7b928;border:1px solid #514315;box-shadow:0 8px 24px rgba(0,0,0,.25);display:none';
    document.body.appendChild(badge);
    return badge;
  }

  function freshnessV34(text, mode) {
    const badge = ensureFreshnessBadgeV34();
    badge.textContent = text;
    badge.style.display = 'block';
    badge.style.color = mode === 'error' ? '#ffb4ab' : mode === 'ok' ? '#9ce5b6' : '#d7b928';
    clearTimeout(freshnessV34.timer);
    if (mode === 'ok') freshnessV34.timer = setTimeout(() => { badge.style.display = 'none'; }, 1800);
  }

  async function refreshCoreInBackgroundV34() {
    if (backgroundRefreshRunningV34) return;
    const sessionToken = sessionStorage.getItem(SESSION_KEY);
    if (!sessionToken) return;
    backgroundRefreshRunningV34 = true;
    freshnessV34('Actualizando datos…');
    try {
      const r = await backendNetworkV34('bootstrap', { sessionToken });
      if (!r || !r.ok) {
        if (r && r.authRequired) {
          clearSnapshotV34();
          sessionStorage.removeItem(SESSION_KEY);
          lockApp();
          authMsg('La sesión terminó. Ingresá el PIN nuevamente.');
          return;
        }
        throw new Error((r && r.message) || 'No se pudo actualizar');
      }
      saveSnapshotV34(r);
      await applyBootstrapV34(r);
      renderAll();
      freshnessV34('Datos actualizados ✓', 'ok');
    } catch (_) {
      freshnessV34('Mostrando último dato guardado · actualización pendiente', 'error');
    } finally {
      backgroundRefreshRunningV34 = false;
    }
  }

  // En F5, si esta misma pestaña ya estaba autenticada, pinta el snapshot primero.
  // La red deja de bloquear la experiencia.
  validateExistingSession = async function() {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) return false;

    const snapshot = parseSnapshotV34();
    if (snapshot) {
      try {
        await loadProductionData({ snapshot: snapshot.data });
        unlockApp();
        const ageSec = Math.max(0, Math.round((Date.now() - Number(snapshot.savedAt || Date.now())) / 1000));
        freshnessV34(ageSec < 5 ? 'Datos listos · actualizando…' : `Datos cargados · hace ${ageSec}s`);
        setTimeout(refreshCoreInBackgroundV34, 40);
        return true;
      } catch (_) {
        clearSnapshotV34();
      }
    }

    if (typeof showGlobalLoaderV33 === 'function') showGlobalLoaderV33('Cargando datos…');
    try {
      // bootstrap es también una validación protegida de sesión; evitamos validateSession + bootstrap.
      const r = await loadProductionData();
      unlockApp();
      freshnessV34('Datos actualizados ✓', 'ok');
      return !!r;
    } catch (err) {
      if (err && err.authRequired) {
        clearSnapshotV34();
        sessionStorage.removeItem(SESSION_KEY);
        return false;
      }
      authMsg('La sesión se conserva, pero el backend no respondió. Refrescá para reintentar.', false);
      return false;
    } finally {
      if (typeof hideGlobalLoaderV33 === 'function') hideGlobalLoaderV33(true);
    }
  };

  submitLogin = async function() {
    const pin = $('loginPin').value.trim();
    const token = $('loginToken').value.trim();
    if (!pin) return authMsg('Ingresá el PIN.');

    $('loginButton').disabled = true;
    authMsg('Validando…', true);
    if (typeof showGlobalLoaderV33 === 'function') showGlobalLoaderV33('Validando acceso…');
    let authenticated = false;
    try {
      const r = await backendNetworkV34('login', { pin, token });
      if (!(r && r.ok && r.sessionToken)) {
        if (r && r.tokenRequired) {
          setTokenRequired(true, r.message || 'Se requiere PIN + token.');
          if (r.tokenSent) authMsg('PIN incorrecto dos veces. Te envié un token al correo autorizado.');
        } else authMsg((r && r.message) || 'PIN incorrecto.');
        return;
      }

      authenticated = true;
      sessionStorage.setItem(SESSION_KEY, r.sessionToken);
      clearSnapshotV34();
      $('loginPin').value = '';
      $('loginToken').value = '';
      authMsg('PIN correcto. Cargando datos…', true);
      if (typeof updateGlobalLoaderV33 === 'function') updateGlobalLoaderV33('PIN correcto. Cargando datos…');

      // Una sola oportunidad bloqueante. Si la red falla, no esperamos otro minuto.
      await loadProductionData();
      unlockApp();
      freshnessV34('Datos actualizados ✓', 'ok');
    } catch (err) {
      if (authenticated || sessionStorage.getItem(SESSION_KEY)) {
        authMsg('PIN correcto y sesión abierta. El backend tardó demasiado; refrescá para reintentar sin volver a ingresar el PIN.', false);
      } else {
        authMsg('No se pudo contactar el backend para validar el PIN.', false);
      }
    } finally {
      $('loginButton').disabled = false;
      if (typeof hideGlobalLoaderV33 === 'function') hideGlobalLoaderV33(true);
    }
  };

  window.validateExistingSession = validateExistingSession;
  window.submitLogin = submitLogin;
  window.refreshCoreInBackgroundV34 = refreshCoreInBackgroundV34;
})();
