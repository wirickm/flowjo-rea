// Workspace window dialogs added for the WSCommand gaps
// (docs/validation/ui-gaps/workspace.md): Boolean Expression, Boolean Gate
// Naming, Edit Columns, Add Statistic (several at once), keyword value series.
import { useState } from 'react';
import { BoolExprError, parseBoolExpr } from '../core/booleanExpr';
import type { StatKind, TableColumn } from '../core/model';
import { STAT_LABELS, STAT_NEEDS_CHANNEL, validPercentile } from '../core/stats';
import { columnLabel, DEFAULT_COLUMNS, formatSeriesValue, keywordColumn, SPECIAL_COLUMNS, valueSeries } from '../core/workspaceTable';
import { Modal } from './Dialogs';

// Boolean Expression (own rule: FlowJo 10.6.2's BooleanGateDlog is an
// unfinished stub). Mixed and / or / not with brackets over population names.
export function BooleanExprDialog(p: { title: string; initial: string; names: string[]; onOk: (expr: string) => string | null; onClose: () => void }) {
  const [text, setText] = useState(p.initial);
  const [error, setError] = useState('');
  const parseError = (() => { try { parseBoolExpr(text); return ''; } catch (e) { return e instanceof BoolExprError ? e.message : String(e); } })();
  const insert = (t: string) => setText((x) => `${x}${x && !x.endsWith(' ') && !x.endsWith('(') ? ' ' : ''}${t}`);
  return (
    <Modal title={p.title} onClose={p.onClose} wide>
      <p className="muted">Type a boolean expression of populations: and, or, not (or &amp;, |, !) and brackets. Names with spaces or operator words go in double quotes; click a population to insert it.</p>
      <textarea rows={3} style={{ width: '100%' }} value={text} onChange={(e) => { setText(e.target.value); setError(''); }} data-testid="bool-expr" autoFocus />
      <div className="row">
        {['and', 'or', 'not', '(', ')'].map((o) => <button key={o} onClick={() => insert(o)} data-testid={`bool-op-${o}`}>{o}</button>)}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {p.names.map((n) => <button key={n} className="link" onClick={() => insert(/^[^\s()&|!"]+$/.test(n) && !['and', 'or', 'not'].includes(n.toLowerCase()) ? n : `"${n}"`)} data-testid={`bool-name-${n}`}>{n}</button>)}
      </div>
      {(error || (text && parseError)) && <p className="error" data-testid="bool-expr-error">{error || parseError}</p>}
      <div className="row">
        <button disabled={!!parseError} data-testid="bool-expr-ok" onClick={() => { const err = p.onOk(text); if (err) setError(err); }}>OK</button>
        <button onClick={p.onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// Boolean Gate Naming Dialog (ComboGateNodeNamingDialog): Subset Name |
// Abbreviation; an abbreviation defaults to the name and is remembered for the
// session.
const rememberedAbbr: Record<string, string> = {};
export function NamingDialog(p: { names: string[]; onOk: (abbr: Record<string, string>) => void; onClose: () => void }) {
  const [abbr, setAbbr] = useState<Record<string, string>>(() => Object.fromEntries(p.names.map((n) => [n, rememberedAbbr[n] ?? n])));
  const ok = () => {
    const map: Record<string, string> = {};
    for (const n of p.names) {
      const v = (abbr[n] ?? '').trim();
      if (v && v !== n) { map[n] = v; rememberedAbbr[n] = v; } else delete rememberedAbbr[n];
    }
    p.onOk(map);
  };
  return (
    <Modal title="Boolean Gate Naming Dialog" onClose={p.onClose}>
      <table className="grid" data-testid="naming-table">
        <thead><tr><th>Subset Name</th><th>Abbreviation</th></tr></thead>
        <tbody>{p.names.map((n) => <tr key={n}><td>{n}</td><td><input value={abbr[n] ?? ''} onChange={(e) => setAbbr({ ...abbr, [n]: e.target.value })} data-testid={`abbr-${n}`} /></td></tr>)}</tbody>
      </table>
      <div className="row">
        <button onClick={() => setAbbr(Object.fromEntries(p.names.map((n) => [n, n])))}>Reset</button>
        <button onClick={ok} data-testid="naming-ok" autoFocus>OK</button>
        <button onClick={p.onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// Edit Columns (ColumnDP): All Column Values (special columns, then keywords)
// on the left, Columns To Display on the right; Add, Remove, Remove All,
// Default. Name stays the first column.
export function EditColumnsDialog(p: { columns: TableColumn[]; keywords: string[]; onOk: (c: TableColumn[]) => void; onClose: () => void }) {
  const [cols, setCols] = useState<TableColumn[]>(p.columns);
  const [left, setLeft] = useState<string[]>([]);
  const [right, setRight] = useState<string[]>([]);
  const all = [...SPECIAL_COLUMNS.map((c) => c.key), ...p.keywords.map(keywordColumn)];
  const shown = new Set(cols.map((c) => c.key));
  const multi = (e: React.ChangeEvent<HTMLSelectElement>) => Array.from(e.target.selectedOptions).map((o) => o.value);
  return (
    <Modal title="Edit Columns" onClose={p.onClose} wide>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <label>All Column Values<br /><select multiple size={14} style={{ minWidth: 220 }} value={left} onChange={(e) => setLeft(multi(e))} data-testid="cols-all">
          {all.filter((k) => !shown.has(k)).map((k) => <option key={k} value={k}>{columnLabel(k)}{k.startsWith('kw:') ? '' : ' (column)'}</option>)}
        </select></label>
        <div className="column">
          <button disabled={!left.length} onClick={() => { setCols([...cols, ...left.map((key) => ({ key }))]); setLeft([]); }} data-testid="cols-add" title="Add the selected items from the left to the list on the right">Add Columns &gt;</button>
          <button disabled={!right.length} onClick={() => { setCols(cols.filter((c) => c.key === DEFAULT_COLUMNS[0].key || !right.includes(c.key))); setRight([]); }} data-testid="cols-remove" title="Remove the selected items from the right side list.">&lt; Remove Columns</button>
          <button onClick={() => setCols(cols.filter((c) => c.key === DEFAULT_COLUMNS[0].key))} data-testid="cols-remove-all">Remove All</button>
          <button onClick={() => setCols(DEFAULT_COLUMNS)} data-testid="cols-default" title="Reset to default columns.">Default</button>
        </div>
        <label>Columns To Display<br /><select multiple size={14} style={{ minWidth: 220 }} value={right} onChange={(e) => setRight(multi(e))} data-testid="cols-shown">
          {cols.map((c) => <option key={c.key} value={c.key}>{columnLabel(c.key)}</option>)}
        </select></label>
      </div>
      <div className="row"><button onClick={() => p.onOk(cols)} data-testid="cols-ok">OK</button><button onClick={p.onClose}>Cancel</button></div>
    </Modal>
  );
}

// Add Statistic (WSController.addStatNodes): several statistics times several
// parameters for the selected populations at once.
export interface StatChoice { stat: StatKind; channel?: string; percentile?: number }
export function AddStatDialog(p: { targets: string[]; channels: string[]; onOk: (c: StatChoice[]) => void; onClose: () => void }) {
  const kinds = (Object.keys(STAT_LABELS) as StatKind[]).filter((k) => !['kinetic', 'freqOf', 'correlation'].includes(k));
  const [stats, setStats] = useState<StatKind[]>([]);
  const [params, setParams] = useState<string[]>([]);
  const [pct, setPct] = useState(50);
  const needs = stats.some(STAT_NEEDS_CHANNEL);
  const choices: StatChoice[] = stats.flatMap((s) => (STAT_NEEDS_CHANNEL(s) ? params.map((c) => ({ stat: s, channel: c, ...(s === 'percentile' ? { percentile: pct } : {}) })) : [{ stat: s }]));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Modal title="Add Statistic" onClose={p.onClose} wide>
      <p className="muted">For {p.targets.length === 1 ? `"${p.targets[0] || 'All events'}"` : `${p.targets.length} populations`}. Freq. of and Correlation are added from the Statistics panel.</p>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <fieldset><legend>Statistics</legend>
          {kinds.map((k) => <label key={k} style={{ display: 'block' }}><input type="checkbox" checked={stats.includes(k)} onChange={() => setStats(toggle(stats, k))} data-testid={`as-stat-${k}`} /> {STAT_LABELS[k]}</label>)}
        </fieldset>
        <fieldset disabled={!needs}><legend>Parameters</legend>
          {p.channels.map((c) => <label key={c} style={{ display: 'block' }}><input type="checkbox" checked={params.includes(c)} onChange={() => setParams(toggle(params, c))} data-testid={`as-param-${c}`} /> {c}</label>)}
        </fieldset>
      </div>
      {stats.includes('percentile') && <label>Percentile <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ width: 60 }} /></label>}
      <div className="row">
        <span className="muted" data-testid="as-count">{choices.length * p.targets.length} statistic(s)</span>
        <button disabled={!choices.length || (stats.includes('percentile') && !validPercentile(pct))} onClick={() => p.onOk(choices)} data-testid="as-ok">Add</button>
        <button onClick={p.onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// Create a Series of Values (KeywordValueSeriesDialog, Rules tab).
export interface SeriesSpec { keyword: string; values: string[] }
export function ValueSeriesDialog(p: { keywords: string[]; startName: string; available: number; onOk: (s: SeriesSpec) => void; onClose: () => void }) {
  const [keyword, setKeyword] = useState(p.keywords[0] ?? '');
  const [start, setStart] = useState(1);
  const [inc, setInc] = useState(1);
  const [mult, setMult] = useState(1);
  const [fill, setFill] = useState(Math.max(2, p.available));
  const [repeat, setRepeat] = useState(1);
  const [restart, setRestart] = useState(0);
  const values = valueSeries(fill, start, inc, mult, repeat, restart).map(formatSeriesValue);
  const num = (v: number, set: (n: number) => void, id: string, w = 60) => <input type="number" value={v} onChange={(e) => set(Number(e.target.value))} style={{ width: w }} data-testid={id} />;
  return (
    <Modal title="Create a Series of Values" onClose={p.onClose} wide>
      <div className="row">
        <label>Keyword: <input list="vs-keys" value={keyword} onChange={(e) => setKeyword(e.target.value)} data-testid="vs-keyword" /></label>
        <datalist id="vs-keys">{p.keywords.map((k) => <option key={k} value={k} />)}</datalist>
      </div>
      <div className="row">Starting Value: {num(start, setStart, 'vs-start')} Increment {num(inc, setInc, 'vs-inc')} Multiplier {num(mult, setMult, 'vs-mult')}</div>
      <div className="row">Fill {num(fill, setFill, 'vs-fill')} value(s) starting from current sample ({p.startName}).</div>
      <div className="row">Use the value {num(repeat, (n) => setRepeat(Math.max(1, n)), 'vs-repeat')} time(s) before changing to next value.</div>
      <div className="row">Start over every {num(restart, setRestart, 'vs-restart')} samples from the starting value.</div>
      <p className="muted" data-testid="vs-preview">Generated Series: {values.join(', ')}</p>
      <div className="row"><button disabled={!keyword.trim()} onClick={() => p.onOk({ keyword: keyword.trim(), values })} data-testid="vs-ok">OK</button><button onClick={p.onClose}>Cancel</button></div>
    </Modal>
  );
}
