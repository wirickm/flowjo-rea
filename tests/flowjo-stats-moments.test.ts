// FlowJo 10.6.2 statistics decoded with REA's Ghidra provider (specs section 8):
// GParameter::ComputeStat, BasicHistogram::ScaleMean / ScaleStdDev / ScaleCV /
// ScaleGeometricMean / ChannelMode, GParameter::Mode, GParameter::Correlation,
// GParameter::MedianAbsoluteDeviation; StatKey names.
import { describe, expect, it } from 'vitest';
import { flowjoCv, flowjoGeomean, flowjoMad, flowjoMean, flowjoMode, flowjoPercentile, flowjoSd, type ChannelScale } from '../src/core/flowjoStats';
import { emptyWorkspace } from '../src/core/model';
import { computeStat, FLOWJO_STAT_NAMES } from '../src/core/stats';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';

const lin: ChannelScale = { kind: 'linear', min: 0, max: 4096 }; // channel k = value k
const v = (...xs: number[]) => Float64Array.from(xs);
const c = { count: 5, parent: 10, grandparent: 20, total: 40 };

describe('moments from the 4096-channel histogram', () => {
  it('mean is the count-weighted channel value (values snap to channels)', () => {
    // 10.4 -> channel 10, 20.6 -> channel 21 (floor(u + 0.5)).
    expect(flowjoMean(v(10.4, 20.6), lin)).toBe(15.5);
  });
  it('SD uses n - 1 over channel values; CV = 100 SD / mean, not made absolute', () => {
    expect(flowjoSd(v(10, 20), lin)).toBeCloseTo(Math.SQRT2 * 5, 5);
    expect(flowjoCv(v(10, 20), lin)).toBeCloseTo((100 * Math.SQRT2 * 5) / 15, 4);
    expect(flowjoSd(v(10), lin)).toBeNaN();
    const neg: ChannelScale = { kind: 'linear', min: -4096, max: 4096 };
    expect(flowjoCv(v(-2000, -1000), neg)).toBeLessThan(0);
  });
  it('geometric mean on a linear axis: 10^(mean log10 channel), channel-0 events count in n only', () => {
    expect(flowjoGeomean(v(10, 1000), lin)).toBeCloseTo(100, 3);
    // An event in channel 0 adds nothing to the sum but counts in n.
    expect(flowjoGeomean(v(0, 100), lin)).toBeCloseTo(10, 3);
  });
});

describe('mode, MAD, correlation', () => {
  it('mode: 256-channel histogram, first highest channel, as a 4096-channel position', () => {
    // Values 160..175 fall in 256-channel bin 10 -> position 160.
    expect(flowjoMode(v(160, 161, 170, 400), lin)).toBe(160);
    // Ties: the lowest channel wins.
    expect(flowjoMode(v(32, 320), lin)).toBe(32);
  });
  it('Median Abs Dev = 100 x 1.4826 x MAD / histogram median; MAD at index floor(n/2)', () => {
    const x = v(1, 2, 3, 4, 100);
    const med = flowjoPercentile(x, lin, 50);
    expect(med).toBe(3);
    expect(flowjoMad(x, lin, med)).toBeCloseTo((100 * 1.4826 * 1) / 3, 10);
  });
  it('Correlation is NaN, as FlowJo 10.6.2 computes it', () => {
    expect(computeStat('correlation', v(1, 2, 3), c, 50, lin, v(2, 4, 6))).toBeNaN();
  });
  it('Freq. of an ancestor = 100 x count / ancestor count', () => {
    expect(computeStat('freqOf', null, { ...c, ancestor: 20 })).toBe(25);
    expect(computeStat('freqOf', null, c)).toBeNaN();
  });
});

describe('.wsp statistic names (StatKey strings)', () => {
  it('uses FlowJo keys, e.g. fj.stat.freqofparent, and reads them back with ancestor and correlate', () => {
    expect(FLOWJO_STAT_NAMES.freqParent).toBe('fj.stat.freqofparent');
    expect(FLOWJO_STAT_NAMES.mad).toBe('Median Abs Dev');
    const ws = emptyWorkspace();
    ws.samples.push({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [{ id: 'p', name: 'Lymph', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'FL1-A', transform: { kind: 'linear', T: 1024, A: 0 } }], min: [1], max: [100] } }], keywordsSnapshot: {}, channelNames: ['FL1-A', 'FL2-A'], eventCount: 1 });
    ws.groups[0].sampleIds = ['s'];
    ws.statColumns.push(
      { id: 'a', populationPath: 'Lymph', stat: 'freqParent' },
      { id: 'b', populationPath: 'Lymph', stat: 'mode', channel: 'FL1-A' },
      { id: 'c', populationPath: 'Lymph', stat: 'correlation', channel: 'FL1-A', correlate: 'FL2-A' },
      { id: 'd', populationPath: 'Lymph', stat: 'min', channel: 'FL1-A' },
    );
    const { xml, warnings } = writeWsp({ ws, sampleMatrix: () => null });
    expect(xml).toContain('<Statistic name="fj.stat.freqofparent" />');
    expect(xml).toContain('<Statistic name="Correlation" id="FL1-A" correlate="FL2-A" />');
    expect(warnings.join('\n')).toMatch(/min .*no FlowJo equivalent/);
    const back = parseWsp(xml).workspace.statColumns.map((x) => [x.stat, x.channel, x.correlate]);
    expect(back).toEqual([['freqParent', undefined, undefined], ['mode', 'FL1-A', undefined], ['correlation', 'FL1-A', 'FL2-A']]);
  });
});
