// Shared comparison of this app's counts with the counts FlowJo saved in
// FlowJo-written .wsp files.
import { readdirSync } from 'node:fs';
import { SampleEngine } from '../src/core/analysis';
import { parseFcs, type FcsFile } from '../src/core/fcs';
import { populationPath, type Gate } from '../src/core/model';
import type { TransformSpec } from '../src/core/transforms';
import { parseWsp } from '../src/core/wsp';
import { fk, readBytes, readText } from './fixtures';

const fcsCache = new Map<string, FcsFile>();
export function fcsPath(dir: string, name: string): string {
  return readdirSync(fk(dir)).includes('fcs_files') ? `${dir}/fcs_files/${name}` : `${dir}/${name}`;
}
function loadFcs(dir: string, name: string): FcsFile {
  const key = `${dir}/${name}`;
  if (!fcsCache.has(key)) fcsCache.set(key, parseFcs(readBytes(fcsPath(dir, name))));
  return fcsCache.get(key)!;
}

export const WSP_CASES = [
  'simple_diamond_example/simple_diamond_example_quad_gate.wsp',
  'simple_diamond_example/test_data_diamond_asinh_rect.wsp',
  'simple_diamond_example/test_data_diamond_asinh_rect2.wsp',
  'simple_diamond_example/test_data_diamond_biex_rect.wsp',
  'simple_line_example/simple_poly_and_rect.wsp',
  'simple_line_example/simple_poly_and_rect_v2_poly50.wsp',
  'simple_line_example/single_ellipse_51_events.wsp',
  '8_color_data_set/8_color_ICS_simple.wsp',
  '8_color_data_set/8_color_ICS.wsp',
  '8_color_data_set/8_color_ICS_with_ellipse.wsp',
  '8_color_data_set/8_color_ICS_boolean_gate_testing.wsp',
  '8_color_data_set/8_color_ICS_dot_gate_name.wsp',
  '8_color_data_set/8_color_ICS_sample_without_gates.wsp',
  '8_color_data_set/reused_quad_gate_with_child.wsp',
];

export interface CompareRow {
  sample: string;
  path: string;
  gateType: string; // gate type plus axis scales, e.g. polygon[linear,linear]
  fjParent: number | null; // FlowJo parent count (sample total for top level)
  ourParent: number;
  flowjo: number;
  ours: number;
}

// Label by the FlowJo axis scale of each dimension (rectangles are evaluated
// in raw units, so their own transform is 'none').
export function gateLabel(g: Gate, scales: Record<string, TransformSpec>): string {
  if (g.type === 'boolean') return `boolean-${g.op}`;
  const scale = (k: string) => (k === 'none' || k === 'linear' ? 'linear' : k === 'flowjo-biex' ? 'biex' : k);
  return `${g.type}[${g.dims.map((d) => scale(d.kind === 'channel' ? (scales[d.channel] ?? d.transform).kind : 'ratio')).join(',')}]`;
}

export function compareWsp(path: string) {
  const dir = path.split('/')[0];
  const imp = parseWsp(readText(path));
  const rows: CompareRow[] = [];
  for (const s of imp.workspace.samples) {
    const fcs = loadFcs(dir, s.fileName);
    const eng = new SampleEngine(fcs, s, imp.workspace.matrices).run();
    const fj = imp.flowjoCounts[s.fileName];
    for (const p of s.populations) {
      const key = populationPath(s.populations, p.id);
      const r = eng.results.get(p.id)!;
      if (r.error) throw new Error(`${key}: ${r.error}`);
      // FlowJo writes count="0"/"-1" for nodes it never computed; skip those.
      if (fj[key] === undefined || fj[key] <= 0) continue;
      const parentKey = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : null;
      const fjParent = parentKey === null ? s.eventCount || null : fj[parentKey] > 0 ? fj[parentKey] : null;
      rows.push({ sample: s.fileName, path: key, gateType: gateLabel(p.gate, imp.workspace.channelTransforms), fjParent, ourParent: r.parentCount, flowjo: fj[key], ours: r.count });
    }
  }
  return { imp, rows };
}

// Exact decomposition of ours - flowjo into a part inherited from the parent
// count difference and a part introduced by this gate's own conditional
// frequency: d = fFJ * (Pours - PFJ) + Pours * (fours - fFJ).
export function decompose(r: CompareRow) {
  if (r.fjParent === null) return null;
  const fFJ = r.flowjo / r.fjParent;
  const fOurs = r.ourParent > 0 ? r.ours / r.ourParent : 0;
  return { fFJ, fOurs, inherited: fFJ * (r.ourParent - r.fjParent), introduced: r.ourParent * (fOurs - fFJ) };
}
