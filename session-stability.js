'use strict';

/* V3.3.3 · Sesión estable + una sola lectura bootstrap + estados de gasto claros */
(() => {
  const backendBeforeV332 = backend;
  let bootstrapCacheV332 = null;
  let bootstrapCacheAtV332 = 0;
  let bootstrapSessionV332 = '';
  const BOOTSTRAP_CACHE_MS_V332 = 5000;

  // app.js y app-v3.js solicitan bootstrap uno detrás del otro. Reutilizamos la
  // primera respuesta para que una entrada/F5 no golpee dos veces Apps Script.
  backend = async function(action, payload = {}) {
    if (action === 'bootstrap') {
      const sessionToken = String(payload.sessionToken || sessionStorage.getItem(SESSION_KEY) || '');
      const now = Date.now();
      if (
        bootstrapCacheV332 &&
        bootstrapCacheV332.ok &&
        bootstrapSessionV332 === sessionToken &&
        now - bootstrapCacheAtV332 < BOOTSTRAP_CACHE_MS_V332
      ) {
        return bootstrapCacheV332;
      }

      const response = await backendBeforeV332(action, payload);
      if (response && response.ok) {
        bootstrapCacheV332 = response;
        bootstrapCacheAtV332 = Date.now();
        bootstrapSessionV332 = sessionToken;
      }
      return response;
    }
    return backendBeforeV332(action, payload);
  };
  window.backend = backend;

  function sleepV332(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function loadAfterLoginV332() {
    const delays = [0, 450, 1100];
    let lastError = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await sleepV332(delays[i]);
      try {
        await loadProductionData();
        unlockApp();
        return true;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('No se pudieron cargar los datos.');
  }

  // Diferencia autenticación de carga de datos. Si el PIN fue correcto y una
  // lectura posterior falla, la sesión se conserva para F5/reintento.
  submitLogin = async function() {
    const pin = $('loginPin').value.trim();
    const token = $('loginToken').value.trim();
    if (!pin) {
      authMsg('Ingresá el PIN.');
      return;
    }

    $('loginButton').disabled = true;
    authMsg('Validando…', true);
    if (typeof showGlobalLoaderV33 === 'function') showGlobalLoaderV33('Validando acceso…');

    let loginCompleted = false;
    try {
      const r = await backend('login', { pin, token });
      if (!(r && r.ok && r.sessionToken)) {
        if (r && r.tokenRequired) {
          setTokenRequired(true, r.message || 'Se requiere PIN + token.');
          if (r.tokenSent) authMsg('PIN incorrecto dos veces. Te envié un token al correo autorizado.');
        } else {
          authMsg((r && r.message) || 'PIN incorrecto.');
        }
        return;
      }

      loginCompleted = true;
      sessionStorage.setItem(SESSION_KEY, r.sessionToken);
      $('loginPin').value = '';
      $('loginToken').value = '';
      authMsg('PIN correcto. Cargando datos…', true);
      if (typeof updateGlobalLoaderV33 === 'function') updateGlobalLoaderV33('PIN correcto. Cargando datos…');

      try {
        await loadAfterLoginV332();
      } catch (loadError) {
        // No borrar SESSION_KEY: el acceso ya fue validado.
        authMsg('PIN correcto. La sesión quedó abierta, pero los datos tardaron demasiado en cargar. Recargá la página para reintentar; no necesitás ingresar el PIN otra vez.', false);
      }
    } catch (err) {
      if (loginCompleted || sessionStorage.getItem(SESSION_KEY)) {
        authMsg('La sesión quedó abierta, pero hubo un problema temporal cargando los datos. Recargá la página para reintentar.', false);
      } else {
        const detail = err && err.message ? ` (${err.message})` : '';
        authMsg('No se pudo contactar el backend para validar el PIN' + detail + '.');
      }
    } finally {
      $('loginButton').disabled = false;
      if (typeof hideGlobalLoaderV33 === 'function') hideGlobalLoaderV33(true);
    }
  };

  // Un gasto con necesidad ₡0 no está "pagado": simplemente no corresponde
  // esa semana. Esto es especialmente importante para Cuentas casa en el 5.º martes.
  const renderExpenseAllocationBeforeV333 = renderExpenseAllocation;
  renderExpenseAllocation = function(expenses, available) {
    renderExpenseAllocationBeforeV333(expenses, available);
    const renderedRows = Array.from(document.querySelectorAll('#expenseBody tr'));
    expenses.forEach((expense, index) => {
      if (!expense || expense.type === 'remainder' || Number(expense.need || 0) > 0.01) return;
      const row = renderedRows[index];
      if (!row) return;
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) return;
      cells[5].textContent = '⚪ No corresponde esta semana';
    });
  };

  // Vuelve a enlazar los controles con la versión estable. Este script carga
  // antes de DOMContentLoaded, por lo que init() tomará esta función.
  window.submitLogin = submitLogin;
})();
