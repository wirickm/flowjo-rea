// Dye-dilution fits on synthetic log-normal generations: parent at 1e4,
// sd 0.08 decades, each generation at half the intensity of the previous.
import { describe, expect, it } from 'vitest';
import { fitProliferation } from '../src/core/proliferation';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synth(counts: number[], seed = 1) {
  const rnd = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const out: number[] = [];
  counts.forEach((n, g) => {
    for (let k = 0; k < n; k++) out.push(10 ** (4 - g * Math.log10(2) + 0.08 * normal()));
  });
  return Float64Array.from(out);
}

function indices(N: number[]) {
  const O = N.map((v, g) => v / 2 ** g);
  const Os = O.reduce((a, b) => a + b, 0);
  const gO = O.reduce((a, v, g) => a + g * v, 0);
  return { division: gO / Os, proliferation: gO / (Os - O[0]), expansion: N.reduce((a, b) => a + b, 0) / Os };
}

describe('proliferation fitting', () => {
  it('recovers per-generation percentages and the standard indices', () => {
    const counts = [3000, 4000, 6000, 8000, 5000, 2500];
    const total = counts.reduce((a, b) => a + b, 0);
    const v = synth(counts);
    const f = fitProliferation(v);
    const truth = indices(counts);
    expect(Math.abs(Math.log10(f.parentPeak) - 4)).toBeLessThan(0.01);
    expect(Math.abs(f.width - 0.08)).toBeLessThan(0.008);
    for (let g = 0; g < counts.length; g++) expect(Math.abs(f.generations[g].pct - (100 * counts[g]) / total)).toBeLessThan(2);
    for (const gen of f.generations.slice(counts.length)) expect(gen.pct).toBeLessThan(2);
    expect(Math.abs(f.divisionIndex / truth.division - 1)).toBeLessThan(0.05);
    expect(Math.abs(f.proliferationIndex / truth.proliferation - 1)).toBeLessThan(0.05);
    expect(Math.abs(f.expansionIndex / truth.expansion - 1)).toBeLessThan(0.05);
    expect(Math.abs(f.pctDivided - (total - counts[0]) / total)).toBeLessThan(0.02);
    expect(f.histogram.fitted).toHaveLength(256);
    expect(f.histogram.edges).toHaveLength(257);
  });
  it('an undivided population gives pctDivided below 2%', () => {
    const v = synth([20000], 5);
    const f = fitProliferation(v, { log10Min: 1.5, log10Max: 5 });
    expect(f.pctDivided).toBeLessThan(0.02);
    expect(f.generations).toHaveLength(9);
  });
  it('drops nonpositive values with a warning and honours a fixed parent', () => {
    const v = synth([4000, 4000, 4000], 9);
    const w = Float64Array.from([...v, 0, -5, -1]);
    const f = fitProliferation(w, { parentPeak: 1e4 });
    expect(f.parentPeak).toBeCloseTo(1e4, 6);
    expect(f.warnings[0]).toMatch(/^3 nonpositive/);
    for (let g = 0; g < 3; g++) expect(Math.abs(f.generations[g].pct - 100 / 3)).toBeLessThan(2);
  });
  it('throws without positive values', () => {
    expect(() => fitProliferation(Float64Array.from([0, -1]))).toThrow(/no positive/);
  });
});
