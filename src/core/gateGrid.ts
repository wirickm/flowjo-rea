// FlowJo 10 gate grid: polygon membership on an R x R lattice.
// Behavioral spec: docs/validation/flowjo-engine-specs.md, section 1.
import type { Dimension, GateGrid, GridAxis } from './model';
import { makeTransform } from './transforms';

// Grid coordinate of a value on one axis. 'round' (linear axes) rounds to the
// nearest lattice point; 'floor' (transformed axes) takes the cell index.
export function gridCoord(a: GridAxis, resolution: number, v: number): number {
  const u = ((v - a.min) * resolution) / (a.max - a.min);
  return a.mode === 'round' ? Math.floor(u + 0.5) : Math.floor(u);
}

// Lattice point of an event, clamped into the grid. Linear axes see the value
// as a 32-bit float, as FlowJo stores event data.
export function eventCell(a: GridAxis, resolution: number, v: number): number {
  const c = gridCoord(a, resolution, a.mode === 'round' ? Math.fround(v) : v);
  return c < 0 ? 0 : c > resolution - 1 ? resolution - 1 : c;
}

// Even-odd test with points on edges or vertices counted as inside.
export function insideOrOnPolygon(px: number, py: number, vx: number[], vy: number[]): boolean {
  let inside = false;
  const n = vx.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = vx[i], y1 = vy[i], x2 = vx[j], y2 = vy[j];
    if (px >= Math.min(x1, x2) && px <= Math.max(x1, x2) && py >= Math.min(y1, y2) && py <= Math.max(y1, y2)) {
      // On the segment: collinear within its bounding box.
      if ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1) === 0) return true;
    }
    if ((y1 < py && py <= y2) || (y2 < py && py <= y1)) {
      const xi = x1 + ((x2 - x1) * (py - y1)) / (y2 - y1);
      if (px > xi) inside = !inside;
    }
  }
  return inside;
}

// R x R membership mask (index x * R + y) for a polygon in gate units.
export function polygonGridMask(grid: GateGrid, vertices: [number, number][]): Uint8Array {
  const R = grid.resolution;
  const vx = vertices.map((v) => gridCoord(grid.axes[0], R, v[0]));
  const vy = vertices.map((v) => gridCoord(grid.axes[1], R, v[1]));
  return latticeMask(R, vx, vy);
}

// R x R mask of the lattice points inside or on a polygon given in lattice units.
export function latticeMask(R: number, vx: number[], vy: number[]): Uint8Array {
  const mask = new Uint8Array(R * R);
  const x0 = Math.max(0, Math.min(...vx)), x1 = Math.min(R - 1, Math.max(...vx));
  const y0 = Math.max(0, Math.min(...vy)), y1 = Math.min(R - 1, Math.max(...vy));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (insideOrOnPolygon(x, y, vx, vy)) mask[x * R + y] = 1;
  return mask;
}

// FlowJo 10 draws an ellipse as a 180-vertex outline on the 256-pixel graph
// frame and gates on that polygon. edges = major-axis endpoints, then
// minor-axis endpoints, in lattice units (FlowJo stores them as integers).
// Spec: docs/validation/flowjo-engine-specs.md, section 2.
export function ellipseLatticePolygon(edges: [number, number][]): { vx: number[]; vy: number[] } {
  const [p0, p1, p2, p3] = edges;
  let a = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]) / 2;
  let b = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]) / 2;
  if (a < b) [a, b] = [b, a];
  const angle = Math.atan((p0[1] - p1[1]) / (p0[0] - p1[0]));
  const cx = (p0[0] + p1[0]) / 2;
  const cy = (p0[1] + p1[1]) / 2;
  const e2 = a === 0 ? 0 : 1 - (b * b) / (a * a);
  const vx: number[] = [];
  const vy: number[] = [];
  let lx = 0, ly = 0;
  for (let i = 0; i < 180; i++) {
    // The angle fraction is computed in single precision.
    const t = Math.fround(Math.fround(i) / Math.fround(180)) * 2 * Math.PI;
    const r = a * Math.sqrt((1 - e2) / (1 - e2 * Math.cos(t) * Math.cos(t)));
    const x = Math.floor(cx + r * Math.cos(t + angle) + 0.5);
    const y = Math.floor(cy + r * Math.sin(t + angle) + 0.5);
    if (x !== lx || y !== ly) { vx.push(x); vy.push(y); }
    lx = x; ly = y;
  }
  return { vx, vy };
}

// Grid for a polygon drawn in this app: FlowJo's default resolution over each
// axis's display range ('round' on linear scales, 'floor' otherwise).
// Undefined when an axis has no finite display range (raw scale).
export function defaultGrid(dims: [Dimension, Dimension], resolution = 256): GateGrid | undefined {
  const axes = dims.map((d): GridAxis | null => {
    const t = makeTransform(d.transform);
    if (!(Number.isFinite(t.displayMin) && Number.isFinite(t.displayMax) && t.displayMax > t.displayMin)) return null;
    return { mode: d.transform.kind === 'linear' ? 'round' : 'floor', min: t.displayMin, max: t.displayMax };
  });
  if (!axes[0] || !axes[1]) return undefined;
  return { resolution, axes: [axes[0], axes[1]] };
}
