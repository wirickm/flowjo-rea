// FlowJo 10.6.2 kinetics (specs section 11): native Kinetics::MakeTimeSeries,
// GTimeSeries::Compute*, GVector::Smooth, Kinetics::ComputeThreshold; Java
// TimesliceStatistics, KinToggleAutoSlice, MultiTimesliceDlog.
import { describe, expect, it } from 'vitest';
import {
  allEventsSlice, autoSlices, copyTimeSeries, fillGaps, kineticsBins, kineticsSeries, multiSlices, percentileThreshold, rangeName, smoothSeries, sortSlices,
  timesliceStats, uniqueSliceName, type Timeslice,
} from '../src/core/kinetics';
import type { ChannelScale } from '../src/core/flowjoStats';

const lin: ChannelScale = { kind: 'linear', min: 0, max: 4096 }; // channel = value
const ones = (n: number) => new Uint8Array(n).fill(1);

describe('binning (Kinetics::MakeTimeSeries)', () => {
  it('range from the first and last events in file order; width max(1, trunc((R - 1) / 4096 + 1))', () => {
    expect(kineticsBins(Float64Array.from([0, 5, 100]), 'Mean', 90, 1e6)).toEqual({ range: 100, width: 1, bins: 101 });
    expect(kineticsBins(Float64Array.from([0, 10000]), 'Mean', 90, 1e9)).toEqual({ range: 10000, width: 3, bins: 3334 });
    // Not min / max: the last event in the file sets the range.
    expect(kineticsBins(Float64Array.from([10, 500, 60]), 'Mean', 90, 1e6).range).toBe(50);
  });
  it('sparse populations get fewer bins: k = max(10, N div minimum) of width trunc(R / k + 1)', () => {
    // Median needs 20 events per bin: 1000 events -> 50 bins over R = 1000.
    expect(kineticsBins(Float64Array.from([0, 1000]), 'Median', 90, 1000)).toEqual({ range: 1000, width: 21, bins: 48 });
    expect(kineticsBins(Float64Array.from([0, 1000]), 'Median', 90, 5).bins).toBe(10);
  });
});

describe('series statistics (GTimeSeries)', () => {
  // 30 events at t = 0..29 (one bin each with R = 29 and width 1 would be too
  // sparse; N small -> 10 bins of width 3).
  const t = Float64Array.from({ length: 30 }, (_, i) => i);
  it('mean leaves out values below 0 (T = 0 for non-threshold statistics)', () => {
    const y = Float64Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -100 : 10));
    const s = kineticsSeries(t, y, ones(30), { stat: 'Mean', percentile: 90, smoothing: 'None', threshold: 0, scale: lin });
    expect(s.width).toBe(3);
    expect(Array.from(s.values)).toEqual(new Array(10).fill(10));
  });
  it('% of cells over T: denominator is the gated events of the bin', () => {
    const y = Float64Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 50 : 1));
    const s = kineticsSeries(t, y, ones(30), { stat: '% of cells over Threshold T', percentile: 90, smoothing: 'None', threshold: 5, scale: lin });
    expect(s.values[0]).toBeCloseTo(33.33333, 4);
  });
  it('percentiles stream events: the event opening a bin is counted in the bin before it', () => {
    const y = Float64Array.from({ length: 30 }, (_, i) => Math.floor(i / 3) * 100 + 10);
    const s = kineticsSeries(t, y, ones(30), { stat: 'Percentile', percentile: 90, smoothing: 'None', threshold: 0, scale: lin });
    // Bin 0 holds t = 0, 1, 2 (value 10) and the t = 3 event (value 110).
    expect(s.values[0]).toBe(110);
    // Bin 1 lost its opening event and gained the t = 6 event.
    expect(s.values[1]).toBe(210);
  });
  it('empty bins are 0 (missing) and stay missing after smoothing', () => {
    const tt = Float64Array.from([0, 1, 2, 30, 31, 32]);
    const s = kineticsSeries(tt, Float64Array.from([5, 5, 5, 7, 7, 7]), ones(6), { stat: 'Mean', percentile: 90, smoothing: 'Moving Average', threshold: 0, scale: lin });
    expect(s.missing.some((m) => m === 1)).toBe(true);
    expect(s.values.filter((v, b) => s.missing[b]).every((v) => v === 0)).toBe(true);
  });
});

describe('smoothing (GVector::Smooth, width 3)', () => {
  const v = Float64Array.from([0, 0, 0, 10, 0, 0, 0]);
  it('moving average: equal weights over present neighbours (edges renormalised)', () => {
    const r = smoothSeries(v, new Uint8Array(7), 'Moving Average');
    expect(r.values[3]).toBeCloseTo(10 / 7, 10);
    expect(r.values[0]).toBeCloseTo(10 / 4, 10);
  });
  it('Gaussian weights grow with distance (exp(+k^2/9)), as FlowJo 10.6.2 computes them', () => {
    const r = smoothSeries(v, new Uint8Array(7), 'Gaussian');
    const w = [0, 1, 2, 3].map((k) => Math.fround(Math.exp(Math.fround((k * k) / 9))));
    expect(r.values[3]).toBeCloseTo((10 * w[0]) / (w[0] + 2 * (w[1] + w[2] + w[3])), 5);
    expect(r.values[0]).toBeGreaterThan(r.values[3]);
  });
  it('missing bins stay missing', () => {
    const m = Uint8Array.from([0, 0, 0, 0, 1, 0, 0]);
    expect(smoothSeries(v, m, 'Moving Average').missing[4]).toBe(1);
  });
});

describe('threshold from a percentile (Kinetics::ComputeThreshold)', () => {
  it('uses the slice start and end as an event-index range; 100 gives the maximum, 0 the minimum', () => {
    const y = Float64Array.from({ length: 100 }, (_, i) => i);
    expect(percentileThreshold(y, ones(100), 100, 10, 20, lin)).toBe(20);
    expect(percentileThreshold(y, ones(100), 0, 10, 20, lin)).toBe(10);
    expect(percentileThreshold(y, ones(100), 50, 10, 20, lin)).toBeGreaterThanOrEqual(14);
  });
});

describe('timeslices (TimesliceStatistics)', () => {
  const series = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const sl = (name: string, startTime: number, endTime: number): Timeslice => ({ name, startTime, endTime, y: 50, color: 'red' });
  it('peak, peak t, mean Y, AUC, slope on one point per time unit', () => {
    // Time scale 0..10 (tmax 10, W 10): dt = 1, indices 2..5.
    const st = timesliceStats(series, sl('a', 2, 6), 10, 10);
    expect(st.dt).toBe(4);
    expect(st.peak).toBe(6);
    expect(st.peakT).toBe(6);
    expect(st.meanY).toBe(4.5);
    expect(st.auc).toBe(18);
    expect(st.slope).toBeCloseTo(1, 12);
  });
  it('no kept points: NaN statistics and AUC 0; a lone point keeps slope 0', () => {
    const z = Float64Array.from([0, 0, 0, 0, 0, 0]);
    const st = timesliceStats(z, sl('z', 1, 4), 6, 6);
    expect(st.peak).toBeNaN();
    expect(st.auc).toBe(0);
    expect(timesliceStats(series, sl('one', 3, 4), 10, 10).slope).toBe(0);
  });
  it('gaps: a zero between non-zero neighbours becomes their average', () => {
    expect(Array.from(fillGaps(Float64Array.from([2, 0, 4, 0, 0, 6])))).toEqual([2, 3, 4, 0, 0, 6]);
  });
  it('names: "Range #k" past the slice count; clashes get -1, -2', () => {
    expect(rangeName(['All Events'])).toBe('Range #2');
    expect(rangeName(['All Events', 'Range #2'])).toBe('Range #3');
    expect(uniqueSliceName('A', ['A', 'A-1'])).toBe('A-2');
  });
  it('multiple ranges: back to back, prefix1.., y 50, 75, 55, 80; only whole slices', () => {
    const m = multiSlices('s', 4, allEventsSlice(10, 10), []);
    expect(m.map((x) => [x.name, x.startTime, x.endTime, x.y])).toEqual([['s1', 0, 25, 50], ['s2', 25, 50, 75], ['s3', 50, 75, 55], ['s4', 75, 100, 80]]);
  });
  it('auto slicing around the longest zero run and the first maximum', () => {
    const v = Float64Array.from([5, 5, 0, 0, 0, 3, 9, 4, 2, 1]);
    const a = autoSlices(v, 1, 1);
    expect(a.map((x) => [x.name, x.startTime, x.endTime])).toEqual([['Auto #1', 0, 2], ['Auto #2', 5, 7], ['Auto #3', 7, 10]]);
  });
  it('sorting: start ascending, the longer first on ties; copy series "round(i x scale)<tab>value"', () => {
    expect(sortSlices([sl('b', 5, 6), sl('a', 5, 9), sl('c', 1, 2)]).map((x) => x.name)).toEqual(['c', 'a', 'b']);
    expect(copyTimeSeries(Float64Array.from([1.5, 2]), 2.4)).toBe('0\t1.5\n2\t2\n');
  });
});

describe('Kinetics node in the workspace and the statistics table', () => {
  it('KineticsNode with timeslices and plat.kin.* statistics survives .wsp export and import', async () => {
    const { emptyWorkspace } = await import('../src/core/model');
    const { writeWsp } = await import('../src/core/wspWriter');
    const { parseWsp } = await import('../src/core/wsp');
    const ws = emptyWorkspace();
    ws.samples.push({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', keywordsSnapshot: {}, channelNames: ['Time', 'FL1-A'], eventCount: 1, populations: [] });
    ws.groups[0].sampleIds = ['s'];
    ws.kinetics = { '': { yAxis: 'FL1-A', statistic: '% of cells over Threshold T', percentile: 90, smoothing: 'Gaussian', threshold: { kind: 'absolute', value: 2.5 }, timeslices: [{ name: 'Base', startTime: 0, endTime: 30.5, y: 50, color: '#ff0000' }] } };
    ws.statColumns.push({ id: 'k', populationPath: '', stat: 'kinetic', kin: { key: 'peak', timeslice: 'Base' } });
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    expect(xml).toContain('<KineticsNode name="Kinetics" yAxis="FL1-A" statistic="% of cells over Threshold T"');
    expect(xml).toContain('thresholdPercentile="-999999"');
    expect(xml).toContain('<Statistic name="plat.kin.peak" id="Base" />');
    const back = parseWsp(xml).workspace;
    expect(back.kinetics?.['']).toEqual(ws.kinetics['']);
    expect(back.statColumns.map((c) => [c.stat, c.kin?.key, c.kin?.timeslice])).toEqual([['kinetic', 'peak', 'Base']]);
  });
  it('the service runs the series on the Time parameter and fills kinetic columns', async () => {
    const { AnalysisService } = await import('../src/core/service');
    const { writeFcs } = await import('../src/core/fcsWriter');
    const n = 4000;
    const time = Float64Array.from({ length: n }, (_, i) => i / 10); // R = 399.9
    const y = Float64Array.from({ length: n }, (_, i) => (i < 2000 ? 100 : 300));
    const svc = new AnalysisService();
    await svc.load('s', 's.fcs', writeFcs([{ name: 'Time', range: 1024, values: time }, { name: 'FL1-A', range: 1024, values: y }], { $BTIM: '10:00:00', $ETIM: '10:06:40' }));
    const settings = { yAxis: 'FL1-A', statistic: 'Mean' as const, percentile: 90, smoothing: 'None' as const, timeslices: [{ name: 'Late', startTime: 250, endTime: 350, y: 50, color: '#ff0000' }] };
    const rep = svc.kinetics({ sampleId: 's', compensation: 'none', populations: [], matrices: [], popId: null, channel: 'FL1-A', timeChannel: 'Time', settings, scale: { kind: 'linear', min: 0, max: 1024 }, durationSeconds: 400 });
    expect(rep.values.length).toBe(400);
    expect(rep.total).toBe(400);
    expect(rep.slices.map((s) => s.name)).toEqual(['All Events', 'Late']);
    const out = svc.stats({ sampleId: 's', compensation: 'none', populations: [], matrices: [], columns: [{ id: 'c', populationPath: '', stat: 'kinetic', kin: { key: 'peak', timeslice: 'Late' } }], kinetics: { '': settings } });
    expect(out[0]).toBe(300);
  });
});
