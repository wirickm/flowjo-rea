import { describe, expect, it } from 'vitest';
import { defaultGrid, ellipseLatticePolygon, eventCell, gridCoord, insideOrOnPolygon, latticeMask, polygonGridMask } from '../src/core/gateGrid';
import type { GateGrid } from '../src/core/model';

const lin: GateGrid = { resolution: 256, axes: [{ mode: 'round', min: 0, max: 262144 }, { mode: 'round', min: 0, max: 262144 }] };

describe('FlowJo 10 gate grid', () => {
  it('rounds linear values to the nearest lattice point and floors transformed ones', () => {
    expect(gridCoord(lin.axes[0], 256, 1024 * 10 + 511)).toBe(10);
    expect(gridCoord(lin.axes[0], 256, 1024 * 10 + 512)).toBe(11);
    expect(gridCoord({ mode: 'floor', min: 0, max: 1 }, 256, 0.999 / 256 + 10 / 256)).toBe(10);
  });

  it('clamps events into the grid; vertices are not clamped', () => {
    expect(eventCell(lin.axes[0], 256, -5000)).toBe(0);
    expect(eventCell(lin.axes[0], 256, 1e7)).toBe(255);
    expect(gridCoord(lin.axes[0], 256, 1e7)).toBeGreaterThan(255);
  });

  it('counts lattice points on edges and vertices as inside', () => {
    const vx = [0, 4, 4, 0], vy = [0, 0, 4, 4];
    expect(insideOrOnPolygon(2, 2, vx, vy)).toBe(true);
    expect(insideOrOnPolygon(0, 2, vx, vy)).toBe(true); // left edge
    expect(insideOrOnPolygon(4, 4, vx, vy)).toBe(true); // vertex
    expect(insideOrOnPolygon(5, 2, vx, vy)).toBe(false);
    // Diagonal edge through lattice points.
    expect(insideOrOnPolygon(2, 2, [0, 4, 0], [0, 4, 4])).toBe(true);
    expect(insideOrOnPolygon(3, 1, [0, 4, 0], [0, 4, 4])).toBe(false);
  });

  it('builds a mask whose cell count equals the lattice points in the closed square', () => {
    // Square 10..20 (in cells) on both axes: 11 x 11 lattice points.
    const v: [number, number][] = [[10240, 10240], [20480, 10240], [20480, 20480], [10240, 20480]];
    const m = polygonGridMask(lin, v);
    expect(m.reduce((a, b) => a + b, 0)).toBe(121);
    expect(m[10 * 256 + 10]).toBe(1);
    expect(m[21 * 256 + 10]).toBe(0);
  });

  it('derives an app grid from display ranges and refuses raw axes', () => {
    const g = defaultGrid([
      { kind: 'channel', channel: 'FSC-A', transform: { kind: 'linear', T: 262144, A: 0 } },
      { kind: 'channel', channel: 'CD3', transform: { kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 } },
    ])!;
    expect(g.axes[0]).toEqual({ mode: 'round', min: 0, max: 1 });
    expect(g.axes[1]).toEqual({ mode: 'floor', min: 0, max: 1, logicle: { T: 262144, W: 0.5, M: 4.5, A: 0 } });
    expect(defaultGrid([
      { kind: 'channel', channel: 'FSC-A', transform: { kind: 'none' } },
      { kind: 'channel', channel: 'SSC-A', transform: { kind: 'none' } },
    ])).toBeUndefined();
  });

  it('outlines an ellipse with at most 180 integer vertices on the true curve', () => {
    // Circle of radius 20 centred at (100, 60).
    const { vx, vy } = ellipseLatticePolygon([[120, 60], [80, 60], [100, 80], [100, 40]]);
    expect(vx.length).toBeLessThanOrEqual(180);
    expect(vx.length).toBeGreaterThan(100);
    for (let i = 0; i < vx.length; i++) {
      expect(Number.isInteger(vx[i]) && Number.isInteger(vy[i])).toBe(true);
      expect(Math.abs(Math.hypot(vx[i] - 100, vy[i] - 60) - 20)).toBeLessThanOrEqual(Math.SQRT1_2 + 1e-9);
    }
    // No two consecutive vertices repeat.
    for (let i = 1; i < vx.length; i++) expect(vx[i] !== vx[i - 1] || vy[i] !== vy[i - 1]).toBe(true);
    // Lattice points inside or on the outline: close to pi r^2 + boundary.
    const n = latticeMask(256, vx, vy).reduce((a, b) => a + b, 0);
    expect(n).toBeGreaterThan(Math.PI * 400);
    expect(n).toBeLessThan(Math.PI * 21 * 21);
  });

  it('rotates the outline with the major axis (atan of the endpoint slope)', () => {
    // Major axis along the diagonal from (90, 90) to (110, 110); minor half-length 3.
    const { vx, vy } = ellipseLatticePolygon([[90, 90], [110, 110], [102, 98], [98, 102]]);
    const far = vx.map((x, i) => Math.hypot(x - 100, vy[i] - 100)).reduce((a, b) => Math.max(a, b));
    expect(far).toBeGreaterThan(13.5);
    const i = vx.findIndex((x, k) => Math.hypot(x - 100, vy[k] - 100) === far);
    expect(Math.sign(vx[i] - 100)).toBe(Math.sign(vy[i] - 100));
  });
});
