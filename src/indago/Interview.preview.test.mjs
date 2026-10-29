import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('synthetic preview resumes from browser storage without network access', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'indago-interview-preview-'));
  try {
    const output = join(directory, 'interview.mjs');
    await build({ entryPoints: [new URL('./Interview.jsx', import.meta.url).pathname], bundle: true,
      format: 'esm', platform: 'browser', outfile: output, loader: { '.jsx': 'jsx', '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
    const { makePreviewInterviewApi } = await import(pathToFileURL(output).href);
    const values = new Map();
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    const first = makePreviewInterviewApi(storage);
    const session = await first.create();
    await first.answer(session.id, 'ambition', 'Exact synthetic first words');
    const resumed = await makePreviewInterviewApi(storage).get(session.id);
    assert.equal(resumed.answers[0].original, 'Exact synthetic first words');
    assert.equal(resumed.status, 'in_progress');
    assert.equal((await makePreviewInterviewApi(storage).list()).sessions.length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
