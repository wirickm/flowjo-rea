// FlowJo 10.6.2 kinetics (specs section 11): the time series of a statistic
// of one population, as the native engine builds it (Kinetics::MakeTimeSeries,
// GTimeSeries::Compute*, GVector::Smooth, Kinetics::ComputeThreshold), and the
// Kinetics window's timeslices and their statistics (TimesliceStatistics,
// KinToggleAutoSlice, MultiTimesliceDlog). Read with REA's Ghidra provider
// (native) and headless Ghidra / javap (Java); implemented independently.
// This module is the one owner of these rules.
import { fail } from './errors';
import { channelOf, flowjoPercentile, valueOf, type ChannelScale } from './flowjoStats';

export const KINETICS_STATS = [
  'Median', 'Mean', 'Geometric Mean', 'Percentile', '% of cells over Threshold T',
  'Median (for cells > T)', 'Mean (for cells > T)', 'Geom. mean (for cells > T)', 'Percentile (for cells > T)',
] as const;
export type KineticsStat = (typeof KINETICS_STATS)[number];
export const KINETICS_SMOOTHING = ['None', 'Gaussian', 'Moving Average'] as const;
export type KineticsSmoothing = (typeof KINETICS_SMOOTHING)[number];
export const usesThreshold = (s: KineticsStat) => KINETICS_STATS.indexOf(s) >= 4;
export const usesPercentile = (s: KineticsStat) => s === 'Percentile' || s === 'Percentile (for cells > T)';

export interface Timeslice { name: string; startTime: number; endTime: number; y: number; color: string }
// Threshold: an absolute value, or a percentile of the events of a timeslice.
export type KineticsThreshold = { kind: 'absolute'; value: number } | { kind: 'percentile'; percentile: number; timeslice: string };
export interface KineticsSettings {
  yAxis: string;
  statistic: KineticsStat;
  percentile: number;
  smoothing: KineticsSmoothing;
  threshold?: KineticsThreshold;
  timeslices: Timeslice[];
  autoSlice?: boolean;
}
// FlowJo's preference defaults: Median, percentile 90, no smoothing.
export const defaultKinetics = (yAxis: string): KineticsSettings => ({ yAxis, statistic: 'Median', percentile: 90, smoothing: 'None', timeslices: [] });

// --- binning (Kinetics::MakeTimeSeries) -------------------------------------
// R = time of the last event in file order minus the first (a last time of 0
// counts as 1). Bins of width max(1, trunc((R - 1) / 4096 + 1)), at most
// 4096; when bins x (minimum events per bin) exceeds the population count N,
// k = max(10, N div minimum) bins of width trunc(R / k + 1). Origin 0.
export function minEventsPerBin(stat: KineticsStat, p: number): number {
  const pct = Math.max(20, 500 / Math.min(p, 100 - p));
  switch (stat) {
    case 'Median': return 20;
    case 'Median (for cells > T)': return 60;
    case 'Mean (for cells > T)': case 'Geom. mean (for cells > T)': return 30;
    case 'Percentile': return pct;
    case 'Percentile (for cells > T)': return 3 * pct;
    default: return 10;
  }
}
export function kineticsBins(time: Float64Array, stat: KineticsStat, p: number, N: number): { range: number; width: number; bins: number } {
  const n = time.length;
  const last = n ? time[n - 1] || 1 : 1;
  const R = n ? last - time[0] : 0;
  let width = Math.max(1, Math.trunc((R - 1) / 4096 + 1));
  let bins = Math.min(4096, Math.trunc((R + width) / width));
  const min = minEventsPerBin(stat, p);
  if (min * bins > N) {
    const k = Math.max(10, Math.trunc(N / min));
    width = Math.trunc(R / k + 1);
    bins = Math.trunc((R + width) / width);
  }
  return { range: R, width, bins: Math.max(1, bins) };
}

// --- smoothing (GVector::Smooth) --------------------------------------------
// Width 3. Moving average: weights 1. Gaussian: weight exp(+k^2 / w^2), as
// FlowJo 10.6.2 computes it (the exponent is positive, so weights grow with
// distance). Each present bin becomes the weighted mean of the present bins
// within 3 of it; missing bins stay missing.
export const KINETICS_SMOOTH_WIDTH = 3;
export function smoothSeries(v: Float64Array, missing: Uint8Array, kind: KineticsSmoothing): { values: Float64Array; missing: Uint8Array } {
  if (kind === 'None') return { values: v, missing };
  const w = KINETICS_SMOOTH_WIDTH;
  const wt = Array.from({ length: w + 1 }, (_, k) => (kind === 'Gaussian' ? Math.fround(Math.exp(Math.fround((k * k) / (w * w)))) : 1));
  const out = new Float64Array(v.length), miss = Uint8Array.from(missing);
  for (let i = 0; i < v.length; i++) {
    if (missing[i]) continue;
    let s = 0, ws = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(v.length - 1, i + w); j++) {
      if (missing[j]) continue;
      s += wt[Math.abs(i - j)] * v[j];
      ws += wt[Math.abs(i - j)];
    }
    if (ws === 0) miss[i] = 1;
    else out[i] = s / ws;
  }
  return { values: out, missing: miss };
}

// --- the series (GTimeSeries::ComputeAverage / LogAverage / Percentile / Fraction)
export interface KineticsSeries { values: Float64Array; missing: Uint8Array; range: number; width: number }
export interface SeriesOptions { stat: KineticsStat; percentile: number; smoothing: KineticsSmoothing; threshold: number; scale: ChannelScale }
// time, y: scale values of every event in file order; mask: the population.
// Non-threshold statistics use T = 0, so events below 0 are left out (as in
// FlowJo). Values are printed by the engine with %6.5f, so they are rounded
// to 5 decimals; missing bins are 0.
export function kineticsSeries(time: Float64Array, y: Float64Array, mask: Uint8Array, o: SeriesOptions): KineticsSeries {
  let N = 0;
  for (let i = 0; i < mask.length; i++) N += mask[i];
  const { range, width, bins } = kineticsBins(time, o.stat, o.percentile, N);
  const T = usesThreshold(o.stat) ? o.threshold : 0;
  const v = new Float64Array(bins), missing = new Uint8Array(bins).fill(1);
  const binOf = (t: number) => Math.min(bins - 1, Math.max(0, Math.trunc(t / width)));
  const kind = o.stat.startsWith('Median') ? 'pct' : o.stat.startsWith('Percentile') ? 'pct' : o.stat.startsWith('Mean') ? 'mean' : o.stat.startsWith('Geom') ? 'geo' : 'frac';
  if (kind === 'mean' || kind === 'geo' || kind === 'frac') {
    const sum = new Float64Array(bins), cnt = new Float64Array(bins), all = new Float64Array(bins);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const b = binOf(time[i]);
      all[b]++;
      if (!(y[i] >= T)) continue;
      cnt[b]++;
      sum[b] = Math.fround(sum[b] + (kind === 'geo' ? channelOf(o.scale, y[i]) : y[i]));
    }
    for (let b = 0; b < bins; b++) {
      if (kind === 'frac') { if (all[b] > 0) { v[b] = (100 * cnt[b]) / all[b]; missing[b] = 0; } continue; }
      if (cnt[b] === 0) continue;
      const mc = sum[b] / cnt[b];
      v[b] = kind === 'geo' ? valueOf(o.scale, o.scale.kind === 'logicle' ? Math.floor(mc) : mc) : Math.fround(mc);
      missing[b] = 0;
    }
  } else {
    // Streamed in file order: an event in a later bin closes the held events
    // (itself included) into the bin just before its own; the file's last
    // event is always processed.
    const p = o.stat.startsWith('Median') ? 50 : o.percentile;
    let cur = 0, held: number[] = [];
    const close = (b: number) => {
      if (b >= 0 && b < bins && held.length) { v[b] = flowjoPercentile(Float64Array.from(held), o.scale, p); missing[b] = 0; }
      held = [];
    };
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] && i !== mask.length - 1) continue;
      if (y[i] >= T) held.push(y[i]);
      const b = Math.trunc(time[i] / width);
      if (b > cur) { close(b - 1); cur = b; }
    }
    close(cur);
  }
  const sm = smoothSeries(v, missing, o.smoothing);
  const values = sm.values.map((x, b) => (sm.missing[b] ? 0 : Number(x.toFixed(5))));
  return { values, missing: sm.missing, range, width };
}

// Threshold from a percentile (Kinetics::ComputeThreshold, type 1): the
// timeslice's start and end, truncated, are used as an event-index range
// (as FlowJo 10.6.2 does); 100 or more gives the maximum, 0 or less the
// minimum, else the 4096-channel percentile of the population there.
export function percentileThreshold(y: Float64Array, mask: Uint8Array, pct: number, start: number, end: number, scale: ChannelScale): number {
  const v: number[] = [];
  for (let i = Math.max(0, Math.trunc(start)); i <= Math.min(y.length - 1, Math.trunc(end)); i++) if (mask[i]) v.push(y[i]);
  if (!v.length) return NaN;
  if (pct >= 100) return Math.max(...v);
  if (pct <= 0) return Math.min(...v);
  return flowjoPercentile(Float64Array.from(v), scale, pct);
}

// --- timeslices (Java: KineticsController, TimesliceStatistics) --------------
// The time axis: total = $ETIM - $BTIM in seconds when at least 1, else the
// engine range truncated; n points, scale = total / n.
export function kineticsTimeAxis(n: number, range: number, durationSeconds: number | undefined): { total: number; scale: number } {
  const total = durationSeconds !== undefined && durationSeconds >= 1 ? durationSeconds : Math.trunc(range);
  return { total, scale: n ? total / n : 0 };
}
export const ALL_EVENTS = 'All Events';
export const allEventsSlice = (n: number, scale: number): Timeslice => ({ name: ALL_EVENTS, startTime: 0, endTime: n * scale, y: 0, color: '#000000' });
// java.awt.Color red, blue, cyan, green, magenta, orange, pink, yellow.
export const SLICE_COLORS = ['#ff0000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ffc800', '#ffafaf', '#ffff00'];
// Timeslices in FlowJo's order: start ascending, a longer one first on ties.
export const sortSlices = (s: Timeslice[]) => [...s].sort((a, b) => a.startTime - b.startTime || (b.endTime - b.startTime) - (a.endTime - a.startTime));
// Default name of a dragged slice: "Range #k", k = slice count (All Events
// included) raised until unused.
export function rangeName(names: string[]): string {
  let k = names.length + 1;
  while (names.includes(`Range #${k}`)) k++;
  return `Range #${k}`;
}
export function uniqueSliceName(name: string, names: string[]): string {
  if (!names.includes(name)) return name;
  let k = 1;
  while (names.includes(`${name}-${k}`)) k++;
  return `${name}-${k}`;
}
// Multiple ranges (MultiTimesliceDlog): back-to-back slices of total / number
// from the All Events start while they end within it, named prefix1, ...;
// y 50, then +25 after odd and -20 after even slices.
export function multiSlices(prefix: string, number: number, all: Timeslice, names: string[], colorStart = 0): Timeslice[] {
  const d = (all.endTime - all.startTime) / number;
  const out: Timeslice[] = [];
  let y = 50;
  for (let k = 1, s = all.startTime; d > 0 && s + d <= all.endTime + 1e-9; k++, s += d) {
    const taken = [...names, ...out.map((x) => x.name)];
    const nm = taken.includes(`${prefix}${k}`) ? `${prefix}${k}-1` : `${prefix}${k}`;
    out.push({ name: nm, startTime: s, endTime: s + d, y, color: SLICE_COLORS[(colorStart + k - 1) % SLICE_COLORS.length] });
    y += k % 2 === 1 ? 25 : -20;
  }
  return out;
}
// Auto slicing (KinToggleAutoSlice): around the longest run of zero values
// (none: [n/3, n]) and the first maximum: "Auto #c", "Auto #c+1", ...
export function autoSlices(series: Float64Array, count: number, scale: number): Timeslice[] {
  const n = series.length;
  let g0 = -1, g1 = -1, bestLen = 0;
  for (let i = 0; i < n; ) {
    if (series[i] !== 0) { i++; continue; }
    let j = i;
    while (j < n && series[j] === 0) j++;
    if (j - i > bestLen) { bestLen = j - i; g0 = i; g1 = j; }
    i = j;
  }
  if (bestLen === 0) { g0 = Math.trunc(n / 3); g1 = n; }
  let p = 0;
  for (let i = 1; i < n; i++) if (series[i] > series[p]) p = i;
  const T = n * scale;
  const nm = (k: number) => `Auto #${count + k}`;
  const out: Timeslice[] = [{ name: nm(0), startTime: 0, endTime: g0 * scale, y: 50, color: SLICE_COLORS[0] }];
  // FlowJo compares the peak index with a time here.
  if (p < T - 1 && g1 <= p) {
    out.push({ name: nm(1), startTime: g1 * scale, endTime: (p + 1) * scale, y: 30, color: SLICE_COLORS[1] });
    out.push({ name: nm(2), startTime: (p + 1) * scale, endTime: T, y: 50, color: SLICE_COLORS[2] });
  } else out.push({ name: nm(1), startTime: g1 * scale, endTime: T, y: 30, color: SLICE_COLORS[1] });
  return out;
}
// TimeSeries.filter: a zero between two non-zero neighbours becomes their
// average (once, left to right).
export function fillGaps(v: Float64Array): Float64Array {
  const out = Float64Array.from(v);
  for (let i = 1; i < out.length - 1; i++) if (out[i] === 0 && out[i - 1] !== 0 && out[i + 1] !== 0) out[i] = (out[i - 1] + out[i + 1]) / 2;
  return out;
}
export interface SliceStats { startT: number; endT: number; peakT: number; peak: number; meanY: number; slope: number; auc: number; dt: number }
// TimesliceStatistics over the gap-filled series. Channels come from the
// kinetics X parameter (Time, or the event number): channel = round(t x tmax
// / W) with tmax = its scale maximum truncated and W its scale width, so for
// a Time scale starting at 0 each series point is taken as one time unit
// (FlowJo's rule, whatever the engine's bin width).
export function timesliceStats(series: Float64Array, s: Timeslice, timeMax: number, timeWidth: number): SliceStats {
  const v = fillGaps(series);
  const n = v.length;
  const tmax = Math.trunc(timeMax);
  const ch = (t: number) => Math.round((t * tmax) / timeWidth);
  const dt = (s.endTime - s.startTime) / (ch(s.endTime) - ch(s.startTime));
  const i0 = Math.trunc(s.startTime / dt);
  const i1 = Math.max(i0, Math.trunc(s.endTime / dt));
  let m = 0, S = 0, peak = Number.MIN_VALUE, pi = -1, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = i0; i < i1 && i < n; i++) {
    const gap = v[i] === 0 && ((i - 1 > 0 && v[i - 1] === 0) || (i + 1 < n && v[i + 1] === 0));
    if (gap) continue;
    m++; S += v[i];
    if (v[i] > peak) { peak = v[i]; pi = i; }
    sx += i; sy += v[i]; sxx += i * i; sxy += i * v[i];
  }
  const base = { startT: s.startTime, endT: s.endTime, dt: s.endTime - s.startTime };
  if (m === 0) return { ...base, peakT: NaN, peak: NaN, meanY: NaN, slope: NaN, auc: 0 };
  const meanY = S / (m * dt);
  const slope = m > 1 ? (m * sxy - sx * sy) / (m * sxx - sx * sx) / dt : 0;
  return { ...base, peakT: pi >= 0 ? (pi + 1) * dt : NaN, peak, meanY, slope, auc: meanY * (i1 - i0) };
}
// Copy Time Series: "round(i x scale)<tab>value" per point.
export const copyTimeSeries = (series: Float64Array, scale: number) => Array.from(series, (v, i) => `${Math.round(i * scale)}\t${v}\n`).join('');

export function checkKinetics(s: KineticsSettings): void {
  if (!KINETICS_STATS.includes(s.statistic)) fail('GATE_INVALID', `Kinetics: unknown statistic ${s.statistic}`);
  if (usesPercentile(s.statistic) && !(s.percentile > 0 && s.percentile < 100)) fail('GATE_INVALID', 'Kinetics: percentile must be between 0 and 100');
}

// Timeslice statistics in the statistics table (StatKey kin*, written as
// <Statistic name="plat.kin.*" id="<timeslice>">); every key but RANGE gets a
// column per slice.
export type KinKey = 'startT' | 'endT' | 'peakT' | 'peak' | 'meanY' | 'slope' | 'auc' | 'dt';
export const KIN_KEYS: KinKey[] = ['startT', 'endT', 'peakT', 'peak', 'meanY', 'slope', 'auc', 'dt'];
export const KIN_NAMES: Record<KinKey, string> = { startT: 'plat.kin.startt', endT: 'plat.kin.endt', peakT: 'plat.kin.peakt', peak: 'plat.kin.peak', meanY: 'plat.kin.meany', slope: 'plat.kin.slope', auc: 'plat.kin.auc', dt: 'plat.kin.dt' };
export const KIN_LABELS: Record<KinKey, string> = { startT: 'Start t', endT: 'End t', peakT: 'Peak t', peak: 'Peak', meanY: 'Mean Y', slope: 'Slope', auc: 'AUC', dt: 'dt' };

// .wsp KineticsNode (child of the population's Subpopulations): settings as
// attributes, Timeslice children (All Events is not saved), kin statistics in
// its own Subpopulations. Numbers use "#.##########"; unset thresholds are
// -999999; booleans "1" / "0".
const UNSET = -999999;
const num10 = (v: number) => String(Number(v.toFixed(10)));
const xesc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function kineticsNodeXml(s: KineticsSettings, stats: { key: KinKey; timeslice: string }[]): string {
  const th = s.threshold;
  const a = [
    `name="Kinetics"`, `yAxis="${xesc(s.yAxis)}"`, `statistic="${xesc(s.statistic)}"`, `percentile="${num10(s.percentile)}"`, `smoothing="${s.smoothing}"`,
    `absoluteThreshold="${th?.kind === 'percentile' ? 0 : 1}"`, `threshold="${num10(th?.kind === 'absolute' ? th.value : UNSET)}"`,
    `thresholdPercentile="${num10(th?.kind === 'percentile' ? th.percentile : UNSET)}"`, `thresholdTimesliceName="${xesc(th?.kind === 'percentile' ? th.timeslice : '')}"`,
    `yAuto="1"`, `yMin="0"`, `yMax="10"`, `colorIndex="${s.timeslices.length % SLICE_COLORS.length}"`,
  ].join(' ');
  const ts = s.timeslices.map((t) => `<Timeslice name="${xesc(t.name)}" startTime="${num10(t.startTime)}" endTime="${num10(t.endTime)}" y="${Math.round(t.y)}" color="${t.color}" />`).join('');
  const st = stats.length ? `<Subpopulations>${stats.map((x) => `<Statistic name="${KIN_NAMES[x.key]}" id="${xesc(x.timeslice)}" />`).join('')}</Subpopulations>` : '';
  return `<KineticsNode ${a}>${ts}${st}</KineticsNode>`;
}
export function kineticsFromAttrs(get: (name: string) => string | undefined, slices: Timeslice[]): KineticsSettings {
  const stat = (KINETICS_STATS as readonly string[]).includes(get('statistic') ?? '') ? (get('statistic') as KineticsStat) : 'Median';
  const sm = (KINETICS_SMOOTHING as readonly string[]).includes(get('smoothing') ?? '') ? (get('smoothing') as KineticsSmoothing) : 'None';
  const n = (k: string) => Number(get(k) ?? UNSET);
  const abs = (get('absoluteThreshold') ?? '1') !== '0';
  let threshold: KineticsThreshold | undefined;
  if (abs && n('threshold') !== UNSET) threshold = { kind: 'absolute', value: n('threshold') };
  if (!abs && n('thresholdPercentile') !== UNSET && get('thresholdTimesliceName')) threshold = { kind: 'percentile', percentile: n('thresholdPercentile'), timeslice: get('thresholdTimesliceName')! };
  return { yAxis: get('yAxis') ?? '', statistic: stat, percentile: Number(get('percentile') ?? 90), smoothing: sm, ...(threshold ? { threshold } : {}), timeslices: slices };
}
export const KIN_BY_NAME: Record<string, KinKey> = Object.fromEntries(Object.entries(KIN_NAMES).map(([k, v]) => [v, k as KinKey]));
