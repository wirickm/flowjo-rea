// FlowJo-style .wsp writer. Mirrors the structure observed in FlowJo-saved
// workspaces (see wsp.ts). NOT validated by opening in FlowJo: only
// round-trip tested through this project's reader.
import { invert } from './compensation';
import type { SpilloverMatrix } from './compensation';
import { axesFromGate } from './ellipse';
import { fail } from './errors';
import type { Dimension, Gate, Population, Workspace } from './model';
import { makeTransform, type TransformSpec } from './transforms';
import { esc } from './xml';

export interface WspExportInput {
  ws: Workspace;
  // Matrix actually applied to each sample (resolves 'file' to the FCS keyword).
  sampleMatrix: (sampleId: string) => SpilloverMatrix | null;
  counts?: (sampleId: string) => Record<string, number> | undefined; // population id -> count
}

const PREFIX = 'Comp-';

// timestep: the sample's $TIMESTEP. Coordinates are written in this app's
// scale units (Time in seconds), so Time gets gain = $TIMESTEP, which the
// reader (and, per observed files, FlowJo) turns into a unit factor.
function fjTransform(spec: TransformSpec | undefined, warn: (m: string) => void, ch: string, timestep: number): { xml: (name: string) => string; spec: TransformSpec; length: number } {
  const isTime = /^time$/i.test(ch) && timestep > 0;
  const gain = isTime ? timestep : 1;
  const param = (name: string) => `<data-type:parameter data-type:name="${esc(name)}" />`;
  const s = spec ?? { kind: 'none' };
  switch (s.kind) {
    case 'logicle':
      return { spec: s, length: 256, xml: (n) => `<transforms:logicle transforms:length="256" transforms:T="${s.T}" transforms:A="${s.A}" transforms:W="${s.W}" transforms:M="${s.M}">${param(n)}</transforms:logicle>` };
    case 'asinh':
      return { spec: s, length: 256, xml: (n) => `<transforms:fasinh transforms:length="256" transforms:maxRange="${s.T}" transforms:T="${s.T}" transforms:A="${s.A}" transforms:M="${s.M}">${param(n)}</transforms:fasinh>` };
    case 'flowjo-biex':
      return { spec: s, length: 256, xml: (n) => `<transforms:biex transforms:length="256" transforms:maxRange="${s.max}" transforms:neg="${s.neg}" transforms:width="${s.width}" transforms:pos="${s.pos}">${param(n)}</transforms:biex>` };
    case 'flowjo-log':
      return { spec: s, length: 256, xml: (n) => `<transforms:log transforms:length="256" transforms:offset="${s.offset}" transforms:decades="${s.decades}">${param(n)}</transforms:log>` };
    case 'linear':
      return { spec: { kind: 'none' }, length: 256, xml: (n) => `<transforms:linear transforms:minRange="0" transforms:maxRange="${s.T}" gain="${gain}">${param(n)}</transforms:linear>` };
    default:
      if (s.kind !== 'none') warn(`${ch}: ${s.kind} scale has no observed FlowJo equivalent; written as linear`);
      return { spec: { kind: 'none' }, length: 256, xml: (n) => `<transforms:linear transforms:minRange="0" transforms:maxRange="262144" gain="${gain}">${param(n)}</transforms:linear>` };
  }
}

export function writeWsp(input: WspExportInput): { xml: string; warnings: string[] } {
  const { ws } = input;
  const warnings: string[] = [];
  const sampleXml: string[] = [];
  ws.samples.forEach((s, si) => {
    const sid = si + 1;
    const warn = (m: string) => warnings.push(`${s.fileName}: ${m}`);
    const matrix = input.sampleMatrix(s.id);
    if (matrix && matrix.values.length !== matrix.channels.length) {
      warn('spectral matrices are not written; sample exported uncompensated');
    }
    const square = matrix && matrix.values.length === matrix.channels.length ? matrix : null;
    if (square) invert(square.values); // refuse singular matrices
    const nameOf = (d: Extract<Dimension, { kind: 'channel' }>) => {
      const comp = d.compensation ?? s.compensation;
      const compensated = comp !== 'none' && comp !== 'uncompensated' && square?.channels.includes(d.channel);
      return compensated ? `${PREFIX}${d.channel}` : d.channel;
    };
    // One FlowJo scale per parameter name: the workspace display scale.
    const scales = new Map<string, ReturnType<typeof fjTransform>>();
    const scaleFor = (name: string, channel: string) => {
      if (!scales.has(name)) scales.set(name, fjTransform(ws.channelTransforms[channel], warn, channel, parseFloat(s.keywordsSnapshot['$TIMESTEP'] ?? '') || 0));
      return scales.get(name)!;
    };
    // Channels from the FCS file, or from the workspace scales when the
    // sample's data was never loaded (e.g. an imported .wsp).
    for (const ch of new Set([...s.channelNames, ...Object.keys(ws.channelTransforms)])) {
      scaleFor(ch, ch);
      if (square?.channels.includes(ch)) scaleFor(`${PREFIX}${ch}`, ch);
    }
    const byId = new Map(s.populations.map((p) => [p.id, p]));
    const path = (p: Population): string => (p.parentId ? `${path(byId.get(p.parentId)!)}/${p.name}` : p.name);
    const counts = input.counts?.(s.id);

    const raw = (v: number, d: Dimension) => makeTransform(d.transform).inverse(v);
    const coord = (v: number) => `<gating:coordinate data-type:value="${v}" />`;
    const dimXml = (name: string, attrs = '') => `<gating:dimension${attrs}><data-type:fcs-dimension data-type:name="${esc(name)}" /></gating:dimension>`;
    const gateXml = (p: Population): string | null => {
      const g: Gate = p.gate;
      if (g.type === 'boolean') return null;
      if (g.dims.some((d) => d.kind !== 'channel')) {
        warn(`"${path(p)}" uses a ratio dimension; not representable, skipped`);
        return null;
      }
      if (g.type === 'splineQuadrant') {
        warn(`"${path(p)}" is a spline quadrant; no observed FlowJo equivalent, skipped`);
        return null;
      }
      const inside = p.exclude ? 0 : 1; // FlowJo exclusion gates: observed attribute, unexercised by fixtures
      const dims = g.dims as Extract<Dimension, { kind: 'channel' }>[];
      const names = dims.map(nameOf);
      if (g.type === 'rect') {
        return `<gating:RectangleGate eventsInside="${inside}">${dims.map((d, k) => dimXml(names[k], (g.min[k] !== null ? ` gating:min="${raw(g.min[k]!, d)}"` : '') + (g.max[k] !== null ? ` gating:max="${raw(g.max[k]!, d)}"` : ''))).join('')}</gating:RectangleGate>`;
      }
      if (g.type === 'quadrant') {
        // FlowJo stores quadrants as rectangles (observed).
        return `<gating:RectangleGate eventsInside="${inside}">${dims
          .map((d, k) => {
            const div = g.dividers[k];
            const side = g.side[k];
            const lo = side === 0 ? null : raw(div[side - 1], d);
            const hi = side >= div.length ? null : raw(div[side], d);
            return dimXml(names[k], (lo !== null ? ` gating:min="${lo}"` : '') + (hi !== null ? ` gating:max="${hi}"` : ''));
          })
          .join('')}</gating:RectangleGate>`;
      }
      // Polygon and ellipse are evaluated by FlowJo in its display scale.
      dims.forEach((d, k) => {
        const fj = scaleFor(names[k], d.channel);
        const linearish = d.transform.kind === 'linear' || d.transform.kind === 'scale';
        const same = JSON.stringify(fj.spec) === JSON.stringify(linearish ? { kind: 'none' } : d.transform);
        if (!same) warn(`"${path(p)}" was drawn on a ${d.transform.kind} scale but ${names[k]} is exported with a ${fj.spec.kind} scale; FlowJo may interpret the shape differently`);
      });
      if (g.type === 'polygon') {
        return `<gating:PolygonGate eventsInside="${inside}" gateResolution="256">${dimXml(names[0])}${dimXml(names[1])}${g.vertices.map(([a, b]) => `<gating:vertex>${coord(raw(a, dims[0]))}${coord(raw(b, dims[1]))}</gating:vertex>`).join('')}</gating:PolygonGate>`;
      }
      if (g.type === 'ellipsoid') {
        if (dims.length !== 2) {
          warn(`"${path(p)}" is not 2-D; skipped`);
          return null;
        }
        // Display units at length 256: logicle/asinh/log 0..1 x 256, biex 0..4096 / 16, linear x / max x 256.
        const toDisplay = (v: number, k: number) => {
          const d = dims[k];
          const t = d.transform;
          const cs = ws.channelTransforms[d.channel];
          const maxRange = cs?.kind === 'linear' ? cs.T : 262144; // as written in <transforms:linear>
          if (t.kind === 'flowjo-biex') return (v / t.channelRange) * 256;
          if (t.kind === 'linear') return ((v * t.T - t.A) / maxRange) * 256;
          if (t.kind === 'none') return (v / maxRange) * 256;
          if (t.kind === 'scale') return (v / t.factor / maxRange) * 256;
          return v * 256;
        };
        const e = axesFromGate(g.mean, g.cov, g.distanceSquare);
        const c = Math.sqrt(Math.max(0, e.a * e.a - e.b * e.b));
        const ct = Math.cos(e.theta), st = Math.sin(e.theta);
        const pts = [
          [e.cx + c * ct, e.cy + c * st], [e.cx - c * ct, e.cy - c * st], // foci
          [e.cx + e.a * ct, e.cy + e.a * st], [e.cx - e.a * ct, e.cy - e.a * st], // major ends
          [e.cx - e.b * st, e.cy + e.b * ct], [e.cx + e.b * st, e.cy - e.b * ct], // minor ends
        ].map(([x, y]) => [toDisplay(x, 0), toDisplay(y, 1)]);
        const v = (q: number[]) => `<gating:vertex>${coord(q[0])}${coord(q[1])}</gating:vertex>`;
        // gating:distance semantics in FlowJo are unknown (not 2a in observed files); 2a written.
        const dist = Math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1]);
        return `<gating:EllipsoidGate eventsInside="${inside}" gating:distance="${dist}">${dimXml(names[0])}${dimXml(names[1])}<gating:foci>${v(pts[0])}${v(pts[1])}</gating:foci><gating:edge>${pts.slice(2).map(v).join('')}</gating:edge></gating:EllipsoidGate>`;
      }
      return null;
    };

    const node = (parentId: string | null): string => {
      const kids = s.populations.filter((p) => p.parentId === parentId);
      if (!kids.length) return '';
      return `<Subpopulations>${kids
        .map((p) => {
          const count = counts?.[p.id];
          const head = `name="${esc(p.name)}" count="${count ?? -1}"`;
          if (p.gate.type === 'boolean') {
            const tag = p.gate.op === 'and' ? 'AndNode' : p.gate.op === 'or' ? 'OrNode' : 'NotNode';
            if (p.gate.operands.some((o) => o.complement)) warn(`"${path(p)}" uses a complemented operand; FlowJo boolean nodes have no such flag, written without it`);
            const deps = p.gate.operands.map((o) => `<Dependent name="${esc(path(byId.get(o.ref)!))}" />`).join('');
            return `<${tag} ${head}><Dependents>${deps}</Dependents>${node(p.id)}</${tag}>`;
          }
          const gx = gateXml(p);
          if (!gx) return '';
          return `<Population ${head}><Gate>${gx}</Gate>${node(p.id)}</Population>`;
        })
        .join('')}</Subpopulations>`;
    };

    const matrixXml = square
      ? `<transforms:spilloverMatrix spectral="0" prefix="${PREFIX}" name="${esc(square.name)}" suffix="" transforms:id="${esc(square.id.replace(/@\d+$/, ''))}"><data-type:parameters>${square.channels.map((c) => `<data-type:parameter data-type:name="${esc(c)}" />`).join('')}</data-type:parameters>${square.values
          .map((row, i) => `<transforms:spillover data-type:parameter="${esc(square.channels[i])}">${row.map((v, j) => `<transforms:coefficient data-type:parameter="${esc(square.channels[j])}" transforms:value="${v}" />`).join('')}</transforms:spillover>`)
          .join('')}</transforms:spilloverMatrix>`
      : '';
    const tree = node(null); // registers scales used by gates before Transformations is written
    const kw = Object.entries(s.keywordsSnapshot).map(([k, v]) => `<Keyword name="${esc(k)}" value="${esc(v)}" />`).join('');
    const tx = [...scales.entries()].map(([name, t]) => t.xml(name)).join('');
    const total = s.eventCount || -1;
    sampleXml.push(
      `<Sample><DataSet uri="file:/${esc(encodeURIComponent(s.fileName))}" sampleID="${sid}" />${matrixXml}<Transformations>${tx}</Transformations><Keywords>${kw}</Keywords><SampleNode name="${esc(s.fileName)}" count="${total}" sampleID="${sid}">${tree}</SampleNode></Sample>`,
    );
  });
  const groups = ws.groups
    .map((g) => `<GroupNode name="${esc(g.name)}"><Group name="${esc(g.name)}"><SampleRefs>${g.sampleIds.map((id) => `<SampleRef sampleID="${ws.samples.findIndex((s) => s.id === id) + 1}" />`).join('')}</SampleRefs></Group></GroupNode>`)
    .join('');
  if (!ws.samples.length) fail('WORKSPACE_INVALID', 'Workspace has no samples to export');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Workspace version="20.0" flowJoVersion="flowjo-rea export (unvalidated)" xmlns:gating="http://www.isac-net.org/std/Gating-ML/v2.0/gating" xmlns:transforms="http://www.isac-net.org/std/Gating-ML/v2.0/transformations" xmlns:data-type="http://www.isac-net.org/std/Gating-ML/v2.0/datatypes">
<Groups>${groups}</Groups>
<SampleList>${sampleXml.join('\n')}</SampleList>
</Workspace>
`;
  return { xml, warnings };
}
