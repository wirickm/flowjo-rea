// FlowJo 10.6.2 Compare Populations window (PlatformNavCommand.COMPARISON,
// ComparisonFrame / ComparisonController; spec docs/validation/ui-gaps/platforms.md).
// One row per parameter: the statistics of src/core/compare.ts between the
// sample population and the comparator (control) populations, with an
// overlay of their histograms.
import { useEffect, useMemo, useState } from 'react';
import { CHI_BINS, compareHistograms, DEFAULT_MV_BINS, isNonFluorescent, isScatter, multivariateChi, type ChiResult, type UnivariateResult } from '../core/compare';
import { populationPath, UNCOMP_SUFFIX } from '../core/model';
import { formatStat } from '../core/statsTable';
import { makeAxis, sampleChannels, withStains } from './axes';
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

function Graph(p: { sample: Float32Array; controls: Float32Array[]; merge: boolean; cdf: boolean; diff: boolean; tintS: boolean; tintC: boolean; testId: string }) {
  const W = 220, H = 70;
  const norm = (h: ArrayLike<number>) => { let s = 0; for (let i = 0; i < h.length; i++) s += h[i]; const out = Array.from(h, (v) => (s ? v / s : 0)); if (p.cdf) for (let i = 1; i < out.length; i++) out[i] += out[i - 1]; return out; };
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
  const [opt, setOpt] = useState({ graph: true, cdf: false, diff: false, tintS: false, tintC: false, merge: false });
  const [pick, setPick] = useState<PopRef>({ sampleId: p.ws.samples.find((s) => s.id !== s0.id)?.id ?? s0.id, path: samplePath });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const popIdOf = (r: PopRef) => {
    const s = p.ws.samples.find((x) => x.id === r.sampleId);
    if (!s) return undefined;
    if (!r.path) return { s, popId: null as string | null };
    const pop = s.populations.find((q) => populationPath(s.populations, q.id) === r.path);
    return pop ? { s, popId: pop.id as string | null } : undefined;
  };
  const req = (s: typeof s0) => ({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: p.ws.matrices, derived: p.ws.derivedParameters });

  useEffect(() => {
    if (!controls.length) { setRows([]); setMv(null); return; }
    let live = true;
    setBusy(true);
    (async () => {
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
        const hist = async (s: typeof s0, popId: string | null) => (await p.client.plot({ ...req(s), popId, x: dim, y: null, bins: 256, xRange: ax.range, yRange: null, maxPoints: 0 })).density;
        const sh = await hist(s0, p.popId);
        const chs = [] as Float32Array[];
        for (const r of refs) chs.push(await hist(r!.s, r!.popId));
        const merged = chs[0].map((_, i) => chs.reduce((a, c) => a + c[i], 0));
        const [d0, d1] = ax.range;
        out.push({ channel: ch, sample: sh, controls: chs, res: compareHistograms(sh, merged, (i) => ax.t.inverse(d0 + (i * (d1 - d0)) / 256)) });
      }
      if (live) setRows(out);
      // Multivariate comparison on every listed parameter, each scaled to its
      // display range.
      if (dims.length) {
        const ev = async (s: typeof s0, popId: string | null) => { const m = await p.client.eventMatrix({ ...req(s), popId, dims, maxEvents: 20000 }); return Array.from({ length: m.count }, (_, i) => Float64Array.from(m.values.subarray(i * dims.length, (i + 1) * dims.length), (v, k) => (v - spans[k][0]) / (spans[k][1] - spans[k][0]))); };
        const smp = await ev(s0, p.popId);
        const ctl: Float64Array[] = [];
        for (const r of refs) ctl.push(...(await ev(r!.s, r!.popId)));
        if (live) setMv(multivariateChi(ctl, smp, dims.length, mvBins));
      }
    })().then(() => live && setError(null), (e) => live && setError((e as Error).message)).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [controls, params, mvBins]); // eslint-disable-line react-hooks/exhaustive-deps

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
            {([['graph', 'Show graph'], ['cdf', 'Show CDF'], ['diff', 'Plot Difference'], ['tintS', 'Tint Sample'], ['tintC', 'Tint Control'], ['merge', 'Merge control histograms']] as const).map(([k, l]) => <label key={k}><input type="checkbox" checked={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.checked })} data-testid={`compare-opt-${k}`} />{l}</label>)}
          </div>
          {error && <p className="error" data-testid="compare-error">{error}</p>}
          {busy && <p className="muted">Calculating...</p>}
          <table className="grid" data-testid="compare-table">
            <thead><tr><th /><th>Parameter</th>{stats.map((k) => <th key={k}>{STATS.find((x) => x.key === k)!.label} <button className="x" onClick={() => setStats((s) => s.filter((x) => x !== k))} data-testid={`compare-rm-stat-${k}`}>x</button></th>)}{opt.graph && <th>Distribution</th>}</tr></thead>
            <tbody>{rows.filter((r) => params.includes(r.channel)).map((r) => <tr key={r.channel} data-testid={`compare-row-${r.channel}`}>
              <td><input type="checkbox" checked={checked.includes(r.channel)} onChange={(e) => setChecked((c) => (e.target.checked ? [...c, r.channel] : c.filter((x) => x !== r.channel)))} /></td>
              <td>{r.channel}</td>
              {stats.map((k) => <td key={k} data-testid={`compare-${k}-${r.channel}`}>{(() => { const v = statValue(r.res, k); return typeof v === 'number' ? formatStat(Number(v.toPrecision(5))) : v; })()}</td>)}
              {opt.graph && <td><Graph sample={r.sample} controls={r.controls} merge={opt.merge} cdf={opt.cdf} diff={opt.diff} tintS={opt.tintS} tintC={opt.tintC} testId={`compare-graph-${r.channel}`} /></td>}
            </tr>)}</tbody>
          </table>
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
