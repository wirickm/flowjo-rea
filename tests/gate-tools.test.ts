// FlowJo 10.6.2 gate tools (specs section 10): CurlyQuadGate outline, FigPoly
// pencil rule and reduce, Gate.convert, native QuadGate spider membership,
// FGate::MoveMagneticGate, auto gate contour engine (GHistogram2D).
import { describe, expect, it } from 'vitest';
import {
  autoGateContours, boundsSnapped, contourPolygons, contourThresholds, curlyQuadFramePolygons, freehandCommit, freehandPath,
  magneticOffset1D, magneticOffset2D, nearestContour, rectToPolygon, reduceFig, reducePoints, smoothHistogram, smoothingKernel,
  spiderLabelGrid,
} from '../src/core/gateTools';
import { AnalysisService } from '../src/core/service';
import { writeFcs } from '../src/core/fcsWriter';
import type { Dimension, Population } from '../src/core/model';

type Pt = [number, number];

describe('curly quad outline (256-pixel frame, k = 0.001)', () => {
  const [ul, ur, ll, lr] = curlyQuadFramePolygons(128, 128);
  it('horizontal arm: x = cx + 1 in steps of (W - cx) div 40, y = cy - round(k dx^2), ends at the frame edge', () => {
    expect(lr.slice(0, 4)).toEqual([[128, 128], [129, 128], [132, 128], [135, 128]]);
    const atEdge = lr.find((p) => p[0] === 256)!;
    expect(atEdge[1]).toBe(128 - Math.floor(0.001 * 126 * 126 + 0.5));
    expect(lr.slice(-2)).toEqual([[256, 256], [128, 256]]);
  });
  it('vertical arm bends right going up; the centre appears twice', () => {
    expect(ul.slice(0, 3)).toEqual([[128, 128], [128, 128], [128, 125]]);
    expect(ul.slice(-2)).toEqual([[0, 0], [0, 128]]);
    const top = ul[ul.length - 3];
    expect(top[1]).toBe(0);
    expect(top[0]).toBe(128 + Math.floor(0.001 * 128 * 128 + 0.5));
  });
  it('lower-left is a plain rectangle; upper-right closes with the horizontal arm reversed', () => {
    expect(ll).toEqual([[0, 128], [128, 128], [128, 256], [0, 256]]);
    expect(ur[ur.length - 1]).toEqual([128, 128]);
  });
});

describe('pencil (FigPoly.processFreehandDrag)', () => {
  it('commits only beyond 12 px, and only on a bend or a long run', () => {
    expect(freehandCommit([[0, 0]], [12, 0])).toBe(false);
    expect(freehandCommit([[0, 0]], [13, 0])).toBe(true);
    // Straight continuation: bend = 1, d / bend = 13 > 12 -> commit.
    expect(freehandCommit([[0, 0], [20, 0]], [33, 0])).toBe(true);
    // A sharp turn of 13 px commits (bend > 1.04).
    expect(freehandCommit([[0, 0], [20, 0]], [20, 13])).toBe(true);
  });
  it('a path through closely spaced points keeps about one vertex per 12 px', () => {
    const pts: Pt[] = Array.from({ length: 101 }, (_, i) => [i, 0]);
    const out = freehandPath(pts);
    expect(out[0]).toEqual([0, 0]);
    expect(out[1]).toEqual([13, 0]);
    expect(out[out.length - 1]).toEqual([100, 0]);
  });
});

describe('reduce and convert', () => {
  it('FigPoly.reduce keeps every (n div max(20, trunc(0.1 n)))-th vertex', () => {
    expect(reduceFig(Array.from({ length: 100 }, (_, i) => i))).toHaveLength(20);
    expect(reduceFig(Array.from({ length: 450 }, (_, i) => i))).toHaveLength(45);
    expect(reduceFig(Array.from({ length: 9 }, (_, i) => i))).toHaveLength(9);
  });
  it('reducePoints(20) keeps indices divisible by trunc(n / 20)', () => {
    expect(reducePoints(Array.from({ length: 180 }, (_, i) => i), 20)).toHaveLength(20);
  });
  it('rect to polygon corner order; polygon to rect snaps outward to whole units', () => {
    expect(rectToPolygon(1, 2, 3, 4)).toEqual([[1, 2], [1, 4], [3, 4], [3, 2]]);
    expect(boundsSnapped([[1.5, 2.2], [3.1, 0.9]])).toEqual({ min: [1, 0], max: [4, 3] });
  });
});

describe('spider quad (QuadGate kind 11)', () => {
  // Four polygons around a centre (4,5) on a 10 x 10 lattice.
  const c: Pt = [4, 5];
  const ul: Pt[] = [[0, 9], [0, 5], c, [4, 9]];
  const ur: Pt[] = [[4, 9], c, [9, 5], [9, 9]];
  const ll: Pt[] = [[0, 0], [4, 0], c, [0, 5]];
  const lr: Pt[] = [[9, 0], [9, 5], c, [4, 0]];
  it('shared edges go to the lowest slot; uncovered points to slot 0', () => {
    const g = spiderLabelGrid(10, [ul, ur, ll, lr]);
    expect(g[4 * 10 + 5]).toBe(0); // centre: in all four, upper-left wins
    expect(g[6 * 10 + 5]).toBe(1); // on the UR/LR edge: UR wins
    expect(g[6 * 10 + 2]).toBe(3);
    expect(g[2 * 10 + 2]).toBe(2);
  });
});

describe('magnetic gate (FGate::MoveMagneticGate)', () => {
  it('2-D: the gate walks one cell at a time to the data and stops on a revisit', () => {
    const B = 256;
    const h = new Float64Array(B * B);
    for (let x = 60; x <= 70; x++) for (let y = 100; y <= 110; y++) h[x * B + y] = 10;
    const square: Pt[] = [[40, 90], [40, 120], [52, 120], [52, 90]];
    const [dx, dy] = magneticOffset2D(h, square);
    // Gate centre x 46 moves to the data centre x 65 (the cloud is wider
    // than the gate, so it settles where the gate is fully on data).
    expect(dx).toBeGreaterThanOrEqual(13);
    expect(dx).toBeLessThanOrEqual(25);
    expect(Math.abs(dy)).toBeLessThanOrEqual(6);
  });
  it('1-D: shifts toward the mean while the count keeps increasing', () => {
    const h = new Float64Array(256);
    for (let i = 100; i < 120; i++) h[i] = 5;
    // [90, 104] -> [100, 114] is fully on data; further shifts do not increase the count.
    expect(magneticOffset1D(h, 90, 105)).toBe(10);
    expect(magneticOffset1D(new Float64Array(256), 10, 20)).toBe(0);
  });
});

describe('auto gate contours (GHistogram2D)', () => {
  it('smoothing kernel: s = ceil(13 n^-1/4), product kernel sums to 1', () => {
    const w = smoothingKernel(1);
    expect(w).toHaveLength(14);
    const s = w[0] + 2 * w.slice(1).reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1, 12);
    expect(smoothingKernel(16)).toHaveLength(Math.ceil(13 / 2) + 1);
  });
  it('smoothing keeps the mass (edges folded back by mirroring)', () => {
    const B = 32;
    const h = new Float64Array(B * B);
    h[0] = 7; h[15 * B + 16] = 3;
    const d = smoothHistogram(h, B);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 9);
  });
  it('levels: one per N/50 of mass, densest first', () => {
    const d = Float64Array.from([10, 8, 6, 4, 2]);
    const t = contourThresholds(d, 30, 5);
    expect(t).toHaveLength(4);
    expect(t[0]).toBeGreaterThanOrEqual(t[t.length - 1]);
  });
  it('a dense blob gives nested closed polygons; the nearest-vertex polygon is chosen', () => {
    const B = 64;
    const h = new Float64Array(B * B);
    for (let x = 20; x < 30; x++) for (let y = 30; y < 40; y++) h[x * B + y] = 20;
    const polys = autoGateContours(h, 2000, B);
    expect(polys.length).toBeGreaterThan(3);
    const p = nearestContour(polys, [25, 35])!;
    const xs = p.map((q) => q[0]);
    expect(Math.min(...xs)).toBeGreaterThan(15);
    expect(Math.max(...xs)).toBeLessThan(35);
  });
  it('a region touching the frame is closed along the outermost bins', () => {
    const B = 8;
    const d = new Float64Array(B * B);
    for (let y = 0; y < B; y++) d[0 * B + y] = 5;
    const [poly] = contourPolygons(d, 1, B);
    expect(Math.min(...poly.map((q) => q[0]))).toBe(0);
    expect(Math.max(...poly.map((q) => q[1]))).toBe(B - 1);
  });
});

describe('analysis: curly quad and spider gates (PolyQuad label grid)', () => {
  it('curly quadrants partition the events: every event in exactly one quadrant', async () => {
    const n = 400;
    const xs = Float64Array.from({ length: n }, (_, i) => (i % 20) * 50);
    const ys = Float64Array.from({ length: n }, (_, i) => Math.floor(i / 20) * 50);
    const svc = new AnalysisService();
    await svc.load('s', 's.fcs', writeFcs([{ name: 'X', range: 1024, values: xs }, { name: 'Y', range: 1024, values: ys }], {}));
    const lin = { kind: 'linear' as const, T: 1024, A: 0 };
    const dims: [Dimension, Dimension] = [{ kind: 'channel', channel: 'X', transform: lin }, { kind: 'channel', channel: 'Y', transform: lin }];
    const pops: Population[] = [0, 1, 2, 3].map((q) => ({ id: `q${q}`, name: `Q${q}`, parentId: null, gate: { type: 'curlyQuad', dims, center: [0.5, 0.5], quadrant: q, frame: [[0, 1], [0, 1]] } }));
    const { results } = svc.analyze({ sampleId: 's', compensation: 'none', populations: pops, matrices: [] });
    const counts = results.map((x) => x.count);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(n);
    expect(counts.every((c) => c > 0)).toBe(true);
  });
});
