import React, { useEffect, useRef } from 'react';
import { OPT, toneFor } from '../model/options.mjs';

export function Pill({ status, tone, children }) {
  const text = children ?? (status || '—');
  return <span className={`pill ${tone || toneFor(status)}`}>{text}</span>;
}

export function Bar({ percent, label }) {
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

// Text, date and long-text fields save when they lose focus (or on Enter for
// one-line fields), like v1. A new value from another user resets the field.
export function EditText({ value, onCommit, label, canEdit, multiline, type = 'text', placeholder, inputMode, empty = '—' }) {
  const v = value ?? '';
  if (!canEdit) return v ? <span className="ro">{v}</span> : <span className="empty">{empty}</span>;
  const commit = (e) => { if (e.target.value !== v) onCommit(e.target.value); };
  const common = { defaultValue: v, 'aria-label': label, placeholder, onBlur: commit };
  if (multiline) return <textarea key={v} {...common} rows={2} />;
  return (
    <input
      key={v}
      {...common}
      type={type}
      inputMode={inputMode}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

export function EditSelect({ options, value, onCommit, label, canEdit }) {
  if (!canEdit) return <Pill status={value} />;
  const list = OPT[options].slice();
  if (value && !list.includes(value)) list.push(value);
  return (
    <select value={value ?? ''} aria-label={label} onChange={(e) => onCommit(e.target.value)}>
      {list.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
    </select>
  );
}

// Tabs with roving focus: arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
export function TabList({ tabs, current, onSelect, label, className = 'tabs', tabClass = 'tab', idPrefix }) {
  const refs = useRef([]);
  // Keep the selected tab visible when the strip scrolls sideways on a phone.
  useEffect(() => {
    const el = refs.current[tabs.findIndex((t) => t.id === current)];
    const strip = el?.parentElement;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    if (el.offsetLeft < strip.scrollLeft) strip.scrollLeft = el.offsetLeft;
    else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = el.offsetLeft + el.offsetWidth - strip.clientWidth;
  }, [current]);
  const onKeyDown = (e, i) => {
    const last = tabs.length - 1;
    const to = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    refs.current[to]?.focus();
    onSelect(tabs[to].id);
  };
  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          data-tab={t.id}
          className={tabClass}
          aria-selected={t.id === current}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={t.id === current ? 0 : -1}
          onClick={() => onSelect(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
          {t.src && <span className="src">{t.src}</span>}
          {t.count != null && <span className="c">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Kpis({ items }) {
  return (
    <div className="kpis">
      {items.map((k) => (
        <div key={k.label} className="kpi">
          <div className={`v${k.highlight ? ' hl' : ''}${k.alert ? ' alert' : ''}`}>{k.value}</div>
          <div className="l">{k.label}</div>
          {k.src && <div className="src">{k.src}</div>}
        </div>
      ))}
    </div>
  );
}

export function FilterSelect({ value, onChange, all, options, label }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{all}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export const Governs = ({ children }) => <span className="governs">{children}</span>;
