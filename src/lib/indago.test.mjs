import test from 'node:test';
import assert from 'node:assert/strict';
import { displayValues, toCsv, makeIndagoApi } from './indago.mjs';

test('display and CSV preserve locked source while showing editor changes', () => {
  const row = { source_values: ['Original', 'Open'], edits: { 1: 'Done, "checked"' } };
  assert.deepEqual(displayValues(row), ['Original', 'Done, "checked"']);
  assert.equal(toCsv(['Statement', 'Status'], [row]), '"Statement","Status"\r\n"Original","Done, ""checked"""\r\n');
});

test('save reports a version conflict without hiding it', async () => {
  const query = { eq() { return this; }, select() { return this; }, async maybeSingle() { return { data: null, error: null }; } };
  const api = makeIndagoApi({ schema: () => ({ from: () => ({ update: () => query }) }) });
  await assert.rejects(api.save({ id: 'r1', version: 1 }, { 1: 'Done' }), /changed in another browser/);
});

test('CSV export treats spreadsheet formulas as text', () => {
  assert.equal(toCsv(['Value'], [{ source_values: ['=2+2'], edits: {} }]), '"Value"\r\n"\'=2+2"\r\n');
});


test('recent history requests actor labels from the private RPC', async () => {
  const expected = [{ id: 1, actor_email: 'editor@example.test' }];
  const calls = [];
  const api = makeIndagoApi({ schema(name) {
    assert.equal(name, 'indago');
    return { rpc(name) { calls.push(name); return Promise.resolve({ data: expected, error: null }); } };
  } });
  assert.deepEqual(await api.recentHistory(), expected);
  assert.deepEqual(calls, ['recent_history']);
});
