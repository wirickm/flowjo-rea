import { describe, expect, it } from 'vitest';
import {
  channelMedian, checkParameter, checkSampleQuality, checkTime, elapsedSeconds, lineFit, qualityChannels,
  qualityParameters, rateTrim, segmentCount, statusFor, type ParameterCheck,
} from '../src/core/sampleQuality';

const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe('Check Sample Quality (SampleValidity / SampleQualityControl)', () => {
  it('segment count and event-rate trim follow the event count', () => {
    expect([1000, 4999, 5000, 24999, 25000, 199999, 200000, 999999, 1000000].map(segmentCount)).toEqual([7, 7, 10, 10, 20, 20, 30, 30, 40]);
    expect([199999, 200000].map(rateTrim)).toEqual([1, 2]);
  });

  it('channel count: 4096 for float data, next power of two for integer data', () => {
    expect(qualityChannels('F', 262144)).toBe(4096);
    expect(qualityChannels('I', 1024)).toBe(1024);
    expect(qualityChannels('I', 1000)).toBe(1024);
    expect(qualityChannels('I', 262144)).toBe(4096);
    expect(qualityChannels('A', 1024)).toBe(4096);
  });

  it('channel median: first channel whose cumulative count reaches half', () => {
    expect(channelMedian([1, 1, 1, 1])).toBe(1);
    expect(channelMedian([0, 3, 0, 1])).toBe(1);
    expect(channelMedian([0, 0, 0, 0])).toBe(0);
    expect(channelMedian([0, 0, 1, 5])).toBe(3);
  });

  it('least squares line at x = 1..n', () => {
    expect(lineFit([2, 4, 6, 8])).toEqual({ slope: 2, mean: 5 });
    expect(lineFit([7])).toEqual({ slope: 0, mean: 7 });
  });

  it('a steady parameter has ratio 0; a drifting one exceeds 1 %', () => {
    const N = 7000; // K = 10 segments of 700
    const steady = Float64Array.from({ length: N }, (_, i) => 100 + (i % 7));
    const drift = Float64Array.from({ length: N }, (_, i) => 100 + i / 100); // medians 103..166
    const a = checkParameter('A', steady, (v) => v, 4096);
    const b = checkParameter('B', drift, (v) => v, 4096);
    expect(a.medians).toHaveLength(10);
    expect(a.ratio).toBe(0);
    expect(b.slope).toBeCloseTo(7, 5);
    expect(b.ratio).toBeCloseTo((7 * 10) / b.mean, 9);
    expect(Math.abs(b.ratio)).toBeGreaterThan(0.01);
    expect(b.kineticSd).toBeGreaterThan(0);
  });

  it('status from floor(sqrt(number of drifting parameters))', () => {
    const p = (ratio: number) => ({ ratio }) as ParameterCheck;
    const st = (n: number) => statusFor([...Array(n)].map(() => p(0.5)).concat([p(0.001)]));
    expect([0, 1, 3, 8, 9, 24, 25, 80, 81].map(st)).toEqual(['valid', 'ok', 'ok', 'ok', 'irregular', 'irregular', 'flawed', 'flawed', 'malformed']);
  });

  it('fewer than 2000 events: no checks, read as Valid', () => {
    const r = checkSampleQuality({ events: 1999, params: [{ name: 'X', values: new Float64Array(1999), toChannel: (v) => v, channels: 16 }] });
    expect(r.status).toBe('valid');
    expect(r.message).toBe('Too few events to check validity.');
    expect(r.params).toEqual([]);
  });

  it('whole sample: one drifting parameter of three is OK; first / last channel counts', () => {
    const rnd = lcg(3);
    const N = 6000;
    const mk = (f: (i: number) => number) => Float64Array.from({ length: N }, (_, i) => f(i));
    const r = checkSampleQuality({
      events: N,
      params: [
        { name: 'FSC-A', values: mk(() => 500 + rnd() * 10), toChannel: (v) => v, channels: 1024 },
        { name: 'SSC-A', values: mk((i) => 300 + i / 20), toChannel: (v) => v, channels: 1024 },
        { name: 'PE-A', values: mk((i) => (i % 2 ? -5 : 2000)), toChannel: (v) => v, channels: 1024 },
      ],
    });
    expect(r.drifting).toEqual(['SSC-A']);
    expect(r.status).toBe('ok');
    const pe = r.params.find((q) => q.name === 'PE-A')!;
    expect(pe.numInFirstChannels).toBe(N / 2);
    expect(pe.numInLastChannels).toBe(N / 2);
  });

  it('time checks: 50 block spans, largest step, event-rate line; skipped under 20 s', () => {
    const t = Float64Array.from({ length: 5000 }, (_, i) => i * 2 + (i === 2500 ? 50 : 0));
    expect(checkTime(t, 10)).toBeUndefined();
    const c = checkTime(t, 60)!;
    expect(c.values).toHaveLength(50);
    expect(c.values[0]).toBe(198);
    expect(c.biggestDeltaT).toBe(52);
    expect(c.avgDeltaT).toBeCloseTo((t[4999] - t[0]) * 0.02);
    expect(c.rateMean).toBeGreaterThan(0);
  });

  it('elapsed seconds and parameters covered', () => {
    expect(elapsedSeconds('10:00:00', '10:01:05')).toBe(65);
    expect(elapsedSeconds('23:59:50', '00:00:10')).toBe(20);
    expect(elapsedSeconds(undefined, '1:00:00')).toBe(0);
    expect(qualityParameters(['FSC-A', 'Time', 'PE-A'])).toEqual(['FSC-A', 'PE-A']);
  });
});
