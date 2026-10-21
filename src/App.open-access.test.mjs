import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('anonymous visitor sees the portal when open and sign-in when closed', async () => {
  const window = new Window({ url: 'https://example.test/portal/indago' });
  const directory = mkdtempSync(join(tmpdir(), 'indago-open-access-'));
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
          import App from './App.jsx';
          export function mount(element) {
            const root = createRoot(element);
            flushSync(() => root.render(React.createElement(App)));
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
          contents: 'export const authClient = { useSession() { return { data: null, isPending: false }; }, signOut() {} };', loader: 'js',
        }));
      } }],
    });
    const { mount, unmount } = await import(pathToFileURL(output).href);
    for (const openAccess of [true, false]) {
      globalThis.fetch = async url => {
        if (url.includes('/membership')) return new Response(JSON.stringify({ role: 'editor', openAccess }), {
          status: openAccess ? 200 : 401, headers: { 'Content-Type': 'application/json' },
        });
        if (url.includes('/snapshot')) return Response.json({ sheets: [], records: [] });
        return new Response(null, { status: 404 });
      };
      const element = document.createElement('div');
      document.body.appendChild(element);
      const root = mount(element);
      try {
        for (let attempt = 0; attempt < 50 && element.textContent.includes('Checking access'); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(Boolean(element.querySelector('input[type="email"]')), !openAccess);
        if (openAccess) assert.doesNotMatch(element.textContent, /Sign in with the email address/);
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
