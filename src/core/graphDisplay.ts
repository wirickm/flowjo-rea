// FlowJo 10.6.2 graph window display and transform-menu rules (spec:
// docs/validation/ui-gaps/graph.md). Read with javap (GraphSpecOptionPanel,
// GraphSpec, GraphSettings, DisplayType, SmoothAction, AdjustSmoothingAction,
// GateWinController, FlowCAPUtil, PeakFinder, TransformChangeAction,
// ParameterController, ParameterTransformController) and llvm-objdump on the
// native engine (GraphRequest::FromXML, Smoothing, TransformedParameter::
// DetermineTransformationAutoWidth). Implemented independently. This module is
// the one owner of these rules.
import { findPeaks, smoothHistogram, smoothHistogram1D } from './gateTools';
import type { PlotSettings } from './model';
import { makeTransform, type TransformSpec } from './transforms';

export type PlotKind = PlotSettings['kind'];

// --- Smoothing ---------------------------------------------------------------
// Graph@smoothing is an int: 0 = off, the Smooth toggle stores 13, the amount
// list offers None, 6, 13, 26, 52, 104, 208. The engine reads it as a boolean
// (GraphRequest::FromXML) and always smooths with its fixed kernel, so every
// amount above 0 draws the same picture.
export const SMOOTHING_AMOUNTS = [6, 13, 26, 52, 104, 208];
export const SMOOTH_ON = 13;
// DisplayType.isSmoothedByDefault: contour, zebra, density and histograms.
export const smoothedByDefault = (k: PlotKind) => k === 'contour' || k === 'zebra' || k === 'density' || k === 'histogram';
// DisplayType.canSmooth: not dot plots and not contours (contours are always smoothed).
export const canSmooth = (k: PlotKind) => k !== 'dot' && k !== 'contour';
// The smoothing amount in effect (0 = off).
// smooth1D: the preference "smoothing1D" (default on) for histograms.
export function smoothingOf(k: PlotKind, s: { smoothing?: number }, smooth1D = true): number {
  if (k === 'dot') return 0;
  if (k === 'contour') return SMOOTH_ON;
  if (s.smoothing !== undefined) return s.smoothing;
  if (k === 'histogram') return smooth1D ? SMOOTH_ON : 0;
  return smoothedByDefault(k) ? SMOOTH_ON : 0;
}
// DisplayType.canShowOutliers(smoothed): contours always; zebra, density and
// pseudocolor only while smoothed.
export const canShowOutliers = (k: PlotKind, smoothed: boolean) => k === 'contour' || (smoothed && (k === 'zebra' || k === 'density' || k === 'pseudocolor'));
// GraphSpec.canSetForegroundColor: histograms, plots that can show outliers, dot plots.
export const canSetForeground = (k: PlotKind, smoothed: boolean) => k === 'histogram' || k === 'dot' || canShowOutliers(k, smoothed);

// 2-D: the engine's adaptive kernel (Smoothing::SmoothHistogram, specs 10.5).
// The kernel is symmetric in x and y with the same edge mirroring, so the
// grid can stay in the plot's row = y layout.
// Results are cached per input array (plots redraw on every mouse move).
const cache = new WeakMap<object, Float64Array>();
const cached = (a: ArrayLike<number>, f: () => Float64Array) => {
  if (typeof a !== 'object') return f();
  const hit = cache.get(a as object);
  if (hit) return hit;
  const v = f();
  cache.set(a as object, v);
  return v;
};
export function smoothGrid(density: ArrayLike<number>, B: number): Float64Array {
  return cached(density, () => smoothHistogram(Float64Array.from(density), B));
}
// 1-D: BasicHistogram::Smooth (specs 10.8), whole counts.
export const smoothCurve = (counts: ArrayLike<number>) => cached(counts, () => smoothHistogram1D(Float64Array.from(counts)));

// --- Resolution, dots, Y range --------------------------------------------------
// GraphSpecOptionPanel: Resolution 256, 512, 1024, 2048, 4096 (default 256;
// shown only with the "support high resolution" preference). This app keeps
// the histogram grid in memory, so 2048 and 4096 draw at 1024 (own rule).
export const GRAPH_RESOLUTIONS = [256, 512, 1024, 2048, 4096];
export const MAX_DRAWN_RESOLUTION = 1024;
export const resolutionOf = (s: { resolution?: number }) => Math.min(MAX_DRAWN_RESOLUTION, s.resolution && GRAPH_RESOLUTIONS.includes(s.resolution) ? s.resolution : 256);
// "# Dots": 0 to 100000, default the preference dotsToDraw = 8000; an entry of
// 0 becomes 100 (GateWinController N_DOTS).
export const DEFAULT_DOTS = 8000;
export function dotsFromInput(v: number): number {
  const n = Math.trunc(Number.isFinite(v) ? v : 0);
  if (n === 0) return 100;
  return Math.max(0, Math.min(100000, n));
}
// Y Axis (YAxisPanel): Auto, or Manual with an integer top (0 to 2^31 - 1,
// field default 1000).
export const Y_MAX_DEFAULT = 1000;
export const yMaxFromInput = (v: number) => Math.max(0, Math.min(2147483647, Math.trunc(Number.isFinite(v) ? v : 0)));

// --- Outliers ----------------------------------------------------------------------
// Events in cells whose smoothed density is below the outermost level are
// drawn as dots (own rule for the threshold: the outermost probability level).
export function isOutlierCell(smoothed: ArrayLike<number>, B: number, bx: number, by: number, threshold: number): boolean {
  return smoothed[Math.min(B - 1, Math.max(0, by)) * B + Math.min(B - 1, Math.max(0, bx))] < threshold;
}

// --- Gates on peaks, cluster gates -------------------------------------------------
// FlowCAPUtil.gateOnPeaks: the parent's unsmoothed 256-bucket histogram of the
// X parameter, PeakFinder.findPeaks(32) (every peak kept), one range per peak
// from its left to its right edge (rounded buckets). Names: the parameter, or
// "<parameter>.Pop<k>" (k from 0) when there is more than one peak. A child with
// the same name and range is replaced.
export interface RangeSpec { name: string; min: number; max: number }
export function peakRanges(counts: Float64Array, param: string): { name: string; lo: number; hi: number }[] {
  const peaks = findPeaks(counts.map(Math.trunc), 100, true);
  return peaks.map((p, k) => ({ name: peaks.length > 1 ? `${param}.Pop${k}` : param, lo: Math.round(p.min), hi: Math.round(p.max) }));
}
// FlowCAPUtil.createClusterRangeGates: offered when an axis parameter is named
// "cluster"; the top is ceil(scale max), replaced by the $PnR keyword when it is
// an integer; ranges "Pop<i>" = [i, i + 1) for i = 1 .. top - 1.
export function clusterRanges(scaleMax: number, pnr: string | undefined): RangeSpec[] {
  let top = Math.ceil(scaleMax);
  if (pnr !== undefined && /^\s*[+-]?\d+\s*$/.test(pnr)) top = parseInt(pnr, 10);
  const out: RangeSpec[] = [];
  for (let i = 1; i < top; i++) out.push({ name: `Pop${i}`, min: i, max: i + 1 });
  return out;
}

// --- Axis labels -----------------------------------------------------------------
// Preference "Use Scientific Notation" (Graph/scientificNotation, default on):
// decade labels as 10 with a superscript exponent; off: the plain number (own
// format for the plain form: digits, a minus sign for negative decades).
export function decadeLabel(e: number, negative: boolean, scientific: boolean): string {
  if (scientific) return `${negative ? '-' : ''}10^${e}`;
  return `${negative ? '-' : ''}${(10 ** e).toFixed(0)}`;
}

// --- Transforms (graph window transform menu) -------------------------------------
// TransformChangeAction.changeDisplayLogLin: Linear Axis = a linear scale over
// the parameter's min..max; Log Axis = a log scale over min..max, with a
// minimum under 1e-4 replaced by the cytometer's log minimum (1 here).
export function linLogSpec(log: boolean, min: number, max: number): TransformSpec {
  if (log) {
    const lo = min < 1e-4 ? 1 : min;
    return { kind: 'log', T: max, M: Math.max(0.1, Math.log10(max / lo)) };
  }
  return { kind: 'linear', T: max, A: Math.max(0, Math.min(max, -min)) };
}
// ParameterTransformController.getLikeParameters: a fluorescence parameter's
// like parameters are all fluorescence parameters; a scatter parameter's all
// other non-time parameters; time's the time parameters.
export function likeParameters(names: string[], of: string, isFluor: (n: string) => boolean, isTime: (n: string) => boolean): string[] {
  if (isTime(of)) return names.filter(isTime);
  if (isFluor(of)) return names.filter(isFluor);
  return names.filter((n) => !isFluor(n) && !isTime(n));
}

// Change Displayed Parameter Range: set the top to max, then find the value of
// the scale's extra-negative parameter that puts the bottom of the axis at min
// (linear: A = -min; log: M = log10(max / min); logicle / hyperlog / arcsinh: A;
// FlowJo biex: neg). Returns null when min cannot be shown on that scale.
export function specWithRange(spec: TransformSpec, min: number, max: number): TransformSpec | null {
  if (!(max > min)) return null;
  const bottom = (s: TransformSpec) => { const t = makeTransform(s); return t.inverse(t.displayMin); };
  const solve = (lo: number, hi: number, make: (v: number) => TransformSpec): TransformSpec | null => {
    // bottom() decreases as the extra-negative parameter grows.
    try {
      if (bottom(make(lo)) < min || bottom(make(hi)) > min) return null;
      for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (bottom(make(m)) > min) lo = m; else hi = m; }
      return make((lo + hi) / 2);
    } catch { return null; }
  };
  switch (spec.kind) {
    case 'linear': return min <= 0 && -min <= max ? { kind: 'linear', T: max, A: -min } : null;
    case 'log': return min > 0 ? { kind: 'log', T: max, M: Math.log10(max / min) } : null;
    case 'logicle': return solve(-spec.W, spec.M - 2 * spec.W, (A) => ({ ...spec, T: max, A }));
    case 'hyperlog': return solve(-spec.W, spec.M - 2 * spec.W, (A) => ({ ...spec, T: max, A }));
    case 'asinh': return solve(0, spec.M, (A) => ({ ...spec, T: max, A }));
    case 'flowjo-biex': return solve(0, 10, (neg) => ({ ...spec, max, neg }));
    default: return null;
  }
}

// Calculate Width Basis (TransformedParameter::DetermineTransformationAutoWidth):
// from the compensated values of the whole sample. Events in the lowest three
// of 4096 display channels are dropped (ZeroBins 0..2); n = the events below 0.
// n >= 100: r = the 5th percentile of the negative events; 11 <= n < 100: the
// 5th most negative event; fewer: W' = 0.5. Otherwise W' = log10(-r 10^M / T)
// clamped to 0..5, and the width basis is -10^W' (logicle W = W' / 2).
export function autoWidthBasis(values: ArrayLike<number>, display: (v: number) => number, M: number, T: number): number {
  const kept: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const d = display(v);
    if (Number.isFinite(d) && d < 3 / 4096) continue;
    kept.push(v);
  }
  const neg = kept.filter((v) => v < 0).sort((a, b) => a - b);
  const n = neg.length;
  let w: number;
  if (n < 11) w = 0.5;
  else {
    const k = n >= 100 ? Math.max(0, Math.ceil(0.05 * n) - 1) : 4;
    const r = neg[k];
    w = r < 0 ? Math.log10((-r * 10 ** M) / T) : 0;
  }
  w = Math.min(5, Math.max(0, Number.isFinite(w) ? w : 0));
  return -Math.fround(10 ** w);
}

// Derive Linear / Log Parameter (own rule: the commands exist in 10.6.2 with no
// handler): a formula parameter named "<parameter>_lin" / "<parameter>_log"
// (letters, digits and underscore), the identity or LOG of the value floored at 1.
export function derivedFor(param: string, log: boolean, taken: string[]): { name: string; formula: string } {
  const base = `${param.replace(/[^A-Za-z0-9_]/g, '_')}_${log ? 'log' : 'lin'}`;
  let name = base;
  for (let k = 1; taken.includes(name); k++) name = `${base}-${k}`;
  return { name, formula: log ? `LOG(MAX(${param},1))` : param };
}

// --- Colour table (ColorTableGenerator) ---------------------------------------------
// Rows of start colour, end colour, number of entries and linear or log
// interpolation; the rows are joined into one table that replaces the
// pseudocolor ramp (preference colorTable). Stored as
// "rrggbb-rrggbb-<entries>-lin|log" rows joined by ";". The log curve is own
// (log10(1 + 9 t)).
export interface ColorRow { start: string; end: string; entries: number; log: boolean }
export const DEFAULT_COLOR_ROWS: ColorRow[] = [
  { start: '#142aa0', end: '#0096dc', entries: 20, log: false },
  { start: '#0096dc', end: '#28be5a', entries: 20, log: false },
  { start: '#28be5a', end: '#f0dc28', entries: 20, log: false },
  { start: '#f0dc28', end: '#e63c1e', entries: 20, log: false },
];
export const colorRowsToString = (rows: ColorRow[]) => rows.map((r) => `${r.start.slice(1)}-${r.end.slice(1)}-${r.entries}-${r.log ? 'log' : 'lin'}`).join(';');
export function colorRowsFromString(s: string): ColorRow[] {
  const rows = s.split(';').map((t) => /^([0-9a-f]{6})-([0-9a-f]{6})-(\d+)-(lin|log)$/i.exec(t.trim())).filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ start: `#${m[1].toLowerCase()}`, end: `#${m[2].toLowerCase()}`, entries: Math.max(1, Math.min(100, Number(m[3]))), log: m[4].toLowerCase() === 'log' }));
  return rows.length ? rows : DEFAULT_COLOR_ROWS;
}
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function colorTable(rows: ColorRow[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const r of rows) {
    const a = rgb(r.start), b = rgb(r.end);
    for (let k = 0; k < r.entries; k++) {
      const t0 = r.entries > 1 ? k / (r.entries - 1) : 0;
      const t = r.log ? Math.log10(1 + 9 * t0) : t0;
      out.push([0, 1, 2].map((c) => Math.round(a[c] + (b[c] - a[c]) * t)) as [number, number, number]);
    }
  }
  return out;
}
