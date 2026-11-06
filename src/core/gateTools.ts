// FlowJo 10.6.2 gate tools (specs section 10): curly quad outline, pencil
// vertex rule, gate conversion, spider quad membership, magnetic gates and
// the auto gate's contour engine. Read with REA's Ghidra provider (native
// QuadGate, FGate::MoveMagneticGate, GHistogram2D contour code) and headless
// Ghidra / javap (CurlyQuadGate, FigPoly, Gate.convert, LayerAutoGate);
// implemented independently. This module is the one owner of these rules.
import { axesFromGate, gateFromAxes, outline } from './ellipse';
import { defaultGrid, insideOrOnPolygon } from './gateGrid';
import type { Dimension, Gate } from './model';
import { makeTransform } from './transforms';

type Pt = [number, number];
const jround = (v: number) => Math.floor(v + 0.5); // Java Math.round

// ---------------------------------------------------------------------------
// Curly quad (CurlyQuadGate). The outline is built on a fixed 256 x 256 pixel
// frame whose edges are the axes' display limits; pixel y counts down from
// the top. Each arm is a parabola with k = 0.001 per pixel squared (fixed in
// FlowJo 10.6.2 and not saved). Quadrants: 0 upper-left, 1 upper-right,
// 2 lower-left, 3 lower-right.
export const CURLY_FRAME = 256;
export const CURLY_K = 0.001;

function horizontalArm(cx: number, cy: number, W: number, k: number): Pt[] {
  const out: Pt[] = [[cx, cy]];
  const step = Math.max(1, Math.trunc((W - cx) / 40));
  let x = cx + 1;
  for (; x < W; x += step) out.push([x, cy - jround(k * (x - cx) * (x - cx))]);
  const last = out[out.length - 1];
  if (last[0] !== W) out.push([W, last[1]]);
  return out;
}

function verticalArm(cx: number, cy: number, W: number, k: number): Pt[] {
  const out: Pt[] = [[cx, cy]];
  const step = Math.max(1, Math.trunc(cy / 40));
  for (let y = cy; y >= 0; y -= step) {
    const x = jround(cx + k * (cy - y) * (cy - y));
    out.push([x, y]);
    if (x > W) break;
  }
  const last = out[out.length - 1];
  if (last[1] !== 0) out.push([last[0], 0]);
  return out;
}

// The four quadrant polygons in frame pixels (centre given in pixels).
export function curlyQuadFramePolygons(cx: number, cy: number, W = CURLY_FRAME, H = CURLY_FRAME, k = CURLY_K): [Pt[], Pt[], Pt[], Pt[]] {
  const h = horizontalArm(cx, cy, W, k);
  const v = verticalArm(cx, cy, W, k);
  const ul: Pt[] = [...v, [0, 0], [0, cy]];
  const ur: Pt[] = [...v, [W, 0], ...[...h].reverse()];
  const ll: Pt[] = [[0, cy], [cx, cy], [cx, H], [0, H]];
  const lr: Pt[] = [...h, [W, H], [cx, H]];
  return [ul, ur, ll, lr];
}

// Quadrant polygon in display (gate) units for a centre in display units,
// with the frame spanning xr / yr (the plot's display ranges).
export function curlyQuadPolygon(center: Pt, quadrant: number, xr: [number, number], yr: [number, number]): Pt[] {
  const W = CURLY_FRAME;
  const cx = jround(((center[0] - xr[0]) / (xr[1] - xr[0])) * W);
  const cy = jround(((yr[1] - center[1]) / (yr[1] - yr[0])) * W);
  const polys = curlyQuadFramePolygons(cx, cy);
  return polys[quadrant].map(([fx, fy]) => [xr[0] + (fx / W) * (xr[1] - xr[0]), yr[1] - (fy / W) * (yr[1] - yr[0])]);
}

// ---------------------------------------------------------------------------
// Pencil (FigPoly.processFreehandDrag): the last vertex follows the mouse; a
// new vertex is committed when the mouse is more than 12 px from the last
// committed vertex and the path bends (bend = (d + a) / c > 1.04) or the run
// is long (d / bend > 12). a = distance between the last two committed
// vertices, c = distance from the mouse to the one before the last. Points in
// screen pixels. Fewer than 4 points on release abandons the gate.
export const FREEHAND_DIST = 12;
export const FREEHAND_BEND = 1.04;
export const FREEHAND_LEN = 12;
export const FREEHAND_MIN_POINTS = 4;
export function freehandCommit(committed: Pt[], mouse: Pt): boolean {
  const last = committed[committed.length - 1];
  if (!last) return true;
  const d = Math.hypot(mouse[0] - last[0], mouse[1] - last[1]);
  if (!(d > FREEHAND_DIST)) return false;
  const prev = committed[committed.length - 2];
  if (!prev) return true;
  const a = Math.hypot(last[0] - prev[0], last[1] - prev[1]);
  const c = Math.hypot(mouse[0] - prev[0], mouse[1] - prev[1]);
  const bend = c === 0 ? Infinity : (d + a) / c;
  return bend > FREEHAND_BEND || d / bend > FREEHAND_LEN;
}
// Vertices of a finished pencil path (committed vertices plus the mouse).
export function freehandPath(screen: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of screen) if (freehandCommit(out, p)) out.push(p);
  const end = screen[screen.length - 1];
  if (end && out.length && (out[out.length - 1][0] !== end[0] || out[out.length - 1][1] !== end[1])) out.push(end);
  return out;
}

// ---------------------------------------------------------------------------
// Vertex reduction. FigPoly.reduce (auto gate): target = trunc(n p), at least
// 20 when nonzero; keep every (n div target)-th vertex. PolyGate.reducePoints
// (ellipse to polygon): keep indices divisible by trunc(n / target).
export function reduceFig<T>(pts: T[], fraction = 0.1): T[] {
  const n = pts.length;
  let target = Math.trunc(n * fraction);
  if (target === 0) return pts;
  target = Math.max(target, 20);
  if (n <= target) return pts;
  const step = Math.trunc(n / target);
  return pts.filter((_, i) => i % step === 0);
}
export function reducePoints<T>(pts: T[], target: number): T[] {
  const step = Math.trunc(pts.length / target);
  if (step <= 1) return pts;
  return pts.filter((_, i) => i % step === 0);
}

// ---------------------------------------------------------------------------
// Gate conversion (Gate.convert, GateConvertEdit; menu "to Poly / to Rect /
// to Ellipse"). Rectangle to polygon: (xmin, ymin), (xmin, ymax), (xmax,
// ymax), (xmax, ymin). Polygon or ellipse to rectangle: the vertex bounding
// box snapped outward to whole scale units (java.awt.Rectangle). Ellipse to
// polygon: the outline reduced to about 20 vertices.
export const rectToPolygon = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
export function boundsSnapped(pts: Pt[]): { min: Pt; max: Pt } {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { min: [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys))], max: [Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))] };
}
export const ellipseToPolygon = (outline: Pt[]): Pt[] => {
  const dedup = outline.filter((p, i) => i === 0 || p[0] !== outline[i - 1][0] || p[1] !== outline[i - 1][1]);
  return reducePoints(dedup, 20);
};

// ---------------------------------------------------------------------------
// Spider quad (native QuadGate kind 11, gating:PolyQuad; curly quads too).
// Four polygons in slot order (0 upper-left, 1 upper-right, 2 lower-left,
// 3 lower-right), in lattice units. On the R x R lattice each point takes the
// slot of the first polygon that contains it (edges and vertices inside); a
// point in none takes slot 0. Returns the label grid (index x R + y). The
// engine orders the polygons by the corner of their joint bounding box each
// one has; FlowJo's own spiders and curly quads always have one corner each.
export function spiderLabelGrid(R: number, bySlot: Pt[][]): Uint8Array {
  const out = new Uint8Array(R * R);
  for (let x = 0; x < R; x++) {
    for (let y = 0; y < R; y++) {
      for (let s = 0; s < 4; s++) {
        const p = bySlot[s];
        if (p && insideOrOnPolygon(x, y, p.map((v) => v[0]), p.map((v) => v[1]))) { out[x * R + y] = s; break; }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Magnetic gates (FGate::MoveMagneticGate). On every sample the gate starts
// from where it was drawn and walks over a 256 x 256 histogram of the parent
// population, one cell at a time toward the count-weighted centre of the
// cells it covers, until it revisits a position or after 512 steps. Here
// histogram counts are indexed x * 256 + y in byte cells with y counting
// down (the engine flips y as 256 - byte); the polygon is in the same cells.
// Returns the offset (dx, dy) in those cells.
export const MAGNETIC_BINS = 256;
export const MAGNETIC_MAX_STEPS = 512;
const MAGNETIC_SLOPE = 2.41; // about tan 67.5 degrees
function centroidOffset(hist: Float64Array, poly: Pt[], ox: number, oy: number): Pt {
  const B = MAGNETIC_BINS;
  const vx = poly.map((p) => p[0] + ox), vy = poly.map((p) => p[1] + oy);
  const x0 = Math.max(0, Math.ceil(Math.min(...vx))), x1 = Math.min(B - 1, Math.floor(Math.max(...vx)));
  const y0 = Math.max(0, Math.ceil(Math.min(...vy))), y1 = Math.min(B - 1, Math.floor(Math.max(...vy)));
  let n = 0, gx = 0, gy = 0, w = 0, wx = 0, wy = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (!insideOrOnPolygon(x, y, vx, vy)) continue;
      n++; gx += x; gy += y;
      const c = Math.trunc(hist[x * B + y]);
      w += c; wx += c * x; wy += c * y;
    }
  }
  if (w > 0) return [wx / w - gx / n, wy / w - gy / n];
  // No data inside: the whole histogram against the middle of the gate's box.
  let W = 0, X = 0, Y = 0;
  for (let x = 0; x < B; x++) for (let y = 0; y < B; y++) { const c = Math.trunc(hist[x * B + y]); W += c; X += c * x; Y += c * y; }
  if (W === 0) return [0, 0];
  return [X / W - (Math.min(...vx) + Math.max(...vx)) / 2, Y / W - (Math.min(...vy) + Math.max(...vy)) / 2];
}
export function magneticOffset2D(hist: Float64Array, poly: Pt[]): Pt {
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const seen = new Map<string, number>();
  let pos: Pt = [0, 0];
  let prev: { pos: Pt; score: number } | null = null;
  for (let step = 0; step < MAGNETIC_MAX_STEPS; step++) {
    const key = `${pos[0]},${pos[1]}`;
    const [dx, dy] = centroidOffset(hist, poly, pos[0], pos[1]);
    const score = dx * dx + dy * dy;
    if (seen.has(key)) return prev && prev.score < seen.get(key)! ? prev.pos : pos;
    seen.set(key, score);
    prev = { pos, score };
    const sx = Math.abs(dy) <= MAGNETIC_SLOPE * Math.abs(dx) ? sign(dx) : 0;
    const sy = Math.abs(dx) <= MAGNETIC_SLOPE * Math.abs(dy) ? sign(dy) : 0;
    pos = [pos[0] + sx, pos[1] + sy];
  }
  return pos;
}
// 1-D (FGate::MoveHistogramGate): 256-bin histogram of the parent; the range
// [a, b] in bins moves one bin at a time toward the mean of its events while
// the count in [a, b - 1] keeps strictly increasing (at most 512 steps).
export function magneticOffset1D(hist: Float64Array, a: number, b: number): number {
  const B = hist.length;
  const count = (lo: number, hi: number) => { let s = 0; for (let i = Math.max(0, lo); i <= Math.min(B - 1, hi); i++) s += hist[i]; return s; };
  let n = 0, m = 0;
  for (let i = Math.max(0, a); i <= Math.min(B - 1, b); i++) { n += hist[i]; m += hist[i] * i; }
  const dir = n > 0 && m / n > (a + b) / 2 ? 1 : -1;
  let best = count(a, b - 1), shift = 0;
  for (let s = 1; s <= MAGNETIC_MAX_STEPS; s++) {
    const c = count(a + dir * s, b - 1 + dir * s);
    if (!(c > best)) break;
    best = c; shift = dir * s;
  }
  return shift;
}

// ---------------------------------------------------------------------------
// Auto gate (LayerAutoGate + native GHistogram2D contour plot). Contours of
// a smoothed 256 x 256 histogram at the 2% level; the contour polygon with
// the vertex nearest the mouse is taken and reduced to about 10% of its
// vertices.
export const AUTO_GATE_BINS = 256;
export const AUTO_GATE_LEVELS = 50; // "2%": each level encloses another N/50 events
const SMOOTH_MARGIN = 13;
const SMOOTH_SPREAD = 2.4 / 13;
const kernels = new Map<number, Float64Array>();
// 1-D weights for a bin of count n (truncated to an integer), normalised so
// that the 2-D product kernel sums to 1.
export function smoothingKernel(n: number): Float64Array {
  const key = Math.trunc(n);
  const hit = kernels.get(key);
  if (hit) return hit;
  const s = Math.min(SMOOTH_MARGIN, Math.ceil(SMOOTH_MARGIN * key ** -0.25));
  const w = Float64Array.from({ length: s + 1 }, (_, j) => Math.exp(-0.5 * j * j * Math.sqrt(key) * SMOOTH_SPREAD * SMOOTH_SPREAD));
  let sum = w[0];
  for (let j = 1; j <= s; j++) sum += 2 * w[j];
  for (let j = 0; j <= s; j++) w[j] /= sum;
  if (key <= 512) kernels.set(key, w);
  return w;
}
// Adaptive scatter smoothing of a B x B count grid (index x * B + y); mass
// spread past an edge is folded back by mirroring about the edge.
export function smoothHistogram(counts: Float64Array, B = AUTO_GATE_BINS): Float64Array {
  const out = new Float64Array(B * B);
  const mirror = (i: number) => (i < 0 ? -1 - i : i >= B ? 2 * B - 1 - i : i);
  for (let x = 0; x < B; x++) {
    for (let y = 0; y < B; y++) {
      const n = Math.trunc(counts[x * B + y]);
      if (n <= 0) continue;
      const w = smoothingKernel(n);
      const s = w.length - 1;
      for (let i = -s; i <= s; i++) {
        const xi = mirror(x + i);
        const wi = n * w[Math.abs(i)];
        for (let j = -s; j <= s; j++) out[xi * B + mirror(y + j)] += wi * w[Math.abs(j)];
      }
    }
  }
  return out;
}
// Contour levels: bins above 0.005 in descending density; a level each time
// the running mass passes another multiple of N / levels, placed between the
// bin's density v and the previous one by the bin's overshoot r:
// t = v + (r / v) 0.99 (prev - v), r <= 0. A run of equal densities uses
// half the gap to the next lower density divided by the run length.
export function contourThresholds(d: Float64Array, N: number, levels = AUTO_GATE_LEVELS): number[] {
  const v = Array.from(d).filter((x) => x > 0.005).sort((a, b) => b - a);
  const step = N / levels;
  const out: number[] = [];
  let cum = 0, k = 1, prev = v[0] ?? 0;
  for (let i = 0; i < v.length && k < levels; i++) {
    cum += v[i];
    while (cum >= k * step && k < levels) {
      const r = k * step - cum;
      if (v[i] === prev) {
        let j = i;
        while (j < v.length && v[j] === v[i]) j++;
        let run = 1;
        for (let q = i - 1; q >= 0 && v[q] === v[i]; q--) run++;
        const next = j < v.length ? v[j] : 0;
        out.push(v[i] - (v[i] - next) / 2 / run);
      } else out.push(v[i] + (r / v[i]) * 0.99 * (prev - v[i]));
      k++;
    }
    prev = v[i];
  }
  return out;
}
// Closed iso-lines of a B x B grid at threshold t, in bin coordinates (a bin
// centre at its index). The frame closes regions that touch it: border
// segments run along the outermost bins.
export function contourPolygons(d: Float64Array, t: number, B = AUTO_GATE_BINS): Pt[][] {
  const P = B + 2; // padded by one cell outside the frame
  const OUT = -1e300;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= B || y >= B ? OUT : d[x * B + y]);
  const lerp = (a: number, b: number) => (a === OUT ? 1 : b === OUT ? 0 : (t - a) / (b - a));
  const key = (p: Pt) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const segs: [Pt, Pt][] = [];
  for (let x = -1; x < P - 2; x++) {
    for (let y = -1; y < P - 2; y++) {
      const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), e = at(x, y + 1);
      const code = (a > t ? 1 : 0) | (b > t ? 2 : 0) | (c > t ? 4 : 0) | (e > t ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const pb: Pt = [x + lerp(a, b), y];
      const pr: Pt = [x + 1, y + lerp(b, c)];
      const pt: Pt = [x + lerp(e, c), y + 1];
      const pl: Pt = [x, y + lerp(a, e)];
      const centre = (Math.max(a, OUT / 2) + Math.max(b, OUT / 2) + Math.max(c, OUT / 2) + Math.max(e, OUT / 2)) / 4 > t;
      switch (code) {
        case 1: case 14: segs.push([pl, pb]); break;
        case 2: case 13: segs.push([pb, pr]); break;
        case 3: case 12: segs.push([pl, pr]); break;
        case 4: case 11: segs.push([pr, pt]); break;
        case 6: case 9: segs.push([pb, pt]); break;
        case 7: case 8: segs.push([pl, pt]); break;
        case 5: if (centre) { segs.push([pl, pt], [pb, pr]); } else { segs.push([pl, pb], [pr, pt]); } break;
        case 10: if (centre) { segs.push([pl, pb], [pr, pt]); } else { segs.push([pl, pt], [pb, pr]); } break;
      }
    }
  }
  // Chain segments into closed polygons (endpoints matched in either order).
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); (ends.get(k) ?? ends.set(k, []).get(k)!).push(i); } });
  const used = new Uint8Array(segs.length);
  const polys: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const poly: Pt[] = [segs[i][0], segs[i][1]];
    for (;;) {
      const tail = poly[poly.length - 1];
      const next = (ends.get(key(tail)) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const [p, q] = segs[next];
      poly.push(key(p) === key(tail) ? q : p);
    }
    if (poly.length > 2 && key(poly[0]) === key(poly[poly.length - 1])) poly.pop();
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}
// All contour polygons of the auto gate, densest level first.
export function autoGateContours(counts: Float64Array, N: number, B = AUTO_GATE_BINS): Pt[][] {
  const d = smoothHistogram(counts, B);
  return contourThresholds(d, N).flatMap((t) => contourPolygons(d, t, B));
}
// The polygon whose nearest vertex (the last vertex is not considered) is
// closest to the mouse cell; the first wins a tie.
export function nearestContour(polys: Pt[][], m: Pt): Pt[] | null {
  let best: Pt[] | null = null, bestD = Infinity;
  for (const p of polys) {
    for (let i = 0; i < p.length - 1; i++) {
      const d = (p[i][0] - m[0]) ** 2 + (p[i][1] - m[1]) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Names of new gates. The label is the parameter's stain when it has one
// (FlowJo preference "use stain for gate name", on by default), else its name.
export const gateLabel = (name: string, stain?: string) => (stain && stain.trim() ? stain.trim() : name);
// Quad numbering (findFirstQ): start at 1 and move past any index among the
// next four that a child name already starts with ("Q5" ...); a name like
// "Q10" also counts as "Q1", as in FlowJo.
export function firstQuadNumber(childNames: string[]): number {
  let b = 1;
  for (;;) {
    let hit = -1;
    for (let j = 0; j < 4; j++) if (childNames.some((n) => n.startsWith(`Q${b + j}`))) hit = j;
    if (hit < 0) return b;
    b += hit + 1;
  }
}
// Quad names in slot order (upper-left, upper-right, lower-left, lower-right):
// "Q<n>: <x label><+|-> , <y label><+|->", numbered UL b, UR b+1, LR b+2,
// LL b+3.
export function quadNames(b: number, xl: string, yl: string): [string, string, string, string] {
  return [`Q${b}: ${xl}- , ${yl}+`, `Q${b + 1}: ${xl}+ , ${yl}+`, `Q${b + 3}: ${xl}- , ${yl}-`, `Q${b + 2}: ${xl}+ , ${yl}-`];
}
// Bisector names (RangeGateCreator.createBisectingChildren): "<label>-" for
// the lower half, "<label>+" for the upper; a clash with an existing child
// gives "<parameter>::<label>-/+".
export function bisectorNames(label: string, param: string, childNames: string[]): [string, string] {
  return (['-', '+'] as const).map((s) => (childNames.includes(`${label}${s}`) ? `${param}::${label}${s}` : `${label}${s}`)) as [string, string];
}

// ---------------------------------------------------------------------------
// Spider quad geometry (SpiderPoint, PolyGate spider constructor). A spider
// has a centre, one point on each frame side (top and bottom give x, left
// and right give y) and the four frame corners. Each quadrant polygon has
// four vertices: (corner x, side y), the corner, (side x, corner y), centre.
// Slot order: upper-left, upper-right, lower-left, lower-right.
export interface SpiderShape {
  center: Pt;
  top: number; bottom: number; left: number; right: number;
  // Frame: x from x0 to x1, y from y0 to y1 (gate units).
  x0: number; x1: number; y0: number; y1: number;
}
export function spiderPolygons(s: SpiderShape): Pt[][] {
  const c = s.center;
  return [
    [[s.x0, s.left], [s.x0, s.y1], [s.top, s.y1], c],
    [[s.x1, s.right], [s.x1, s.y1], [s.top, s.y1], c],
    [[s.x0, s.left], [s.x0, s.y0], [s.bottom, s.y0], c],
    [[s.x1, s.right], [s.x1, s.y0], [s.bottom, s.y0], c],
  ];
}
// Shape of an existing spider from its polygons (slot order).
export function spiderShape(polys: Pt[][]): SpiderShape {
  const [ul, ur, ll, lr] = polys;
  return { center: ul[3], left: ul[0][1], right: ur[0][1], top: ul[2][0], bottom: ll[2][0], x0: ul[1][0], y1: ul[1][1], x1: lr[1][0], y0: lr[1][1] };
}
// FlowJo puts the side points 10 pixels right of and below the click on its
// 256-pixel graph frame while the centre vertex stays at the click.
export const SPIDER_INITIAL_OFFSET_PX = 10;
export const SPIDER_DRAG_MARGIN_PX = 10;

// ---------------------------------------------------------------------------
// Gate conversion on a population (Gate.convert): keeps the population, its
// children and flags. Bounding boxes snap outward to whole scale (data) units
// on each axis, as java.awt.Rectangle does with FlowJo's scale values.
export type ConvertTo = 'polygon' | 'rect' | 'ellipse';
export function convertGate(g: Gate, to: ConvertTo): Gate | null {
  if (g.type !== 'rect' && g.type !== 'polygon' && g.type !== 'ellipsoid') return null;
  if (g.dims.length !== 2 || g.type === to || (g.type === 'ellipsoid' && to === 'ellipse')) return null;
  const dims = g.dims as [Dimension, Dimension];
  const tf = dims.map((d) => makeTransform(d.transform));
  if (g.type === 'rect' && g.min.concat(g.max).some((v) => v === null)) return null;
  const snapBox = (pts: Pt[]) => {
    const raw = pts.map(([a, b]): Pt => [tf[0].inverse(a), tf[1].inverse(b)]);
    const { min, max } = boundsSnapped(raw);
    return { min: [tf[0].apply(min[0]), tf[1].apply(min[1])], max: [tf[0].apply(max[0]), tf[1].apply(max[1])] };
  };
  // The polygon outline of the source gate, in gate units.
  const outlinePts = (): Pt[] => {
    if (g.type === 'polygon') return g.vertices;
    if (g.type === 'rect') return rectToPolygon(g.min[0]!, g.min[1]!, g.max[0]!, g.max[1]!);
    return outline(axesFromGate(g.mean, g.cov, g.distanceSquare), 180);
  };
  if (to === 'polygon') {
    const vertices = g.type === 'rect' ? outlinePts() : ellipseToPolygon(outlinePts());
    return { type: 'polygon', dims, vertices, grid: defaultGrid(dims) };
  }
  // Polygon and ellipse go to a rectangle first (polygon to ellipse is
  // polygon to rectangle to ellipse).
  const box = g.type === 'rect' ? { min: [g.min[0]!, g.min[1]!], max: [g.max[0]!, g.max[1]!] } : snapBox(outlinePts());
  if (to === 'rect') return { type: 'rect', dims, min: box.min, max: box.max };
  // Rectangle to ellipse (EllipseGate.updateFromRect): foci at the midpoints
  // of the sides across the longer extent, sum of focal distances = width +
  // height, centred on the rectangle.
  const w = box.max[0] - box.min[0], h = box.max[1] - box.min[1];
  const a = (w + h) / 2, c = Math.max(w, h) / 2;
  const b = Math.sqrt(Math.max(0, a * a - c * c));
  if (!(a > 0 && b > 0)) return null;
  const axes = { cx: (box.min[0] + box.max[0]) / 2, cy: (box.min[1] + box.max[1]) / 2, a, b, theta: w >= h ? 0 : Math.PI / 2 };
  return { type: 'ellipsoid', dims, ...gateFromAxes(axes), grid: defaultGrid(dims) };
}
