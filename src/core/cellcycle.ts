// Univariate DNA cell cycle fitting on a linear-scale histogram (bin index =
// channel value). Dean-Jett-Fox: two Gaussians plus a broadened 2nd-order
// polynomial S phase, fitted by Nelder-Mead over peak positions/widths with
// nonnegative areas solved exactly (NNLS) at each step. Watson (pragmatic):
// half-peak Gaussian fits, S = residual between the peaks. Validated on
// synthetic data only; not compared against FlowJo or ModFit output.
import { fail } from './errors';

export interface CellCycleFit {
  model: 'dean-jett-fox' | 'watson';
  g1: { mean: number; sd: number; area: number };
  g2: { mean: number; sd: number; area: number };
  sArea: number;
  g1Pct: number;
  sPct: number;
  g2Pct: number;
  rmsd: number;
  chiSquare: number;
  fitted: Float64Array;
  components: { g1: Float64Array; s: Float64Array; g2: Float64Array };
  warnings: string[];
}

export interface CellCycleOptions {
  model: 'dean-jett-fox' | 'watson';
  g1Guess?: number;
  g2Ratio?: number;
  constrainG2?: boolean;
  cvEqual?: boolean;
}

// Downhill simplex minimiser. step gives the initial simplex edge per dimension.
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 400): { x: number[]; fx: number } {
  const d = x0.length;
  let pts = [x0.slice(), ...step.map((s, i) => x0.map((v, j) => (j === i ? v + s : v)))];
  let fs = pts.map(f);
  for (let it = 0; it < iters; it++) {
    const ord = fs.map((_, i) => i).sort((a, b) => fs[a] - fs[b]);
    pts = ord.map((i) => pts[i]);
    fs = ord.map((i) => fs[i]);
    if (Math.abs(fs[d] - fs[0]) <= 1e-10 * (Math.abs(fs[0]) + 1e-12)) break;
    const c = x0.map((_, j) => pts.slice(0, d).reduce((s, p) => s + p[j], 0) / d);
    const at = (t: number) => c.map((v, j) => v + t * (pts[d][j] - v));
    const xr = at(-1), fr = f(xr);
    if (fr < fs[0]) {
      const xe = at(-2), fe = f(xe);
      [pts[d], fs[d]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < fs[d - 1]) {
      [pts[d], fs[d]] = [xr, fr];
    } else {
      const xc = fr < fs[d] ? at(-0.5) : at(0.5), fc = f(xc);
      if (fc < Math.min(fr, fs[d])) [pts[d], fs[d]] = [xc, fc];
      else for (let i = 1; i <= d; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); fs[i] = f(pts[i]); }
    }
  }
  const b = fs.indexOf(Math.min(...fs));
  return { x: pts[b], fx: fs[b] };
}

// Dense solve of a small symmetric system (Gaussian elimination, partial pivoting).
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    [M[k], M[p]] = [M[p], M[k]];
    const piv = M[k][k] || 1e-300;
    for (let i = k + 1; i < n; i++) { const f = M[i][k] / piv; for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / (M[i][i] || 1e-300); }
  return x;
}

// Lawson-Hanson NNLS on the normal equations: min |Ax - b|, x >= 0, given G = A'A, h = A'b.
export function nnls(G: number[][], h: number[]): number[] {
  const n = h.length;
  const x = new Array(n).fill(0);
  const P = new Set<number>();
  const tol = 1e-12 * Math.max(1, ...h.map(Math.abs));
  for (let outer = 0; outer < 3 * n; outer++) {
    const w = h.map((hv, i) => hv - G[i].reduce((s, g, j) => s + g * x[j], 0));
    let j = -1;
    for (let i = 0; i < n; i++) if (!P.has(i) && w[i] > tol && (j < 0 || w[i] > w[j])) j = i;
    if (j < 0) break;
    P.add(j);
    for (let inner = 0; inner < 3 * n; inner++) {
      const idx = [...P];
      const zP = solve(idx.map((a) => idx.map((c) => G[a][c])), idx.map((a) => h[a]));
      if (zP.every((v) => v > 0)) { idx.forEach((a, k) => (x[a] = zP[k])); break; }
      let alpha = 1;
      idx.forEach((a, k) => { if (zP[k] <= 0) alpha = Math.min(alpha, x[a] / (x[a] - zP[k])); });
      idx.forEach((a, k) => { x[a] += alpha * (zP[k] - x[a]); if (x[a] <= 1e-12) { x[a] = 0; P.delete(a); } });
    }
  }
  return x;
}

export function smooth1d(y: ArrayLike<number>, sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const out = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) {
    let s = 0, w = 0;
    for (let k = -r; k <= r; k++) {
      if (i + k < 0 || i + k >= y.length) continue;
      const g = Math.exp(-(k * k) / (2 * sigma * sigma));
      s += y[i + k] * g;
      w += g;
    }
    out[i] = s / w;
  }
  return out;
}

const gauss = (x: number, m: number, s: number) => Math.exp(-((x - m) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));

// Bernstein S-phase basis between m1 and m2, each source point broadened by a
// Gaussian whose sd is interpolated between s1 and s2. Columns over bins lo..hi.
function sBasis(m1: number, s1: number, m2: number, s2: number, lo: number, hi: number): Float64Array[] {
  const cols = [0, 1, 2].map(() => new Float64Array(hi - lo + 1));
  const K = Math.max(4, Math.ceil(m2 - m1));
  const dx = (m2 - m1) / K;
  for (let k = 0; k < K; k++) {
    const t = (k + 0.5) / K, xs = m1 + t * (m2 - m1), sd = s1 + t * (s2 - s1);
    const bern = [(1 - t) ** 2, 2 * t * (1 - t), t * t];
    for (let i = Math.max(lo, Math.floor(xs - 4 * sd)); i <= Math.min(hi, Math.ceil(xs + 4 * sd)); i++) {
      const g = gauss(i, xs, sd) * dx;
      for (let b = 0; b < 3; b++) cols[b][i - lo] += bern[b] * g;
    }
  }
  return cols;
}

export function fitCellCycle(hist: Float64Array | number[], opts: CellCycleOptions): CellCycleFit {
  const y = Float64Array.from(hist);
  const n = y.length;
  let total = 0;
  for (const v of y) total += v > 0 ? v : 0;
  if (n < 8 || total <= 0) fail('FIT_INVALID', 'Cell cycle fit: histogram is empty');
  const ratio = opts.g2Ratio ?? 2;
  const constrain = opts.constrainG2 ?? true;
  const cvEq = opts.cvEqual ?? true;
  const warnings: string[] = [];

  // G1 location: tallest smoothed peak (skipping the lowest 2% of channels), or the guess.
  const sm = smooth1d(y, Math.max(1, n / 256));
  let pk = -1;
  if (opts.g1Guess !== undefined) {
    const g = Math.round(opts.g1Guess), r = Math.max(2, Math.round(0.05 * g));
    for (let i = Math.max(0, g - r); i <= Math.min(n - 1, g + r); i++) if (pk < 0 || sm[i] > sm[pk]) pk = i;
  } else {
    for (let i = Math.ceil(0.02 * n); i < n; i++) if (pk < 0 || sm[i] > sm[pk]) pk = i;
  }
  if (pk <= 0 || pk >= n - 1 || !(sm[pk] > 0)) fail('FIT_INVALID', 'Cell cycle fit: no G1 peak found');
  const den = sm[pk - 1] - 2 * sm[pk] + sm[pk + 1];
  const m0 = pk + (den < 0 ? (0.5 * (sm[pk - 1] - sm[pk + 1])) / den : 0);
  let hw = 1;
  while (pk - hw > 0 && sm[pk - hw] > sm[pk] / 2) hw++;
  const s0 = Math.max(1, hw / 1.1774);
  const lo = Math.max(0, Math.floor(0.5 * m0));
  const hi = Math.min(n - 1, Math.ceil(1.5 * ratio * m0));
  const xs = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  const wts = xs.map((i) => 1 / Math.max(y[i], 1));

  let p: { m1: number; s1: number; m2: number; s2: number };
  let comp: { g1: Float64Array; s: Float64Array; g2: Float64Array };
  let nParams: number;

  if (opts.model === 'dean-jett-fox') {
    const unpack = (q: number[]) => {
      let k = 2;
      const m2 = constrain ? ratio * q[0] : q[k++];
      const s2 = cvEq ? (q[1] * m2) / q[0] : q[k++];
      return { m1: q[0], s1: q[1], m2, s2 };
    };
    const columns = (u: ReturnType<typeof unpack>) => [
      Float64Array.from(xs, (i) => gauss(i, u.m1, u.s1)),
      Float64Array.from(xs, (i) => gauss(i, u.m2, u.s2)),
      ...sBasis(u.m1, u.s1, u.m2, u.s2, lo, hi),
    ];
    const solveAreas = (cols: Float64Array[]) => {
      const G = cols.map((a) => cols.map((b) => a.reduce((s, v, k) => s + v * b[k] * wts[k], 0)));
      const h = cols.map((a) => a.reduce((s, v, k) => s + v * y[xs[k]] * wts[k], 0));
      return nnls(G, h);
    };
    const sse = (q: number[]) => {
      const u = unpack(q);
      if (u.s1 < 0.5 || u.s2 < 0.5 || u.m1 <= lo + 1 || u.m1 >= hi - 1 || u.m2 < 1.5 * u.m1 || u.m2 > 2.5 * u.m1) return Infinity;
      const cols = columns(u);
      const c = solveAreas(cols);
      let e = 0;
      for (let k = 0; k < xs.length; k++) {
        let f = 0;
        for (let b = 0; b < cols.length; b++) f += c[b] * cols[b][k];
        e += (y[xs[k]] - f) ** 2 * wts[k];
      }
      return e;
    };
    let x = [m0, s0];
    let step = [0.25 * s0, 0.2 * s0];
    if (!constrain) { x.push(ratio * m0); step.push(0.25 * s0 * ratio); }
    if (!cvEq) { x.push(s0 * ratio); step.push(0.2 * s0 * ratio); }
    let best = nelderMead(sse, x, step);
    for (let r = 0; r < 3; r++) {
      const next = nelderMead(sse, best.x, step.map((s) => s * 0.5));
      const done = next.fx >= best.fx * (1 - 1e-6);
      if (next.fx < best.fx) best = next;
      if (done) break;
    }
    p = unpack(best.x);
    nParams = best.x.length + 5;
    const c = solveAreas(columns(p));
    const all = Array.from({ length: n }, (_, i) => i);
    const sc = sBasis(p.m1, p.s1, p.m2, p.s2, 0, n - 1);
    comp = {
      g1: Float64Array.from(all, (i) => c[0] * gauss(i, p.m1, p.s1)),
      g2: Float64Array.from(all, (i) => c[1] * gauss(i, p.m2, p.s2)),
      s: Float64Array.from(all, (i) => c[2] * sc[0][i] + c[3] * sc[1][i] + c[4] * sc[2][i]),
    };
  } else {
    // Watson (pragmatic): amplitude in closed form, sd by 1-D search, over a half peak.
    const halfFit = (m: number, sGuess: number, from: number, to: number, sFixed?: number) => {
      const idx: number[] = [];
      for (let i = Math.max(0, Math.ceil(from)); i <= Math.min(n - 1, Math.floor(to)); i++) idx.push(i);
      const amp = (s: number) => {
        let a = 0, b = 0;
        for (const i of idx) { const g = gauss(i, m, s), w = 1 / Math.max(y[i], 1); a += w * g * y[i]; b += w * g * g; }
        return b > 0 ? Math.max(0, a / b) : 0;
      };
      const err = (s: number) => {
        if (s < 0.5) return Infinity;
        const A = amp(s);
        return idx.reduce((e, i) => e + (y[i] - A * gauss(i, m, s)) ** 2 / Math.max(y[i], 1), 0);
      };
      const s = sFixed ?? nelderMead((q) => err(q[0]), [sGuess], [0.2 * sGuess]).x[0];
      return { s, A: amp(s) };
    };
    const m1 = m0;
    const f1 = halfFit(m1, s0, m1 - 3 * s0, m1);
    let m2 = ratio * m1;
    if (!constrain) {
      let q = -1;
      for (let i = Math.round(0.85 * m2); i <= Math.min(n - 2, Math.round(1.15 * m2)); i++) if (q < 0 || sm[i] > sm[q]) q = i;
      if (q > 0) {
        const d2 = sm[q - 1] - 2 * sm[q] + sm[q + 1];
        m2 = q + (d2 < 0 ? (0.5 * (sm[q - 1] - sm[q + 1])) / d2 : 0);
      }
    }
    const sg2 = (f1.s * m2) / m1;
    const f2 = halfFit(m2, sg2, m2, m2 + 3 * sg2, cvEq ? sg2 : undefined);
    p = { m1, s1: f1.s, m2, s2: f2.s };
    nParams = cvEq ? 4 : 5;
    const g1 = Float64Array.from({ length: n }, (_, i) => f1.A * gauss(i, m1, f1.s));
    const g2 = Float64Array.from({ length: n }, (_, i) => f2.A * gauss(i, m2, f2.s));
    const s = new Float64Array(n);
    for (let i = Math.ceil(m1); i <= Math.min(n - 1, Math.floor(m2)); i++) s[i] = Math.max(0, y[i] - g1[i] - g2[i]);
    comp = { g1, s, g2 };
  }

  const fitted = Float64Array.from({ length: n }, (_, i) => comp.g1[i] + comp.s[i] + comp.g2[i]);
  let ss = 0, chi = 0;
  for (const i of xs) { ss += (y[i] - fitted[i]) ** 2; chi += (y[i] - fitted[i]) ** 2 / Math.max(y[i], 1); }
  const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);
  const a1 = sum(comp.g1), aS = sum(comp.s), a2 = sum(comp.g2), at = a1 + aS + a2 || 1;
  let outside = 0;
  for (let i = 0; i < n; i++) if ((i < 0.5 * p.m1 || i > 1.5 * p.m2) && y[i] > 0) outside += y[i];
  if (outside > 0.1 * total) warnings.push(`${((100 * outside) / total).toFixed(1)}% of events lie outside 0.5 x G1 .. 1.5 x G2 (debris or aggregates) and are excluded from the phase percentages`);
  if (p.m2 > n - 1) warnings.push('G2 peak position lies beyond the histogram range');
  return {
    model: opts.model,
    g1: { mean: p.m1, sd: p.s1, area: a1 },
    g2: { mean: p.m2, sd: p.s2, area: a2 },
    sArea: aS,
    g1Pct: (100 * a1) / at,
    sPct: (100 * aS) / at,
    g2Pct: (100 * a2) / at,
    rmsd: Math.sqrt(ss / xs.length),
    chiSquare: chi / Math.max(1, xs.length - nParams),
    fitted,
    components: comp,
    warnings,
  };
}
