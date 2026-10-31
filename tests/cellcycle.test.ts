// Cell cycle fits on synthetic DNA histograms with known phase fractions:
// G1 at 200 (CV 4%), G2 at 400, S uniform between, same CV for every cell.
import { describe, expect, it } from 'vitest';
import { fitCellCycle } from '../src/core/cellcycle';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synth(fr: [number, number, number], N: number, seed = 1, bins = 1024) {
  const rnd = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const h = new Float64Array(bins);
  for (let k = 0; k < N; k++) {
    const u = rnd();
    const dna = u < fr[0] ? 200 : u < fr[0] + fr[1] ? 200 + 200 * rnd() : 400;
    const b = Math.round(dna * (1 + 0.04 * normal()));
    if (b >= 0 && b < bins) h[b]++;
  }
  return h;
}

describe('cell cycle fitting', () => {
  const h = synth([0.55, 0.3, 0.15], 50000);
  it('Dean-Jett-Fox recovers phase percentages within 2 pp and G1 mean within 1%', () => {
    const f = fitCellCycle(h, { model: 'dean-jett-fox' });
    expect(Math.abs(f.g1Pct - 55)).toBeLessThan(2);
    expect(Math.abs(f.sPct - 30)).toBeLessThan(2);
    expect(Math.abs(f.g2Pct - 15)).toBeLessThan(2);
    expect(Math.abs(f.g1.mean - 200) / 200).toBeLessThan(0.01);
    expect(f.fitted).toHaveLength(h.length);
    expect(f.chiSquare).toBeLessThan(2);
    expect(f.warnings).toEqual([]);
  });
  it('Dean-Jett-Fox with free G2 position and CV still recovers the fractions', () => {
    const f = fitCellCycle(h, { model: 'dean-jett-fox', constrainG2: false, cvEqual: false });
    expect(Math.abs(f.g1Pct - 55)).toBeLessThan(2);
    expect(Math.abs(f.sPct - 30)).toBeLessThan(2);
    expect(Math.abs(f.g2Pct - 15)).toBeLessThan(2);
    expect(Math.abs(f.g2.mean - 400) / 400).toBeLessThan(0.02);
  });
  it('Watson recovers phase percentages within 4 pp', () => {
    const f = fitCellCycle(h, { model: 'watson' });
    expect(Math.abs(f.g1Pct - 55)).toBeLessThan(4);
    expect(Math.abs(f.sPct - 30)).toBeLessThan(4);
    expect(Math.abs(f.g2Pct - 15)).toBeLessThan(4);
  });
  it('a G1-only population gives S + G2 below 3%', () => {
    const g = synth([1, 0, 0], 50000, 7);
    for (const model of ['dean-jett-fox', 'watson'] as const) {
      const f = fitCellCycle(g, { model });
      expect(f.sPct + f.g2Pct).toBeLessThan(3);
    }
  });
  it('honours a G1 guess when a taller debris peak exists', () => {
    const g = synth([0.55, 0.3, 0.15], 50000, 3);
    for (let i = 40; i < 60; i++) g[i] += 3000;
    const f = fitCellCycle(g, { model: 'dean-jett-fox', g1Guess: 205 });
    expect(Math.abs(f.g1.mean - 200)).toBeLessThan(2);
    expect(f.warnings.length).toBe(1);
  });
  it('empty histogram throws', () => {
    expect(() => fitCellCycle(new Float64Array(256), { model: 'dean-jett-fox' })).toThrow(/empty/);
    expect(() => fitCellCycle([], { model: 'watson' })).toThrow();
  });
});
