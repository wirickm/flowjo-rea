// .wsp import gaps closed in milestone 6: exclusion gates, statistic nodes,
// keyword-criteria groups; plus spline quadrant membership and the export
// paths for exclusion populations.
import { describe, expect, it } from 'vitest';
import { SampleEngine } from '../src/core/analysis';
import { parseFcs } from '../src/core/fcs';
import { exportGatingMl, parseGatingMl } from '../src/core/gatingml';
import type { Dimension, Gate, Population, SampleState } from '../src/core/model';
import { matchRules } from '../src/core/project';
import { splineInterpolator } from '../src/core/spline';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';
import { haveFixtures, readBytes, readText } from './fixtures';
import { fcsPath } from './wspCompare';

const RECT = 'simple_diamond_example/test_data_diamond_asinh_rect.wsp';

describe.skipIf(!haveFixtures)('.wsp import gaps', () => {
  it('eventsInside="0" imports as an exclusion population: count = parent - inclusive count', () => {
    const xml = readText(RECT);
    const inc = parseWsp(xml);
    const exc = parseWsp(xml.replace(/eventsInside="1"/g, 'eventsInside="0"'));
    const s = exc.workspace.samples[0];
    expect(s.populations[0].exclude).toBe(true);
    const fcs = parseFcs(readBytes(fcsPath('simple_diamond_example', s.fileName)));
    const total = fcs.eventCount;
    const incCount = new SampleEngine(fcs, inc.workspace.samples[0], inc.workspace.matrices).run().results.get('p1')!.count;
    const excCount = new SampleEngine(fcs, s, exc.workspace.matrices).run().results.get('p1')!.count;
    expect(incCount).toBe(inc.flowjoCounts[s.fileName]['upper_right']);
    expect(excCount).toBe(total - incCount);
    expect(exc.warnings.join('\n')).not.toMatch(/eventsInside/);
  });

  it('Statistic nodes become statistics columns (Count observed in fixtures)', () => {
    const imp = parseWsp(readText('8_color_data_set/8_color_ICS_simple.wsp'));
    const cols = imp.workspace.statColumns;
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.every((c) => c.stat === 'count')).toBe(true);
    // Deduplicated across the three samples.
    const keys = cols.map((c) => `${c.populationPath}|${c.stat}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keyword-criteria groups import as live groups and agree with FlowJo-saved membership', () => {
    const imp = parseWsp(readText('8_color_data_set/8_color_ICS_simple.wsp'));
    const g = imp.workspace.groups.find((x) => x.name === 'Compensation')!;
    expect(g.criteria && 'rules' in g.criteria ? g.criteria.rules : []).toEqual([
      { connector: 'and', keyword: '$FIL', op: 'contains', value: 'unstained' },
      { connector: 'or', keyword: '$FIL', op: 'contains', value: 'comp' },
    ]);
    // FlowJo saved no members; no $FIL in these samples matches either rule.
    expect(g.sampleIds).toEqual([]);
    expect(imp.warnings.join('\n')).not.toMatch(/unlike the membership saved/);
  });
});

describe('keyword rules', () => {
  const s = (fil: string): SampleState => ({ id: fil, fileName: fil, fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: { $FIL: fil }, channelNames: [], eventCount: 0 });
  it('combine left to right, case-insensitively', () => {
    const rules = [
      { connector: 'and' as const, keyword: '$FIL', op: 'contains' as const, value: 'unstained' },
      { connector: 'or' as const, keyword: '$FIL', op: 'contains' as const, value: 'comp' },
    ];
    expect(matchRules(s('Unstained.fcs'), rules)).toBe(true);
    expect(matchRules(s('COMP_FITC.fcs'), rules)).toBe(true);
    expect(matchRules(s('sample1.fcs'), rules)).toBe(false);
    expect(matchRules(s('tube_A.fcs'), [{ connector: 'and', keyword: '$FIL', op: 'startsWith', value: 'tube' }, { connector: 'and', keyword: '$FIL', op: 'notContains', value: '_b' }])).toBe(true);
    expect(matchRules(s('x.fcs'), [{ connector: 'and', keyword: '$FIL', op: 'equals', value: 'X.FCS' }])).toBe(true);
  });
});

// Synthetic 4-column FCS-like data for gate evaluation.
function engineFor(xs: number[], ys: number[], populations: Population[]) {
  const fcs = {
    version: 'FCS3.1', eventCount: xs.length, keywords: {}, warnings: [], datasetOffsets: [0],
    channels: [{ name: 'X', label: '', range: 1024 }, { name: 'Y', label: '', range: 1024 }],
    data: [Float64Array.from(xs), Float64Array.from(ys)],
  } as unknown as ConstructorParameters<typeof SampleEngine>[0];
  return new SampleEngine(fcs, { compensation: 'none', populations }, []).run();
}
const X: Dimension = { kind: 'channel', channel: 'X', transform: { kind: 'none' } };
const Y: Dimension = { kind: 'channel', channel: 'Y', transform: { kind: 'none' } };

describe('spline quadrant gate', () => {
  it('interpolator passes through control points, is monotone between them and holds ends', () => {
    const f = splineInterpolator([[0, 0], [1, 1], [2, 4], [3, 4.5]]);
    expect(f(1)).toBeCloseTo(1, 12);
    expect(f(2)).toBeCloseTo(4, 12);
    expect(f(-5)).toBe(0);
    expect(f(10)).toBe(4.5);
    let prev = -Infinity;
    for (let t = 0; t <= 3; t += 0.01) { const v = f(t); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
  });

  it('straight dividers reproduce the ordinary quadrant exactly; the four quadrants partition the events', () => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < 2000; i++) { xs.push((i * 37) % 101); ys.push((i * 53) % 97); }
    const spl = (side: [number, number]): Gate => ({ type: 'splineQuadrant', dims: [X, Y], xDivider: [[50, 0], [50, 50], [50, 100]], yDivider: [[0, 40], [50, 40], [100, 40]], side });
    const quad = (side: number[]): Gate => ({ type: 'quadrant', dims: [X, Y], dividers: [[50], [40]], side });
    const sides: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const pops: Population[] = sides.flatMap((sd, k) => [
      { id: `s${k}`, name: `s${k}`, parentId: null, gate: spl(sd) },
      { id: `q${k}`, name: `q${k}`, parentId: null, gate: quad(sd) },
    ]);
    const eng = engineFor(xs, ys, pops);
    let sum = 0;
    sides.forEach((_, k) => {
      expect(eng.results.get(`s${k}`)!.count).toBe(eng.results.get(`q${k}`)!.count);
      sum += eng.results.get(`s${k}`)!.count;
    });
    expect(sum).toBe(xs.length);
  });

  it('a curved divider classifies points against the spline, not the straight line', () => {
    // Vertical divider bends from x=20 (y=0) to x=80 (y=100).
    const g = (side: [number, number]): Gate => ({ type: 'splineQuadrant', dims: [X, Y], xDivider: [[20, 0], [50, 50], [80, 100]], yDivider: [[0, -1], [100, -1]], side });
    const eng = engineFor([30, 30, 70, 70], [10, 90, 10, 90], [
      { id: 'left', name: 'left', parentId: null, gate: g([0, 1]) },
      { id: 'right', name: 'right', parentId: null, gate: g([1, 1]) },
    ]);
    const left = eng.masks.get('left')!;
    // Divider x(10) = 26, x(90) = 74: (30,10) and (70,10) are right of it;
    // (30,90) and (70,90) are left. A vertical line at x=50 would split them by x.
    expect([...left]).toEqual([0, 1, 0, 1]);
    expect(eng.results.get('right')!.count).toBe(2);
  });
});

describe('exclusion populations export', () => {
  const xs = Array.from({ length: 100 }, (_, i) => i);
  const pops: Population[] = [{ id: 'p1', name: 'NotLow', parentId: null, gate: { type: 'rect', dims: [X], min: [null], max: [30] }, exclude: true }];
  it('evaluates as the complement within the parent', () => {
    expect(engineFor(xs, xs, pops).results.get('p1')!.count).toBe(70);
  });
  it('Gating-ML: written as gate + NOT boolean; re-import reproduces the count', () => {
    const doc = parseGatingMl(exportGatingMl(pops, [], 'none'));
    const p = doc.populations.find((q) => q.id === 'p1')!;
    expect(p.gate.type).toBe('boolean');
    expect(engineFor(xs, xs, doc.populations.map((q) => ({ id: q.id, name: q.name, parentId: q.parentId, gate: q.gate }))).results.get('p1')!.count).toBe(70);
  });
  it('.wsp: written with eventsInside="0"; spline quadrants are skipped with a warning', () => {
    const sample: SampleState = { id: 's1', fileName: 'a.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [...pops, { id: 'sq', name: 'SQ', parentId: null, gate: { type: 'splineQuadrant', dims: [X, Y], xDivider: [[1, 1]], yDivider: [[1, 1]], side: [0, 0] } }], keywordsSnapshot: {}, channelNames: ['X', 'Y'], eventCount: 100 };
    const ws = { format: 'flowjo-rea-workspace', version: 1, name: 'w', samples: [sample], groups: [{ id: 'all', name: 'All Samples', sampleIds: ['s1'] }], matrices: [], channelTransforms: {}, statColumns: [], notes: '', provenance: { warnings: [] } } as const;
    const { xml, warnings } = writeWsp({ ws: structuredClone(ws) as never, sampleMatrix: () => null, counts: () => undefined });
    expect(xml).toContain('eventsInside="0"');
    expect(warnings.join('\n')).toMatch(/spline quadrant/);
    const back = parseWsp(xml);
    expect(back.workspace.samples[0].populations[0].exclude).toBe(true);
  });
});
