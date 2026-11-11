// Facilitator review of Deep Dive MCP drafts (GRE-4341). Agents write drafts; only a named facilitator
// approves or rejects one here. Approving a proposed row adds it to its sheet as that facilitator.
const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function handleAgentDrafts(request, client, route, { role, facilitator, openAccess, userId }) {
  if (openAccess || !facilitator) return json({ error: 'Facilitator invitation required.' }, 403);
  const parts = route.split('/');
  if (request.method === 'GET' && route === 'agent-drafts') {
    const rows = await client.query(`SELECT id, kind, title, status, version, updated_at, reviewed_at
      FROM indago.mcp_drafts ORDER BY (status = 'draft') DESC, updated_at DESC LIMIT 200`);
    return json({ drafts: rows.rows });
  }
  if (parts.length < 2 || !/^[0-9a-f-]{36}$/.test(parts[1])) return json({ error: 'Not found.' }, 404);
  const draft = (await client.query('SELECT * FROM indago.mcp_drafts WHERE id = $1', [parts[1]])).rows[0];
  if (!draft) return json({ error: 'Not found.' }, 404);
  if (request.method === 'GET' && parts.length === 2) return json(draft);
  if (request.method !== 'POST' || parts[2] !== 'decision' || parts.length !== 3) return json({ error: 'Not found.' }, 404);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 5000) throw new Error('too long');
    body = JSON.parse(raw);
  } catch { return json({ error: 'Invalid request.' }, 400); }
  const { decision, version, note = '' } = body || {};
  if (!['approve', 'reject'].includes(decision) || !Number.isSafeInteger(version) ||
      typeof note !== 'string' || note.length > 2000) return json({ error: 'Invalid request.' }, 400);
  if (draft.status !== 'draft' || draft.version !== version) return json({ error: 'This draft changed or was already decided. Reload it.' }, 409);
  let recordId = null;
  if (decision === 'approve' && draft.kind === 'record') {
    if (role !== 'editor') return json({ error: 'Editor invitation required.' }, 403);
    const sheet = (await client.query('SELECT id, columns FROM indago.sheets WHERE id = $1', [draft.payload.sheet_id])).rows[0];
    if (!sheet) return json({ error: 'The sheet for this row no longer exists.' }, 409);
    const values = draft.payload.values || {};
    const unknown = Object.keys(values).filter((k) => !sheet.columns.includes(k));
    if (unknown.length) return json({ error: `These columns are not in the sheet: ${unknown.join(', ')}. Reject it and ask the agent to fix it.` }, 409);
    const position = (await client.query('SELECT coalesce(max(position), 0) + 1 AS p FROM indago.records WHERE sheet_id = $1', [sheet.id])).rows[0].p;
    recordId = `mcp-${draft.id}`;
    await client.query(`INSERT INTO indago.records(id, sheet_id, position, source_values) VALUES ($1,$2,$3,$4)`,
      [recordId, sheet.id, position, JSON.stringify(sheet.columns.map((c) => String(values[c] ?? '')))]);
  }
  const updated = await client.query(`UPDATE indago.mcp_drafts SET status = $1, reviewed_by = $2, reviewed_at = now(),
      review_note = $3, record_id = $4 WHERE id = $5 AND status = 'draft' AND version = $6 RETURNING *`,
    [decision === 'approve' ? 'approved' : 'rejected', userId, note, recordId, draft.id, version]);
  if (!updated.rows.length) return json({ error: 'This draft changed or was already decided. Reload it.' }, 409);
  return json(updated.rows[0]);
}
