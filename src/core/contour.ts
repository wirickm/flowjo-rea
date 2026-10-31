// Equal-probability contours over a binned 2-D density. Not validated
// against FlowJo's contour placement (see docs/compatibility-matrix.md).

// Separable Gaussian smoothing of a B x B grid (row = y). sigma in bins.
export function smooth(grid: Float32Array, B: number, sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const tmp = new Float64Array(B * B);
  const out = new Float64Array(B * B);
  for (let y = 0; y < B; y++) {
    for (let x = 0; x < B; x++) {
      let s = 0;
      let w = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i;
        if (xx < 0 || xx >= B) continue;
        s += grid[y * B + xx] * k[i + r];
        w += k[i + r];
      }
      tmp[y * B + x] = s / w;
    }
  }
  for (let y = 0; y < B; y++) {
    for (let x = 0; x < B; x++) {
      let s = 0;
      let w = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i;
        if (yy < 0 || yy >= B) continue;
        s += tmp[yy * B + x] * k[i + r];
        w += k[i + r];
      }
      out[y * B + x] = s / w;
    }
  }
  return out;
}

// Density thresholds whose super-level sets hold the given fractions of the
// total (smoothed) mass. fractions in (0, 1); returns one threshold each.
export function probabilityThresholds(d: Float64Array, fractions: number[]): number[] {
  const sorted = Float64Array.from(d).sort().reverse();
  let total = 0;
  for (const v of sorted) total += v;
  const cum = new Float64Array(sorted.length);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) cum[i] = acc += sorted[i];
  return fractions.map((f) => {
    const target = f * total;
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return sorted[lo];
  });
}

// Marching squares on a grid sampled at bin centres. Returns segments
// [x0, y0, x1, y1] in bin coordinates (bin i centre at i + 0.5).
export function marchingSquares(d: Float64Array, B: number, t: number): number[] {
  const seg: number[] = [];
  const v = (x: number, y: number) => d[y * B + x];
  const lerp = (a: number, b: number) => (a === b ? 0.5 : (t - a) / (b - a));
  for (let y = 0; y < B - 1; y++) {
    for (let x = 0; x < B - 1; x++) {
      const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), e = v(x, y + 1);
      const idx = (a >= t ? 1 : 0) | (b >= t ? 2 : 0) | (c >= t ? 4 : 0) | (e >= t ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const cx = x + 0.5, cy = y + 0.5;
      const bottom = [cx + lerp(a, b), cy];
      const right = [cx + 1, cy + lerp(b, c)];
      const top = [cx + lerp(e, c), cy + 1];
      const left = [cx, cy + lerp(a, e)];
      const add = (p: number[], q: number[]) => seg.push(p[0], p[1], q[0], q[1]);
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(right, top); break;
        case 6: case 9: add(bottom, top); break;
        case 7: case 8: add(left, top); break;
        case 5: { // saddle: resolve by centre value
          const m = (a + b + c + e) / 4;
          if (m >= t) { add(left, top); add(bottom, right); } else { add(left, bottom); add(right, top); }
          break;
        }
        case 10: {
          const m = (a + b + c + e) / 4;
          if (m >= t) { add(left, bottom); add(right, top); } else { add(left, top); add(bottom, right); }
          break;
        }
      }
    }
  }
  return seg;
}

// Contours enclosing 100 - k x level percent of the mass, k = 1, 2, ...
export function contourLevels(levelPct: number): number[] {
  const out: number[] = [];
  for (let k = 1; 100 - k * levelPct > 0; k++) out.push((100 - k * levelPct) / 100);
  return out;
}

// Equal-probability band per bin: the number of thresholds the bin's density
// reaches (0 = outside the outermost contour). thresholds from
// probabilityThresholds(d, contourLevels(level)), outermost first.
export function probabilityBands(d: Float64Array, thresholds: number[]): Uint8Array {
  const ts = thresholds.filter((t) => t > 0);
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) {
    let k = 0;
    while (k < ts.length && d[i] >= ts[k]) k++;
    out[i] = k;
  }
  return out;
}
