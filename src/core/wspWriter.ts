// FlowJo-style .wsp writer. Mirrors the structure observed in FlowJo-saved
// workspaces (see wsp.ts). NOT validated by opening in FlowJo: only
// round-trip tested through this project's reader.
import { experimentXml } from './miflowcyt';
import { writeFigList } from './wspLayout';
import { currentLayout } from './layoutFigures';
import { invert } from './compensation';
import type { SpilloverMatrix } from './compensation';
import { axesFromGate } from './ellipse';
import { fail } from './errors';
import type { Dimension, Gate, Group, GroupCriteria, Population, SavedLayout, Workspace } from './model';
import { connectorText, functionText, MAX_KEYWORD_CRITERIA, roleText } from './groupCriteria';
import { makeTransform, type TransformSpec } from './transforms';
import { kineticsNodeXml } from './kinetics';
import { derivedFormula } from './model';
import { FLOWJO_STAT_NAMES } from './stats';
import { esc } from './xml';
import { scriptsXml } from './fjScript';

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
function fjTransform(spec: TransformSpec | undefined, warn: (m: string) => void, ch: string, timestep: number, range?: [number, number]): { xml: (name: string) => string; spec: TransformSpec; length: number } {
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
      return { spec: { kind: 'none' }, length: 256, xml: (n) => `<transforms:linear transforms:minRange="${range?.[0] ?? 0}" transforms:maxRange="${range?.[1] ?? s.T}" gain="${gain}">${param(n)}</transforms:linear>` };
    default:
      if (s.kind !== 'none') warn(`${ch}: ${s.kind} scale has no observed FlowJo equivalent; written as linear`);
      return { spec: { kind: 'none' }, length: 256, xml: (n) => `<transforms:linear transforms:minRange="${range?.[0] ?? 0}" transforms:maxRange="${range?.[1] ?? 262144}" gain="${gain}">${param(n)}</transforms:linear>` };
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
      if (!scales.has(name)) scales.set(name, fjTransform(ws.channelTransforms[channel], warn, channel, parseFloat(s.keywordsSnapshot['$TIMESTEP'] ?? '') || 0, s.flowjoLinearRanges?.[name]));
      return scales.get(name)!;
    };
    // Channels from the FCS file, or from the workspace scales when the
    // sample's data was never loaded (e.g. an imported .wsp).
    for (const ch of new Set([...s.channelNames, ...Object.keys(ws.channelTransforms)])) {
      scaleFor(ch, ch);
      if (square?.channels.includes(ch)) scaleFor(`${PREFIX}${ch}`, ch);
    }
    // Axes whose FlowJo range was imported (e.g. Time) keep that range.
    for (const name of Object.keys(s.flowjoLinearRanges ?? {})) scaleFor(name, name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name);
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
      if (g.type === 'anchored') {
        warn(`"${path(p)}" is an anchored range; its statistic bounds are not written (FlowJo's statistic reference format is not decoded), skipped`);
        return null;
      }
      if (g.type === 'splineQuadrant') {
        warn(`"${path(p)}" is a spline quadrant; no observed FlowJo equivalent, skipped`);
        return null;
      }
      const inside = p.exclude ? 0 : 1; // FlowJo exclusion gates: observed attribute, unexercised by fixtures
      // FlowJo magnetic gates: magnetic="1" on the gate (specs 10.4); the
      // per-sample offset (adjustX/Y) is recomputed, so it is not written.
      const mag = p.magnetic ? ' magnetic="1"' : '';
      const dims = g.dims as Extract<Dimension, { kind: 'channel' }>[];
      const names = dims.map(nameOf);
      if (g.type === 'rect') {
        if (g.percent) warn(`"${path(p)}" is a percent gate; written with fixed bounds (FlowJo's percent attributes for this case are not decoded)`);
        return `<gating:RectangleGate eventsInside="${inside}"${mag}>${dims.map((d, k) => dimXml(names[k], (g.min[k] !== null ? ` gating:min="${raw(g.min[k]!, d)}"` : '') + (g.max[k] !== null ? ` gating:max="${raw(g.max[k]!, d)}"` : ''))).join('')}</gating:RectangleGate>`;
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
      if (g.type === 'curlyQuad') {
        // gating:CurlyQuad: the centre as the closed bound per axis, the
        // quadrant's outer sides open (specs 10.2); the curve is not saved.
        const up = g.quadrant <= 1, right = g.quadrant === 1 || g.quadrant === 3;
        const bound = (k: number, open: boolean) => dimXml(names[k], open ? ` gating:min="${raw(g.center[k], dims[k])}"` : ` gating:max="${raw(g.center[k], dims[k])}"`);
        return `<gating:CurlyQuad eventsInside="${inside}"${mag}>${bound(0, right)}${bound(1, up)}</gating:CurlyQuad>`;
      }
      if (g.type === 'spider') {
        // Spider quad: one polygon per quadrant with quadId (0 lower-left,
        // 1 lower-right, 2 upper-left, 3 upper-right; specs 10.3).
        const quadId = [2, 3, 0, 1][g.slot];
        return `<gating:PolygonGate eventsInside="${inside}" quadId="${quadId}" gateResolution="${g.grid?.resolution ?? 256}"${mag}>${dimXml(names[0])}${dimXml(names[1])}${g.polygons[g.slot].map(([a, b]) => `<gating:vertex>${coord(raw(a, dims[0]))}${coord(raw(b, dims[1]))}</gating:vertex>`).join('')}</gating:PolygonGate>`;
      }
      if (g.type === 'polygon') {
        return `<gating:PolygonGate eventsInside="${inside}"${mag} gateResolution="${g.grid?.resolution ?? 256}">${dimXml(names[0])}${dimXml(names[1])}${g.vertices.map(([a, b]) => `<gating:vertex>${coord(raw(a, dims[0]))}${coord(raw(b, dims[1]))}</gating:vertex>`).join('')}</gating:PolygonGate>`;
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
          // Edge points: major ends, then minor ends (FlowJo's order); imported
          // FlowJo edges are written back unchanged.
          ...(g.edges?.length === 4 ? g.edges : [
            [e.cx + e.a * ct, e.cy + e.a * st], [e.cx - e.a * ct, e.cy - e.a * st],
            [e.cx - e.b * st, e.cy + e.b * ct], [e.cx + e.b * st, e.cy - e.b * ct],
          ]),
        ].map(([x, y]) => [toDisplay(x, 0), toDisplay(y, 1)]);
        const v = (q: number[]) => `<gating:vertex>${coord(q[0])}${coord(q[1])}</gating:vertex>`;
        // gating:distance semantics in FlowJo are unknown (not 2a in observed files); 2a written.
        const dist = Math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1]);
        return `<gating:EllipsoidGate eventsInside="${inside}" gating:distance="${dist}">${dimXml(names[0])}${dimXml(names[1])}<gating:foci>${v(pts[0])}${v(pts[1])}</gating:foci><gating:edge>${pts.slice(2).map(v).join('')}</gating:edge></gating:EllipsoidGate>`;
      }
      return null;
    };

    // Statistic columns on this population path, with FlowJo's names
    // (specs 8.1); this app's own Min / Max have no FlowJo key.
    const chName = (ch: string) => nameOf({ kind: 'channel', channel: ch, transform: { kind: 'none' } });
    const statsXml = (popPath: string) =>
      ws.statColumns
        .filter((c) => c.populationPath === popPath && c.stat !== 'kinetic')
        .map((c) => {
          const name = FLOWJO_STAT_NAMES[c.stat];
          if (!name) {
            if (si === 0) warnings.push(`Statistic ${c.stat} on "${popPath || 'All events'}" has no FlowJo equivalent; not written`);
            return '';
          }
          const attrs = [`name="${esc(name)}"`];
          if (c.channel) attrs.push(`id="${esc(chName(c.channel))}"`);
          if (c.stat === 'percentile') attrs.push(`percent="${c.percentile ?? 50}"`);
          if (c.stat === 'freqOf' && c.ancestor) attrs.push(`ancestor="${esc(c.ancestor)}"`);
          if (c.stat === 'correlation' && c.correlate) attrs.push(`correlate="${esc(chName(c.correlate))}"`);
          return `<Statistic ${attrs.join(' ')} />`;
        })
        .join('');
    // Derived parameters as FlowJo DerivedParameter nodes in the sample's
    // Subpopulations (specs 12): type algebraic (eventNumber for "Event #"),
    // formula, the raw text in <Formula> and the scale in <Transform>.
    const dpXml = (ws.derivedParameters ?? []).map((d) => {
      // Imported and gate-derived parameters have no formula to write.
      if (d.formula === undefined && !('num' in d)) return '';
      const f = derivedFormula(d);
      const type = f.trim().toUpperCase() === 'EVENT #' ? 'eventNumber' : 'algebraic';
      const t = fjTransform(ws.channelTransforms[d.name] ?? { kind: 'linear', T: d.formula !== undefined ? 1000 : 16, A: 0 }, warn, d.name, 0);
      const inner = `<DerivedParameter name="${esc(d.name)}" type="${type}" formula="${esc(f)}"><Formula>${esc(f)}</Formula><Transform>${t.xml(d.name)}</Transform></DerivedParameter>`;
      return `<DerivedParameter name="${esc(d.name)}">${inner}</DerivedParameter>`;
    }).join('');
    // The population's Kinetics node with its timeslice statistics (specs 11).
    const kinXml = (popPath: string) => {
      const k = ws.kinetics?.[popPath];
      if (!k) return '';
      return kineticsNodeXml(k, ws.statColumns.filter((c) => c.stat === 'kinetic' && c.populationPath === popPath && c.kin).map((c) => c.kin!));
    };
    const node = (parentId: string | null): string => {
      const kids = s.populations.filter((p) => p.parentId === parentId);
      const st = (parentId ? '' : dpXml) + statsXml(parentId ? path(byId.get(parentId)!) : '') + kinXml(parentId ? path(byId.get(parentId)!) : '');
      if (!kids.length) return st ? `<Subpopulations>${st}</Subpopulations>` : '';
      return `<Subpopulations>${st}${kids
        .map((p) => {
          const count = counts?.[p.id];
          const ownerName = p.owningGroup ? ws.groups.find((g) => g.id === p.owningGroup)?.name : undefined;
          const head = `name="${esc(p.name)}"${ownerName ? ` owningGroup="${esc(ownerName)}"` : ''} count="${count ?? -1}"`;
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
  // Live keyword groups are written as FlowJo criteria (plus their current
  // members, as FlowJo saves them); "group by" on an annotation has no FlowJo
  // keyword and is written as members only.
  // FlowJo's texts (specs 7.1); this app's own operators (starts / ends with)
  // have none, so such a group is written with its members only.
  const isKeyword = (k: string) => ws.samples.some((s) => k in s.keywordsSnapshot);
  const criteriaXml = (g: Group): string => {
    const c = g.criteria;
    let crit: GroupCriteria | undefined;
    if (c && 'rules' in c) crit = c;
    else if (c && c.value !== null && isKeyword(c.key)) crit = { rules: [{ connector: 'and', keyword: c.key, op: 'equals', value: c.value }] };
    if (!crit) return '';
    if (crit.rules.some((r) => functionText(r.op) === undefined)) {
      warnings.push(`Group "${g.name}": "starts with" / "ends with" have no FlowJo criterion; written with its current members only`);
      return '';
    }
    if (crit.rules.length > MAX_KEYWORD_CRITERIA) warnings.push(`Group "${g.name}": FlowJo keeps ${MAX_KEYWORD_CRITERIA} criteria; the others are not written`);
    const ref = crit.refGroup ? ` refGroupFunction="${esc(crit.refGroup.fn)}" refGroupName="${esc(crit.refGroup.name)}"` : '';
    const rules = crit.rules.slice(0, MAX_KEYWORD_CRITERIA).map((r) => `<Criterion connector="${esc(connectorText(r.connector))}" keyword="${esc(r.keyword)}" function="${esc(functionText(r.op)!)}" value="${esc(r.value)}" />`).join('');
    const stains = (crit.stains ?? []).map((st) => `<StainCriterion stainId="${esc(st)}" />`).join('');
    return `<Criteria${ref}>${rules}${stains}</Criteria>`;
  };
  const groups = ws.groups
    .map((g) => {
      const crit = g.id === 'all' ? '' : criteriaXml(g);
      const role = (g.role ? ` role="${roleText(g.role)}"` : '') + (g.synchronized ? ' synchronized="1"' : '') + (g.color ? ` foreground="${esc(g.color)}"` : '') + (g.fontStyle ? ` fontStyle="${g.fontStyle}"` : '');
      return `<GroupNode name="${esc(g.name)}"><Group name="${esc(g.name)}"${crit ? ' live="1"' : ''}${role}>${crit}<SampleRefs>${g.sampleIds.map((id) => `<SampleRef sampleID="${ws.samples.findIndex((s) => s.id === id) + 1}" />`).join('')}</SampleRefs></Group></GroupNode>`;
    })
    .join('');
  if (!ws.samples.length) fail('WORKSPACE_INVALID', 'Workspace has no samples to export');
  // The layout (specs 25.4): page, iteration and figures in FlowJo's LayoutEditor element.
  const layoutXml = () => {
    const others = ws.otherLayouts ?? [];
    if (!ws.layout?.length && !ws.layoutPage && !ws.layoutIteration && !others.length) return '';
    const sid = (appId: string | undefined) => String(Math.max(0, ws.samples.findIndex((x) => x.id === appId)) + 1);
    // No sample (plate statistics, unbound charts): the first sample, as sid() does.
    const param = (appId: string | undefined, ch: string) => { const a = appId ?? ws.samples[0]?.id; return a && input.sampleMatrix(a)?.channels.includes(ch) ? `${PREFIX}${ch}` : ch; };
    // One <Layout> per layout (ui-gaps/layout.md); LayoutEditor@current names the current one.
    const one = (l: SavedLayout) => {
      const page = l.layoutPage ?? { paper: 'letter', orientation: 'portrait' };
      const [pw, ph] = page.paper === 'a4' ? [595.3, 841.9] : [612, 792];
      const it = l.layoutIteration ?? { type: 'OFF' as const };
      const iter = `<Iteration iterationType="${it.type}"  iterationValue=""  iterationKeyword="${it.type === 'KEYWORD' ? esc(it.keyword) : ''}"  discriminator="${it.type === 'KEYWORD' && it.discriminator ? esc(it.discriminator) : ''}"  panelSize="${it.type === 'PANEL' ? it.size : 1}"  groupName="${l.layoutGroup ? esc(l.layoutGroup) : 'workspaceSelection'}" />`;
      const figs = writeFigList(l.layout ?? [], l.layoutGrids ?? [], sid, param, { statColumns: ws.statColumns });
      const scale = page.scale && page.scale > 0 ? page.scale : 1;
      return `<Layout name="${esc(l.name)}"  isBatch="0"  showGrid="0"  showRulers="1"  showGuides="0"  showPageBreaks="1"  scale="1" ><PrintLayout rows="1"  columns="1"  padding="36"  scalingMode="${scale === 1 ? 'fj.print.scale.none' : 'fj.print.scale.custom'}"  scaling="${+scale.toFixed(10)}"  orientation="${page.orientation === 'landscape' ? 0 : 1}"  width="${pw}"  height="${ph}" />${iter}${figs}</Layout>`;
    };
    const cur = currentLayout(ws);
    return `<LayoutEditor current="${esc(cur.name)}"  showGrid="0"  showPageBreaks="1"  showGuides="0" >${[cur, ...others].map(one).join('')}</LayoutEditor>`;
  };
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Workspace version="20.0" flowJoVersion="flowjo-rea export (unvalidated)" xmlns:gating="http://www.isac-net.org/std/Gating-ML/v2.0/gating" xmlns:transforms="http://www.isac-net.org/std/Gating-ML/v2.0/transformations" xmlns:data-type="http://www.isac-net.org/std/Gating-ML/v2.0/datatypes">
${columnsXml(ws)}<Groups>${groups}</Groups>
<SampleList>${sampleXml.join('\n')}</SampleList>
${layoutXml()}
${scriptsXml(ws.scripts)}${ws.experiment ? experimentXml(ws.experiment) : ''}
</Workspace>
`;
  return { xml, warnings };
}

// Workspace table columns (FlowJo <Columns>: TColumn width, Property key or
// Keyword name; docs/validation/ui-gaps/workspace.md, T1). Written only when
// the columns differ from the default.
function columnsXml(ws: Workspace): string {
  if (!ws.tableColumns?.length) return '';
  return `<Columns>${ws.tableColumns.map((c) => `<TColumn${c.width ? ` width="${Math.round(c.width)}"` : ''} >${c.key.startsWith('kw:') ? `<Keyword name="${esc(c.key.slice(3))}" />` : `<Property key="${esc(c.key)}" />`}</TColumn>`).join('')}</Columns>\n`;
}
