// Kinetic (time-binned) statistics for one population. Bins span min..max of
// time over the masked events with equal width; the last bin includes max.
// Median uses the closest-ranks interpolation of stats.ts.
import { fail } from './errors';
import { quantileSorted } from './stats';

export interface KineticsOptions {
  bins: number;
  stat: 'count' | 'mean' | 'median' | 'pctPositive';
  threshold?: number;
  parentMask?: Uint8Array;
}

export interface KineticsResult {
  binStart: Float64Array;
  binEnd: Float64Array;
  value: Float64Array;
  n: Int32Array;
}

// value is NaN for empty bins, except stat 'count' where an empty bin is 0.
// For 'pctPositive', n is the denominator (parentMask events) per bin.
export function kinetics(time: Float64Array, values: Float64Array | null, mask: Uint8Array, opts: KineticsOptions): KineticsResult {
  const B = opts.bins;
  if (!Number.isInteger(B) || B < 1) fail('GATE_INVALID', `Kinetics: bins must be a positive integer, got ${B}`);
  if (opts.stat !== 'count' && !values) fail('GATE_INVALID', `Kinetics: stat '${opts.stat}' needs a value channel`);
  if (opts.stat === 'pctPositive' && opts.threshold === undefined) fail('GATE_INVALID', 'Kinetics: pctPositive needs a threshold');
  let t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { t0 = Math.min(t0, time[i]); t1 = Math.max(t1, time[i]); }
  const binStart = new Float64Array(B), binEnd = new Float64Array(B), value = new Float64Array(B).fill(NaN), n = new Int32Array(B);
  if (t0 > t1) {
    binStart.fill(NaN);
    binEnd.fill(NaN);
    if (opts.stat === 'count') value.fill(0);
    return { binStart, binEnd, value, n };
  }
  const w = (t1 - t0) / B;
  for (let b = 0; b < B; b++) { binStart[b] = t0 + b * w; binEnd[b] = b === B - 1 ? t1 : t0 + (b + 1) * w; }
  const binOf = (t: number) => (t < t0 || t > t1 ? -1 : w > 0 ? Math.min(B - 1, Math.floor((t - t0) / w)) : 0);

  if (opts.stat === 'pctPositive') {
    const parent = opts.parentMask ?? mask;
    const pos = new Int32Array(B);
    for (let i = 0; i < time.length; i++) {
      const b = binOf(time[i]);
      if (b < 0) continue;
      if (parent[i]) n[b]++;
      if (mask[i] && values![i] >= opts.threshold!) pos[b]++;
    }
    for (let b = 0; b < B; b++) if (n[b] > 0) value[b] = (100 * pos[b]) / n[b];
    return { binStart, binEnd, value, n };
  }

  const groups: number[][] = Array.from({ length: B }, () => []);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const b = binOf(time[i]);
    n[b]++;
    if (values) groups[b].push(values[i]);
  }
  for (let b = 0; b < B; b++) {
    if (opts.stat === 'count') value[b] = n[b];
    else if (n[b] > 0 && opts.stat === 'mean') value[b] = groups[b].reduce((s, v) => s + v, 0) / n[b];
    else if (n[b] > 0) value[b] = quantileSorted(Float64Array.from(groups[b]).sort(), 0.5);
  }
  return { binStart, binEnd, value, n };
}
