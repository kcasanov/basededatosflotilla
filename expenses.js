'use strict';

/*
 * Base de Datos Flotilla · LOCAL DEV · Gastos V3.5
 *
 * - Estados correctos por CuentaID, no por posición visual.
 * - Drag & drop de orden dentro de cada prioridad.
 * - Campos bloqueados por defecto.
 * - Edición únicamente mediante ✏️.
 * - Un solo "Guardar cambios".
 * - Solo se envían cuentas realmente modificadas.
 * - Cambiar a Automático/Remanente NO borra el monto guardado.
 */

(() => {
  const originals = new Map();
  const drafts = new Map();
  const editing = new Set();

  let draggedId = null;

  function rawTypeLocal(type) {
    if (type === 'automatic') return 'AUTOMATICO_PLAN';
    if (type === 'remainder') return 'REMANENTE';
    return 'SEMANAL';
  }

  function uiTypeLocal(raw) {
    const s = String(raw || '').toUpperCase();
    if (s === 'AUTOMATICO_PLAN') return 'automatic';
    if (s === 'REMANENTE') return 'remainder';
    return 'weekly';
  }

  function rawPriorityLocal(priority) {
    if (priority === 'critical') return 'CRITICA';
    if (priority === 'medium') return 'MEDIA';
    return 'BAJA';
  }

  function priorityTextLocal(priority) {
    if (priority === 'critical') return 'Crítica';
    if (priority === 'medium') return 'Media';
    return 'Baja';
  }

  function priorityRankLocal(priority) {
    return priority === 'critical' ? 0 :
      priority === 'medium' ? 1 : 2;
  }

  function accountSnapshotLocal(e) {
    return {
      id: String(e.id || ''),
      name: String(e.name || ''),
      type: String(e.type || 'weekly'),
      amount: Number(e.amount || 0),
      priority: String(e.priority || 'low'),
      order: Number(e.order || 99),
      from: e.from || '',
      to: e.to || ''
    };
  }

  function copyLocal(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function sameLocal(a, b) {
    if (!a || !b) return false;

    return (
      String(a.name) === String(b.name) &&
      String(a.type) === String(b.type) &&
      Number(a.amount) === Number(b.amount) &&
      String(a.priority) === String(b.priority) &&
      Number(a.order) === Number(b.order) &&
      String(a.from || '') === String(b.from || '') &&
      String(a.to || '') === String(b.to || '')
    );
  }

  function syncDraftsLocal() {
    const activeIds = new Set();

    expenseConfig.forEach(e => {
      const id = String(e.id || '');
      if (!id) return;

      activeIds.add(id);

      const snap = accountSnapshotLocal(e);

      // Si la fila NO tiene cambios locales pendientes,
      // actualizamos su versión base.
      if (!drafts.has(id) || !isDirtyLocal(id)) {
        originals.set(id, copyLocal(snap));
        drafts.set(id, copyLocal(snap));
      }
    });

    [...drafts.keys()].forEach(id => {
      if (!activeIds.has(id)) {
        drafts.delete(id);
        originals.delete(id);
        editing.delete(id);
      }
    });
  }

  function isDirtyLocal(id) {
    return !sameLocal(
      originals.get(id),
      drafts.get(id)
    );
  }

  function dirtyIdsLocal() {
    return [...drafts.keys()].filter(isDirtyLocal);
  }

  function orderedDraftsLocal() {
    return [...drafts.values()].sort((a, b) =>
      priorityRankLocal(a.priority) - priorityRankLocal(b.priority) ||
      Number(a.order || 99) - Number(b.order || 99) ||
      String(a.name).localeCompare(String(b.name))
    );
  }

  function renumberPriorityLocal(priority) {
    const rows = [...drafts.values()]
      .filter(x => x.priority === priority)
      .sort((a, b) =>
        Number(a.order || 99) - Number(b.order || 99) ||
        String(a.name).localeCompare(String(b.name))
      );

    rows.forEach((row, index) => {
      row.order = index + 1;
    });
  }

  function updateToolbarLocal() {
    const btn = $('addExpense');
    if (!btn) return;

    const count = dirtyIdsLocal().length;

    btn.textContent = count
      ? `💾 Guardar cambios (${count})`
      : '💾 Guardar cambios';

    btn.disabled = count === 0;
    btn.style.opacity = count ? '1' : '.5';

    let discard = $('discardExpenseChangesLocal');

    if (!discard) {
      discard = document.createElement('button');
      discard.id = 'discardExpenseChangesLocal';
      discard.type = 'button';
      discard.className = 'light';
      discard.textContent = 'Descartar cambios';

      btn.parentElement.appendChild(discard);

      discard.onclick = () => {
        if (!dirtyIdsLocal().length) return;

        if (!confirm('¿Descartar todos los cambios sin guardar?')) return;

        drafts.clear();
        originals.clear();
        editing.clear();

        syncDraftsLocal();
        renderExpenseConfig();
      };
    }

    discard.disabled = count === 0;
    discard.style.opacity = count ? '1' : '.5';
  }

  function valueCellLocal(draft, key) {
    const value = draft[key];

    if (key === 'type') {
      return value === 'automatic'
        ? 'Automático plan'
        : value === 'remainder'
          ? 'Remanente'
          : 'Semanal';
    }

    if (key === 'priority') {
      return priorityTextLocal(value);
    }

    if (key === 'amount') {
      return draft.type === 'weekly'
        ? money(value)
        : (
          draft.type === 'automatic'
            ? 'Según pagos programados'
            : 'Todo el remanente'
        );
    }

    return value || '—';
  }

  function editFieldsLocal(d) {
    const amountDisabled = d.type !== 'weekly';

    return {
      name:
        `<input data-local-field="name"
          value="${escapeAttrV3(d.name)}">`,

      type:
        `<select data-local-field="type">
          <option value="weekly" ${d.type === 'weekly' ? 'selected' : ''}>
            Semanal
          </option>
          <option value="automatic" ${d.type === 'automatic' ? 'selected' : ''}>
            Automático plan
          </option>
          <option value="remainder" ${d.type === 'remainder' ? 'selected' : ''}>
            Remanente
          </option>
        </select>`,

      amount:
        `<input
          data-local-field="amount"
          type="number"
          min="0"
          step="500"
          value="${Number(d.amount || 0)}"
          ${amountDisabled ? 'disabled' : ''}
        >
        <div class="miniNote">
          ${
            d.type === 'automatic'
              ? `Monto guardado: ${money(d.amount)} · no se utiliza mientras sea automático`
              : d.type === 'remainder'
                ? `Monto guardado: ${money(d.amount)} · no se utiliza mientras sea remanente`
                : `${money(d.amount)} semanal`
          }
        </div>`,

      priority:
        `<select data-local-field="priority">
          <option value="critical" ${d.priority === 'critical' ? 'selected' : ''}>
            Crítica
          </option>
          <option value="medium" ${d.priority === 'medium' ? 'selected' : ''}>
            Media
          </option>
          <option value="low" ${d.priority === 'low' ? 'selected' : ''}>
            Baja
          </option>
        </select>`,

      validity:
        `<div class="expenseDatesLocal">
          <input data-local-field="from" type="date"
            value="${escapeAttrV3(d.from || '')}">
          <span>→</span>
          <input data-local-field="to" type="date"
            value="${escapeAttrV3(d.to || '')}">
        </div>`
    };
  }

  renderExpenseConfig = function() {
    const body = $('expenseConfigBody');
    if (!body) return;

    syncDraftsLocal();

    const rows = orderedDraftsLocal();

    let lastPriority = null;

    body.innerHTML = rows.map(d => {
      const edit = editing.has(d.id);
      const dirty = isDirtyLocal(d.id);
      const fields = edit ? editFieldsLocal(d) : null;

      let separator = '';

      if (lastPriority !== d.priority) {
        lastPriority = d.priority;

        separator = `
          <tr class="expensePriorityGroupLocal">
            <td colspan="6">
              ${priorityTextLocal(d.priority)}
            </td>
          </tr>
        `;
      }

      return separator + `
        <tr
          data-expense-local-id="${escapeAttrV3(d.id)}"
          data-expense-local-priority="${escapeAttrV3(d.priority)}"
          class="${dirty ? 'expenseDirtyLocal' : ''}"
        >

          <td class="expenseOrderLocal">
            ${
              edit
                ? `<span class="dragDisabledLocal">☰</span>`
                : `<span
                    class="expenseDragHandleLocal"
                    draggable="true"
                    data-drag-local="${escapeAttrV3(d.id)}"
                    title="Arrastrar para cambiar orden"
                  >☰</span>`
            }

            <b>${Number(d.order || 0)}</b>
          </td>

          <td>
            ${edit ? fields.name : escapeHtmlV3(d.name)}
            ${dirty ? '<span class="dirtyBadgeLocal">● Sin guardar</span>' : ''}
          </td>

          <td>
            ${edit ? fields.type : valueCellLocal(d, 'type')}
          </td>

          <td>
            ${edit ? fields.amount : valueCellLocal(d, 'amount')}
          </td>

          <td>
            ${edit
              ? fields.priority
              : `<span class="priority ${priorityClass(d.priority)}">
                   ${priorityTextLocal(d.priority)}
                 </span>`
            }
          </td>

          <td>
            <div class="expenseActionCellLocal">

              <div class="expenseValidityLocal">
                ${
                  edit
                    ? fields.validity
                    : `${d.from || '—'} → ${d.to || 'en adelante'}`
                }
              </div>

              ${
                edit
                  ? `<button
                       type="button"
                       class="dark miniBtn"
                       onclick="finishExpenseEditLocal('${escapeAttrV3(d.id)}')"
                     >✓ Listo</button>`
                  : `<button
                       type="button"
                       class="light miniBtn"
                       onclick="editExpenseLocal('${escapeAttrV3(d.id)}')"
                     >✏️ Editar</button>`
              }

            </div>
          </td>
        </tr>
      `;
    }).join('');

    bindExpenseEditorsLocal();
    bindExpenseDragLocal();
    updateToolbarLocal();
  };

  function bindExpenseEditorsLocal() {
    document
      .querySelectorAll('[data-expense-local-id]')
      .forEach(row => {
        const id = row.dataset.expenseLocalId;
        const draft = drafts.get(id);

        if (!draft || !editing.has(id)) return;

        row.querySelectorAll('[data-local-field]').forEach(input => {
          input.addEventListener('change', () => {
            const field = input.dataset.localField;

            if (field === 'priority') {
              const oldPriority = draft.priority;
              const newPriority = input.value;

              if (oldPriority !== newPriority) {
                draft.priority = newPriority;

                renumberPriorityLocal(oldPriority);

                const newRows = [...drafts.values()]
                  .filter(x => x.priority === newPriority);

                draft.order =
                  Math.max(
                    0,
                    ...newRows
                      .filter(x => x.id !== draft.id)
                      .map(x => Number(x.order || 0))
                  ) + 1;

                renumberPriorityLocal(newPriority);
                renderExpenseConfig();
              }

              return;
            }

            if (field === 'amount') {
              draft.amount = Number(input.value || 0);
            } else {
              draft[field] = input.value;
            }

            if (field === 'type') {
              // MUY IMPORTANTE:
              // no tocamos draft.amount.
              // Si cambia a Automático/Remanente, el monto queda conservado.
              renderExpenseConfig();
              return;
            }

            updateToolbarLocal();

            const dirty = isDirtyLocal(id);
            row.classList.toggle('expenseDirtyLocal', dirty);
          });
        });
      });
  }

  function bindExpenseDragLocal() {
    document
      .querySelectorAll('[data-drag-local]')
      .forEach(handle => {
        handle.addEventListener('dragstart', e => {
          draggedId = handle.dataset.dragLocal;

          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedId);
          }
        });

        handle.addEventListener('dragend', () => {
          draggedId = null;

          document
            .querySelectorAll('.dragOverLocal')
            .forEach(x => x.classList.remove('dragOverLocal'));
        });
      });

    document
      .querySelectorAll('[data-expense-local-id]')
      .forEach(row => {

        row.addEventListener('dragover', e => {
          if (!draggedId) return;

          const source = drafts.get(draggedId);
          const target = drafts.get(row.dataset.expenseLocalId);

          if (!source || !target) return;

          // Para cambiar prioridad hay que usar ✏️.
          if (source.priority !== target.priority) return;

          e.preventDefault();
          row.classList.add('dragOverLocal');
        });

        row.addEventListener('dragleave', () => {
          row.classList.remove('dragOverLocal');
        });

        row.addEventListener('drop', e => {
          e.preventDefault();

          row.classList.remove('dragOverLocal');

          const targetId = row.dataset.expenseLocalId;

          if (!draggedId || draggedId === targetId) return;

          const source = drafts.get(draggedId);
          const target = drafts.get(targetId);

          if (!source || !target) return;

          if (source.priority !== target.priority) {
            alert(
              'Para cambiar una cuenta de prioridad, usá ✏️ Editar. ' +
              'Arrastrar solamente cambia el orden dentro de la misma prioridad.'
            );
            return;
          }

          const group = [...drafts.values()]
            .filter(x => x.priority === source.priority)
            .sort((a, b) =>
              Number(a.order || 99) - Number(b.order || 99)
            );

          const from = group.findIndex(x => x.id === draggedId);
          const to = group.findIndex(x => x.id === targetId);

          if (from < 0 || to < 0) return;

          const [moving] = group.splice(from, 1);
          group.splice(to, 0, moving);

          group.forEach((item, index) => {
            item.order = index + 1;
          });

          draggedId = null;

          renderExpenseConfig();
        });
      });
  }

  window.editExpenseLocal = function(id) {
    if (!drafts.has(id)) return;

    editing.add(id);
    renderExpenseConfig();

    setTimeout(() => {
      const row = document.querySelector(
        `[data-expense-local-id="${CSS.escape(id)}"]`
      );

      const input = row && row.querySelector('[data-local-field="name"]');

      if (input) input.focus();
    }, 30);
  };

  window.finishExpenseEditLocal = function(id) {
    editing.delete(id);
    renderExpenseConfig();
  };

async function saveAllExpensesLocal() {
  const ids = dirtyIdsLocal();

  if (!ids.length) return;

  const btn = $('addExpense');

  if (btn) {
    btn.disabled = true;
    btn.textContent = `Guardando 0/${ids.length}…`;
  }

  let completed = 0;
  const failed = [];

  async function saveOne(id, attempt = 1) {
    const d = drafts.get(id);

    if (!d) return true;

    try {
      const response = await backend('updateAccount', {
        sessionToken: sessionStorage.getItem(SESSION_KEY),

        accountId: id,
        nombre: d.name,
        tipo: rawTypeLocal(d.type),
        monto: Number(d.amount || 0),
        prioridad: rawPriorityLocal(d.priority),
        orden: Number(d.order || 0),
        vigenteDesde: d.from || '',
        vigenteHasta: d.to || ''
      });

      if (!response || !response.ok) {
        throw new Error(
          (response && response.message) ||
          `No se pudo guardar ${d.name}`
        );
      }

      return true;

    } catch (err) {
      // updateAccount es idempotente: si hubo un 502 después
      // de escribir, repetir el mismo estado no duplica nada.
      if (attempt === 1) {
        await new Promise(resolve => setTimeout(resolve, 700));
        return saveOne(id, 2);
      }

      throw err;
    }
  }

  for (const id of ids) {
    try {
      await saveOne(id);

      completed++;

      // IMPORTANTÍSIMO:
      // esta fila ya quedó guardada, así que actualizamos
      // su baseline individualmente.
      originals.set(
        id,
        copyLocal(drafts.get(id))
      );
      const saved = expenseConfig.find(account => String(account.id) === id);
      if (saved) Object.assign(saved, copyLocal(drafts.get(id)));

      if (btn) {
        btn.textContent =
          `Guardando ${completed}/${ids.length}…`;
      }

    } catch (err) {
      failed.push({
        id,
        error: err.message || 'Error desconocido'
      });

      // NO recargamos y NO borramos drafts.
      // Lo pendiente sigue visible como "Sin guardar".
    }
  }

  if (completed) {
    renderAll();
    // Confirm the saved ordering and amounts from the server in the background.
    void window.refreshCoreInBackgroundV34?.();
  } else {
    renderExpenseConfig();
  }

  if (!failed.length) {
    alert(
      ids.length === 1
        ? 'Cambio guardado correctamente.'
        : `${ids.length} cambios guardados correctamente.`
    );

  } else {
    const remaining = dirtyIdsLocal().length;

    alert(
      `Se guardaron ${completed} de ${ids.length} cambios.\n\n` +
      `${remaining} cambio${remaining === 1 ? '' : 's'} sigue${remaining === 1 ? '' : 'n'} pendiente${remaining === 1 ? '' : 's'}.\n\n` +
      `Podés volver a presionar Guardar cambios sin repetir los que ya se guardaron.`
    );
  }

  updateToolbarLocal();
}

  /*
   * DISTRIBUCIÓN
   *
   * Reemplazamos el parche basado en índice de fila.
   * Cada estado ahora se calcula directamente desde SU cuenta.
   */
  renderExpenseAllocation = function(expenses, available) {
    const visibleExpenses = [...expenses].sort((a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority) ||
      Number(a.order || 99) - Number(b.order || 99) ||
      String(a.name || '').localeCompare(String(b.name || ''))
    );

    const used = visibleExpenses.reduce(
      (sum, e) => sum + Number(e.assigned || 0),
      0
    );

    const gap = visibleExpenses
      .filter(e => e.type !== 'remainder')
      .reduce(
        (sum, e) =>
          sum + Math.max(
            0,
            Number(e.need || 0) -
            Number(e.assigned || 0)
          ),
        0
      );

    const weekRows = rowsForCurrentWeek();

    const expected = weekRows.reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0
    );

    const received = weekRows.reduce(
      (sum, r) => sum + Number(r.received || 0),
      0
    );

    const latePending = getLateRows().reduce(
      (sum, r) => sum + Number(r.missing || 0),
      0
    );

    const incoming =
      Math.max(0, expected - received) +
      latePending;

    $('allocAvailable').textContent = money(available);
    $('allocUsed').textContent = money(used);
    $('allocGap').textContent = money(gap);

    $('allocGapNote').textContent =
      'Gastos que todavía no logramos cubrir';

    $('allocIncoming').textContent = money(incoming);

    $('expenseBody').innerHTML =
      visibleExpenses.map(e => {
        const need = Number(e.need || 0);
        const assigned = Number(e.assigned || 0);
        const falta = Math.max(0, need - assigned);

        let state;

        if (
          e.type !== 'remainder' &&
          need <= 0.01
        ) {
          state = '⚪ No corresponde esta semana';

        } else if (
          (e.id === 'pago_deudas' ||
           e.name === 'Pago de deudas') &&
          incoming > 0
        ) {
          state = '🟡 Pendiente de completar';

        } else if (falta <= 0.01) {
          state = '🟢 Completa';

        } else if (assigned > 0) {
          state = '🟡 Parcial';

        } else {
          state =
            e.priority === 'critical'
              ? '🔴 Pendiente'
              : '⚪ Pendiente';
        }

        return `
          <tr data-expense-allocation-id="${escapeAttrV3(e.id)}">
            <td>
              <span class="priority ${priorityClass(e.priority)}">
                ${priorityLabel(e.priority)}
              </span>
            </td>

            <td>${escapeHtmlV3(e.name)}</td>
            <td>${money(need)}</td>
            <td>${money(assigned)}</td>
            <td>${money(falta)}</td>
            <td>${state}</td>
          </tr>
        `;
      }).join('');
  };

  function installStylesLocal() {
    if ($('expensesLocalV35Styles')) return;

    const style = document.createElement('style');
    style.id = 'expensesLocalV35Styles';

    style.textContent = `
      .expensePriorityGroupLocal td{
        padding:10px 10px 6px!important;
        font-size:11px;
        text-transform:uppercase;
        letter-spacing:.08em;
        opacity:.72;
        background:rgba(215,185,40,.04);
      }

      .expenseOrderLocal{
        display:flex;
        align-items:center;
        gap:10px;
        white-space:nowrap;
      }

      .expenseDragHandleLocal{
        cursor:grab;
        user-select:none;
        font-size:19px;
        color:#d7b928;
        padding:5px 8px;
        border-radius:7px;
        border:1px solid rgba(215,185,40,.25);
      }

      .expenseDragHandleLocal:active{
        cursor:grabbing;
      }

      .dragDisabledLocal{
        opacity:.25;
        font-size:19px;
        padding:5px 8px;
      }

      tr.dragOverLocal td{
        background:rgba(215,185,40,.12)!important;
      }

      tr.expenseDirtyLocal td{
        background:rgba(215,185,40,.035);
      }

      .dirtyBadgeLocal{
        display:block;
        margin-top:5px;
        font-size:10px;
        font-weight:700;
        color:#d7b928;
      }

      .expenseActionCellLocal{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }

      .expenseValidityLocal{
        flex:1;
      }

      .expenseDatesLocal{
        display:flex;
        align-items:center;
        gap:6px;
      }

      .expenseDatesLocal input{
        width:132px!important;
      }

      #expenseConfigBody input,
      #expenseConfigBody select{
        padding:8px 9px;
        border-radius:8px;
        border:1px solid var(--l);
        background:inherit;
        color:inherit;
      }

      #discardExpenseChangesLocal{
        margin-left:8px;
      }

      body.dark #expenseConfigBody input,
      body.dark #expenseConfigBody select{
        background:#111;
        color:#f5f5f5;
        border-color:#303030;
      }
    `;

    document.head.appendChild(style);
  }

  function initExpensesLocal() {
    installStylesLocal();

    const btn = $('addExpense');

    if (btn) {
      btn.onclick = saveAllExpensesLocal;
    }

    // Esperamos a que ya exista expenseConfig.
    setTimeout(() => {
      originals.clear();
      drafts.clear();

      syncDraftsLocal();
      renderExpenseConfig();
    }, 100);
  }

  document.addEventListener(
    'DOMContentLoaded',
    initExpensesLocal
  );

  window.saveAllExpensesLocal = saveAllExpensesLocal;

  console.log(
    '[LOCAL] Gastos V3.5 activo · drag + edición segura + guardar todo'
  );
})();
