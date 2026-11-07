// FlowJo 10.6.2 FACSDiva experiment import and export (WSCommand.IMPORT_DIVA,
// WSCommand.EXPORT_DIVA; classes com.flowjo.diva.*: DivaXMLImporter,
// DivaXMLManipulator, FJtoDivaGateMapper, DivaParamSetting(List),
// DivaCompensationMapper, DivaBiexCalculator). The experiment format is the
// FACSDiva <bdfacs> XML as those classes read and write it; the rules are
// written up in docs/validation/ui-gaps/workspace.md (section O, Diva) and
// implemented independently here.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { invert, type SpilloverMatrix } from './compensation';
import { axesFromGate, handles } from './ellipse';
import { fail } from './errors';
import { newId, populationPath, type Dimension, type Gate, type Population, type SampleState } from './model';
import { makeTransform, type TransformSpec } from './transforms';
import { kid, kids, text, type El } from './xml';

// DivaConstants.DIVA_COLORS: gate colours by gate index.
export const DIVA_COLORS = ['0xff0000', '0x00ff00', '0x0000ff', '0xcf00ff', '0x49ffff', '0x006600', '0x808080', '0xff9900', '0x660066', '0xc8c8c8', '0x669900', '0x993366'];
const LINEAR = 0, LOG = 1, BIEX = 2;
const LIN_MAX = 262143, LOG_MAX = 5.4185380935668945;
// Gate coordinate limits per scale (DivaConstants GATE_MIN/MAX_*).
const GATE_MAX = [262143, 4095, 4095];
const TOP = 262144;
// The Diva biex scale value <-> FlowJo width basis (DivaBiexCalculator):
// export uses log10(262144) - 1 user decades, import 4.5.
export const FJ_DEFAULT_USER_DECADES = Math.log10(TOP) - 1;
export const divaScaleFromFJWidth = (w: number, decades = FJ_DEFAULT_USER_DECADES, top = TOP) => top * 10 ** (Math.log10(-w) - decades);
export const fjWidthFromDivaScale = (s: number, top = TOP, decades = 4.5) => -(10 ** (Math.log10(s / top) + decades));
// FlowJo widths are limited to [-1000, -1] (BiexTransform.getWidthBasisRange).
const clampWidth = (w: number) => (Number.isFinite(w) ? Math.min(-1, Math.max(-1000, w)) : -1);
const biexSpec = (w: number): TransformSpec => ({ kind: 'flowjo-biex', max: TOP, width: clampWidth(w), pos: 4.5, neg: 0, channelRange: 4096 });
// Axis transforms FlowJo sets from a Diva scale (updateFJScalingFromThis).
const axisSpec = (scale: number, w: number): TransformSpec => (scale === LOG ? { kind: 'flowjo-log', offset: 1, decades: LOG_MAX } : scale === BIEX ? biexSpec(w) : { kind: 'linear', T: LIN_MAX, A: 0 });

const isScatter = (n: string) => n.startsWith('FSC') || n.startsWith('SSC');
// isCompensatedParamInDiva: not FSC, SSC or Time, not a width parameter.
const isCompensated = (n: string) => !n.startsWith('FSC') && !n.startsWith('SSC') && !n.startsWith('Time') && !n.endsWith('-W');
// getCorrectedParamNamesForGates: older Diva versions swap the height and width scatter names.
const SWAP: Record<string, string> = { 'FSC-W': 'FSC-H', 'FSC-H': 'FSC-W', 'SSC-W': 'SSC-H', 'SSC-H': 'SSC-W' };
const corrected = (n: string, on: boolean) => (on && SWAP[n] ? SWAP[n] : n);

function parse(xml: string): Document {
  const errs: string[] = [];
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: (m) => errs.push(String(m)), fatalError: (m) => errs.push(String(m)) } }).parseFromString(xml, 'text/xml');
  if (errs.length || !doc.documentElement) fail('XML_INVALID', `The FACSDiva experiment could not be read: ${errs[0] ?? 'no root element'}`);
  return doc;
}
const path = (root: El, names: string[]): El[] => names.reduce<El[]>((acc, n) => acc.flatMap((e) => kids(e, n)), [root]);
function experiment(doc: Document): El {
  const root = doc.documentElement as unknown as El;
  const e = root.localName === 'bdfacs' ? kid(root, 'experiment') : undefined;
  if (!e) fail('XML_INVALID', 'The input XML file is not a valid Diva experiment file.');
  return e;
}
const childText = (e: El, n: string) => { const k = kid(e, n); return k ? text(k) : undefined; };
function setChildText(doc: Document, e: El, n: string, v: string) {
  let k = kid(e, n);
  if (!k) { k = doc.createElement(n) as unknown as El; e.appendChild(k); }
  while (k.firstChild) k.removeChild(k.firstChild);
  k.appendChild(doc.createTextNode(v));
}

// Names offered by the import dialog: worksheet templates (acquisition
// worksheets) and the FCS files of the tubes.
export function divaWorksheetTemplates(xml: string): string[] {
  return path(experiment(parse(xml)), ['acquisition_worksheets', 'worksheet_template']).map((e) => e.getAttribute('name') ?? '');
}
export function divaFcsFiles(xml: string): string[] {
  return path(experiment(parse(xml)), ['specimen', 'tube']).map((t) => childText(t, 'data_filename') ?? '').filter(Boolean);
}

// One Diva parameter (DivaParamSetting).
interface Param { el: El; name: string; scale: number; biexKey: string }
function readParam(el: El, useAuto: boolean): Param {
  const name = el.getAttribute('name') ?? '';
  const log = childText(el, 'is_log') === 'true';
  // updateScalingFromDiva: log scatter is log; any other log parameter is biex.
  const scale = !kid(el, 'is_log') ? LINEAR : log ? (isScatter(name) ? LOG : BIEX) : LINEAR;
  // setBiexScaleValueType: automatic biex uses comp_biexp_scale (compensated
  // parameters) or biexp_scale, otherwise manual_biexp_scale.
  const biexKey = useAuto ? (isCompensated(name) ? 'comp_biexp_scale' : 'biexp_scale') : 'manual_biexp_scale';
  return { el, name, scale, biexKey };
}
const biexScale = (p: Param) => parseInt(childText(p.el, p.biexKey) ?? '-1', 10);
const paramWidth = (p: Param) => fjWidthFromDivaScale(biexScale(p));
// convertScaledToLinear: Diva gate coordinate -> data value.
function toLinear(v: number, scale: number, w: number): number {
  if (scale === LOG) return 10 ** v;
  if (scale === BIEX) return makeTransform(biexSpec(w)).inverse(v);
  return v;
}
// rescaleValues: data value -> Diva gate coordinate, clamped to the scale's range.
function toScaled(v: number, scale: number, w: number): number {
  let y = v;
  if (scale === LOG) y = Math.log10(v);
  else if (scale === BIEX) y = makeTransform(biexSpec(w)).apply(v);
  return Math.min(GATE_MAX[scale], Math.max(0, Number.isNaN(y) ? 0 : y));
}

export interface DivaImportOptions { worksheet: string; fcsFile: string; sampleName: string; paramSettingsOnly?: boolean; correctScatter?: boolean }
export interface DivaImportResult {
  populations: Population[];
  matrix: SpilloverMatrix | null;
  transforms: Record<string, TransformSpec>;
  warnings: string[];
}

// DivaXMLImporter.ImportFromDivaXML for one sample.
export function importDiva(xml: string, o: DivaImportOptions): DivaImportResult {
  const exp = experiment(parse(xml));
  const warnings: string[] = [];
  const tmpl = path(exp, ['acquisition_worksheets', 'worksheet_template']).find((e) => e.getAttribute('name') === o.worksheet);
  if (!tmpl) fail('WORKSPACE_INVALID', 'The acquisition template is missing');
  const tube = path(exp, ['specimen', 'tube']).find((t) => childText(t, 'data_filename') === o.fcsFile);
  if (!tube) fail('WORKSPACE_INVALID', 'The node for the specified data is missing');
  const inst = kid(tube, 'instrument_settings');
  if (!inst) fail('WORKSPACE_INVALID', 'The instrument settings node is missing from the tube node');
  const useAuto = childText(inst, 'use_auto_biexp_scale') === 'true';
  const params = kids(inst, 'parameter').map((e) => readParam(e, useAuto));
  const byName = (n: string | null) => params.find((p) => p.name === n);
  const cs = !!o.correctScatter;

  // Compensation (getCompensationMatrixFromDivaParamNodes, setFJCompMatrixFromDiva):
  // Diva stores the inverse of the spillover matrix, one row per parameter.
  let matrix: SpilloverMatrix | null = null;
  const comp = params.filter((p) => kid(p.el, 'compensation') && kids(kid(p.el, 'compensation')!, 'compensation_coefficient').length);
  if (comp.length) {
    const rows = comp.map((p) => kids(kid(p.el, 'compensation')!, 'compensation_coefficient').map((c) => Number(text(c))));
    if (rows.every((r) => r.length === comp.length && r.every(Number.isFinite))) {
      matrix = { id: newId('mtx'), name: `DivaCompMtx_${o.sampleName}`, channels: comp.map((p) => p.name), values: invert(rows), source: 'FACSDiva', kind: 'spillover' };
    } else warnings.push('The compensation coefficients of the experiment do not form a square matrix; compensation was not imported.');
  }

  const populations: Population[] = [];
  if (!o.paramSettingsOnly) {
    const gates = kids(kid(tmpl, 'gates') ?? tmpl, 'gate');
    const dimOf = (p: Param, scale: number): Dimension => ({ kind: 'channel', channel: corrected(p.name, cs), transform: scale === LINEAR ? { kind: 'none' } : axisSpec(scale, paramWidth(p)) });
    // getX/YParamInfoForGate: the gate's is_*_parameter_log / _scaled set the
    // parameter's scale (log and scaled: biex; log only: log).
    const gateParam = (g: El, axis: 'x' | 'y') => {
      const region = kid(g, 'region');
      const p = byName(region?.getAttribute(`${axis}parm`) ?? null);
      if (!p) return null;
      if (childText(g, `is_${axis}_parameter_log`) === 'true') p.scale = childText(g, `is_${axis}_parameter_scaled`) === 'true' ? BIEX : LOG;
      return p;
    };
    const pts = (g: El) => kids(kid(kid(g, 'region') ?? g, 'points') ?? g, 'point').map((e) => [Number(e.getAttribute('x')), Number(e.getAttribute('y'))] as [number, number]);
    const dimValue = (p: Param, v: number) => { const d = dimOf(p, p.scale); const lin = toLinear(v, p.scale, paramWidth(p)); return d.transform.kind === 'none' ? lin : makeTransform(d.transform).apply(lin); };
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      if (g.getAttribute('fullname') === 'All Events') continue;
      const name = childText(g, 'name') ?? '';
      const parentText = childText(g, 'parent') ?? 'All Events';
      let parentId: string | null = null;
      if (parentText !== 'All Events') {
        const pn = parentText.slice(parentText.lastIndexOf('\\') + 1);
        const par = populations.find((p) => p.name === pn);
        if (par) parentId = par.id;
        else warnings.push(`the parent gate ${pn} was not found for ${name}`);
      }
      const type = (kid(g, 'region')?.getAttribute('type') ?? '').replace('_REGION', '');
      if (g.getAttribute('type') === 'Composite_Classifier') {
        // addQuadGateNodesWithCoords: the region's first point is the centre;
        // bins 0..3 are upper-left, upper-right, lower-left, lower-right.
        const px = gateParam(g, 'x'), py = gateParam(g, 'y');
        const c = pts(g)[0];
        const bins = kids(g, 'bin').map((b) => text(b));
        if (px && py && c && bins.length === 4) {
          const dims = [dimOf(px, px.scale), dimOf(py, py.scale)];
          const dividers = [[dimValue(px, c[0])], [dimValue(py, c[1])]];
          const sides = [[0, 1], [1, 1], [0, 0], [1, 0]];
          bins.forEach((b, k) => populations.push({ id: newId('pop'), name: b.slice(b.lastIndexOf('\\') + 1), parentId, gate: { type: 'quadrant', dims, dividers, side: sides[k] } }));
        } else warnings.push(`Quadrant gate ${name} could not be imported`);
        i += 4; // its four quadrant gates follow and are skipped
        continue;
      }
      const px = gateParam(g, 'x');
      const p = pts(g);
      if (!px || !p.length) { warnings.push(`Gate ${name} uses a parameter that is not in the experiment`); continue; }
      let gate: Gate | null = null;
      if (type === 'INTERVAL') {
        const xs = p.map((q) => q[0]);
        gate = { type: 'rect', dims: [dimOf(px, px.scale)], min: [dimValue(px, Math.min(...xs))], max: [dimValue(px, Math.max(...xs))] };
      } else {
        const py = gateParam(g, 'y');
        if (!py) { warnings.push(`Gate ${name} uses a parameter that is not in the experiment`); continue; }
        const dims: [Dimension, Dimension] = [dimOf(px, px.scale), dimOf(py, py.scale)];
        if (type === 'RECTANGLE') {
          const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
          gate = { type: 'rect', dims, min: [dimValue(px, Math.min(...xs)), dimValue(py, Math.min(...ys))], max: [dimValue(px, Math.max(...xs)), dimValue(py, Math.max(...ys))] };
        } else if (type === 'POLYGON') {
          gate = { type: 'polygon', dims, vertices: p.map((q) => [dimValue(px, q[0]), dimValue(py, q[1])] as [number, number]) };
        } else warnings.push(`Gate ${name}: unsupported gate type ${type}`);
      }
      if (gate) populations.push({ id: newId('pop'), name, parentId, gate });
    }
  }
  // syncParameterScalingFromDivaToFJ: axis scales from the parameter scales.
  const transforms: Record<string, TransformSpec> = {};
  for (const p of params) {
    if (p.scale === BIEX && fjWidthFromDivaScale(biexScale(p)) < -1000) warnings.push(`Warning: the Biexponential width parameter for ${p.name} is outside of the valid range for FlowJo. The value is being reset to the maximum for FlowJo (-1000).`);
    transforms[corrected(p.name, cs)] = axisSpec(p.scale, paramWidth(p));
  }
  return { populations, matrix, transforms, warnings };
}

// Java's Double.toString for the coordinates Diva reads.
export function javaDouble(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e7) { const s = String(v); return s.includes('.') ? s : `${s}.0`; }
  const [m, e] = v.toExponential().split('e');
  return `${m.includes('.') ? m : `${m}.0`}E${Number(e)}`;
}
const fmtDate = (d: Date) => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export interface DivaExportOptions {
  sample: SampleState;
  // Display scale per channel (Workspace.channelTransforms).
  transforms: Record<string, TransformSpec>;
  matrix: SpilloverMatrix | null;
  // Populations whose gates are exported (quadrant gates of the root and of
  // these populations are added as quadrant groups).
  selected: string[];
  counts?: Record<string, number>;
  experimentName: string;
  applyToAll?: boolean;
  correctScatter?: boolean;
  now?: Date;
  random?: () => number;
}

// DivaXMLManipulator.ExportToDiva: a modified copy of an existing experiment
// that includes the sample's FCS file.
export function exportDiva(xml: string, o: DivaExportOptions): { xml: string; messages: string[] } {
  const doc = parse(xml);
  const exp = experiment(doc);
  const messages: string[] = [];
  const now = fmtDate(o.now ?? new Date());
  const cs = !!o.correctScatter;
  const s = o.sample;
  exp.setAttribute('name', o.experimentName);
  for (const ld of path(exp, ['worksheet_config', 'worksheet', 'worksheet_element', 'plot', 'list_data'])) {
    const t = text(ld);
    const k = t.indexOf('.');
    setChildText(doc, ld.parentNode as unknown as El, 'list_data', `${o.experimentName}.${k >= 0 ? t.slice(k + 1) : t}`);
  }
  if (kid(exp, 'date')) setChildText(doc, exp, 'date', now);
  if (kid(exp, 'export_time')) setChildText(doc, exp, 'export_time', now);

  const tube = path(exp, ['specimen', 'tube']).find((t) => childText(t, 'data_filename') === s.fileName);
  if (!tube) fail('WORKSPACE_INVALID', `The experiment does not include ${s.fileName}; the exported experiment must already include the FCS file you are exporting gates for.`);
  const inst = kid(tube, 'instrument_settings');
  if (!inst) fail('WORKSPACE_INVALID', 'The instrument settings node is missing from the tube node');
  const params = kids(inst, 'parameter').map((e) => readParam(e, false));
  const byName = (n: string) => params.find((p) => p.name === n);

  // syncParameterScalingFromFJ / updateScalingFromFJ.
  const fjScale = (t: TransformSpec | undefined): number | null => (!t ? null : t.kind === 'linear' || t.kind === 'none' || t.kind === 'scale' ? LINEAR : t.kind === 'log' || t.kind === 'flowjo-log' ? LOG : t.kind === 'flowjo-biex' ? BIEX : -1);
  const setScale = (p: Param, scale: number) => {
    p.scale = scale;
    setChildText(doc, p.el, 'is_log', scale === LINEAR ? 'false' : 'true');
    setChildText(doc, p.el, 'min', '0.0');
    setChildText(doc, p.el, 'max', String(scale === LINEAR ? `${LIN_MAX}.0` : LOG_MAX));
  };
  for (const p of params) {
    const t = o.transforms[p.name];
    const sc = fjScale(t);
    if (sc === null) continue;
    if (sc < 0) { messages.push(`The FlowJo scaling type, ${t!.kind}, for parameter ${p.name} is not compatible with Diva. The Diva scaling was left unchanged.`); continue; }
    setScale(p, sc);
    if (sc === BIEX && t!.kind === 'flowjo-biex') setChildText(doc, p.el, 'manual_biexp_scale', String(Math.round(Math.fround(divaScaleFromFJWidth(t!.width)))));
  }
  // Diva rules for scatter: A and H scale together; W cannot be log.
  for (const pre of ['FSC-', 'SSC-']) {
    const a = byName(`${pre}A`), h = byName(`${pre}H`), w = byName(`${pre}W`);
    const log = (p?: Param) => !!p && p.scale !== LINEAR;
    if (log(a) !== log(h) && a && h) {
      const other = log(a) ? h : a;
      messages.push(`Warning: Diva does not allow ${pre}A and ${pre}H to have different scaling, so ${other.name} is being exported with Log scaling also.`);
      setScale(other, LOG);
    }
    if (w && log(w)) { messages.push(`Warning: Diva does not allow ${pre}W to be log scaled, so it is being exported with linear scaling`); setScale(w, LINEAR); }
  }

  // copyCompensationFromFJToDiva: per group (area, height) the inverse of the
  // sample's spillover over the compensated parameters, one row per parameter.
  for (const suffix of ['-A', '-H']) {
    const group = params.filter((p) => isCompensated(p.name) && p.name.endsWith(suffix));
    if (!group.length) continue;
    let rows: number[][];
    const m = o.matrix;
    const idx = m ? group.map((p) => m.channels.indexOf(p.name)) : [];
    if (m && idx.every((i) => i >= 0)) rows = invert(idx.map((i) => idx.map((j) => m.values[i][j])));
    else {
      if (m) messages.push(`Error: the parameters {${group.filter((_, k) => idx[k] < 0).map((p) => p.name).join(',')}} cannot be found in the channel list of the compensation matrix in FlowJo.`);
      rows = group.map((_, i) => group.map((__, j) => (i === j ? 1 : 0)));
    }
    group.forEach((p, i) => {
      const old = kid(p.el, 'compensation');
      if (old) p.el.removeChild(old);
      const c = doc.createElement('compensation');
      for (const v of rows[i]) { const e = doc.createElement('compensation_coefficient'); e.appendChild(doc.createTextNode(String(v))); c.appendChild(e); }
      p.el.appendChild(c);
    });
  }
  setChildText(doc, inst, 'use_auto_biexp_scale', 'false');
  const replaceParams = (target: El) => {
    for (const e of kids(target, 'parameter')) target.removeChild(e);
    for (const p of params) target.appendChild(p.el.cloneNode(true));
    setChildText(doc, target, 'use_auto_biexp_scale', 'false');
  };
  if (o.applyToAll) {
    const names = params.map((p) => p.name).join('\n');
    for (const other of path(exp, ['specimen', 'tube', 'instrument_settings'])) {
      if (other === inst) continue;
      if (kids(other, 'parameter').map((e) => e.getAttribute('name')).join('\n') === names) replaceParams(other);
    }
  }

  // CreateWorksheetTemplate: a copy of the first worksheet template named
  // "FlowJo Exported Gates" with All Events and the exported gates.
  const acq = kid(exp, 'acquisition_worksheets');
  const first = acq && kid(acq, 'worksheet_template');
  if (!acq || !first) fail('WORKSPACE_INVALID', 'The experiment has no acquisition worksheet template to copy');
  const wt = first.cloneNode(true) as unknown as El;
  wt.setAttribute('name', 'FlowJo Exported Gates');
  for (const so of kids(wt, 'sort_layout')) wt.removeChild(so);
  const oldGates = kid(wt, 'gates');
  if (oldGates) wt.removeChild(oldGates);
  const gates = doc.createElement('gates') as unknown as El;
  const pops = s.populations;
  const byId = new Map(pops.map((p) => [p.id, p]));
  const fullName = (id: string | null): string => (id ? `All Events\\${populationPath(pops, id).split('/').join('\\')}` : 'All Events');
  const add = (tag: string, attrs: Record<string, string>, children: [string, string][] = []) => {
    const e = doc.createElement(tag) as unknown as El;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const [k, v] of children) { const c = doc.createElement(k); c.appendChild(doc.createTextNode(v)); e.appendChild(c); }
    return e;
  };
  gates.appendChild(add('gate', { fullname: 'All Events', type: 'EventSource_Classifier' }, [['name', 'All Events'], ['color', '0x000000'], ['visible', 'true'], ['dotsize', '0'], ['enabled', 'false'], ['num_events', String(s.eventCount)]]));

  const raw = (d: Dimension, v: number) => (d.kind === 'channel' ? makeTransform(d.transform).inverse(v) : NaN);
  const MAXV = Number.MAX_VALUE;
  const scaleOf = (p: Param | undefined) => p ?? { el: null as unknown as El, name: '', scale: LINEAR, biexKey: 'manual_biexp_scale' };
  const pw = (p: Param) => (p.el ? paramWidth(p) : -1);
  const pointsEl = (ptsv: [number, number][]) => {
    const e = doc.createElement('points');
    for (const [x, y] of ptsv) e.appendChild(add('point', { x: javaDouble(x), y: javaDouble(y) }));
    return e;
  };
  const scaleChildren = (px: Param, py: Param | undefined): [string, string][] => {
    const y = scaleOf(py);
    const sv = (p: Param) => (p.el ? String(biexScale(p)) : '-1');
    return [['is_x_parameter_scaled', String(px.scale === BIEX)], ['is_y_parameter_scaled', String(y.scale === BIEX)], ['is_x_parameter_log', String(px.scale !== LINEAR)], ['is_y_parameter_log', String(y.scale !== LINEAR)], ['x_parameter_scale_value', sv(px)], ['y_parameter_scale_value', sv(y)]];
  };
  const resc = (p: Param, v: number) => toScaled(v, p.scale, pw(p));
  // Gate coordinates (getGateCoordsFromFJPopNode) in Diva gate units.
  const coords = (g: Gate, px: Param, py: Param | undefined): { type: string; pts: [number, number][] } | null => {
    if (g.type === 'rect' && g.dims.length === 1) {
      return { type: 'INTERVAL', pts: [[resc(px, raw(g.dims[0], g.min[0] ?? -Infinity)), 100], [resc(px, raw(g.dims[0], g.max[0] ?? Infinity)), 100]] };
    }
    if (!py) return null;
    const P = (x: number, y: number): [number, number] => [resc(px, x), resc(py, y)];
    if (g.type === 'rect') {
      const [x0, x1] = [g.min[0] === null ? -MAXV : raw(g.dims[0], g.min[0]), g.max[0] === null ? MAXV : raw(g.dims[0], g.max[0])];
      const [y0, y1] = [g.min[1] === null ? -MAXV : raw(g.dims[1], g.min[1]), g.max[1] === null ? MAXV : raw(g.dims[1], g.max[1])];
      return { type: 'RECTANGLE', pts: [P(x0, y1), P(x1, y1), P(x1, y0), P(x0, y0)] };
    }
    if (g.type === 'polygon') return { type: 'POLYGON', pts: g.vertices.map(([x, y]) => P(raw(g.dims[0], x), raw(g.dims[1], y))) };
    if (g.type === 'ellipsoid' && g.dims.length === 2) {
      // The four axis end points, rescaled, then a 20-point outline
      // (calcEllipsePointsFromAxes); exported as a polygon.
      const h = handles(axesFromGate(g.mean, g.cov, g.distanceSquare)).map(([x, y]) => P(raw(g.dims[0], x), raw(g.dims[1], y)));
      return { type: 'POLYGON', pts: ellipsePoints(h) };
    }
    return null;
  };
  const gateNode = (p: Population, color: string, input: string, quadChild: boolean): El | null => {
    const g = p.gate;
    if (g.type === 'boolean' || g.dims.some((d) => d.kind !== 'channel')) { messages.push(`The gate "${p.name}" is not a type that can be exported to Diva.`); return null; }
    const chans = g.dims.map((d) => (d.kind === 'channel' ? d.channel : ''));
    const px = byName(chans[0]), py = chans[1] !== undefined ? byName(chans[1]) : undefined;
    if (!px || (chans[1] !== undefined && !py)) { messages.push(`The gate "${p.name}" cannot be exported because it is defined on one or more parameters that are not in the fcs file.`); return null; }
    let c: { type: string; pts: [number, number][] } | null;
    if (quadChild && g.type === 'quadrant' && py) {
      const cx = raw(g.dims[0], g.dividers[0][0]), cy = raw(g.dims[1], g.dividers[1][0]);
      const [x2, x4] = g.side[0] === 0 ? [-MAXV, cx] : [cx, MAXV];
      const [y6, y8] = g.side[1] === 0 ? [-MAXV, cy] : [cy, MAXV];
      c = { type: 'POLYGON', pts: [[resc(px, x4), resc(py, y6)], [resc(px, x2), resc(py, y6)], [resc(px, x2), resc(py, y8)], [resc(px, x4), resc(py, y8)]] };
    } else c = coords(g, px, py);
    if (!c) { messages.push(`Error in mapFJtoDiva: an unsupported gate type was specified: ${g.type}`); return null; }
    const e = add('gate', { fullname: fullName(p.id), type: 'Region_Classifier' }, [['name', p.name], ['color', color], ['visible', 'true'], ['dotsize', '0'], ['enabled', quadChild ? 'false' : 'true'], ['num_events', String(o.counts?.[p.id] ?? 0)], ['parent', fullName(p.parentId)]]);
    const region = add('region', { name: p.name, xparm: corrected(px.name, cs), yparm: py ? corrected(py.name, cs) : '', type: `${c.type}_REGION` });
    region.appendChild(pointsEl(c.pts));
    e.appendChild(region);
    for (const [k, v] of [...scaleChildren(px, py), ['input', input] as [string, string]]) { const c = doc.createElement(k); c.appendChild(doc.createTextNode(v)); e.appendChild(c); }
    return e;
  };

  const sel = new Set(o.selected);
  const ordered = pops.filter((p) => sel.has(p.id));
  let colorIdx = 0;
  for (const p of ordered) {
    if (p.gate.type === 'quadrant') continue;
    const e = gateNode(p, DIVA_COLORS[colorIdx % DIVA_COLORS.length], fullName(p.parentId), false);
    colorIdx++;
    if (e) gates.appendChild(e);
  }
  // Quadrant groups under the root and under the selected populations.
  const rnd = o.random ?? Math.random;
  const parents = [null, ...ordered.map((p) => p.id)];
  for (const par of parents) {
    const quads = pops.filter((p) => p.parentId === par && p.gate.type === 'quadrant');
    const groups = new Map<string, Population[]>();
    for (const q of quads) { const g = q.gate as Extract<Gate, { type: 'quadrant' }>; const k = JSON.stringify([g.dims, g.dividers]); (groups.get(k) ?? groups.set(k, []).get(k)!).push(q); }
    for (const grp of groups.values()) {
      if (grp.length !== 4 || grp.some((q) => (q.gate as Extract<Gate, { type: 'quadrant' }>).dims.length !== 2)) continue;
      const key = (q: Population) => { const sd = (q.gate as Extract<Gate, { type: 'quadrant' }>).side; return (1 - sd[1]) * 2 + sd[0]; };
      grp.sort((a, b) => key(a) - key(b)); // upper-left, upper-right, lower-left, lower-right
      const g0 = grp[0].gate as Extract<Gate, { type: 'quadrant' }>;
      const chans = g0.dims.map((d) => (d.kind === 'channel' ? d.channel : ''));
      const px = byName(chans[0]), py = byName(chans[1]);
      if (!px || !py) { messages.push(`The gate "${grp[0].name}" cannot be exported because it is defined on one or more parameters that are not in the fcs file.`); continue; }
      let id = '$';
      for (let i = 0; i < 13; i++) id += String(Math.floor(rnd() * 10));
      const compName = `${fullName(par)}\\${id}`;
      const cx = resc(px, raw(g0.dims[0], g0.dividers[0][0])), cy = resc(py, raw(g0.dims[1], g0.dividers[1][0]));
      const ce = add('gate', { fullname: compName, type: 'Composite_Classifier' }, [['name', id], ['color', '0x000000'], ['visible', 'false'], ['dotsize', '0'], ['enabled', 'true'], ['num_events', '0'], ['parent', fullName(par)]]);
      const region = add('region', { name: id, xparm: corrected(px.name, cs), yparm: corrected(py.name, cs), type: 'BINNER_REGION' });
      region.appendChild(pointsEl([[cx, cy], [cx, cy], [cx, cy]]));
      ce.appendChild(region);
      for (const [k, v] of [...scaleChildren(px, py), ...grp.map((q) => ['bin', fullName(q.id)] as [string, string]), ['input', fullName(par)] as [string, string]]) { const c = doc.createElement(k); c.appendChild(doc.createTextNode(v)); ce.appendChild(c); }
      gates.appendChild(ce);
      grp.forEach((q, k) => { const e = gateNode(q, DIVA_COLORS[k % DIVA_COLORS.length], compName, true); if (e) gates.appendChild(e); });
    }
  }
  if (!byId.size && !ordered.length) messages.push('No populations found.');

  const wInst = kid(wt, 'instrument_settings');
  if (wInst) {
    replaceParams(wInst);
    wt.insertBefore(gates, wInst.nextSibling);
  } else wt.appendChild(gates);
  acq.appendChild(wt);
  return { xml: new XMLSerializer().serializeToString(doc), messages };
}

// calcEllipsePointsFromAxes: 20 outline points from the four axis end points
// (the first pair sets the angle and one diameter, the second pair the centre
// and the other diameter; the longer diameter is the major axis).
export function ellipsePoints(p: [number, number][]): [number, number][] {
  const d1 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
  const theta = Math.atan((p[1][1] - p[0][1]) / (p[1][0] - p[0][0]));
  const d2 = Math.hypot(p[3][0] - p[2][0], p[3][1] - p[2][1]);
  const cx = (p[2][0] + p[3][0]) / 2, cy = (p[2][1] + p[3][1]) / 2;
  let a = d1 / 2, b = d2 / 2;
  if (d1 < d2) [a, b] = [b, a];
  const e = a === 0 ? 0 : Math.sqrt(1 - (b * b) / (a * a));
  const e2 = e * e;
  const out: [number, number][] = [];
  for (let i = 0; i < 20; i++) {
    const t = (i / 20) * 2 * Math.PI;
    const r = a * Math.sqrt((1 - e2) / (1 - e2 * Math.cos(t) * Math.cos(t)));
    out.push([cx + r * Math.cos(t + theta), cy + r * Math.sin(t + theta)]);
  }
  return out;
}
