// Compensation Matrix Editor rules (docs/validation/ui-gaps/compensation.md):
// FlowJo 10.6.2 MatrixController / ComparisonMatrix / MatrixNxNPanel /
// EditorZoom / CompAnimationBatch / SpectralWeightsDialog behaviour.
import { describe, expect, it } from 'vitest';
import { invert, unmixingOperator, type SpilloverMatrix } from '../src/core/compensation';
import {
  animationScales, compareMatrices, compensateEvents, copyName, duplicateMatrix, fitZoom, fromDisplay, gridCells, identityMatrix, parseWeightsCsv,
  removeUnusedParameters, scaleSpillover, ssmWithSums, toDisplay, uniqueName, weightsCsv, zoomIn, zoomOut, ZOOM_STEPS,
} from '../src/core/compEditor';
import { AnalysisService } from '../src/core/service';
import { writeFcs } from '../src/core/fcsWriter';

const sq = (name: string, channels: string[], values: number[][]): SpilloverMatrix => ({ id: name, name, channels, values, source: 'test' });

describe('matrix names (NameUtil)', () => {
  it('uniqueName appends -1, -2 and strips a short numeric suffix', () => {
    expect(uniqueName('New Matrix', [])).toBe('New Matrix');
    expect(uniqueName('New Matrix', ['New Matrix'])).toBe('New Matrix-1');
    expect(uniqueName('New Matrix', ['New Matrix', 'New Matrix-1'])).toBe('New Matrix-2');
    expect(uniqueName('New Matrix-1', ['New Matrix-1'])).toBe('New Matrix-2');
  });
  it('copyName adds -copy once', () => {
    expect(copyName('Wizard', ['Wizard'])).toBe('Wizard-copy');
    expect(copyName('Wizard', ['Wizard', 'Wizard-copy'])).toBe('Wizard-copy-1');
    expect(copyName('Wizard-copy', ['Wizard-copy'])).toBe('Wizard-copy-1');
  });
  it('identity and duplicate matrices', () => {
    const id = identityMatrix(['A', 'B'], ['New Matrix']);
    expect(id.name).toBe('New Matrix-1');
    expect(id.values).toEqual([[1, 0], [0, 1]]);
    const m = { ...sq('M', ['A', 'B'], [[1, 0.2], [0.1, 1]]), ssm: { channels: ['A', 'B'], values: [[0, 1], [2, 0]] } };
    const d = duplicateMatrix(m, ['M']);
    expect(d.name).toBe('M-copy');
    expect(d.id).not.toBe(m.id);
    expect(d.values).toEqual(m.values);
    expect(d.values).not.toBe(m.values);
    expect(d.ssm).toEqual(m.ssm);
    expect(() => identityMatrix([], [])).toThrow();
  });
});

describe('compare matrices (ComparisonMatrix)', () => {
  const a = sq('a', ['X', 'Y'], [[1, 0.1], [0.2, 1]]);
  const b = sq('b', ['Y', 'X'], [[1, 0.25], [0.15, 1]]); // other channel order
  const c = sq('c', ['X', 'Y'], [[1, 0.4], [0.2, 1]]);
  it('two matrices give second minus first, by channel name', () => {
    const r = compareMatrices([a, b]);
    expect(r.method).toBe('Difference');
    expect(r.matrix!.values).toEqual([[0, 0.05], [0.05, 0]]);
  });
  it('three or more give the population standard deviation', () => {
    const r = compareMatrices([a, b, c]);
    expect(r.method).toBe('Standard Deviation');
    const xs = [0.1, 0.15, 0.4], mean = (0.1 + 0.15 + 0.4) / 3;
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / 3);
    expect(r.matrix!.values[0][1]).toBeCloseTo(sd, 8);
  });
  it('missing channels and too few matrices are errors', () => {
    expect(compareMatrices([a]).error).toMatch(/at least 2/);
    expect(compareMatrices([a, sq('z', ['X'], [[1]])]).error).toBe('1 channels from the first matrix are not present in the others');
  });
});

describe('plot grid and zoom (MatrixNxNPanel, EditorZoom)', () => {
  it('N x N is the upper triangle with x = later channel', () => {
    expect(gridCells({ kind: 'nxn' }, ['A', 'B', 'C'])).toEqual([
      { row: 0, col: 1, x: 'B', y: 'A' }, { row: 0, col: 2, x: 'C', y: 'A' }, { row: 1, col: 2, x: 'C', y: 'B' },
    ]);
    expect(gridCells({ kind: 'allby', channel: 'B' }, ['A', 'B', 'C']).map((c) => [c.x, c.y])).toEqual([['A', 'B'], ['C', 'B']]);
    expect(gridCells({ kind: 'histos' }, ['A', 'B']).map((c) => [c.x, c.y])).toEqual([['A', null], ['B', null]]);
  });
  it('zoom steps and fit', () => {
    expect(ZOOM_STEPS).toEqual([12, 25, 33, 50, 66, 75, 100, 150, 200, 400]);
    expect(zoomIn(50)).toBe(66);
    expect(zoomOut(50)).toBe(33);
    expect(zoomIn(400)).toBe(400);
    expect(zoomOut(12)).toBe(12);
    expect(zoomIn(70)).toBe(75); // from the closest step, 66
    expect(fitZoom(520, 4)).toBe(50);
  });
});

describe('preview compensation', () => {
  it('compensates events with the edited matrix', () => {
    const m = sq('m', ['A', 'B'], [[1, 0.2], [0.1, 1]]);
    // true signals a=1000, b=500 -> raw a + 0.1 b, 0.2 a + b
    const raw = { A: Float32Array.of(1000 + 50), B: Float32Array.of(200 + 500) };
    const out = compensateEvents(raw, m);
    expect(out.A[0]).toBeCloseTo(1000, 2);
    expect(out.B[0]).toBeCloseTo(500, 2);
    expect(() => compensateEvents({ A: raw.A }, m)).toThrow(/lacks: B/);
    expect(invert(m.values)).toBeTruthy();
  });
  it('spectral output is keyed by fluorochrome', () => {
    const m: SpilloverMatrix = { id: 's', name: 's', channels: ['D1', 'D2', 'D3'], outputNames: ['F1'], values: [[1, 0.5, 0.25]], source: 't', kind: 'spectral' };
    const out = compensateEvents({ D1: Float32Array.of(2), D2: Float32Array.of(1), D3: Float32Array.of(0.5) }, m);
    expect(out.F1[0]).toBeCloseTo(2, 5);
  });
  it('animation scales: 0.1% growing by log10(1000/15) below 1, then 1, 2, 4', () => {
    const s = animationScales();
    const f = Math.log10(1000 / 15);
    expect(s[0]).toBe(0.001);
    expect(s[1]).toBeCloseTo(0.001 * f, 12);
    expect(s.slice(-3)).toEqual([1, 2, 4]);
    expect(s.filter((x) => x < 1).every((x) => x < 1)).toBe(true);
    expect(s.length).toBe(15);
    const m = sq('m', ['A', 'B'], [[1, 0.2], [0.1, 1]]);
    expect(scaleSpillover(m, 2).values).toEqual([[1, 0.4], [0.2, 1]]);
    expect(scaleSpillover(m, 1)).toBe(m);
  });
  it('percent display round-trips', () => {
    expect(toDisplay(0.07, true)).toBe(7);
    expect(fromDisplay(7, true)).toBeCloseTo(0.07, 12);
    expect(toDisplay(0.07, false)).toBe(0.07);
  });
});

describe('spectral weights (SpectralWeightsDialog)', () => {
  const det = ['D1', 'D2', 'D3'];
  it('export and import round-trip, row and column layouts', () => {
    const csv = weightsCsv(det, [1, 2, 0.5]);
    expect(csv).toBe('Detector Name,Weights\r\nD1,1\r\nD2,2\r\nD3,0.5\r\n');
    expect(parseWeightsCsv(csv, det)).toEqual([1, 2, 0.5]);
    expect(parseWeightsCsv('D3,D1,D2\n3,1,2\n', det)).toEqual([1, 2, 3]);
    expect(() => parseWeightsCsv('X,1\nY,2\n', det)).toThrow(/Detector Names/);
    expect(() => parseWeightsCsv('garbage\n', det)).toThrow(/not Valid/);
  });
  it('weights give weighted least squares; all 1 is OLS', () => {
    const base: SpilloverMatrix = { id: 's', name: 's', channels: det, outputNames: ['F1'], values: [[1, 1, 1]], source: 't', kind: 'spectral' };
    const ols = unmixingOperator(base);
    expect(unmixingOperator({ ...base, weights: [1, 1, 1] })).toEqual(ols);
    // One fluor, weights w: f = sum w_d x_d s_d / sum w_d s_d^2.
    const M = unmixingOperator({ ...base, weights: [2, 1, 1] });
    expect(M.map((r) => r[0])).toEqual([0.5, 0.25, 0.25]);
  });
});

describe('wizard parameters and SSM sums', () => {
  it('remove unused parameters keeps assigned ones', () => {
    expect(removeUnusedParameters(['A', 'B', 'C'], ['C', 'A'])).toEqual(['A', 'C']);
  });
  it('SSM Sum row and column', () => {
    const t = ssmWithSums([[0, 1], [2, 3]]);
    expect(t.rows).toEqual([[0, 1, 1], [2, 3, 5]]);
    expect(t.colSums).toEqual([2, 4]);
    expect(t.total).toBe(6);
  });
});

describe('compPreview service', () => {
  it('returns raw subsampled values of the population and lists missing channels', async () => {
    const n = 1000;
    const a = Float64Array.from({ length: n }, (_, i) => i);
    const svc = new AnalysisService();
    await svc.load('s', 's.fcs', writeFcs([{ name: 'A', range: 262144, values: a }, { name: 'B', range: 262144, values: a.map((v) => 2 * v) }]));
    const pops = [{ id: 'p', name: 'hi', parentId: null, gate: { type: 'rect' as const, dims: [{ kind: 'channel' as const, channel: 'A', transform: { kind: 'none' as const } }], min: [500], max: [2000] } }];
    const r = svc.compPreview({ sampleId: 's', compensation: 'none', populations: pops as never, matrices: [], popId: 'p', channels: ['A', 'B', 'C'], maxEvents: 100 });
    expect(r.count).toBe(500);
    expect(r.missing).toEqual(['C']);
    expect(r.raw.A.length).toBe(100);
    expect(r.raw.A[0]).toBe(500);
    expect(r.raw.B[1]).toBe(2 * r.raw.A[1]);
  });
});
