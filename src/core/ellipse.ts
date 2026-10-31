// 2-D ellipse geometry for ellipsoid gates: (p-mean)^T inv(cov) (p-mean) <= d2.
// Axis form: centre, semi-axes a (along theta) and b (perpendicular).
import { fail } from './errors';

export interface EllipseAxes {
  cx: number;
  cy: number;
  a: number;
  b: number;
  theta: number; // radians, direction of the a axis
}

export function axesFromGate(mean: number[], cov: number[][], d2: number): EllipseAxes {
  if (mean.length !== 2 || cov.length !== 2) fail('GATE_INVALID', 'Only 2-D ellipses have an axis form');
  const [[sxx, sxy], [, syy]] = cov;
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  if (!(l2 > 0)) fail('GATE_INVALID', 'Ellipse covariance is not positive definite');
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { cx: mean[0], cy: mean[1], a: Math.sqrt(l1 * d2), b: Math.sqrt(l2 * d2), theta };
}

export function gateFromAxes(e: EllipseAxes): { mean: number[]; cov: number[][]; distanceSquare: number } {
  if (!(e.a > 0 && e.b > 0)) fail('GATE_INVALID', 'Ellipse semi-axes must be positive');
  const c = Math.cos(e.theta);
  const s = Math.sin(e.theta);
  const a2 = e.a * e.a;
  const b2 = e.b * e.b;
  return {
    mean: [e.cx, e.cy],
    cov: [
      [a2 * c * c + b2 * s * s, (a2 - b2) * c * s],
      [(a2 - b2) * c * s, a2 * s * s + b2 * c * c],
    ],
    distanceSquare: 1,
  };
}

// Handle order: major +, major -, minor +, minor -.
export function handles(e: EllipseAxes): [number, number][] {
  const c = Math.cos(e.theta);
  const s = Math.sin(e.theta);
  return [
    [e.cx + e.a * c, e.cy + e.a * s],
    [e.cx - e.a * c, e.cy - e.a * s],
    [e.cx - e.b * s, e.cy + e.b * c],
    [e.cx + e.b * s, e.cy - e.b * c],
  ];
}

// Drag handle k to point p (gate coordinates). Major handles set length and
// rotation; minor handles set the perpendicular semi-axis only.
export function dragHandle(e: EllipseAxes, k: number, p: [number, number]): EllipseAxes {
  const dx = p[0] - e.cx;
  const dy = p[1] - e.cy;
  if (k < 2) {
    const len = Math.hypot(dx, dy);
    if (len === 0) return e;
    const theta = Math.atan2(dy, dx) + (k === 1 ? Math.PI : 0);
    return { ...e, a: len, theta };
  }
  const b = Math.abs(-dx * Math.sin(e.theta) + dy * Math.cos(e.theta));
  return b > 0 ? { ...e, b } : e;
}

export function outline(e: EllipseAxes, n = 72): [number, number][] {
  const c = Math.cos(e.theta);
  const s = Math.sin(e.theta);
  return Array.from({ length: n }, (_, i) => {
    const u = (i / n) * 2 * Math.PI;
    const x = e.a * Math.cos(u);
    const y = e.b * Math.sin(u);
    return [e.cx + x * c - y * s, e.cy + x * s + y * c] as [number, number];
  });
}
