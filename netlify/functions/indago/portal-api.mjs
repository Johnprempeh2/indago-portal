const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function bodyOf(request) {
  const text = await request.text();
  if (text.length > 64_000) throw Object.assign(new Error('Too much data'), { code: 'LIMIT' });
  return JSON.parse(text);
}

export async function handlePortalRequest(request, client, role, route) {
    if (request.method === 'GET' && route === 'membership') return json({ role });
    if (request.method === 'GET' && route === 'snapshot') {
      const sheets = await client.query('SELECT * FROM indago.sheets ORDER BY position');
      const records = await client.query('SELECT * FROM indago.records ORDER BY sheet_id, position');
      return json({ sheets: sheets.rows, records: records.rows });
    }
    if (request.method === 'GET' && route === 'history') {
      const history = await client.query(`SELECT id, record_id, actor_email, changed_at,
        before_edits, after_edits, version FROM indago.history ORDER BY id DESC LIMIT 50`);
      return json(history.rows);
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
        WHERE id = $2 AND version = $3 RETURNING *`, [edits, id, version]);
      if (!updated.rows.length) return json({ error: 'This record changed in another browser. Reload before saving.' }, 409);
      return json(updated.rows[0]);
    }
    const { id, sheet_id, position, source_values } = body;
    if (typeof id !== 'string' || typeof sheet_id !== 'string' ||
        !Number.isSafeInteger(position) || position < 1 || !Array.isArray(source_values) ||
        source_values.some(value => typeof value !== 'string')) return json({ error: 'Invalid request.' }, 400);
    const added = await client.query(`INSERT INTO indago.records(id, sheet_id, position, source_values)
      VALUES($1,$2,$3,$4) RETURNING *`, [id, sheet_id, position, JSON.stringify(source_values)]);
    return json(added.rows[0], 201);
}
