// FlowJo 10.6.2 gate tools (specs section 10): curly quad outline, pencil
// vertex rule, gate conversion, spider quad membership, magnetic gates and
// the auto gate's contour engine. Read with REA's Ghidra provider (native
// QuadGate, FGate::MoveMagneticGate, GHistogram2D contour code) and headless
// Ghidra / javap (CurlyQuadGate, FigPoly, Gate.convert, LayerAutoGate);
// implemented independently. This module is the one owner of these rules.
import { axesFromGate, gateFromAxes } from './ellipse';
import { defaultGrid, ellipseLatticePolygon, insideOrOnPolygon } from './gateGrid';
import type { Dimension, Gate } from './model';
import { makeTransform } from './transforms';
import { channelOf, valueOf, type ChannelScale } from './flowjoStats';

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
function centroidOffset(hist: Float64Array, poly: Pt[], ox: number, oy: number): Pt | null {
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
  if (W === 0) return null; // no data at all: the gate is not moved
  return [X / W - (Math.min(...vx) + Math.max(...vx)) / 2, Y / W - (Math.min(...vy) + Math.max(...vy)) / 2];
}
export function magneticOffset2D(hist: Float64Array, poly: Pt[]): Pt {
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const seen = new Map<string, number>();
  let pos: Pt = [0, 0];
  let prev: { pos: Pt; score: number } | null = null;
  for (let step = 0; step < MAGNETIC_MAX_STEPS; step++) {
    const key = `${pos[0]},${pos[1]}`;
    const off = centroidOffset(hist, poly, pos[0], pos[1]);
    if (!off) return pos;
    const [dx, dy] = off;
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
  // FlowJo draws ellipses on a 256-pixel frame spanning each axis's display
  // range; frame pixels and gate units map linearly per axis.
  const span = tf.map((t) => [t.displayMin, t.displayMax] as [number, number]);
  if (span.some(([lo, hi]) => !(hi > lo))) return null;
  const F = CURLY_FRAME;
  const toPx = (v: number, k: number) => ((v - span[k][0]) / (span[k][1] - span[k][0])) * F;
  const fromPx = (v: number, k: number) => span[k][0] + (v / F) * (span[k][1] - span[k][0]);
  // Ellipse to polygon (PolyGate(EllipseGate)): the 180-vertex outline in
  // whole frame pixels, repeated points skipped, then reducePoints(20).
  const ellipseOutline = (): Pt[] => {
    if (g.type !== 'ellipsoid') return [];
    const sxk = F / (span[0][1] - span[0][0]), syk = F / (span[1][1] - span[1][0]);
    const cov = [[g.cov[0][0] * sxk * sxk, g.cov[0][1] * sxk * syk], [g.cov[1][0] * sxk * syk, g.cov[1][1] * syk * syk]];
    const e = axesFromGate([toPx(g.mean[0], 0), toPx(g.mean[1], 1)], cov, g.distanceSquare);
    const c = Math.cos(e.theta), sn = Math.sin(e.theta);
    const edges: Pt[] = [[e.cx + e.a * c, e.cy + e.a * sn], [e.cx - e.a * c, e.cy - e.a * sn], [e.cx - e.b * sn, e.cy + e.b * c], [e.cx + e.b * sn, e.cy - e.b * c]];
    const { vx, vy } = ellipseLatticePolygon(edges);
    return reducePoints(vx.map((x, i): Pt => [fromPx(x, 0), fromPx(vy[i], 1)]), 20);
  };
  const outlinePts = (): Pt[] => (g.type === 'polygon' ? g.vertices : g.type === 'rect' ? rectToPolygon(g.min[0]!, g.min[1]!, g.max[0]!, g.max[1]!) : ellipseOutline());
  if (to === 'polygon') return { type: 'polygon', dims, vertices: outlinePts(), grid: defaultGrid(dims) };
  // Polygon and ellipse go to a rectangle first (polygon to ellipse is
  // polygon to rectangle to ellipse).
  const box = g.type === 'rect' ? { min: [g.min[0]!, g.min[1]!], max: [g.max[0]!, g.max[1]!] } : snapBox(outlinePts());
  if (to === 'rect') return { type: 'rect', dims, min: box.min, max: box.max };
  // Rectangle to ellipse (EllipseGate.updateFromRect): the corners become the
  // edge points, so both axes are the diagonals: a circle in frame pixels
  // through the four corners, centred on the rectangle.
  const px = [toPx(box.min[0], 0), toPx(box.max[0], 0)], py = [toPx(box.min[1], 1), toPx(box.max[1], 1)];
  const R = Math.hypot(px[1] - px[0], py[1] - py[0]) / 2;
  if (!(R > 0)) return null;
  const rx = fromPx(R, 0) - fromPx(0, 0), ry = fromPx(R, 1) - fromPx(0, 1);
  const axes = { cx: (box.min[0] + box.max[0]) / 2, cy: (box.min[1] + box.max[1]) / 2, a: Math.max(rx, ry), b: Math.min(rx, ry), theta: rx >= ry ? 0 : Math.PI / 2 };
  return { type: 'ellipsoid', dims, ...gateFromAxes(axes), grid: defaultGrid(dims) };
}

// ---------------------------------------------------------------------------
// BifurGate (ws.autoquad: WSAutoQuadAction, RangeGateCreator.createQuadGates,
// PeakFinder, native BasicHistogram::Smooth). For each fluorescent parameter
// the parent's smoothed 4096-channel histogram is searched for peaks, reduced
// to the two largest, and split at the lowest channel between them.
export const BIFUR_BINS = 4096;
const roundHalfEven = (v: number) => {
  const f = Math.floor(v), d = v - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
};
// 1-D smoothing (Smoothing::SmoothHistogram): each bin of count n spreads
// n w[|j|] over j = -s..s, s = ceil(13 n^-1/4), w[j] = exp(-0.5 j^2
// (2.4/13)^2 sqrt(n)) summing to 1. Mass past the left edge is mirrored
// back (padding bin k onto bin k); past the right edge the first two padding
// bins are lost and padding bin o (o >= 2) lands on bin len + 1 - o. Values
// are returned rounded to whole counts ("%9.0f").
export function smoothHistogram1D(counts: Float64Array): Float64Array {
  const L = counts.length, M = SMOOTH_MARGIN;
  const buf = new Float64Array(L + 2 * M);
  for (let i = 0; i < L; i++) {
    const n = counts[i];
    if (!(n > 0)) continue;
    const key = Math.trunc(n);
    const s = Math.ceil(Math.fround(SMOOTH_MARGIN * Math.fround(key ** -0.25)));
    const w = Array.from({ length: s + 1 }, (_, j) => Math.exp(-0.5 * j * j * SMOOTH_SPREAD * SMOOTH_SPREAD * Math.sqrt(key)));
    let sum = w[0];
    for (let j = 1; j <= s; j++) sum += 2 * w[j];
    for (let j = -s; j <= s; j++) buf[M + i + j] += (n * w[Math.abs(j)]) / sum;
  }
  const out = buf.slice(M, M + L);
  for (let k = 0; k < M; k++) out[k] += buf[M - 1 - k];
  for (let o = 2; o < M; o++) out[L + 1 - o] += buf[M + L + o];
  return out.map(roundHalfEven);
}

export interface HistPeak { count: number; position: number; height: number; min: number; max: number }
// PeakFinder.findPeaks(0) on integer counts y (length n). acceptAll: flag 32
// of findPeaks (Create Gates On Peaks), which keeps every peak found instead
// of rejecting small ones. min / max: the peak's edges (PeakInfo bounds).
export function findPeaks(y0: Float64Array, maxPeaks = 100, acceptAll = false): HistPeak[] {
  const n = y0.length;
  const y = Float64Array.from(y0);
  let N = 0;
  for (let i = 0; i < n; i++) N += Math.trunc(y[i]);
  let sumHeights = 0, nCounted = 1, removed = 0, done = false, peakPos = 0;
  const peaks: HistPeak[] = [];
  const slopeAt = (a: number, b: number) => {
    if (b <= a) return 0;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const m = b - a + 1;
    for (let j = a; j <= b; j++) { sx += j; sy += y[j]; sxx += j * j; sxy += j * y[j]; }
    const den = m * sxx - sx * sx;
    return den === 0 ? 0 : (m * sxy - sx * sy) / den;
  };
  try {
    while (!done && peaks.length < maxPeaks) {
      let peakVal = 0;
      for (let i = 0; i < n; i++) if (y[i] > peakVal) { peakVal = y[i]; peakPos = i; }
      if (peakVal === 0) break;
      const half = peakVal / 2;
      const edge = [peakPos, peakPos], outer = [peakPos, peakPos];
      for (const side of [0, 1]) {
        const step = side === 0 ? -1 : 1;
        let h = 0, stop = false, set = false, i = peakPos;
        while (i >= 0 && i < n && !stop) {
          let w = Math.trunc(Math.min(n / 8, Math.max(n / 32, h)));
          w = Math.min(w, 2 * Math.abs(i - peakPos));
          const a = Math.max(0, i - Math.trunc(w / 2)), b = Math.min(n - 1, i + Math.trunc(w / 2));
          const slope = slopeAt(a, b);
          const rising = side === 0 ? slope < 0 : slope > 0;
          const dist = Math.abs(i - peakPos);
          if (h > 0 && !set) {
            const thr = (Math.abs(peakVal - y[i]) / half) * h;
            if (y[i] === 0) { edge[side] = i; set = true; stop = true; }
            else if (dist > 1.5 * thr) { edge[side] = i; set = true; }
            else if (dist > thr && rising) { edge[side] = i; set = true; stop = true; }
          } else if (h > 0) {
            if (y[i] === 0 || rising) stop = true;
          } else if (y[i] < half) {
            const prev = i > 0 ? y[i - 1] : 0;
            const hh = dist - (half - y[i]) / (prev - half);
            h = hh > 0 && Number.isFinite(hh) ? hh : 0;
          }
          i += step;
        }
        outer[side] = Math.min(n - 1, Math.max(0, i));
        if (!set) edge[side] = outer[side] = side === 0 ? 0 : n - 1;
      }
      let count = 0;
      for (let j = edge[0]; j < edge[1]; j++) count += Math.trunc(y[j]);
      const halfCount = Math.floor(count / 2);
      let acc = 0, j = edge[0];
      while (j <= edge[1] && acc < halfCount) { acc += y[j]; j++; }
      const position = j === 0 ? 0 : j - (acc - halfCount) / y[j - 1];
      for (let k = outer[0]; k <= outer[1]; k++) { removed += y[k]; y[k] = 0; }
      const minCount = Math.min(100, N / 100);
      const heightThr = sumHeights / nCounted / 10;
      if (!acceptAll && (count < minCount || peakVal < heightThr)) {
        done = removed / N > 0.95;
        continue;
      }
      peaks.push({ count, position, height: peakVal, min: edge[0], max: edge[1] });
      if (position > 2 && position <= n - 2) { sumHeights += peakVal; nCounted++; }
    }
  } catch {
    // FlowJo ends the search silently, keeping the peaks found so far.
  }
  return peaks.map((p, k) => ({ p, k })).sort((a, b) => a.p.position - b.p.position || a.k - b.k).map((x) => x.p);
}
// The two largest peaks (makeBimodal) and the first lowest channel between
// their positions (both inclusive); -1 when fewer than two peaks ("Unimodal").
export function bifurValley(y: Float64Array): number {
  const peaks = findPeaks(y);
  while (peaks.length > 2) {
    let k = 0;
    for (let i = 1; i < peaks.length; i++) if (peaks[i].count < peaks[k].count) k = i;
    peaks.splice(k, 1);
  }
  if (peaks.length < 2) return -1;
  let best = 1e11, at = -1;
  for (let i = Math.trunc(peaks[0].position); i <= Math.trunc(peaks[1].position); i++) if (y[i] < best) { best = y[i]; at = i; }
  return at;
}

// ---------------------------------------------------------------------------
// Percent gates (ManualGateDP, Transform.percentileToScale,
// SmoothedFunction.channelPercentile). p is the stored percent: 100 or more
// gives the top channel, 0 or less channel 0, 1 or more is divided by 100 and
// a value in (0, 1) is read as a fraction (as FlowJo does). Buckets are summed
// in order, the running total cut to a whole number, until it reaches p x
// count; the result is that bucket (0 for the first, max - 1 at the top).
export function channelPercentile(y: Float64Array, p: number): number {
  const n = y.length;
  let count = 0;
  for (let i = 0; i < n; i++) count += y[i];
  if (count === 0 || p <= 0) return 0;
  if (p >= 100) return n;
  const f = p >= 1 ? p / 100 : p;
  const target = f * count;
  let total = 0, c = 0, last = 0;
  for (let i = 0; i < n; i++) {
    total = Math.trunc(total + y[i]);
    c = i;
    if (total >= target) break;
    if (y[i] > 0) last = i;
  }
  if (c === 0) return 0;
  if (c >= n - 1) return n - 1;
  const prev = y[c - 1];
  return prev === 0 ? c : c - ((total - target) / prev) * (c - 1 - last);
}
// Scale value of a percent bound from the parent's values on one dimension:
// x axes use a 4096-bucket histogram, y axes of a rectangle 256 buckets
// (RectGate quirk); the channel is scaled to 4096 and converted to scale.
export function percentBound(values: Float64Array, scale: ChannelScale, p: number, buckets: number): number {
  const counts = new Float64Array(buckets);
  const k = BIFUR_BINS / buckets;
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) counts[Math.trunc(channelOf(scale, values[i]) / k)]++;
  const ch = channelPercentile(smoothHistogram1D(counts), p) * Math.trunc(BIFUR_BINS / buckets);
  return valueOf(scale, Math.min(BIFUR_BINS - 1, ch));
}
