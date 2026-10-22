import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facilitatorOnlyField, isFacilitator, visibleHistory } from './audience.mjs';

test('only a named member the server marks as facilitator gets the facilitator view', () => {
  assert.equal(isFacilitator({ role: 'editor', openAccess: false, facilitator: true }), true);
  assert.equal(isFacilitator({ role: 'viewer', openAccess: false, facilitator: true }), true);
  assert.equal(isFacilitator({ role: 'editor', openAccess: false, facilitator: false }), false);
  assert.equal(isFacilitator({ role: 'editor', openAccess: false }), false, 'a server without the flag gives the client view');
  assert.equal(isFacilitator({ role: 'editor', facilitator: 'true' }), false, 'only a real true counts');
  assert.equal(isFacilitator(null), false);
});

test('open access always gets the client view', () => {
  assert.equal(isFacilitator({ role: 'editor', openAccess: true, facilitator: true }), false);
  assert.equal(isFacilitator({ role: 'editor', openAccess: true }), false);
});

test('Greatstone notes on the North Star are facilitator-only fields; the client record is not', () => {
  for (const key of ['question.0.interpretation', 'question.12.interpretation', 'draft.challenge']) assert.equal(facilitatorOnlyField(key), true, key);
  for (const key of ['question.0.verbatim', 'draft.verbatim', 'draft.agreed', 'show.clock', 'approval.facilitator', 'question.0.interpretation.x']) {
    assert.equal(facilitatorOnlyField(key), false, key);
  }
});

test('history for a client drops saved Greatstone notes only; a facilitator keeps everything', () => {
  const items = [
    { kind: 'north-star', field_key: 'question.3.interpretation' }, { kind: 'north-star', field_key: 'draft.challenge' },
    { kind: 'north-star', field_key: 'draft.agreed' }, { field_key: 'draft.challenge' }, { field_key: 'question.0.verbatim' },
    { kind: 'record', field_key: 'draft.challenge' }, { kind: 'file', file_name: 'a.pdf' },
  ];
  assert.deepEqual(visibleHistory(items, false), [items[2], items[4], items[5], items[6]]);
  assert.equal(visibleHistory(items, true), items);
});
