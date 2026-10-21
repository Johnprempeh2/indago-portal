import { handleNorthStar } from './north-star.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function bodyOf(request) {
  const text = await request.text();
  if (text.length > 64_000) throw Object.assign(new Error('Too much data'), { code: 'LIMIT' });
  return JSON.parse(text);
}

export async function handlePortalRequest(request, client, role, route, openAccess = false) {
    if (route.startsWith('north-star')) return openAccess
      ? json({ error: 'North Star requires named sign-in.' }, 403)
      : handleNorthStar(request, client, role, route);
    if (request.method === 'GET' && route === 'membership') return json({ role, openAccess });
    if (request.method === 'GET' && route === 'snapshot') {
      const sheets = await client.query(`SELECT * FROM indago.sheets
        WHERE ($1::boolean = false OR id <> 'north-star-requests') ORDER BY position`, [openAccess]);
      const records = await client.query(`SELECT * FROM indago.records
        WHERE ($1::boolean = false OR sheet_id <> 'north-star-requests') ORDER BY sheet_id, position`, [openAccess]);
      return json({ sheets: sheets.rows, records: records.rows });
    }
    if (request.method === 'GET' && route === 'history') {
      const history = await client.query(`SELECT h.id, h.record_id, h.actor_email, h.changed_at,
        h.before_edits, h.after_edits, h.version FROM indago.history h
        WHERE ($1::boolean = false OR NOT EXISTS
          (SELECT 1 FROM indago.records r WHERE r.id = h.record_id AND r.sheet_id = 'north-star-requests'))
        ORDER BY h.id DESC LIMIT 50`, [openAccess]);
      const files = await client.query(`SELECT h.id, d.record_id, r.source_values->>0 AS work_package_id,
        d.file_name, h.action, h.actor, h.changed_at
        FROM indago.deliverable_history h JOIN indago.deliverables d ON d.id = h.deliverable_id
        JOIN indago.records r ON r.id = d.record_id
        WHERE ($1::boolean = false OR NOT (r.source_values->>8 = 'G2' OR coalesce(r.source_values->>1, '') ILIKE '%north star%' OR
          coalesce(r.source_values->>2, '') ILIKE '%north star%'))
        ORDER BY h.id DESC LIMIT 50`, [openAccess]);
      const northStar = openAccess ? { rows: [] } : await client.query(`SELECT id, field_key, old_value, new_value, actor, changed_at
        FROM indago.north_star_history ORDER BY id DESC LIMIT 50`);
      return json([...history.rows.map(row => ({ ...row, kind: 'record' })),
        ...files.rows.map(row => ({ ...row, kind: 'file' })),
        ...northStar.rows.map(row => ({ ...row, kind: 'north-star' }))]
        .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at)).slice(0, 50));
    }
    if (request.method !== 'POST' || !['save', 'add'].includes(route)) return json({ error: 'Not found.' }, 404);
    if (role !== 'editor') return json({ error: 'Editor invitation required.' }, 403);
    let body;
    try { body = await bodyOf(request); } catch { return json({ error: 'Invalid request.' }, 400); }
    if (route === 'save') {
      const { id, version, edits } = body;
      if (typeof id !== 'string' || !Number.isSafeInteger(version) || version < 1 ||
          !edits || Array.isArray(edits) || typeof edits !== 'object') return json({ error: 'Invalid request.' }, 400);
      const updated = await client.query(`UPDATE indago.records SET edits = $1
        WHERE id = $2 AND version = $3
          AND ($4::boolean = false OR sheet_id <> 'north-star-requests') RETURNING *`, [edits, id, version, openAccess]);
      if (!updated.rows.length) return json({ error: 'This record changed in another browser. Reload before saving.' }, 409);
      return json(updated.rows[0]);
    }
    const { id, sheet_id, position, source_values } = body;
    if (openAccess && sheet_id === 'north-star-requests') return json({ error: 'North Star requires named sign-in.' }, 403);
    if (typeof id !== 'string' || typeof sheet_id !== 'string' ||
        !Number.isSafeInteger(position) || position < 1 || !Array.isArray(source_values) ||
        source_values.some(value => typeof value !== 'string')) return json({ error: 'Invalid request.' }, 400);
    const added = await client.query(`INSERT INTO indago.records(id, sheet_id, position, source_values)
      VALUES($1,$2,$3,$4) RETURNING *`, [id, sheet_id, position, JSON.stringify(source_values)]);
    return json(added.rows[0], 201);
}
