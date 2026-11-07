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
import { emptyWorkspace, type Dimension, type Gate, type GridAxis, type Group, type GroupCriteria, type KeywordRule, type Population, type SampleState, type StatKind, type Workspace } from './model';
import { syncLiveGroups } from './project';
import { connectorFromText, functionFromText, MAX_KEYWORD_CRITERIA, roleFromText } from './groupCriteria';
import { defaultGrid } from './gateGrid';
import { FLOWJO_STAT_NAMES, STAT_NEEDS_CHANNEL } from './stats';
import { makeTransform, type TransformSpec } from './transforms';
import { KIN_BY_NAME, kineticsFromAttrs } from './kinetics';
import { attr, descendants, kid, kids, local, numAttr, parseXml, type El } from './xml';
import { parseFigList } from './wspLayout';
import { parseScriptElements } from './fjScript';

export interface WspImport {
  workspace: Workspace;
  // FlowJo-recorded population counts per sample file name, keyed by path.
  flowjoCounts: Record<string, Record<string, number>>;
  flowjoVersion: string;
  warnings: string[];
}

const RECT_CHANNELS = 4096;

interface ScaleInfo {
  spec: TransformSpec; // used for gate evaluation
  displayLength: number; // FlowJo display resolution for ellipse coordinates
  normalize: (y: number) => number; // spec output -> 0..1 display fraction
  linearRange?: [number, number]; // FlowJo linear axis range (FlowJo units)
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
        out.set(name, { spec, displayLength: 256, normalize: (y) => (y - min) / (max - min), linearRange: [min, max] });
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
  const resolvers = new Map<string, (name: string) => string>(); // FlowJo sampleID -> parameter resolver (layout figures)
  const owners = new Map<Population, string>(); // population -> owning group name
  // Plot settings per population path, from the first sample that has them.
  const plots: NonNullable<Workspace['plots']> = {};

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

    resolvers.set(wspSampleId, (n) => resolveDim(n).channel);
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
      scales.get(name) ?? { spec: { kind: 'none' }, displayLength: 256, normalize: (x) => x / 262144, linearRange: [0, 262144] };

    const pops: Population[] = [];
    const counts: Record<string, number> = {};
    const byPath = new Map<string, string>();
    const pending: { pop: Population; deps: string[] }[] = [];
    let seq = 0;

    const polyAxis = (sc: ScaleInfo, t: ReturnType<typeof makeTransform>): GridAxis => {
      const lr = sc.linearRange;
      if (lr) return { mode: 'round', min: lr[0], max: lr[1] };
      const sp = sc.spec;
      const logicle = sp.kind === 'logicle' ? { logicle: { T: sp.T, W: sp.W, M: sp.M, A: sp.A } } : {};
      return { mode: 'floor', min: t.displayMin, max: t.displayMax, ...logicle };
    };
    // Polygon vertices of a quadrant (quadId 0 lower-left, 1 lower-right,
    // 2 upper-left, 3 upper-right): four siblings on one parameter pair form a
    // spider quad (specs 10.3).
    const spiderParts = new Map<[number, number][], number>();

    const gateFrom = (gEl: El, popName: string): Gate | null => {
      const g = kids(gEl)[0];
      if (!g) return null;
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
          // FlowJo 10 treats a bound that falls on or beyond the first or last
          // channel of a linear axis (4096 channels) as open
          // (docs/validation/flowjo-engine-specs.md section 3).
          const chan = (k: number, v: number) => {
            const lr = scaleOf(names[k]).linearRange!;
            return Math.floor(((v - lr[0]) * RECT_CHANNELS) / (lr[1] - lr[0]) + 0.5);
          };
          const lin = (k: number) => scaleOf(names[k]).linearRange !== undefined;
          const min = dimEls.map((d, k) => {
            const v = numAttr(d, 'min');
            return v === undefined || (lin(k) && chan(k, v) <= 0) ? null : v;
          });
          const max = dimEls.map((d, k) => {
            const v = numAttr(d, 'max');
            return v === undefined || (lin(k) && chan(k, v) >= RECT_CHANNELS) ? null : v;
          });
          // FlowJo 10 has no quadrant object: a quad is a 2-D rectangle with
          // exactly one open bound per axis, and dragging the shared centre
          // moves every quad on the plot (specs section 6.2). Import such a
          // rectangle as one quadrant so the UI moves the four together.
          // Membership is identical: both use [lo, hi) with an open side.
          const oneSided = (k: number) => (min[k] === null) !== (max[k] === null);
          const rawOneSided = (k: number) => (numAttr(dimEls[k], 'min') === undefined) !== (numAttr(dimEls[k], 'max') === undefined);
          if (dims.length === 2 && [0, 1].every((k) => rawOneSided(k) && oneSided(k))) {
            return { type: 'quadrant', dims, dividers: [0, 1].map((k) => [(max[k] ?? min[k])!]), side: [0, 1].map((k) => (max[k] !== null ? 0 : 1)) };
          }
          return { type: 'rect', dims, min, max };
        }
        case 'CurlyQuad': {
          // FlowJo curly quad (specs 10.2): each quadrant stores the centre as
          // its one closed bound per axis; the open sides give the quadrant
          // (both upper bounds set: lower-left, ...). The outline is rebuilt
          // on the axes' display range.
          if (names.length !== 2) fail('WORKSPACE_INVALID', `Curly quad "${popName}" is not 2-D`);
          const sc = names.map(scaleOf);
          const tf = sc.map((x) => makeTransform(x.spec));
          const dims = names.map((n, k) => {
            const r = resolveDim(n);
            return { kind: 'channel' as const, channel: r.channel, compensation: r.comp, transform: sc[k].spec };
          }) as [Dimension, Dimension];
          const lo = dimEls.map((d) => numAttr(d, 'min')), hi = dimEls.map((d) => numAttr(d, 'max'));
          const at = (k: number, v: number) => (sc[k].spec.kind === 'scale' || sc[k].spec.kind === 'none' ? v : tf[k].apply(v));
          const center = [0, 1].map((k) => at(k, (hi[k] ?? lo[k])!)) as [number, number];
          if (center.some((v) => !Number.isFinite(v))) fail('WORKSPACE_INVALID', `Curly quad "${popName}" has no centre`);
          const right = hi[0] === undefined, upper = hi[1] === undefined;
          const quadrant = upper ? (right ? 1 : 0) : right ? 3 : 2;
          const axes = [polyAxis(sc[0], tf[0]), polyAxis(sc[1], tf[1])] as [GridAxis, GridAxis];
          return { type: 'curlyQuad', dims, center, quadrant, frame: [[axes[0].min, axes[0].max], [axes[1].min, axes[1].max]], grid: { resolution: numAttr(g, 'gateResolution') ?? 256, axes } };
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
          // FlowJo 10 evaluates polygons on its gate grid (docs/validation/flowjo-engine-specs.md).
          const resolution = numAttr(g, 'gateResolution') ?? 256;
          const quadId = numAttr(g, 'quadId');
          if (quadId !== undefined && quadId >= 0 && quadId <= 3) spiderParts.set(vertices, quadId);
          return { type: 'polygon', dims, vertices, grid: { resolution, axes: [polyAxis(sc[0], tf[0]), polyAxis(sc[1], tf[1])] } };
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
          // FlowJo 10 gates the ellipse as an outline polygon built from the
          // integer edge points (docs/validation/flowjo-engine-specs.md section 2).
          const grid = edge.length === 4 ? defaultGrid([dims[0], dims[1]]) : undefined;
          return { type: 'ellipsoid', dims, mean: [cx, cy], cov, distanceSquare: 1, ...(grid ? { grid, edges: edge.map((q) => [q[0], q[1]] as [number, number]) } : {}) };
        }
        default:
          sw.push(`Gate type ${local(g)} in "${popName}" is not supported`);
          return null;
      }
    };

    // FlowJo stores, per node, the last plot viewed for that node's events
    // (axes and type); it need not show every child gate. Observed types:
    // Pseudocolor, Histogram; unobserved types map to pseudocolor.
    const graphOf = (container: El, path: string) => {
      const g = kid(container, 'Graph');
      if (!g || path in plots) return;
      const axes = kids(g, 'Axis');
      const axis = (d: string) => {
        const n = axes.find((a) => attr(a, 'dimension') === d);
        const v = n ? attr(n, 'name') ?? '' : '';
        return v ? resolveDim(v).channel : null;
      };
      const type = attr(g, 'type') ?? '';
      const x = axis('x');
      if (!x) return;
      const kind = type === 'Histogram' ? 'histogram' : type === 'Dot' ? 'dot' : type === 'Contour' ? 'contour' : 'pseudocolor';
      if (!['Histogram', 'Dot', 'Contour', 'Pseudocolor'].includes(type)) sw.push(`Plot type "${type}" for "${path || 'All events'}" shown as pseudocolor`);
      plots[path] = { x, y: kind === 'histogram' ? null : axis('y'), kind };
    };

    // Statistic nodes become statistics-table columns (deduplicated across
    // samples). FlowJo writes its StatKey strings (specs 8.1); display names
    // are also accepted.
    const statNode = (st: El, path: string) => {
      const sname = attr(st, 'name') ?? '';
      const stat = WSP_STATS[sname];
      if (!stat) {
        sw.push(`Statistic "${sname}" on "${path || 'All events'}" is not supported; skipped`);
        return;
      }
      const raw = attr(st, 'id') ?? '';
      const channel = STAT_NEEDS_CHANNEL(stat) ? (raw ? resolveDim(raw).channel : '') : undefined;
      if (channel === '') {
        sw.push(`Statistic "${sname}" on "${path || 'All events'}" names no parameter; skipped`);
        return;
      }
      const percentile = stat === 'percentile' ? Number(attr(st, 'percent') ?? 50) : undefined;
      const ancestor = stat === 'freqOf' ? attr(st, 'ancestor') ?? '' : undefined;
      const correlate = stat === 'correlation' ? (attr(st, 'correlate') ? resolveDim(attr(st, 'correlate')!).channel : '') : undefined;
      if (stat === 'correlation' && !correlate) {
        sw.push(`Correlation on "${path || 'All events'}" names no second parameter; skipped`);
        return;
      }
      const dup = ws.statColumns.some((c) => c.populationPath === path && c.stat === stat && c.channel === channel && c.percentile === percentile && c.ancestor === ancestor && c.correlate === correlate);
      if (!dup) ws.statColumns.push({ id: `col${ws.statColumns.length + 1}`, populationPath: path, stat, channel, percentile, ...(ancestor !== undefined ? { ancestor } : {}), ...(correlate !== undefined ? { correlate } : {}) });
    };

    const walk = (container: El, parentId: string | null, parentPath: string) => {
      graphOf(container, parentPath);
      const sub = kid(container, 'Subpopulations');
      if (!sub) return;
      for (const p of kids(sub)) {
        const kind = local(p);
        if (kind === 'Statistic') {
          statNode(p, parentPath);
          continue;
        }
        if (kind === 'DerivedParameter') {
          // FlowJo derived parameter node (specs 12); the inner element holds
          // the definition when present. Shared by name across samples.
          const d = kid(p, 'DerivedParameter') ?? p;
          const name = attr(d, 'name') ?? attr(p, 'name') ?? '';
          const type = attr(d, 'type') ?? (attr(d, 'formula') ? 'algebraic' : '');
          const formula = type === 'eventNumber' ? 'Event #' : type === 'algebraic' || type === 'analytic' ? attr(d, 'formula') ?? '' : undefined;
          if (formula === undefined || !name) sw.push(`Derived parameter "${name}" of type "${type}" is not supported; skipped`);
          else if (!(ws.derivedParameters ?? []).some((x) => x.name === name)) ws.derivedParameters = [...(ws.derivedParameters ?? []), { name, formula }];
          continue;
        }
        if (kind === 'KineticsNode') {
          // FlowJo Kinetics node (specs 11): settings, timeslices and its
          // plat.kin.* statistics; shared by population path across samples.
          const slices = kids(p, 'Timeslice').map((t) => ({ name: attr(t, 'name') ?? '', startTime: Number(attr(t, 'startTime') ?? 0), endTime: Number(attr(t, 'endTime') ?? 0), y: Number(attr(t, 'y') ?? 50), color: attr(t, 'color') ?? '#ff0000' }));
          ws.kinetics = ws.kinetics ?? {};
          if (!ws.kinetics[parentPath]) ws.kinetics[parentPath] = kineticsFromAttrs((n) => attr(p, n), slices);
          for (const st of kids(kid(p, 'Subpopulations') ?? p, 'Statistic')) {
            const key = KIN_BY_NAME[attr(st, 'name') ?? ''];
            const timeslice = attr(st, 'id') ?? '';
            if (key && !ws.statColumns.some((c) => c.stat === 'kinetic' && c.populationPath === parentPath && c.kin?.key === key && c.kin.timeslice === timeslice)) ws.statColumns.push({ id: `col${ws.statColumns.length + 1}`, populationPath: parentPath, stat: 'kinetic', kin: { key, timeslice } });
          }
          continue;
        }
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
          // eventsInside="0" (exclusion): the population is the events outside the gate.
          const exclude = attr(kids(gEl!)[0], 'eventsInside') === '0';
          const magnetic = ['1', 'true'].includes(attr(kids(gEl!)[0], 'magnetic') ?? '');
          const pop: Population = { id, name, parentId, gate, ...(exclude ? { exclude: true } : {}), ...(magnetic ? { magnetic: true } : {}) };
          if (attr(p, 'owningGroup')) owners.set(pop, attr(p, 'owningGroup')!);
          if (attr(p, 'expanded') === '0') pop.collapsed = true;
          pops.push(pop);
        } else {
          const deps = kids(kid(p, 'Dependents') ?? p, 'Dependent').map((d) => attr(d, 'name') ?? '');
          const op = kind === 'AndNode' ? 'and' : kind === 'OrNode' ? 'or' : 'not';
          const pop: Population = { id, name, parentId, gate: { type: 'boolean', op, operands: [] } };
          if (attr(p, 'owningGroup')) owners.set(pop, attr(p, 'owningGroup')!);
          if (attr(p, 'expanded') === '0') pop.collapsed = true;
          pops.push(pop);
          pending.push({ pop, deps });
        }
        walk(p, id, path);
      }
    };
    walk(node, null, '');
    // Spider quads: four sibling quadrant polygons on the same parameters.
    const quadGroups = new Map<string, Population[]>();
    for (const p of pops) {
      if (p.gate.type !== 'polygon' || !spiderParts.has(p.gate.vertices)) continue;
      const k = JSON.stringify([p.parentId, p.gate.dims.map((d) => (d.kind === 'channel' ? d.channel : ''))]);
      quadGroups.set(k, [...(quadGroups.get(k) ?? []), p]);
    }
    for (const group of quadGroups.values()) {
      const slotOf = (p: Population) => [2, 3, 0, 1][spiderParts.get((p.gate as Extract<Gate, { type: 'polygon' }>).vertices)!];
      if (group.length !== 4 || new Set(group.map(slotOf)).size !== 4) continue;
      const sorted = [...group].sort((a, b) => slotOf(a) - slotOf(b));
      const polygons = sorted.map((p) => (p.gate as Extract<Gate, { type: 'polygon' }>).vertices);
      for (const p of group) {
        const pg = p.gate as Extract<Gate, { type: 'polygon' }>;
        p.gate = { type: 'spider', dims: pg.dims, polygons, slot: slotOf(p), grid: pg.grid };
      }
    }
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
    const ranges: Record<string, [number, number]> = {};
    for (const [name, sc] of scales) {
      if (!sc.linearRange) continue;
      const f = sc.spec.kind === 'scale' ? sc.spec.factor : 1;
      ranges[name] = [sc.linearRange[0] / f, sc.linearRange[1] / f];
    }
    if (Object.keys(ranges).length) sample.flowjoLinearRanges = ranges;
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
  // Workspace table columns (FlowJo <Columns>): kept when they differ from Name, Statistic, #Cells.
  const colsEl = kid(root, 'Columns');
  if (colsEl) {
    const cols = kids(colsEl, 'TColumn').map((t) => {
      const kw = kid(t, 'Keyword'), prop = kid(t, 'Property');
      const key = kw && attr(kw, 'name') ? `kw:${attr(kw, 'name')}` : prop ? attr(prop, 'key') : undefined;
      const width = Number(attr(t, 'width'));
      return key ? { key, ...(width > 0 ? { width } : {}) } : null;
    }).filter((c): c is { key: string; width?: number } => !!c);
    const plain = cols.map((c) => c.key).join() === 'fj.appnode.prop.name,fj.appnode.prop.statistic,fj.appnode.prop.ncells';
    if (cols.length && !plain) ws.tableColumns = cols;
  }
  // Scripts (ScriptEditorController.setElement; ui-gaps/workspace.md SCRIPTEDITOR).
  const scriptsEl = kid(root, 'Scripts');
  if (scriptsEl) {
    const scripts = parseScriptElements(kids(scriptsEl, 'Script').map((e) => ({ lang: attr(e, 'lang'), name: attr(e, 'name'), text: (e as unknown as Element).textContent ?? '' })));
    if (scripts.length) ws.scripts = scripts;
  }
  const groupsEl = kid(root, 'Groups');
  for (const g of groupsEl ? kids(groupsEl, 'GroupNode') : []) {
    const gname = attr(g, 'name') ?? 'Group';
    const grp = kid(g, 'Group');
    const refs = grp ? kids(kid(grp, 'SampleRefs') ?? grp, 'SampleRef').map((r) => attr(r, 'sampleID') ?? '') : [];
    const ids = refs.map((r) => sampleIdMap.get(r)).filter((x): x is string => !!x);
    const group: Group = { id: gname === 'All Samples' ? 'all' : `g${groups.length + 1}`, name: gname, sampleIds: gname === 'All Samples' ? ws.samples.map((s) => s.id) : ids };
    if (grp && attr(grp, 'role') !== undefined) group.role = roleFromText(attr(grp, 'role'));
    if (grp && attr(grp, 'synchronized') === '1') group.synchronized = true;
    const fg = grp ? attr(grp, 'foreground') : undefined;
    if (fg && /^#[0-9a-fA-F]{6}$/.test(fg)) group.color = fg.toLowerCase();
    const fs = grp ? attr(grp, 'fontStyle') : undefined;
    if (fs === 'bold' || fs === 'italic' || fs === 'plain') group.fontStyle = fs;
    const crit = grp ? kid(grp, 'Criteria') : undefined;
    if (crit && group.id !== 'all') {
      // FlowJo reads up to 4 Criterion elements and any StainCriterion
      // (plus a stainId attribute); specs 7.1.
      const rules: KeywordRule[] = kids(crit, 'Criterion').slice(0, MAX_KEYWORD_CRITERIA).map((c) => ({
        connector: connectorFromText(attr(c, 'connector')),
        keyword: attr(c, 'keyword') ?? '',
        op: LEGACY_CRITERIA[attr(c, 'function') ?? ''] ?? functionFromText(attr(c, 'function')),
        value: attr(c, 'value') ?? '',
      }));
      const stains = [attr(crit, 'stainId'), ...kids(crit, 'StainCriterion').map((e) => attr(e, 'stainId'))].filter((x): x is string => x !== undefined && x !== null);
      const refName = attr(crit, 'refGroupName');
      const c: GroupCriteria = { rules };
      if (stains.length) c.stains = stains;
      if (refName) c.refGroup = { name: refName, fn: attr(crit, 'refGroupFunction') ?? '' };
      if (rules.length || stains.length || refName) group.criteria = c;
    }
    groups.push(group);
  }
  if (!groups.some((g) => g.id === 'all')) groups.unshift({ id: 'all', name: 'All Samples', sampleIds: ws.samples.map((s) => s.id) });
  ws.groups = groups;
  // Group ownership (owningGroup = group name; specs 7.2).
  const groupIdByName = new Map(groups.map((g) => [g.name, g.id]));
  for (const [pop, owner] of owners) {
    const gid = groupIdByName.get(owner);
    if (gid) pop.owningGroup = gid;
  }
  // Live keyword groups are recomputed from the imported keywords; the saved
  // SampleRefs are replaced (a difference is reported).
  const saved = new Map(groups.map((g) => [g.id, g.sampleIds.join()]));
  syncLiveGroups(ws);
  for (const g of groups) if (g.criteria && saved.get(g.id) !== g.sampleIds.join()) warnings.push(`Group "${g.name}": keyword criteria select ${g.sampleIds.length} samples, unlike the membership saved by FlowJo`);
  ws.plots = plots;
  // Layout editor settings (specs 25.4): the current layout's page and
  // iteration; figures are not imported (no FlowJo-saved example of FigList
  // contents in the fixtures).
  const le = descendants(root, 'LayoutEditor')[0];
  if (le) {
    const layouts = kids(le, 'Layout');
    const cur = layouts.find((l) => attr(l, 'name') === attr(le, 'current')) ?? layouts[0];
    if (cur) {
      const pl = kids(cur, 'PrintLayout')[0];
      if (pl) {
        const w = Number(attr(pl, 'width')), h = Number(attr(pl, 'height'));
        // Java PageFormat: orientation 1 = portrait, 0 = landscape.
        const paper = Math.abs(Math.min(w, h) - 595.3) < 3 && Math.abs(Math.max(w, h) - 841.9) < 3 ? 'a4' : 'letter';
        ws.layoutPage = { paper, orientation: attr(pl, 'orientation') === '0' ? 'landscape' : 'portrait' };
      }
      const it = kids(cur, 'Iteration')[0];
      const type = it ? attr(it, 'iterationType') : undefined;
      if (type === 'SAMPLE') ws.layoutIteration = { type: 'SAMPLE' };
      else if (type === 'KEYWORD' && attr(it!, 'iterationKeyword')) ws.layoutIteration = { type: 'KEYWORD', keyword: attr(it!, 'iterationKeyword')!, ...(attr(it!, 'discriminator') ? { discriminator: attr(it!, 'discriminator') } : {}) };
      else if (type === 'PANEL') ws.layoutIteration = { type: 'PANEL', size: Number(attr(it!, 'panelSize')) || 1 };
      else if (type === 'OFF') ws.layoutIteration = { type: 'OFF' };
    }
    // Figures of the current layout (specs 25.4): charts, text, groups, grids.
    const fl = cur ? kids(cur, 'FigList')[0] : undefined;
    if (fl && kids(fl).length) {
      const r = parseFigList(fl, (sid) => sampleIdMap.get(sid), (sid, name) => (resolvers.get(sid) ?? ((n: string) => n))(name));
      ws.layout = r.items;
      if (r.grids.length) ws.layoutGrids = r.grids;
      warnings.push(...r.warnings.map((w) => `Layout editor: ${w}`));
    }
    if (layouts.length > 1) warnings.push(`Layout editor: ${layouts.length} layouts; the settings of "${attr(cur ?? layouts[0], 'name') ?? 'Layout'}" are used`);
  }
  const flowjoVersion = attr(root, 'flowJoVersion') ?? 'unknown';
  ws.provenance = { importedFrom: `FlowJo workspace (FlowJo ${flowjoVersion}, wsp version ${attr(root, 'version') ?? '?'})`, warnings };
  return { workspace: ws, flowjoCounts, flowjoVersion, warnings };
}

const WSP_STATS: Record<string, StatKind> = {
  // FlowJo's StatKey strings (what FlowJo 10.6.2 writes).
  ...Object.fromEntries(Object.entries(FLOWJO_STAT_NAMES).map(([k, v]) => [v, k as StatKind])),
  // Display names (accepted on import).
  'Freq. of Parent': 'freqParent',
  'Freq. of Grandparent': 'freqGrandparent',
  'Freq. of Total': 'freqTotal',
  'Freq. of': 'freqOf',
};

// Function names written by this app's .wsp export before version 1.1
// (not FlowJo's texts; FlowJo itself would read them as "=").
const LEGACY_CRITERIA: Record<string, KeywordRule['op']> = {
  DoesNotContain: 'notContains',
  Equals: 'equals',
  DoesNotEqual: 'notEquals',
  StartsWith: 'startsWith',
  EndsWith: 'endsWith',
};
