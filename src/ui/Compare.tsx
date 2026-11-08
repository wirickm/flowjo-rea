// FlowJo 10.6.2 Compare Populations window (PlatformNavCommand.COMPARISON,
// ComparisonFrame / ComparisonController; spec docs/validation/ui-gaps/platforms.md).
// One row per parameter: the statistics of src/core/compare.ts between the
// sample population and the comparator (control) populations, with an
// overlay of their histograms.
import { useEffect, useMemo, useState } from 'react';
import { CHI_BINS, COMPARE_CHART_H, COMPARE_CHART_W, resizeChart, compareHistograms, DEFAULT_MV_BINS, fMeasure, isNonFluorescent, isScatter, matchRatio, multivariateChi, type ChiResult, type FMeasureResult, type UnivariateResult } from '../core/compare';
import { populationPath, UNCOMP_SUFFIX } from '../core/model';
import { formatStat } from '../core/statsTable';
import { makeAxis, sampleChannels, withStains } from './axes';
import { smoothCurve } from '../core/graphDisplay';
import type { ToolCtx } from './PlatformTools';

type StatKey = 'sed' | 'overton' | 'tx' | 'ksd' | 'ksAt' | 'ksp' | 'maxT';
// ComparisonStat display order (static initializer's default list first).
const STATS: { key: StatKey; label: string }[] = [
  { key: 'sed', label: 'SE Dymax %Positive' }, { key: 'overton', label: 'Overton %Positive' }, { key: 'tx', label: 'Chi-Squared T(X)' },
  { key: 'ksd', label: 'K-S Max Difference' }, { key: 'ksAt', label: 'K-S Max at Intensity' }, { key: 'ksp', label: 'K-S Probability' },
  { key: 'maxT', label: 'Chi-Squared Max T' },
];
const DEFAULT_STATS: StatKey[] = ['sed', 'overton', 'tx', 'ksd', 'ksAt', 'ksp'];
interface PopRef { sampleId: string; path: string }
interface Row { channel: string; res: UnivariateResult; sample: Float32Array; controls: Float32Array[] }
// Comparison::MatchRatio / FMeasure per comparator (spec section 4).
interface Measure { label: string; mr: number; f: FMeasureResult | null }
interface Result { rows: Row[]; mv: ChiResult | null; measures: Measure[] }
const fmt = (v: number) => (Number.isFinite(v) ? formatStat(Number(v.toPrecision(5))) : '-');

const statValue = (r: UnivariateResult, k: StatKey): number | string => {
  switch (k) {
    case 'sed': return r.seDymax;
    case 'overton': return r.overton;
    case 'tx': return r.chi.tx;
    case 'ksd': return r.ks.d;
    case 'ksAt': return r.ksMaxAt;
    case 'ksp': return r.ks.text;
    case 'maxT': return r.chi.maxT;
  }
};

function Graph(p: { sample: Float32Array; controls: Float32Array[]; merge: boolean; cdf: boolean; diff: boolean; tintS: boolean; tintC: boolean; smooth: boolean; h: number; scale: number; testId: string }) {
  const W = Math.max(40, Math.round(COMPARE_CHART_W * p.scale)), H = Math.max(10, p.h);
  const norm = (h0: ArrayLike<number>) => { const h = p.smooth ? smoothCurve(h0) : h0; let s = 0; for (let i = 0; i < h.length; i++) s += h[i]; const out = Array.from(h, (v) => (s ? v / s : 0)); if (p.cdf) for (let i = 1; i < out.length; i++) out[i] += out[i - 1]; return out; };
  const merged = p.controls.length ? p.controls[0].map((_, i) => p.controls.reduce((a, c) => a + c[i], 0)) : new Float32Array(p.sample.length);
  const lines = [{ v: norm(p.sample), c: '#d0021b', tint: p.tintS }, ...(p.merge ? [merged] : p.controls).map((c) => ({ v: norm(c), c: '#2a5bd7', tint: p.tintC }))];
  if (p.diff) lines.push({ v: lines[0].v.map((x, i) => x - lines[1]?.v[i] || 0), c: '#2ca02c', tint: false });
  const all = lines.flatMap((l) => l.v);
  const lo = Math.min(0, ...all), hi = Math.max(1e-12, ...all);
  const x = (i: number, n: number) => (i / (n - 1)) * W, y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 2);
  return <svg width={W} height={H} data-testid={p.testId} style={{ border: '1px solid #ccc', background: '#fff' }}>
    {lines.map((l, k) => { const d = l.v.map((v, i) => `${i ? 'L' : 'M'}${x(i, l.v.length).toFixed(1)},${y(v).toFixed(1)}`).join(''); return <g key={k}>{l.tint && <path d={`${d}L${W},${y(0)}L0,${y(0)}Z`} fill={l.c} opacity={0.2} />}<path d={d} fill="none" stroke={l.c} strokeWidth={1.2} /></g>; })}
  </svg>;
}

export function CompareDialog(p: ToolCtx) {
  const s0 = p.sample!;
  const samplePath = p.popId ? populationPath(s0.populations, p.popId) : '';
  const meta0 = withStains(p.meta[s0.id], s0.stains);
  const channels = useMemo(() => sampleChannels(meta0, s0.compensation, p.ws.matrices, p.ws.derivedParameters), [meta0, s0.compensation, p.ws.matrices, p.ws.derivedParameters]);
  const [params, setParams] = useState<string[]>(() => channels.map((c) => c.name));
  const [checked, setChecked] = useState<string[]>([]);
  const [controls, setControls] = useState<PopRef[]>([]);
  const [stats, setStats] = useState<StatKey[]>(DEFAULT_STATS);
  const [rows, setRows] = useState<Row[]>([]);
  const [mv, setMv] = useState<ChiResult | null>(null);
  const [mvBins, setMvBins] = useState(DEFAULT_MV_BINS);
  const [opt, setOpt] = useState({ graph: true, cdf: false, diff: false, tintS: false, tintC: false, merge: false, smooth: true });
  const [chart, setChart] = useState({ h: COMPARE_CHART_H, scale: 1 });
  const [pick, setPick] = useState<PopRef>({ sampleId: p.ws.samples.find((s) => s.id !== s0.id)?.id ?? s0.id, path: samplePath });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [measures, setMeasures] = useState<Measure[]>([]);
  // Set source group: the sample population is taken from a group's samples
  // (ComparisonNode.fSourceGroupNode); the engine keeps the last one.
  const [sourceGroup, setSourceGroup] = useState<string>('');
  const [groupRows, setGroupRows] = useState<{ sample: string; mv: ChiResult | null; measures: Measure[] }[] | null>(null);

  const popIdOf = (r: PopRef) => {
    const s = p.ws.samples.find((x) => x.id === r.sampleId);
    if (!s) return undefined;
    if (!r.path) return { s, popId: null as string | null };
    const pop = s.populations.find((q) => populationPath(s.populations, q.id) === r.path);
    return pop ? { s, popId: pop.id as string | null } : undefined;
  };
  const req = (s: typeof s0) => ({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: p.ws.matrices, derived: p.ws.derivedParameters });

  const sourceSample = () => {
    const g = p.ws.groups.find((x) => x.id === sourceGroup);
    if (!g) return { s: s0, popId: p.popId };
    let found: { s: typeof s0; popId: string | null } | null = null;
    for (const id of g.sampleIds) { const r = popIdOf({ sampleId: id, path: samplePath }); if (r && p.meta[r.s.id]) found = r; }
    return found ?? { s: s0, popId: p.popId };
  };
  const compute = async (src: { s: typeof s0; popId: string | null }, withRows: boolean): Promise<Result> => {
    const refs = controls.map(popIdOf);
    const missing = controls.filter((_, i) => !refs[i] || !p.meta[refs[i]!.s.id]);
    if (missing.length) throw new Error(`Comparator not available (population missing or sample not loaded): ${missing.map((m) => `${p.ws.samples.find((s) => s.id === m.sampleId)?.fileName}/${m.path || 'All'}`).join(', ')}`);
    const out: Row[] = [];
    const dims: { kind: 'channel'; channel: string; transform: import('../core/transforms').TransformSpec }[] = [];
    const spans: [number, number][] = [];
    for (const ch of params) {
      const ax = makeAxis(channels, meta0.keywords, p.ws.channelTransforms, ch);
      if (!ax) continue;
      const dim = { kind: 'channel' as const, channel: ch, transform: ax.spec };
      dims.push(dim);
      spans.push(ax.range);
      if (!withRows) continue;
      const hist = async (s: typeof s0, popId: string | null) => (await p.client.plot({ ...req(s), popId, x: dim, y: null, bins: 256, xRange: ax.range, yRange: null, maxPoints: 0 })).density;
      const sh = await hist(src.s, src.popId);
      const chs = [] as Float32Array[];
      for (const r of refs) chs.push(await hist(r!.s, r!.popId));
      const merged = chs[0].map((_, i) => chs.reduce((a, c) => a + c[i], 0));
      const [d0, d1] = ax.range;
      out.push({ channel: ch, sample: sh, controls: chs, res: compareHistograms(sh, merged, (i) => ax.t.inverse(d0 + (i * (d1 - d0)) / 256)) });
    }
    // Multivariate comparison on every listed parameter (all events), each
    // value as its position on the parameter's display range.
    let mv: ChiResult | null = null;
    if (dims.length) {
      const ev = async (s: typeof s0, popId: string | null) => { const m = await p.client.eventMatrix({ ...req(s), popId, dims, maxEvents: 1e9 }); return Array.from({ length: m.count }, (_, i) => Float64Array.from(m.values.subarray(i * dims.length, (i + 1) * dims.length), (v, k) => (v - spans[k][0]) / (spans[k][1] - spans[k][0]))); };
      const smp = await ev(src.s, src.popId);
      const ctl: Float64Array[][] = [];
      for (const r of refs) ctl.push(await ev(r!.s, r!.popId));
      mv = multivariateChi(ctl, smp, dims.length, mvBins);
    }
    const base = await p.client.populationMask({ ...req(src.s), popId: src.popId });
    const ms: Measure[] = [];
    for (let i = 0; i < refs.length; i++) {
      const cand = await p.client.populationMask({ ...req(refs[i]!.s), popId: refs[i]!.popId });
      const a = src.popId ? base : null, b = refs[i]!.popId ? cand : null;
      ms.push({ label: `${refs[i]!.s.fileName}/${controls[i].path || 'All events'}`, mr: matchRatio([a], [b], base.length)[0], f: fMeasure([a], [b], base.length) });
    }
    return { rows: out, mv, measures: ms };
  };

  useEffect(() => {
    if (!controls.length) { setRows([]); setMv(null); setMeasures([]); return; }
    let live = true;
    setBusy(true);
    compute(sourceSample(), true).then((r) => { if (live) { setRows(r.rows); setMv(r.mv); setMeasures(r.measures); setError(null); } }, (e) => live && setError((e as Error).message)).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [controls, params, mvBins, sourceGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add To Group (ComparisonController.addToGroup copies the comparison node
  // to every sample of the current group): own rule, the comparison is run
  // for each loaded member at this population path and listed per sample.
  const addToGroup = async () => {
    const g = p.ws.groups.find((x) => x.id === p.groupId);
    if (!g || !controls.length) return;
    setBusy(true);
    try {
      const out: { sample: string; mv: ChiResult | null; measures: Measure[] }[] = [];
      for (const id of g.sampleIds) {
        const r = popIdOf({ sampleId: id, path: samplePath });
        if (!r || !p.meta[r.s.id]) continue;
        const res = await compute(r, false);
        out.push({ sample: r.s.fileName, mv: res.mv, measures: res.measures });
      }
      setGroupRows(out);
      setError(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const pickSample = p.ws.samples.find((s) => s.id === pick.sampleId);
  const paths = pickSample ? ['', ...pickSample.populations.map((q) => populationPath(pickSample.populations, q.id))] : [''];
  const removeBy = (f: (n: string) => boolean) => setParams((x) => x.filter((n) => !f(n)));

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal layout" role="dialog" aria-label="Compare Populations" data-testid="compare-dialog">
        <div className="modal-head"><b>Comparison to {s0.fileName}/{samplePath || 'All events'}</b><button onClick={p.onClose} aria-label="Close" data-testid="compare-close">x</button></div>
        <div className="modal-body">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span>Comparators:</span>
            <select value={pick.sampleId} onChange={(e) => setPick({ sampleId: e.target.value, path: pick.path })} data-testid="compare-pick-sample">{p.ws.samples.map((s) => <option key={s.id} value={s.id}>{s.fileName}</option>)}</select>
            <select value={pick.path} onChange={(e) => setPick({ ...pick, path: e.target.value })} data-testid="compare-pick-pop">{paths.map((x) => <option key={x} value={x}>{x || 'All events'}</option>)}</select>
            <button data-testid="compare-add-control" title="One or more populations used as the basis of the statistical comparisons" onClick={() => setControls((c) => (c.some((x) => x.sampleId === pick.sampleId && x.path === pick.path) ? c : [...c, pick]))}>Add Comparator</button>
            <select value="" onChange={(e) => { const g = p.ws.groups.find((x) => x.id === e.target.value); if (g) setControls(g.sampleIds.filter((id) => id !== s0.id).map((id) => ({ sampleId: id, path: samplePath }))); }} data-testid="compare-control-group" title="Use all of the samples in a group to determine the control values"><option value="">Set control group...</option>{p.ws.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <button data-testid="compare-reset-controls" onClick={() => setControls([])} title="Clear the list of populations used in calculating the control values">Reset control populations</button>
            <select value="" onChange={(e) => { const g = p.ws.groups.find((x) => x.id === e.target.value); if (g) { setSourceGroup(g.id); setControls(g.sampleIds.map((id) => ({ sampleId: id, path: samplePath }))); } }} data-testid="compare-source-group" title="Use a group's population as the sample and its samples as the controls"><option value="">Set source group...</option>{p.ws.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <button data-testid="compare-clear-source" disabled={!sourceGroup} onClick={() => setSourceGroup('')} title="Revert the current group">Clear source group</button>
            <button data-testid="compare-add-to-group" disabled={!controls.length} onClick={() => void addToGroup()} title="Copy this comparison to all of the samples in the current group">Add To Group</button>
          </div>
          <div className="muted" data-testid="compare-controls">{controls.length ? controls.map((c) => `${p.ws.samples.find((s) => s.id === c.sampleId)?.fileName}/${c.path || 'All events'}`).join('; ') : 'Add a comparator population to compare.'}</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span>Remove:</span>
            <button data-testid="compare-rm-scatter" onClick={() => removeBy(isScatter)} title="Ignore forward scatter and side scatter in the comparisons.">Scatter</button>
            <button data-testid="compare-rm-uncomp" onClick={() => removeBy((n) => n.endsWith(UNCOMP_SUFFIX))} title="Remove uncompensated parameters from the visible list">Uncompensated</button>
            <button data-testid="compare-rm-nonfluor" onClick={() => removeBy(isNonFluorescent)} title="Ignore scatter, time, event number and other non-fluorescent parameters.">Non-fluorescents</button>
            <button data-testid="compare-rm-unselected" disabled={!checked.length} onClick={() => setParams((x) => x.filter((n) => checked.includes(n)))} title="Leave the selected (checked) parameters and remove the unselected ones.">Unselected</button>
            <button data-testid="compare-reset-params" onClick={() => setParams(channels.map((c) => c.name))} title="Reset visible parameters to the full set available">Reset</button>
            <button data-testid="compare-reset-stats" onClick={() => setStats(DEFAULT_STATS)} title="Go back to the full list of statistics columns">Reset statistics</button>
            <select value="" onChange={(e) => e.target.value && setStats((s) => [...s, e.target.value as StatKey])} data-testid="compare-add-stat"><option value="">Add statistic...</option>{STATS.filter((x) => !stats.includes(x.key)).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {([['graph', 'Show graph'], ['cdf', 'Show CDF'], ['diff', 'Plot Difference'], ['tintS', 'Tint Sample'], ['tintC', 'Tint Control'], ['merge', 'Merge control histograms'], ['smooth', 'Smooth']] as const).map(([k, l]) => <label key={k}><input type="checkbox" checked={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.checked })} data-testid={`compare-opt-${k}`} />{l}</label>)}
            <button disabled={!opt.graph} onClick={() => setChart((c) => resizeChart(c, true))} data-testid="compare-chart-bigger" title="Increase Chart Size">Increase Chart Size</button>
            <button disabled={!opt.graph} onClick={() => setChart((c) => resizeChart(c, false))} data-testid="compare-chart-smaller" title="Decrease Chart Size">Decrease Chart Size</button>
          </div>
          {error && <p className="error" data-testid="compare-error">{error}</p>}
          {busy && <p className="muted">Calculating...</p>}
          <table className="grid" data-testid="compare-table">
            <thead><tr><th /><th>Parameter</th>{stats.map((k) => <th key={k}>{STATS.find((x) => x.key === k)!.label} <button className="x" onClick={() => setStats((s) => s.filter((x) => x !== k))} data-testid={`compare-rm-stat-${k}`}>x</button></th>)}{opt.graph && <th>Distribution</th>}</tr></thead>
            <tbody>{rows.filter((r) => params.includes(r.channel)).map((r) => <tr key={r.channel} data-testid={`compare-row-${r.channel}`}>
              <td><input type="checkbox" checked={checked.includes(r.channel)} onChange={(e) => setChecked((c) => (e.target.checked ? [...c, r.channel] : c.filter((x) => x !== r.channel)))} /></td>
              <td>{r.channel}</td>
              {stats.map((k) => <td key={k} data-testid={`compare-${k}-${r.channel}`}>{(() => { const v = statValue(r.res, k); return typeof v === 'number' ? formatStat(Number(v.toPrecision(5))) : v; })()}</td>)}
              {opt.graph && <td><Graph sample={r.sample} controls={r.controls} merge={opt.merge} cdf={opt.cdf} diff={opt.diff} tintS={opt.tintS} tintC={opt.tintC} smooth={opt.smooth} h={chart.h} scale={chart.scale} testId={`compare-graph-${r.channel}`} /></td>}
            </tr>)}</tbody>
          </table>
          {sourceGroup && <p className="muted" data-testid="compare-source">Sample population from source group {p.ws.groups.find((g) => g.id === sourceGroup)?.name}: {sourceSample().s.fileName}/{samplePath || 'All events'}</p>}
          {measures.length > 0 && <table className="grid" data-testid="compare-measures">
            <thead><tr><th>Comparator</th><th>Match Ratio</th><th>FMeasure</th><th>Precision</th><th>Recall</th><th>Total FMeasure</th></tr></thead>
            <tbody>{measures.map((m, i) => <tr key={i}><td>{m.label}</td><td data-testid={`compare-mr-${i}`}>{fmt(m.mr)}</td><td data-testid={`compare-f-${i}`}>{fmt(m.f?.value ?? NaN)}</td><td data-testid={`compare-prec-${i}`}>{fmt(m.f?.precision ?? NaN)}</td><td data-testid={`compare-rec-${i}`}>{fmt(m.f?.recall ?? NaN)}</td><td>{fmt(m.f?.total ?? NaN)}</td></tr>)}</tbody>
          </table>}
          {groupRows && <table className="grid" data-testid="compare-group-table">
            <thead><tr><th>Sample</th><th>Multivariate T(X)</th><th>Multivariate Max T</th><th>Multivariate Num Bins</th>{measures.map((m, i) => <th key={i}>Match Ratio / FMeasure vs {m.label}</th>)}</tr></thead>
            <tbody>{groupRows.map((g) => <tr key={g.sample}><td>{g.sample}</td><td>{g.mv ? fmt(g.mv.tx) : '-'}</td><td>{g.mv ? fmt(g.mv.maxT) : '-'}</td><td>{g.mv?.bins ?? '-'}</td>{g.measures.map((m, i) => <td key={i}>{fmt(m.mr)} / {fmt(m.f?.value ?? NaN)}</td>)}</tr>)}</tbody>
          </table>}
          {/* ComparisonFooter */}
          <div className="row" data-testid="compare-footer">
            <span data-testid="compare-mv">Chi-squared Test: {mv ? <>T(X) = {mv.tx.toFixed(2)} (Max T Value = {mv.maxT.toFixed(2)}, #Bins = {mv.bins})</> : '-'}</span>
            <label title="Specify the number of bins for multivariate comparison.">Number of bins: <input type="number" min={2} value={mvBins} onChange={(e) => setMvBins(Math.max(2, Math.floor(Number(e.target.value) || DEFAULT_MV_BINS)))} style={{ width: 60 }} data-testid="compare-mv-bins" /></label>
            <span className="muted">Univariate: 256-bucket histograms on the display scale; chi-squared uses {CHI_BINS} probability bins.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
