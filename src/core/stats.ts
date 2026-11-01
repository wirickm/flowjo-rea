// Population statistics on compensated, untransformed channel values.
// Definitions are documented in docs/compatibility-matrix.md. With a FlowJo
// channel scale, median, percentiles, robust SD and robust CV follow FlowJo
// 10's histogram conventions (src/core/flowjoStats.ts).
import { flowjoPercentile, flowjoRobustCv, flowjoRobustSd, type ChannelScale } from './flowjoStats';
import type { StatKind } from './model';

export function gather(col: Float64Array, mask: Uint8Array): Float64Array {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) out[j++] = col[i];
  return out;
}

// Linear interpolation between closest ranks (NumPy default, "type 7").
export function quantileSorted(s: Float64Array, q: number): number {
  if (s.length === 0) return NaN;
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}

export function computeStat(
  kind: StatKind,
  values: Float64Array | null,
  counts: { count: number; parent: number; grandparent: number; total: number },
  percentile = 50,
  scale?: ChannelScale,
): number {
  switch (kind) {
    case 'count':
      return counts.count;
    case 'freqParent':
      return counts.parent > 0 ? (100 * counts.count) / counts.parent : NaN;
    case 'freqGrandparent':
      return counts.grandparent > 0 ? (100 * counts.count) / counts.grandparent : NaN;
    case 'freqTotal':
      return counts.total > 0 ? (100 * counts.count) / counts.total : NaN;
  }
  if (!values || values.length === 0) return NaN;
  if (scale) {
    if (kind === 'median') return flowjoPercentile(values, scale, 50);
    if (kind === 'percentile') return flowjoPercentile(values, scale, percentile);
    if (kind === 'robustSd') return flowjoRobustSd(values, scale);
    if (kind === 'robustCv') return flowjoRobustCv(values, scale);
  }
  const n = values.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  const sd = () => {
    if (n < 2) return NaN;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (values[i] - mean) ** 2;
    return Math.sqrt(ss / (n - 1));
  };
  const sorted = () => Float64Array.from(values).sort();
  switch (kind) {
    case 'mean':
      return mean;
    case 'median':
      return quantileSorted(sorted(), 0.5);
    case 'geomean': {
      // Geometric mean of positive values only; NaN when none are positive.
      let ls = 0;
      let k = 0;
      for (let i = 0; i < n; i++) if (values[i] > 0) { ls += Math.log(values[i]); k++; }
      return k ? Math.exp(ls / k) : NaN;
    }
    case 'sd':
      return sd();
    case 'cv':
      return mean !== 0 ? (100 * sd()) / Math.abs(mean) : NaN;
    case 'robustSd': {
      // (P84.13 - P15.87) / 2: equals SD for a normal distribution.
      const s = sorted();
      return (quantileSorted(s, 0.8413) - quantileSorted(s, 0.1587)) / 2;
    }
    case 'robustCv': {
      const s = sorted();
      const med = quantileSorted(s, 0.5);
      return med !== 0 ? (100 * (quantileSorted(s, 0.8413) - quantileSorted(s, 0.1587))) / 2 / Math.abs(med) : NaN;
    }
    case 'mad': {
      const s = sorted();
      const med = quantileSorted(s, 0.5);
      const dev = Float64Array.from(s, (v) => Math.abs(v - med)).sort();
      return quantileSorted(dev, 0.5);
    }
    case 'min': {
      let m = Infinity;
      for (let i = 0; i < n; i++) m = Math.min(m, values[i]);
      return m;
    }
    case 'max': {
      let m = -Infinity;
      for (let i = 0; i < n; i++) m = Math.max(m, values[i]);
      return m;
    }
    case 'percentile':
      return quantileSorted(sorted(), percentile / 100);
  }
}

export const STAT_LABELS: Record<StatKind, string> = {
  count: 'Count',
  freqParent: 'Freq. of Parent (%)',
  freqGrandparent: 'Freq. of Grandparent (%)',
  freqTotal: 'Freq. of Total (%)',
  mean: 'Mean',
  median: 'Median',
  geomean: 'Geometric Mean',
  sd: 'SD',
  cv: 'CV (%)',
  robustSd: 'Robust SD',
  robustCv: 'Robust CV (%)',
  mad: 'MAD',
  min: 'Min',
  max: 'Max',
  percentile: 'Percentile',
};

export const STAT_NEEDS_CHANNEL = (k: StatKind) => !['count', 'freqParent', 'freqGrandparent', 'freqTotal'].includes(k);
