import { describe, expect, it } from 'vitest';
import { compensate, invert, parseSpilloverCsv, parseSpilloverKeyword } from '../src/core/compensation';
import { computeStat, gather } from '../src/core/stats';

describe('compensation', () => {
  it('2x2 inverse matches the closed form', () => {
    const inv = invert([[1, 0.2], [0.1, 1]]);
    const det = 1 - 0.02;
    expect(inv[0][0]).toBeCloseTo(1 / det, 14);
    expect(inv[0][1]).toBeCloseTo(-0.2 / det, 14);
  });
  it('recovers true signals from mixed data', () => {
    // true FITC=1000, PE=500; spill FITC->PE 0.2, PE->FITC 0.05
    const raw = [Float64Array.from([1000 + 0.05 * 500]), Float64Array.from([500 + 0.2 * 1000]), Float64Array.from([7])];
    const out = compensate(raw, ['FITC-A', 'PE-A', 'FSC-A'], { id: 'm', name: 'm', channels: ['FITC-A', 'PE-A'], values: [[1, 0.2], [0.05, 1]], source: 't' });
    expect(out[0][0]).toBeCloseTo(1000, 9);
    expect(out[1][0]).toBeCloseTo(500, 9);
    expect(out[2]).toBe(raw[2]);
  });
  it('rejects singular, malformed and mismatched matrices', () => {
    expect(() => invert([[1, 1], [1, 1]])).toThrow(/singular/);
    expect(() => parseSpilloverKeyword('2,A,B,1,0,0')).toThrow(/fields/);
    expect(() => compensate([new Float64Array(1)], ['A'], { id: 'm', name: 'm', channels: ['A', 'B'], values: [[1, 0], [0, 1]], source: 't' })).toThrow(/not in sample/);
    expect(() => parseSpilloverCsv('A,B\n1,0\n0,x')).toThrow(/non-numeric/);
  });
  it('parses $SPILLOVER and CSV with a label column', () => {
    expect(parseSpilloverKeyword('2,A,B,1,0.1,0.2,1').values).toEqual([[1, 0.1], [0.2, 1]]);
    const m = parseSpilloverCsv(',A,B\nA,1,0.1\nB,0.2,1');
    expect(m.channels).toEqual(['A', 'B']);
    expect(m.values).toEqual([[1, 0.1], [0.2, 1]]);
  });
});

describe('statistics (hand-computed expectations)', () => {
  const v = Float64Array.from([1, 2, 3, 4, 100]);
  const c = { count: 5, parent: 10, grandparent: 20, total: 40 };
  it('frequencies', () => {
    expect(computeStat('freqParent', null, c)).toBe(50);
    expect(computeStat('freqGrandparent', null, c)).toBe(25);
    expect(computeStat('freqTotal', null, c)).toBe(12.5);
    expect(computeStat('freqParent', null, { ...c, parent: 0 })).toBeNaN();
  });
  it('moments and order statistics', () => {
    expect(computeStat('mean', v, c)).toBe(22);
    expect(computeStat('median', v, c)).toBe(3);
    // sample SD: sqrt(((21^2+20^2+19^2+18^2+78^2))/4)
    expect(computeStat('sd', v, c)).toBeCloseTo(Math.sqrt((441 + 400 + 361 + 324 + 6084) / 4), 12);
    expect(computeStat('geomean', v, c)).toBeCloseTo((1 * 2 * 3 * 4 * 100) ** (1 / 5), 12);
    expect(computeStat('percentile', v, c, 25)).toBe(2);
    expect(computeStat('mad', v, c)).toBe(1);
    expect(computeStat('min', v, c)).toBe(1);
    expect(computeStat('max', v, c)).toBe(100);
  });
  it('empty populations give NaN, not 0', () => {
    expect(computeStat('mean', new Float64Array(0), { ...c, count: 0 })).toBeNaN();
    expect(computeStat('median', new Float64Array(0), { ...c, count: 0 })).toBeNaN();
  });
  it('gather selects masked events', () => {
    expect([...gather(Float64Array.from([5, 6, 7]), Uint8Array.from([1, 0, 1]))]).toEqual([5, 7]);
  });
});
