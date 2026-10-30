import { describe, expect, it } from 'vitest';
import { axesFromGate, dragHandle, gateFromAxes, handles } from '../src/core/ellipse';
import { invert } from '../src/core/compensation';

const q = (g: ReturnType<typeof gateFromAxes>, p: number[]) => {
  const inv = invert(g.cov);
  const d = [p[0] - g.mean[0], p[1] - g.mean[1]];
  return d[0] * (inv[0][0] * d[0] + inv[0][1] * d[1]) + d[1] * (inv[1][0] * d[0] + inv[1][1] * d[1]);
};

describe('ellipse geometry', () => {
  it('axis form round-trips through the covariance form', () => {
    const e = { cx: 3, cy: -2, a: 5, b: 2, theta: 0.7 };
    const back = axesFromGate(gateFromAxes(e).mean, gateFromAxes(e).cov, 1);
    expect(back.a).toBeCloseTo(5, 12);
    expect(back.b).toBeCloseTo(2, 12);
    expect(back.theta).toBeCloseTo(0.7, 12);
  });
  it('handles lie on the ellipse boundary (quadratic form = 1)', () => {
    const e = { cx: 0.4, cy: 0.6, a: 0.2, b: 0.05, theta: -1.1 };
    for (const h of handles(e)) expect(q(gateFromAxes(e), h)).toBeCloseTo(1, 12);
  });
  it('reads Gating-ML style gates with distanceSquare != 1', () => {
    // cov diag(4, 1), d2 = 9 -> semi-axes 6 and 3
    const e = axesFromGate([0, 0], [[4, 0], [0, 1]], 9);
    expect([e.a, e.b]).toEqual([6, 3]);
  });
  it('dragging a major handle sets length and rotation; minor sets width only', () => {
    const e = { cx: 0, cy: 0, a: 2, b: 1, theta: 0 };
    const m = dragHandle(e, 0, [0, 3]);
    expect(m.a).toBeCloseTo(3, 12);
    expect(m.theta).toBeCloseTo(Math.PI / 2, 12);
    expect(m.b).toBe(1);
    const opposite = dragHandle(e, 1, [-4, 0]);
    expect(opposite.a).toBe(4);
    expect(Math.cos(opposite.theta)).toBeCloseTo(1, 12);
    const w = dragHandle(e, 2, [1.5, 0.5]);
    expect(w.b).toBeCloseTo(0.5, 12);
    expect(w.a).toBe(2);
    expect(q(gateFromAxes(m), handles(m)[0])).toBeCloseTo(1, 12);
  });
  it('rejects degenerate input', () => {
    expect(() => gateFromAxes({ cx: 0, cy: 0, a: 0, b: 1, theta: 0 })).toThrow(/positive/);
    expect(() => axesFromGate([0, 0], [[1, 1], [1, 1]], 1)).toThrow(/positive definite/);
  });
});
