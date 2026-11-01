// FlowJo-style .wsp export, round-trip tested through this project's reader.
// This does NOT show that FlowJo accepts the file (external dependency).
import { describe, expect, it } from 'vitest';
import { SampleEngine } from '../src/core/analysis';
import { spilloverFromFcs } from '../src/core/compensation';
import { parseFcs } from '../src/core/fcs';
import { defaultGrid } from '../src/core/gateGrid';
import { emptyWorkspace, populationPath, type Workspace } from '../src/core/model';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';
import { haveFixtures, readBytes, readText } from './fixtures';
import { fcsPath } from './wspCompare';

function countsByPath(ws: Workspace, load: (name: string) => ReturnType<typeof parseFcs>) {
  const out: Record<string, number> = {};
  for (const s of ws.samples) {
    const eng = new SampleEngine(load(s.fileName), s, ws.matrices).run();
    for (const p of s.populations) out[`${s.fileName}|${populationPath(s.populations, p.id)}`] = eng.results.get(p.id)!.count;
  }
  return out;
}

const roundTrip = (ws: Workspace) => {
  const { xml, warnings } = writeWsp({ ws, sampleMatrix: (id) => ws.matrices.find((m) => m.id === ws.samples.find((s) => s.id === id)!.compensation) ?? null });
  return { back: parseWsp(xml).workspace, warnings, xml };
};

describe.skipIf(!haveFixtures)('wsp export round trip (own reader)', () => {
  for (const c of ['8_color_data_set/8_color_ICS_with_ellipse.wsp', '8_color_data_set/8_color_ICS_boolean_gate_testing.wsp', '8_color_data_set/reused_quad_gate_with_child.wsp', 'simple_diamond_example/test_data_diamond_biex_rect.wsp', 'simple_line_example/single_ellipse_51_events.wsp']) {
    it(`FlowJo workspace -> export -> import keeps every count: ${c}`, () => {
      const dir = c.split('/')[0];
      const cache = new Map<string, ReturnType<typeof parseFcs>>();
      const load = (n: string) => cache.get(n) ?? cache.set(n, parseFcs(readBytes(fcsPath(dir, n)))).get(n)!;
      const orig = parseWsp(readText(c)).workspace;
      const { back } = roundTrip(orig);
      const a = countsByPath(orig, load);
      const b = countsByPath(back, load);
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
      for (const k of Object.keys(a)) expect(b[k], k).toBe(a[k]);
    });
  }

  it('app-made gates (rect, polygon and ellipse on logicle, quadrant, boolean) survive export/import', () => {
    const fileName = '101_DEN084Y5_15_E03_009_clean.fcs';
    const fcs = parseFcs(readBytes(`8_color_data_set/fcs_files/${fileName}`));
    const m = spilloverFromFcs(fcs)!;
    const ws = emptyWorkspace();
    const L = { kind: 'logicle' as const, T: 262144, W: 0.5, M: 4.5, A: 0 };
    const lin = { kind: 'linear' as const, T: 262144, A: 0 };
    ws.channelTransforms = { 'FSC-A': lin, 'SSC-A': lin, 'CD3 APC-H7 FLR-A': L, 'CD4 PE-Cy7 FLR-A': L };
    ws.matrices.push({ ...m, id: 'm1' });
    const d = (channel: string, transform: typeof L | typeof lin) => ({ kind: 'channel' as const, channel, transform });
    ws.samples.push({
      id: 's1', fileName, fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'm1', keywordsSnapshot: {}, channelNames: fcs.channels.map((c) => c.name), eventCount: fcs.eventCount,
      populations: [
        { id: 'cells', name: 'Cells', parentId: null, gate: { type: 'rect', dims: [d('FSC-A', lin), d('SSC-A', lin)], min: [0.15, 0.04], max: [0.85, 0.6] } },
        { id: 'poly', name: 'CD3+CD4+', parentId: 'cells', gate: { type: 'polygon', dims: [d('CD3 APC-H7 FLR-A', L), d('CD4 PE-Cy7 FLR-A', L)], vertices: [[0.55, 0.45], [0.95, 0.45], [0.95, 0.95], [0.55, 0.95]], grid: defaultGrid([d('CD3 APC-H7 FLR-A', L), d('CD4 PE-Cy7 FLR-A', L)]) } },
        { id: 'ell', name: 'Ell', parentId: 'cells', gate: { type: 'ellipsoid', dims: [d('CD3 APC-H7 FLR-A', L), d('CD4 PE-Cy7 FLR-A', L)], mean: [0.45, 0.4], cov: [[0.012, 0.005], [0.005, 0.006]], distanceSquare: 1, grid: defaultGrid([d('CD3 APC-H7 FLR-A', L), d('CD4 PE-Cy7 FLR-A', L)]) } },
        ...[0, 1].flatMap((sx) => [0, 1].map((sy) => ({ id: `q${sx}${sy}`, name: `Q${sx}${sy}`, parentId: 'cells', gate: { type: 'quadrant' as const, dims: [d('CD3 APC-H7 FLR-A', L), d('CD4 PE-Cy7 FLR-A', L)], dividers: [[0.5], [0.5]], side: [sx, sy] } }))),
        { id: 'or', name: 'Ell or poly', parentId: 'cells', gate: { type: 'boolean', op: 'or', operands: [{ ref: 'ell' }, { ref: 'poly' }] } },
        { id: 'not', name: 'not poly', parentId: 'cells', gate: { type: 'boolean', op: 'not', operands: [{ ref: 'poly' }] } },
      ],
    });
    ws.groups[0].sampleIds = ['s1'];
    const { back, warnings } = roundTrip(ws);
    expect(warnings).toEqual([]);
    const load = () => fcs;
    const a = countsByPath(ws, load);
    const b = countsByPath(back, load);
    for (const k of Object.keys(a)) expect(b[k], k).toBe(a[k]);
    expect(Object.keys(b).length).toBe(Object.keys(a).length);
  });

  it('warns instead of silently dropping unrepresentable content', () => {
    const ws = emptyWorkspace();
    ws.channelTransforms = { A: { kind: 'hyperlog', T: 262144, W: 0.5, M: 4.5, A: 0 } };
    ws.samples.push({ id: 's', fileName: 'x.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', keywordsSnapshot: {}, channelNames: ['A', 'B'], eventCount: 1, populations: [
      { id: 'r', name: 'ratio', parentId: null, gate: { type: 'rect', dims: [{ kind: 'ratio', num: 'A', den: 'B', A: 1, B: 0, C: 0, transform: { kind: 'none' } }], min: [1], max: [null] } },
    ] });
    const { warnings } = writeWsp({ ws, sampleMatrix: () => null });
    expect(warnings.join(' ')).toMatch(/hyperlog scale has no observed FlowJo equivalent/);
    expect(warnings.join(' ')).toMatch(/ratio dimension/);
  });
});
