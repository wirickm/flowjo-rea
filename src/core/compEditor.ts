// FlowJo 10.6.2 compensation Matrix Editor (docs/validation/ui-gaps/
// compensation.md): matrix management (MatrixController.createIdentityMatrix,
// duplicate; NameUtil.uniqueName / getCopyName), matrix comparison
// (ComparisonMatrix), the plot grid layouts (MatrixNxNPanel.layoutNxN /
// layoutRow), zoom steps (EditorZoom), the animation scales
// (CompAnimationBatch), spectral detector weights (SpectralWeightsDialog) and
// the Matrix Editor preferences (PrefsCompensation). Read with javap;
// implemented independently. This module is the one owner of these rules.
import { invert, isSpectral, unmixingOperator, type SpilloverMatrix } from './compensation';
import { fail } from './errors';

// --- names ------------------------------------------------------------------
// NameUtil.uniqueName: a taken name loses a trailing "-<1 or 2 digits>"
// (hyphen after position 2), then "-1", "-2", ... is appended until unique.
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  let base = name;
  const h = base.lastIndexOf('-');
  if (h > 2 && h > base.length - 4 && h + 1 < base.length && /^\d+$/.test(base.slice(h + 1))) base = base.slice(0, h);
  for (let i = 1; i < 1000; i++) {
    const n = `${base}-${i}`;
    if (!used.has(n)) return n;
  }
  return `${name}${Date.now()}`;
}
// NameUtil.getCopyName: "-copy" appended unless already there, then unique.
export const COPY_SUFFIX = '-copy';
export const copyName = (name: string, taken: Iterable<string>) => uniqueName(name.endsWith(COPY_SUFFIX) ? name : name + COPY_SUFFIX, taken);

const newId = () => `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// New Identity Matrix (plat.matrix.new = "New Matrix"): 1 on the diagonal.
export function identityMatrix(channels: string[], taken: string[]): SpilloverMatrix {
  if (!channels.length) fail('COMP_INVALID', 'Choose at least one parameter for the identity matrix');
  return { id: newId(), name: uniqueName('New Matrix', taken), channels: [...channels], values: channels.map((_, i) => channels.map((__, j) => (i === j ? 1 : 0))), source: 'identity', kind: 'spillover' };
}

// Duplicate Matrix: an editable copy with the copy name (the SSM goes along).
export function duplicateMatrix(m: SpilloverMatrix, taken: string[]): SpilloverMatrix {
  return { ...structuredClone(m), id: newId(), name: copyName(m.name, taken) };
}

// --- comparison (ComparisonMatrix) -----------------------------------------
// 2 selected matrices: Difference = second - first; 3 or more: population
// standard deviation; each value rounded to 8 decimals. Channels come from the
// first matrix; every other matrix must have them all.
export type CompareMethod = 'Difference' | 'Standard Deviation';
export function compareMatrices(ms: SpilloverMatrix[]): { method: CompareMethod; matrix: SpilloverMatrix | null; error: string | null } {
  const method: CompareMethod = ms.length === 2 ? 'Difference' : 'Standard Deviation';
  if (ms.length < 2) return { method, matrix: null, error: 'This comparison requires at least 2 matrices' };
  const chans = ms[0].channels;
  const missing = new Set<string>();
  for (const m of ms.slice(1)) for (const c of chans) if (!m.channels.includes(c)) missing.add(c);
  if (missing.size) return { method, matrix: null, error: `${missing.size} channels from the first matrix are not present in the others` };
  const sp = (m: SpilloverMatrix, a: string, b: string) => {
    const i = m.channels.indexOf(a), j = m.channels.indexOf(b);
    return m.values[i]?.[j] ?? 0;
  };
  const round8 = (v: number) => Math.round(v * 1e8) / 1e8;
  const values = chans.map((a) => chans.map((b) => {
    const xs = ms.map((m) => sp(m, a, b));
    if (ms.length === 2) return round8(xs[1] - xs[0]);
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    return round8(Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length));
  }));
  return { method, matrix: { id: 'compare', name: `${method} of ${ms.length} matrices`, channels: [...chans], values, source: 'comparison', kind: 'spillover' }, error: null };
}

// --- plot grid (MatrixNxNPanel) --------------------------------------------
export type CompView = { kind: 'nxn' } | { kind: 'allby'; channel: string } | { kind: 'histos' };
export interface GridCell { row: number; col: number; x: string; y: string | null }
// N x N: the upper triangle; row i (0..n-2) holds x = channel j, y = channel i
// for every j > i, placed in column j. All By: one row, x = every other
// channel, y = the chosen channel. Histograms: one row, one per channel.
export function gridCells(view: CompView, channels: string[]): GridCell[] {
  if (view.kind === 'nxn') {
    const out: GridCell[] = [];
    for (let i = 0; i < channels.length - 1; i++) for (let j = i + 1; j < channels.length; j++) out.push({ row: i, col: j, x: channels[j], y: channels[i] });
    return out;
  }
  if (view.kind === 'allby') return channels.filter((c) => c !== view.channel).map((x, k) => ({ row: 0, col: k, x, y: view.channel }));
  return channels.map((x, k) => ({ row: 0, col: k, x, y: null }));
}

// --- zoom (EditorZoom, MatrixNxNPanel) ------------------------------------
export const ZOOM_STEPS = [12, 25, 33, 50, 66, 75, 100, 150, 200, 400];
export const DEFAULT_ZOOM = 50; // CELayout.setScale(0.5)
export const COL_WIDTH = 260; // points per plot column (256 plot + margin)
export const PLOT_SIZE = 256;
const closest = (pct: number) => ZOOM_STEPS.reduce((b, s, i) => (Math.abs(s - pct) < Math.abs(ZOOM_STEPS[b] - pct) ? i : b), 0);
export const zoomIn = (pct: number) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, closest(pct) + 1)];
export const zoomOut = (pct: number) => ZOOM_STEPS[Math.max(0, closest(pct) - 1)];
// Scale To Fit: the editor width over (column width x visible channels).
export const fitZoom = (widthPx: number, visible: number) => (visible > 0 && widthPx > 0 ? (100 * widthPx) / (COL_WIDTH * visible) : DEFAULT_ZOOM);

// --- compensation of preview events ----------------------------------------
// The editor compensates a subsample of the preview population with the
// matrix being edited, so cell edits show at once. Returns columns keyed by
// output name (square: the matrix channels; spectral: the fluorochromes).
export function compensateEvents(raw: Record<string, Float32Array>, m: SpilloverMatrix): Record<string, Float32Array> {
  const missing = m.channels.filter((c) => !raw[c]);
  if (missing.length) fail('COMP_CHANNEL_MISMATCH', `Preview sample lacks: ${missing.join(', ')}`);
  const spectral = isSpectral(m);
  const op = spectral ? unmixingOperator(m) : invert(m.values);
  const outs = spectral ? m.outputNames ?? m.values.map((_, k) => `Fluor ${k + 1}`) : m.channels;
  const n = raw[m.channels[0]]?.length ?? 0;
  const cols = outs.map(() => new Float32Array(n));
  const src = m.channels.map((c) => raw[c]);
  const d = src.length;
  for (let e = 0; e < n; e++) {
    for (let k = 0; k < outs.length; k++) {
      let s = 0;
      for (let i = 0; i < d; i++) s += src[i][e] * op[i][k];
      cols[k][e] = s;
    }
  }
  return Object.fromEntries(outs.map((o, k) => [o, cols[k]]));
}

// Animation (CompAnimationBatch with 15 tiles from 0.1% to 400%): scales grow
// by log10((1 / start) / tiles) per tile while below 1, then 1, 2, 4.
export function animationScales(start = 0.001, tiles = 15, stop = 4): number[] {
  const f = Math.log10(1 / start / tiles);
  const out: number[] = [];
  let s = start;
  for (let i = 0; i < tiles && s < 1; i++, s *= f) out.push(s);
  for (let t = 1; t <= stop; t *= 2) out.push(t);
  return out;
}
// The spillover a frame shows: off-diagonal values times the scale (own rule;
// FlowJo multiplies every coefficient sent to its engine, see the spec).
export function scaleSpillover(m: SpilloverMatrix, s: number): SpilloverMatrix {
  if (s === 1) return m;
  return { ...m, values: m.values.map((r, i) => r.map((v, j) => (isSpectral(m) || i !== j ? v * s : v))) };
}
export const scaleLabel = (s: number) => `Scale: ${+(s * 100).toPrecision(3)}%`;

// --- spectral detector weights (SpectralWeightsDialog) ---------------------
// Export: "Detector Name,Weights" then one "name,weight" line per detector,
// CRLF line ends, default file detectorweights.csv.
export const WEIGHTS_FILE = 'detectorweights.csv';
export function weightsCsv(detectors: string[], weights: number[]): string {
  return ['Detector Name,Weights', ...detectors.map((d, i) => `${d},${weights[i] ?? 1}`)].join('\r\n') + '\r\n';
}
// Import: row based (name,weight per line, optional header) or column based
// (a line of detector names, then a line of weights). Every detector of the
// matrix must be named.
export function parseWeightsCsv(text: string, detectors: string[]): number[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (!lines.length) fail('COMP_INVALID', 'Data Format is not Valid');
  const cells = lines.map((l) => l.split(',').map((s) => s.trim().replace(/^"|"$/g, '')));
  const isNum = (s: string) => s !== '' && Number.isFinite(Number(s));
  const map = new Map<string, number>();
  const columnBased = cells.length >= 2 && cells[0].length > 2 && cells[1].length === cells[0].length && cells[1].every(isNum) && !cells[0].every(isNum);
  if (columnBased) cells[0].forEach((name, i) => map.set(name, Number(cells[1][i])));
  else {
    for (const r of cells) {
      if (r.length < 2) fail('COMP_INVALID', 'Data Format is not Valid');
      if (!isNum(r[1])) continue; // header line
      map.set(r[0], Number(r[1]));
    }
  }
  if (!map.size) fail('COMP_INVALID', 'Data Format is not Valid');
  if (detectors.some((d) => !map.has(d))) fail('COMP_INVALID', "Detector Names Don't match the detector names of the sample(s) in the Workspace...");
  const w = detectors.map((d) => map.get(d)!);
  if (w.some((v) => !(v > 0))) fail('COMP_INVALID', 'Weights must be positive numbers');
  return w;
}

// --- wizard parameter set (AssignmentRow sample menu) -----------------------
// Remove Unused Parameters: keep only the parameters some control is
// assigned to.
export const removeUnusedParameters = (params: string[], assigned: string[]) => params.filter((p) => assigned.includes(p));

// --- SSM display (MatrixEntryPanel) ----------------------------------------
// The SSM table carries a Sum row (column sums) and a Sum column (row sums).
export function ssmWithSums(values: number[][]): { rows: number[][]; colSums: number[]; total: number } {
  const rows = values.map((r) => [...r, r.reduce((s, v) => s + v, 0)]);
  const colSums = values[0]?.map((_, j) => values.reduce((s, r) => s + r[j], 0)) ?? [];
  return { rows, colSums, total: colSums.reduce((s, v) => s + v, 0) };
}

// --- Matrix Editor preferences (FJPrefsFJML$Compensation; all default on) ---
// ceOverlay, ceShowStatus and usePercent. meConfirmEdits guards editing an
// uneditable (acquisition) matrix, which this app never edits in place.
export interface CompPrefs { overlay: boolean; showStatus: boolean; usePercent: boolean }
export const DEFAULT_COMP_PREFS: CompPrefs = { overlay: true, showStatus: true, usePercent: true };
const KEY = 'flowjo-rea.compPrefs';
export function loadCompPrefs(): CompPrefs {
  try { return { ...DEFAULT_COMP_PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULT_COMP_PREFS }; }
}
export function saveCompPrefs(p: CompPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
// Matrix cells shown as percent when "Use Percent for spillover" is on.
export const toDisplay = (v: number, pct: boolean) => (pct ? +(v * 100).toPrecision(12) : v);
export const fromDisplay = (v: number, pct: boolean) => (pct ? v / 100 : v);
