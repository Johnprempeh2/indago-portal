// Pure logic behind the Indago screens, ported from the v1 portal (GRE-1681).
// Every function takes the portal state and returns plain data, so the
// screens stay thin and this file is tested with node --test.

import { OPT, REG, PERIODS } from './options.mjs';

// Progress weight of a work-package status, as in the workbook.
export const pct = (status) => (status === 'Complete' ? 1 : status === 'In progress' ? 0.5 : 0);
const avg = (list) => (list.length ? list.reduce((a, w) => a + pct(w.status), 0) / list.length : 0);
export const asPercent = (fraction) => Math.round(fraction * 100);

export const wbsById = (state, id) => state.wbs.find((w) => w.id === id);

// Dependencies that are not yet complete (missing ones count as open).
export function depsOpen(state, w) {
  return w.deps.filter((d) => {
    const x = wbsById(state, d);
    return !x || x.status !== 'Complete';
  });
}

// "W2" -> "W2 (27 Oct–31 Oct)" once the agreed W1 start date is set.
export function weekLabel(kickoff, period) {
  if (!kickoff) return period;
  const i = PERIODS.indexOf(period);
  if (i < 0 || i > 3) return period;
  const d = new Date(kickoff + 'T00:00:00');
  d.setDate(d.getDate() + 7 * i);
  const e = new Date(d);
  e.setDate(e.getDate() + 4);
  const f = (x) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${period} (${f(d)}–${f(e)})`;
}

export const uniq = (list) => [...new Set(list)];
const regCount = (state, sheet, col, values) => (state.reg[sheet]?.rows || []).filter((r) => values.includes(r[col])).length;
const isApproved = (g) => g.status.startsWith('Approved');
const isHighHigh = (r) => r.status !== 'Closed' && r.l === 'High' && r.i === 'High';

export function gateProgress(state, gateId) {
  const ws = state.wbs.filter((w) => w.gate === gateId);
  return { count: ws.length, percent: asPercent(avg(ws)), workPackages: ws };
}

// Everything the Control centre shows.
export function controlSummary(state) {
  const n = state.wbs.length;
  const count = (s) => state.wbs.filter((w) => w.status === s).length;
  const done = count('Complete');
  const blocked = count('Blocked');
  const inProgress = count('In progress');
  const gatesApproved = state.gates.filter(isApproved).length;
  const cfTotal = state.reg['Client Findings']?.rows.length || 0;
  const rqTotal = state.reg['Information Requests']?.rows.length || 0;
  const answered = regCount(state, 'Client Findings', 5, ['Confirmed', 'Partly correct', 'Not correct']);
  const corroborated = regCount(state, 'Client Findings', 8, ['Corroborated', 'Client-validated']);
  const contradictions = regCount(state, 'Client Findings', 8, ['Contradicted']);
  const requestsDone = regCount(state, 'Information Requests', 7, ['Complete']);
  const highRisks = state.risks.filter(isHighHigh).length;

  const kpis = [
    { value: `${asPercent(avg(state.wbs))}%`, label: 'Overall completion', src: 'Plan', highlight: true },
    { value: `${done}/${n}`, label: 'Work packages complete', src: 'Plan' },
    { value: String(blocked), label: 'Blocked work packages', src: 'Plan', alert: blocked > 0 },
    { value: `${gatesApproved}/${state.gates.length}`, label: 'Gates approved', src: 'Plan' },
    { value: String(highRisks), label: 'Open high × high risks', src: 'Plan', alert: highRisks > 0 },
    { value: `${answered}/${cfTotal}`, label: 'Client findings answered', src: 'Register' },
    { value: String(corroborated), label: 'Findings corroborated or client-validated', src: 'Register' },
    { value: String(contradictions), label: 'Open contradictions', src: 'Register', alert: contradictions > 0 },
    { value: `${requestsDone}/${rqTotal}`, label: 'Information requests complete', src: 'Register' },
  ];

  const attention = [];
  state.wbs.filter((w) => w.status === 'Blocked').forEach((w) =>
    attention.push({ id: w.id, tone: 'Blocked', text: w.task, note: w.blocker }));
  state.wbs.filter((w) => (w.status === 'In progress' || w.status === 'Complete') && depsOpen(state, w).length).forEach((w) =>
    attention.push({ id: w.id, tone: 'At risk', text: `Started before ${depsOpen(state, w).join(', ')} complete` }));
  state.risks.filter(isHighHigh).forEach((r) =>
    attention.push({ id: r.id, tone: 'High risk', text: r.risk, note: r.owner }));
  state.ms.filter((m) => m.status === 'At risk').forEach((m) =>
    attention.push({ id: 'MS', tone: 'At risk', text: m.name }));
  if (n && !state.wbs.some((w) => w.person)) {
    attention.push({ id: 'Setup', tone: 'At risk', text: 'No named Greatstone owners yet. Add them in the Work plan.' });
  }

  const workstreams = uniq(state.wbs.map((w) => w.ws)).map((name) => {
    const ws = state.wbs.filter((w) => w.ws === name);
    return { name, count: ws.length, percent: asPercent(avg(ws)) };
  });

  return {
    total: n, done, blocked, inProgress, gatesApproved, answered, cfTotal,
    nextGate: state.gates.find((g) => !isApproved(g)) || null,
    kpis,
    gates: state.gates.map((g) => ({ ...g, approved: isApproved(g), ...gateProgress(state, g.id) })),
    workstreams,
    attention,
    ready: state.wbs.filter((w) => w.status === 'Not started' && depsOpen(state, w).length === 0),
  };
}

export const EMPTY_WBS_FILTER = { q: '', ws: '', gate: '', status: '', role: '' };

export function filterWbs(state, f) {
  const q = (f.q || '').toLowerCase();
  return state.wbs.filter((w) =>
    (!f.ws || w.ws === f.ws) && (!f.gate || w.gate === f.gate) && (!f.status || w.status === f.status) && (!f.role || w.role === f.role) &&
    (!q || `${w.id} ${w.task} ${w.exit} ${w.person} ${w.blocker}`.toLowerCase().includes(q)));
}

// The shown work packages in workstream groups, in plan order (GRE-1891).
// `done` and `total` count the whole workstream, so a filter does not change them.
export function wbsGroups(state, rows) {
  const groups = [];
  rows.forEach((w) => {
    let g = groups[groups.length - 1];
    if (!g || g.name !== w.ws) {
      const all = state.wbs.filter((x) => x.ws === w.ws);
      groups.push(g = { name: w.ws, items: [], total: all.length, done: all.filter((x) => x.status === 'Complete').length });
    }
    g.items.push(w);
  });
  return groups;
}

// The workstream to show first: the first with work not yet complete, else the first (GRE-1891).
export function focusWorkstream(state) {
  const names = uniq(state.wbs.map((w) => w.ws));
  return names.find((n) => state.wbs.some((w) => w.ws === n && w.status !== 'Complete')) || names[0] || '';
}

// The gate to show first: the one asked for, else the next gate not yet approved, else the last.
export function focusGate(state, wanted = '') {
  const g = state.gates.find((x) => x.id === wanted) || state.gates.find((x) => !isApproved(x)) || state.gates[state.gates.length - 1];
  return g ? g.id : '';
}

// Open risks on the main path, closed ones folded away, and the counts the Risks screen leads with.
export function riskSummary(risks) {
  const open = risks.filter((r) => r.status !== 'Closed');
  return {
    open,
    closed: risks.filter((r) => r.status === 'Closed'),
    highHigh: open.filter(isHighHigh).length,
    noOwner: open.filter((r) => !String(r.owner || '').trim()).length,
  };
}

// Gantt cells W1..Post for one work package.
export function ganttCells(w) {
  const i0 = PERIODS.indexOf(w.start);
  const i1 = PERIODS.indexOf(w.finish);
  return PERIODS.map((p, i) => ({ period: p, on: i >= i0 && i <= i1 && i0 >= 0, done: w.status === 'Complete' }));
}

// Open risks on a 3×3 grid: rows likelihood High→Low, columns impact Low→High.
export function heatGrid(risks) {
  const L = ['High', 'Medium', 'Low'];
  const I = ['Low', 'Medium', 'High'];
  return L.map((l, li) => ({
    likelihood: l,
    cells: I.map((im, ii) => {
      const score = (2 - li) + ii;
      return { impact: im, level: score >= 3 ? 3 : score >= 2 ? 2 : 1, risks: risks.filter((r) => r.status !== 'Closed' && r.l === l && r.i === im) };
    }),
  }));
}

// Next sequential ID: R09 after R08; IND-DD-003 after IND-DD-002.
export function nextId(ids, prefix, pad) {
  const n = Math.max(0, ...ids.map((id) => parseInt(String(id).slice(prefix.length), 10) || 0)) + 1;
  return prefix + String(n).padStart(pad, '0');
}

export const newRisk = (risks) => ({ id: nextId(risks.map((r) => r.id), 'R', 2), risk: '', l: 'Medium', i: 'Medium', owner: '', resp: '', status: 'Open' });

export function newRegRow(sheet, cols, rows) {
  const cfg = REG[sheet];
  const row = cols.map(() => '');
  row[0] = nextId(rows.map((r) => r[0]), cfg.prefix, cfg.pad);
  Object.entries(cfg.sel || {}).forEach(([ci, o]) => { row[ci] = OPT[o][0]; });
  return row;
}

// Commercial Baseline: Contribution = Revenue − Direct − Allocated; Margin = Contribution ÷ Revenue.
export function calcCell(kind, row) {
  const n = (v) => (v === '' || v == null ? null : parseFloat(String(v).replace(/[^0-9.\-]/g, '')));
  const rev = n(row[4]);
  const direct = n(row[5]);
  const alloc = n(row[6]);
  if (rev == null || direct == null || Number.isNaN(rev) || Number.isNaN(direct)) return '';
  const contrib = rev - direct - (alloc != null && !Number.isNaN(alloc) ? alloc : 0);
  if (kind === 'contrib') return contrib.toLocaleString('en-GB');
  return rev ? (contrib / rev * 100).toFixed(1) + '%' : '';
}

export function filterRegRows(sheet, rows, f) {
  const cfg = REG[sheet];
  const q = (f.q || '').toLowerCase();
  return rows.map((r, i) => ({ row: r, index: i })).filter(({ row }) =>
    (!q || row.join(' ').toLowerCase().includes(q)) && (cfg.filters || []).every((ci) => !f[ci] || row[ci] === f[ci]));
}

export function regFilterOptions(sheet, rows, ci) {
  const cfg = REG[sheet];
  const fromData = uniq(rows.map((r) => r[ci]).filter(Boolean)).sort();
  const fromOpts = cfg.sel && cfg.sel[ci] ? OPT[cfg.sel[ci]].filter(Boolean) : [];
  return uniq([...fromOpts, ...fromData]);
}

// Everything the Traceability screen counts.
export function traceSummary(state) {
  const rows = (k) => state.reg[k]?.rows || [];
  const g = rows('GDXP Traceability');
  const f = rows('Findings');
  const op = rows('Opportunities');
  const cf = rows('Client Findings');
  const filled = (r) => r.slice(1).some(Boolean);
  const kpis = [
    { value: String(g.filter((r) => r[6]).length), label: 'GDXP rows with a target design / roadmap' },
    { value: `${g.filter((r) => r[1] && (r[2] || r[3]) && r[4] && r[5] && r[6] && r[7]).length}/${g.filter(filled).length}`, label: 'GDXP rows with the full chain filled' },
    { value: `${f.filter((r) => r[3]).length}/${f.filter(filled).length}`, label: 'Findings that cite evidence IDs' },
    { value: `${op.filter((r) => r[2] && r[8]).length}/${op.filter(filled).length}`, label: 'Opportunities linked to findings and evidence' },
    { value: String(rows('Validation Log').length), label: 'Validation log entries' },
  ];
  const ok = (r) => ['Corroborated', 'Client-validated'].includes(r[8]);
  const areas = uniq(cf.map((r) => r[1])).map((name) => {
    const rs = cf.filter((r) => r[1] === name);
    const n = rs.filter(ok).length;
    return { name, total: rs.length, ok: n, percent: asPercent(n / rs.length) };
  });
  const classes = ['stated', 'confirm', 'differ'];
  const matrix = classes.map((c) => ({ cls: c, counts: OPT.verif.map((v) => cf.filter((r) => r[2] === c && r[8] === v).length) }));
  return { kpis, areas, matrix, verif: OPT.verif };
}

// Where an ID (or any text of 3+ characters) is used across the register and the plan.
export function lookup(state, query, limit = 60) {
  const q = query.trim().toUpperCase();
  if (q.length < 3) return { hits: [], more: 0, active: false };
  const hits = [];
  for (const k of Object.keys(state.reg)) {
    const sheet = state.reg[k];
    sheet.rows.forEach((r) => r.forEach((v, ci) => {
      if (v && String(v).toUpperCase().includes(q)) {
        hits.push({ id: r[0], where: REG[k]?.label || k, field: sheet.cols[ci], text: String(v).slice(0, 180) });
      }
    }));
  }
  state.wbs.forEach((w) => {
    if (`${w.id} ${w.deps.join(' ')} ${w.link}`.toUpperCase().includes(q)) hits.push({ id: w.id, where: 'Work plan', text: w.task, status: w.status });
  });
  return { hits: hits.slice(0, limit), more: Math.max(0, hits.length - limit), active: true };
}

// Rows for a CSV export of one sheet, with the workbook's columns.
export function sheetRows(state, k) {
  if (k === 'Work Breakdown') return [['WBS ID', 'Workstream', 'Task / activity', 'Accountable role', 'Named owner', 'Start period', 'Finish period', 'Dependencies', 'Deliverable / exit criterion', 'Gate', 'Status', '% complete', 'Actual finish', 'Evidence / link', 'Blocker / decision'], ...state.wbs.map((w) => [w.id, w.ws, w.task, w.role, w.person, w.start, w.finish, w.deps.join(';'), w.exit, w.gate, w.status, pct(w.status), w.actual, w.link, w.blocker])];
  if (k === 'Stage Gates') return [['Gate', 'Stage', 'Acceptance evidence', 'Owner', 'Status', 'Decision date', 'Exception / approval'], ...state.gates.map((g) => [g.id, g.stage, g.accept, g.owner, g.status, g.date, g.exc])];
  if (k === 'Milestones') return [['Milestone', 'Period', 'Prerequisite', 'Client decision / output', 'Status', 'Actual date'], ...state.ms.map((m) => [m.name, m.period, m.pre, m.out, m.status, m.date])];
  if (k === 'Risks & Issues') return [['ID', 'Risk / issue', 'Likelihood', 'Impact', 'Owner', 'Response / mitigation', 'Status'], ...state.risks.map((r) => [r.id, r.risk, r.l, r.i, r.owner, r.resp, r.status])];
  const R = state.reg[k];
  const cfg = REG[k] || {};
  return [R.cols, ...R.rows.map((r) => r.map((v, ci) => (cfg.calc && cfg.calc[ci] ? calcCell(cfg.calc[ci], r) : v)))];
}

export const EXPORT_SHEETS = ['Work Breakdown', 'Stage Gates', 'Milestones', 'Risks & Issues', ...Object.keys(REG)];

// A cell that starts with = + - @ could run as a formula in Excel, so it gets a
// leading apostrophe (numbers such as -1500 are left alone).
const csvCell = (v) => {
  let s = String(v == null ? '' : v);
  if (/^[\s]*[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s.trim())) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
// UTF-8 BOM so Excel opens accents and ™ correctly.
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
