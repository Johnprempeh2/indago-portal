import React, { useEffect, useRef, useState } from 'react';
import { challengeFor, guidedTurn, HYPOTHESIS_NOTE, makeDraft, MOVES, proposedOutcomes, SOURCE_STATEMENTS } from './model/interview.mjs';
import './interview.css';

export function makePreviewInterviewApi(storage = sessionStorage) {
  const key = 'indago-synthetic-interview';
  const read = () => JSON.parse(storage.getItem(key) || 'null');
  const write = session => { storage.setItem(key, JSON.stringify(session)); return session; };
  const get = async id => { const session = read(); if (!session || session.id !== id) throw new Error('Session not found.'); return session; };
  return {
    list: async () => ({ sessions: read() ? [read()] : [], facilitator: false }),
    get,
    create: async () => write({ id: crypto.randomUUID(), record_id: 'IND-NS-001', gate: 'G2', status: 'in_progress', canWrite: true, answers: [], corrected_summary: '', draft: null, consented_at: new Date().toISOString() }),
    answer: async (id, move, original) => { const s = await get(id); const turn = guidedTurn(s.answers); if (!turn || turn.move !== move) throw new Error('This question has changed.'); if (move === 'convergence') proposedOutcomes(original); s.answers.push({ id: crypto.randomUUID(), move, original, question: turn.question, asked_by: 'guided', source_check: turn.sourceCheck === true, challenges: [] }); return write(s); },
    challenge: async (id, answerId) => { const s = await get(id); const a = s.answers.find(item => item.id === answerId); if (!a) throw new Error('Answer not found.'); a.challenges.push({ id: crypto.randomUUID(), answer_id: answerId, question: challengeFor(a.move, a.original, s.answers.filter(item => item.id !== answerId), a.challenges.length), reply: '' }); return write(s); },
    reply: async (id, challengeId, reply) => { const s = await get(id); const c = s.answers.flatMap(a => a.challenges).find(item => item.id === challengeId); if (!c || c.reply) throw new Error('Challenge not found.'); c.reply = reply || 'Skipped by participant'; return write(s); },
    submit: async (id, correctedSummary) => { const s = await get(id); s.draft = makeDraft(s.answers, correctedSummary); s.corrected_summary = correctedSummary; s.status = 'submitted'; s.canWrite = false; return write(s); },
  };
}

export default function Interview({ api, preview = false, onExit = () => {} }) {
  const [session, setSession] = useState(null);
  const [listing, setListing] = useState(null);
  const [text, setText] = useState('');
  const [summary, setSummary] = useState('');
  const [replies, setReplies] = useState({});
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const questionHeading = useRef(null);
  useEffect(() => { let active = true; api.list().then(result => { if (active) setListing(result); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [api]);
  async function run(work) {
    setBusy(true); setError('');
    try { const result = await work(); if (result) setSession(result); return true; }
    catch (e) { setError(`${e.message || 'Save failed.'} Your text is still here. Try again.`); return false; }
    finally { setBusy(false); }
  }
  async function open(id) { await run(() => api.get(id)); }
  async function start(ai) { const ok = await run(() => api.create(ai)); if (ok) setListing(null); }
  // The server sends the question waiting for an answer; the synthetic preview works it out in the browser.
  const next = session && ('turn' in session ? session.turn : guidedTurn(session.answers));
  const nextInfo = next && MOVES.find(move => move.id === next.move);
  const ready = session && !next;
  const suggestedSummary = ready ? MOVES.map(move => {
    const own = session.answers.filter(item => item.move === move.id && !item.source_check);
    return own.length ? `${move.title}: ${own.map(answer => answer.original).join(' ')}` : null;
  }).concat(session.answers.filter(item => item.source_check).map(answer => `Earlier statements: ${answer.original}`)).filter(Boolean).join('\n\n') : '';
  const hasUnsavedText = Boolean(text.trim() || Object.values(replies).some(reply => reply.trim()) || (ready && summary && summary !== (session.corrected_summary || suggestedSummary)));
  useEffect(() => {
    if (!hasUnsavedText) return;
    const warnOnLeave = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnOnLeave);
    return () => window.removeEventListener('beforeunload', warnOnLeave);
  }, [hasUnsavedText]);
  function exit() {
    if (hasUnsavedText && !window.confirm('Discard the text you have not saved? Your saved answers will remain available.')) return;
    onExit();
  }
  useEffect(() => { if (ready && !summary) setSummary(session.corrected_summary || suggestedSummary); }, [ready, session?.id]);
  useEffect(() => { if (session?.canWrite) questionHeading.current?.focus(); }, [next?.question, session?.answers.length, ready, session?.id]);
  const aiDrafting = session?.status === 'submitted' && ['pending', 'running'].includes(session.ai_draft);
  const [draftWaitOver, setDraftWaitOver] = useState(false);
  useEffect(() => {
    // The AI draft is written after submit. Start it (repeat starts are ignored by the server), then reload every 4 s for up to 3 minutes.
    if (!aiDrafting || !api.draft) return;
    let active = true;
    let tries = 0;
    setDraftWaitOver(false);
    if (session.ai_draft === 'pending') api.draft(session.id).catch(() => {});
    const timer = setInterval(async () => {
      tries += 1;
      if (tries > 45) { clearInterval(timer); if (active) setDraftWaitOver(true); return; }
      try { const result = await api.get(session.id); if (active && !['pending', 'running'].includes(result.ai_draft)) { clearInterval(timer); setSession(result); } } catch { /* Try again on the next tick. */ }
    }, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [aiDrafting, session?.id]);
  return <main className="interview">
    <header className="interview-head"><p className="eyebrow">Greatstone International · Indago Deep Dive™</p><button type="button" className="quiet" onClick={exit}>Return to portal</button></header>
    <div className="interview-wrap">
      {preview && <p className="preview-mark">Synthetic preview. No client data or database connection.</p>}
      <h1>Set the direction for Indago</h1>
      {!session && <>
        <p className="intro">Start in your own words. You can pause and return. Gordon confirms the final wording.</p>
        <p className="opening-question">First question: {MOVES[0].question}</p>
        {preview ? <details className="interview-details"><summary>How this interview works and who can review it</summary>
          <p className="notice">In this preview, invented answers stay in this browser tab. They are not saved to the private portal.</p>
        </details> : listing?.aiAvailable ? <AiNotice open /> : <details className="interview-details"><summary>How this interview works and who can review it</summary>
          <p className="notice">Your interview record is available to you and Greatstone facilitators who have been given review access. They can read and export your saved answers, follow-up replies, corrected summary and draft. Greatstone will review any draft with you before the final wording is confirmed. Your answers are not sent to an AI service. Your answers and edits are saved in the private portal when you save or submit them.</p>
        </details>}
      </>}
      {error && <p role="alert" className="interview-error">{error}</p>}
      {!session && listing === null && !error && <p aria-busy="true">Loading sessions…</p>}
      {!session && listing && <section aria-label="Your sessions">
        {listing.sessions.length > 0 && <><h2>{listing.facilitator ? 'Sessions for facilitator review' : 'Continue your session'}</h2><ul className="sessions">{listing.sessions.map(item => <li key={item.id}><button type="button" onClick={() => open(item.id)}>{item.status === 'submitted' ? 'Review submitted draft' : 'Resume interview'} · {item.id.slice(0, 8)}</button>{listing.facilitator && <a href={`/api/indago/interviews/${item.id}/export`}>Export record</a>}</li>)}</ul></>}
        <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> {preview ? 'I understand this synthetic preview keeps invented answers in this browser tab, does not save them to the private portal, and does not use AI to process them.' : 'I agree to take part and to have my answers, follow-up replies, corrections and draft saved for review by Greatstone facilitators with access.'}</label>
        {!preview && listing.aiAvailable ? <div className="actions ai-choice">
          <button type="button" disabled={busy || !consent} onClick={() => start(true)}>Start with AI help</button>
          <button type="button" disabled={busy || !consent} onClick={() => start(false)}>Continue without AI</button>
        </div> : <button type="button" disabled={busy || !consent} onClick={() => start(false)}>Start a new interview</button>}
      </section>}
      {session && <>
        <p className="progress" aria-live="polite">{session.status === 'submitted' ? 'Draft recorded' : `Move ${nextInfo ? MOVES.indexOf(nextInfo) + 1 : 6} of 6`} · IND-NS-001 · G2</p>
        {!preview && <details className="interview-details processing-line"><summary>{session.ai_assisted ? AI_LINE : GUIDED_LINE} <span className="link">How your answers are handled</span></summary><NoticeList /></details>}
        {next && session.canWrite && <form className="current" onSubmit={async e => { e.preventDefault(); const ok = await run(() => api.answer(session.id, next.id, text)); if (ok) setText(''); }}>
          <p className="source-label">{nextInfo.title}</p><h2 tabIndex="-1" ref={questionHeading}>{next.question}</h2>
          {next.sourceCheck && <><p className="source-label">Earlier statements to check. They are not facts.</p><ul className="source-statements">{SOURCE_STATEMENTS.map(item => <li key={item}>{item}</li>)}</ul></>}
          <label htmlFor="answer">Your response</label><textarea id="answer" value={text} required maxLength={20000} rows="7" onChange={e => setText(e.target.value)} />
          <div className="actions"><button disabled={busy || !text.trim()}>Save and continue</button><button type="button" className="quiet" onClick={exit}>Pause and return later</button></div>
        </form>}
        {ready && session.canWrite && <form className="current" onSubmit={e => { e.preventDefault(); run(() => api.submit(session.id, summary)); }}>
          <p className="source-label">Review before drafting</p><h2 tabIndex="-1" ref={questionHeading}>Check this summary of your words</h2><p>Correct the summary below. Your original answers stay as recorded below.</p>
          <label htmlFor="summary">Your corrected summary</label><textarea id="summary" value={summary} rows="14" maxLength={20000} required onChange={e => setSummary(e.target.value)} />
          <div className="actions"><button disabled={busy || !summary.trim()}>Record draft for facilitator review</button><button type="button" className="quiet" onClick={exit}>Pause and return later</button></div>
        </form>}
        {!session.canWrite && session.status === 'in_progress' && <p className="notice">This session is still in progress. Only its participant can add answers or submit a draft.</p>}
        {session.status === 'submitted' && <section className="current"><h2>Draft recorded for review</h2><p>These are proposals. Gordon has not confirmed the exact wording.</p>
          <div role="status">{(aiDrafting || session.ai_draft === 'failed') && <p className="notice">{aiDrafting ? (draftWaitOver ? 'The AI draft is taking longer than expected. Your guided draft below is saved. Reload this page later to see the AI draft.' : 'The AI is writing your draft. This takes about 30 seconds. Your guided draft below is already saved.') : 'The AI draft could not be written. Your guided draft below is saved for review.'}</p>}</div>
          <p className="source-label">Your corrected summary</p><p className="prewrap">{session.corrected_summary}</p>
          <h3>Draft North Star candidates</h3><ol>{session.draft?.candidates?.map((candidate, index) => <li key={index}><strong>{candidate.framing}</strong><p>{candidate.text}</p><small>{candidate.status} · {candidate.provenance} · Sources: <SourceLinks sources={candidate.sources} /></small></li>)}</ol>
          <h3>Proposed outcomes</h3><ul>{session.draft?.outcomes?.map((outcome, i) => <li key={i}>{outcome.text} <small>({outcome.status}; <SourceLinks sources={outcome.sources} />)</small></li>)}</ul>
          <h3>Boundaries</h3><ul>{session.draft?.boundaries?.map((boundary, i) => <li key={i}>{boundary.text} <small>({boundary.status}; <SourceLinks sources={boundary.sources} />)</small></li>)}</ul>
          <h3>Evidence requests</h3><p><small>{session.draft?.hypothesisNote || HYPOTHESIS_NOTE}</small></p><ul>{session.draft?.evidenceRequests?.map(request => <li key={request.id}>{request.id}: {request.question} <small>({request.status}; <SourceLinks sources={request.sources} />)</small></li>)}</ul>
        </section>}
        <details className="interview-details" open={session.status === 'submitted' ? true : undefined}><summary>Previous answers and challenges ({session.answers.length})</summary>
        {session.answers.map(answer => <section className="answer-card" key={answer.id} id={`answer-${answer.id}`}>
          <h2>{MOVES.find(move => move.id === answer.move)?.title}{answer.source_check ? ' · earlier statements' : ''}</h2>
          {answer.question && <p className="asked">{answer.question}</p>}
          <p className="source-label">Your original words · saved separately</p><blockquote>{answer.original}</blockquote>
          {answer.challenges.map(challenge => <div className="challenge" key={challenge.id}><p><strong>Challenge:</strong> {challenge.question}</p>
            {challenge.reply ? <p><strong>Separate reply:</strong> {challenge.reply}</p> : session.canWrite ? <form onSubmit={async e => { e.preventDefault(); const ok = await run(() => api.reply(session.id, challenge.id, replies[challenge.id] || '')); if (ok) setReplies(current => ({ ...current, [challenge.id]: '' })); }}>
              <label htmlFor={`reply-${challenge.id}`}>Your reply</label><textarea id={`reply-${challenge.id}`} value={replies[challenge.id] || ''} onChange={e => setReplies(current => ({ ...current, [challenge.id]: e.target.value }))} rows="3" />
              <div className="actions"><button disabled={busy}>Save reply</button><button type="button" className="quiet" disabled={busy} onClick={() => run(() => api.reply(session.id, challenge.id, ''))}>Skip</button></div>
            </form> : <p>Awaiting the participant’s reply.</p>}
          </div>)}
          {session.canWrite && <button type="button" className="quiet" disabled={busy || answer.challenges.some(c => !c.reply)} onClick={() => run(() => api.challenge(session.id, answer.id))}>Challenge my response</button>}
        </section>)}
        </details>
      </>}
    </div>
  </main>;
}

// Participant notice: Harbor's approved wording (GRE-3681 section 5, rev 2). The Anthropic figure is Flint's
// confirmed 30 days; the bracketed values are John's to set before any client use.
const AI_LINE = "AI-assisted: Anthropic's Claude processes your answers for this interview only, not for training. A person reviews every draft.";
const GUIDED_LINE = 'Guided questions: your answers are not sent to an AI service.';

function AiNotice({ open = false }) {
  return <details className="interview-details" open={open || undefined}><summary>How your answers are handled</summary><NoticeList /></details>;
}

function NoticeList() {
  return <ul className="notice">
    <li>An AI service helps run this conversation. It reads your answers to choose the next question, to ask a follow-up when you press <strong>Challenge my response</strong>, and to draft a summary at the end.</li>
    <li>The AI service is Claude, provided by Anthropic. Your answers are sent to it only for this conversation.</li>
    <li>Anthropic does not use your answers to train its models, and neither does Greatstone.</li>
    <li>Anthropic keeps the text it receives for up to <strong>30 days</strong> and then deletes it, unless it is needed to investigate misuse.</li>
    <li>Your answers and the draft are stored in the Indago portal for <strong>[retention period – John to set]</strong>. Only you and the Greatstone team on this project can read them: <strong>[names or roles – set per session]</strong>.</li>
    <li>Nothing the AI writes is final. A Greatstone facilitator reviews every draft with you, and you can correct it. No North Star is approved without Gordon's confirmation.</li>
    <li>If you prefer not to use AI, choose <strong>Continue without AI</strong>. You get the same moves as guided questions in a fixed order, and your answers are not sent to an AI service.</li>
    <li>Questions or a request to delete your answers: <strong>[contact – John to set]</strong>.</li>
  </ul>;
}

function SourceLinks({ sources = [] }) {
  return sources.map((source, index) => <React.Fragment key={source.answerId}>{index > 0 && ', '}<a href={`#answer-${source.answerId}`}>{MOVES.find(move => move.id === source.move)?.title || source.move}</a></React.Fragment>);
}
