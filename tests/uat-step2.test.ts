// UAT step 2 (medium defects): FlowJo 10 behaviors from specs section 6.7.
// One describe block per UAT item; reasons in docs/validation/uat-2026-11-02.md.
import { describe, expect, it } from 'vitest';
import type { FcsChannel } from '../src/core/fcs';
import { channelRange, defaultTransform, specForKind } from '../src/ui/axes';
import { histogramScale } from '../src/ui/renderPlot';
import { tooSmall } from '../src/ui/gateGeometry';
import { emptyWorkspace, uniqueName, type Gate, type Population } from '../src/core/model';
import { deserializeWorkspace, groupByKey, mergeImported, relinkMismatch, removeSample, serializeWorkspace } from '../src/core/project';
import { exportGatingMl, gatingMlNames, parseGatingMl } from '../src/core/gatingml';
import { validPercentile } from '../src/core/stats';
import { fitProliferation } from '../src/core/proliferation';

const ch = (name: string, range: number): FcsChannel => ({ index: 1, name, label: '', bits: 32, range, logDecades: 0, logOffset: 0, gain: 1 });

describe('a2-04 linear range is 0..$PnR', () => {
  it('uses $PnR, or 1024 when it is missing', () => {
    expect(channelRange(ch('FL1-A', 1024))).toBe(1024);
    expect(channelRange(ch('FL1-A', 0))).toBe(1024);
    expect(defaultTransform(ch('FSC-A', 4096), {})).toEqual({ kind: 'linear', T: 4096, A: 0 });
    expect(defaultTransform(ch('FSC-A', 0), {})).toEqual({ kind: 'linear', T: 1024, A: 0 });
  });
  it('changing the scale type keeps the range', () => {
    const lin = specForKind('linear', { kind: 'logicle', T: 1024, W: 0.5, M: 4.5, A: 0 }, 262144);
    expect(lin).toEqual({ kind: 'linear', T: 1024, A: 0 });
    expect(specForKind('flowjo-biex', lin, 262144)).toMatchObject({ max: 1024 });
    // A spec without a top of scale falls back to the channel's range.
    expect(specForKind('linear', { kind: 'flowjo-log', offset: 1, decades: 4.5 }, 4096)).toEqual({ kind: 'linear', T: 4096, A: 0 });
  });
});

describe('a2-02 histogram overlays use raw counts by default', () => {
  const base = [0, 10, 40, 10];
  const ov = [0, 80, 5, 0];
  it('raw counts share one axis over the base and overlays', () => {
    const s = histogramScale(base, [ov], false);
    expect(s.label).toBe('Count');
    expect(s.max).toBe(80);
    expect(s.factor(base)).toBe(1);
    expect(s.factor(ov)).toBe(1);
  });
  it('"Normalized To Mode" scales each curve to a mode of 100 and relabels the axis', () => {
    const s = histogramScale(base, [ov], true);
    expect(s.label).toBe('Normalized To Mode');
    expect(s.max).toBe(100);
    expect(40 * s.factor(base)).toBe(100);
    expect(80 * s.factor(ov)).toBe(100);
  });
});

describe('a2-07/a2-08/a1-08 degenerate shapes and unique names', () => {
  it('a taken name gets the first free "-N" suffix', () => {
    expect(uniqueName('Rect 1', ['Polygon 1'])).toBe('Rect 1');
    expect(uniqueName('Rect 1', ['Rect 1'])).toBe('Rect 1-1');
    expect(uniqueName('Rect 1', ['Rect 1', 'Rect 1-1'])).toBe('Rect 1-2');
  });
  it('shapes of 10 px or less are discarded', () => {
    expect(tooSmall([[100, 100], [110, 160]], true)).toBe(true); // 10 px wide
    expect(tooSmall([[100, 100], [111, 111]], true)).toBe(false);
    expect(tooSmall([[100, 100], [160, 105]], true)).toBe(true); // 5 px high
    expect(tooSmall([[100, 0], [140, 0]], false)).toBe(false); // 1-D range ignores height
    expect(tooSmall([[100, 0], [108, 0]], false)).toBe(true);
  });
  it('group-by names do not duplicate an existing group name', () => {
    const ws = emptyWorkspace();
    ws.groups.push({ id: 'g1', name: 'Tube = A', sampleIds: [] });
    ws.samples.push({ id: 's1', fileName: 'a.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: {}, annotations: { Tube: 'A' }, channelNames: [], eventCount: 0 });
    expect(groupByKey(ws, 'Tube')).toEqual(['Tube = A-1']);
  });
});

describe('a1-04/a5-03 re-imported gates replace, never duplicate', () => {
  const X = { kind: 'channel' as const, channel: 'FSC-A', transform: { kind: 'linear' as const, T: 1024, A: 0 } };
  const rect = (lo: number): Gate => ({ type: 'rect', dims: [X], min: [lo], max: [500] });
  const imported: Population[] = [
    { id: 'i1', name: 'Cells', parentId: null, gate: rect(100) },
    { id: 'i2', name: 'NOT Cells', parentId: null, gate: { type: 'boolean', op: 'not', operands: [{ ref: 'i1' }] } },
  ];
  it('an equivalent re-import changes nothing', () => {
    const first = mergeImported([], imported, null, 'keep');
    expect(first.added).toEqual(['Cells', 'NOT Cells']);
    const again = mergeImported(first.populations, imported, null, 'keep');
    expect(again.populations).toEqual(first.populations);
    expect(again.same).toEqual(['Cells', 'NOT Cells']);
    expect(again.conflicts).toEqual([]);
  });
  it('a different gate with the same name is replaced or kept, as asked', () => {
    const first = mergeImported([], imported, null, 'keep').populations;
    const changed = [{ ...imported[0], gate: rect(200) }, imported[1]];
    const keep = mergeImported(first, changed, null, 'keep');
    expect(keep.conflicts).toEqual(['Cells']);
    expect(keep.populations).toEqual(first);
    const rep = mergeImported(first, changed, null, 'replace');
    expect(rep.populations.length).toBe(2);
    expect(rep.populations.find((p) => p.name === 'Cells')!.gate).toEqual(rect(200));
    // The boolean still points at the same (kept) population id.
    const cellsId = rep.populations.find((p) => p.name === 'Cells')!.id;
    expect(rep.populations.find((p) => p.name === 'NOT Cells')!.gate).toEqual({ type: 'boolean', op: 'not', operands: [{ ref: cellsId }] });
  });
});

describe('a5-04 quadrant names survive a Gating-ML round trip', () => {
  it('the name is written on the QuadrantGate and read back for its quadrant', () => {
    const X = { kind: 'channel' as const, channel: 'FSC-A', transform: { kind: 'linear' as const, T: 1024, A: 0 } };
    const Y = { ...X, channel: 'SSC-A' };
    const pops: Population[] = [{ id: 'q1', name: 'Q1: FSC-A- , SSC-A+', parentId: null, gate: { type: 'quadrant', dims: [X, Y], dividers: [[300], [400]], side: [0, 1] } }];
    const { xml } = exportGatingMl(pops, [], 'none');
    const doc = parseGatingMl(xml);
    const names = gatingMlNames(xml);
    expect(doc.populations.map((p) => names.get(p.id))).toEqual(['Q1: FSC-A- , SSC-A+']);
  });
});

describe('a1-07/a5-02 relink by keywords; remove a sample', () => {
  it('relinks only when the identifying keywords agree', () => {
    expect(relinkMismatch({ $TOT: '283969', $BTIM: '10:00:00' }, { $TOT: '283969', $BTIM: '10:00:00 ' })).toEqual([]);
    expect(relinkMismatch({ $TOT: '283969' }, { $TOT: '1000' })).toEqual(['$TOT']);
    // Keywords recorded on one side only are not compared.
    expect(relinkMismatch({ $TOT: '283969' }, { $DATE: '01-JAN-2020' })).toEqual([]);
  });
  it('removing a sample drops it from every group', () => {
    const ws = emptyWorkspace();
    const s = (id: string) => ({ id, fileName: `${id}.fcs`, fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: {}, channelNames: [], eventCount: 0 });
    ws.samples.push(s('a'), s('b'));
    ws.groups[0].sampleIds = ['a', 'b'];
    ws.groups.push({ id: 'g', name: 'G', sampleIds: ['a'] });
    removeSample(ws, 'a');
    expect(ws.samples.map((x) => x.id)).toEqual(['b']);
    expect(ws.groups.map((g) => g.sampleIds)).toEqual([['b'], []]);
  });
});

describe('a4-02/a4-03 percentile and Number of Peaks limits', () => {
  it('a percentile is an integer from 0 to 100', () => {
    expect([0, 50, 100].every(validPercentile)).toBe(true);
    expect([-1, 150, 2.5, NaN, undefined].some(validPercentile)).toBe(false);
  });
  it('Number of Peaks is an integer from 0 to 10; 0 gives no division, not NaN', () => {
    const v = Float64Array.from({ length: 4000 }, (_, i) => 1e4 * Math.exp(0.05 * Math.sin(i)));
    expect(() => fitProliferation(v, { maxGenerations: -1 })).toThrow(/integer from 0 to 10/);
    expect(() => fitProliferation(v, { maxGenerations: 11 })).toThrow(/integer from 0 to 10/);
    expect(() => fitProliferation(v, { maxGenerations: 2.5 })).toThrow(/integer from 0 to 10/);
    const f = fitProliferation(v, { maxGenerations: 0 });
    expect(f.generations).toHaveLength(1);
    expect(f.pctDivided).toBe(0);
    expect(fitProliferation(v).generations.length).toBeLessThanOrEqual(5); // default 4 peaks
  });
});

describe('a4-06 named statistic templates are saved in the workspace', () => {
  it('survive a save and reopen of the workspace file', () => {
    const ws = emptyWorkspace();
    ws.statTemplates = [{ id: 't1', name: 'CD4 panel', columns: [{ id: 'c1', populationPath: 'Cells', stat: 'percentile', channel: 'FSC-A', percentile: 95 }] }];
    expect(deserializeWorkspace(serializeWorkspace(ws)).statTemplates).toEqual(ws.statTemplates);
  });
});
