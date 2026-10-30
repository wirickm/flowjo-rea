// Scale transformations. Linear, log, asinh, logicle and hyperlog follow the
// ISAC Gating-ML 2.0 definitions (flin, flog, fasinh, logicle, hyperlog),
// which give results on a 0..1 display scale. Logicle math is from Parks,
// Roederer & Moore, Cytometry A 69A:541 (2006). FlowJo-specific scales are
// expressed through these functions and validated against FlowJo outputs.
import { fail } from './errors';

export type TransformSpec =
  | { kind: 'none' }
  | { kind: 'linear'; T: number; A: number }
  | { kind: 'log'; T: number; M: number }
  | { kind: 'asinh'; T: number; M: number; A: number }
  | { kind: 'logicle'; T: number; W: number; M: number; A: number }
  | { kind: 'hyperlog'; T: number; W: number; M: number; A: number }
  // FlowJo 10 "biex": logicle(T=max, W=log10(-width)/2, M=pos, A=neg) scaled to channelRange.
  | { kind: 'flowjo-biex'; max: number; width: number; pos: number; neg: number; channelRange: number }
  // FlowJo 10 log: (log10(max(x, offset)) - log10(offset)) / decades
  | { kind: 'flowjo-log'; offset: number; decades: number };

export interface Transform {
  spec: TransformSpec;
  apply(x: number): number;
  inverse(y: number): number;
  displayMin: number; // display-scale bounds used for axes
  displayMax: number;
}

const LN10 = Math.LN10;

function checkPositive(name: string, v: number) {
  if (!(Number.isFinite(v) && v > 0)) fail('TRANSFORM_INVALID', `${name} must be a positive number (got ${v})`);
}

// --- Logicle -------------------------------------------------------------

interface LogicleParams {
  a: number;
  b: number;
  c: number;
  d: number;
  f: number;
  x1: number;
  T: number;
}

function solveD(b: number, w: number): number {
  if (w === 0) return b;
  // g(d) = 2(ln d - ln b) + w(b + d), increasing in d; root in (0, b).
  const g = (d: number) => 2 * (Math.log(d) - Math.log(b)) + w * (b + d);
  let lo = 0;
  let hi = b;
  let d = b / 2;
  for (let i = 0; i < 200; i++) {
    const gd = g(d);
    if (Math.abs(gd) < 1e-15) break;
    if (gd < 0) lo = d;
    else hi = d;
    const nd = d - gd / (2 / d + w); // Newton step
    d = nd > lo && nd < hi ? nd : (lo + hi) / 2;
    if (hi - lo < 1e-15 * b) break;
  }
  return d;
}

export function logicleParams(T: number, W: number, M: number, A: number): LogicleParams {
  checkPositive('T', T);
  checkPositive('M', M);
  if (!(W >= 0)) fail('TRANSFORM_INVALID', `W must be >= 0 (got ${W})`);
  if (2 * W > M) fail('TRANSFORM_INVALID', `W must be <= M/2 (W=${W}, M=${M})`);
  if (A < -W || A > M - 2 * W) fail('TRANSFORM_INVALID', `A must be in [-W, M-2W] (A=${A})`);
  const w = W / (M + A);
  const x2 = A / (M + A);
  const x1 = x2 + w;
  const x0 = x2 + 2 * w;
  const b = (M + A) * LN10;
  const d = solveD(b, w);
  const ca = Math.exp(x0 * (b + d));
  const mfa = Math.exp(b * x1) - ca / Math.exp(d * x1);
  const a = T / (Math.exp(b) - mfa - ca / Math.exp(d));
  return { a, b, c: ca * a, d, f: -mfa * a, x1, T };
}

function biexPos(p: LogicleParams, y: number): number {
  return p.a * Math.exp(p.b * y) - p.c * Math.exp(-p.d * y) + p.f;
}

export function logicleInverse(p: LogicleParams, y: number): number {
  // Data value for display position y.
  if (y >= p.x1) return biexPos(p, y);
  return -biexPos(p, 2 * p.x1 - y);
}

export function logicleForward(p: LogicleParams, x: number): number {
  if (x === 0) return p.x1;
  if (Number.isNaN(x)) return NaN;
  const neg = x < 0;
  const v = Math.abs(x);
  // Solve B(y) = v for y >= x1 with safeguarded Newton.
  let lo = p.x1;
  let hi = p.x1 + 1;
  while (biexPos(p, hi) < v) {
    lo = hi;
    hi = p.x1 + 2 * (hi - p.x1);
    if (hi > 1e6) break;
  }
  const slope0 = p.a * p.b * Math.exp(p.b * p.x1) + p.c * p.d * Math.exp(-p.d * p.x1);
  let y = Math.min(Math.max(p.x1 + v / slope0, lo), hi);
  const yl = Math.log(v / p.a) / p.b;
  if (yl > y && yl < hi) y = yl;
  for (let i = 0; i < 100; i++) {
    const fy = biexPos(p, y) - v;
    if (fy === 0) break;
    if (fy < 0) lo = y;
    else hi = y;
    const dy = p.a * p.b * Math.exp(p.b * y) + p.c * p.d * Math.exp(-p.d * y);
    let ny = y - fy / dy;
    if (!(ny > lo && ny < hi)) ny = (lo + hi) / 2;
    if (Math.abs(ny - y) <= 1e-14 * Math.max(1, Math.abs(y))) {
      y = ny;
      break;
    }
    y = ny;
  }
  return neg ? 2 * p.x1 - y : y;
}

// --- Hyperlog (Gating-ML 2.0) --------------------------------------------

function hyperlogParams(T: number, W: number, M: number, A: number) {
  checkPositive('T', T);
  checkPositive('M', M);
  if (!(W > 0)) fail('TRANSFORM_INVALID', `Hyperlog W must be > 0 (got ${W})`);
  if (2 * W > M) fail('TRANSFORM_INVALID', `W must be <= M/2`);
  if (A < -W || A > M - 2 * W) fail('TRANSFORM_INVALID', `A must be in [-W, M-2W]`);
  const b = (M + A) * LN10;
  const w = W / (M + A);
  const x2 = A / (M + A);
  const x1 = x2 + w;
  const x0 = x2 + 2 * w;
  const e0 = Math.exp(b * x0);
  const ca = e0 / w;
  const fa = Math.exp(b * x1) + ca * x1;
  const a = T / (Math.exp(b) + ca - fa);
  return { a, b, c: ca * a, f: -fa * a, x1 };
}

function hyperlogFns(T: number, W: number, M: number, A: number) {
  const p = hyperlogParams(T, W, M, A);
  const eh = (y: number) => p.a * Math.exp(p.b * y) + p.c * y + p.f;
  const inverse = (y: number) => (y >= p.x1 ? eh(y) : -eh(2 * p.x1 - y));
  const forward = (x: number) => {
    if (x === 0) return p.x1;
    const v = Math.abs(x);
    let lo = p.x1;
    let hi = p.x1 + 1;
    while (eh(hi) < v && hi < 1e6) {
      lo = hi;
      hi = p.x1 + 2 * (hi - p.x1);
    }
    let y = (lo + hi) / 2;
    for (let i = 0; i < 200; i++) {
      const fy = eh(y) - v;
      if (fy < 0) lo = y;
      else hi = y;
      const ny = y - fy / (p.a * p.b * Math.exp(p.b * y) + p.c);
      const next = ny > lo && ny < hi ? ny : (lo + hi) / 2;
      if (Math.abs(next - y) < 1e-14) {
        y = next;
        break;
      }
      y = next;
    }
    return x < 0 ? 2 * p.x1 - y : y;
  };
  return { forward, inverse };
}

// --- FlowJo biex ------------------------------------------------------------
// FlowJo evaluates biex through a channel lookup table rather than the exact
// logicle inverse: the zero point is snapped to an integer channel (which
// adjusts the effective decade count) and the scale factor is max * e^-b.
// Structure informed by FlowKit's generate_biex_lut (BSD-3-Clause, see
// THIRD_PARTY_NOTICES.md); validated against a FlowJo-exported table in
// tests/transforms.test.ts.

const biexCache = new Map<string, Float64Array>();

export function flowjoBiexTable(s: { max: number; width: number; pos: number; neg: number; channelRange: number }): Float64Array {
  const key = `${s.max}|${s.width}|${s.pos}|${s.neg}|${s.channelRange}`;
  const hit = biexCache.get(key);
  if (hit) return hit;
  if (!(s.width < 0)) fail('TRANSFORM_INVALID', `FlowJo biex width basis must be negative (got ${s.width})`);
  checkPositive('max', s.max);
  checkPositive('pos', s.pos);
  const R = s.channelRange;
  if (!(Number.isInteger(R) && R >= 16)) fail('TRANSFORM_INVALID', `Channel range must be an integer >= 16 (got ${R})`);
  const wLog = Math.log10(-s.width);
  let decades = s.pos - wLog / 2;
  const extra = Math.max(s.neg, 0) + wLog / 2;
  const zp = Math.min(Math.floor((extra * R) / (extra + decades)), Math.floor(R / 2));
  if (zp > 0) decades = (extra * R) / zp;
  const width = wLog / (2 * decades);
  const b = LN10 * decades;
  const minimum = s.max / Math.exp(b);
  const d = solveD(b, width);
  const n = R + 1;
  const scale = Math.exp((b + d) * (width + extra / decades));
  const v = new Float64Array(n);
  const posAt = (k: number) => Math.exp((k / n) * b);
  const negAt = (k: number) => Math.exp((k / n) * -d) * scale;
  const s0 = posAt(zp) - negAt(zp);
  for (let k = zp; k < n; k++) v[k] = minimum * (posAt(k) - negAt(k) - s0);
  for (let k = 0; k < zp; k++) v[k] = -v[2 * zp - k];
  if (!v.every(Number.isFinite)) fail('TRANSFORM_INVALID', 'Biex parameters produce a non-finite scale');
  biexCache.set(key, v);
  return v;
}

// Monotone table: index k <-> value v[k]. Forward maps value -> fractional
// index (clamped to the table); inverse maps index -> value.
function interpolate(v: Float64Array, q: number, inverse: boolean): number {
  const n = v.length;
  if (Number.isNaN(q)) return NaN;
  if (inverse) {
    if (q <= 0) return v[0];
    if (q >= n - 1) return v[n - 1];
    const k = Math.floor(q);
    return v[k] + (v[k + 1] - v[k]) * (q - k);
  }
  if (q <= v[0]) return 0;
  if (q >= v[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (v[mid] <= q) lo = mid;
    else hi = mid;
  }
  return lo + (q - v[lo]) / (v[hi] - v[lo]);
}

// --- Factory ---------------------------------------------------------------

export function makeTransform(spec: TransformSpec): Transform {
  switch (spec.kind) {
    case 'none':
      return { spec, apply: (x) => x, inverse: (y) => y, displayMin: NaN, displayMax: NaN };
    case 'linear': {
      checkPositive('T', spec.T);
      if (!(spec.A >= 0 && spec.A <= spec.T)) fail('TRANSFORM_INVALID', 'Linear A must be in [0, T]');
      const s = spec.T + spec.A;
      return { spec, apply: (x) => (x + spec.A) / s, inverse: (y) => y * s - spec.A, displayMin: 0, displayMax: 1 };
    }
    case 'log': {
      checkPositive('T', spec.T);
      checkPositive('M', spec.M);
      return {
        spec,
        apply: (x) => (x > 0 ? Math.log10(x / spec.T) / spec.M + 1 : NaN),
        inverse: (y) => spec.T * 10 ** ((y - 1) * spec.M),
        displayMin: 0,
        displayMax: 1,
      };
    }
    case 'asinh': {
      checkPositive('T', spec.T);
      checkPositive('M', spec.M);
      if (!(spec.A >= 0 && spec.A <= spec.M)) fail('TRANSFORM_INVALID', 'asinh A must be in [0, M]');
      const k = Math.sinh(spec.M * LN10) / spec.T;
      const den = (spec.M + spec.A) * LN10;
      return {
        spec,
        apply: (x) => (Math.asinh(x * k) + spec.A * LN10) / den,
        inverse: (y) => Math.sinh(y * den - spec.A * LN10) / k,
        displayMin: 0,
        displayMax: 1,
      };
    }
    case 'logicle': {
      const p = logicleParams(spec.T, spec.W, spec.M, spec.A);
      return { spec, apply: (x) => logicleForward(p, x), inverse: (y) => logicleInverse(p, y), displayMin: 0, displayMax: 1 };
    }
    case 'hyperlog': {
      const h = hyperlogFns(spec.T, spec.W, spec.M, spec.A);
      return { spec, apply: h.forward, inverse: h.inverse, displayMin: 0, displayMax: 1 };
    }
    case 'flowjo-biex': {
      const lut = flowjoBiexTable(spec);
      const r = spec.channelRange;
      return {
        spec,
        apply: (x) => interpolate(lut, x, false),
        inverse: (y) => interpolate(lut, y, true),
        displayMin: 0,
        displayMax: r,
      };
    }
    case 'flowjo-log': {
      checkPositive('offset', spec.offset);
      checkPositive('decades', spec.decades);
      const l0 = Math.log10(spec.offset);
      return {
        spec,
        apply: (x) => (Math.log10(Math.max(x, spec.offset)) - l0) / spec.decades,
        inverse: (y) => 10 ** (y * spec.decades + l0),
        displayMin: 0,
        displayMax: 1,
      };
    }
  }
}

export function applyColumn(t: Transform, col: Float64Array): Float64Array {
  if (t.spec.kind === 'none') return col;
  const out = new Float64Array(col.length);
  for (let i = 0; i < col.length; i++) out[i] = t.apply(col[i]);
  return out;
}

export function describeTransform(s: TransformSpec): string {
  switch (s.kind) {
    case 'none':
      return 'Raw';
    case 'linear':
      return `Linear (T=${s.T}, A=${s.A})`;
    case 'log':
      return `Log (T=${s.T}, M=${s.M})`;
    case 'asinh':
      return `Arcsinh (T=${s.T}, M=${s.M}, A=${s.A})`;
    case 'logicle':
      return `Logicle (T=${s.T}, W=${s.W}, M=${s.M}, A=${s.A})`;
    case 'hyperlog':
      return `Hyperlog (T=${s.T}, W=${s.W}, M=${s.M}, A=${s.A})`;
    case 'flowjo-biex':
      return `Biex (width=${s.width}, pos=${s.pos}, neg=${s.neg}, max=${s.max})`;
    case 'flowjo-log':
      return `FlowJo log (offset=${s.offset}, decades=${s.decades})`;
  }
}
