// Analysis platforms on the selected population: cell cycle (Dean-Jett-Fox,
// Watson), proliferation (dye-dilution generations) and kinetics (statistic
// over time). Numerics run in the worker; validated synthetically only.
import { useState } from 'react';
import type { CellCycleFit } from '../core/cellcycle';
import type { KineticsResult } from '../core/kinetics';
import type { ProliferationFit } from '../core/proliferation';

type Platform = 'cellcycle' | 'proliferation' | 'kinetics';
type KStat = 'count' | 'mean' | 'median' | 'pctPositive';
export type CellCycleResult = CellCycleFit & { binWidth: number; histogram: Float64Array };

interface Props {
  popLabel: string;
  channels: string[];
  timeChannel: string | null;
  onClose: () => void;
  runCellCycle: (channel: string, model: 'dean-jett-fox' | 'watson', bins: number) => Promise<CellCycleResult | undefined>;
  runProliferation: (channel: string, maxGenerations: number) => Promise<ProliferationFit | undefined>;
  runKinetics: (channel: string, stat: KStat, bins: number, threshold: number) => Promise<KineticsResult | undefined>;
}

const pct = (v: number) => `${v.toFixed(2)}%`;

// Observed histogram (bars) with model curves (lines) as inline SVG.
function Chart(p: { observed: ArrayLike<number>; lines: { values: ArrayLike<number>; color: string }[]; testId: string; xLabel?: string }) {
  const W = 420, H = 180, n = p.observed.length;
  let max = 1;
  for (let i = 0; i < n; i++) max = Math.max(max, p.observed[i]);
  for (const l of p.lines) for (let i = 0; i < l.values.length; i++) if (Number.isFinite(l.values[i])) max = Math.max(max, l.values[i]);
  const x = (i: number) => (i / Math.max(1, n)) * W;
  const y = (v: number) => H - (v / max) * (H - 6);
  const path = (vals: ArrayLike<number>) => {
    let d = '';
    for (let i = 0; i < vals.length; i++) if (Number.isFinite(vals[i])) d += `${d ? 'L' : 'M'}${x(i + 0.5).toFixed(1)},${y(vals[i]).toFixed(1)}`;
    return d;
  };
  const bars: string[] = [];
  for (let i = 0; i < n; i++) if (p.observed[i] > 0) bars.push(`M${x(i).toFixed(1)},${H}V${y(p.observed[i]).toFixed(1)}H${x(i + 1).toFixed(1)}V${H}`);
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
  const [bins, setBins] = useState(256);
  const [gens, setGens] = useState(8);
  const [kstat, setKstat] = useState<KStat>('count');
  const [kbins, setKbins] = useState(50);
  const [threshold, setThreshold] = useState(1000);
  const [cc, setCc] = useState<CellCycleResult | null>(null);
  const [pr, setPr] = useState<ProliferationFit | null>(null);
  const [kn, setKn] = useState<KineticsResult | null>(null);
  const [running, setRunning] = useState(false);

  const go = async () => {
    setRunning(true);
    try {
      if (platform === 'cellcycle') setCc((await p.runCellCycle(channel, model, bins)) ?? null);
      if (platform === 'proliferation') setPr((await p.runProliferation(channel, gens)) ?? null);
      if (platform === 'kinetics') setKn((await p.runKinetics(channel, kstat, kbins, threshold)) ?? null);
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
                bins <input type="number" min={64} max={1024} value={bins} onChange={(e) => setBins(Number(e.target.value))} style={{ width: 64 }} />
              </>
            )}
            {platform === 'proliferation' && <>max generations <input type="number" min={1} max={12} value={gens} onChange={(e) => setGens(Number(e.target.value))} style={{ width: 50 }} /></>}
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
            <button onClick={go} disabled={running || !channel || (platform === 'kinetics' && !p.timeChannel)} data-testid="platform-run">{running ? 'Fitting...' : 'Run'}</button>
          </div>
          {platform === 'kinetics' && !p.timeChannel && <p className="error">No Time parameter in this sample.</p>}
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
                  <tr><th>% divided</th><td data-testid="prolif-divided">{pct(100 * pr.pctDivided)}</td><th>Division index</th><td data-testid="prolif-di">{pr.divisionIndex.toFixed(3)}</td></tr>
                  <tr><th>Proliferation index</th><td>{pr.proliferationIndex.toFixed(3)}</td><th>Expansion index</th><td>{pr.expansionIndex.toFixed(3)}</td></tr>
                  <tr><th>Precursor frequency</th><td>{pct(100 * pr.precursorFrequency)}</td><th>RMSD</th><td>{pr.rmsd.toFixed(2)}</td></tr>
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
