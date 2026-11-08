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

// Multivariate probability binning (MultiDimCompare::ChiSquare,
// BuildComparisonTree, DivideTree, SortPartition, FilterSampleThroughTree,
// CleanUpLeafCounts; spec platforms.md section 4). Each event's value on each
// parameter is its display-scale position u in [0, 1] stored as an integer
// v = trunc(1024 u). A tree is built on each control population in turn (all
// trees share one node list): a node takes the parameter whose 1024-bin
// histogram has the largest standard deviation (BasicHistogram::
// ChannelStdDev, n - 1 denominator, first maximum wins) and splits at its
// median bin (ChannelMedian: first bin whose running count reaches n/2,
// at least 1): events with v < split go left. A node whose split leaves one
// side empty is a terminal leaf; a child with fewer than
// max(trunc(Nc / bins), 5) events becomes a terminal leaf, otherwise it is
// divided again. The sample and the controls are dropped through the last
// tree built; the control counts kept are the last control's (the engine
// overwrites them per control) while Nc is the sum of all control counts.
// chi = sum over terminal leaves (all trees) of (p - q)^2 / (p + q), float.
export function multivariateChi(controls: Float64Array[][], sample: Float64Array[], dims: number, bins = DEFAULT_MV_BINS): ChiResult {
  const q = (u: number) => (Number.isFinite(u) ? Math.trunc(Math.min(1, Math.max(0, u)) * 1024) : 0);
  const quant = (ev: Float64Array[]) => { const out = new Uint16Array(ev.length * dims); ev.forEach((e, i) => { for (let d = 0; d < dims; d++) out[i * dims + d] = q(e[d]); }); return out; };
  const ncTotal = controls.reduce((a, c) => a + c.length, 0);
  const minLeaf = Math.trunc(Math.max(f32(ncTotal / bins), 5));
  // Node list; null is the shared terminal leaf entry.
  const nodes: ({ dim: number; split: number; left: number; right: number } | null)[] = [];
  const push = (n: (typeof nodes)[number]) => { nodes.push(n); return nodes.length; };
  const divide = (v: Uint16Array, start: number, count: number): number => {
    let dim = 0, best = -1;
    const hist = new Float64Array(1024);
    for (let d = 0; d < dims; d++) {
      hist.fill(0);
      for (let i = start; i < start + count; i++) hist[Math.min(1023, v[i * dims + d])]++;
      let sd = 0;
      if (count > 1) {
        let m = 0;
        for (let b = 0; b < 1024; b++) m += b * hist[b];
        m /= count;
        let s2 = 0;
        for (let b = 0; b < 1024; b++) s2 += (b - m) * (b - m) * hist[b];
        sd = Math.sqrt(s2 / (count - 1));
      }
      if (sd > best) { best = sd; dim = d; }
    }
    hist.fill(0);
    for (let i = start; i < start + count; i++) hist[Math.min(1023, v[i * dims + dim])]++;
    const half = f32(f32(count * 50) * 0.01);
    let k = 1, run = 0;
    if (count > 0) for (;;) { if (k >= 1024) break; run += hist[k - 1]; if (run >= half) break; k++; }
    const split = Math.trunc(Math.max(count > 0 ? k - 1 : 0, 1));
    // SortPartition: v < split first.
    const lo: number[] = [], hi: number[] = [];
    for (let i = start; i < start + count; i++) (v[i * dims + dim] < split ? lo : hi).push(i);
    const copy = v.slice(start * dims, (start + count) * dims);
    [...lo, ...hi].forEach((src, j) => { for (let d = 0; d < dims; d++) v[(start + j) * dims + d] = copy[(src - start) * dims + d]; });
    const left = lo.length;
    if (left === 0 || left === count) return push(null);
    const l = left < minLeaf ? push(null) : divide(v, start, left);
    const r = count - left < minLeaf ? push(null) : divide(v, start + left, count - left);
    return push({ dim, split, left: l, right: r });
  };
  let root = 0;
  for (const c of controls) if (c.length) root = divide(quant(c), 0, c.length);
  const leafCounts = (ev: Float64Array[]) => {
    const counts = new Float64Array(nodes.length);
    if (root) for (const e of ev) {
      let n = root;
      for (;;) {
        const node = nodes[n - 1];
        if (!node) { counts[n - 1]++; break; }
        n = q(e[node.dim]) < node.split ? node.left : node.right;
      }
    }
    return counts.filter((_, i) => nodes[i] === null);
  };
  const last = [...controls].reverse().find((c) => c.length) ?? [];
  const cc = leafCounts(last), sc = leafCounts(sample);
  const ns = sample.length, invS = f32(1 / ns), invC = f32(1 / ncTotal);
  let chi = 0;
  for (let k = 0; k < cc.length; k++) {
    const p = f32(sc[k] * invS), qq = f32(cc[k] * invC), t = f32(qq + p);
    if (t > 0) chi = f32(chi + f32(f32((p - qq) * (p - qq)) / t));
  }
  const nb = cc.length;
  const { tx, maxT } = tOf(chi, nb, Math.min(ns, ncTotal));
  return { chi, tx, maxT, bins: nb };
}

// Population measures (Comparison::MatchRatio, CalculateMatchingMatrix,
// FMeasure). FlowJo requests them per comparator population with the
// comparison's own population as consensus / correct and the comparator as
// candidate; the event set is every event of the consensus population's
// sample (membership by event index; a population that is "All events"
// contains every event). Masks are 0/1 per event.
type Mask = ArrayLike<number> | null;
const inMask = (m: Mask, e: number) => (m === null ? true : e < m.length && !!m[e]);
// MatchRatio: weight w(e) = |f(e) - 0.5| with f the fraction of consensus
// populations holding e; a population scores w(e) for every event it agrees
// with the consensus on. The engine lays the per-population rows out with a
// stride of (populations - 1) instead of the event count, so rows overlap;
// this is reproduced. One consensus and one candidate: a single value
// score(0) / sum w; otherwise one value per population.
export function matchRatio(consensus: Mask[], candidates: Mask[], n: number): number[] {
  const a = consensus.length, pops = [...consensus, ...candidates], K = pops.length;
  if (!a || !K || n < 1) return [];
  const inv = f32(1 / a), frac = new Float64Array(n), w = new Float64Array(n);
  let W = 0;
  for (let e = 0; e < n; e++) {
    let c = 0;
    for (const m of consensus) if (inMask(m, e)) c++;
    frac[e] = f32(c * inv);
    w[e] = Math.abs(frac[e] - 0.5);
    W += w[e];
  }
  const stride = K - 1, flat = new Float64Array(n * K);
  pops.forEach((m, k) => {
    for (let e = 0; e < n; e++) {
      const inside = inMask(m, e);
      flat[k * stride + e] = m === null ? (frac[e] > 0.5 ? w[e] : 0) : ((frac[e] > 0.5 && inside) || (frac[e] < 0.5 && !inside) ? w[e] : 0);
    }
  });
  const score = pops.map((_, k) => { let s = 0; for (let e = 0; e < n; e++) s += flat[k * stride + e]; return s; });
  if (a === 1 && candidates.length === 1) return [score[0] / W];
  return score.map((s) => s * (1 / W));
}
export interface FMeasureResult { value: number; precision: number; recall: number; total: number }
// FMeasure: matching matrix M(i, j) = events in correct population i and
// candidate j; precision = M / |candidate j|, recall = M / |correct i|,
// F = 2 P R / (P + R); totalFMeasure = sum over i of |correct i| / N times the
// best F of row i. Rows are stored with a stride of (correct count - 1) as in
// the engine. value, precision and recall are those of the last pair.
export function fMeasure(correct: Mask[], candidates: Mask[], n: number): FMeasureResult | null {
  const a = correct.length, b = candidates.length;
  if (!a || !b) return null;
  const size = (m: Mask) => { if (m === null) return 1; let s = 0; for (let e = 0; e < m.length; e++) if (m[e]) s++; return s; };
  const M = correct.map((ca) => candidates.map((cb) => { let s = 0; for (let e = 0; e < n; e++) if (inMask(ca, e) && inMask(cb, e)) s++; return s; }));
  const stride = a - 1, P = new Float64Array(a * b + b), R = new Float64Array(a * b + b);
  let precision = 0, recall = 0;
  correct.forEach((ca, i) => {
    const sa = size(ca);
    candidates.forEach((cb, j) => {
      const sb = size(cb), idx = stride * i + j;
      P[idx] = sb ? M[i][j] / sb : 0;
      R[idx] = sa ? M[i][j] * (1 / sa) : 0;
      recall = R[idx];
    });
    precision = P[stride * i + b - 1];
  });
  const F = new Float64Array(a * b + b);
  let value = 0;
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) { const k = stride * i + j, s = P[k] + R[k]; value = s !== 0 ? (R[k] * (P[k] + P[k])) / s : 0; F[k] = value; }
  let total = 0;
  const perN = 1 / n;
  correct.forEach((ca, i) => {
    let bi = 0;
    for (let j = 1; j < b; j++) if (F[stride * i + j] > F[stride * i + bi]) bi = j;
    total += size(ca) * perN * F[stride * i + bi];
  });
  return { value, precision, recall, total };
}

// ComparisonFrame remove buttons.
export const isScatter = (n: string) => /^(FSC|SSC)/i.test(n);
export const isNonFluorescent = (n: string) => /^(FSC|SSC|Time|Event)/i.test(n) || /^time$/i.test(n);
