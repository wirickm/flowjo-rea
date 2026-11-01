// Time-binned statistics on a small hand-built event table with exact answers.
import { describe, expect, it } from 'vitest';
import { kinetics } from '../src/core/kinetics';

//                          0   1  2  3  4  5  6    7  8   9   10  11
const time = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 9, 10, 7, 20, 8]);
const vals = Float64Array.from([10, 20, 5, 7, 1, 3, 100, 4, 8, 50, 99, 30]);
const mask = Uint8Array.from([1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1]);

describe('kinetics', () => {
  it('spans min..max of masked time with equal-width bins, last bin inclusive', () => {
    const r = kinetics(time, null, mask, { bins: 5, stat: 'count' });
    expect(Array.from(r.binStart)).toEqual([0, 2, 4, 6, 8]);
    expect(Array.from(r.binEnd)).toEqual([2, 4, 6, 8, 10]);
    expect(Array.from(r.n)).toEqual([2, 2, 2, 0, 3]);
    expect(Array.from(r.value)).toEqual([2, 2, 2, 0, 3]);
  });
  it('mean and median per bin, NaN for an empty bin', () => {
    const m = kinetics(time, vals, mask, { bins: 5, stat: 'mean' });
    expect(Array.from(m.value)).toEqual([15, 6, 2, NaN, 14]);
    const md = kinetics(time, vals, mask, { bins: 5, stat: 'median' });
    expect(Array.from(md.value)).toEqual([15, 6, 2, NaN, 8]);
  });
  it('pctPositive uses the mask as denominator by default, or parentMask', () => {
    const p = kinetics(time, vals, mask, { bins: 5, stat: 'pctPositive', threshold: 6 });
    expect(Array.from(p.value.slice(0, 4))).toEqual([100, 50, 0, NaN]);
    expect(p.value[4]).toBeCloseTo(200 / 3, 12);
    const q = kinetics(time, vals, mask, { bins: 5, stat: 'pctPositive', threshold: 6, parentMask: new Uint8Array(12).fill(1) });
    expect(Array.from(q.n)).toEqual([2, 2, 2, 2, 3]);
    expect(q.value[3]).toBe(0);
  });
  it('empty mask yields NaN bins and bad options throw', () => {
    const r = kinetics(time, vals, new Uint8Array(12), { bins: 3, stat: 'mean' });
    expect(Array.from(r.value)).toEqual([NaN, NaN, NaN]);
    expect(Array.from(r.n)).toEqual([0, 0, 0]);
    expect(() => kinetics(time, vals, mask, { bins: 0, stat: 'count' })).toThrow();
    expect(() => kinetics(time, null, mask, { bins: 2, stat: 'mean' })).toThrow();
  });
});
