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
  const mask = new Uint8Array(R * R);
  const x0 = Math.max(0, Math.min(...vx)), x1 = Math.min(R - 1, Math.max(...vx));
  const y0 = Math.max(0, Math.min(...vy)), y1 = Math.min(R - 1, Math.max(...vy));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (insideOrOnPolygon(x, y, vx, vy)) mask[x * R + y] = 1;
  return mask;
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
