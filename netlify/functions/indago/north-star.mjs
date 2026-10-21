const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export const RECORD_ID = 'IND-NS-001';
const FIELD_KEY = /^(baseline\.[0-6]\.(status|outcome)|show\.[0-6]\.notes|show\.clock|question\.(?:[0-9]|1[0-9]|2[0-5])\.(asked|verbatim|interpretation|followup)|future\.[0-2]\.(excites|value|plausible|combination)|draft\.(horizon|identity|market|outcome|advantage|measures|principles|verbatim|challenge|agreed)|dimension\.[0-7]\.(baseline|verified|target|evidence)|boundary\.[0-6]\.(decision|note)|convergence\.[0-6]\.(answer|note)|hypothesis\.NS-H-[0-9]{2,4}\.(created|fact|evidence|owner|due|link|request)|approval\.(status|version|date|confirmationName|confirmationDate|confirmationText|otherDecisionMaker|facilitator|reviewer|questions|exceptions))$/;

async function bodyOf(request) {
  const text = await request.text();
  if (text.length > 24000) throw new Error('Too much data');
  return JSON.parse(text);
}

export async function handleNorthStar(request, client, role, route) {
  if (request.method === 'GET' && route === 'north-star') {
    const [template, fields] = await Promise.all([
      client.query('SELECT content FROM indago.north_star_template WHERE id = $1', [RECORD_ID]),
      client.query('SELECT field_key, value, version, changed_by, changed_at FROM indago.north_star_fields WHERE record_id = $1', [RECORD_ID]),
    ]);
    if (!template.rows.length) return json({ error: 'North Star template is missing.' }, 503);
    return json({ template: template.rows[0].content, fields: fields.rows });
  }
  if (request.method === 'GET' && route === 'north-star/history') {
    const result = await client.query(`SELECT id, field_key, old_value, new_value, version, actor, changed_at
      FROM indago.north_star_history WHERE record_id = $1 ORDER BY id DESC LIMIT 200`, [RECORD_ID]);
    return json(result.rows);
  }
  if (request.method !== 'POST' || !['north-star/field', 'north-star/hypothesis', 'north-star/send'].includes(route)) {
    return json({ error: 'Not found.' }, 404);
  }
  if (role !== 'editor') return json({ error: 'Editor invitation required.' }, 403);
  let body;
  try { body = await bodyOf(request); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (route === 'north-star/field') {
    const { key, value } = body;
    if (typeof key !== 'string' || !FIELD_KEY.test(key) || typeof value !== 'string' || value.length > 20000) {
      return json({ error: 'Invalid field.' }, 400);
    }
    if (key === 'approval.status' && !['Draft', 'Confirmed in session', 'Approved', 'Approved with exceptions'].includes(value)) {
      return json({ error: 'Invalid approval status.' }, 400);
    }
    if (key === 'approval.status' && value.startsWith('Approved')) {
      const accepted = await client.query(`SELECT value FROM indago.north_star_fields
        WHERE record_id = $1 AND field_key = 'convergence.6.answer'`, [RECORD_ID]);
      if (accepted.rows[0]?.value !== 'Yes') return json({ error: 'Record Gordon acceptance as Yes before approval.' }, 409);
    }
    const result = await client.query(`INSERT INTO indago.north_star_fields(record_id, field_key, value)
      VALUES ($1, $2, $3) ON CONFLICT(record_id, field_key) DO UPDATE SET value = EXCLUDED.value
      RETURNING field_key, value, version, changed_by, changed_at`, [RECORD_ID, key, value]);
    return json(result.rows[0]);
  }
  if (route === 'north-star/hypothesis') {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('IND-NS-001-hypothesis'))");
    const result = await client.query(`SELECT field_key FROM indago.north_star_fields
      WHERE record_id = $1 AND field_key LIKE 'hypothesis.NS-H-%'`, [RECORD_ID]);
    const numbers = result.rows.map(row => Number(row.field_key.match(/^hypothesis\.NS-H-(\d+)\./)?.[1] || 0));
    const next = Math.max(6, ...numbers) + 1;
    const id = `NS-H-${String(next).padStart(2, '0')}`;
    await client.query(`INSERT INTO indago.north_star_fields(record_id, field_key, value)
      VALUES ($1, $2, '')`, [RECORD_ID, `hypothesis.${id}.created`]);
    return json({ id }, 201);
  }
  const id = body?.id;
  if (typeof id !== 'string' || !/^NS-H-[0-9]{2,4}$/.test(id)) return json({ error: 'Invalid hypothesis.' }, 400);
  const keys = ['fact', 'evidence', 'owner', 'due', 'link'];
  const result = await client.query(`SELECT field_key, value FROM indago.north_star_fields
    WHERE record_id = $1 AND field_key LIKE $2`, [RECORD_ID, `hypothesis.${id}.%`]);
  const fields = Object.fromEntries(result.rows.map(row => [row.field_key.split('.').at(-1), row.value]));
  if (!fields.evidence?.trim()) return json({ error: 'Add evidence required before sending this request.' }, 400);
  if (!keys.some(key => fields[key])) return json({ error: 'Hypothesis is empty.' }, 400);
  const already = await client.query(`SELECT value FROM indago.north_star_fields
    WHERE record_id = $1 AND field_key = $2`, [RECORD_ID, `hypothesis.${id}.request`]);
  if (already.rows[0]?.value) return json({ error: 'This request was already sent.' }, 409);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('north-star-requests'))");
  const position = (await client.query(`SELECT coalesce(max(position),0)+1 AS next
    FROM indago.records WHERE sheet_id = 'north-star-requests'`)).rows[0].next;
  const requestId = `IND-NS-RQ-${String(position).padStart(3, '0')}`;
  const values = [requestId, id, fields.evidence, fields.owner || '', fields.due || '', fields.link || '', RECORD_ID];
  await client.query(`INSERT INTO indago.records(id, sheet_id, position, source_values)
    VALUES ($1, 'north-star-requests', $2, $3)`, [`north-star-requests:${position}`, position, JSON.stringify(values)]);
  await client.query(`INSERT INTO indago.north_star_fields(record_id, field_key, value)
    VALUES ($1, $2, $3)`, [RECORD_ID, `hypothesis.${id}.request`, requestId]);
  return json({ requestId }, 201);
}
