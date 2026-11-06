// FlowJo 10.6.2 event export (specs section 9): Exporter::WriteSample /
// WriteRow / WriteParamHeaderRow / GetSampleIDParameter, ExportRequest
// defaults, PopulationExporter2 (resolveNumEvents, concatenation, end-time order).
import { describe, expect, it } from 'vitest';
import { capPositions, channelValue, concatCap, concatGroups, csvScaleValue, headerName, orderByEndTime, printfG, resolveNumEvents } from '../src/core/exportRules';
import { parseFcs } from '../src/core/fcs';
import { writeFcs } from '../src/core/fcsWriter';
import { AnalysisService } from '../src/core/service';

describe('no more than N (deterministic, not random)', () => {
  it('whole sample: positions 0, step, 2 step ... with step = trunc(count / N)', () => {
    expect(capPositions(10, 3, false)).toEqual([0, 3, 6]);
    expect(capPositions(10, 4, false)).toEqual([0, 2, 4, 6]);
  });
  it('gated population: the step-th, 2 step-th ... event (1-based)', () => {
    expect(capPositions(10, 3, true)).toEqual([2, 5, 8]);
  });
  it('N >= count or no cap takes every event; resolveNumEvents is min(N, count)', () => {
    expect(capPositions(4, 9, true)).toEqual([0, 1, 2, 3]);
    expect(capPositions(4, undefined, false)).toHaveLength(4);
    expect(resolveNumEvents(4, 9)).toBe(4);
    expect(resolveNumEvents(40, 9)).toBe(9);
  });
});

describe('concatenation', () => {
  type S = { id: string; kw: Record<string, string> };
  const s = (id: string, kw: Record<string, string>): S => ({ id, kw });
  const items = [s('a', { T: 'x', $ETIM: '10:00:02' }), s('b', { T: 'y', $ETIM: '10:00:01' }), s('c', { T: 'x' }), s('d', { T: '' })];
  it('every n files splits in order; all is one file', () => {
    expect(concatGroups(items, { kind: 'everyN', n: 3 }, (t, k) => t.kw[k]).map((g) => g.map((x) => x.id))).toEqual([['a', 'b', 'c'], ['d']]);
    expect(concatGroups(items, { kind: 'all' }, (t, k) => t.kw[k])).toHaveLength(1);
  });
  it('equal keyword values: groups by value in string order; empty values left out', () => {
    expect(concatGroups(items, { kind: 'equalKeyword', keyword: 'T' }, (t, k) => t.kw[k]).map((g) => g.map((x) => x.id))).toEqual([['a', 'c'], ['b']]);
  });
  it('files are ordered by $ETIM; a missing time compares equal', () => {
    expect(orderByEndTime(items.slice(0, 2), (t) => t.kw.$ETIM).map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('the cap per population is trunc(sum of min(N, count) / populations)', () => {
    expect(concatCap([100, 10], 50)).toBe(30);
  });
});

describe('CSV values and header', () => {
  it('scale values print with %g; values within 1e-6 of zero print 0', () => {
    expect(printfG(12345.6789)).toBe('12345.7');
    expect(printfG(1234567)).toBe('1.23457e+06');
    expect(printfG(0.0000123)).toBe('1.23e-05');
    expect(printfG(-2.5)).toBe('-2.5');
    expect(csvScaleValue(5e-7)).toBe('0');
  });
  it('channel values: 1024 channels (FlowJo default channelRange); linear rounds, clamped', () => {
    const lin = { kind: 'linear' as const, T: 1024, A: 0 };
    expect(channelValue(511.6, lin)).toBe(512);
    expect(channelValue(-5, lin)).toBe(0);
    expect(channelValue(5000, lin)).toBe(1023);
  });
  it('header: name, stain or "name :: stain"', () => {
    expect(headerName('FL1-A', 'CD3', 'p')).toBe('FL1-A');
    expect(headerName('FL1-A', 'CD3', 's')).toBe('CD3');
    expect(headerName('FL1-A', 'CD3', 'ps')).toBe('FL1-A :: CD3');
    expect(headerName('FSC-A', '', 'ps')).toBe('FSC-A');
  });
});

describe('service export', () => {
  const fcs = (n: number, etim: string, start: number) =>
    writeFcs([{ name: 'A', label: 'CD3', range: 1024, values: Float64Array.from({ length: n }, (_, i) => start + i) }], { $ETIM: etim });
  it('caps a whole-sample export and concatenates in $ETIM order with a SampleID parameter', async () => {
    const svc = new AnalysisService();
    await svc.load('late', 'late.fcs', fcs(10, '10:00:09', 0));
    await svc.load('early', 'early.fcs', fcs(4, '10:00:01', 100));
    const req = (sampleId: string) => ({ sampleId, compensation: 'none', populations: [], matrices: [], popId: null, format: 'csv' as const, channels: ['A'], compensated: false });
    const capped = new TextDecoder().decode(svc.exportEvents({ ...req('late'), maxEvents: 3 })).trim().split('\n');
    expect(capped).toEqual(['A', '0', '3', '6']);
    const cat = parseFcs(svc.exportConcatenated([{ ...req('late'), format: 'fcs' }, { ...req('early'), format: 'fcs' }]));
    expect(cat.channels.map((c) => c.name)).toEqual(['A', 'SampleID']);
    expect(Array.from(cat.data[0]).slice(0, 5)).toEqual([100, 101, 102, 103, 0]);
    expect(Array.from(cat.data[1]).slice(0, 5)).toEqual([1, 1, 1, 1, 2]);
  });
});
