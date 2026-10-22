import React, { useEffect, useRef, useState } from 'react';
import { Deliverables } from './WorkPlan.jsx';
import { Field, Clock, Choice, Toggle, LongText, exportHypotheses, northStarWork } from './ns-fields.jsx';
import {
  northStarSections, northStarProgress, startPosition, sentencePreview, approvalBlocked, hypothesisIdsOf, ACCEPTANCE_KEY,
} from '../model/north-star-steps.mjs';

const readStored = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

// The guided North Star path: one small step at a time, with visible progress.
// It edits the same fields as the full record, through the same save action.
export default function NorthStarGuide({ state, canEdit, northStar, northStarActions, onOpen, onEvidence, files = [], fileActions, run, showHistory, onFullRecord }) {
  const { template: t, fields: f } = northStar;
  const sections = northStarSections(t, f);
  const progress = northStarProgress(sections);
  const placeKey = `indago-ns-step:${t.id}`;
  const [pos, setPos] = useState(() => startPosition(sections, readStored(placeKey)));
  const [finished, setFinished] = useState(null);
  const [pending, setPending] = useState(0);
  const [saved, setSaved] = useState(false);
  const heading = useRef(null);
  const moved = useRef(false);

  const section = sections[pos.section];
  const stepIndex = Math.max(0, Math.min(pos.step, section.total - 1));
  const item = section.steps[stepIndex] || { id: 'empty', fields: [] };

  useEffect(() => { writeStored(placeKey, `${section.id}:${stepIndex}`); }, [section.id, stepIndex]);
  useEffect(() => { if (moved.current) heading.current?.focus(); }, [pos, finished]);

  const go = to => { moved.current = true; setFinished(null); setPos(to); };
  const openStep = s => ({ section: s.index, step: Math.max(0, s.steps.findIndex(x => !x.done)) });
  const next = () => {
    if (stepIndex < section.total - 1) return go({ section: pos.section, step: stepIndex + 1 });
    moved.current = true; setFinished(pos.section);
  };
  const back = () => {
    if (finished !== null) { moved.current = true; setFinished(null); return; }
    if (stepIndex > 0) go({ section: pos.section, step: stepIndex - 1 });
    else if (pos.section > 0) go({ section: pos.section - 1, step: sections[pos.section - 1].total - 1 });
  };
  const save = key => async value => {
    setPending(n => n + 1);
    try { await northStarActions.save(key, value); setSaved(true); } finally { setPending(n => n - 1); }
  };
  const addHypothesis = (evidence = '') => run(async () => {
    const { id } = await northStarActions.addHypothesis();
    if (evidence) await northStarActions.save(`hypothesis.${id}.evidence`, evidence);
    const ids = hypothesisIdsOf(t, { ...f, [`hypothesis.${id}.created`]: '' });
    go({ section: section.index, step: ids.indexOf(id) });
  });

  const input = spec => {
    const props = { name: spec.label, value: f[spec.key] || '', save: save(spec.key), canEdit };
    if (spec.kind === 'choice') return <Choice key={spec.key} {...props} options={spec.options}
      disabled={option => spec.key === 'approval.status' && option.startsWith('Approved') && approvalBlocked(f) ? 'Record acceptance as Yes first.' : ''} />;
    if (spec.kind === 'long') return <LongText key={spec.key} {...props} hint={spec.hint} open={item.open} />;
    return <Field key={spec.key} {...props} type={spec.kind === 'date' ? 'date' : 'text'} placeholder={spec.hint} />;
  };
  const toggles = item.fields.filter(spec => spec.kind === 'toggle');
  const acceptance = sections.find(s => s.id === 'convergence');
  const nextSection = sections[pos.section + 1];
  const done = finished !== null ? sections[finished] : null;
  const guide = [...(section.guide || []), ...(item.detail ? [item.detail] : [])];
  const hasMore = guide.length > 0 || item.evidence || item.history;

  return <div className="ns-guide">
    <div className="ns-overall">
      <div className="ns-overall-text"><b>{progress.done} of {progress.total}</b> steps recorded
        <span className="ns-save" role="status" aria-live="polite">{pending ? 'Saving…' : saved ? 'All changes saved' : canEdit ? 'Saves as you go' : 'Read only'}</span></div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label="North Star progress"><span style={{ width: `${progress.percent}%` }} /></div>
      <div className="ns-tools">
        <details className="ns-more"><summary>Facilitator guide</summary><ol>{t.guardrails.map(rule => <li key={rule}>{rule}</li>)}</ol></details>
        <details className="ns-more"><summary>Workshop timer</summary><Clock value={f['show.clock']} save={save('show.clock')} canEdit={canEdit} blocks={t.runOfShow} /></details>
      </div>
    </div>

    <div className="ns-journey">
      <nav className="ns-rail" aria-label="North Star sections"><ol>
        {sections.map(s => <li key={s.id}>
          <button type="button" className={s.complete ? 'complete' : ''} aria-current={s.index === pos.section ? 'step' : undefined}
            onClick={() => go(openStep(s))}>
            <span className="ns-dot" aria-hidden="true">{s.complete ? '✓' : s.index + 1}</span>
            <span className="ns-rail-title">{s.title}</span>
            <span className="ns-rail-count">{s.done}/{s.total}<span className="sr-only"> steps recorded{s.complete ? ', complete' : ''}</span></span>
          </button>
        </li>)}
      </ol></nav>

      <section className="ns-stage" aria-labelledby="ns-stage-title">
        <div className="section-label">Part {section.index + 1} of {sections.length} · NS-01 · {section.number}</div>
        <h3 id="ns-stage-title">{section.title}</h3>
        <p className="ns-purpose">{section.purpose}</p>

        {done ? <div className="ns-card ns-finish">
          <h4 ref={heading} tabIndex={-1}>{done.complete ? `${done.title}: done` : `${done.done} of ${done.total} steps recorded`}</h4>
          <p>{done.complete ? `All ${done.total} steps are recorded. Good progress.` : 'You can come back to the open steps at any time. Your answers are saved.'}</p>
          <div className="ns-nav">
            {!done.complete && <button type="button" className="btn" onClick={() => go(openStep(done))}>Go to the first open step</button>}
            {nextSection ? <button type="button" className="btn ns-primary" onClick={() => go({ section: nextSection.index, step: 0 })}>Next: {nextSection.title}</button> :
              <button type="button" className="btn ns-primary" onClick={onFullRecord}>Read the full record</button>}
          </div>
        </div> : section.total === 0 ? <div className="ns-card"><h4 ref={heading} tabIndex={-1}>No steps yet</h4>
          {canEdit && <button type="button" className="btn ns-primary" onClick={() => addHypothesis()}>Add a hypothesis</button>}</div> : <>
          <div className="ns-steps" aria-label={`Steps in ${section.title}`} role="group">
            {section.steps.map((s, i) => <button key={s.id} type="button" className={`ns-pip${s.done ? ' done' : ''}`} aria-current={i === stepIndex ? 'step' : undefined}
              aria-label={`Step ${i + 1}${s.done ? ', recorded' : ''}`} onClick={() => go({ section: pos.section, step: i })} />)}
          </div>

          <article className="ns-card" key={item.id}>
            <div className="ns-card-meta">{item.kicker && <span>{item.kicker}</span>}<span>Step {stepIndex + 1} of {section.total}</span>{item.done && <span className="ns-check">✓ Recorded</span>}</div>
            <h4 ref={heading} tabIndex={-1}>{item.title}</h4>
            {item.purpose && <p className="ns-purpose">{item.purpose}</p>}
            {toggles.length > 0 && <div className="ns-chips">{toggles.map(spec => <Toggle key={spec.key} name={spec.label} value={f[spec.key] || ''} save={save(spec.key)} canEdit={canEdit} />)}</div>}
            <div className="ns-inputs">{item.fields.filter(spec => spec.kind !== 'toggle').map(input)}</div>
            {item.preview && <p className="ns-preview" aria-live="polite"><b>Your sentence so far:</b> {sentencePreview(f)}</p>}
            {item.approval && approvalBlocked(f) && <p className="note warn">Approval needs Gordon’s acceptance recorded as Yes.{' '}
              <button type="button" className="link-button" onClick={() => go({ section: acceptance.index, step: Number(ACCEPTANCE_KEY.split('.')[1]) })}>Go to that check</button></p>}
            {item.hypothesis && (f[`hypothesis.${item.hypothesis}.request`] ? <p>Evidence request: <button type="button" className="link-button" onClick={() => onEvidence(f[`hypothesis.${item.hypothesis}.request`])}>{f[`hypothesis.${item.hypothesis}.request`]}</button></p> :
              canEdit && <button type="button" className="btn small" disabled={!f[`hypothesis.${item.hypothesis}.evidence`]} onClick={() => run(() => northStarActions.sendHypothesis(item.hypothesis))}>Send to Evidence register</button>)}
            {hasMore && <details className="ns-more"><summary>More: sources and guidance</summary>
              {item.evidence && <p>Source: {item.evidence.map((id, i) => <React.Fragment key={id}>{i > 0 && ' / '}<button type="button" className="link-button" onClick={() => onEvidence(id)}>{id}</button></React.Fragment>)}</p>}
              {guide.map(line => <p key={line}>{line}</p>)}
              {item.history && <button type="button" className="link-button" onClick={showHistory}>See wording versions in change history</button>}
            </details>}
          </article>

          <div className="ns-nav">
            <button type="button" className="btn" onClick={back} disabled={pos.section === 0 && stepIndex === 0}>Back</button>
            <button type="button" className="btn ns-primary" onClick={next}>{stepIndex < section.total - 1 ? 'Next' : 'Finish this part'}</button>
          </div>
        </>}

        {section.hypotheses && <details className="ns-more"><summary>Hypothesis tools</summary><div className="ns-actions">
          <button type="button" className="btn small" onClick={() => exportHypotheses(f, hypothesisIdsOf(t, f))}>Export hypotheses CSV</button>
          {canEdit && <button type="button" className="btn small" onClick={() => addHypothesis()}>Add hypothesis row</button>}</div>
          {canEdit && <><p className="hint">Suggested evidence requests. Each adds a hypothesis row.</p><div className="ns-recommendations">{t.recommendedRequests.map(request =>
            <button type="button" key={request} className="btn small" onClick={() => addHypothesis(request)}>Add: {request}</button>)}</div></>}
        </details>}
        {section.id === 'approval' && <details className="ns-more"><summary>Work plan and signed record</summary>
          {northStarWork(state).length ? <ul>{northStarWork(state).map(w => <li key={w.id}><button type="button" className="link-button"
            onClick={() => { onOpen('plan'); setTimeout(() => document.getElementById(`wbs-${w.id}`)?.scrollIntoView({ block: 'center' }), 30); }}>{w.id} · {w.task}</button>
            <Deliverables id={w.id} files={files.filter(file => file.work_package_id === w.id)} canEdit={canEdit} fileActions={fileActions} /></li>)}</ul> :
            <p className="note">No North Star work package was found in the current plan.</p>}
        </details>}
      </section>
    </div>
  </div>;
}
