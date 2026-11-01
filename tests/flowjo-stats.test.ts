import { describe, expect, it } from 'vitest';
import { channelScale, flowjoPercentile, flowjoRobustCv, flowjoRobustSd, statScales, type ChannelScale } from '../src/core/flowjoStats';
import { computeStat } from '../src/core/stats';

// One data unit per channel: channel = value for 0..4095.
const unit: ChannelScale = { kind: 'linear', min: 0, max: 4096 };
const range = (a: number, b: number) => Float64Array.from({ length: b - a }, (_, i) => a + i);

describe('FlowJo 10 histogram statistics', () => {
  it('median is the first channel whose cumulative count reaches n/2', () => {
    // 0..99: cumulative count reaches 50 at value 49 (the exact median is 49.5).
    expect(flowjoPercentile(range(0, 100), unit, 50)).toBe(49);
    expect(flowjoPercentile(range(0, 100), unit, 10)).toBe(9);
    // Values round to the nearest channel: 10.4 -> 10, 10.6 -> 11.
    expect(flowjoPercentile(Float64Array.from([10.4, 10.6, 10.6]), unit, 50)).toBe(11);
  });

  it('converts the channel back to data units on the axis range', () => {
    const s: ChannelScale = { kind: 'linear', min: 0, max: 262144 }; // 64 units per channel
    expect(flowjoPercentile(Float64Array.from([1000, 1000, 1000]), s, 50)).toBe(Math.floor(1000 / 64 + 0.5) * 64);
  });

  it('clamps off-scale values into the first and last channel', () => {
    expect(flowjoPercentile(Float64Array.from([-500, -400, -300]), unit, 50)).toBe(0);
    expect(flowjoPercentile(Float64Array.from([1e6, 1e6, 1e6]), unit, 50)).toBe(4095);
  });

  it('robust SD is (P84.13 - P15.87) / 2 for an unsaturated spread', () => {
    const v = range(1000, 3000); // 2000 events, one per channel
    const p16 = flowjoPercentile(v, unit, 15.87), p84 = flowjoPercentile(v, unit, 84.13);
    expect(flowjoRobustSd(v, unit)).toBeCloseTo((p84 - p16) / 2, 3);
    expect(flowjoRobustCv(v, unit)).toBeCloseTo((100 * (p84 - p16)) / 2 / flowjoPercentile(v, unit, 50), 3);
  });

  it('robust SD uses median - P15.87 when the top channel is saturated', () => {
    const v = Float64Array.from([...range(1000, 1300), ...new Array(700).fill(9999)]);
    const med = flowjoPercentile(v, unit, 50), p16 = flowjoPercentile(v, unit, 15.87);
    expect(flowjoRobustSd(v, unit)).toBeCloseTo(med - p16, 3);
  });

  it('robust CV is 0 below 6 events and NaN when empty', () => {
    expect(flowjoRobustCv(range(100, 105), unit)).toBe(0);
    expect(flowjoRobustCv(new Float64Array(0), unit)).toBeNaN();
  });

  it('logicle channels map back to table values close to the exact median', () => {
    const s = channelScale({ kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 })!;
    const v = Float64Array.from({ length: 999 }, (_, i) => 100 + i * 10);
    const m = flowjoPercentile(v, s, 50);
    expect(Math.abs(m - 5090) / 5090).toBeLessThan(0.01);
    expect(m).toBeLessThanOrEqual(5090);
  });

  it('computeStat uses the FlowJo convention only when a scale is given', () => {
    const c = { count: 100, parent: 100, grandparent: 100, total: 100 };
    expect(computeStat('median', range(0, 100), c)).toBe(49.5);
    expect(computeStat('median', range(0, 100), c, 50, unit)).toBe(49);
    expect(computeStat('mean', range(0, 100), c, 50, unit)).toBe(49.5);
  });

  it('picks the imported FlowJo range first, then linear or logicle display scales', () => {
    const s = statScales({ 'FSC-A': { kind: 'linear', T: 262144, A: 0 }, CD3: { kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 }, CD4: { kind: 'asinh', T: 262144, M: 4.5, A: 0 } }, { Time: [1, 72] }, ['FSC-A', 'CD3', 'CD4', 'Time']);
    expect(s['FSC-A']).toEqual({ kind: 'linear', min: -0, max: 262144 });
    expect(s.CD3.kind).toBe('logicle');
    expect(s.CD4).toBeUndefined();
    expect(s.Time).toEqual({ kind: 'linear', min: 1, max: 72 });
  });
});
