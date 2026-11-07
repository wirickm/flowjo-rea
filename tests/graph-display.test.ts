// Graph window display and transform-menu rules (docs/validation/ui-gaps/graph.md).
import { describe, expect, it } from 'vitest';
import { autoWidthBasis, canSetForeground, canShowOutliers, canSmooth, clusterRanges, colorRowsFromString, colorRowsToString, colorTable, DEFAULT_COLOR_ROWS, derivedFor, dotsFromInput, likeParameters, linLogSpec, peakRanges, resolutionOf, smoothCurve, smoothGrid, smoothingOf, specWithRange, yMaxFromInput } from '../src/core/graphDisplay';
import { findPeaks } from '../src/core/gateTools';
import { makeTransform } from '../src/core/transforms';

const gauss = (n: number, peaks: [number, number, number][]) => Float64Array.from({ length: n }, (_, i) => Math.round(peaks.reduce((s, [mu, sd, h]) => s + h * Math.exp(-0.5 * ((i - mu) / sd) ** 2), 0)));

describe('smoothing, outliers, foreground (GraphSpec / DisplayType)', () => {
  it('types smoothed by default get 13; pseudocolor and dot 0; contour always on', () => {
    expect(smoothingOf('pseudocolor', {})).toBe(0);
    expect(smoothingOf('density', {})).toBe(13);
    expect(smoothingOf('zebra', {})).toBe(13);
    expect(smoothingOf('histogram', {})).toBe(13);
    expect(smoothingOf('histogram', {}, false)).toBe(0);
    expect(smoothingOf('contour', { smoothing: 0 })).toBe(13);
    expect(smoothingOf('dot', { smoothing: 13 })).toBe(0);
    expect(smoothingOf('pseudocolor', { smoothing: 52 })).toBe(52);
    expect(canSmooth('dot') || canSmooth('contour')).toBe(false);
  });
  it('outliers: contour always, pseudocolor / density / zebra only while smoothed', () => {
    expect(canShowOutliers('contour', false)).toBe(true);
    expect(canShowOutliers('pseudocolor', false)).toBe(false);
    expect(canShowOutliers('pseudocolor', true)).toBe(true);
    expect(canShowOutliers('dot', true)).toBe(false);
    expect(canShowOutliers('histogram', true)).toBe(false);
  });
  it('foreground colour: histograms, dot plots and plots that can show outliers', () => {
    expect(canSetForeground('histogram', false)).toBe(true);
    expect(canSetForeground('dot', false)).toBe(true);
    expect(canSetForeground('pseudocolor', false)).toBe(false);
    expect(canSetForeground('pseudocolor', true)).toBe(true);
  });
  it('2-D smoothing keeps the event mass and is cached per grid', () => {
    const B = 32, g = new Float32Array(B * B);
    g[10 * B + 12] = 50; g[0] = 3;
    const s = smoothGrid(g, B);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(53, 6);
    expect(s[10 * B + 12]).toBeLessThan(50);
    expect(smoothGrid(g, B)).toBe(s);
    expect(smoothCurve(gauss(256, [[100, 5, 40]])).length).toBe(256);
  });
});

describe('resolution, dots, y range', () => {
  it('resolution list and own 1024 cap', () => {
    expect(resolutionOf({})).toBe(256);
    expect(resolutionOf({ resolution: 512 })).toBe(512);
    expect(resolutionOf({ resolution: 4096 })).toBe(1024);
    expect(resolutionOf({ resolution: 300 })).toBe(256);
  });
  it('# Dots: 0 becomes 100, clamped to 100000; Y max is a whole non-negative number', () => {
    expect(dotsFromInput(0)).toBe(100);
    expect(dotsFromInput(250000)).toBe(100000);
    expect(dotsFromInput(1234.7)).toBe(1234);
    expect(yMaxFromInput(-3)).toBe(0);
    expect(yMaxFromInput(512.9)).toBe(512);
  });
});

describe('gates on peaks and cluster gates (FlowCAPUtil)', () => {
  it('every peak becomes a range named <parameter>.Pop<k>', () => {
    const r = peakRanges(gauss(256, [[60, 6, 300], [180, 8, 200], [230, 2, 3]]), 'FL1-A');
    expect(r.map((x) => x.name)).toEqual(r.map((_, k) => `FL1-A.Pop${k}`));
    expect(r.length).toBe(3);
    expect(r[0].lo).toBeLessThan(60);
    expect(r[0].hi).toBeGreaterThan(60);
    expect(r[1].lo).toBeLessThan(180);
    expect(r[1].hi).toBeGreaterThan(180);
  });
  it('one peak keeps the parameter name; the default search drops the small peak', () => {
    expect(peakRanges(gauss(256, [[100, 6, 300]]), 'X').map((x) => x.name)).toEqual(['X']);
    const y = gauss(256, [[60, 6, 300], [180, 8, 200], [230, 2, 3]]);
    expect(findPeaks(y).length).toBe(2);
    expect(findPeaks(y, 100, true).length).toBe(3);
  });
  it('cluster ranges Pop1..Pop(top-1), top from $PnR when it is an integer', () => {
    expect(clusterRanges(5.2, undefined).map((r) => [r.name, r.min, r.max])).toEqual([['Pop1', 1, 2], ['Pop2', 2, 3], ['Pop3', 3, 4], ['Pop4', 4, 5], ['Pop5', 5, 6]]);
    expect(clusterRanges(1000, '4').map((r) => r.name)).toEqual(['Pop1', 'Pop2', 'Pop3']);
    expect(clusterRanges(3, 'abc').length).toBe(2);
  });
});

describe('transform menu', () => {
  it('Linear / Log Axis keep the parameter range; log minimum under 1e-4 becomes 1', () => {
    expect(linLogSpec(false, -100, 1000)).toEqual({ kind: 'linear', T: 1000, A: 100 });
    expect(linLogSpec(true, 0, 10000)).toEqual({ kind: 'log', T: 10000, M: 4 });
    expect(linLogSpec(true, 10, 10000)).toEqual({ kind: 'log', T: 10000, M: 3 });
  });
  it('Change Displayed Parameter Range sets the axis bottom and top', () => {
    expect(specWithRange({ kind: 'linear', T: 1000, A: 0 }, -200, 5000)).toEqual({ kind: 'linear', T: 5000, A: 200 });
    expect(specWithRange({ kind: 'linear', T: 1000, A: 0 }, 10, 5000)).toBeNull();
    expect(specWithRange({ kind: 'log', T: 1000, M: 3 }, 10, 100000)).toEqual({ kind: 'log', T: 100000, M: 4 });
    const s = specWithRange({ kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 }, -2000, 100000)!;
    const t = makeTransform(s);
    expect(t.inverse(0)).toBeCloseTo(-2000, 0);
    expect(t.inverse(1)).toBeCloseTo(100000, 3);
    expect(specWithRange({ kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 }, -1e9, 100000)).toBeNull();
  });
  it('like parameters: fluorescence, scatter or time', () => {
    const n = ['FSC-A', 'SSC-A', 'FL1-A', 'FL2-A', 'Time'];
    const fl = (x: string) => /^FL/.test(x), tm = (x: string) => x === 'Time';
    expect(likeParameters(n, 'FL1-A', fl, tm)).toEqual(['FL1-A', 'FL2-A']);
    expect(likeParameters(n, 'SSC-A', fl, tm)).toEqual(['FSC-A', 'SSC-A']);
    expect(likeParameters(n, 'Time', fl, tm)).toEqual(['Time']);
  });
  it('Calculate Width Basis: 5th percentile of the negative events', () => {
    const id = () => 0.5;
    expect(autoWidthBasis([1, 2, -3, 4], id, 4.5, 262144)).toBeCloseTo(-(10 ** 0.5), 4);
    const neg = Array.from({ length: 1000 }, (_, i) => (i < 49 ? -150 : -100));
    // 49 values at -150 then -100: the 50th (5%) lowest is -100.
    const w = autoWidthBasis([...neg, ...Array(5000).fill(500)], id, 4.5, 262144);
    expect(w).toBeCloseTo(-(10 ** Math.log10((100 * 10 ** 4.5) / 262144)), 3);
    // 11..99 negatives: the 5th most negative.
    const few = [-500, -400, -300, -200, -100, -90, -80, -70, -60, -50, -40, -30];
    expect(autoWidthBasis(few, id, 4.5, 262144)).toBeCloseTo(-((100 * 10 ** 4.5) / 262144), 3);
    // clamped at 0..5
    expect(autoWidthBasis(Array(200).fill(-1e9), id, 4.5, 262144)).toBeCloseTo(-1e5, 0);
    // events in the lowest 3 of 4096 channels are dropped
    expect(autoWidthBasis(Array(200).fill(-100), () => 0, 4.5, 262144)).toBeCloseTo(-(10 ** 0.5), 4);
  });
  it('derived linear / log parameters', () => {
    expect(derivedFor('FJComp-PE-A', false, [])).toEqual({ name: 'FJComp_PE_A_lin', formula: 'FJComp-PE-A' });
    expect(derivedFor('FL1-A', true, ['FL1_A_log'])).toEqual({ name: 'FL1_A_log-1', formula: 'LOG(MAX(FL1-A,1))' });
  });
});

describe('colour table (ColorTableGenerator)', () => {
  it('rows join into one table and survive the preference string', () => {
    expect(colorTable(DEFAULT_COLOR_ROWS).length).toBe(80);
    const rows = [{ start: '#000000', end: '#ffffff', entries: 3, log: false }, { start: '#ff0000', end: '#0000ff', entries: 2, log: true }];
    expect(colorTable(rows)).toEqual([[0, 0, 0], [128, 128, 128], [255, 255, 255], [255, 0, 0], [0, 0, 255]]);
    expect(colorRowsFromString(colorRowsToString(rows))).toEqual(rows);
    expect(colorRowsFromString('junk')).toEqual(DEFAULT_COLOR_ROWS);
  });
});
