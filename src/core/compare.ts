// FlowJo 10.6.2 Compare Populations (PlatformNavCommand.COMPARISON; spec
// docs/validation/ui-gaps/platforms.md section "Compare Populations"). The
// statistics run in FlowJo's native engine (Comparison::CalcUnivariateStats,
// KolmogorovSmirnoff::*, BasicHistogram::OvertonPositive, MultiDimCompare);
// the univariate rules below were read from it and implemented independently.
// All univariate statistics use 256-bucket histograms of each population on
// the parameter's display scale (off-scale events in the edge buckets); the
// control histogram is the sum of every comparator population.

export const COMPARE_BUCKETS = 256;
// KolmogorovSmirnoff::ChiSquared is called with 50 bins.
export const CHI_BINS = 50;
// ComparisonNode default "Number of bins" for the multivariate comparison.
export const DEFAULT_MV_BINS = 300;

const sum = (h: ArrayLike<number>) => { let s = 0; for (let i = 0; i < h.length; i++) s += h[i]; return s; };
// BasicHistogram::CDF(0, max): running counts.
export function cumulative(h: ArrayLike<number>, to = h.length - 1): Float64Array {
  const out = new Float64Array(h.length);
  let s = 0;
  for (let i = 0; i <= Math.min(to, h.length - 1); i++) { s += h[i]; out[i] = s; }
  return out;
}
const f32 = Math.fround;

// KolmogorovSmirnoff::CalcQsubKS critical values (lambda) and their p.
const KS_D = [1.0727, 1.2238, 1.3581, 1.5174, 1.6276, 1.7317, 1.8585, 1.9526];
const KS_P = [0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
export function ksProbability(lambda: number): { p: number; text: string } {
  const l = f32(lambda);
  if (l === 0) return { p: 0, text: '0%' };
  if (l < f32(KS_D[0])) return { p: KS_P[0], text: 'less than 80%' };
  for (let k = 1; k < KS_D.length; k++) {
    if (l < f32(KS_D[k])) {
      const a = Number(((1 - KS_P[k - 1]) * 100).toPrecision(4)), b = Number(((1 - KS_P[k]) * 100).toPrecision(4));
      return { p: KS_P[k], text: `between ${a}% and ${b}%` };
    }
  }
  return { p: 0, text: 'greater than 99.9%' };
}

export interface KsResult { d: number; bucket: number; lambda: number; p: number; text: string }
// KolmogorovSmirnoff::Calculate on the two cumulative histograms: D = max
// over buckets of |S(i)/Ns - C(i)/Nc| (first bucket reaching it), N =
// floor(Ns*Nc/(Ns+Nc)) in integers, lambda = D*sqrt(N), probability text
// from the critical-value table.
export function kolmogorovSmirnov(sample: ArrayLike<number>, control: ArrayLike<number>): KsResult {
  const cs = cumulative(sample), cc = cumulative(control);
  const ns = cs[cs.length - 1] || 0, nc = cc[cc.length - 1] || 0;
  let d = 0, bucket = 0;
  if (ns > 0 && nc > 0) for (let i = 0; i < cs.length; i++) {
    const v = f32(Math.abs(f32(cs[i] * f32(1 / ns)) - f32(cc[i] * f32(1 / nc))));
    if (v > d) { d = v; bucket = i; }
  }
  const n = ns + nc > 0 ? Math.floor((ns * nc) / (ns + nc)) : 0;
  const lambda = n > 0 ? f32(d * Math.sqrt(n)) : 0;
  return { d, bucket, lambda, ...ksProbability(lambda) };
}

// BasicHistogram::OvertonPositive: per bucket d = s/Ns - c/Nc; a negative d
// is cancelled against the positive d of lower buckets (lowest first); the
// result is 100 x the sum of what stays positive.
export function overtonPositive(sample: ArrayLike<number>, control: ArrayLike<number>): number {
  const ns = sum(sample), nc = sum(control);
  if (!(ns > 0) || !(nc > 0)) return 0;
  const d = new Float64Array(sample.length);
  for (let i = 0; i < d.length; i++) {
    d[i] = f32(f32(sample[i] * f32(1 / ns)) - f32((control[i] ?? 0) * f32(1 / nc)));
    for (let j = 0; d[i] < 0 && j < i; j++) {
      if (d[j] > 0) { const m = Math.min(-d[i], d[j]); d[j] = f32(d[j] - m); d[i] = f32(d[i] + m); }
    }
  }
  let pos = 0;
  for (const v of d) if (v > 0) pos = f32(pos + v);
  return f32(pos * 100);
}

// BasicHistogram::Difference on cumulative histograms (cdf flag set):
// v(i) = A(i)/(A(to) - A(from)) - B(i)/(B(to) - B(from)) for i in from..to.
function cdfDifference(a: Float64Array, b: Float64Array, from: number, to: number): number[] {
  const na = a[to] - a[from], nb = b[to] - b[from];
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(f32(f32(a[i] / na) - f32(b[i] / nb)));
  return out;
}
const argmax = (v: number[]) => { let k = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[k]) k = i; return k; };

// SE Dymax %Positive (Comparison::CalcUnivariateStats): m = bucket where the
// control CDF most exceeds the sample CDF; m2 = the same within buckets
// 0..m; with c = C(m)/Nc, s = S(m)/Ns: 100 (1 - s/c + (C(m2)/Nc) s / c^2 -
// S(m2)/(Ns c)); 0 when c = 0.
export function seDymaxPositive(sample: ArrayLike<number>, control: ArrayLike<number>): number {
  const cs = cumulative(sample), cc = cumulative(control);
  const n = cs.length - 1, ns = cs[n], nc = cc[n];
  if (!(ns > 0) || !(nc > 0)) return 0;
  const m = argmax(cdfDifference(cc, cs, 0, n));
  const cs2 = cumulative(sample, m), cc2 = cumulative(control, m);
  const m2 = argmax(cdfDifference(cc2, cs2, 0, m));
  const c = f32(cc[m] / nc);
  if (c === 0) return 0;
  const s = f32(cs[m] / ns), c2 = f32(cc[m2] / nc), s2 = cs[m2];
  const v = 1 - f32(s / c) + f32(f32(c2 * s) / f32(c * c)) - f32(s2 / f32(ns * c));
  return f32(v * 100);
}

export interface ChiResult { chi: number; tx: number; maxT: number; bins: number }
// Probability binning T(X) (Roederer): expected chi = B/N, sd = sqrt(B)/N with
// N = min(Ns, Nc); T = max(0, (chi - B/N)/(sqrt(B)/N)); Max T = (2 - B/N)/sd.
export function tOf(chi: number, bins: number, n: number): { tx: number; maxT: number } {
  const e = f32(bins / n), sd = f32(Math.sqrt(bins) / n);
  return { tx: f32(Math.max(0, f32(f32(chi - e) / sd))), maxT: f32((2 - e) / sd) };
}
// KolmogorovSmirnoff::ChiSquared(sample, control, 50): bins are built on the
// sample histogram, each taking buckets until it holds at least Ns/50
// events; chi = sum over bins of (p - q)^2/(p + q) with p, q the sample and
// control fractions (bins where both are 0 skipped).
export function chiSquared(sample: ArrayLike<number>, control: ArrayLike<number>, bins = CHI_BINS): ChiResult {
  const ns = sum(sample), nc = sum(control), n = sample.length;
  const target = f32(ns / bins);
  let chi = 0, start = 0;
  if (target > 0) for (let k = 0; k < bins; k++) {
    let s = 0, b = start;
    while (b < n && f32(s) < target) { s += Math.trunc(sample[b]); b++; }
    let c = 0;
    for (let i = start; i < b; i++) c += control[i];
    const p = f32(s / ns), q = nc > 0 ? f32(c / nc) : 0;
    if (p !== 0 || q !== 0) chi = f32(chi + f32(f32((p - q) ** 2) / f32(p + q)));
    start = b;
  }
  const { tx, maxT } = tOf(chi, bins, Math.min(ns, nc));
  return { chi, tx, maxT, bins };
}

export interface UnivariateResult { ks: KsResult; ksMaxAt: number; overton: number; seDymax: number; chi: ChiResult }
// bucketValue(i): the scale value at the bucket's lower edge (FlowJo: channel
// range * bucket / 256 through the parameter's scale).
export function compareHistograms(sample: ArrayLike<number>, control: ArrayLike<number>, bucketValue: (i: number) => number): UnivariateResult {
  const ks = kolmogorovSmirnov(sample, control);
  return { ks, ksMaxAt: bucketValue(ks.bucket), overton: overtonPositive(sample, control), seDymax: seDymaxPositive(sample, control), chi: chiSquared(sample, control) };
}

// Multivariate probability binning (MultiDimCompare::ChiSquare): the control
// events are split recursively, each time along the dimension of largest
// variance at its median, until there are `bins` bins (each holding about
// Nc/bins control events); the sample events are dropped through the same
// tree. Own rule: the split order of FlowJo's tree is not decoded (spec).
export function multivariateChi(control: Float64Array[], sample: Float64Array[], dims: number, bins = DEFAULT_MV_BINS): ChiResult {
  const nc = control.length, ns = sample.length;
  type Node = { dim: number; cut: number; lo: Node; hi: Node } | { leaf: number };
  let leaves = 0;
  const build = (ev: Float64Array[], depth: number, want: number): Node => {
    if (want <= 1 || ev.length < 2) return { leaf: leaves++ };
    let best = 0, bv = -1;
    for (let d = 0; d < dims; d++) {
      let m = 0, q = 0;
      for (const e of ev) m += e[d];
      m /= ev.length;
      for (const e of ev) q += (e[d] - m) ** 2;
      if (q > bv) { bv = q; best = d; }
    }
    const sorted = ev.slice().sort((a, b) => a[best] - b[best]);
    const half = Math.floor(sorted.length / 2);
    const cut = sorted[half][best];
    const lw = Math.floor(want / 2);
    return { dim: best, cut, lo: build(sorted.slice(0, half), depth + 1, lw), hi: build(sorted.slice(half), depth + 1, want - lw) };
  };
  const root = build(control, 0, Math.max(1, Math.min(bins, nc)));
  const find = (n: Node, e: Float64Array): number => ('leaf' in n ? n.leaf : find(e[n.dim] < n.cut ? n.lo : n.hi, e));
  const cc = new Float64Array(leaves), sc = new Float64Array(leaves);
  for (const e of control) cc[find(root, e)]++;
  for (const e of sample) sc[find(root, e)]++;
  let chi = 0;
  for (let k = 0; k < leaves; k++) {
    const p = ns ? sc[k] / ns : 0, q = nc ? cc[k] / nc : 0;
    if (p || q) chi += (p - q) ** 2 / (p + q);
  }
  const { tx, maxT } = tOf(chi, leaves, Math.min(ns, nc));
  return { chi: f32(chi), tx, maxT, bins: leaves };
}

// ComparisonFrame remove buttons.
export const isScatter = (n: string) => /^(FSC|SSC)/i.test(n);
export const isNonFluorescent = (n: string) => /^(FSC|SSC|Time|Event)/i.test(n) || /^time$/i.test(n);
