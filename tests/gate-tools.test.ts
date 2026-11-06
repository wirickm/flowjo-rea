// FlowJo 10.6.2 gate tools (specs section 10): CurlyQuadGate outline, FigPoly
// pencil rule and reduce, Gate.convert, native QuadGate spider membership,
// FGate::MoveMagneticGate, auto gate contour engine (GHistogram2D).
import { describe, expect, it } from 'vitest';
import {
  autoGateContours, boundsSnapped, contourPolygons, contourThresholds, curlyQuadFramePolygons, freehandCommit, freehandPath,
  magneticOffset1D, magneticOffset2D, nearestContour, rectToPolygon, reduceFig, reducePoints, smoothHistogram, smoothingKernel,
  spiderLabelGrid, quadNames, firstQuadNumber, gateLabel, bisectorNames, convertGate, spiderPolygons, BIFUR_BINS, bifurValley, findPeaks, smoothHistogram1D, channelPercentile,
} from '../src/core/gateTools';
import { copyPopulations, pastePopulations } from '../src/core/project';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';
import { AnalysisService } from '../src/core/service';
import { writeFcs } from '../src/core/fcsWriter';
import { emptyWorkspace, type Dimension, type Gate, type Population, type SampleState } from '../src/core/model';

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

describe('names (quad, bisector)', () => {
  it('quads: "Q<n>: <x>+/- , <y>+/-" with UL = Q b, UR = Q b+1, LR = Q b+2, LL = Q b+3; b skips used numbers', () => {
    expect(quadNames(1, 'CD3', 'CD4')).toEqual(['Q1: CD3- , CD4+', 'Q2: CD3+ , CD4+', 'Q4: CD3- , CD4-', 'Q3: CD3+ , CD4-']);
    expect(firstQuadNumber([])).toBe(1);
    expect(firstQuadNumber(['Q1: a', 'Q4: b'])).toBe(5);
    expect(firstQuadNumber(['Q10 x'])).toBe(2); // "Q10" also counts as "Q1"
  });
  it('labels use the stain when present; bisector "<label>-" / "<label>+", clash -> "<param>::<label>+"', () => {
    expect(gateLabel('FL1-A', 'CD3')).toBe('CD3');
    expect(gateLabel('FL1-A', ' ')).toBe('FL1-A');
    expect(bisectorNames('CD3', 'FL1-A', [])).toEqual(['CD3-', 'CD3+']);
    expect(bisectorNames('CD3', 'FL1-A', ['CD3+'])).toEqual(['CD3-', 'FL1-A::CD3+']);
  });
});

describe('convert (Gate.convert)', () => {
  const lin = { kind: 'linear' as const, T: 1000, A: 0 };
  const dims: [Dimension, Dimension] = [{ kind: 'channel', channel: 'X', transform: lin }, { kind: 'channel', channel: 'Y', transform: lin }];
  it('polygon to rect snaps the bounding box outward to whole data units', () => {
    const r = convertGate({ type: 'polygon', dims, vertices: [[0.1004, 0.2], [0.3, 0.4006], [0.2, 0.1]] }, 'rect') as Extract<Gate, { type: 'rect' }>;
    expect(r.min.map((v) => Math.round(v! * 1000))).toEqual([100, 100]);
    expect(r.max.map((v) => Math.round(v! * 1000))).toEqual([300, 401]);
  });
  it('rect to ellipse: a circle in frame pixels through the four corners', () => {
    const e = convertGate({ type: 'rect', dims, min: [0.25, 0.25], max: [0.75, 0.75] }, 'ellipse') as Extract<Gate, { type: 'ellipsoid' }>;
    const d2 = (x: number, y: number) => {
      const [[a, b], [, c]] = e.cov; const det = a * c - b * b; const dx = x - e.mean[0], dy = y - e.mean[1];
      return (c * dx * dx - 2 * b * dx * dy + a * dy * dy) / det;
    };
    expect(d2(0.75, 0.75)).toBeCloseTo(e.distanceSquare, 9);
    expect(d2(0.25, 0.75)).toBeCloseTo(e.distanceSquare, 9);
  });
  it('ellipse to polygon: 180-vertex frame outline reduced to 20 vertices; rect to polygon corner order', () => {
    const e = convertGate({ type: 'rect', dims, min: [0.25, 0.25], max: [0.75, 0.75] }, 'ellipse')!;
    const p = convertGate(e, 'polygon') as Extract<Gate, { type: 'polygon' }>;
    expect(p.vertices.length).toBeGreaterThanOrEqual(18);
    expect(p.vertices.length).toBeLessThanOrEqual(21);
    expect((convertGate({ type: 'rect', dims, min: [0.1, 0.2], max: [0.3, 0.4] }, 'polygon') as Extract<Gate, { type: 'polygon' }>).vertices).toEqual([[0.1, 0.2], [0.1, 0.4], [0.3, 0.4], [0.3, 0.2]]);
  });
});

describe('copy and paste (WSClipboard)', () => {
  const lin = { kind: 'linear' as const, T: 1024, A: 0 };
  const X: Dimension = { kind: 'channel', channel: 'X', transform: lin };
  const Y: Dimension = { kind: 'channel', channel: 'Y', transform: lin };
  const q = (id: string, side: number[]): Population => ({ id, name: id, parentId: null, gate: { type: 'quadrant', dims: [X, Y], dividers: [[0.5], [0.5]], side } });
  const sample = (): SampleState => ({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', keywordsSnapshot: {}, channelNames: ['X', 'Y'], eventCount: 0, populations: [q('a', [0, 0]), q('b', [1, 0]), q('c', [0, 1]), q('d', [1, 1]), { id: 'r', name: 'R', parentId: null, gate: { type: 'rect', dims: [X], min: [0.1], max: [0.2] } }] });
  it('copying one quad copies its siblings; paste under a target keeps coordinates', () => {
    const s = sample();
    const clip = copyPopulations(s.populations, ['a']);
    expect(clip.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(pastePopulations(s, clip, ['r'])).toEqual([]);
    expect(s.populations.filter((p) => p.parentId === 'r').map((p) => p.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('a name clash skips the target; missing parameters skip the sample', () => {
    const s = sample();
    const clip = copyPopulations(s.populations, ['r']);
    expect(pastePopulations(s, clip, [null])[0]).toMatch(/already exists/);
    const other = { ...sample(), channelNames: ['Z'] };
    expect(pastePopulations(other, clip, [null])[0]).toMatch(/lacks/);
  });
});

describe('anchored range (TetheredRangeGate) and .wsp round trip', () => {
  it('bound = statistic of the named population on this sample x multiplier', async () => {
    const xs = Float64Array.from({ length: 100 }, (_, i) => i * 10);
    const svc = new AnalysisService();
    await svc.load('s', 's.fcs', writeFcs([{ name: 'X', range: 1024, values: xs }], {}));
    const X: Dimension = { kind: 'channel', channel: 'X', transform: { kind: 'linear', T: 1024, A: 0 } };
    const pops: Population[] = [{ id: 'a', name: 'A', parentId: null, gate: { type: 'anchored', dims: [X], min: { populationPath: '', stat: 'count', multiplier: 5 }, max: null } }];
    const { results } = svc.analyze({ sampleId: 's', compensation: 'none', populations: pops, matrices: [] });
    // count 100 x 5 = 500 -> events 500..990 (50 events).
    expect(results[0].count).toBe(50);
    expect(results[0].moved?.type).toBe('rect');
  });
  it('curly quad, spider and magnetic survive .wsp export and import', () => {
    const ws = emptyWorkspace();
    const lin = { kind: 'linear' as const, T: 262144, A: 0 };
    const dims: [Dimension, Dimension] = [{ kind: 'channel', channel: 'FSC-A', transform: lin }, { kind: 'channel', channel: 'SSC-A', transform: lin }];
    const polygons = spiderPolygons({ center: [0.5, 0.5], top: 0.55, bottom: 0.45, left: 0.5, right: 0.6, x0: -0.001, x1: 1, y0: -0.001, y1: 1.001 });
    ws.samples.push({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', keywordsSnapshot: {}, channelNames: ['FSC-A', 'SSC-A'], eventCount: 1, populations: [
      ...[0, 1, 2, 3].map((q): Population => ({ id: `c${q}`, name: `C${q}`, parentId: null, gate: { type: 'curlyQuad', dims, center: [0.4, 0.3], quadrant: q, frame: [[0, 1], [0, 1]] } })),
      ...[0, 1, 2, 3].map((slot): Population => ({ id: `s${slot}`, name: `S${slot}`, parentId: null, gate: { type: 'spider', dims, polygons, slot } })),
      { id: 'm', name: 'M', parentId: null, magnetic: true, gate: { type: 'polygon', dims, vertices: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]] } },
    ] });
    ws.groups[0].sampleIds = ['s'];
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    expect(xml).toContain('<gating:CurlyQuad');
    expect(xml).toContain('quadId="2"');
    expect(xml).toContain('magnetic="1"');
    const back = parseWsp(xml).workspace.samples[0].populations;
    const curly = back.filter((p) => p.gate.type === 'curlyQuad').map((p) => (p.gate as Extract<Gate, { type: 'curlyQuad' }>).quadrant);
    expect(curly).toEqual([0, 1, 2, 3]);
    const spider = back.filter((p) => p.gate.type === 'spider').map((p) => (p.gate as Extract<Gate, { type: 'spider' }>).slot);
    expect(spider).toEqual([0, 1, 2, 3]);
    expect(back.find((p) => p.name === 'M')?.magnetic).toBe(true);
  });
});

describe('BifurGate (PeakFinder, smoothed 4096-channel histogram)', () => {
  const gaussHist = (centres: [number, number, number][]) => {
    const h = new Float64Array(BIFUR_BINS);
    for (const [c, sd, n] of centres) for (let i = 0; i < BIFUR_BINS; i++) h[i] += Math.round((n / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((i - c) / sd) ** 2));
    return h;
  };
  it('1-D smoothing keeps whole counts and folds the left margin back', () => {
    const h = new Float64Array(64);
    h[0] = 100; h[30] = 1;
    const s = smoothHistogram1D(h);
    expect(s.every((v) => Number.isInteger(v))).toBe(true);
    expect(s.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(99);
    expect(s[0]).toBeGreaterThan(s[3]);
  });
  it('right margin: the first two padding bins are lost', () => {
    const h = new Float64Array(64);
    h[63] = 1; // s = 13: mass at offsets +1 and +2 past the end is dropped
    const raw = smoothHistogram1D(h);
    expect(raw.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
  });
  it('finds both peaks of a bimodal histogram, positions near the centres, sorted', () => {
    const y = smoothHistogram1D(gaussHist([[1000, 80, 20000], [3000, 120, 30000]]));
    const peaks = findPeaks(y);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    const big = [...peaks].sort((a, b) => b.count - a.count).slice(0, 2).map((p) => p.position).sort((a, b) => a - b);
    expect(Math.abs(big[0] - 1000)).toBeLessThan(20);
    expect(Math.abs(big[1] - 3000)).toBeLessThan(20);
  });
  it('valley = the first lowest channel between the two largest peaks; unimodal gives -1', () => {
    const y = smoothHistogram1D(gaussHist([[1000, 80, 20000], [3000, 120, 30000]]));
    const v = bifurValley(y);
    const between = Array.from(y.slice(1000, 3001));
    // Empty channels between well-separated peaks: the first one wins.
    expect(v).toBe(1000 + between.indexOf(Math.min(...between)));
    expect(bifurValley(smoothHistogram1D(gaussHist([[2000, 100, 20000]])))).toBe(-1);
  });
});

describe('percent gates (channelPercentile, evaluatePercentGate)', () => {
  it('channelPercentile: special cases and the bucket reaching p x count', () => {
    const y = Float64Array.from([0, 10, 10, 10, 10, 0, 0, 0]);
    expect(channelPercentile(y, 0)).toBe(0);
    expect(channelPercentile(y, 100)).toBe(8);
    expect(channelPercentile(y, 50)).toBe(2);
    expect(channelPercentile(y, 0.5)).toBe(2); // a value below 1 is a fraction (FlowJo quirk)
    expect(channelPercentile(new Float64Array(8), 50)).toBe(0);
  });
  it('a percent range is recomputed from each sample\'s parent', async () => {
    const lin = { kind: 'linear' as const, T: 1024, A: 0 };
    const X: Dimension = { kind: 'channel', channel: 'X', transform: lin };
    const gate: Gate = { type: 'rect', dims: [X], min: [0], max: [1], percent: { min: [25], max: [75], scales: [{ kind: 'linear', min: 0, max: 1024 }] } };
    const counts = [] as number[];
    for (const scale of [1, 0.5]) {
      const svc = new AnalysisService();
      // Dense enough that the smoothed histogram (whole counts) is not empty.
      await svc.load('s', 's.fcs', writeFcs([{ name: 'X', range: 1024, values: Float64Array.from({ length: 100000 }, (_, i) => (i / 100) * scale) }], {}));
      counts.push(svc.analyze({ sampleId: 's', compensation: 'none', populations: [{ id: 'a', name: 'A', parentId: null, gate }], matrices: [] }).results[0].count);
    }
    // About half the events on either sample, though the values differ by 2x.
    for (const c of counts) { expect(c).toBeGreaterThan(48000); expect(c).toBeLessThan(52000); }
  });
});
