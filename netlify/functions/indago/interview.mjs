import { challengeFor, makeDraft, MOVES, proposedOutcomes } from '../../../src/indago/model/interview.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function payload(request) {
  const raw = await request.text();
  if (raw.length > 25000) throw new Error('Invalid request.');
  return JSON.parse(raw);
}

async function load(client, id, userId) {
  const session = (await client.query('SELECT * FROM indago.client_interviews WHERE id = $1', [id])).rows[0];
  if (!session) return null;
  const answers = (await client.query(`SELECT id, move, original, created_at FROM indago.client_interview_answers
    WHERE session_id = $1 ORDER BY created_at, id`, [id])).rows;
  const challenges = (await client.query(`SELECT c.id, c.answer_id, c.question, c.reply, c.created_at
    FROM indago.client_interview_challenges c JOIN indago.client_interview_answers a ON a.id = c.answer_id
    WHERE a.session_id = $1 ORDER BY c.created_at, c.id`, [id])).rows;
  return { ...session, canWrite: session.owner_id === userId && session.status === 'in_progress', answers: answers.map(answer => ({ ...answer,
    challenges: challenges.filter(item => item.answer_id === answer.id) })) };
}

export async function handleInterview(request, client, route, userId, facilitator = false, openAccess = false) {
  if (openAccess) return json({ error: 'Invited sign-in is required.' }, 403);
  const parts = route.split('/');
  if (request.method === 'GET' && route === 'interviews') {
    const rows = await client.query(`SELECT id, status, updated_at, record_id, gate FROM indago.client_interviews
      ORDER BY updated_at DESC LIMIT 50`);
    return json({ sessions: rows.rows, facilitator });
  }
  if (request.method === 'POST' && route === 'interviews') {
    let body;
    try { body = await payload(request); } catch { return json({ error: 'Invalid request.' }, 400); }
    if (body?.consent !== true) return json({ error: 'Please confirm the privacy notice before starting.' }, 400);
    const id = crypto.randomUUID();
    await client.query('INSERT INTO indago.client_interviews(id, owner_id, consented_at) VALUES ($1,$2,now())', [id, userId]);
    return json(await load(client, id, userId), 201);
  }
  if (parts[0] !== 'interviews' || parts.length < 2 || !/^[0-9a-f-]{36}$/.test(parts[1])) return json({ error: 'Not found.' }, 404);
  const id = parts[1];
  const session = await load(client, id, userId);
  if (!session) return json({ error: 'Not found.' }, 404);
  if (request.method === 'GET' && parts.length === 2) return json(session);
  if (request.method === 'GET' && parts[2] === 'export' && parts.length === 3) {
    if (!facilitator) return json({ error: 'Facilitator invitation required.' }, 403);
    const text = [`North Star interview | ${session.record_id} | ${session.gate}`, `Status: ${session.status}`, '',
      ...session.answers.flatMap(answer => [
        `${MOVES.find(move => move.id === answer.move)?.title || answer.move} [${answer.id}]`,
        `Client statement: ${answer.original}`,
        ...answer.challenges.flatMap(challenge => [`Challenge: ${challenge.question}`, `Separate reply: ${challenge.reply || '(skipped)'}`]), '',
      ]), `Corrected summary: ${session.corrected_summary || '(not submitted)'}`, '',
      `Structured draft: ${JSON.stringify(session.draft, null, 2)}`].join('\n');
    return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="north-star-${id}.txt"`, 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST' || parts.length !== 3 || !['answers', 'challenges', 'replies', 'submit'].includes(parts[2])) return json({ error: 'Not found.' }, 404);
  if (session.owner_id !== userId || session.status !== 'in_progress') return json({ error: 'This session is read only.' }, 403);
  let body;
  try { body = await payload(request); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
  if (parts[2] === 'answers') {
    if (!MOVES.some(move => move.id === body.move) || typeof body.original !== 'string' ||
        !body.original.trim() || body.original.length > 20000) return json({ error: 'Invalid answer.' }, 400);
    if (body.move === 'convergence') {
      try { proposedOutcomes(body.original); } catch (error) { return json({ error: error.message }, 400); }
    }
    if (session.answers.some(answer => answer.move === body.move)) return json({ error: 'Original answer is already recorded.' }, 409);
    await client.query(`INSERT INTO indago.client_interview_answers(id, session_id, move, original)
      VALUES ($1,$2,$3,$4)`, [crypto.randomUUID(), id, body.move, body.original]);
  } else if (parts[2] === 'challenges') {
    const answer = session.answers.find(item => item.id === body.answerId);
    if (!answer) return json({ error: 'Answer not found.' }, 404);
    if (answer.challenges.some(item => !item.reply)) return json({ error: 'Reply to or skip the open challenge first.' }, 409);
    const question = challengeFor(answer.move, answer.original, session.answers.filter(item => item.id !== answer.id), answer.challenges.length);
    await client.query(`INSERT INTO indago.client_interview_challenges(id, answer_id, question)
      VALUES ($1,$2,$3)`, [crypto.randomUUID(), answer.id, question]);
  } else if (parts[2] === 'replies') {
    if (typeof body.reply !== 'string' || body.reply.length > 20000) return json({ error: 'Invalid reply.' }, 400);
    const result = await client.query(`UPDATE indago.client_interview_challenges SET reply = $1 WHERE id = $2 AND reply = ''
      AND answer_id IN (SELECT id FROM indago.client_interview_answers WHERE session_id = $3) RETURNING id`,
      [body.reply || 'Skipped by participant', body.challengeId, id]);
    if (!result.rows.length) return json({ error: 'Challenge not found or already answered.' }, 409);
  } else {
    if (typeof body.correctedSummary !== 'string' || !body.correctedSummary.trim() || body.correctedSummary.length > 20000) return json({ error: 'Review your summary first.' }, 400);
    let draft;
    try { draft = makeDraft(session.answers, body.correctedSummary); } catch (error) { return json({ error: error.message }, 400); }
    await client.query(`UPDATE indago.client_interviews SET corrected_summary = $1, draft = $2, status = 'submitted', updated_at = now()
      WHERE id = $3`, [body.correctedSummary, JSON.stringify(draft), id]);
  }
  return json(await load(client, id, userId));
}
