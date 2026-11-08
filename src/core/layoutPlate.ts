// Layout plate display of FlowJo 10.6.2 (FigPlateDisplay, FigPlateWellDisplay,
// FigPlateLegend, FigPlateAnnotation, PlateDisplayModel, PlateDisplayStatistic,
// PlateDisplaySettingsPanel; docs/validation/ui-gaps/layout.md section 7.4).
// A plate of wells laid out from the well IDs of a group's samples, each well
// showing statistics as a heat map, a split heat map or a Chernoff face.
// Rules decoded with javap and written here independently.
import type { SampleState } from './model';
import { firstKeyword, heatColor, parseSampleWell, ROW_LETTERS, WELL_ID_KEYWORDS } from './plate';

export type PlateMode = 'HEATMAP' | 'CHERNOFF_FACE';
export type DisplayTarget =
  | 'HEATMAP1' | 'HEATMAP2'
  | 'CHERNOFF_PUPIL_SIZE' | 'CHERNOFF_EYE_SPACING' | 'CHERNOFF_HEAD_SHAPE' | 'CHERNOFF_EYE_SIZE' | 'CHERNOFF_EYE_SHAPE'
  | 'CHERNOFF_EYEBROW' | 'CHERNOFF_NOSE' | 'CHERNOFF_MOUTH_SIZE' | 'CHERNOFF_MOUTH_HEIGHT' | 'CHERNOFF_MOUTH';
// PlateDisplayStatistic$DisplayTarget in enum order with its dictionary label
// (le.plate.display.comp.*) and, for faces, its FaceVector index
// (FigPlateWellDisplay.CHERNOFF_* constants).
export const TARGETS: { t: DisplayTarget; label: string; mode: PlateMode; face?: number }[] = [
  { t: 'HEATMAP1', label: 'Heatmap', mode: 'HEATMAP' },
  { t: 'HEATMAP2', label: 'Heatmap Upper Half', mode: 'HEATMAP' },
  { t: 'CHERNOFF_PUPIL_SIZE', label: 'Pupil Size', mode: 'CHERNOFF_FACE', face: 3 },
  { t: 'CHERNOFF_EYE_SPACING', label: 'Eye Spacing', mode: 'CHERNOFF_FACE', face: 7 },
  { t: 'CHERNOFF_HEAD_SHAPE', label: 'Head Shape', mode: 'CHERNOFF_FACE', face: 1 },
  { t: 'CHERNOFF_EYE_SIZE', label: 'Eye Size', mode: 'CHERNOFF_FACE', face: 8 },
  { t: 'CHERNOFF_EYE_SHAPE', label: 'Eye Shape', mode: 'CHERNOFF_FACE', face: 2 },
  { t: 'CHERNOFF_EYEBROW', label: 'Eyebrows', mode: 'CHERNOFF_FACE', face: 4 },
  { t: 'CHERNOFF_NOSE', label: 'Nose', mode: 'CHERNOFF_FACE', face: 5 },
  { t: 'CHERNOFF_MOUTH_SIZE', label: 'Mouth Size', mode: 'CHERNOFF_FACE', face: 9 },
  { t: 'CHERNOFF_MOUTH_HEIGHT', label: 'Grin', mode: 'CHERNOFF_FACE', face: 10 },
  { t: 'CHERNOFF_MOUTH', label: 'Mouth', mode: 'CHERNOFF_FACE', face: 6 },
];
export const MODE_LABELS: Record<PlateMode, string> = { HEATMAP: 'Heatmap', CHERNOFF_FACE: 'Chernoff Face' };
export const targetLabel = (t: DisplayTarget) => TARGETS.find((x) => x.t === t)!.label;
export const targetsOf = (mode: PlateMode) => TARGETS.filter((x) => x.mode === mode).map((x) => x.t);

// A plate statistic (PlateStatisticReference): a statistic node, here a
// statistics column of the workspace, with its heat-mapping range method
// (HeatmapRange AUTO or EXPECTED_RANGE) and display target.
export interface PlateStat { statId: string; target?: DisplayTarget; method?: 'AUTO' | 'EXPECTED_RANGE'; range?: { min: number; max: number } }
export interface PlateDisplayModel { groupName?: string; mode?: PlateMode; showSampleName?: boolean; stats: PlateStat[] }
export const newPlateModel = (): PlateDisplayModel => ({ stats: [] });
export const modeOf = (m: PlateDisplayModel): PlateMode => m.mode ?? 'HEATMAP'; // getDisplayMode: null means HEATMAP

// isVisible: a target counts only when it belongs to the current mode.
export const isVisible = (m: PlateDisplayModel, t: DisplayTarget | undefined) => !!t && TARGETS.find((x) => x.t === t)!.mode === modeOf(m);
// setDisplayTarget(stat, t): clears t from every statistic, then gives it to stat.
export function setTarget(m: PlateDisplayModel, statId: string, t: DisplayTarget | undefined): PlateDisplayModel {
  return { ...m, stats: m.stats.map((s) => (s.statId === statId ? { ...s, target: t } : t && s.target === t ? { ...s, target: undefined } : s)) };
}
// getUnusedDisplayTarget: a target of the mode no statistic uses (own order:
// enum order; FlowJo iterates a HashSet).
export function unusedTarget(m: PlateDisplayModel): DisplayTarget | undefined {
  const used = new Set(m.stats.map((s) => s.target));
  return targetsOf(modeOf(m)).find((t) => !used.has(t));
}
// applyStatistics (dropping statistics on the plate): new ones are added with
// an AUTO range; then for Heatmap the first dropped becomes Heatmap and the
// second Heatmap Upper Half, for Chernoff faces each takes an unused feature
// while any is left. A plate without a group takes the current group
// (FigPlateDisplay.dropNodes).
export function applyStatistics(m0: PlateDisplayModel, statIds: string[], currentGroup?: string): PlateDisplayModel {
  let m: PlateDisplayModel = { ...m0, stats: [...m0.stats], groupName: m0.groupName || currentGroup };
  for (const id of statIds) if (!m.stats.some((s) => s.statId === id)) m.stats.push({ statId: id, method: 'AUTO' });
  if (!statIds.length) return m;
  if (modeOf(m) === 'HEATMAP') {
    m = setTarget(m, statIds[0], 'HEATMAP1');
    if (statIds.length > 1) m = setTarget(m, statIds[1], 'HEATMAP2');
  } else {
    for (const id of statIds) { const t = unusedTarget(m); if (!t) break; m = setTarget(m, id, t); }
  }
  return m;
}
// Remove Unused (removeUnusedStatistics): statistics whose target is not shown in this mode.
export const removeUnused = (m: PlateDisplayModel): PlateDisplayModel => ({ ...m, stats: m.stats.filter((s) => isVisible(m, s.target)) });
export const removeStat = (m: PlateDisplayModel, statId: string): PlateDisplayModel => ({ ...m, stats: m.stats.filter((s) => s.statId !== statId) });

// Wells (PlateDisplayModel.refresh / fillSampleWellMap / estimatePlateDimensions):
// each sample of the group goes to its well ID cell; samples without a well ID
// and a second sample in a taken cell are reported; the plate is as large as
// the largest row and column used. An empty group is "No Samples".
export const NO_SAMPLES = 'No Samples';
export const NO_WELL_ID = 'Found samples with no Well ID';
export const SAME_WELL_ID = 'Multiple samples have same Well ID';
export interface WellMap { wells: Map<string, SampleState>; rows: number; cols: number; errors: string[] }
export const cellKey = (row: number, col: number) => `${row},${col}`;
export function wellMap(samples: SampleState[]): WellMap {
  const wells = new Map<string, SampleState>();
  const errors: string[] = [];
  let rows = 0, cols = 0;
  if (!samples.length) errors.push(NO_SAMPLES);
  for (const s of samples) {
    const pt = parseSampleWell(firstKeyword(s, WELL_ID_KEYWORDS)); // Sample.getWellID
    if (!pt) { if (!errors.includes(NO_WELL_ID)) errors.push(NO_WELL_ID); continue; }
    const k = cellKey(pt.row, pt.col);
    if (wells.has(k)) { if (!errors.includes(SAME_WELL_ID)) errors.push(SAME_WELL_ID); continue; }
    wells.set(k, s);
    rows = Math.max(rows, pt.row + 1);
    cols = Math.max(cols, pt.col + 1);
  }
  return { wells, rows, cols, errors };
}
// Row labels A, B, ... (getRowIndexLabel: 'A' + row); columns are numbered from 1.
export const rowLabel = (r: number) => ROW_LETTERS[r] ?? String.fromCharCode(65 + r);

// AUTO range (calculateRangeForStatistic): min and max over the wells'
// values, skipping NaN; none when no value. FlowJo starts max at
// Double.MIN_VALUE (the smallest positive double), so a plate of only
// negative values gets a maximum of that tiny positive number.
export function autoRange(values: number[]): { min: number; max: number } | null {
  let min = Number.MAX_VALUE, max = 4.9e-324;
  for (const v of values) { if (Number.isNaN(v)) continue; min = Math.min(min, v); max = Math.max(max, v); }
  return min === Number.MAX_VALUE ? null : { min, max };
}
// Range.normalize: (v - min) / width.
export const normalize = (v: number, r: { min: number; max: number }) => (v - r.min) / (r.max - r.min);
// The well colour (CalculatedTable.getHeatMapColoring of the normalised value
// on 0..1): blue at the minimum, yellow at the maximum.
export function wellColor(v: number, r: { min: number; max: number } | null | undefined): string | null {
  if (!r || !Number.isFinite(v)) return null;
  const [R, G, B] = heatColor(normalize(v, r), [0, 1]);
  return `rgb(${R},${G},${B})`;
}
// getContrastingHeatmapColor: white on a colour with blue > 128 and red < 128, else black.
export function contrastColor(rgb: string | null): string {
  const m = rgb?.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return '#000000';
  return Number(m[3]) > 128 && Number(m[1]) < 128 ? '#ffffff' : '#000000';
}
// The range a statistic is heat-mapped on: AUTO from the wells, EXPECTED_RANGE
// the statistic's own range (own rule: entered on the statistic; FlowJo names a
// range from the preferences).
export const statRange = (s: PlateStat, values: number[]) => (s.method === 'EXPECTED_RANGE' ? (s.range ?? null) : autoRange(values));

// FigPlateAnnotation.buildInfoHUD: below the plate, the group and every shown
// statistic with its target and range ("<Not Calculated>" without one); then
// the configuration errors.
export function annotationLines(m: PlateDisplayModel, statName: (id: string) => string, ranges: Record<string, { min: number; max: number } | null>, errors: string[]): string[] {
  const out = [`Sample Group: ${m.groupName || '<No Group Selected>'}`];
  for (const s of m.stats) {
    if (!isVisible(m, s.target)) continue;
    const r = ranges[s.statId];
    out.push(`Statistic: ${statName(s.statId)}`);
    out.push(`    :: displayed as ${targetLabel(s.target!)} = ${r ? `heatmap range ${fmt(r.min)} - ${fmt(r.max)}` : '<Not Calculated>'}`);
  }
  return [...out, ...errors];
}
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(6)));

// --- Chernoff faces (chernoff-faces library FacePainter, used by
// FigPlateWellDisplay.doPaint) -------------------------------------------------
// A face is drawn in a 100 x 100 design space scaled to the box; every
// feature value is 0..1 with 0.5 neutral. The box is the well grown by a
// quarter and shifted up-left: (x - w/8, y - h/8 - 3, 1.25 w, 1.25 h).
export type FaceVector = number[]; // index 1..10 as FacePainter reads them
export const neutralFace = (): FaceVector => Array.from({ length: 11 }, () => 0.5);
export interface FaceOps { oval(x: number, y: number, w: number, h: number, fill: boolean): void; line(x1: number, y1: number, x2: number, y2: number): void }
const ecc = (p: number): [number, number] => (p > 0.5 ? [Math.trunc((p - 0.5) * 20), 0] : [0, Math.trunc(Math.abs(p - 0.5) * 20)]);
export function drawFace(ops: FaceOps, p: FaceVector, wellX: number, wellY: number, wellW: number, wellH: number) {
  const X = wellX + Math.trunc(-wellW / 8), Y = wellY + Math.trunc(-wellH / 8) - 3;
  const W = Math.trunc(wellW * 1.25), H = Math.trunc(wellH * 1.25);
  const xf = W / 100, yf = H / 100;
  const sx = (v: number) => Math.trunc(v * xf), sy = (v: number) => Math.trunc(v * yf);
  // xOval(cx, cy, ry, rx); lines use the y origin for y (own fix: FacePainter
  // adds the x origin to the first point's y, which misplaces lines off the
  // diagonal of a plate).
  const oval = (cx: number, cy: number, ry: number, rx: number, fill = false) => ops.oval(sx(cx - rx) + X, sy(cy - ry) + Y, sx(rx * 2), sy(ry * 2), fill);
  const line = (x1: number, y1: number, x2: number, y2: number) => ops.line(sx(x1) + X, sy(y1) + Y, sx(x2) + X, sy(y2) + Y);
  // head (p1): eccentric oval of radius 30 at (50, 50)
  const [h0, h1] = ecc(p[1]);
  oval(50, 50, 30 + h0, 30 + h1);
  // eyes (p2 shape, p7 spacing, p8 size) at (40, 40) and (60, 40), radius 5
  const dx = Math.trunc((p[7] - 0.5) * 10), dr = Math.trunc(((p[8] - 0.5) / 2) * 10);
  const [e0, e1] = ecc(p[2]);
  oval(40 - dx, 40, 5 + dr + e0, 5 + dr + e1);
  oval(60 + dx, 40, 5 + dr + e0, 5 + dr + e1);
  // pupils (p3): radius int(max(1, 0.2 p3) * 2), which is 2 for p3 in 0..1
  const pr = Math.trunc(Math.max(1, p[3] * 0.2) * 2);
  oval(40 - dx, 40, pr, pr, true);
  oval(60 + dx, 40, pr, pr, true);
  // eyebrows (p4): slanted lines at y = 30
  const b = Math.trunc((p[4] - 0.5) * 10);
  line(35, 30 + b, 45, 30 - b);
  line(55, 30 - b, 65, 30 + b);
  // nose (p5): triangle from the apex (50, 45), width 8
  const ny = 55 + Math.trunc(((p[5] - 0.5) / 2) * 10);
  line(50, 45, 46, ny); line(46, ny, 54, ny); line(54, ny, 50, 45);
  // mouth (p6 curvature, p9 size, p10 opening): two parabolas through the corners
  const dm = (p[9] - 0.5) * 10;
  const x1 = 40 - dm, x2 = 60 + dm, ym = (p[6] - 0.5) * 10 + 65, xm = (x2 - x1) / 2 + x1;
  const lip = (y3: number) => {
    const [A, B, C] = parabola(x1, 65, x2, 65, xm, y3);
    let px = x1, py = 65;
    for (let x = x1; x <= x2; x += 1 / xf) { const y = A * x * x + B * x + C; ops.line(Math.trunc(px * xf) + X, Math.trunc(py * yf) + Y, Math.trunc(x * xf) + X, Math.trunc(y * yf) + Y); px = x; py = y; }
  };
  lip(ym);
  lip(ym + (p[10] / 2) * 10);
}
// Coefficients of y = A x^2 + B x + C through three points (FacePainter.draw_lip).
export function parabola(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): [number, number, number] {
  const d = x1 * x1 * (x2 - x3) + x1 * (x3 * x3 - x2 * x2) + x2 * x2 * x3 - x3 * x3 * x2;
  const A = (y1 * (x2 - x3) + x1 * (y3 - y2) + y2 * x3 - y3 * x2) / d;
  const B = (x1 * x1 * (y2 - y3) + y1 * (x3 * x3 - x2 * x2) + x2 * x2 * y3 - x3 * x3 * y2) / d;
  const C = (x1 * x1 * (x2 * y3 - x3 * y2) + x1 * (x3 * x3 * y2 - x2 * x2 * y3) + y1 * (x2 * x2 * x3 - x3 * x3 * x2)) / d;
  return [A, B, C];
}
// The face of a well: neutral, then each shown face statistic's normalised value.
export function faceOf(m: PlateDisplayModel, values: Record<string, number>, ranges: Record<string, { min: number; max: number } | null>): FaceVector {
  const f = neutralFace();
  for (const s of m.stats) {
    const tgt = TARGETS.find((x) => x.t === s.target);
    const v = values[s.statId], r = ranges[s.statId];
    if (!tgt?.face || !isVisible(m, s.target) || v === undefined || Number.isNaN(v) || !r) continue;
    f[tgt.face] = normalize(v, r);
  }
  return f;
}
