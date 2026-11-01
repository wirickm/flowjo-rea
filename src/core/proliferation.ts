// Dye-dilution proliferation model. Each division halves intensity, so in
// log10 space generation g sits at log10(parent) - g * log10(2) with a width
// common to all generations. Parent position and width are found by
// Nelder-Mead; per-generation counts by Poisson-weighted NNLS at each step.
// Validated on synthetic data only; not compared against FlowJo output.
//
// With N_g the fitted cell count in generation g and O_g = N_g / 2^g the
// number of original (precursor) cells that gave rise to them:
//   precursorFrequency = sum_{g>=1} O_g / sum_{g>=0} O_g
//   divisionIndex      = sum_g g * O_g / sum_{g>=0} O_g
//   proliferationIndex = sum_g g * O_g / sum_{g>=1} O_g
//   expansionIndex     = sum_g N_g / sum_g O_g
//   pctDivided         = sum_{g>=1} N_g / sum_g N_g   (a fraction, 0..1)
import { fail } from './errors';
import { nelderMead, nnls, smooth1d } from './cellcycle';

export interface ProliferationFit {
  parentPeak: number;
  width: number;
  generations: { index: number; peak: number; count: number; pct: number }[];
  precursorFrequency: number;
  divisionIndex: number;
  proliferationIndex: number;
  expansionIndex: number;
  pctDivided: number;
  histogram: { edges: Float64Array; observed: Float64Array; fitted: Float64Array };
  rmsd: number;
  warnings: string[];
}

export interface ProliferationOptions {
  log10Min?: number;
  log10Max?: number;
  bins?: number;
  parentPeak?: number;
  maxGenerations?: number;
}

// Abramowitz-Stegun 7.1.26 (|error| < 1.5e-7).
function erf(x: number): number {
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - p * Math.exp(-a * a));
}
const cdf = (x: number, m: number, s: number) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));

const LOG2 = Math.log10(2);

export function fitProliferation(values: Float64Array, opts: ProliferationOptions = {}): ProliferationFit {
  const warnings: string[] = [];
  const logs: number[] = [];
  let dropped = 0;
  for (const v of values) if (v > 0 && Number.isFinite(v)) logs.push(Math.log10(v)); else dropped++;
  if (dropped) warnings.push(`${dropped} nonpositive or non-finite values were dropped`);
  if (logs.length === 0) fail('FIT_INVALID', 'Proliferation fit: no positive values');
  const lo = opts.log10Min ?? logs.reduce((a, b) => Math.min(a, b), Infinity);
  const hi = opts.log10Max ?? logs.reduce((a, b) => Math.max(a, b), -Infinity);
  if (!(hi > lo)) fail('FIT_INVALID', 'Proliferation fit: empty log10 range');
  const B = opts.bins ?? 256;
  const maxGen = opts.maxGenerations ?? 8;
  const dw = (hi - lo) / B;
  const edges = Float64Array.from({ length: B + 1 }, (_, i) => lo + i * dw);
  const obs = new Float64Array(B);
  for (const l of logs) {
    const b = Math.floor((l - lo) / dw);
    if (b >= 0 && b <= B) obs[Math.min(b, B - 1)]++;
  }
  const wts = Float64Array.from(obs, (o) => 1 / Math.max(o, 1));

  // Starting point: brightest smoothed peak at least 10% of the tallest.
  const sm = smooth1d(obs, Math.max(1, B / 256));
  const top = Math.max(...sm);
  if (!(top > 0)) fail('FIT_INVALID', 'Proliferation fit: no events inside the log10 range');
  let pk = -1;
  for (let i = 0; i < B; i++) {
    const left = i === 0 ? -1 : sm[i - 1], right = i === B - 1 ? -1 : sm[i + 1];
    if (sm[i] >= 0.1 * top && sm[i] >= left && sm[i] > right) pk = i;
  }
  const p0 = opts.parentPeak !== undefined ? Math.log10(opts.parentPeak) : lo + (pk + 0.5) * dw;
  let hw = 1;
  while (pk - hw > 0 && pk + hw < B - 1 && sm[pk + hw] > sm[pk] / 2) hw++;
  const w0 = Math.min(Math.max(hw * dw / 1.1774, 2 * dw), 0.3 * LOG2);

  const gens = (p: number) => {
    const g: number[] = [];
    for (let k = 0; k <= maxGen && p - k * LOG2 >= lo; k++) g.push(k);
    return g;
  };
  // Column g: expected fraction of a unit-count generation falling in each bin.
  const columns = (p: number, w: number) =>
    gens(p).map((g) => Float64Array.from({ length: B }, (_, i) => cdf(edges[i + 1], p - g * LOG2, w) - cdf(edges[i], p - g * LOG2, w)));
  const solveCounts = (cols: Float64Array[]) => {
    const G = cols.map((a) => cols.map((b) => a.reduce((s, v, k) => s + v * b[k] * wts[k], 0)));
    const h = cols.map((a) => a.reduce((s, v, k) => s + v * obs[k] * wts[k], 0));
    return nnls(G, h);
  };
  const model = (cols: Float64Array[], c: number[]) => Float64Array.from({ length: B }, (_, i) => cols.reduce((s, col, g) => s + c[g] * col[i], 0));
  const sse = (q: number[]) => {
    const [p, w] = q;
    if (w < 0.5 * dw || w > 0.5 * LOG2 || p < lo || p > hi + 2 * w || Math.abs(p - p0) > 0.5 * LOG2) return Infinity;
    const cols = columns(p, w);
    const f = model(cols, solveCounts(cols));
    let e = 0;
    for (let i = 0; i < B; i++) e += (obs[i] - f[i]) ** 2 * wts[i];
    return e;
  };
  const fixedParent = opts.parentPeak !== undefined;
  let best = fixedParent
    ? (() => { const r = nelderMead((q) => sse([p0, q[0]]), [w0], [0.2 * w0]); return { x: [p0, r.x[0]], fx: r.fx }; })()
    : nelderMead(sse, [p0, w0], [0.1 * LOG2, 0.2 * w0]);
  if (!fixedParent) {
    for (let r = 0; r < 3; r++) {
      const next = nelderMead(sse, best.x, [0.03 * LOG2, 0.1 * best.x[1]]);
      const done = next.fx >= best.fx * (1 - 1e-6);
      if (next.fx < best.fx) best = next;
      if (done) break;
    }
  }
  const [p, w] = best.x;
  const cols = columns(p, w);
  const c = solveCounts(cols);
  const fitted = model(cols, c);
  const idx = gens(p);
  if (idx.length && idx[idx.length - 1] < maxGen && p - idx[idx.length - 1] * LOG2 < lo + 2 * w)
    warnings.push('The last fitted generation is truncated by the lower end of the range; dimmer generations cannot be resolved');

  const N = c.reduce((s, v) => s + v, 0);
  const O = c.map((v, k) => v / 2 ** idx[k]);
  const Osum = O.reduce((s, v) => s + v, 0);
  const Odiv = Osum - (O[0] ?? 0);
  const gO = O.reduce((s, v, k) => s + idx[k] * v, 0);
  let ss = 0;
  for (let i = 0; i < B; i++) ss += (obs[i] - fitted[i]) ** 2;
  return {
    parentPeak: 10 ** p,
    width: w,
    generations: idx.map((g, k) => ({ index: g, peak: 10 ** (p - g * LOG2), count: c[k], pct: N > 0 ? (100 * c[k]) / N : 0 })),
    precursorFrequency: Osum > 0 ? Odiv / Osum : NaN,
    divisionIndex: Osum > 0 ? gO / Osum : NaN,
    proliferationIndex: Odiv > 0 ? gO / Odiv : NaN,
    expansionIndex: Osum > 0 ? N / Osum : NaN,
    pctDivided: N > 0 ? (N - (c[0] ?? 0)) / N : NaN,
    histogram: { edges, observed: obs, fitted },
    rmsd: Math.sqrt(ss / B),
    warnings,
  };
}
