// FlowJo 10.6.2 3D Viewer rules (com.treestar.threeD; spec
// docs/validation/ui-gaps/platforms.md section 5). Read from the jar and
// implemented independently.

// ThreeDGradient: control points (location, rgba); a colour at t in [0, 1]
// mixes the nearest point at or below t with the nearest point above it
// (getColorAtLocation; before the first or after the last point the end
// colour is used).
export interface Gradient { name: string; points: { at: number; rgba: [number, number, number, number] }[] }
const solid = (name: string, rgb: number): Gradient => ({ name, points: [{ at: 0, rgba: [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255] }] });
// ThreeDDataModel.SPECTRUM.
export const SPECTRUM: Gradient = {
  name: 'Spectrum',
  points: [[0.1, 0x7f00ff], [0.25, 0x0000ff], [0.35, 0x00ffff], [0.45, 0x00ff00], [0.65, 0xffff00], [0.9, 0xff0000]].map(([at, c]) => ({ at, rgba: [(c >> 16) & 255, (c >> 8) & 255, c & 255, 255] as [number, number, number, number] })),
};
// ThreeDDataModel.DEFAULT_GRADIENTS, in order (index 0 is the default colour
// axis gradient, ThreeDSettings.makeDefaultColorAxis).
export const GRADIENTS: Gradient[] = [
  solid('Black', 0x000000), solid('Red', 0xff0000), solid('Green', 0x00ff00), solid('Blue', 0x0000ff), SPECTRUM,
  { name: 'Black -> Transparent', points: [{ at: 0, rgba: [0, 0, 0, 255] }, { at: 0.5, rgba: [0, 0, 0, 127] }, { at: 1, rgba: [0, 0, 0, 0] }] },
  { name: 'Transparent -> Black', points: [{ at: 0, rgba: [0, 0, 0, 0] }, { at: 0.5, rgba: [0, 0, 0, 127] }, { at: 1, rgba: [0, 0, 0, 255] }] },
  { name: 'Black -> White', points: [{ at: 0, rgba: [0, 0, 0, 255] }, { at: 1, rgba: [255, 255, 255, 255] }] },
  { name: 'Black -> Red', points: [{ at: 0, rgba: [0, 0, 0, 255] }, { at: 1, rgba: [255, 0, 0, 255] }] },
];
export function gradientColor(g: Gradient, t: number): [number, number, number, number] {
  if (!g.points.length) return [0, 0, 0, 255];
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  let lo: Gradient['points'][number] | null = null, hi: Gradient['points'][number] | null = null;
  for (const p of g.points) {
    if (p.at - x > 0) { if (!hi || p.at < hi.at) hi = p; }
    else if (!lo || p.at > lo.at) lo = p;
  }
  if (!lo) return hi!.rgba;
  if (!hi) return lo.rgba;
  const f = Math.fround((x - lo.at) / (hi.at - lo.at));
  return lo.rgba.map((v, k) => v * (1 - f) + hi!.rgba[k] * f) as [number, number, number, number];
}

// ThreeDController.getQuickColor: colours of added populations by index.
export const QUICK_COLORS = ['#ff0000', '#ffc800', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'];

// Population axes (ThreeDDataModel.appendAxis(GParameter, GraphNode)): the
// engine returns each event's position on the parameter's scale (0..1); the
// model then subtracts the minimum and multiplies (not divides) by the
// range max - min, so a population that does not span the whole scale is
// drawn shrunk toward the cube corner. Reproduced as decoded.
export function populationAxis(fractions: ArrayLike<number>): Float32Array {
  let min = NaN, max = NaN;
  for (let i = 0; i < fractions.length; i++) {
    const v = fractions[i];
    if (Number.isNaN(max) || max < v) max = v;
    if (Number.isNaN(min) || min > v) min = v;
  }
  const range = max - min;
  return Float32Array.from(fractions, (v) => (v - min) * range);
}

// Table data (ThreeDDataModel(TableData)): per column min and max; a NaN
// (empty cell) fails with BAD_TABLE_DATA; a frequency column uses 0..100;
// otherwise a range under 0.001 becomes [min, min + 1] and the range is
// widened by 10% on each side (AXIS_WIDENING_FACTOR); values are mapped
// linearly to 0..1 (LinearTransform.scaleToFrame).
export const AXIS_WIDENING_FACTOR = 0.1;
export function tableAxes(cols: { name: string; values: number[]; frequency?: boolean }[]): { axes: { name: string; values: Float32Array; range: [number, number] }[] } | { error: string } {
  const axes: { name: string; values: Float32Array; range: [number, number] }[] = [];
  for (const c of cols) {
    const v = c.values.map((x) => Math.fround(x));
    let min = Math.min(...v), max = Math.max(...v);
    if (!v.length || v.some((x) => Number.isNaN(x))) return { error: `Plot error: The data in column '${c.name}' can not be plotted.  Try batching the table first to check for empty cells.` };
    if (c.frequency) { min = 0; max = 100; }
    else {
      let r = max - min;
      if (r < 0.001) { max = min + 1; r = max - min; }
      min = Math.fround(min - r * AXIS_WIDENING_FACTOR);
      max = Math.fround(max + r * AXIS_WIDENING_FACTOR);
    }
    axes.push({ name: c.name, values: Float32Array.from(v, (x) => (x - min) / (max - min)), range: [min, max] });
  }
  return { axes };
}

// ThreeDJPlot.createPlotData / ThreeDScatterBuilder / ThreeDBubbleBuilder:
// size = sizeFactor * SIZE_COEFF (0.1); a point cloud draws points of
// round(180 size + 1) pixels; a bubble plot draws spheres of radius
// u^2 sizeFactor 0.1 + 0.01 (u = the size parameter, 0..1) or, with a
// static size, size + 0.01, in cube units, at most bubbleMaxEvents (1000)
// spheres taking every (n / min(n, 1000))-th event.
export const SIZE_COEFF = 0.1;
export const BUBBLE_MAX_EVENTS = 1000;
export const BUBBLE_PLOT_SCALING = 0.01;
export const pointPixels = (sizeFactor: number) => Math.round(Math.fround(180 * Math.fround(sizeFactor * SIZE_COEFF)) + 1);
export const bubbleRadius = (sizeFactor: number, u: number | null) => (u === null ? sizeFactor * SIZE_COEFF : u * u * sizeFactor * SIZE_COEFF) + BUBBLE_PLOT_SCALING;
export const bubbleStep = (n: number) => { const m = Math.min(n, BUBBLE_MAX_EVENTS); return m > 0 ? Math.floor(n / m) : 1; };

// ThreeDSurfaceBuilder (Terrain Plot): the X and Z values are binned into
// contourResolution (50) bins each (bin = floor(u / (1/50)), last bin for
// u = 1, values outside 0..1 skipped); the height at (i, j) is
// binsX[i] * binsZ[j] / (largest such product): the product of the two
// marginal histograms, not a joint histogram.
export const CONTOUR_RESOLUTION = 50;
export function terrainHeights(x: ArrayLike<number>, z: ArrayLike<number>, bins = CONTOUR_RESOLUTION): Float32Array {
  const w = Math.fround(1 / bins), bx = new Float64Array(bins), bz = new Float64Array(bins);
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = z[i];
    if (a > 1 || a < 0 || b > 1 || b < 0) continue;
    bx[Math.min(Math.floor(a / w), bins - 1)]++;
    bz[Math.min(Math.floor(b / w), bins - 1)]++;
  }
  let max = 0;
  for (let i = 0; i < bins; i++) for (let j = 0; j < bins; j++) max = Math.max(max, bx[i] * bz[j]);
  const out = new Float32Array(bins * bins);
  if (max > 0) for (let i = 0; i < bins; i++) for (let j = 0; j < bins; j++) out[i * bins + j] = (bx[i] * bz[j]) / max;
  return out;
}

// Rotation matrices (row-major 3x3). The default orientation is the identity
// (Plot3DJ.createDefaultOrientation: X right, Y up, Z toward the viewer).
export type Mat3 = number[];
export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
export const rotX = (t: number): Mat3 => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
export const rotY = (t: number): Mat3 => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
// MouseRotate: 0.008 rad per pixel of drag from the press position.
export const MOUSE_FACTOR = 0.008;
// RotateBehavior: after a drag whose last horizontal step was 2 pixels or
// more the plot keeps turning about its own Y axis every 40 ms by
// clamp(0.005 dx, -0.08, 0.08) radians.
export const spinStep = (dx: number) => (Math.abs(dx) < 2 ? 0 : Math.max(-0.08, Math.min(0.08, 0.005 * dx)));
// Plot3DJ.EYE_ANGLE: the Wiggle offset.
export const EYE_ANGLE = 0.03;
// Perspective of Java 3D's nominal viewing transform: field of view pi/4,
// eye at 1 / tan(pi/8) from the origin; points are drawn at (cube - 0.5).
export const EYE = 1 / Math.tan(Math.PI / 8);
export function project(m: Mat3, x: number, y: number, z: number, half: number, cx: number, cy: number): [number, number, number, number] {
  const X = m[0] * x + m[1] * y + m[2] * z, Y = m[3] * x + m[4] * y + m[5] * z, Z = m[6] * x + m[7] * y + m[8] * z;
  const k = EYE / (EYE - Z);
  return [cx + X * k * half, cy - Y * k * half, Z, k];
}

// Wiggle... (ThreeDController.saveWiggle): two frames, the view turned by
// -EYE_ANGLE about its Y axis and the current view, written with
// HtmlMovieCreator (frame delay 500 ms, auto play). Own rule: one HTML file
// with the frames inline instead of FlowJo's folder of files.
export function wiggleHtml(title: string, frames: string[], delayMs = 500): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="margin:0;background:#fff">`
    + frames.map((f, i) => `<img class="f" src="${f}" style="display:${i ? 'none' : 'block'}">`).join('')
    + `<script>var f=document.querySelectorAll('.f'),i=0;setInterval(function(){f[i].style.display='none';i=(i+1)%f.length;f[i].style.display='block';},${delayMs});</script></body></html>`;
}

// ThreeDNode.setDefaults: X and Y from the graph, Z and the colour axis an
// unused parameter each (Sample.chooseUnusedParameter, fluorescent first),
// colour gradient from the preference (Spectrum).
export function defaultAxes(names: string[], x?: string, y?: string | null): { x: string; y: string; z: string; color: string } {
  const used: string[] = [];
  const take = (want?: string | null) => { const n = want && names.includes(want) && !used.includes(want) ? want : unused(); used.push(n); return n; };
  const unused = () => names.find((n) => !used.includes(n) && !/^(FSC|SSC|Time)/i.test(n)) ?? names.find((n) => !used.includes(n)) ?? names[0] ?? '';
  const ax = take(x), ay = take(y), az = take(null), ac = take(null);
  return { x: ax, y: ay, z: az, color: ac };
}
