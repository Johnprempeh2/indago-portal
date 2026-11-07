import { acceptAiTurn, challengeFor, guidedTurn, makeAiDraft, makeDraft, MAX_QUESTIONS_PER_MOVE, moveAnswers, MOVES, needsSourceCheck, proposedOutcomes, sourceCheckTurn } from '../../../src/indago/model/interview.mjs';
import { aiConfigured, aiFallbackReason, aiJsonText, askClaude, escapeParticipant, interviewTranscript, logAiFallback, parseAiJson, singleQuestion } from './claude.mjs';

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
  const answers = (await client.query(`SELECT id, move, original, question, asked_by, ai_reason, ai_covered, source_check, created_at
    FROM indago.client_interview_answers WHERE session_id = $1 ORDER BY created_at, id`, [id])).rows;
  const challenges = (await client.query(`SELECT c.id, c.answer_id, c.question, c.reply, c.created_at
    FROM indago.client_interview_challenges c JOIN indago.client_interview_answers a ON a.id = c.answer_id
    WHERE a.session_id = $1 ORDER BY c.created_at, c.id`, [id])).rows;
  const withChallenges = answers.map(answer => ({ ...answer, challenges: challenges.filter(item => item.answer_id === answer.id) }));
  // The question waiting for an answer: the AI's stored turn, or else the guided turn.
  const turn = session.status !== 'in_progress' ? null : session.next_turn?.move ? session.next_turn : guidedTurn(withChallenges, session.next_turn?.covered);
  return { ...session, turn, canWrite: session.owner_id === userId && session.status === 'in_progress', answers: withChallenges };
}

const askedQuestions = answers => answers.flatMap(answer => [answer.question, ...answer.challenges.map(item => item.question)]).filter(Boolean)
  .map((question, index) => `${index + 1}. ${question}`).join('\n') || 'none';

// Asks the AI for the next turn after `answers` (the last one just saved). Returns the turn to store, or null to use the guided turn.
async function nextAiTurn(ask, answers) {
  const current = answers.at(-1).move;
  const covered = [...new Set(answers.flatMap(answer => answer.ai_covered || []))];
  const text = await ask({ system: process.env.INDAGO_AI_QUESTION_PROMPT, input: [
    `Moves already covered: ${covered.join(', ') || 'none'}`,
    `Moves with answers: ${[...new Set(answers.map(answer => answer.move))].join(', ')}`,
    `Current move: ${current} (${moveAnswers(answers, current).length} of at most ${MAX_QUESTIONS_PER_MOVE} questions asked). Ask a follow-up in this move, or choose a move not yet covered.`,
    'Earlier source statements: the portal shows them to the participant when you leave the ambition move. Do not list them yourself.',
    `Questions already asked, in order:\n${askedQuestions(answers)}`, '',
    `Transcript:\n${interviewTranscript(answers)}`, '', 'Ask the next single question.'].join('\n') });
  if (!text) return null;
  const raw = parseAiJson(text);
  const result = acceptAiTurn(raw, answers, current);
  // NS-01 move 1: the earlier source statements come after the participant's own ambition, before any other move.
  if (needsSourceCheck(answers) && (result.complete || result.move !== 'ambition')) return { ...sourceCheckTurn('AI'), covered: result.covered };
  if (result.complete) return { covered: result.covered, reason: result.reason };
  const question = singleQuestion(raw.question, answers.map(answer => answer.original).join('\n'), result.move === 'boundaries');
  return { move: result.move, question, askedBy: 'AI', reason: result.reason, covered: result.covered };
}

export async function handleInterview(request, client, route, userId, facilitator = false, openAccess = false, ask = askClaude, aiAvailable = aiConfigured()) {
  if (openAccess) return json({ error: 'Invited sign-in is required.' }, 403);
  const parts = route.split('/');
  if (request.method === 'GET' && route === 'interviews') {
    const rows = await client.query(`SELECT id, status, updated_at, record_id, gate FROM indago.client_interviews
      ORDER BY updated_at DESC LIMIT 50`);
    return json({ sessions: rows.rows, facilitator, aiAvailable });
  }
  if (request.method === 'POST' && route === 'interviews') {
    let body;
    try { body = await payload(request); } catch { return json({ error: 'Invalid request.' }, 400); }
    if (body?.consent !== true) return json({ error: 'Please confirm the privacy notice before starting.' }, 400);
    const id = crypto.randomUUID();
    // "Continue without AI" is the participant's consent choice: that session never calls the AI service.
    await client.query('INSERT INTO indago.client_interviews(id, owner_id, consented_at, ai_assisted) VALUES ($1,$2,now(),$3)',
      [id, userId, body.ai === true && aiAvailable]);
    return json(await load(client, id, userId), 201);
  }
  if (parts[0] !== 'interviews' || parts.length < 2 || !/^[0-9a-f-]{36}$/.test(parts[1])) return json({ error: 'Not found.' }, 404);
  const id = parts[1];
  const session = await load(client, id, userId);
  if (!session) return json({ error: 'Not found.' }, 404);
  if (request.method === 'GET' && parts.length === 2) return json(session);
  if (request.method === 'GET' && parts[2] === 'export' && parts.length === 3) {
    if (!facilitator) return json({ error: 'Facilitator invitation required.' }, 403);
    const text = [`North Star interview | ${session.record_id} | ${session.gate}`, `Status: ${session.status}`,
      `Processing: ${session.ai_assisted ? `AI-assisted (Claude, Anthropic); AI draft ${session.ai_draft || 'not started'}` : 'guided, no AI'}`, '',
      ...session.answers.flatMap(answer => [
        `${MOVES.find(move => move.id === answer.move)?.title || answer.move} [${answer.id}]`,
        `Question (${answer.asked_by === 'AI' ? 'AI' : 'guided'}${answer.source_check ? ', earlier source statements to confirm or correct' : ''}): ${answer.question || '(not recorded)'}`,
        ...(answer.asked_by === 'AI' ? [`AI reason: ${answer.ai_reason || '(none given)'}`] : []),
        ...(answer.ai_covered?.length ? [`Moves the AI saw as covered before this question: ${answer.ai_covered.join(', ')}`] : []),
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
    const turn = session.turn;
    if (!MOVES.some(move => move.id === body.move) || typeof body.original !== 'string' ||
        !body.original.trim() || body.original.length > 20000) return json({ error: 'Invalid answer.' }, 400);
    if (!turn || turn.move !== body.move) return json({ error: 'This question has changed. Reload the page to see the current question.' }, 409);
    if (turn.move === 'convergence' && turn.askedBy === 'guided') {
      try { proposedOutcomes(body.original); } catch (error) { return json({ error: error.message }, 400); }
    }
    const answer = { id: crypto.randomUUID(), move: turn.move, original: body.original, question: turn.question, asked_by: turn.askedBy,
      ai_reason: turn.askedBy === 'AI' ? turn.reason || null : null, ai_covered: turn.covered || [], source_check: turn.sourceCheck === true, challenges: [] };
    await client.query(`INSERT INTO indago.client_interview_answers(id, session_id, move, original, question, asked_by, ai_reason, ai_covered, source_check)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [answer.id, id, answer.move, answer.original, answer.question, answer.asked_by, answer.ai_reason, answer.ai_covered, answer.source_check]);
    const answers = [...session.answers, answer];
    if (session.ai_assisted) {
      let next = null;
      try { next = await nextAiTurn(ask, answers); }
      catch (error) { logAiFallback('question', error); /* The saved answer remains available; the guided question is the fallback. */ }
      await client.query('UPDATE indago.client_interviews SET next_turn = $1 WHERE id = $2', [next && JSON.stringify(next), id]);
    }
  } else if (parts[2] === 'challenges') {
    const answer = session.answers.find(item => item.id === body.answerId);
    if (!answer) return json({ error: 'Answer not found.' }, 404);
    if (answer.challenges.some(item => !item.reply)) return json({ error: 'Reply to or skip the open challenge first.' }, 409);
    let question = challengeFor(answer.move, answer.original, session.answers.filter(item => item.id !== answer.id), answer.challenges.length);
    if (session.ai_assisted) try {
      const text = await ask({ system: process.env.INDAGO_AI_CHALLENGE_PROMPT, input: `Challenged answer:\n<participant_answer id="${answer.id}" move="${answer.move}">${escapeParticipant(answer.original)}</participant_answer>\n\nEarlier challenges on this answer (do not repeat these angles): ${answer.challenges.map(item => item.question).join('; ') || 'none'}\n\nConversation so far:\n${interviewTranscript(session.answers)}\n\nAsk one pointed follow-up.` });
      if (text) {
        const result = parseAiJson(text);
        if (result.answerId !== answer.id || !['client outcome', 'counterexample', 'economics', 'competitive difference', 'feasibility', 'trade-off', 'evidence'].includes(result.angle)) throw new Error('AI challenge invalid.');
        question = singleQuestion(result.question, session.answers.map(item => item.original).join('\n'));
      }
    } catch (error) { logAiFallback('challenge', error); /* Keep the guided challenge. */ }
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
    if (session.turn) return json({ error: 'Answer the current question before drafting.' }, 409);
    try { draft = makeDraft(session.answers, body.correctedSummary, session.next_turn?.covered); } catch (error) { return json({ error: error.message }, 400); }
    // The AI draft takes 25-30 s, longer than the site allows a request, so it runs after submit
    // (indago-draft-background). Until it is done, the guided draft is the saved record.
    await client.query(`UPDATE indago.client_interviews SET corrected_summary = $1, draft = $2, status = 'submitted',
      ai_draft = $3, updated_at = now() WHERE id = $4`, [body.correctedSummary, JSON.stringify(draft), session.ai_assisted ? 'pending' : null, id]);
  }
  return json(await load(client, id, userId));
}

// Runs in the background function after submit. `transaction(work)` runs work(client) in its own
// committed transaction, so the slow AI call holds no database transaction open.
export async function writeAiDraft(id, userId, transaction, ask = askClaude) {
  const claimed = await transaction(async client => {
    const result = await client.query(`UPDATE indago.client_interviews SET ai_draft = 'running'
      WHERE id = $1 AND owner_id = $2 AND status = 'submitted' AND ai_draft = 'pending' RETURNING id`, [id, userId]);
    return result.rows.length ? load(client, id, userId) : null;
  });
  if (!claimed?.answers) return 'skipped';
  let draft = claimed.draft;
  let outcome = 'failed';
  try {
    const text = await ask({ system: process.env.INDAGO_AI_DRAFT_PROMPT, maxTokens: 4500, timeoutMs: 120000,
      input: `<corrected_summary>${escapeParticipant(claimed.corrected_summary)}</corrected_summary>\n\nTranscript:\n${interviewTranscript(claimed.answers)}\n\nDraft the record.` });
    if (!text) throw new Error('AI service off.');
    draft = makeAiDraft(aiJsonText(text), claimed.answers, claimed.corrected_summary);
    outcome = 'done';
  } catch (error) {
    logAiFallback('draft', error);
    // The guided draft stays the record; record why, as our own fixed text only.
    draft = { ...claimed.draft, aiFallbackReason: aiFallbackReason(error) };
  }
  await transaction(client => client.query(`UPDATE indago.client_interviews SET draft = $1, ai_draft = $2, updated_at = now()
    WHERE id = $3 AND ai_draft = 'running'`, [JSON.stringify(draft), outcome, id]));
  return outcome;
}
