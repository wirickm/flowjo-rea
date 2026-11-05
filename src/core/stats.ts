// Population statistics on compensated, untransformed channel values.
// Definitions are documented in docs/compatibility-matrix.md. With a FlowJo
// channel scale, median, percentiles, robust SD and robust CV follow FlowJo
// 10's histogram conventions (src/core/flowjoStats.ts).
import { flowjoCv, flowjoGeomean, flowjoMad, flowjoMean, flowjoMode, flowjoPercentile, flowjoRobustCv, flowjoRobustSd, flowjoSd, type ChannelScale } from './flowjoStats';
import type { StatKind } from './model';

// FlowJo 10: a percentile is an integer from 0 to 100 (specs 6.7).
export function validPercentile(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 100;
}

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
  counts: { count: number; parent: number; grandparent: number; total: number; ancestor?: number },
  percentile = 50,
  scale?: ChannelScale,
  values2: Float64Array | null = null,
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
    case 'freqOf':
      return counts.ancestor !== undefined && counts.ancestor > 0 ? (100 * counts.count) / counts.ancestor : NaN;
    // FlowJo 10.6.2's engine returns NaN for Correlation (GParameter::Correlation
    // has no implementation; specs 8.1). values2 is the second parameter.
    case 'correlation':
      void values2;
      return NaN;
  }
  if (!values || values.length === 0) return NaN;
  if (scale) {
    if (kind === 'median') return flowjoPercentile(values, scale, 50);
    if (kind === 'percentile') return flowjoPercentile(values, scale, percentile);
    if (kind === 'robustSd') return flowjoRobustSd(values, scale);
    if (kind === 'robustCv') return flowjoRobustCv(values, scale);
    if (kind === 'mode') return flowjoMode(values, scale);
    if (kind === 'mean') return flowjoMean(values, scale);
    if (kind === 'sd') return flowjoSd(values, scale);
    if (kind === 'cv') return flowjoCv(values, scale);
    if (kind === 'geomean') return flowjoGeomean(values, scale);
    if (kind === 'mad') return flowjoMad(values, scale, flowjoPercentile(values, scale, 50));
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
    case 'mad':
      // FlowJo's definition (100 x 1.4826 x MAD / median), with the exact median.
      return flowjoMad(values, undefined, quantileSorted(sorted(), 0.5));
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
    case 'mode': {
      // Without a FlowJo scale: the most frequent value (lowest on ties).
      const s = sorted();
      let best = s[0], bestN = 0;
      for (let i = 0; i < s.length; ) {
        let j = i;
        while (j < s.length && s[j] === s[i]) j++;
        if (j - i > bestN) { bestN = j - i; best = s[i]; }
        i = j;
      }
      return best;
    }
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
  mad: 'Median Abs Dev (%)',
  min: 'Min',
  max: 'Max',
  percentile: 'Percentile',
  mode: 'Mode',
  correlation: 'Correlation',
  freqOf: 'Freq. of (%)',
};

export const STAT_NEEDS_CHANNEL = (k: StatKind) => !['count', 'freqParent', 'freqGrandparent', 'freqTotal', 'freqOf'].includes(k);

// FlowJo's statistic names in .wsp files (StatKey: the enum's string field,
// written as is; specs 8.1). Min and Max are this app's own (no FlowJo key).
export const FLOWJO_STAT_NAMES: Partial<Record<StatKind, string>> = {
  count: 'Count',
  freqTotal: 'fj.stat.freqoftotal',
  freqParent: 'fj.stat.freqofparent',
  freqGrandparent: 'fj.stat.freqofgrandparent',
  freqOf: 'fj.stat.freqof',
  median: 'Median',
  mean: 'Mean',
  mode: 'Mode',
  percentile: 'Percentile',
  geomean: 'Geometric Mean',
  robustCv: 'Robust CV',
  cv: 'CV',
  sd: 'SD',
  mad: 'Median Abs Dev',
  robustSd: 'Robust SD',
  correlation: 'Correlation',
};
