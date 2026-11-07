// Graph window options (FlowJo GraphSpecOptionPanel, YAxisPanel, colour
// buttons, ColorTableGenerator, transform range) and the transform menu.
// Rules: src/core/graphDisplay.ts; spec: docs/validation/ui-gaps/graph.md.
import { useState } from 'react';
import type { PlotSettings, Population } from '../core/model';
import type { Prefs } from '../core/prefs';
import { canSetForeground, canShowOutliers, canSmooth, colorRowsFromString, colorRowsToString, DEFAULT_COLOR_ROWS, DEFAULT_DOTS, dotsFromInput, GRAPH_RESOLUTIONS, SMOOTH_ON, SMOOTHING_AMOUNTS, smoothingOf, Y_MAX_DEFAULT, yMaxFromInput, type ColorRow } from '../core/graphDisplay';

export function GraphOptionsPanel(p: {
  settings: PlotSettings;
  set: (patch: Partial<PlotSettings>) => void;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  gate: Population | null; // the selected gate in the plot
  onGate: (patch: { tint?: string; tinted?: boolean }) => void;
  onAdjustColor: () => void;
}) {
  const s = p.settings, k = s.kind;
  const sm = smoothingOf(k, s, p.prefs.smoothing1D);
  const smoothed = sm > 0;
  const outliersOk = canShowOutliers(k, smoothed);
  const foreOk = canSetForeground(k, smoothed);
  return (
    <div className="graph-options" data-testid="graph-options">
      <label title="Smooth (Graph > Smooth): on stores 13; FlowJo 10 draws every amount above 0 the same">
        <input type="checkbox" disabled={!canSmooth(k)} checked={smoothed} onChange={(e) => p.set({ smoothing: e.target.checked ? SMOOTH_ON : 0 })} data-testid="display-smooth" /> Smooth
      </label>{' '}
      <label>Smoothing <select disabled={!canSmooth(k)} value={smoothed ? String(sm) : 'None'} onChange={(e) => p.set({ smoothing: e.target.value === 'None' ? 0 : Number(e.target.value) })} data-testid="display-smoothing">
        <option value="None">None</option>
        {SMOOTHING_AMOUNTS.map((v) => <option key={v} value={v}>{v}</option>)}
      </select></label>
      <label title="Contours always; pseudocolor, density and zebra while smoothed">
        <input type="checkbox" disabled={!outliersOk} checked={outliersOk && !!s.showOutliers} onChange={(e) => p.set({ showOutliers: e.target.checked })} data-testid="display-outliers" /> Show Outliers
      </label>
      <label>Resolution <select value={s.resolution ?? 256} onChange={(e) => p.set({ resolution: Number(e.target.value) === 256 ? undefined : Number(e.target.value) })} data-testid="display-resolution" title="Histogram cells per axis; 2048 and 4096 draw at 1024 here">
        {GRAPH_RESOLUTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
      </select></label>
      <label title="Dot plots: number of events drawn (0 to 100000; 0 becomes 100)"># Dots <input type="number" min={0} max={100000} disabled={k !== 'dot'} style={{ width: 70 }} value={s.nDots ?? p.prefs.dotsToDraw ?? DEFAULT_DOTS} onChange={(e) => p.set({ nDots: dotsFromInput(Number(e.target.value)) })} data-testid="display-ndots" /></label>
      <label title="Set Y Axis Range (histograms)">Y Axis <select disabled={k !== 'histogram'} value={s.yMax === undefined ? 'auto' : 'manual'} onChange={(e) => p.set({ yMax: e.target.value === 'auto' ? undefined : Y_MAX_DEFAULT })} data-testid="display-yaxis">
        <option value="auto">Auto</option><option value="manual">Manual</option>
      </select></label>
      {k === 'histogram' && s.yMax !== undefined && <input type="number" min={0} style={{ width: 70 }} value={s.yMax} onChange={(e) => p.set({ yMax: yMaxFromInput(Number(e.target.value)) })} data-testid="display-ymax" />}
      <label title="Foreground: dots, histogram curve, contour lines, outliers (not pseudocolor)">Foreground <input type="color" disabled={!foreOk} value={s.foreColor ?? '#000000'} onChange={(e) => p.set({ foreColor: e.target.value })} data-testid="display-forecolor" /></label>
      <label>Background <input type="color" value={s.backColor ?? '#ffffff'} onChange={(e) => p.set({ backColor: e.target.value === '#ffffff' ? undefined : e.target.value })} data-testid="display-backcolor" /></label>
      <label title="Preference: log axis labels as 10 with superscript exponents">
        <input type="checkbox" checked={p.prefs.scientificNotation} onChange={(e) => p.setPrefs({ ...p.prefs, scientificNotation: e.target.checked })} data-testid="display-scinot" /> Use Scientific Notation
      </label>
      {p.prefs.adjustColor && <button disabled={!(smoothed || k === 'contour')} onClick={p.onAdjustColor} data-testid="display-adjust-color">Adjust color table...</button>}
      <span title="Gate colour and Tint of the selected gate">
        Gate <input type="color" disabled={!p.gate} value={p.gate?.tint ?? '#111111'} onChange={(e) => p.onGate({ tint: e.target.value })} data-testid="gate-color" />
        <label><input type="checkbox" disabled={!p.gate} checked={!!p.gate?.tinted} onChange={(e) => p.onGate({ tinted: e.target.checked })} data-testid="gate-tint" /> Tint</label>
      </span>
    </div>
  );
}

// Adjust color table (ColorTableGenerator): rows of start / end colour,
// entries and linear / log; Apply keeps the dialog open, OK closes.
export function ColorTableDialog(p: { value: string; onApply: (v: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<ColorRow[]>(() => (p.value ? colorRowsFromString(p.value) : DEFAULT_COLOR_ROWS));
  const edit = (i: number, patch: Partial<ColorRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="modal-bg"><div className="modal" role="dialog" aria-label="Adjust color table" data-testid="color-table-dialog"><div className="modal-body">
      <h3>Adjust color table</h3>
      {rows.map((r, i) => (
        <div key={i} className="row">
          Color {i + 1}: Start <input type="color" value={r.start} onChange={(e) => edit(i, { start: e.target.value })} data-testid={`ct-start-${i}`} />
          End <input type="color" value={r.end} onChange={(e) => edit(i, { end: e.target.value })} data-testid={`ct-end-${i}`} />
          <label><input type="radio" checked={!r.log} onChange={() => edit(i, { log: false })} /> Linear</label>
          <label><input type="radio" checked={r.log} onChange={() => edit(i, { log: true })} /> Log</label>
          Entries <input type="number" min={1} max={100} style={{ width: 50 }} value={r.entries} onChange={(e) => edit(i, { entries: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} data-testid={`ct-entries-${i}`} />
          <button className="x" onClick={() => setRows(rows.filter((_, k) => k !== i))} disabled={rows.length < 2}>x</button>
        </div>
      ))}
      <button onClick={() => setRows([...rows, { ...rows[rows.length - 1] }])} data-testid="ct-add">Add row</button>{' '}
      <button onClick={() => setRows(DEFAULT_COLOR_ROWS)} data-testid="ct-default">Default</button>
      <div>
        <button onClick={p.onClose}>Cancel</button>{' '}
        <button onClick={() => p.onApply(colorRowsToString(rows))} data-testid="ct-apply">Apply</button>{' '}
        <button onClick={() => { p.onApply(colorRowsToString(rows)); p.onClose(); }} data-testid="ct-ok">OK</button>
      </div>
    </div></div></div>
  );
}

// Change Displayed Parameter Range: displayed minimum and maximum in scale units.
export function RangeDialog(p: { channel: string; min: number; max: number; onApply: (min: number, max: number) => string | null; onClose: () => void }) {
  const [min, setMin] = useState(String(+p.min.toPrecision(6)));
  const [max, setMax] = useState(String(+p.max.toPrecision(6)));
  const [err, setErr] = useState('');
  return (
    <div className="modal-bg"><div className="modal" role="dialog" aria-label="Change displayed parameter range" data-testid="range-dialog"><div className="modal-body">
      <h3>Displayed range of {p.channel}</h3>
      <label>Minimum <input value={min} onChange={(e) => setMin(e.target.value)} data-testid="range-min" /></label>{' '}
      <label>Maximum <input value={max} onChange={(e) => setMax(e.target.value)} data-testid="range-max" /></label>
      {err && <p className="error" data-testid="range-error">{err}</p>}
      <div>
        <button onClick={p.onClose}>Cancel</button>{' '}
        <button data-testid="range-ok" onClick={() => { const e = p.onApply(Number(min), Number(max)); if (e) setErr(e); else p.onClose(); }}>OK</button>
      </div>
    </div></div></div>
  );
}
