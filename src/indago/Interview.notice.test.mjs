import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('a guided session notice never says an AI service runs the interview', async () => {
  // Output sits inside the repo so the external react packages resolve from node_modules.
  const cache = new URL('../../node_modules/.cache/', import.meta.url).pathname;
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, 'indago-interview-notice-'));
  try {
    const output = join(directory, 'notice.mjs');
    await build({ stdin: { contents: "import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { NoticeList } from './Interview.jsx'; export const render = ai => renderToStaticMarkup(React.createElement(NoticeList, { ai }));", resolveDir: new URL('.', import.meta.url).pathname, loader: 'jsx' },
      bundle: true, packages: 'external', format: 'esm', platform: 'node', outfile: output, loader: { '.jsx': 'jsx', '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
    const { render } = await import(pathToFileURL(output).href);
    const guided = render(false);
    assert.match(guided, /No AI service is used/);
    assert.doesNotMatch(guided, /AI service helps|Claude|Anthropic|AI writes/);
    assert.match(guided, /stored in the Indago portal/);
    assert.match(guided, /request to delete your answers/);
    const ai = render(true);
    assert.match(ai, /An AI service helps run this conversation/);
    assert.match(ai, /same topics/);
    assert.doesNotMatch(ai, /moves/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
