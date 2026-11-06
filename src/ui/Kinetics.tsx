// FlowJo 10.6.2 Kinetics window (specs 11): statistic, percentile, smoothing
// and threshold of the time series; timeslices made by dragging on the plot,
// edited in the table, as multiple ranges or by auto slicing; the timeslice
// table (Start t, End t, Peak t, Peak, Mean Y, Slope, AUC, dt) and Copy Time
// Series. Settings are saved per population in the workspace.
import { useEffect, useRef, useState } from 'react';
import {
  ALL_EVENTS, autoSlices, copyTimeSeries, KINETICS_SMOOTHING, KINETICS_STATS, multiSlices, rangeName, SLICE_COLORS, uniqueSliceName, usesPercentile, usesThreshold,
  type KineticsSettings, type KineticsSmoothing, type KineticsStat, type Timeslice,
} from '../core/kinetics';
import type { KineticsReport } from '../core/service';

interface Props {
  channels: string[];
  settings: KineticsSettings;
  onSettings: (s: KineticsSettings) => void;
  onAddToTable: (timeslices: string[]) => void;
  run: (s: KineticsSettings) => Promise<KineticsReport | undefined>;
}

// Times print as whole numbers; values with 2 to 3 decimals; a zero slope "0".
const tfmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : 'NaN');
const vfmt = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) : 'NaN');
const sfmt = (v: number) => (v === 0 ? '0' : vfmt(v));

export function KineticsPanel(p: Props) {
  const s = p.settings;
  const [rep, setRep] = useState<KineticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [naming, setNaming] = useState<{ name: string; slice: Omit<Timeslice, 'name'> } | null>(null);
  const [editing, setEditing] = useState<{ old: string; name: string; start: string; end: string } | null>(null);
  const [thresh, setThresh] = useState<{ kind: 'absolute' | 'percentile'; value: string; percentile: string; timeslice: string } | null>(null);
  const [multi, setMulti] = useState<{ prefix: string; number: string } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const set = (patch: Partial<KineticsSettings>) => p.onSettings({ ...s, ...patch });

  useEffect(() => {
    let live = true;
    setError(null);
    p.run(s).then((r) => live && setRep(r ?? null)).catch((e) => { if (live) { setRep(null); setError((e as Error).message); } });
    return () => { live = false; };
  }, [JSON.stringify(s)]); // eslint-disable-line react-hooks/exhaustive-deps

  const W = 520, H = 200;
  const n = rep?.values.length ?? 0;
  let ymin = 0, ymax = 1;
  if (rep) {
    const nz = Array.from(rep.values).filter((v) => v !== 0);
    if (nz.length) { ymin = Math.min(...nz); ymax = Math.max(...nz); }
    // FlowJo pads the auto Y range: min x 0.97 (x 1.03 when negative), max x 1.03.
    ymin = ymin < 0 ? ymin * 1.03 : ymin * 0.97;
    ymax *= 1.03;
    if (!(ymax > ymin)) ymax = ymin + 1;
  }
  // Timeslice times are in the X (Time) parameter's scale units: a drag maps
  // the plot width onto its scale width, as FlowJo does.
  const tw = rep?.timeWidth || 1;
  const px = (t: number) => (t / tw) * W;
  const tAt = (x: number) => Math.max(0, (x / W) * tw);
  const ix = (i: number) => (n ? (i / n) * W : 0);
  const py = (v: number) => H - ((v - ymin) / (ymax - ymin)) * H;
  const local = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const names = () => [ALL_EVENTS, ...s.timeslices.map((x) => x.name)];
  const nextColor = () => SLICE_COLORS[s.timeslices.length % SLICE_COLORS.length];
  const slices = rep?.slices ?? [];

  return (
    <div data-testid="kin-panel">
      <div className="row">
        Y <select data-testid="kin-y" value={s.yAxis} onChange={(e) => set({ yAxis: e.target.value })}>{p.channels.map((c) => <option key={c}>{c}</option>)}</select>
        <select data-testid="kin-stat" value={s.statistic} onChange={(e) => set({ statistic: e.target.value as KineticsStat })}>{KINETICS_STATS.map((k) => <option key={k}>{k}</option>)}</select>
        {usesPercentile(s.statistic) && <>Percentile <input data-testid="kin-percentile" type="number" min={1} max={99} value={s.percentile} onChange={(e) => set({ percentile: Number(e.target.value) })} style={{ width: 50 }} /></>}
        Smoothing <select data-testid="kin-smoothing" value={s.smoothing} onChange={(e) => set({ smoothing: e.target.value as KineticsSmoothing })}>{KINETICS_SMOOTHING.map((k) => <option key={k}>{k}</option>)}</select>
        {usesThreshold(s.statistic) && <button data-testid="kin-threshold" onClick={() => setThresh({ kind: s.threshold?.kind ?? 'absolute', value: String(s.threshold?.kind === 'absolute' ? s.threshold.value : 0.1), percentile: String(s.threshold?.kind === 'percentile' ? s.threshold.percentile : 95), timeslice: (s.threshold?.kind === 'percentile' ? s.threshold.timeslice : s.timeslices[0]?.name) ?? '' })}>Threshold{rep?.threshold !== null && rep?.threshold !== undefined ? ` (T = ${vfmt(rep.threshold)})` : '...'}</button>}
      </div>
      <div className="row">
        <button data-testid="kin-multi" onClick={() => setMulti({ prefix: '', number: '5' })}>Multiple ranges...</button>
        <button data-testid="kin-auto" disabled={!rep} onClick={() => {
          // Auto slicing toggles: off removes the "Auto #" slices.
          if (s.autoSlice && s.timeslices.length > 1) set({ autoSlice: false, timeslices: s.timeslices.filter((x) => !x.name.startsWith('Auto #')) });
          else if (rep) set({ autoSlice: true, timeslices: [...s.timeslices, ...autoSlices(rep.values, names().length, rep.scale)] });
        }}>{s.autoSlice ? 'Auto slice: on' : 'Auto slice'}</button>
        <button data-testid="kin-copy-series" disabled={!rep} onClick={() => rep && navigator.clipboard?.writeText(copyTimeSeries(rep.values, rep.scale))}>Copy Time Series</button>
        <span className="muted">drag on the plot to make a timeslice</span>
      </div>
      {error && <p className="error" data-testid="kin-error">{error}</p>}
      {thresh && (
        <div className="row" data-testid="kin-threshold-form">
          <b>Define new threshold value</b>
          <label><input type="radio" checked={thresh.kind === 'absolute'} onChange={() => setThresh({ ...thresh, kind: 'absolute' })} /> Use absolute value</label>
          <input data-testid="kin-th-value" value={thresh.value} onChange={(e) => setThresh({ ...thresh, value: e.target.value })} size={8} />
          <label><input type="radio" disabled={!s.timeslices.length} checked={thresh.kind === 'percentile'} onChange={() => setThresh({ ...thresh, kind: 'percentile' })} /> Use percentile of events within:</label>
          <select disabled={!s.timeslices.length} value={thresh.timeslice} onChange={(e) => setThresh({ ...thresh, timeslice: e.target.value })}>{s.timeslices.map((x) => <option key={x.name}>{x.name}</option>)}</select>
          Percentile <input value={thresh.percentile} onChange={(e) => setThresh({ ...thresh, percentile: e.target.value })} size={4} />
          <button data-testid="kin-th-define" onClick={() => {
            const v = Number(thresh.value), q = Number(thresh.percentile);
            if (thresh.kind === 'absolute' && v >= 0) set({ threshold: { kind: 'absolute', value: v } });
            if (thresh.kind === 'percentile' && q >= 0 && q <= 100 && thresh.timeslice) set({ threshold: { kind: 'percentile', percentile: q, timeslice: thresh.timeslice } });
            setThresh(null);
          }}>Define</button>
          <button onClick={() => setThresh(null)}>Cancel</button>
        </div>
      )}
      {multi && rep && (
        <div className="row" data-testid="kin-multi-form">
          Prefix <input data-testid="kin-multi-prefix" value={multi.prefix} onChange={(e) => setMulti({ ...multi, prefix: e.target.value })} size={8} />
          Number <input data-testid="kin-multi-number" type="number" min={1} max={Math.max(1, Math.floor(rep.total))} value={multi.number} onChange={(e) => setMulti({ ...multi, number: e.target.value })} style={{ width: 56 }} />
          <span className="muted">duration {Math.floor(rep.total / (Number(multi.number) || 5))}</span>
          <button data-testid="kin-multi-ok" onClick={() => {
            const k = Math.floor(Number(multi.number));
            if (k >= 1) set({ timeslices: [...s.timeslices, ...multiSlices(multi.prefix, k, slices[0], names(), s.timeslices.length)] });
            setMulti(null);
          }}>OK</button>
          <button onClick={() => setMulti(null)}>Cancel</button>
        </div>
      )}
      {naming && (
        <div className="row" data-testid="kin-name-form">
          Name Timeslice <input data-testid="kin-name" value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
          <button data-testid="kin-name-ok" onClick={() => { set({ timeslices: [...s.timeslices, { ...naming.slice, name: uniqueSliceName(naming.name.trim() || rangeName(names()), names()) }] }); setNaming(null); }}>OK</button>
          <button onClick={() => setNaming(null)}>Cancel</button>
        </div>
      )}
      <svg
        ref={svg}
        data-testid="kin-chart"
        data-points={n}
        aria-label={`Time (SI Units) 0 to ${rep ? Math.round(rep.total) : 0}`}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ border: '1px solid #ccc', background: '#fff', cursor: 'crosshair' }}
        onMouseDown={(e) => { const l = local(e); setDrag({ x0: l.x, x1: l.x, y: l.y }); }}
        onMouseMove={(e) => drag && setDrag({ ...drag, x1: local(e).x })}
        onMouseUp={() => {
          if (drag && Math.abs(drag.x1 - drag.x0) > 3) {
            const a = Math.min(drag.x0, drag.x1), b = Math.max(drag.x0, drag.x1);
            setNaming({ name: rangeName(names()), slice: { startTime: tAt(a), endTime: tAt(b), y: Math.round(100 * (1 - drag.y / H)), color: nextColor() } });
          }
          setDrag(null);
        }}
      >
        {rep && <polyline fill="none" stroke="#2a7de1" strokeWidth={1.2} points={Array.from(rep.values, (v, i) => `${ix(i)},${py(v)}`).join(' ')} />}
        {s.timeslices.map((x) => {
          const yy = H * (1 - x.y / 100);
          return <g key={x.name}><line x1={px(x.startTime)} x2={px(x.endTime)} y1={yy} y2={yy} stroke={x.color} strokeWidth={2} /><text x={px(x.startTime) + 2} y={yy - 3} fontSize={10} fill={x.color}>{x.name}</text></g>;
        })}
        {drag && <rect x={Math.min(drag.x0, drag.x1)} y={0} width={Math.abs(drag.x1 - drag.x0)} height={H} fill="rgba(208,2,27,0.1)" />}
      </svg>
      {editing && (
        <div className="row" data-testid="kin-edit-form">
          Timeslice Name <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          Start Time <input data-testid="kin-edit-start" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value })} size={6} />
          End Time <input data-testid="kin-edit-end" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.target.value })} size={6} />
          <button data-testid="kin-edit-ok" onClick={() => {
            // A non-blank name is applied; times only when start < end.
            const a = Math.trunc(Number(editing.start)), b = Math.trunc(Number(editing.end));
            set({ timeslices: s.timeslices.map((x) => (x.name !== editing.old ? x : { ...x, name: editing.name.trim() || x.name, ...(a < b ? { startTime: a, endTime: b } : {}) })) });
            setEditing(null);
          }}>OK</button>
          <button onClick={() => setEditing(null)}>Cancel</button>
        </div>
      )}
      <div className="table-wrap" style={{ maxHeight: 180 }}>
        <table className="grid" data-testid="kin-table">
          <thead><tr><th>Timeslice</th><th>Start t</th><th>End t</th><th>Peak t</th><th>Peak</th><th>Mean Y</th><th>Slope</th><th>AUC</th><th>dt</th></tr></thead>
          <tbody>
            {slices.map((x) => (
              <tr key={x.name} data-testid={`kin-row-${x.name}`} className={selected.includes(x.name) ? 'sel' : ''}
                onClick={(e) => x.name !== ALL_EVENTS && setSelected(e.metaKey || e.ctrlKey ? [...selected, x.name] : [x.name])}
                onDoubleClick={() => x.name !== ALL_EVENTS && setEditing({ old: x.name, name: x.name, start: tfmt(x.startT), end: tfmt(x.endT) })}>
                <td>{x.name}</td><td>{tfmt(x.startT)}</td><td>{tfmt(x.endT)}</td><td>{tfmt(x.peakT)}</td><td>{vfmt(x.peak)}</td><td>{vfmt(x.meanY)}</td><td>{sfmt(x.slope)}</td><td>{vfmt(x.auc)}</td><td>{tfmt(x.dt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button data-testid="kin-delete" disabled={!selected.length} onClick={() => {
          if (!window.confirm('Are you sure you want to delete the selected time slices?')) return;
          set({ timeslices: s.timeslices.filter((x) => !selected.includes(x.name)) });
          setSelected([]);
        }}>Delete</button>
        <button data-testid="kin-add-table" disabled={!slices.length} title="Add the selected timeslices (or all) as statistics table columns" onClick={() => p.onAddToTable(selected.length ? selected : slices.map((x) => x.name))}>Add to table</button>
        <button data-testid="kin-copy-table" disabled={!slices.length} onClick={() => navigator.clipboard?.writeText(slices.map((x) => [x.name, tfmt(x.startT), tfmt(x.endT), tfmt(x.peakT), vfmt(x.peak), vfmt(x.meanY), sfmt(x.slope), vfmt(x.auc), tfmt(x.dt)].join('\t')).join('\n'))}>Copy</button>
      </div>
    </div>
  );
}
