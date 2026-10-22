import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { demoState } from './indago/fixture/demo-state.mjs';

// GRE-1942: the global History panel keeps saved Greatstone notes for facilitators only.
const history = [
  { kind: 'north-star', id: 1, field_key: 'question.0.interpretation', old_value: '', new_value: 'Greatstone view: margin risk', actor: 'facilitator@example.test', changed_at: '2026-10-22T10:00:00Z' },
  { kind: 'north-star', id: 2, field_key: 'draft.challenge', old_value: '', new_value: 'Bolder alternative', actor: 'facilitator@example.test', changed_at: '2026-10-22T10:01:00Z' },
  { kind: 'north-star', id: 3, field_key: 'question.0.verbatim', old_value: '', new_value: 'Gordon said this', actor: 'client@example.test', changed_at: '2026-10-22T10:02:00Z' },
];
// The smallest snapshot the workspace accepts: the approved toolkit record.
const snapshot = { sheets: [{ id: 's1', title: 'Delivery Toolkit', columns: [] }],
  records: [{ id: 'r1', sheet_id: 's1', position: 1, source_values: [JSON.stringify(demoState().toolkit)], edits: {} }] };

test('History hides saved Greatstone notes from client users and open access; a facilitator sees them', async () => {
  const window = new Window({ url: 'https://example.test/portal/indago' });
  const directory = mkdtempSync(join(tmpdir(), 'indago-history-'));
  const originals = new Map();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
  }
  originals.set('fetch', Object.getOwnPropertyDescriptor(globalThis, 'fetch'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const output = join(directory, 'app.mjs');
    await build({
      stdin: {
        contents: `import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { flushSync } from 'react-dom';
          import { Workspace } from './App.jsx';
          export function mount(element, props) {
            const root = createRoot(element);
            flushSync(() => root.render(React.createElement(Workspace, props)));
            return root;
          }
          export function unmount(root) { root.unmount(); }`,
        resolveDir: new URL('.', import.meta.url).pathname,
        loader: 'jsx',
      },
      bundle: true, format: 'esm', platform: 'browser', outfile: output,
      jsx: 'automatic', loader: { '.jsx': 'jsx', '.png': 'dataurl', '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
      plugins: [{ name: 'stub-auth', setup(builder) {
        builder.onResolve({ filter: /lib\/auth-client\.mjs$/ }, () => ({ path: 'auth', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const authClient = { signOut() {} };', loader: 'js',
        }));
      } }],
    });
    const { mount, unmount } = await import(pathToFileURL(output).href);
    const wait = async check => { for (let attempt = 0; attempt < 50 && !check(); attempt++) await new Promise(resolve => setTimeout(resolve, 10)); };
    for (const { member, openAccess, sees } of [
      { member: { role: 'editor', openAccess: false, facilitator: false }, openAccess: false, sees: false },
      { member: { role: 'editor', openAccess: false }, openAccess: false, sees: false },
      { member: { role: 'editor', openAccess: true, facilitator: true }, openAccess: true, sees: false },
      { member: { role: 'viewer', openAccess: false, facilitator: true }, openAccess: false, sees: true },
    ]) {
      globalThis.fetch = async url => {
        if (url.endsWith('/membership')) return Response.json(member);
        if (url.endsWith('/snapshot')) return Response.json(snapshot);
        if (url.endsWith('/deliverables')) return Response.json([]);
        if (url.endsWith('/history')) return Response.json(history);
        return Response.json({ error: 'Not found.' }, { status: 404 });
      };
      const element = document.createElement('div');
      document.body.appendChild(element);
      const root = mount(element, { openAccess });
      try {
        const historyButton = () => [...element.querySelectorAll('button')].find(b => b.textContent === 'History');
        await wait(historyButton);
        historyButton().click();
        await wait(() => element.querySelector('.history-panel'));
        const panel = element.querySelector('.history-panel').textContent;
        const label = JSON.stringify(member);
        assert.match(panel, /question\.0\.verbatim: Empty → Gordon said this/, `${label}: the client record stays`);
        assert.equal(/Greatstone view|Bolder alternative|interpretation|draft\.challenge/.test(panel), sees, `${label}: Greatstone notes ${sees ? 'show' : 'are hidden'}`);
      } finally {
        unmount(root);
        element.remove();
      }
    }
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    window.happyDOM.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
