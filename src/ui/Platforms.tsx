// Analysis platforms on the selected population: cell cycle (Dean-Jett-Fox,
// Watson), proliferation (dye-dilution generations) and kinetics (statistic
// over time). Numerics run in the worker; validated synthetically only.
import { useState } from 'react';
import type { CellCycleFit } from '../core/cellcycle';
import type { KineticsResult } from '../core/kinetics';
import { MAX_PEAKS, type ProliferationFit } from '../core/proliferation';

type Platform = 'cellcycle' | 'proliferation' | 'kinetics';
type KStat = 'count' | 'mean' | 'median' | 'pctPositive';
export type CellCycleResult = CellCycleFit & { binWidth: number; histogram: Float64Array };

interface Props {
  popLabel: string;
  channels: string[];
  timeChannel: string | null;
  onClose: () => void;
  runCellCycle: (channel: string, model: 'dean-jett-fox' | 'watson') => Promise<CellCycleResult | undefined>;
  runProliferation: (channel: string, maxGenerations: number) => Promise<ProliferationFit | undefined>;
  runKinetics: (channel: string, stat: KStat, bins: number, threshold: number) => Promise<KineticsResult | undefined>;
}

// Undefined results (e.g. indices with no divided cells) show "-", never NaN.
const pct = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : '-');
const num = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '-');

// Observed histogram (bars) with model curves (lines) as inline SVG.
function Chart(p: { observed: ArrayLike<number>; lines: { values: ArrayLike<number>; color: string }[]; testId: string; xLabel?: string }) {
  // Bins come from the bars, or from the lines when there are no bars.
  const W = 420, H = 180, n = Math.max(p.observed.length, ...p.lines.map((l) => l.values.length));
  let max = p.observed.length ? 1 : -Infinity;
  // Line-only charts scale from the data minimum so variation stays visible.
  let min = p.observed.length ? 0 : Infinity;
  for (let i = 0; i < p.observed.length; i++) max = Math.max(max, p.observed[i]);
  for (const l of p.lines) for (let i = 0; i < l.values.length; i++) if (Number.isFinite(l.values[i])) { max = Math.max(max, l.values[i]); min = Math.min(min, l.values[i]); }
  if (!(max > min)) { min = Number.isFinite(min) ? min - 1 : 0; max = min + 2; }
  const x = (i: number) => (i / Math.max(1, n)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * (H - 6);
  const path = (vals: ArrayLike<number>) => {
    let d = '';
    for (let i = 0; i < vals.length; i++) if (Number.isFinite(vals[i])) d += `${d ? 'L' : 'M'}${x(i + 0.5).toFixed(1)},${y(vals[i]).toFixed(1)}`;
    return d;
  };
  const bars: string[] = [];
  for (let i = 0; i < p.observed.length; i++) if (p.observed[i] > 0) bars.push(`M${x(i).toFixed(1)},${H}V${y(p.observed[i]).toFixed(1)}H${x(i + 1).toFixed(1)}V${H}`);
  return (
    <svg width={W} height={H + 16} data-testid={p.testId} style={{ border: '1px solid #ccc', background: '#fff' }}>
      <path d={bars.join('')} fill="#b8c4d6" />
      {p.lines.map((l, k) => <path key={k} d={path(l.values)} fill="none" stroke={l.color} strokeWidth={1.5} />)}
      {p.xLabel && <text x={W / 2} y={H + 13} fontSize={11} textAnchor="middle">{p.xLabel}</text>}
    </svg>
  );
}

export function PlatformsDialog(p: Props) {
  const [platform, setPlatform] = useState<Platform>('cellcycle');
  const [channel, setChannel] = useState(p.channels[0] ?? '');
  const [model, setModel] = useState<'dean-jett-fox' | 'watson'>('dean-jett-fox');
  const [gens, setGens] = useState(4); // FlowJo 10 "Number of Peaks" default
  const [kstat, setKstat] = useState<KStat>('count');
  const [kbins, setKbins] = useState(50);
  const [threshold, setThreshold] = useState(1000);
  const [cc, setCc] = useState<CellCycleResult | null>(null);
  const [pr, setPr] = useState<ProliferationFit | null>(null);
  const [kn, setKn] = useState<KineticsResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peaksOk = Number.isInteger(gens) && gens >= 0 && gens <= MAX_PEAKS;
  const go = async () => {
    setRunning(true);
    setError(null);
    try {
      if (platform === 'cellcycle') setCc((await p.runCellCycle(channel, model)) ?? null);
      if (platform === 'proliferation') setPr((await p.runProliferation(channel, gens)) ?? null);
      if (platform === 'kinetics') setKn((await p.runKinetics(channel, kstat, kbins, threshold)) ?? null);
    } catch (e) {
      // Shown in this window, as in FlowJo 10 (specs 6.7); also in the Log.
      setError((e as Error).message);
      if (platform === 'cellcycle') setCc(null);
      if (platform === 'proliferation') setPr(null);
      if (platform === 'kinetics') setKn(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal wide" role="dialog" aria-label="Platforms">
        <div className="modal-head"><b>Platforms - {p.popLabel}</b><button onClick={p.onClose} aria-label="Close">x</button></div>
        <div className="modal-body">
          <div className="row">
            <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} data-testid="platform-kind">
              <option value="cellcycle">Cell cycle</option>
              <option value="proliferation">Proliferation</option>
              <option value="kinetics">Kinetics</option>
            </select>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} data-testid="platform-channel">
              {p.channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {platform === 'cellcycle' && (
              <>
                <select value={model} onChange={(e) => setModel(e.target.value as typeof model)} data-testid="cc-model">
                  <option value="dean-jett-fox">Dean-Jett-Fox</option>
                  <option value="watson">Watson pragmatic</option>
                </select>
                <span title="As in FlowJo 10: channel range, at most 1024 channels">histogram: up to 1024 channels</span>
              </>
            )}
            {platform === 'proliferation' && <>Number of Peaks <input type="number" min={0} max={MAX_PEAKS} step={1} value={Number.isNaN(gens) ? '' : gens} onChange={(e) => setGens(e.target.value === '' ? NaN : Number(e.target.value))} style={{ width: 50 }} data-testid="prolif-peaks" title={`Integer from 0 to ${MAX_PEAKS}`} /></>}
            {platform === 'kinetics' && (
              <>
                <select value={kstat} onChange={(e) => setKstat(e.target.value as KStat)} data-testid="kin-stat">
                  <option value="count">Events per bin</option>
                  <option value="mean">Mean</option>
                  <option value="median">Median</option>
                  <option value="pctPositive">% above threshold</option>
                </select>
                bins <input type="number" min={2} max={1000} value={kbins} onChange={(e) => setKbins(Number(e.target.value))} style={{ width: 56 }} />
                {kstat === 'pctPositive' && <>threshold <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ width: 80 }} /></>}
              </>
            )}
            <button onClick={go} disabled={running || !channel || (platform === 'kinetics' && !p.timeChannel) || (platform === 'proliferation' && !peaksOk)} data-testid="platform-run">{running ? 'Fitting...' : 'Run'}</button>
          </div>
          {platform === 'kinetics' && !p.timeChannel && <p className="error">No Time parameter in this sample.</p>}
          {platform === 'proliferation' && !peaksOk && <p className="error" data-testid="prolif-peaks-error">Number of Peaks must be an integer from 0 to {MAX_PEAKS}.</p>}
          {error && <p className="error" data-testid="platform-error">{error}</p>}
          <p className="muted">Validated on synthetic data only; not compared with FlowJo, ModFit or other reference output.</p>

          {platform === 'cellcycle' && cc && (
            <div data-testid="cc-result">
              <table className="grid">
                <tbody>
                  <tr><th>G1</th><td data-testid="cc-g1">{pct(cc.g1Pct)}</td><th>S</th><td data-testid="cc-s">{pct(cc.sPct)}</td><th>G2/M</th><td data-testid="cc-g2">{pct(cc.g2Pct)}</td></tr>
                  <tr><th>G1 mean</th><td>{((cc.g1.mean + 0.5) * cc.binWidth).toFixed(1)}</td><th>G2 mean</th><td>{((cc.g2.mean + 0.5) * cc.binWidth).toFixed(1)}</td><th>G2/G1</th><td>{((cc.g2.mean + 0.5) / (cc.g1.mean + 0.5)).toFixed(3)}</td></tr>
                  <tr><th>G1 CV</th><td>{pct((100 * cc.g1.sd) / (cc.g1.mean + 0.5))}</td><th>RMSD</th><td>{cc.rmsd.toFixed(2)}</td><th>Reduced chi-sq</th><td>{cc.chiSquare.toFixed(3)}</td></tr>
                </tbody>
              </table>
              <Chart observed={cc.histogram} testId="cc-chart" xLabel={`${channel} (linear)`} lines={[{ values: cc.fitted, color: '#111' }, { values: cc.components.g1, color: '#2a7de1' }, { values: cc.components.s, color: '#e1a42a' }, { values: cc.components.g2, color: '#d0021b' }]} />
              {cc.warnings.map((w, i) => <p key={i} className="warn">{w}</p>)}
            </div>
          )}

          {platform === 'proliferation' && pr && (
            <div data-testid="prolif-result">
              <table className="grid">
                <thead><tr><th>Generation</th><th>Peak</th><th>Count</th><th>% of cells</th></tr></thead>
                <tbody>
                  {pr.generations.map((g) => <tr key={g.index}><td>{g.index}</td><td>{g.peak.toFixed(0)}</td><td>{g.count.toFixed(0)}</td><td>{pct(g.pct)}</td></tr>)}
                </tbody>
              </table>
              <table className="grid">
                <tbody>
                  <tr><th>% divided</th><td data-testid="prolif-divided">{pct(100 * pr.pctDivided)}</td><th>Division index</th><td data-testid="prolif-di">{num(pr.divisionIndex, 3)}</td></tr>
                  <tr><th>Proliferation index</th><td>{num(pr.proliferationIndex, 3)}</td><th>Expansion index</th><td>{num(pr.expansionIndex, 3)}</td></tr>
                  <tr><th>Precursor frequency</th><td>{pct(100 * pr.precursorFrequency)}</td><th>RMSD</th><td>{num(pr.rmsd, 2)}</td></tr>
                </tbody>
              </table>
              <Chart observed={pr.histogram.observed} testId="prolif-chart" xLabel={`log10 ${channel}`} lines={[{ values: pr.histogram.fitted, color: '#d0021b' }]} />
              {pr.warnings.map((w, i) => <p key={i} className="warn">{w}</p>)}
            </div>
          )}

          {platform === 'kinetics' && kn && (
            <div data-testid="kin-result">
              <Chart observed={kstat === 'count' ? kn.value : []} testId="kin-chart" xLabel={`${p.timeChannel} (${kn.binStart.length} bins)`} lines={kstat === 'count' ? [] : [{ values: kn.value, color: '#2a7de1' }]} />
              <div className="table-wrap" style={{ maxHeight: 160 }}>
                <table className="grid" data-testid="kin-table">
                  <thead><tr><th>Time from</th><th>Time to</th><th>Events</th><th>{kstat}</th></tr></thead>
                  <tbody>
                    {Array.from(kn.value, (v, i) => <tr key={i}><td>{kn.binStart[i].toFixed(2)}</td><td>{kn.binEnd[i].toFixed(2)}</td><td>{kn.n[i]}</td><td>{Number.isFinite(v) ? v.toFixed(2) : '-'}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
