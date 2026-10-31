// Monotone cubic Hermite interpolation (Fritsch-Carlson) through control
// points sorted by t. Outside [t0, tn] the end value is held. Used by the
// curved (spline) quadrant gate.
export function splineInterpolator(pts: [number, number][]): (t: number) => number {
  const n = pts.length;
  if (n === 0) return () => NaN;
  if (n === 1) return () => pts[0][1];
  const t = pts.map((p) => p[0]);
  const v = pts.map((p) => p[1]);
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(t[i + 1] - t[i]);
    d.push(h[i] > 0 ? (v[i + 1] - v[i]) / h[i] : 0);
  }
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (x: number) => {
    if (!(x > t[0])) return v[0];
    if (!(x < t[n - 1])) return v[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= x) lo = mid; else hi = mid;
    }
    const hh = h[lo];
    if (!(hh > 0)) return v[lo];
    const u = (x - t[lo]) / hh;
    const u2 = u * u, u3 = u2 * u;
    // Written relative to v[lo] so flat segments return their value exactly.
    return v[lo] + (-2 * u3 + 3 * u2) * (v[lo + 1] - v[lo]) + hh * ((u3 - 2 * u2 + u) * m[lo] + (u3 - u2) * m[lo + 1]);
  };
}

// Divider functions of a spline quadrant gate in gate coordinates.
export function splineDividers(xDivider: [number, number][], yDivider: [number, number][]) {
  const xs = [...xDivider].sort((a, b) => a[1] - b[1]).map(([x, y]) => [y, x] as [number, number]);
  const ys = [...yDivider].sort((a, b) => a[0] - b[0]);
  return { xAt: splineInterpolator(xs), yAt: splineInterpolator(ys) };
}
