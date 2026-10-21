// Run from an authorised shell with NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN.
// The archive contains confidential files. Keep it outside Git and on encrypted storage.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [mode, directory] = process.argv.slice(2);
if (!['backup', 'restore'].includes(mode) || !directory || !process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_AUTH_TOKEN) {
  throw new Error('Usage: NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/deliverable-archive.mjs backup|restore ABSOLUTE_DIRECTORY');
}
if (!directory.startsWith('/')) throw new Error('Use an absolute directory outside this repository.');
const store = getStore({ name: 'indago-deliverables', siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_AUTH_TOKEN, consistency: 'strong' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validKey = key => /^[a-f0-9-]{36}\/([0-9]|1[0-6])$/.test(key);

if (mode === 'backup') {
  await mkdir(directory, { mode: 0o700 });
  const manifest = [];
  for await (const page of store.list({ paginate: true })) {
    for (const { key } of page.blobs) {
      if (!validKey(key)) throw new Error(`Unexpected blob key: ${key}`);
      const bytes = await store.get(key, { type: 'arrayBuffer' });
      if (!bytes) throw new Error(`Missing blob: ${key}`);
      const data = Buffer.from(bytes);
      await writeFile(join(directory, key.replace('/', '-')), data, { mode: 0o600 });
      manifest.push({ key, size: data.length, sha256: hash(data) });
    }
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`Archived ${manifest.length} chunks. Keep this directory with the matching database snapshot.`);
} else {
  if (process.env.INDAGO_RESTORE_FILES !== '1') throw new Error('Set INDAGO_RESTORE_FILES=1 after approving a restore.');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  for (const item of manifest) {
    if (!validKey(item.key)) throw new Error('Invalid archive key.');
    const data = await readFile(join(directory, item.key.replace('/', '-')));
    if (data.length !== item.size || hash(data) !== item.sha256) throw new Error(`Archive checksum mismatch: ${item.key}`);
    await store.set(item.key, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  console.log(`Restored ${manifest.length} chunks. Verify the matching database snapshot before opening the portal.`);
}
