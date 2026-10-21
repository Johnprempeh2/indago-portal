import { createHash, randomUUID } from 'node:crypto';

export const CHUNK_SIZE = 3 * 1024 * 1024;
export const MAX_SIZE = 50 * 1024 * 1024;
const TYPES = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', zip: 'application/zip',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const key = (id, n) => `${id}/${n}`;
const validId = id => /^[a-f0-9-]{36}$/.test(id);

function validName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 180 &&
    !/[\\/\x00-\x1f\x7f<>:"|?*\u202a-\u202e\u2066-\u2069]/.test(name) && name.trim() === name &&
    Object.hasOwn(TYPES, name.split('.').at(-1).toLowerCase());
}

function validSignature(bytes, extension) {
  const starts = (...sig) => sig.every((b, i) => bytes[i] === b);
  if (extension === 'pdf') return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
  if (['docx', 'xlsx', 'pptx', 'zip'].includes(extension)) return starts(0x50, 0x4b, 0x03, 0x04);
  if (extension === 'png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (['jpg', 'jpeg'].includes(extension)) return starts(0xff, 0xd8, 0xff);
  if (extension === 'gif') return starts(0x47, 0x49, 0x46, 0x38);
  if (extension === 'webp') return starts(0x52, 0x49, 0x46, 0x46) &&
    [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[i + 8] === b);
  if (extension === 'csv') {
    return true;
  }
  return false;
}

export async function handleDeliverables(request, client, role, route, store, openAccess = false) {
  if (request.method === 'GET' && route === 'deliverables') {
    const result = await client.query(`SELECT d.id, d.record_id, r.source_values->>0 AS work_package_id,
      d.file_name, d.file_type, d.byte_size, d.chunk_count, d.sha256, d.uploaded_by, d.uploaded_at
      FROM indago.deliverables d JOIN indago.records r ON r.id = d.record_id
      WHERE d.status = 'active' AND ($1::boolean = false OR NOT
        (r.source_values->>8 = 'G2' OR coalesce(r.source_values->>1, '') ILIKE '%north star%' OR
         coalesce(r.source_values->>2, '') ILIKE '%north star%'))
      ORDER BY d.uploaded_at DESC`, [openAccess]);
    return json(result.rows);
  }
  const match = /^deliverables\/([a-f0-9-]{36})\/(chunk\/(\d+)|finish|remove|download\/(\d+))$/.exec(route);
  if (request.method === 'POST' && route === 'deliverables/init') {
    if (role !== 'editor') return json({ error: 'Editor invitation required.' }, 403);
    let input;
    try { input = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    const { recordId, name, size, sha256 } = input || {};
    if (!validName(name) || !Number.isSafeInteger(size) || size < 1 || size > MAX_SIZE ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || typeof recordId !== 'string') {
      return json({ error: `Choose a PDF, DOCX, XLSX, CSV, PPTX, image or ZIP under 50 MB.` }, 400);
    }
    const record = await client.query(`SELECT r.id FROM indago.records r JOIN indago.sheets s ON s.id = r.sheet_id
      WHERE r.source_values->>0 = $1 AND s.title = 'Work Breakdown' AND
        ($2::boolean = false OR NOT (r.source_values->>8 = 'G2' OR coalesce(r.source_values->>1, '') ILIKE '%north star%' OR
         coalesce(r.source_values->>2, '') ILIKE '%north star%'))`, [recordId, openAccess]);
    if (!record.rows.length) return json({ error: 'Work package not found.' }, 404);
    const id = randomUUID();
    const ext = name.split('.').at(-1).toLowerCase();
    await client.query(`INSERT INTO indago.deliverables
      (id, record_id, file_name, file_type, byte_size, chunk_count, sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, record.rows[0].id, name, TYPES[ext], size, Math.ceil(size / CHUNK_SIZE), sha256]);
    return json({ id, chunkSize: CHUNK_SIZE }, 201);
  }
  if (!match || !validId(match[1])) return json({ error: 'Not found.' }, 404);
  const id = match[1];
  const result = await client.query(`SELECT d.*,
    (r.source_values->>8 = 'G2' OR coalesce(r.source_values->>1, '') ILIKE '%north star%' OR
     coalesce(r.source_values->>2, '') ILIKE '%north star%') AS north_star_work
    FROM indago.deliverables d JOIN indago.records r ON r.id = d.record_id WHERE d.id = $1`, [id]);
  const file = result.rows[0];
  if (!file) return json({ error: 'File not found.' }, 404);
  if (openAccess && file.north_star_work) return json({ error: 'North Star requires named sign-in.' }, 403);

  if (request.method === 'GET' && match[4] !== undefined) {
    if (file.status !== 'active') return json({ error: 'File not found.' }, 404);
    const n = Number(match[4]);
    if (!Number.isSafeInteger(n) || n >= file.chunk_count) return json({ error: 'Chunk not found.' }, 404);
    const bytes = await store.get(key(id, n), { type: 'arrayBuffer' });
    if (!bytes) return json({ error: 'File data is unavailable. Contact the portal administrator.' }, 503);
    return new Response(bytes, { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  }
  if (role !== 'editor') return json({ error: 'Editor invitation required.' }, 403);
  if (request.method === 'POST' && match[2] === 'remove') {
    if (file.status !== 'active') return json({ error: 'File not found.' }, 404);
    await client.query(`UPDATE indago.deliverables SET status = 'deleted' WHERE id = $1 AND status = 'active'`, [id]);
    return json({ ok: true });
  }
  if (file.status !== 'uploading') return json({ error: 'Upload is no longer open.' }, 409);
  if (request.method === 'POST' && match[3] !== undefined) {
    const n = Number(match[3]);
    const expected = Math.min(CHUNK_SIZE, file.byte_size - n * CHUNK_SIZE);
    if (!Number.isSafeInteger(n) || n < 0 || n >= file.chunk_count ||
        Number(request.headers.get('content-length')) > CHUNK_SIZE) return json({ error: 'Invalid chunk.' }, 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength !== expected) return json({ error: 'Invalid chunk size.' }, 400);
    await store.set(key(id, n), bytes);
    return json({ ok: true });
  }
  if (request.method === 'POST' && match[2] === 'finish') {
    const hash = createHash('sha256');
    let first;
    const isCsv = file.file_name.toLowerCase().endsWith('.csv');
    const decoder = isCsv ? new TextDecoder('utf-8', { fatal: true }) : null;
    for (let n = 0; n < file.chunk_count; n++) {
      const bytes = await store.get(key(id, n), { type: 'arrayBuffer' });
      const expected = Math.min(CHUNK_SIZE, file.byte_size - n * CHUNK_SIZE);
      if (!bytes || bytes.byteLength !== expected) return json({ error: 'Upload incomplete. Retry the missing file.' }, 409);
      if (n === 0) first = new Uint8Array(bytes);
      hash.update(new Uint8Array(bytes));
      if (isCsv) {
        if (new Uint8Array(bytes).includes(0)) return json({ error: 'CSV file contains binary data.' }, 400);
        try { decoder.decode(bytes, { stream: true }); }
        catch { return json({ error: 'CSV file must use UTF-8 text.' }, 400); }
      }
    }
    if (isCsv) {
      try { decoder.decode(); } catch { return json({ error: 'CSV file must use UTF-8 text.' }, 400); }
    }
    if (hash.digest('hex') !== file.sha256 || !validSignature(first, file.file_name.split('.').at(-1).toLowerCase())) {
      return json({ error: 'File content does not match its name or upload. Choose another file.' }, 400);
    }
    await client.query(`UPDATE indago.deliverables SET status = 'active' WHERE id = $1 AND status = 'uploading'`, [id]);
    return json({ ok: true });
  }
  return json({ error: 'Not found.' }, 404);
}
