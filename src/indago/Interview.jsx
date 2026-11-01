import React, { useEffect, useRef, useState } from 'react';
import { challengeFor, makeDraft, MOVES, nextMove, proposedOutcomes } from './model/interview.mjs';
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
    answer: async (id, move, original) => { const s = await get(id); if (s.answers.some(a => a.move === move)) throw new Error('Original answer is already recorded.'); if (move === 'convergence') proposedOutcomes(original); s.answers.push({ id: crypto.randomUUID(), move, original, challenges: [] }); return write(s); },
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
  async function start() { const ok = await run(() => api.create()); if (ok) setListing(null); }
  const next = session && nextMove(session.answers);
  const ready = session && !next;
  const suggestedSummary = ready ? MOVES.map(move => {
    const answer = session.answers.find(item => item.move === move.id);
    return `${move.title}: ${answer.original}`;
  }).join('\n\n') : '';
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
  useEffect(() => { if (session?.canWrite) questionHeading.current?.focus(); }, [next?.id, ready, session?.id]);
  return <main className="interview">
    <header className="interview-head"><p className="eyebrow">Greatstone International · Indago Deep Dive™</p><button type="button" className="quiet" onClick={exit}>Return to portal</button></header>
    <div className="interview-wrap">
      {preview && <p className="preview-mark">Synthetic preview. No client data or database connection.</p>}
      <h1>Set the direction for Indago</h1>
      {!session && <>
        <p className="intro">Start in your own words. You can pause and return. Gordon confirms the final wording.</p>
        <p className="opening-question">First question: {MOVES[0].question}</p>
        <details className="interview-details"><summary>How this interview works and who can review it</summary>
          <p className="notice">{preview ? 'In this preview, invented answers stay in this browser tab. They are not saved to the private portal.' : 'Your interview record is available to you and Greatstone facilitators who have been given review access. They can read and export your saved answers, follow-up replies, corrected summary and draft. Greatstone will review any draft with you before the final wording is confirmed. This guided interview does not use AI to process your answers or write the draft. Your answers and edits are saved in the private portal when you save or submit them.'}</p>
        </details>
      </>}
      {error && <p role="alert" className="interview-error">{error}</p>}
      {!session && listing === null && !error && <p aria-busy="true">Loading sessions…</p>}
      {!session && listing && <section aria-label="Your sessions">
        {listing.sessions.length > 0 && <><h2>{listing.facilitator ? 'Sessions for facilitator review' : 'Continue your session'}</h2><ul className="sessions">{listing.sessions.map(item => <li key={item.id}><button type="button" onClick={() => open(item.id)}>{item.status === 'submitted' ? 'Review submitted draft' : 'Resume interview'} · {item.id.slice(0, 8)}</button>{listing.facilitator && <a href={`/api/indago/interviews/${item.id}/export`}>Export record</a>}</li>)}</ul></>}
        <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> {preview ? 'I understand this synthetic preview keeps invented answers in this browser tab, does not save them to the private portal, and does not use AI to process them.' : 'I agree to take part and to have my answers, follow-up replies, corrections and draft saved for review by Greatstone facilitators with access. I understand that this guided interview does not use AI to process my answers.'}</label>
        <button type="button" disabled={busy || !consent} onClick={start}>Start a new interview</button>
      </section>}
      {session && <>
        <p className="progress" aria-live="polite">{session.status === 'submitted' ? 'Draft recorded' : `Move ${next ? MOVES.indexOf(next) + 1 : 6} of 6`} · IND-NS-001 · G2</p>
        {next && session.canWrite && <form className="current" onSubmit={async e => { e.preventDefault(); const ok = await run(() => api.answer(session.id, next.id, text)); if (ok) setText(''); }}>
          <p className="source-label">{next.title}</p><h2 tabIndex="-1" ref={questionHeading}>{next.question}</h2>
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
          <p className="source-label">Your corrected summary</p><p className="prewrap">{session.corrected_summary}</p>
          <h3>Draft North Star candidates</h3><ol>{session.draft?.candidates?.map((candidate, index) => <li key={index}><strong>{candidate.framing}</strong><p>{candidate.text}</p><small>{candidate.status} · {candidate.provenance} · Sources: <SourceLinks sources={candidate.sources} /></small></li>)}</ol>
          <h3>Proposed outcomes</h3><ul>{session.draft?.outcomes?.map((outcome, i) => <li key={i}>{outcome.text} <small>({outcome.status}; <SourceLinks sources={outcome.sources} />)</small></li>)}</ul>
          <h3>Evidence requests</h3><ul>{session.draft?.evidenceRequests?.map(request => <li key={request.id}>{request.id}: {request.question} <small>({request.status}; <SourceLinks sources={request.sources} />)</small></li>)}</ul>
        </section>}
        <details className="interview-details" open={session.status === 'submitted' ? true : undefined}><summary>Previous answers and challenges ({session.answers.length})</summary>
        {session.answers.map(answer => <section className="answer-card" key={answer.id} id={`answer-${answer.id}`}>
          <h2>{MOVES.find(move => move.id === answer.move)?.title}</h2>
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

function SourceLinks({ sources = [] }) {
  return sources.map((source, index) => <React.Fragment key={source.answerId}>{index > 0 && ', '}<a href={`#answer-${source.answerId}`}>{MOVES.find(move => move.id === source.move)?.title || source.move}</a></React.Fragment>);
}
