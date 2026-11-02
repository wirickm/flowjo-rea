// Derived ratio parameters resolved by the engine in gates and columns.
import { describe, expect, it } from 'vitest';
import { SampleEngine } from '../src/core/analysis';
import type { FcsFile } from '../src/core/fcs';
import type { DerivedParameter } from '../src/core/model';

function fakeFcs(cols: Record<string, number[]>): FcsFile {
  const names = Object.keys(cols);
  const n = cols[names[0]].length;
  return {
    channels: names.map((name, i) => ({ index: i + 1, name, label: '', bits: 32, range: 262144, logDecades: 0, logOffset: 0, gain: 1 })),
    data: names.map((nm) => Float64Array.from(cols[nm])),
    eventCount: n, keywords: {}, version: 'FCS3.1', warnings: [], datasetIndex: 0, datasetOffsets: [0],
  } as unknown as FcsFile;
}

describe('derived parameters', () => {
  const fcs = fakeFcs({ A: [10, 20, 30, 40], B: [1, 2, 3, 4] });
  const derived: DerivedParameter[] = [{ name: 'A_over_B', num: 'A', den: 'B', A: 1, B: 0, C: 0 }];

  it('column() computes A*(num-B)/(den-C)', () => {
    const eng = new SampleEngine(fcs, { compensation: 'none', populations: [] }, [], derived);
    expect([...eng.column('A_over_B')]).toEqual([10, 10, 10, 10]);
    const eng2 = new SampleEngine(fcs, { compensation: 'none', populations: [] }, [], [{ name: 'r', num: 'A', den: 'B', A: 2, B: 5, C: 1 }]);
    // 2*(20-5)/(2-1) = 30
    expect(eng2.column('r')[1]).toBe(30);
  });

  it('a rectangle gate can use a derived parameter as a dimension', () => {
    const eng = new SampleEngine(fcs, {
      compensation: 'none',
      populations: [{ id: 'g', name: 'hi', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'A_over_B', transform: { kind: 'none' } }], min: [9.5], max: [null] } }],
    }, [], derived).run();
    expect(eng.results.get('g')!.count).toBe(4); // all equal 10
  });

  it('reports a clear error for a self-referential or missing source', () => {
    const eng = new SampleEngine(fcs, { compensation: 'none', populations: [] }, [], [{ name: 'x', num: 'x', den: 'B', A: 1, B: 0, C: 0 }]);
    expect(() => eng.column('x')).toThrow(/refers to itself/);
    const eng2 = new SampleEngine(fcs, { compensation: 'none', populations: [] }, [], [{ name: 'y', num: 'Z', den: 'B', A: 1, B: 0, C: 0 }]);
    expect(() => eng2.column('y')).toThrow(/not in this sample/);
  });
});

// UAT a3-03: deleting a derived parameter that gates/statistics use broke them
// silently. The dialog now lists the users first (specs section 6.6).
describe('derived parameter users', () => {
  it('lists gates, statistics and derived parameters that use it', async () => {
    const { emptyWorkspace } = await import('../src/core/model');
    const { derivedParameterUsers } = await import('../src/core/project');
    const ws = emptyWorkspace();
    ws.derivedParameters = [{ name: 'r', num: 'A', den: 'B', A: 1, B: 0, C: 0 }, { name: 'r2', num: 'r', den: 'B', A: 1, B: 0, C: 0 }];
    ws.samples.push({ id: 's', fileName: 'f.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', keywordsSnapshot: {}, channelNames: ['A', 'B'], eventCount: 0,
      populations: [{ id: 'g', name: 'High r', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'r', transform: { kind: 'none' } }], min: [1], max: [null] } }] } as never);
    ws.statColumns.push({ id: 'c', populationPath: 'High r', stat: 'median', channel: 'r' });
    const users = derivedParameterUsers(ws, 'r');
    expect(users).toEqual(['gate "High r"', 'statistic "median (r)" on "High r"', 'derived parameter "r2"']);
    expect(derivedParameterUsers(ws, 'r2')).toEqual([]);
  });
});
