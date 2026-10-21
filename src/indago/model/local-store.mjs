// In-memory version of the store actions the screens call. The demo page and
// the tests use it; the Supabase layer can reuse `reduce` for optimistic updates.
// Locked client columns are refused here too, but RLS is the real lock.

import { REG } from './options.mjs';
import { newRisk, newRegRow } from './indago-model.mjs';

const today = () => new Date().toISOString().slice(0, 10);

const patchWhere = (list, match, patch) => list.map((x) => (match(x) ? patch(x) : x));

export function reduce(state, action, now = today) {
  const { type } = action;
  if (type === 'updateWbs') {
    const { id, field, value } = action;
    return { ...state, wbs: patchWhere(state.wbs, (w) => w.id === id, (w) => {
      const next = { ...w, [field]: value };
      // As in v1: marking Complete fills in the actual finish date if it is empty.
      if (field === 'status' && value === 'Complete' && !w.actual) next.actual = now();
      return next;
    }) };
  }
  if (type === 'updateGate') {
    const { id, field, value } = action;
    return { ...state, gates: patchWhere(state.gates, (g) => g.id === id, (g) => {
      const next = { ...g, [field]: value };
      if (field === 'status' && value.startsWith('Approved') && !g.date) next.date = now();
      return next;
    }) };
  }
  if (type === 'updateMilestone') {
    const { name, field, value } = action;
    return { ...state, ms: patchWhere(state.ms, (m) => m.name === name, (m) => ({ ...m, [field]: value })) };
  }
  if (type === 'updateRisk') {
    const { id, field, value } = action;
    return { ...state, risks: patchWhere(state.risks, (r) => r.id === id, (r) => ({ ...r, [field]: value })) };
  }
  if (type === 'addRisk') return { ...state, risks: [...state.risks, newRisk(state.risks)] };
  if (type === 'updateRegCell') {
    const { sheet, rowId, col, value } = action;
    if ((REG[sheet]?.lock || []).includes(col) || col === 0) return state;
    const R = state.reg[sheet];
    const rows = R.rows.map((r) => (r[0] === rowId ? r.map((v, ci) => (ci === col ? value : v)) : r));
    return { ...state, reg: { ...state.reg, [sheet]: { ...R, rows } } };
  }
  if (type === 'addRegRow') {
    const { sheet } = action;
    if (REG[sheet]?.noAdd) return state;
    const R = state.reg[sheet];
    return { ...state, reg: { ...state.reg, [sheet]: { ...R, rows: [...R.rows, newRegRow(sheet, R.cols, R.rows)] } } };
  }
  if (type === 'setKickoff') return { ...state, kickoff: action.date };
  if (type === 'setCheck') {
    const check = state.check.slice();
    check[action.index] = action.done;
    return { ...state, check };
  }
  throw new Error(`Unknown action ${type}`);
}

// The `actions` object the screens expect, bound to a dispatch function.
export const bindActions = (dispatch) => ({
  updateWbs: (id, field, value) => dispatch({ type: 'updateWbs', id, field, value }),
  updateGate: (id, field, value) => dispatch({ type: 'updateGate', id, field, value }),
  updateMilestone: (name, field, value) => dispatch({ type: 'updateMilestone', name, field, value }),
  updateRisk: (id, field, value) => dispatch({ type: 'updateRisk', id, field, value }),
  addRisk: () => dispatch({ type: 'addRisk' }),
  updateRegCell: (sheet, rowId, col, value) => dispatch({ type: 'updateRegCell', sheet, rowId, col, value }),
  addRegRow: (sheet) => dispatch({ type: 'addRegRow', sheet }),
  setKickoff: (date) => dispatch({ type: 'setKickoff', date }),
  setCheck: (index, done) => dispatch({ type: 'setCheck', index, done }),
});
