// Contours on an analytic 2-D Gaussian: the level enclosing fraction p of the
// mass is the circle r = sigma * sqrt(-2 ln(1 - p)).
import { describe, expect, it } from 'vitest';
import { contourLevels, marchingSquares, probabilityThresholds, smooth } from '../src/core/contour';

const B = 120;
const sigma = 12;
const c = B / 2;
function gaussianGrid() {
  const g = new Float32Array(B * B);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) g[y * B + x] = Math.exp(-((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2) / (2 * sigma * sigma));
  return g;
}

describe('equal-probability contours', () => {
  it('levels list 100 - k x level', () => {
    expect(contourLevels(10)).toEqual([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]);
    expect(contourLevels(5)).toHaveLength(19);
  });
  it('contour radii match the analytic enclosed-probability circles within 0.6 bin', () => {
    const d = Float64Array.from(gaussianGrid());
    for (const p of [0.25, 0.5, 0.75, 0.9]) {
      const [t] = probabilityThresholds(d, [p]);
      const seg = marchingSquares(d, B, t);
      expect(seg.length).toBeGreaterThan(40);
      const expected = sigma * Math.sqrt(-2 * Math.log(1 - p));
      for (let i = 0; i < seg.length; i += 2) expect(Math.abs(Math.hypot(seg[i] - c, seg[i + 1] - c) - expected)).toBeLessThan(0.6);
    }
  });
  it('smoothing preserves total mass away from edges and spreads a point', () => {
    const g = new Float32Array(B * B);
    g[c * B + c] = 1000;
    const s = smooth(g, B, 2);
    let total = 0;
    for (const v of s) total += v;
    expect(total).toBeCloseTo(1000, 6);
    expect(s[c * B + c + 2]).toBeGreaterThan(0);
  });
  it('empty grid yields no segments', () => {
    const d = new Float64Array(B * B);
    expect(marchingSquares(d, B, 1)).toEqual([]);
  });
});
