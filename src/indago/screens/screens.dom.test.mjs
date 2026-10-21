// Mounts the real screens in a DOM (happy-dom), on the made-up demo data.
// Checks what the model tests cannot see: every screen renders, a Viewer gets
// no inputs, locked client columns have no inputs, edits save on blur, and the
// tabs work from the keyboard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

// The app shell imports a PNG and CSS, so the test mounts the screens and the TabList directly.
const ENTRY = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { demoState } from '${join(here, '../fixture/demo-state.mjs')}';
import { TabList } from '${join(here, 'ui.jsx')}';
import ControlCentre from '${join(here, 'ControlCentre.jsx')}';
import WorkPlan from '${join(here, 'WorkPlan.jsx')}';
import Gates from '${join(here, 'Gates.jsx')}';
import Risks from '${join(here, 'Risks.jsx')}';
import Investigation from '${join(here, 'Investigation.jsx')}';
import Evidence from '${join(here, 'Evidence.jsx')}';
import Traceability from '${join(here, 'Traceability.jsx')}';
export const SCREENS = { ControlCentre, WorkPlan, Gates, Risks, Investigation, Evidence, Traceability };
export { demoState };
export function mount(el, node) {
  const root = createRoot(el);
  flushSync(() => root.render(node));
  return root;
}
export function Tabs(props) {
  const [cur, setCur] = React.useState('a');
  return React.createElement(TabList, { ...props, current: cur, onSelect: setCur });
}
export { React, flushSync };
`;

let lib;
let win;
let dir;
const errors = [];
const realError = console.error;

before(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'FocusEvent', 'location', 'history']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? win : win[k], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 240)); };
  dir = mkdtempSync(join(tmpdir(), 'indago-dom-'));
  const out = join(dir, 'bundle.mjs');
  await build({ stdin: { contents: ENTRY, resolveDir: here, loader: 'jsx' }, bundle: true, format: 'esm', platform: 'browser', outfile: out, jsx: 'automatic', loader: { '.jsx': 'jsx' }, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } });
  lib = await import(pathToFileURL(out).href);
});

after(() => {
  console.error = realError;
  rmSync(dir, { recursive: true, force: true });
  win.happyDOM.close();
});

function render(Screen, { canEdit = true, state = lib.demoState(), actions = {}, files = [], fileActions } = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const calls = [];
  const spy = new Proxy(actions, { get: (t, k) => t[k] || ((...a) => calls.push([k, ...a])) });
  const root = lib.mount(el, lib.React.createElement(Screen, { state, canEdit, actions: spy, files, fileActions, onOpen: () => {} }));
  return { el, calls, unmount: () => { root.unmount(); el.remove(); } };
}

test('every screen renders text for Editor and Viewer without React warnings', () => {
  for (const [name, Screen] of Object.entries(lib.SCREENS)) {
    for (const canEdit of [true, false]) {
      const before = errors.length;
      const { el, unmount } = render(Screen, { canEdit });
      assert.ok(el.textContent.length > 200, `${name} rendered ${el.textContent.length} characters`);
      assert.deepEqual(errors.slice(before), [], `${name} logged errors`);
      unmount();
    }
  }
});

test('work package shows file count, metadata and Viewer download without upload or remove', () => {
  const files = [{ id: 'demo-1', work_package_id: '1.01', file_name: 'Invented sample.csv',
    byte_size: 1200000, uploaded_by: 'Demo Person', uploaded_at: '2026-10-20T09:00:00Z' }];
  const fileActions = { download: async () => {}, upload: async () => {}, remove: async () => {} };
  const { el, unmount } = render(lib.SCREENS.WorkPlan, { canEdit: false, files, fileActions });
  const row = el.querySelector('tbody tr:not(.group)');
  assert.match(row.textContent, /1\.01\s*1/);
  const details = el.querySelector('.deliverables');
  assert.match(details.textContent, /Invented sample\.csv/);
  assert.match(details.textContent, /Demo Person/);
  assert.equal(details.querySelector('input[type=file]'), null);
  assert.equal([...details.querySelectorAll('button')].map(button => button.textContent).join(','), 'Download');
  unmount();
});

test('a Viewer gets no editable fields on any screen', () => {
  for (const [name, Screen] of Object.entries(lib.SCREENS)) {
    const { el, unmount } = render(Screen, { canEdit: false });
    // Search boxes and filter menus in the toolbars do not change data, so they stay.
    const editable = [...el.querySelectorAll('textarea, select, input:not([type=search]):not([type=checkbox])')].filter((x) => !x.closest('.toolbar'));
    const boxes = [...el.querySelectorAll('input[type=checkbox]')].filter((c) => !c.disabled);
    assert.equal(editable.length + boxes.length, 0, `${name} has ${editable.length + boxes.length} editable fields for a Viewer`);
    assert.equal(el.querySelector('button.btn'), null, `${name} shows an add button to a Viewer`);
    unmount();
  }
});

test('locked client columns render without inputs; open columns are editable', () => {
  const { el, unmount } = render(lib.SCREENS.Evidence);
  const first = el.querySelector('tbody tr');
  const cells = [...first.children];
  for (const ci of [0, 1, 2, 3, 4]) assert.equal(cells[ci].querySelector('input, select, textarea'), null, `column ${ci} is editable`);
  assert.ok(cells[5].querySelector('select'), 'client answer is a select');
  assert.ok(cells[6].querySelector('textarea'), 'client correction is editable');
  assert.equal(el.querySelector('button.btn'), null, 'client findings has no Add row');
  unmount();
});

test('editing a risk owner saves on blur with the risk ID', () => {
  const { el, calls, unmount } = render(lib.SCREENS.Risks);
  const input = el.querySelector('input[aria-label="Owner for R01"]');
  input.value = 'New owner';
  // React listens for focusout, which is what a real blur also fires.
  lib.flushSync(() => input.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true })));
  assert.deepEqual(calls.filter((c) => c[0] === 'updateRisk'), [['updateRisk', 'R01', 'owner', 'New owner']]);
  unmount();
});

test('arrow keys, Home and End move between tabs', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const tabs = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  const root = lib.mount(el, lib.React.createElement(lib.Tabs, { tabs, label: 'T', idPrefix: 't' }));
  const selected = () => el.querySelector('[aria-selected="true"]').dataset.tab;
  const key = (k) => lib.flushSync(() => el.querySelector('[aria-selected="true"]').dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true })));
  assert.equal(selected(), 'a');
  key('ArrowRight'); assert.equal(selected(), 'b');
  key('End'); assert.equal(selected(), 'c');
  key('ArrowRight'); assert.equal(selected(), 'a');
  key('ArrowLeft'); assert.equal(selected(), 'c');
  key('Home'); assert.equal(selected(), 'a');
  assert.equal([...el.querySelectorAll('[role=tab]')].filter((t) => t.tabIndex === 0).length, 1, 'one tab stop');
  root.unmount();
  el.remove();
});
