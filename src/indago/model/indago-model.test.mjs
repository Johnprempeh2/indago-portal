import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoState } from '../fixture/demo-state.mjs';
import {
  controlSummary, depsOpen, weekLabel, filterWbs, EMPTY_WBS_FILTER, ganttCells, heatGrid, nextId,
  calcCell, filterRegRows, traceSummary, lookup, sheetRows, toCsv, wbsGroups, focusGate, focusWorkstream, riskSummary,
  focusStage, regProgress, regCardLayout,
} from './indago-model.mjs';
import { reduce } from './local-store.mjs';

test('control summary counts work packages, gates and register answers', () => {
  const s = controlSummary(demoState());
  assert.equal(s.total, 18);
  assert.equal(s.gatesApproved, 1);
  assert.equal(s.nextGate.id, 'G2');
  assert.equal(s.cfTotal, 12);
  assert.equal(s.kpis[0].label, 'Overall completion');
  assert.ok(s.attention.some((a) => a.tone === 'Blocked'));
  assert.ok(s.attention.some((a) => a.tone === 'High risk' && a.id === 'R01'));
});

test('a work package is ready only when every dependency is complete', () => {
  const st = demoState();
  const s = controlSummary(st);
  for (const w of s.ready) assert.deepEqual(depsOpen(st, w), []);
  const blocked = st.wbs.find((w) => w.deps.length && depsOpen(st, w).length);
  assert.ok(!s.ready.includes(blocked));
});

test('started-before-dependency work is flagged as at risk', () => {
  let st = demoState();
  const later = st.wbs.find((w) => w.status === 'Not started' && depsOpen(st, w).length);
  st = reduce(st, { type: 'updateWbs', id: later.id, field: 'status', value: 'In progress' });
  const s = controlSummary(st);
  assert.ok(s.attention.some((a) => a.id === later.id && a.tone === 'At risk'));
});

test('week labels show calendar weeks only after kick-off is set', () => {
  assert.equal(weekLabel('', 'W2'), 'W2');
  assert.equal(weekLabel('2026-10-26', 'W2'), 'W2 (2 Nov–6 Nov)');
  assert.equal(weekLabel('2026-10-26', 'Post-playback'), 'Post-playback');
});

test('work plan filters combine', () => {
  const st = demoState();
  assert.equal(filterWbs(st, EMPTY_WBS_FILTER).length, 18);
  const g1 = filterWbs(st, { ...EMPTY_WBS_FILTER, gate: 'G1' });
  assert.ok(g1.length && g1.every((w) => w.gate === 'G1'));
  assert.equal(filterWbs(st, { ...EMPTY_WBS_FILTER, q: 'demo person' }).length, 1);
});

test('gantt marks the period range', () => {
  const cells = ganttCells({ start: 'W2', finish: 'W3', status: 'In progress' });
  assert.deepEqual(cells.map((c) => c.on), [false, true, true, false, false]);
});

test('heat grid leaves out closed risks', () => {
  const grid = heatGrid(demoState().risks);
  const all = grid.flatMap((r) => r.cells.flatMap((c) => c.risks.map((x) => x.id)));
  assert.ok(all.includes('R01'));
  assert.ok(!all.includes('R04'));
  assert.equal(grid[0].cells[2].level, 3);
});

test('next IDs continue the sequence', () => {
  assert.equal(nextId(['R01', 'R08'], 'R', 2), 'R09');
  assert.equal(nextId([], 'IND-DD-', 3), 'IND-DD-001');
});

test('commercial contribution and margin follow the workbook', () => {
  const row = ['', '', '', '', '100000', '60000', '15000'];
  assert.equal(calcCell('contrib', row), '25,000');
  assert.equal(calcCell('margin', row), '25.0%');
  assert.equal(calcCell('margin', ['', '', '', '', '', '1']), '');
});

test('register filter keeps original row indexes', () => {
  const st = demoState();
  const rows = st.reg['Client Findings'].rows;
  const out = filterRegRows('Client Findings', rows, { q: '', 8: 'Contradicted' });
  assert.ok(out.length > 0 && out.every(({ row, index }) => rows[index] === row && row[8] === 'Contradicted'));
});

test('locked client columns cannot be changed through the store', () => {
  const st = demoState();
  const id = st.reg['Client Findings'].rows[0][0];
  const locked = reduce(st, { type: 'updateRegCell', sheet: 'Client Findings', rowId: id, col: 3, value: 'changed' });
  assert.equal(locked, st);
  const open = reduce(st, { type: 'updateRegCell', sheet: 'Client Findings', rowId: id, col: 6, value: 'note' });
  assert.equal(open.reg['Client Findings'].rows[0][6], 'note');
  assert.equal(st.reg['Client Findings'].rows[0][6], 'Demo correction text');
});

test('client registers refuse new rows; other registers number them', () => {
  const st = demoState();
  assert.equal(reduce(st, { type: 'addRegRow', sheet: 'Client Findings' }), st);
  const next = reduce(st, { type: 'addRegRow', sheet: 'Findings' });
  const added = next.reg.Findings.rows.at(-1);
  assert.equal(added[0], 'IND-F-001');
  assert.equal(added[9], 'Draft');
});

test('completing work and approving a gate fill in today when no date is set', () => {
  const st = demoState();
  const w = st.wbs.find((x) => x.status === 'Not started');
  const a = reduce(st, { type: 'updateWbs', id: w.id, field: 'status', value: 'Complete' }, () => '2026-11-01');
  assert.equal(a.wbs.find((x) => x.id === w.id).actual, '2026-11-01');
  const b = reduce(st, { type: 'updateGate', id: 'G3', field: 'status', value: 'Approved with exceptions' }, () => '2026-11-02');
  assert.equal(b.gates.find((g) => g.id === 'G3').date, '2026-11-02');
});

test('add risk gets the next R-number', () => {
  const st = reduce(demoState(), { type: 'addRisk' });
  assert.equal(st.risks.at(-1).id, 'R05');
});

test('trace summary and lookup', () => {
  const st = demoState();
  const t = traceSummary(st);
  assert.equal(t.areas.length, 3);
  assert.equal(t.matrix.length, 3);
  assert.equal(t.matrix.flatMap((m) => m.counts).reduce((a, b) => a + b, 0), 12);
  assert.equal(lookup(st, 'DE').active, false);
  const hits = lookup(st, 'demo-f-001').hits;
  assert.ok(hits.some((h) => h.where === 'Findings'));
  assert.ok(hits.some((h) => h.where === 'Client findings' && h.field === 'Related finding ID'));
});

test('CSV export quotes cells and starts with a BOM', () => {
  const st = demoState();
  const rows = sheetRows(st, 'Commercial Baseline');
  assert.equal(rows[1][7], '25,000');
  const csv = toCsv([['a', 'b,c', 'd"e']]);
  assert.equal(csv, '﻿a,"b,c","d""e"');
  assert.equal(sheetRows(st, 'Work Breakdown').length, 19);
  assert.equal(toCsv([['=HYPERLINK("x")', '+1', '@a', '-1500', '-2.5']]), '\uFEFF"\'=HYPERLINK(""x"")",\'+1,\'@a,-1500,-2.5');
});

test('work packages group by workstream; counts cover the whole workstream, not the filter', () => {
  const st = demoState();
  const all = wbsGroups(st, st.wbs);
  assert.equal(all.length, 6);
  assert.equal(all.reduce((n, g) => n + g.items.length, 0), 18);
  assert.deepEqual([all[0].name, all[0].done, all[0].total], ['Evidence confirmation', 2, 3]);
  const blocked = wbsGroups(st, filterWbs(st, { ...EMPTY_WBS_FILTER, status: 'Blocked' }));
  for (const g of blocked) assert.equal(g.total, st.wbs.filter((w) => w.ws === g.name).length);
  assert.ok(blocked.every((g) => g.items.every((w) => w.status === 'Blocked')));
});

test('the Work plan opens on the first workstream with work still open', () => {
  const st = demoState();
  assert.equal(focusWorkstream(st), 'Evidence confirmation');
  st.wbs.filter((w) => w.ws === 'Evidence confirmation').forEach((w) => { w.status = 'Complete'; });
  assert.equal(focusWorkstream(st), 'North Star');
  st.wbs.forEach((w) => { w.status = 'Complete'; });
  assert.equal(focusWorkstream(st), 'Evidence confirmation');
});

test('the Gates screen opens on the gate asked for, else the next one to approve', () => {
  const st = demoState();
  assert.equal(focusGate(st), 'G2');
  assert.equal(focusGate(st, 'G4'), 'G4');
  assert.equal(focusGate(st, 'G9'), 'G2');
  st.gates.forEach((g) => { g.status = 'Approved'; });
  assert.equal(focusGate(st), 'G6');
});

test('risk summary keeps closed risks apart and counts high × high and unowned open risks', () => {
  const risks = [
    { id: 'R01', l: 'High', i: 'High', owner: 'Lead', status: 'Open' },
    { id: 'R02', l: 'High', i: 'High', owner: ' ', status: 'Mitigating' },
    { id: 'R03', l: 'High', i: 'High', owner: '', status: 'Closed' },
  ];
  const s = riskSummary(risks);
  assert.deepEqual(s.open.map((r) => r.id), ['R01', 'R02']);
  assert.deepEqual(s.closed.map((r) => r.id), ['R03']);
  assert.equal(s.highHigh, 2);
  assert.equal(s.noOwner, 1);
});

test('the investigation opens on the stage of the next gate to approve', () => {
  const state = demoState();
  assert.equal(focusStage(state), '02');
  state.gates.forEach((g) => { g.status = 'Approved'; });
  assert.equal(focusStage(state), '06', 'all approved: the last stage');
  assert.equal(focusStage({ ...state, toolkit: undefined }), '');
});

test('register progress counts verified and answered rows per sheet', () => {
  const reg = demoState().reg;
  assert.deepEqual(regProgress('Client Findings', reg['Client Findings'].rows), { done: 4, total: 12, word: 'verified', answered: 6, percent: 33 });
  assert.equal(regProgress('Information Requests', reg['Information Requests'].rows).done, 2);
  assert.equal(regProgress('Validation Log', []), null, 'no status column, no line');
});

test('a register card keeps locked columns read-only and at most three choices on the main path', () => {
  const cols = demoState().reg['Client Findings'].cols;
  const l = regCardLayout('Client Findings', cols);
  assert.equal(l.title, 3, 'the original statement is the title');
  assert.deepEqual(l.facts, [1, 2, 4]);
  assert.deepEqual(l.quick, [5, 8, 9]);
  assert.deepEqual(l.details, [6, 7, 10, 11, 12, 13, 14]);
  const dd = regCardLayout('New Deep Dive Evidence', demoState().reg['New Deep Dive Evidence'].cols);
  assert.equal(dd.title, 5);
  assert.ok(dd.details.includes(5), 'an editable title can still be edited under Details');
  assert.deepEqual(dd.quick, [7, 4]);
});
