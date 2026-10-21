import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsToState, makeRecordStore } from './record-store.mjs';

const toolkit = { rules: [], authority: [], stages: [], agenda: [], nsq: [], interviews: [], instruments: [], rhythm: [], checklist: ['one'] };
const sheets = [
  { id: 'p:w', title: 'Work Breakdown', columns: Array(14).fill(''), locked_columns: [] },
  { id: 'p:s', title: 'Portal Settings', columns: ['Setting'], locked_columns: [0] },
  { id: 'p:t', title: 'Delivery Toolkit', columns: ['Toolkit JSON'], locked_columns: [0] },
  { id: 'r:f', title: 'Client Findings', columns: ['ID', 'Text', 'Answer'], locked_columns: [0, 1] },
];
const record = (id, sheet_id, source_values, edits = {}) => ({ id, sheet_id, position: 1, source_values, edits, version: 1 });
const snapshot = { sheets, records: [
  record('w1', 'p:w', ['1.01', 'Stream', 'Task', 'Role', 'W1', 'W2', '1.00; 0.99', 'Exit', 'G1', 'Not started', '0', '', '', ''], { 9: 'Complete', person: 'Demo Editor' }),
  record('settings', 'p:s', ['settings'], { kickoff: '2026-10-20', check0: 'true' }),
  record('toolkit', 'p:t', [JSON.stringify(toolkit)]),
  record('f1', 'r:f', ['F-1', 'Locked', ''], { 2: 'Confirmed' }),
] };

test('maps source values and edits to the screen contract', () => {
  const state = recordsToState(snapshot);
  assert.equal(state.wbs[0].person, 'Demo Editor');
  assert.equal(state.wbs[0].status, 'Complete');
  assert.deepEqual(state.wbs[0].deps, ['1.00', '0.99']);
  assert.deepEqual(state.reg['Client Findings'].rows[0], ['F-1', 'Locked', 'Confirmed']);
  assert.equal(state.kickoff, '2026-10-20');
  assert.deepEqual(state.check, [true]);
});

test('actions save only overlays and report a conflict', async () => {
  const saves = [];
  let failure = '';
  const api = { snapshot: async () => snapshot, save: async (row, edits) => { saves.push([row.id, edits]); } };
  const store = makeRecordStore(api, () => {}, message => { failure = message; });
  await store.refresh();
  await store.actions.updateWbs('1.01', 'status', 'Blocked');
  assert.deepEqual(saves[0], ['w1', { 9: 'Blocked', person: 'Demo Editor' }]);
  await store.actions.updateRegCell('Client Findings', 'F-1', 1, 'Changed');
  assert.equal(saves.length, 1);
  assert.match(failure, /locked/);
});
