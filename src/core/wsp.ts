// FlowJo 10 workspace (.wsp) import. The format is undocumented; this reader
// is derived from FlowJo-saved example workspaces (see
// docs/compatibility-matrix.md for the evidence and what is not covered).
// Observed conventions:
//  - Gate coordinates for rectangle and polygon gates are raw data values.
//  - Ellipse foci/edges are in display space at the transform's "length"
//    (gate resolution, typically 256).
//  - "Comp-" (matrix prefix/suffix) on a parameter name means the
//    compensated channel; quadrants are saved as four rectangle gates.
//  - AndNode/OrNode/NotNode populations reference operands by path.
import type { SpilloverMatrix } from './compensation';
import { fail } from './errors';
import { emptyWorkspace, type Dimension, type Gate, type Group, type Population, type SampleState, type Workspace } from './model';
import { makeTransform, type TransformSpec } from './transforms';
import { attr, kid, kids, local, numAttr, parseXml, type El } from './xml';

export interface WspImport {
  workspace: Workspace;
  // FlowJo-recorded population counts per sample file name, keyed by path.
  flowjoCounts: Record<string, Record<string, number>>;
  flowjoVersion: string;
  warnings: string[];
}

interface ScaleInfo {
  spec: TransformSpec; // used for gate evaluation
  displayLength: number; // FlowJo display resolution for ellipse coordinates
  normalize: (y: number) => number; // spec output -> 0..1 display fraction
}

// timestep: the sample's $TIMESTEP, already applied to Time by the FCS reader.
function parseTransforms(e: El | undefined, warnings: string[], timestep: number): Map<string, ScaleInfo> {
  const out = new Map<string, ScaleInfo>();
  if (!e) return out;
  for (const t of kids(e)) {
    const param = kid(t, 'parameter');
    const name = param ? attr(param, 'name') : undefined;
    if (!name) continue;
    const n = (k: string, d?: number) => {
      const v = numAttr(t, k) ?? d;
      if (v === undefined) fail('WORKSPACE_INVALID', `FlowJo ${local(t)} transform for ${name} lacks ${k}`);
      return v;
    };
    const length = numAttr(t, 'length') ?? 256;
    switch (local(t)) {
      case 'linear': {
        const min = n('minRange', 0);
        const max = n('maxRange', 262144);
        // FlowJo gates on stored value x gain; observed for Time, where gain is a
        // per-sample time scale close to (not equal to) $TIMESTEP.
        const gain = n('gain', 1);
        const factor = /^time$/i.test(name) && timestep > 0 ? gain / timestep : gain;
        const spec: TransformSpec = factor === 1 ? { kind: 'none' } : { kind: 'scale', factor };
        out.set(name, { spec, displayLength: 256, normalize: (y) => (y - min) / (max - min) });
        break;
      }
      case 'logicle':
        out.set(name, { spec: { kind: 'logicle', T: n('T'), W: n('W'), M: n('M'), A: n('A') }, displayLength: length, normalize: (y) => y });
        break;
      case 'fasinh':
        out.set(name, { spec: { kind: 'asinh', T: n('T'), M: n('M'), A: n('A') }, displayLength: length, normalize: (y) => y });
        break;
      case 'biex': {
        const spec: TransformSpec = { kind: 'flowjo-biex', max: n('maxRange', 262144), width: n('width', -10), pos: n('pos', 4.418539922), neg: n('neg', 0), channelRange: 4096 };
        out.set(name, { spec, displayLength: length, normalize: (y) => y / 4096 });
        break;
      }
      case 'log':
        out.set(name, { spec: { kind: 'flowjo-log', offset: n('offset', 1), decades: n('decades', 4.5) }, displayLength: length, normalize: (y) => y });
        break;
      default:
        warnings.push(`FlowJo transform ${local(t)} for ${name} is not supported; using raw scale`);
    }
  }
  return out;
}

function parseMatrix(e: El): SpilloverMatrix & { prefix: string; suffix: string } {
  const params = kids(kid(e, 'parameters') ?? e, 'parameter').map((p) => attr(p, 'name') ?? '');
  const rows = kids(e, 'spillover');
  const values = params.map(() => params.map(() => 0));
  for (const r of rows) {
    const i = params.indexOf(attr(r, 'parameter') ?? '');
    if (i < 0) fail('WORKSPACE_INVALID', `Spillover row for unknown parameter ${attr(r, 'parameter')}`);
    for (const c of kids(r, 'coefficient')) {
      const j = params.indexOf(attr(c, 'parameter') ?? '');
      if (j < 0) fail('WORKSPACE_INVALID', `Spillover coefficient for unknown parameter ${attr(c, 'parameter')}`);
      values[i][j] = Number(attr(c, 'value'));
    }
  }
  if (attr(e, 'spectral') === '1') fail('UNSUPPORTED_FEATURE', 'Spectral (unmixing) matrices are not supported');
  return {
    id: attr(e, 'id') ?? 'wsp-matrix',
    name: attr(e, 'name') ?? 'FlowJo matrix',
    channels: params,
    values,
    source: 'FlowJo workspace',
    prefix: attr(e, 'prefix') ?? 'Comp-',
    suffix: attr(e, 'suffix') ?? '',
  };
}

export function parseWsp(xml: string): WspImport {
  const doc = parseXml(xml);
  const root = doc.documentElement as unknown as El;
  if (local(root) !== 'Workspace') fail('WORKSPACE_INVALID', `Not a FlowJo workspace (root element ${local(root)})`);
  const warnings: string[] = [];
  const ws = emptyWorkspace('Imported FlowJo workspace');
  const flowjoCounts: WspImport['flowjoCounts'] = {};
  const sampleList = kid(root, 'SampleList');
  if (!sampleList) fail('WORKSPACE_INVALID', 'Workspace has no SampleList');
  const sampleIdMap = new Map<string, string>();

  for (const s of kids(sampleList, 'Sample')) {
    const ds = kid(s, 'DataSet');
    const uri = ds ? attr(ds, 'uri') ?? '' : '';
    const fileName = decodeURIComponent(uri.split('/').pop() ?? uri);
    const node = kid(s, 'SampleNode');
    if (!node) continue;
    const wspSampleId = attr(node, 'sampleID') ?? attr(ds!, 'sampleID') ?? '';
    const sw: string[] = [];
    const mEl = kid(s, 'spilloverMatrix');
    const matrix = mEl ? parseMatrix(mEl) : null;
    if (matrix) {
      const { prefix: _p, suffix: _s, ...m } = matrix;
      m.id = `${m.id}@${wspSampleId}`;
      matrix.id = m.id;
      ws.matrices.push(m);
    }
    const keywords: Record<string, string> = {};
    for (const k of kids(kid(s, 'Keywords') ?? s, 'Keyword')) keywords[(attr(k, 'name') ?? '').toUpperCase()] = attr(k, 'value') ?? '';
    const scales = parseTransforms(kid(s, 'Transformations'), sw, parseFloat(keywords['$TIMESTEP'] ?? '') || 0);

    const resolveDim = (name: string): { channel: string; comp: string } => {
      if (matrix) {
        const { prefix, suffix } = matrix;
        if (name.startsWith(prefix) && name.endsWith(suffix) && name.length > prefix.length + suffix.length) {
          const base = name.slice(prefix.length, name.length - suffix.length);
          if (matrix.channels.includes(base)) return { channel: base, comp: matrix.id };
        }
      }
      return { channel: name, comp: 'uncompensated' };
    };
    const scaleOf = (name: string): ScaleInfo =>
      scales.get(name) ?? { spec: { kind: 'none' }, displayLength: 256, normalize: (x) => x / 262144 };

    const pops: Population[] = [];
    const counts: Record<string, number> = {};
    const byPath = new Map<string, string>();
    const pending: { pop: Population; deps: string[] }[] = [];
    let seq = 0;

    const gateFrom = (gEl: El, popName: string): Gate | null => {
      const g = kids(gEl)[0];
      if (!g) return null;
      if (attr(g, 'eventsInside') === '0') sw.push(`Gate "${popName}" uses eventsInside=0 (exclusion); not supported, imported as inclusive`);
      const dimEls = kids(g, 'dimension');
      const names = dimEls.map((d) => attr(kid(d, 'fcs-dimension') ?? d, 'name') ?? '');
      switch (local(g)) {
        case 'RectangleGate': {
          // Coordinates are in FlowJo scale units: raw x gain for linear
          // parameters, raw data values otherwise (monotone, so raw is exact).
          const dims: Dimension[] = names.map((n) => {
            const r = resolveDim(n);
            const sp = scaleOf(n).spec;
            return { kind: 'channel', channel: r.channel, compensation: r.comp, transform: sp.kind === 'scale' ? sp : { kind: 'none' } };
          });
          return { type: 'rect', dims, min: dimEls.map((d) => numAttr(d, 'min') ?? null), max: dimEls.map((d) => numAttr(d, 'max') ?? null) };
        }
        case 'PolygonGate': {
          if (names.length !== 2) fail('WORKSPACE_INVALID', `Polygon gate "${popName}" is not 2-D`);
          const sc = names.map(scaleOf);
          const tf = sc.map((x) => makeTransform(x.spec));
          const dims = names.map((n, k) => {
            const r = resolveDim(n);
            return { kind: 'channel' as const, channel: r.channel, compensation: r.comp, transform: sc[k].spec };
          }) as [Dimension, Dimension];
          const vertices = kids(g, 'vertex').map((v) => {
            const c = kids(v, 'coordinate').map((x) => Number(attr(x, 'value')));
            // Linear (gain) coordinates are already in scaled units.
            const at = (k: number) => (sc[k].spec.kind === 'scale' ? c[k] : tf[k].apply(c[k]));
            return [at(0), at(1)] as [number, number];
          });
          return { type: 'polygon', dims, vertices };
        }
        case 'EllipsoidGate': {
          if (names.length !== 2) fail('WORKSPACE_INVALID', `Ellipse gate "${popName}" is not 2-D`);
          const sc = names.map(scaleOf);
          // Evaluate in normalised display space (0..1 on both axes).
          const dims = names.map((n, k) => {
            const r = resolveDim(n);
            const s0 = sc[k];
            let spec = s0.spec;
            if (spec.kind === 'none' || spec.kind === 'scale') {
              // Display fraction of FlowJo units (raw x gain) over the axis range.
              const top = s0.normalize(1) - s0.normalize(0);
              const gain = spec.kind === 'scale' ? spec.factor : 1;
              spec = { kind: 'linear', T: 1 / (top * gain), A: 0 };
            }
            return { kind: 'channel' as const, channel: r.channel, compensation: r.comp, transform: spec };
          });
          const toDisplay = (pt: number[]) => pt.map((v, k) => {
            const s0 = sc[k];
            const frac = v / s0.displayLength; // 0..1 display fraction
            if (s0.spec.kind === 'flowjo-biex') return frac * 4096;
            return frac;
          });
          const pts = (tag: string) => kids(kid(g, tag)!, 'vertex').map((v) => toDisplay(kids(v, 'coordinate').map((x) => Number(attr(x, 'value')))));
          const foci = pts('foci');
          const edge = pts('edge');
          if (foci.length !== 2 || edge.length < 2) fail('WORKSPACE_INVALID', `Ellipse gate "${popName}" lacks foci or edge vertices`);
          if (sc[1].displayLength !== sc[0].displayLength) sw.push(`Ellipse "${popName}" mixes display resolutions`);
          // Observed in FlowJo-saved files: the first two edge vertices are the
          // major-axis endpoints (gating:distance is not 2a), foci give c.
          const a = Math.hypot(edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]) / 2;
          const cx = (foci[0][0] + foci[1][0]) / 2;
          const cy = (foci[0][1] + foci[1][1]) / 2;
          const dx = foci[1][0] - foci[0][0];
          const dy = foci[1][1] - foci[0][1];
          const c = Math.hypot(dx, dy) / 2;
          const b2 = a * a - c * c;
          if (!(b2 > 0)) fail('WORKSPACE_INVALID', `Ellipse gate "${popName}" is degenerate`);
          const th = Math.atan2(dy, dx);
          const ct = Math.cos(th);
          const st = Math.sin(th);
          const a2 = a * a;
          const cov = [
            [a2 * ct * ct + b2 * st * st, (a2 - b2) * ct * st],
            [(a2 - b2) * ct * st, a2 * st * st + b2 * ct * ct],
          ];
          return { type: 'ellipsoid', dims, mean: [cx, cy], cov, distanceSquare: 1 };
        }
        default:
          sw.push(`Gate type ${local(g)} in "${popName}" is not supported`);
          return null;
      }
    };

    const walk = (container: El, parentId: string | null, parentPath: string) => {
      const sub = kid(container, 'Subpopulations');
      if (!sub) return;
      for (const p of kids(sub)) {
        const kind = local(p);
        if (!['Population', 'AndNode', 'OrNode', 'NotNode'].includes(kind)) continue;
        const name = attr(p, 'name') ?? '';
        const path = parentPath ? `${parentPath}/${name}` : name;
        const id = `p${++seq}`;
        const count = numAttr(p, 'count');
        if (count !== undefined) counts[path] = count;
        byPath.set(path, id);
        if (kind === 'Population') {
          const gEl = kid(p, 'Gate');
          const gate = gEl ? gateFrom(gEl, name) : null;
          if (!gate) {
            sw.push(`Population "${path}" has no supported gate; skipped with its children`);
            continue;
          }
          pops.push({ id, name, parentId, gate });
        } else {
          const deps = kids(kid(p, 'Dependents') ?? p, 'Dependent').map((d) => attr(d, 'name') ?? '');
          const op = kind === 'AndNode' ? 'and' : kind === 'OrNode' ? 'or' : 'not';
          const pop: Population = { id, name, parentId, gate: { type: 'boolean', op, operands: [] } };
          pops.push(pop);
          pending.push({ pop, deps });
        }
        walk(p, id, path);
      }
    };
    walk(node, null, '');
    for (const { pop, deps } of pending) {
      const g = pop.gate as Extract<Gate, { type: 'boolean' }>;
      for (const d of deps) {
        const ref = byPath.get(d);
        if (!ref) {
          sw.push(`Boolean "${pop.name}" references unknown population ${d}`);
          continue;
        }
        g.operands.push({ ref });
      }
    }
    const id = `s${ws.samples.length + 1}`;
    sampleIdMap.set(wspSampleId, id);
    const sample: SampleState = {
      id,
      fileName,
      fileSize: 0,
      fingerprint: '',
      datasetIndex: 0,
      compensation: matrix ? matrix.id : 'none',
      populations: pops,
      keywordsSnapshot: keywords,
      channelNames: [],
      eventCount: numAttr(node, 'count') ?? 0,
    };
    ws.samples.push(sample);
    flowjoCounts[fileName] = counts;
    for (const [ch, sc] of scales) {
      const r = resolveDim(ch);
      // Gains are gate-evaluation details, not display scales.
      if (!(r.channel in ws.channelTransforms) && sc.spec.kind !== 'none' && sc.spec.kind !== 'scale') ws.channelTransforms[r.channel] = sc.spec;
    }
    warnings.push(...sw.map((w) => `${fileName}: ${w}`));
  }

  // Groups and their sample membership.
  const groups: Group[] = [];
  const groupsEl = kid(root, 'Groups');
  for (const g of groupsEl ? kids(groupsEl, 'GroupNode') : []) {
    const gname = attr(g, 'name') ?? 'Group';
    const grp = kid(g, 'Group');
    const refs = grp ? kids(kid(grp, 'SampleRefs') ?? grp, 'SampleRef').map((r) => attr(r, 'sampleID') ?? '') : [];
    const ids = refs.map((r) => sampleIdMap.get(r)).filter((x): x is string => !!x);
    groups.push({ id: gname === 'All Samples' ? 'all' : `g${groups.length + 1}`, name: gname, sampleIds: gname === 'All Samples' ? ws.samples.map((s) => s.id) : ids });
  }
  if (!groups.some((g) => g.id === 'all')) groups.unshift({ id: 'all', name: 'All Samples', sampleIds: ws.samples.map((s) => s.id) });
  ws.groups = groups;
  const flowjoVersion = attr(root, 'flowJoVersion') ?? 'unknown';
  ws.provenance = { importedFrom: `FlowJo workspace (FlowJo ${flowjoVersion}, wsp version ${attr(root, 'version') ?? '?'})`, warnings };
  return { workspace: ws, flowjoCounts, flowjoVersion, warnings };
}
