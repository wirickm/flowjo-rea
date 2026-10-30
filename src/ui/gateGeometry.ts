// Mapping gates between their own coordinate space (gate dimension
// transforms) and a plot's axis display space.
import type { Dimension, Gate, Population } from '../core/model';
import { makeTransform, type Transform, type TransformSpec } from '../core/transforms';

export interface Axis {
  channel: string;
  spec: TransformSpec;
  t: Transform;
  range: [number, number];
}

const cache = new Map<string, Transform>();
function tf(spec: TransformSpec): Transform {
  const k = JSON.stringify(spec);
  let t = cache.get(k);
  if (!t) {
    t = makeTransform(spec);
    cache.set(k, t);
  }
  return t;
}

export const dimToAxis = (v: number, d: Dimension, a: Axis) => (sameScale(d.transform, a.spec) ? v : a.t.apply(tf(d.transform).inverse(v)));

export function sameScale(a: TransformSpec, b: TransformSpec) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function channelDim(a: Axis, compensation?: string): Dimension {
  return { kind: 'channel', channel: a.channel, transform: a.spec, ...(compensation ? { compensation } : {}) };
}

export type Drawable =
  | { pop: Population; kind: 'rect'; x0: number; x1: number; y0: number; y1: number }
  | { pop: Population; kind: 'range'; x0: number; x1: number }
  | { pop: Population; kind: 'polygon'; pts: [number, number][] }
  | { pop: Population; kind: 'ellipse'; pts: [number, number][]; cx: number; cy: number }
  | { pop: Population; kind: 'quadrant'; x: number; y: number };

// Gates of child populations drawable on this plot.
export function drawableGates(pops: Population[], parentId: string | null, x: Axis, y: Axis | null): Drawable[] {
  const out: Drawable[] = [];
  for (const p of pops) {
    if (p.parentId !== parentId) continue;
    const g = p.gate;
    if (g.type === 'boolean') continue;
    const ch = g.dims.map((d) => (d.kind === 'channel' ? d.channel : null));
    if (g.type === 'rect') {
      if (y && g.dims.length === 2 && ch[0] === x.channel && ch[1] === y.channel) {
        out.push({
          pop: p,
          kind: 'rect',
          x0: g.min[0] === null ? x.range[0] - 1 : dimToAxis(g.min[0], g.dims[0], x),
          x1: g.max[0] === null ? x.range[1] + 1 : dimToAxis(g.max[0], g.dims[0], x),
          y0: g.min[1] === null ? y.range[0] - 1 : dimToAxis(g.min[1], g.dims[1], y),
          y1: g.max[1] === null ? y.range[1] + 1 : dimToAxis(g.max[1], g.dims[1], y),
        });
      } else if (g.dims.length === 1 && ch[0] === x.channel) {
        out.push({
          pop: p,
          kind: 'range',
          x0: g.min[0] === null ? x.range[0] - 1 : dimToAxis(g.min[0], g.dims[0], x),
          x1: g.max[0] === null ? x.range[1] + 1 : dimToAxis(g.max[0], g.dims[0], x),
        });
      }
    } else if (g.type === 'polygon' && y && ch[0] === x.channel && ch[1] === y.channel) {
      out.push({ pop: p, kind: 'polygon', pts: g.vertices.map(([a, b]) => [dimToAxis(a, g.dims[0], x), dimToAxis(b, g.dims[1], y)]) });
    } else if (g.type === 'ellipsoid' && y && g.dims.length === 2 && ch[0] === x.channel && ch[1] === y.channel) {
      out.push({ pop: p, kind: 'ellipse', ...ellipseOutline(g, x, y) });
    } else if (g.type === 'quadrant' && y && g.dims.length === 2 && ch[0] === x.channel && ch[1] === y.channel && g.dividers[0].length === 1 && g.dividers[1].length === 1) {
      out.push({ pop: p, kind: 'quadrant', x: dimToAxis(g.dividers[0][0], g.dims[0], x), y: dimToAxis(g.dividers[1][0], g.dims[1], y) });
    }
  }
  return out;
}

function ellipseOutline(g: Extract<Gate, { type: 'ellipsoid' }>, x: Axis, y: Axis) {
  // Eigen-decomposition of the 2x2 covariance gives the outline in gate space.
  const [[a, b], [, d]] = g.cov;
  const tr = a + d;
  const det = a * d - b * b;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const th = Math.abs(b) < 1e-300 ? (a >= d ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
  const r1 = Math.sqrt(l1 * g.distanceSquare);
  const r2 = Math.sqrt(Math.max(l2, 0) * g.distanceSquare);
  const pts: [number, number][] = [];
  for (let i = 0; i < 72; i++) {
    const u = (i / 72) * 2 * Math.PI;
    const ex = g.mean[0] + r1 * Math.cos(u) * Math.cos(th) - r2 * Math.sin(u) * Math.sin(th);
    const ey = g.mean[1] + r1 * Math.cos(u) * Math.sin(th) + r2 * Math.sin(u) * Math.cos(th);
    pts.push([dimToAxis(ex, g.dims[0], x), dimToAxis(ey, g.dims[1], y)]);
  }
  return { pts, cx: dimToAxis(g.mean[0], g.dims[0], x), cy: dimToAxis(g.mean[1], g.dims[1], y) };
}

export function quadrantSiblings(pops: Population[], p: Population): Population[] {
  const g = p.gate;
  if (g.type !== 'quadrant') return [p];
  const key = JSON.stringify([g.dims, g.dividers]);
  return pops.filter((q) => q.parentId === p.parentId && q.gate.type === 'quadrant' && JSON.stringify([q.gate.dims, q.gate.dividers]) === key);
}

export function pointInPolygon(x: number, y: number, pts: [number, number][]) {
  let inside = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    if (pts[a][1] > y !== pts[b][1] > y && x < ((pts[b][0] - pts[a][0]) * (y - pts[a][1])) / (pts[b][1] - pts[a][1]) + pts[a][0]) inside = !inside;
  }
  return inside;
}
