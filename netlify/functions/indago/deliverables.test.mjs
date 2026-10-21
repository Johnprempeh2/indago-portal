import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CHUNK_SIZE, MAX_SIZE, handleDeliverables } from './deliverables.mjs';

const id = 'f33f1e68-3637-4b8f-b56d-263e78d87fce';
const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 72, 105]);
const sha = data => createHash('sha256').update(data).digest('hex');
const req = (path, method = 'GET', body) => new Request(`https://example.test/api/indago/${path}`, {
  method, ...(body === undefined ? {} : { body }),
});
function fixture(bytes = pdf, name = 'Demo.pdf') {
  const map = new Map();
  const file = { id, record_id: 'plan:1', north_star_work: false, file_name: name, file_type: 'application/pdf',
    byte_size: bytes.length, chunk_count: Math.ceil(bytes.length / CHUNK_SIZE), sha256: sha(bytes), status: 'uploading' };
  const queries = [];
  const client = { async query(sql, values) {
    queries.push([sql, values]);
    if (sql.includes('SELECT r.id')) return { rows: [{ id: 'plan:1' }] };
    if (sql.includes('WHERE d.id = $1')) return { rows: [file] };
    if (sql.includes('SET status')) { file.status = /SET status = 'active'/.test(sql) ? 'active' : 'deleted'; return { rows: [] }; }
    return { rows: [] };
  } };
  const store = { async set(key, value) { map.set(key, value); }, async get(key) { return map.get(key) ?? null; } };
  return { file, client, store, map, queries };
}

test('upload validates size and name before creating metadata', async () => {
  const { client, store, queries } = fixture();
  const upload = input => handleDeliverables(req('deliverables/init', 'POST', JSON.stringify(input)), client, 'editor', 'deliverables/init', store);
  assert.equal((await upload({ recordId: '1.01', name: '../bad.pdf', size: 11, sha256: sha(pdf) })).status, 400);
  assert.equal((await upload({ recordId: '1.01', name: '<script>.pdf', size: 11, sha256: sha(pdf) })).status, 400);
  assert.equal((await upload({ recordId: '1.01', name: 'Demo.pdf', size: MAX_SIZE + 1, sha256: sha(pdf) })).status, 400);
  assert.equal(queries.length, 0);
  assert.equal((await upload({ recordId: '1.01', name: 'Demo.pdf', size: 11, sha256: sha(pdf) })).status, 201);
  assert.equal(queries.at(-1)[1][1], 'plan:1');
});

test('a viewer can download an active chunk and cannot upload or remove', async () => {
  const { client, store, map, file } = fixture();
  file.status = 'active'; map.set(`${id}/0`, pdf.buffer);
  const path = `deliverables/${id}`;
  const download = await handleDeliverables(req(`${path}/download/0`), client, 'viewer', `${path}/download/0`, store);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), pdf);
  assert.equal(download.headers.get('Content-Disposition'), 'attachment');
  assert.equal((await handleDeliverables(req(`${path}/remove`, 'POST'), client, 'viewer', `${path}/remove`, store)).status, 403);
  assert.equal((await handleDeliverables(req('deliverables/init', 'POST'), client, 'viewer', 'deliverables/init', store)).status, 403);
});

test('open access cannot download a signed North Star work-package file', async () => {
  const { client, store, file, map } = fixture();
  file.status = 'active'; file.north_star_work = true; map.set(`${id}/0`, pdf.buffer);
  const path = `deliverables/${id}/download/0`;
  const response = await handleDeliverables(req(path), client, 'editor', path, store, true);
  assert.equal(response.status, 403);
});

test('finish accepts byte-identical chunks, rejects a changed file, and removal changes status', async () => {
  const { client, store, file, map } = fixture();
  const path = `deliverables/${id}`;
  const chunk = await handleDeliverables(req(`${path}/chunk/0`, 'POST', pdf), client, 'editor', `${path}/chunk/0`, store);
  assert.equal(chunk.status, 200);
  assert.deepEqual(new Uint8Array(map.get(`${id}/0`)), pdf);
  const finish = await handleDeliverables(req(`${path}/finish`, 'POST'), client, 'editor', `${path}/finish`, store);
  assert.equal(finish.status, 200);
  assert.equal(file.status, 'active');
  const remove = await handleDeliverables(req(`${path}/remove`, 'POST'), client, 'editor', `${path}/remove`, store);
  assert.equal(remove.status, 200);
  assert.equal(file.status, 'deleted');
  assert.equal((await handleDeliverables(req(`${path}/download/0`), client, 'viewer', `${path}/download/0`, store)).status, 404);
  file.status = 'uploading'; map.set(`${id}/0`, new TextEncoder().encode('not a PDF').buffer);
  assert.equal((await handleDeliverables(req(`${path}/finish`, 'POST'), client, 'editor', `${path}/finish`, store)).status, 409);
});

test('upload rejects a chunk whose bytes exceed the declared size', async () => {
  const { client, store } = fixture();
  const path = `deliverables/${id}/chunk/0`;
  assert.equal((await handleDeliverables(req(path, 'POST', new Uint8Array(pdf.length + 1)), client, 'editor', path, store)).status, 400);
});

test('finish rejects script-like data renamed as PDF', async () => {
  const bytes = new TextEncoder().encode('<script>hi!');
  const { client, store } = fixture(bytes, 'Demo.pdf');
  await store.set(`${id}/0`, bytes.buffer);
  const path = `deliverables/${id}/finish`;
  assert.equal((await handleDeliverables(req(path, 'POST'), client, 'editor', path, store)).status, 400);
});

test('a multi-chunk CSV above 1 MB survives upload and download byte for byte', async () => {
  const csv = new TextEncoder().encode('id,note\n' + '1,invented\n'.repeat(350000));
  assert.ok(csv.byteLength > CHUNK_SIZE);
  const { client, store, file } = fixture(csv, 'Demo.csv');
  const base = `deliverables/${id}`;
  for (let n = 0; n < file.chunk_count; n++) {
    const path = `${base}/chunk/${n}`;
    const bytes = csv.slice(n * CHUNK_SIZE, Math.min((n + 1) * CHUNK_SIZE, csv.length));
    assert.equal((await handleDeliverables(req(path, 'POST', bytes), client, 'editor', path, store)).status, 200);
  }
  assert.equal((await handleDeliverables(req(`${base}/finish`, 'POST'), client, 'editor', `${base}/finish`, store)).status, 200);
  assert.equal(file.status, 'active');
  const parts = [];
  for (let n = 0; n < file.chunk_count; n++) {
    const path = `${base}/download/${n}`;
    const download = await handleDeliverables(req(path), client, 'viewer', path, store);
    parts.push(Buffer.from(await download.arrayBuffer()));
  }
  assert.deepEqual(Buffer.concat(parts), Buffer.from(csv));
});
