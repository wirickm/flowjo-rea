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
