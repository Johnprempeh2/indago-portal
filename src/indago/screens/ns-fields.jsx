import React, { useEffect, useRef, useState } from 'react';

export function Field({ name, value = '', save, canEdit, options, multiline = false, type = 'text', placeholder = '', autoFocus = false }) {
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
      multiline ? <textarea {...props} rows="3" placeholder={placeholder} autoFocus={autoFocus} /> : <input {...props} type={type} placeholder={placeholder} />}
    <span className="ns-print-value">{text || '—'}</span>
    {error && <span className="ns-error" role="alert">{error}</span>}
  </label>;
}

export function Clock({ value, save, canEdit, blocks }) {
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


// Small inputs for the guided path. Choices and toggles save on click; a
// failed save puts the earlier value back and says so.
function useInstantSave(value, save) {
  const [shown, setShown] = useState(value);
  const [error, setError] = useState('');
  useEffect(() => setShown(value), [value]);
  const pick = async next => {
    setShown(next); setError('');
    try { await save(next); } catch (e) { setShown(value); setError(`${e.message || 'Save failed.'} The earlier value is still saved.`); }
  };
  return [shown, pick, error];
}

export function Choice({ name, value = '', save, canEdit, options, disabled = () => '' }) {
  const [shown, pick, error] = useInstantSave(value, save);
  if (!canEdit) return <div className="ns-field"><span className="ns-label">{name}</span><span className="ro">{value || 'Not recorded'}</span></div>;
  return <div className="ns-field" role="group" aria-label={name}><span className="ns-label">{name}</span>
    <div className="ns-chips">{options.map(option => {
      const why = disabled(option);
      return <button key={option} type="button" className="ns-chip" aria-pressed={shown === option} disabled={!!why} title={why || undefined}
        onClick={() => pick(shown === option ? '' : option)}>{option}</button>;
    })}</div>
    {error && <span className="ns-error" role="alert">{error}</span>}
  </div>;
}

export function Toggle({ name, value = '', save, canEdit }) {
  const [shown, pick, error] = useInstantSave(value, save);
  if (!canEdit) return <span className="ns-chip static" aria-label={`${name}: ${value === 'Yes' ? 'Yes' : 'No'}`}>{value === 'Yes' ? '✓ ' : ''}{name}</span>;
  return <>
    <button type="button" className="ns-chip" aria-pressed={shown === 'Yes'} onClick={() => pick(shown === 'Yes' ? '' : 'Yes')}>{shown === 'Yes' ? '✓ ' : ''}{name}</button>
    {error && <span className="ns-error" role="alert">{error}</span>}
  </>;
}

// Long answers start folded as a short prompt, so a step never opens on a wall of empty boxes.
export function LongText({ name, value = '', save, canEdit, hint, open = false }) {
  const [shown, setShown] = useState(open || !!value);
  if (canEdit && !shown) return <button type="button" className="ns-add" onClick={() => setShown(true)}>
    <span aria-hidden="true">+</span> {name}{hint && <span className="ns-add-hint">{hint}</span>}</button>;
  return <Field name={name} value={value} save={save} canEdit={canEdit} multiline placeholder={hint} autoFocus={canEdit && !open && !value} />;
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

export const exportHypotheses = (f, ids) => downloadCsv([['ID', 'Hypothesis / fact', 'Evidence required', 'Owner', 'Due', 'GDXP linkage', 'Evidence request'],
  ...ids.map(id => [id, ...['fact', 'evidence', 'owner', 'due', 'link', 'request'].map(key => f[`hypothesis.${id}.${key}`] || '')])]);

export const northStarWork = state => state.wbs.filter(w => w.gate === 'G2' || /north star/i.test(`${w.task} ${w.ws}`));
