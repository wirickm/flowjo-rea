// Compensation Matrix Editor views (FlowJo 10.6.2 MatrixNxNPanel,
// MatrixEditorNavPanel, SpectralWeightsDialog; docs/validation/ui-gaps/
// compensation.md): the live plot grid of the preview population compensated
// with the matrix being edited, and the spectral weights panel.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpilloverMatrix, WeightOptimizationModel } from '../core/compensation';
import { compensateEvents, gridCells, parseWeightsCsv, PLOT_SIZE, weightsCsv, WEIGHTS_FILE, type CompView } from '../core/compEditor';
import { makeTransform, type TransformSpec } from '../core/transforms';
import { loadPrefs } from '../core/prefs';
import { EVENT_BASED, eventModelForLambda, eventModelFromResult, hasCustomWeights, LAMBDA_INFO, METHOD_DIALOG_TITLE, OVERWRITE_PROMPT, parseLambda, PROGRESS_NOTE, SAMPLE_BASED } from '../core/weightOptimizer';

// Drag type of the Matrix Icon (plat.comp.apply.drag): drop it on a sample or
// group to apply the matrix there.
export const MATRIX_DRAG_TYPE = 'application/x-flowjo-rea-matrix';

const COMP = 'rgba(25, 45, 160, 0.65)';
const RAW = 'rgba(215, 60, 50, 0.45)';
const DEFAULT_SPEC: TransformSpec = { kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 };

function median(a: Float32Array): number {
  const v = Float32Array.from(a).filter((x) => Number.isFinite(x)).sort();
  return v.length ? v[v.length >> 1] : NaN;
}

interface Scale { f: (x: number) => number; lo: number; hi: number }
function scaleFor(spec: TransformSpec | undefined, cols: Float32Array[]): Scale {
  const t = makeTransform(spec ?? DEFAULT_SPEC);
  let lo = t.displayMin, hi = t.displayMax;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    const all = cols.flatMap((c) => Array.from(c)).filter((x) => Number.isFinite(x)).map(t.apply).sort((a, b) => a - b);
    lo = all[Math.floor(all.length * 0.005)] ?? 0;
    hi = all[Math.floor(all.length * 0.995)] ?? 1;
    if (!(hi > lo)) hi = lo + 1;
  }
  return { f: t.apply, lo, hi };
}

function Cell(p: { size: number; x: string; y: string | null; comp: Record<string, Float32Array>; raw: Record<string, Float32Array> | null; scales: Record<string, Scale> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cx = p.comp[p.x], cy = p.y ? p.comp[p.y] : null;
  const rx = p.raw?.[p.x] ?? null, ry = p.y ? p.raw?.[p.y] ?? null : null;
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx || !cx) return;
    const S = p.size, sx = p.scales[p.x], sy = p.y ? p.scales[p.y] : null;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, S, S);
    const px = (v: number) => ((sx.f(v) - sx.lo) / (sx.hi - sx.lo)) * (S - 1);
    if (sy && cy) {
      const py = (v: number) => (S - 1) - ((sy.f(v) - sy.lo) / (sy.hi - sy.lo)) * (S - 1);
      const dots = (xs: Float32Array, ys: Float32Array, color: string) => {
        ctx.fillStyle = color;
        for (let i = 0; i < xs.length; i++) {
          const a = px(xs[i]), b = py(ys[i]);
          if (Number.isFinite(a) && Number.isFinite(b)) ctx.fillRect(Math.min(S - 1, Math.max(0, a)), Math.min(S - 1, Math.max(0, b)), 1, 1);
        }
      };
      if (rx && ry) dots(rx, ry, RAW);
      dots(cx, cy, COMP);
    } else {
      const B = Math.max(16, Math.min(128, Math.floor(S / 2)));
      const hist = (xs: Float32Array) => {
        const h = new Float64Array(B);
        for (const v of xs) { const k = Math.floor((px(v) / S) * B); if (Number.isFinite(k)) h[Math.min(B - 1, Math.max(0, k))]++; }
        return h;
      };
      const hs = [rx ? hist(rx) : null, hist(cx)];
      const max = Math.max(1, ...hs.flatMap((h) => (h ? Array.from(h) : [])));
      hs.forEach((h, k) => {
        if (!h) return;
        ctx.strokeStyle = k === 0 ? RAW : COMP;
        ctx.beginPath();
        h.forEach((c, i) => { const X = ((i + 0.5) / B) * S, Y = S - 1 - (c / max) * (S - 4); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        ctx.stroke();
      });
    }
    ctx.strokeStyle = '#8a94a6';
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }, [p.size, cx, cy, rx, ry, p.scales, p.x, p.y]);
  return (
    <canvas ref={ref} width={p.size} height={p.size} data-testid={`comp-cell-${p.x}-${p.y ?? ''}`} data-mx={cx ? +median(cx).toPrecision(4) : ''} data-my={cy ? +median(cy).toPrecision(4) : ''}
      title={p.y ? `${p.y} (y) vs ${p.x} (x)` : p.x} />
  );
}

// The grid: N x N (upper triangle, x = later channel, y = earlier channel),
// All By (one row against a chosen channel) or Histograms. Overlay draws the
// uncompensated events under the compensated ones.
export function CompPlotGrid(p: {
  raw: Record<string, Float32Array>;
  matrix: SpilloverMatrix;
  channels: string[]; // visible output channels, in matrix order
  view: CompView;
  overlay: boolean;
  zoom: number; // percent
  transformFor: (ch: string) => TransformSpec | undefined;
}) {
  const res = useMemo(() => {
    try { return { comp: compensateEvents(p.raw, p.matrix), error: '' }; } catch (e) { return { comp: null, error: (e as Error).message }; }
  }, [p.raw, p.matrix]);
  // Overlay (plat.comp.matrix.overlay.raw): the uncompensated primary
  // detectors; a spectral matrix has no per-fluorochrome detector, so none.
  const rawLayer = p.overlay && res.comp && p.channels.every((c) => p.raw[c]) ? p.raw : null;
  const scales = useMemo(() => {
    const out: Record<string, Scale> = {};
    if (res.comp) for (const c of p.channels) out[c] = scaleFor(p.transformFor(c), [res.comp[c], ...(p.raw[c] ? [p.raw[c]] : [])].filter(Boolean));
    return out;
    // Scales follow the data once per matrix shape, not every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channels.join('|'), p.raw, !!res.comp]);
  if (!res.comp) return <p className="error" data-testid="comp-grid-error">{res.error}</p>;
  const cells = gridCells(p.view, p.channels).filter((c) => res.comp![c.x] && (!c.y || res.comp![c.y]));
  const size = Math.max(16, Math.round((PLOT_SIZE * p.zoom) / 100));
  const nxn = p.view.kind === 'nxn';
  const cols = nxn ? p.channels.length : Math.max(1, cells.length);
  const rows = nxn ? Math.max(1, p.channels.length - 1) : 1;
  return (
    <div className="comp-grid-wrap" style={{ overflow: 'auto', maxHeight: 520, border: '1px solid #d3d9e3' }}>
      <div data-testid="comp-grid" data-zoom={Math.round(p.zoom)} style={{ display: 'inline-grid', gridTemplateColumns: `auto repeat(${cols - (nxn ? 1 : 0)}, ${size}px)`, gap: 2, padding: 4, fontSize: 10 }}>
        <div />
        {(nxn ? p.channels.slice(1) : cells.map((c) => c.x)).map((c, k) => <div key={`h${k}`} style={{ textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{c}</div>)}
        {Array.from({ length: rows }, (_, r) => {
          const rowCells = nxn ? p.channels.slice(1).map((_, k) => cells.find((c) => c.row === r && c.col === k + 1) ?? null) : cells;
          const label = nxn ? p.channels[r] : p.view.kind === 'allby' ? p.view.channel : 'Count';
          return [
            <div key={`l${r}`} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center', whiteSpace: 'nowrap' }}>{label}</div>,
            ...rowCells.map((c, k) => (c ? <Cell key={`${r}-${k}`} size={size} x={c.x} y={c.y} comp={res.comp!} raw={rawLayer} scales={scales} /> : <div key={`${r}-${k}`} />)),
          ];
        })}
      </div>
    </div>
  );
}

// Spectral weights (SpectralWeightsDialog): a read-only S# / Detectors /
// Weights table with Import Weights, Export Weights and Close; Close keeps
// the weights for the next unmixing.
export function WeightsPanel(p: { matrix: SpilloverMatrix; onClose: (weights: number[]) => void; save: (name: string, text: string) => void }) {
  const [w, setW] = useState<number[]>(p.matrix.weights ?? p.matrix.channels.map(() => 1));
  const [err, setErr] = useState('');
  return (
    <div data-testid="comp-weights-panel" style={{ border: '1px solid #c7cfdc', padding: 6, margin: '6px 0' }}>
      <b>Weights Preview</b>
      <table className="grid" data-testid="comp-weights-table">
        <thead><tr><th>S#</th><th>Detectors</th><th>Weights</th></tr></thead>
        <tbody>{p.matrix.channels.map((d, i) => <tr key={d}><td>{i + 1}</td><td>{d}</td><td>{w[i]}</td></tr>)}</tbody>
      </table>
      {err && <p className="error" data-testid="comp-weights-error">{err}</p>}
      <div className="row">
        <label className="file-btn">Import Weights
          <input type="file" accept=".csv,.txt" data-testid="comp-weights-import" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { setW(parseWeightsCsv(await f.text(), p.matrix.channels)); setErr(''); } catch (x) { setErr((x as Error).message); }
            e.target.value = '';
          }} />
        </label>
        <button data-testid="comp-weights-export" onClick={() => p.save(WEIGHTS_FILE, weightsCsv(p.matrix.channels, w))}>Export Weights</button>
        <button data-testid="comp-weights-close" onClick={() => p.onClose(w)}>Close</button>
      </div>
    </div>
  );
}

// Optimize Weights (CompCommand.OPTIMIZEWT): one single-stain control per
// fluorochrome with its positive and negative populations; asks before
// overwriting customized weights. With the Event Based Weight Optimization
// preference on, the "Weight Optimization Selection" dialog
// (OptimizeWeightDialog) chooses the method first: Sample Based runs the SSM
// search and stores weights and SSM; Event Based with Lambda 0 computes
// variance based lambdas and the SSM; another Lambda is stored on the matrix
// without a run. Close runs nothing.
export type PopPick = { sampleId: string; path: string };
export interface WeightOptResult { weights: number[]; ssm: number[][]; iterations: number }
export interface EventOptResult { lambdas: { name: string; value: number }[]; ssm: number[][] }
type Progress = (pr: { fraction: number; message: string }) => void;
export function OptimizeWeightsPanel(p: {
  matrix: SpilloverMatrix;
  samples: { id: string; fileName: string; loaded: boolean; paths: string[] }[];
  onRun: (controls: { pos: PopPick; neg: PopPick }[], onProgress: Progress, cancelled: () => boolean) => Promise<WeightOptResult | null>;
  onRunEvent?: (controls: { pos: PopPick; neg: PopPick }[], onProgress: Progress, cancelled: () => boolean) => Promise<EventOptResult | null>;
  onDone: (r: WeightOptResult) => void;
  // Event-based model (and SSM when the engine ran) to store on the matrix.
  onEventModel?: (model: WeightOptimizationModel, ssm?: number[][]) => void;
  onClearWeights?: () => void;
  onClose: () => void;
}) {
  const fluors = p.matrix.outputNames ?? p.matrix.values.map((_, k) => `Fluor ${k + 1}`);
  const [picks, setPicks] = useState<Record<string, { pos: string; neg: string }>>({});
  const [ask, setAsk] = useState(false);
  const [choose, setChoose] = useState(false);
  const [method, setMethod] = useState(SAMPLE_BASED);
  const [lambdaText, setLambdaText] = useState('0');
  const lastGood = useRef('0');
  const [running, setRunning] = useState(false);
  const [eventRun, setEventRun] = useState(false);
  const [prog, setProg] = useState<{ fraction: number; message: string } | null>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const cancel = useRef(false);
  const options = p.samples.filter((s) => s.loaded).flatMap((s) => s.paths.map((path) => ({ v: `${s.id}|${path}`, label: `${s.fileName}: ${path}` })));
  const split = (v: string): PopPick => ({ sampleId: v.slice(0, v.indexOf('|')), path: v.slice(v.indexOf('|') + 1) });
  const ready = fluors.every((f) => picks[f]?.pos && picks[f]?.neg);
  const controls = () => fluors.map((f) => ({ pos: split(picks[f].pos), neg: split(picks[f].neg) }));
  const runWith = async (body: () => Promise<string | null>, event = false) => {
    setErr(''); setDone(''); setRunning(true); setEventRun(event); cancel.current = false;
    try { const msg = await body(); if (msg) setDone(msg); } catch (e) { setErr((e as Error).message); }
    setRunning(false); setProg(null);
  };
  const runSample = () => runWith(async () => {
    const r = await p.onRun(controls(), setProg, () => cancel.current);
    if (!r) return null;
    p.onDone(r);
    return `Done. ${r.iterations} iterations; SSM sum ${r.ssm.flat().reduce((s, v) => s + v, 0).toFixed(3)}.`;
  });
  const runEvent = () => runWith(async () => {
    const r = await p.onRunEvent!(controls(), setProg, () => cancel.current);
    if (!r) return null;
    p.onEventModel?.(eventModelFromResult(r.lambdas), r.ssm);
    return `Done. Event based: variance based lambdas ${r.lambdas.map((l) => `${l.name} ${+l.value.toPrecision(4)}`).join(', ')}; SSM sum ${r.ssm.flat().reduce((s, v) => s + v, 0).toFixed(3)}.`;
  }, true);
  // CompensationAction OPTIMIZEWT after shouldOptimize: the preference is read
  // at each click (isEventOptimizationEnabledInPrefs) and every click opens a
  // new dialog (Sample Based, Lambda 0).
  const proceed = () => {
    setAsk(false);
    if (loadPrefs().eventWeightOptimization && p.onRunEvent) { setMethod(SAMPLE_BASED); setLambdaText('0'); lastGood.current = '0'; setChoose(true); } else runSample();
  };
  // The Lambda field's verifier: an invalid value goes back to the last good
  // one and the click that left the field does nothing.
  const verifyLambda = (): number | null => {
    const v = parseLambda(lambdaText);
    if (v === null) { setLambdaText(lastGood.current); return null; }
    lastGood.current = lambdaText;
    return v;
  };
  const ok = () => {
    if (method === SAMPLE_BASED) { setChoose(false); runSample(); return; }
    const v = verifyLambda();
    if (v === null) return;
    setChoose(false);
    const { runEngine, model } = eventModelForLambda(v);
    if (runEngine) { runEvent(); return; }
    p.onEventModel?.(model);
    setErr('');
    setDone(`Lambda ${model.lambda} stored on the matrix: events are unmixed with weights 1 / (value + lambda).`);
  };
  return (
    <div data-testid="comp-optimize-panel" style={{ border: '1px solid #c7cfdc', padding: 6, margin: '6px 0' }}>
      <b>Optimize Weights</b>
      <p className="muted">Sample Based Weight Optimization: detector weights that minimise the sum of the spillover spreading matrix of these single-stain controls.</p>
      <table className="grid">
        <thead><tr><th>Fluorochrome</th><th>Positive</th><th>Negative</th></tr></thead>
        <tbody>{fluors.map((f) => {
          const r = picks[f] ?? { pos: '', neg: '' };
          const set = (patch: Partial<typeof r>) => setPicks({ ...picks, [f]: { ...r, ...patch } });
          return (
            <tr key={f}>
              <td>{f}</td>
              <td><select data-testid={`comp-opt-pos-${f}`} value={r.pos} onChange={(e) => set({ pos: e.target.value })}><option value="">-</option>{options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></td>
              <td><select data-testid={`comp-opt-neg-${f}`} value={r.neg} onChange={(e) => set({ neg: e.target.value })}><option value="">-</option>{options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></td>
            </tr>
          );
        })}</tbody>
      </table>
      {ask && (
        <div className="row" data-testid="comp-opt-confirm">
          <span>{OVERWRITE_PROMPT}</span>
          <button data-testid="comp-opt-yes" onClick={() => { p.onClearWeights?.(); proceed(); }}>Yes</button>
          <button data-testid="comp-opt-no" onClick={() => setAsk(false)}>No</button>
        </div>
      )}
      {choose && (
        <div role="group" aria-label={METHOD_DIALOG_TITLE} data-testid="comp-opt-method-dialog" style={{ border: '1px solid #8a94a6', padding: 8, margin: '6px 0', background: '#f7f9fc' }}>
          <b>{METHOD_DIALOG_TITLE}</b>
          <div className="row">
            <select data-testid="comp-opt-method" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 300 }}>
              <option value={SAMPLE_BASED}>{SAMPLE_BASED}</option>
              <option value={EVENT_BASED}>{EVENT_BASED}</option>
            </select>
          </div>
          {method === EVENT_BASED && (
            <div className="row" data-testid="comp-opt-lambda-row">
              <label>Lambda <input data-testid="comp-opt-lambda" style={{ width: 70, textAlign: 'right' }} value={lambdaText}
                onChange={(e) => setLambdaText(e.target.value.replace(/[^0-9.eE+-]/g, ''))} onBlur={verifyLambda} /></label>
              <b data-testid="comp-opt-lambda-info">{LAMBDA_INFO}</b>
            </div>
          )}
          <div className="row">
            <button data-testid="comp-opt-method-ok" onMouseDown={(e) => e.preventDefault()} onClick={ok}>OK</button>
            <button data-testid="comp-opt-method-close" onClick={() => setChoose(false)}>Close</button>
          </div>
        </div>
      )}
      {running && prog && (
        <div data-testid="comp-opt-progress">
          <progress max={1} value={prog.fraction} style={{ width: 240 }} /> <span data-testid="comp-opt-message">{prog.message}</span>
          {!eventRun && <p className="muted">{PROGRESS_NOTE}</p>}
        </div>
      )}
      {err && <p className="error" data-testid="comp-opt-error">{err}</p>}
      {done && <p data-testid="comp-opt-done">{done}</p>}
      <div className="row">
        <button disabled={!ready || running || choose} data-testid="comp-opt-run" title={ready ? '' : 'Choose a positive and a negative population for every fluorochrome'} onClick={() => (hasCustomWeights(p.matrix.weights) ? setAsk(true) : proceed())}>Optimize</button>
        {running && <button data-testid="comp-opt-cancel" onClick={() => { cancel.current = true; }}>Cancel</button>}
        <button disabled={running} data-testid="comp-opt-close" onClick={p.onClose}>Close</button>
      </div>
    </div>
  );
}
