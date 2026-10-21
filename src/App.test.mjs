import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const [status, expectedHeading] of [[403, 'No Indago invitation'], [500, null]]) {
test(`membership ${status} shows ${expectedHeading || 'the retry alert'}`, async () => {
  const window = new Window({ url: 'https://example.test/portal/indago' });
  const directory = mkdtempSync(join(tmpdir(), 'indago-denial-'));
  const originals = new Map();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
  }
  originals.set('fetch', Object.getOwnPropertyDescriptor(globalThis, 'fetch'));
  globalThis.fetch = async () => new Response(JSON.stringify({ error: status === 403 ? 'No Indago invitation.' : 'Server unavailable.' }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const output = join(directory, 'app.mjs');
    await build({
      stdin: {
        contents: `import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { flushSync } from 'react-dom';
          import { Workspace } from './App.jsx';
          export async function mount(element) {
            const root = createRoot(element);
            flushSync(() => root.render(React.createElement(Workspace)));
            for (let attempt = 0; attempt < 50 && element.querySelector('[aria-busy="true"]'); attempt++) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
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
    const element = document.createElement('div');
    document.body.appendChild(element);
    const root = await mount(element);
    try {
      assert.equal(element.querySelector('h1')?.textContent ?? null, expectedHeading);
      assert.equal(element.querySelector('[role="alert"]')?.textContent ?? null,
        status === 403 ? null : 'Access could not be checked. Reload and try again.');
    } finally {
      unmount(root);
      element.remove();
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
}
