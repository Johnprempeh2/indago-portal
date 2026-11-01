import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('an unsaved interview answer warns on browser leave and a saved answer clears the warning', async () => {
  const win = new Window({ url: 'https://example.test/portal/indago/interview' });
  const directory = mkdtempSync(join(tmpdir(), 'indago-interview-unload-'));
  const originals = new Map();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : win[key] });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const output = join(directory, 'interview.mjs');
    await build({
      stdin: { contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import Interview from './Interview.jsx';
        export function mount(element, api) {
          const root = createRoot(element);
          flushSync(() => root.render(React.createElement(Interview, { api })));
          return root;
        }`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'jsx' },
      bundle: true, format: 'esm', platform: 'browser', outfile: output,
      loader: { '.jsx': 'jsx', '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
    });
    const { mount } = await import(pathToFileURL(output).href);
    const session = { id: 'synthetic-session', status: 'in_progress', canWrite: true, answers: [], corrected_summary: '' };
    const api = {
      list: async () => ({ sessions: [session], facilitator: false }),
      get: async () => session,
      answer: async (_id, move, original) => {
        session.answers.push({ id: 'synthetic-answer', move, original, challenges: [] });
        return { ...session, answers: [...session.answers] };
      },
    };
    const element = document.createElement('div');
    document.body.appendChild(element);
    const root = mount(element, api);
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const warns = () => {
      const event = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(event);
      return event.defaultPrevented;
    };
    try {
      await tick();
      element.querySelector('.sessions button').click();
      await tick();
      assert.equal(warns(), false);
      const answer = element.querySelector('#answer');
      Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set.call(answer, 'Invented direction');
      answer.dispatchEvent(new win.Event('input', { bubbles: true }));
      await tick();
      assert.equal(warns(), true);
      element.querySelector('form.current').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
      await tick();
      assert.equal(session.answers[0].original, 'Invented direction');
      assert.equal(warns(), false);
    } finally { root.unmount(); element.remove(); }
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    win.happyDOM.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
