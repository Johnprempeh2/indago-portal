import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelScrollDelta } from './panel-scroll.mjs';

test('stuck bar with the new panel under it: scroll up so the heading clears the bar', () => {
  // Bar stuck at the top (0–58 px); new, shorter panel starts 900 px above the viewport.
  assert.equal(panelScrollDelta({ navTop: 0, navBottom: 58, panelTop: -900, gap: 24 }), -982);
  // Panel top just under the bar: a small nudge down the page.
  assert.equal(panelScrollDelta({ navTop: 0, navBottom: 58, panelTop: 40, gap: 24 }), -42);
});

test('no scroll when the heading is already below the bar', () => {
  assert.equal(panelScrollDelta({ navTop: 0, navBottom: 58, panelTop: 82, gap: 24 }), 0);
  assert.equal(panelScrollDelta({ navTop: 0, navBottom: 58, panelTop: 300, gap: 24 }), 0);
});

test('no scroll when the bar is not stuck (page near the top)', () => {
  assert.equal(panelScrollDelta({ navTop: 240, navBottom: 298, panelTop: 322, gap: 24 }), 0);
});
