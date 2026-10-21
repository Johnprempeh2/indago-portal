import React, { useEffect, useRef, useState } from 'react';
import { Deliverables } from './WorkPlan.jsx';

const section = (number, title, body) => <section className="ns-section" aria-labelledby={`ns-${number}`}>
  <div className="section-label">NS-01 · {number}</div><h3 id={`ns-${number}`}>{title}</h3>{body}
</section>;

function Field({ name, value = '', save, canEdit, options, multiline = false, type = 'text', placeholder = '' }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState('');
  const timer = useRef();
  const dirty = useRef(false);
  const current = useRef(value);
  current.current = text;
  useEffect(() => { if (!dirty.current) setText(value); }, [value]);
  useEffect(() => () => { clearTimeout(timer.current); if (dirty.current) save(current.current).catch(() => {}); }, []);
  const commit = async next => {
    clearTimeout(timer.current);
    try {
      await save(next);
      if (current.current === next) dirty.current = false;
      setError('');
    } catch (e) {
      if (options || type === 'checkbox') { setText(value); dirty.current = false; }
      setError(`${e.message || 'Save failed.'} ${options || type === 'checkbox' ? 'The earlier value is still saved.' : 'Your text is still here. Try again.'}`);
    }
  };
  if (!canEdit) return <div className="ns-field"><span className="ns-label">{name}</span><span className="ro">{value || 'Not recorded'}</span></div>;
  const change = next => {
    setText(next); current.current = next; dirty.current = true;
    clearTimeout(timer.current); timer.current = setTimeout(() => commit(next), 650);
  };
  if (type === 'checkbox') return <label className="ns-tick"><input type="checkbox" checked={text === 'Yes'} onChange={e => change(e.target.checked ? 'Yes' : '')}
    onBlur={() => { if (dirty.current) commit(current.current); }} />{name}<span className="ns-print-value">{text === 'Yes' ? 'Yes' : 'No'}</span>
    {error && <span className="ns-error" role="alert">{error}</span>}</label>;
  const props = {
    value: text, 'aria-label': name, onChange: e => change(e.target.value),
    onBlur: () => { if (dirty.current) commit(current.current); },
  };
  return <label className="ns-field"><span className="ns-label">{name}</span>
    {options ? <select {...props}>{options.map(option => <option key={option} value={option}>{option || 'Choose…'}</option>)}</select> :
      multiline ? <textarea {...props} rows="3" placeholder={placeholder} /> : <input {...props} type={type} placeholder={placeholder} />}
    <span className="ns-print-value">{text || '—'}</span>
    {error && <span className="ns-error" role="alert">{error}</span>}
  </label>;
}

function Clock({ value, save, canEdit, blocks }) {
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  let clock;
  try { clock = JSON.parse(value || '{}'); } catch { clock = {}; }
  const start = Date.parse(clock.startedAt || '');
  const elapsed = (Number.isFinite(Number(clock.elapsed)) ? Number(clock.elapsed) : 0) +
    (Number.isFinite(start) ? Math.max(0, (now - start) / 1000) : 0);
  const minutes = elapsed / 60;
  const blockNumber = Number(clock.block);
  const blockIndex = Number.isFinite(blockNumber) ? Math.max(0, Math.min(blocks.length - 1, Math.floor(blockNumber))) : 0;
  const current = blocks[blockIndex];
  const end = Number(current.time.split('–')[1]);
  const remaining = Math.max(0, Math.ceil(end * 60 - elapsed));
  const over = minutes >= end;
  const persist = next => save(JSON.stringify(next)).catch(e => setError(`${e.message || 'Clock save failed.'} Try again.`));
  const toggle = () => persist(clock.startedAt
    ? { ...clock, elapsed: Math.round(elapsed), startedAt: null }
    : { ...clock, elapsed: Math.round(elapsed), startedAt: new Date().toISOString() });
  const next = () => persist({ ...clock, block: Math.min(blocks.length - 1, blockIndex + 1) });
  return <div className="ns-clock" role="timer" aria-live="off">
    <strong>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</strong>
    <span>Current block: {current.time} · {current.move}</span>
    <span className={over ? 'ns-error' : ''}>{over ? `Block over by ${Math.floor((elapsed - end * 60) / 60)}:${String(Math.floor((elapsed - end * 60) % 60)).padStart(2, '0')}` : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left in block`}</span>
    {canEdit && <button type="button" className="btn small" onClick={toggle}>{clock.startedAt ? 'Pause' : 'Start'}</button>}
    {canEdit && blockIndex < blocks.length - 1 && <button type="button" className="btn small" onClick={next}>Next block</button>}
    {error && <span className="ns-error" role="alert">{error}</span>}
  </div>;
}

function csv(rows) {
  return rows.map(row => row.map(cell => {
    const text = String(cell ?? '');
    const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}

function downloadCsv(rows) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' }));
  link.download = 'indago-north-star-hypotheses.csv';
  document.body.append(link); link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 500);
}

export default function NorthStar({ state, canEdit, northStar, northStarActions, onOpen, onEvidence, files = [], fileActions }) {
  const [history, setHistory] = useState(null);
  const [message, setMessage] = useState('');
  if (!northStar) return <p role="status">Loading North Star instrument…</p>;
  const { template: t, fields: f } = northStar;
  const save = key => value => northStarActions.save(key, value);
  const field = (key, name, options, multiline = false, type = 'text') => <Field key={key} name={name} value={f[key] || ''} save={save(key)} canEdit={canEdit}
    options={options} multiline={multiline} type={type} />;
  const questionIndex = (sectionIndex, index) => t.questions.slice(0, sectionIndex).reduce((sum, item) => sum + item.items.length, 0) + index;
  const hypothesisIds = [...new Set([...t.hypotheses, ...Object.keys(f).map(key => key.match(/^hypothesis\.(NS-H-\d+)\./)?.[1]).filter(Boolean)])]
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  const work = state.wbs.filter(w => w.gate === 'G2' || /north star/i.test(`${w.task} ${w.ws}`));
  const agreed = ['horizon', 'identity', 'market', 'outcome', 'advantage', 'measures', 'principles'].map(key => f[`draft.${key}`] || `[${key}]`);
  const preview = `By ${agreed[0]}, Indago will be ${agreed[1]} for ${agreed[2]}, enabling ${agreed[3]} through ${agreed[4]}, while achieving ${agreed[5]}, without compromising ${agreed[6]}.`;
  const run = async action => { try { setMessage(''); await action(); setMessage('Saved.'); } catch (e) { setMessage(e.message || 'Action failed. Try again.'); } };
  const jumpWork = id => { onOpen('plan'); setTimeout(() => document.getElementById(`wbs-${id}`)?.scrollIntoView({ block: 'center' }), 30); };
  const showHistory = async () => run(async () => setHistory(history ? null : await northStarActions.history()));
  const exportHypotheses = () => downloadCsv([['ID', 'Hypothesis / fact', 'Evidence required', 'Owner', 'Due', 'GDXP linkage', 'Evidence request'],
    ...hypothesisIds.map(id => [id, ...['fact', 'evidence', 'owner', 'due', 'link', 'request'].map(key => f[`hypothesis.${id}.${key}`] || '')])]);

  return <div className="north-star">
    <div className="ns-head"><div><div className="section-label">Internal facilitator instrument · {t.edition}</div>
      <h2 className="section-title">North Star</h2><p className="lead">{t.purpose.replace(/^Purpose: /, '')}</p></div>
      <div className="ns-actions"><button type="button" className="btn small" onClick={() => { document.querySelector('.ns-guardrails').open = true; window.print(); }}>Print or save PDF</button>
        <button type="button" className="btn small" onClick={showHistory}>Change history</button></div></div>
    {message && <p className="hint" role="status">{message}</p>}
    {history && <aside className="ns-history" aria-label="North Star change history"><h3>Change history</h3><ol>
      {history.map(item => <li key={item.id}><b>{item.field_key}</b>: {item.old_value || 'Empty'} → {item.new_value || 'Empty'} · {item.actor} · {new Date(item.changed_at).toLocaleString('en-GB')}</li>)}
    </ol></aside>}

    <details className="ns-guardrails" open><summary>1 · Facilitation mandate and guardrails</summary><ol>{t.guardrails.map(rule => <li key={rule}>{rule}</li>)}</ol></details>

    {section(2, 'Existing strategic baseline', <><p className="note">{t.baselineNote}</p><div className="ns-list">{t.baseline.map((row, i) =>
      <article className="ns-item" key={row.id}><h4>{(row.id.includes('/082') ? ['IND-EV-014', 'IND-EV-082'] : [row.id]).map((id, index) =>
        <React.Fragment key={id}>{index > 0 && ' / '}<button type="button" className="link-button" onClick={() => onEvidence(id)}>{id}</button></React.Fragment>)} · {row.proposition.split(': ').slice(1).join(': ')}</h4>
        <p>{row.treatment}</p><div className="ns-grid">{field(`baseline.${i}.status`, 'Status', ['', 'Confirmed', 'Changed', 'Rejected', 'Still unverified'])}
          {field(`baseline.${i}.outcome`, 'Session outcome', null, true)}</div></article>)}</div></>)}

    {section(3, 'Ninety-minute workshop run of show', <><Clock value={f['show.clock']} save={save('show.clock')} canEdit={canEdit} blocks={t.runOfShow} />
      <div className="ns-list">{t.runOfShow.map((block, i) => <article className="ns-item" key={block.time}><h4>{block.time} · {block.move}</h4>
        <p>Planned outcome: {block.outcome}</p>{field(`show.${i}.notes`, 'Session notes', null, true)}</article>)}</div></>)}

    {section(4, 'The provocative interrogation', <><p className="note">Record Gordon’s words before drafting a Greatstone interpretation. These are separate fields.</p>
      {t.questions.map((group, groupIndex) => <div className="ns-question-group" key={group.heading}><h4>{group.heading}</h4>
        {group.items.map((question, index) => { const n = questionIndex(groupIndex, index); return <article className="ns-item" key={question}><p className="ns-question">{question}</p>
          <div className="ns-grid">{field(`question.${n}.asked`, 'Asked', null, false, 'checkbox')}{field(`question.${n}.followup`, 'Follow-up needed', null, false, 'checkbox')}</div>
          <div className="ns-grid">{field(`question.${n}.verbatim`, 'Gordon’s words (verbatim)', null, true)}{field(`question.${n}.interpretation`, 'Greatstone note / interpretation', null, true)}</div>
        </article>; })}</div>)}</>)}

    {section(5, 'Three futures', <><p className="note">{t.futuresAsk}</p><div className="ns-futures">{t.futures.map((future, i) =>
      <article className="ns-item" key={future.name}><h4>{future.name}</h4><p>{future.provocation}</p><p><b>Evidence required:</b> {future.evidence}</p>
        {field(`future.${i}.excites`, 'What excites?', null, true)}{field(`future.${i}.value`, 'Durable value', null, true)}
        {field(`future.${i}.plausible`, 'What is plausible?', null, true)}{field(`future.${i}.combination`, 'Combination note', null, true)}</article>)}</div>
      <p className="note">Do not choose an implementation architecture in this session.</p></>)}

    {section(6, 'Convert ambition into a North Star', <><p className="hint">{t.sentenceAid}</p><div className="ns-grid">
      {field('draft.horizon', 'Horizon')}{field('draft.identity', 'Strategic identity')}{field('draft.market', 'Customer / market')}
      {field('draft.outcome', 'Valuable customer outcome')}{field('draft.advantage', 'Distinctive advantage')}
      {field('draft.measures', 'Measurable business outcomes')}{field('draft.principles', 'Principles')}</div>
      <p className="ns-preview"><b>Sentence preview:</b> {preview}</p>
      {field('draft.verbatim', 'Gordon’s original words (verbatim)', null, true)}
      {field('draft.challenge', 'Greatstone challenge / alternative (hypothesis)', null, true)}
      {field('draft.agreed', 'Candidate North Star — agreed in session', null, true)}
      <button type="button" className="link-button" onClick={showHistory}>See wording versions in change history</button>
      <h4>Outcome dimensions</h4><div className="ns-list">{t.dimensions.map((dimension, i) => <article className="ns-item" key={dimension}>
        <h5>{dimension}</h5><div className="ns-grid">{field(`dimension.${i}.baseline`, 'Baseline')}
          {field(`dimension.${i}.verified`, 'Baseline status', ['', 'Verified', 'Unknown'])}
          {field(`dimension.${i}.target`, 'Target and horizon')}{field(`dimension.${i}.evidence`, 'Evidence / owner')}</div></article>)}</div></>)}

    {section(7, 'Strategic boundary and design principles', <div className="ns-list">{t.boundary.map((question, i) => <article className="ns-item" key={question}>
      <h4>{question}</h4><div className="ns-grid">{field(`boundary.${i}.decision`, 'Decision / unresolved', ['', 'Decision', 'Unresolved'])}
        {field(`boundary.${i}.note`, 'Note', null, true)}</div></article>)}</div>)}

    {section(8, 'Facilitator challenge and convergence test', <div className="ns-list">{t.convergence.map((check, i) => <article className="ns-item" key={check}>
      <h4>{check}</h4><div className="ns-grid">{field(`convergence.${i}.answer`, 'Answer', ['', 'Yes', 'No', 'Partly'])}
        {field(`convergence.${i}.note`, 'Note', null, true)}</div></article>)}</div>)}

    {section(9, 'Post-workshop action and evidence handoff', <><div className="ns-actions"><button type="button" className="btn small" onClick={exportHypotheses}>Export hypotheses CSV</button>
      {canEdit && <button type="button" className="btn small" onClick={() => run(() => northStarActions.addHypothesis())}>Add hypothesis row</button>}</div>
      <div className="ns-list">{hypothesisIds.map(id => <article className="ns-item" key={id}><h4>{id}</h4><div className="ns-grid">
        {field(`hypothesis.${id}.fact`, 'Hypothesis / fact to verify', null, true)}{field(`hypothesis.${id}.evidence`, 'Evidence required', null, true)}
        {field(`hypothesis.${id}.owner`, 'Owner')}{field(`hypothesis.${id}.due`, 'Due', null, false, 'date')}
        {field(`hypothesis.${id}.link`, 'GDXP linkage')}</div>
        {f[`hypothesis.${id}.request`] ? <p>Evidence request: <button className="link-button" onClick={() => onEvidence(f[`hypothesis.${id}.request`])}>{f[`hypothesis.${id}.request`]}</button></p> :
          canEdit && <button type="button" className="btn small" disabled={!f[`hypothesis.${id}.evidence`]} onClick={() => run(() => northStarActions.sendHypothesis(id))}>Send to Evidence register</button>}</article>)}</div>
      <h4>Recommended high-priority requests</h4><div className="ns-recommendations">{t.recommendedRequests.map(request => <button type="button" key={request} className="btn small" disabled={!canEdit}
        onClick={() => run(async () => { const { id } = await northStarActions.addHypothesis(); await northStarActions.save(`hypothesis.${id}.evidence`, request); })}>Add: {request}</button>)}</div></>)}

    {section(10, 'Approval and version control', <><p className="note">{t.important}</p><p><b>Record:</b> {t.id} · <b>Next decision gate:</b> G2 — North Star</p>
      {f['convergence.6.answer'] !== 'Yes' && <p className="note">Gordon acceptance must be Yes before approval.</p>}
      <div className="ns-grid">{field('approval.status', 'Record status', ['', 'Draft', 'Confirmed in session', 'Approved', 'Approved with exceptions'])}
        {field('approval.version', 'Version')}{field('approval.date', 'Version date', null, false, 'date')}
        {field('approval.confirmationName', 'Gordon confirmation name')}{field('approval.confirmationDate', 'Gordon confirmation date', null, false, 'date')}
        {field('approval.confirmationText', 'Exact approved text', null, true)}{field('approval.otherDecisionMaker', 'Other decision-maker (if required)')}
        {field('approval.facilitator', 'Greatstone facilitator')}{field('approval.reviewer', 'Greatstone reviewer')}
        {field('approval.questions', 'Open strategic questions', null, true)}{field('approval.exceptions', 'Exceptions', null, true)}</div></>)}

    <section className="ns-section"><h3>Work plan and signed record</h3>
      {work.length ? <ul>{work.map(item => <li key={item.id}><button type="button" className="link-button" onClick={() => jumpWork(item.id)}>{item.id} · {item.task}</button>
        <Deliverables id={item.id} files={files.filter(file => file.work_package_id === item.id)} canEdit={canEdit} fileActions={fileActions} /></li>)}</ul> : <p className="note">No North Star work package was found in the current plan.</p>}
    </section>
  </div>;
}
