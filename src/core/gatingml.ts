// ISAC Gating-ML 2.0 import/export (Spidlen et al., Cytometry A 2015).
import type { SpilloverMatrix } from './compensation';
import { fail } from './errors';
import type { Dimension, Gate, Population } from './model';
import type { TransformSpec } from './transforms';
import { attr, esc, kid, kids, local, numAttr, parseXml, text, type El } from './xml';

export interface GatingMlDoc {
  populations: Population[]; // id and name are the Gating-ML gate id
  matrices: SpilloverMatrix[];
  warnings: string[];
}

interface RatioDef {
  num: string;
  den: string;
  A: number;
  B: number;
  C: number;
}

function parseTransform(e: El): TransformSpec | RatioDef {
  const t = kids(e)[0];
  if (!t) fail('XML_INVALID', 'Empty transformation element');
  const n = (k: string) => {
    const v = numAttr(t, k);
    if (v === undefined) fail('XML_INVALID', `Transformation ${local(t)} is missing ${k}`);
    return v;
  };
  switch (local(t)) {
    case 'flin':
      return { kind: 'linear', T: n('T'), A: n('A') };
    case 'flog':
      return { kind: 'log', T: n('T'), M: n('M') };
    case 'fasinh':
      return { kind: 'asinh', T: n('T'), M: n('M'), A: n('A') };
    case 'logicle':
      return { kind: 'logicle', T: n('T'), W: n('W'), M: n('M'), A: n('A') };
    case 'hyperlog':
      return { kind: 'hyperlog', T: n('T'), W: n('W'), M: n('M'), A: n('A') };
    case 'fratio': {
      const dims = kids(t, 'fcs-dimension').map((d) => attr(d, 'name') ?? '');
      if (dims.length !== 2) fail('XML_INVALID', 'fratio needs two fcs-dimensions');
      return { num: dims[0], den: dims[1], A: n('A'), B: n('B'), C: n('C') };
    }
    default:
      fail('UNSUPPORTED_FEATURE', `Gating-ML transformation ${local(t)} is not supported`);
  }
}

export function parseGatingMl(xml: string): GatingMlDoc {
  const doc = parseXml(xml);
  const root = doc.documentElement as unknown as El;
  const warnings: string[] = [];
  const transforms = new Map<string, TransformSpec | RatioDef>();
  const matrices: SpilloverMatrix[] = [];

  for (const e of kids(root)) {
    const name = local(e);
    if (name === 'transformation') transforms.set(attr(e, 'id') ?? '', parseTransform(e));
    if (name === 'spectrumMatrix') {
      const fl = kid(e, 'fluorochromes');
      const de = kid(e, 'detectors');
      if (!fl || !de) fail('XML_INVALID', 'spectrumMatrix needs fluorochromes and detectors');
      const outputs = kids(fl, 'fcs-dimension').map((d) => attr(d, 'name') ?? '');
      const detectors = kids(de, 'fcs-dimension').map((d) => attr(d, 'name') ?? '');
      const rows = kids(e, 'spectrum').map((s) => kids(s, 'coefficient').map((c) => Number(attr(c, 'value'))));
      if (attr(e, 'matrix-inverted-already') === 'true') {
        fail('UNSUPPORTED_FEATURE', 'Pre-inverted spectrum matrices are not supported');
      }
      matrices.push({ id: attr(e, 'id') ?? `m${matrices.length}`, name: attr(e, 'id') ?? 'Gating-ML matrix', channels: detectors, outputNames: outputs, values: rows, source: 'Gating-ML spectrumMatrix' });
    }
  }

  const dimOf = (d: El): Dimension => {
    const comp = attr(d, 'compensation-ref') ?? 'uncompensated';
    const tref = attr(d, 'transformation-ref');
    let transform: TransformSpec = { kind: 'none' };
    if (tref) {
      const t = transforms.get(tref);
      if (!t || !('kind' in t)) fail('XML_INVALID', `Unknown scale transformation ${tref}`);
      transform = t;
    }
    const fcsDim = kid(d, 'fcs-dimension');
    if (fcsDim) return { kind: 'channel', channel: attr(fcsDim, 'name') ?? '', transform, compensation: comp };
    const nd = kid(d, 'new-dimension');
    if (nd) {
      const r = transforms.get(attr(nd, 'transformation-ref') ?? '');
      if (!r || 'kind' in r) fail('XML_INVALID', 'new-dimension must reference an fratio transformation');
      return { kind: 'ratio', ...r, transform, compensation: comp };
    }
    fail('XML_INVALID', 'Gate dimension has no fcs-dimension or new-dimension');
  };

  const pops: Population[] = [];
  const add = (id: string, parent: string | undefined, gate: Gate) => pops.push({ id, name: id, parentId: parent ?? null, gate });
  for (const e of kids(root)) {
    const name = local(e);
    if (!name.endsWith('Gate')) continue;
    const id = attr(e, 'id');
    if (!id) fail('XML_INVALID', `${name} without gating:id`);
    const parent = attr(e, 'parent_id');
    const dims = kids(e, 'dimension');
    switch (name) {
      case 'RectangleGate':
        add(id, parent, {
          type: 'rect',
          dims: dims.map(dimOf),
          min: dims.map((d) => numAttr(d, 'min') ?? null),
          max: dims.map((d) => numAttr(d, 'max') ?? null),
        });
        break;
      case 'PolygonGate': {
        if (dims.length !== 2) fail('XML_INVALID', `PolygonGate ${id} must have 2 dimensions`);
        const vertices = kids(e, 'vertex').map((v) => kids(v, 'coordinate').map((c) => Number(attr(c, 'value'))) as [number, number]);
        add(id, parent, { type: 'polygon', dims: [dimOf(dims[0]), dimOf(dims[1])], vertices });
        break;
      }
      case 'EllipsoidGate': {
        const mean = kids(kid(e, 'mean')!, 'coordinate').map((c) => Number(attr(c, 'value')));
        const cov = kids(kid(e, 'covarianceMatrix')!, 'row').map((r) => kids(r, 'entry').map((c) => Number(attr(c, 'value'))));
        const ds = Number(attr(kid(e, 'distanceSquare')!, 'value'));
        add(id, parent, { type: 'ellipsoid', dims: dims.map(dimOf), mean, cov, distanceSquare: ds });
        break;
      }
      case 'QuadrantGate': {
        const divs = kids(e, 'divider');
        const divIds = divs.map((d) => attr(d, 'id') ?? '');
        const ddims = divs.map(dimOf);
        const values = divs.map((d) => kids(d, 'value').map((v) => Number(text(v))).sort((a, b) => a - b));
        for (const q of kids(e, 'Quadrant')) {
          const qid = attr(q, 'id') ?? '';
          const pos = kids(q, 'position');
          const qd: Dimension[] = [];
          const qdiv: number[][] = [];
          const side: number[] = [];
          for (const p of pos) {
            const k = divIds.indexOf(attr(p, 'divider_ref') ?? '');
            if (k < 0) fail('XML_INVALID', `Quadrant ${qid} references unknown divider`);
            const loc = Number(attr(p, 'location'));
            const vals = values[k];
            let s = 0;
            while (s < vals.length && loc >= vals[s]) s++;
            qd.push(ddims[k]);
            qdiv.push(vals);
            side.push(s);
          }
          add(qid, parent, { type: 'quadrant', dims: qd, dividers: qdiv, side });
        }
        break;
      }
      case 'BooleanGate': {
        const opEl = kids(e)[0] && kids(e).find((k) => ['and', 'or', 'not'].includes(local(k)));
        if (!opEl) fail('XML_INVALID', `BooleanGate ${id} has no and/or/not`);
        const operands = kids(opEl, 'gateReference').map((r) => ({ ref: attr(r, 'ref') ?? '', complement: attr(r, 'use-as-complement') === 'true' }));
        add(id, parent, { type: 'boolean', op: local(opEl) as 'and' | 'or' | 'not', operands });
        break;
      }
      default:
        warnings.push(`Unsupported gate element ${name} (${id}) skipped`);
    }
  }
  return { populations: pops, matrices, warnings };
}

// --- Export ------------------------------------------------------------------

function transformXml(id: string, t: TransformSpec): string {
  const a = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `transforms:${k}="${v}"`).join(' ');
  switch (t.kind) {
    case 'linear':
      return `<transforms:transformation transforms:id="${id}"><transforms:flin ${a({ T: t.T, A: t.A })}/></transforms:transformation>`;
    case 'log':
      return `<transforms:transformation transforms:id="${id}"><transforms:flog ${a({ T: t.T, M: t.M })}/></transforms:transformation>`;
    case 'asinh':
      return `<transforms:transformation transforms:id="${id}"><transforms:fasinh ${a({ T: t.T, M: t.M, A: t.A })}/></transforms:transformation>`;
    case 'logicle':
      return `<transforms:transformation transforms:id="${id}"><transforms:logicle ${a({ T: t.T, W: t.W, M: t.M, A: t.A })}/></transforms:transformation>`;
    case 'hyperlog':
      return `<transforms:transformation transforms:id="${id}"><transforms:hyperlog ${a({ T: t.T, W: t.W, M: t.M, A: t.A })}/></transforms:transformation>`;
    default:
      fail('UNSUPPORTED_FEATURE', `Transform ${t.kind} has no Gating-ML 2.0 representation`);
  }
}

// Export populations of one sample. FlowJo-specific scales (biex, FlowJo log)
// and ratio dimensions are rejected rather than approximated.
export function exportGatingMl(pops: Population[], matrices: SpilloverMatrix[], sampleComp: string): string {
  const tx = new Map<string, string>();
  const parts: string[] = [];
  const usedMatrices = new Set<string>();
  const tref = (t: TransformSpec) => {
    if (t.kind === 'none') return '';
    const key = JSON.stringify(t);
    if (!tx.has(key)) tx.set(key, `T${tx.size + 1}`);
    return ` gating:transformation-ref="${tx.get(key)}"`;
  };
  const compRef = (d: Dimension) => {
    const c = d.compensation ?? sampleComp;
    if (c === 'none' || c === 'uncompensated') return 'uncompensated';
    if (c === 'file' || c === 'FCS') return 'FCS';
    usedMatrices.add(c);
    return c;
  };
  const dimXml = (d: Dimension, extra = '') => {
    if (d.kind !== 'channel') fail('UNSUPPORTED_FEATURE', 'Ratio dimensions are not exported');
    return `<gating:dimension gating:compensation-ref="${esc(compRef(d))}"${tref(d.transform)}${extra}><data-type:fcs-dimension data-type:name="${esc(d.channel)}"/></gating:dimension>`;
  };
  const coord = (v: number) => `<gating:coordinate data-type:value="${v}"/>`;
  for (const p of pops) {
    const g = p.gate;
    const head = `gating:id="${esc(p.id)}"${p.parentId ? ` gating:parent_id="${esc(p.parentId)}"` : ''}`;
    const nameInfo = `<data-type:custom_info><name>${esc(p.name)}</name></data-type:custom_info>`;
    if (g.type === 'rect') {
      const dims = g.dims
        .map((d, k) => dimXml(d, (g.min[k] !== null ? ` gating:min="${g.min[k]}"` : '') + (g.max[k] !== null ? ` gating:max="${g.max[k]}"` : '')))
        .join('');
      parts.push(`<gating:RectangleGate ${head}>${nameInfo}${dims}</gating:RectangleGate>`);
    } else if (g.type === 'polygon') {
      const v = g.vertices.map((x) => `<gating:vertex>${coord(x[0])}${coord(x[1])}</gating:vertex>`).join('');
      parts.push(`<gating:PolygonGate ${head}>${nameInfo}${dimXml(g.dims[0])}${dimXml(g.dims[1])}${v}</gating:PolygonGate>`);
    } else if (g.type === 'ellipsoid') {
      const mean = `<gating:mean>${g.mean.map(coord).join('')}</gating:mean>`;
      const cov = `<gating:covarianceMatrix>${g.cov.map((r) => `<gating:row>${r.map((v) => `<gating:entry data-type:value="${v}"/>`).join('')}</gating:row>`).join('')}</gating:covarianceMatrix>`;
      parts.push(`<gating:EllipsoidGate ${head}>${nameInfo}${g.dims.map((d) => dimXml(d)).join('')}${mean}${cov}<gating:distanceSquare data-type:value="${g.distanceSquare}"/></gating:EllipsoidGate>`);
    } else if (g.type === 'quadrant') {
      // One QuadrantGate per population keeps ids stable; location = interval midpoint.
      const divs = g.dims
        .map((d, k) => {
          if (d.kind !== 'channel') fail('UNSUPPORTED_FEATURE', 'Ratio dimensions are not exported');
          return `<gating:divider gating:id="${esc(p.id)}_d${k}" gating:compensation-ref="${esc(compRef(d))}"${tref(d.transform)}><data-type:fcs-dimension data-type:name="${esc(d.channel)}"/>${g.dividers[k].map((v) => `<gating:value>${v}</gating:value>`).join('')}</gating:divider>`;
        })
        .join('');
      const pos = g.dims
        .map((_, k) => {
          const dv = g.dividers[k];
          const s = g.side[k];
          const lo = s === 0 ? dv[0] - 1 : dv[s - 1];
          const hi = s >= dv.length ? dv[dv.length - 1] + 1 : dv[s];
          const loc = s === 0 ? hi - Math.max(1, Math.abs(hi)) : s >= dv.length ? lo + Math.max(1, Math.abs(lo)) : (lo + hi) / 2;
          return `<gating:position gating:divider_ref="${esc(p.id)}_d${k}" gating:location="${loc}"/>`;
        })
        .join('');
      parts.push(`<gating:QuadrantGate gating:id="${esc(p.id)}_q"${p.parentId ? ` gating:parent_id="${esc(p.parentId)}"` : ''}>${divs}<gating:Quadrant gating:id="${esc(p.id)}">${pos}</gating:Quadrant></gating:QuadrantGate>`);
    } else {
      const refs = g.operands.map((o) => `<gating:gateReference gating:ref="${esc(o.ref)}"${o.complement ? ' gating:use-as-complement="true"' : ''}/>`).join('');
      parts.push(`<gating:BooleanGate ${head}>${nameInfo}<gating:${g.op}>${refs}</gating:${g.op}></gating:BooleanGate>`);
    }
  }
  const mx = [...usedMatrices].map((id) => {
    const m = matrices.find((x) => x.id === id);
    if (!m) fail('COMP_INVALID', `Matrix ${id} not found`);
    const dims = (names: string[]) => names.map((n) => `<data-type:fcs-dimension data-type:name="${esc(n)}"/>`).join('');
    const rows = m.values.map((r) => `<transforms:spectrum>${r.map((v) => `<transforms:coefficient transforms:value="${v}"/>`).join('')}</transforms:spectrum>`).join('');
    return `<transforms:spectrumMatrix transforms:id="${esc(id)}"><transforms:fluorochromes>${dims(m.outputNames ?? m.channels)}</transforms:fluorochromes><transforms:detectors>${dims(m.channels)}</transforms:detectors>${rows}</transforms:spectrumMatrix>`;
  });
  const txs = [...tx.entries()].map(([k, id]) => transformXml(id, JSON.parse(k)));
  return `<?xml version="1.0" encoding="UTF-8"?>
<gating:Gating-ML xmlns:gating="http://www.isac-net.org/std/Gating-ML/v2.0/gating" xmlns:transforms="http://www.isac-net.org/std/Gating-ML/v2.0/transformations" xmlns:data-type="http://www.isac-net.org/std/Gating-ML/v2.0/datatypes">
${[...txs, ...mx, ...parts].join('\n')}
</gating:Gating-ML>
`;
}

// Gating-ML ids are gate ids; restore human names stored in custom_info on re-import.
export function gatingMlNames(xml: string): Map<string, string> {
  const doc = parseXml(xml);
  const out = new Map<string, string>();
  for (const e of kids(doc.documentElement as unknown as El)) {
    const ci = kid(e, 'custom_info');
    const n = ci && kid(ci, 'name');
    const id = attr(e, 'id');
    if (id && n) out.set(id, text(n));
  }
  return out;
}
