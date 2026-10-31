// Compensation wizard on synthetic controls built from a known spillover
// matrix: recovery accuracy, negative-source choice, and input errors.
import { describe, expect, it } from 'vitest';
import { compensate } from '../src/core/compensation';
import { estimateSpillover, type ControlInput } from '../src/core/compWizard';

const CH = ['FITC-A', 'PE-A', 'APC-A'];
const TRUE = [
  [1, 0.25, 0.01],
  [0.02, 1, 0.08],
  [0, 0.05, 1],
];

// Deterministic pseudo-random normal (Box-Muller over an LCG).
function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (1664525 * s + 1013904223) >>> 0) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

// n events; fraction `posFrac` carry `bright` units of the dye on `primary`.
function tube(label: string, primary: string | null, n: number, seed: number, posFrac = 0.3, bright = 20000, noise = 50, background = 200): ControlInput {
  const r = rng(seed);
  const cols = CH.map(() => new Float64Array(n));
  const p = primary === null ? -1 : CH.indexOf(primary);
  for (let e = 0; e < n; e++) {
    const dye = p >= 0 && e < n * posFrac ? bright * (1 + 0.2 * r()) : 0;
    CH.forEach((_, j) => {
      cols[j][e] = background + (p >= 0 ? dye * TRUE[p][j] : 0) + noise * r();
    });
  }
  return { label, primary, columns: new Map(CH.map((c, j) => [c, cols[j]])) };
}

describe('compensation wizard', () => {
  it('recovers a known matrix within 0.005 using an unstained control', () => {
    const controls = [tube('unstained', null, 20000, 1), tube('fitc', 'FITC-A', 20000, 2), tube('pe', 'PE-A', 20000, 3), tube('apc', 'APC-A', 20000, 4)];
    const { matrix, diagnostics } = estimateSpillover(controls, CH, 10);
    expect(matrix.channels).toEqual(CH);
    matrix.values.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v - TRUE[i][j]), `S[${i}][${j}]`).toBeLessThan(0.005)));
    expect(diagnostics.every((d) => d.negativeSource === 'unstained' && d.warnings.length === 0)).toBe(true);
  });
  it('without an unstained control uses the dimmest events of the same tube', () => {
    const controls = [tube('fitc', 'FITC-A', 20000, 2), tube('pe', 'PE-A', 20000, 3), tube('apc', 'APC-A', 20000, 4)];
    const { matrix, diagnostics } = estimateSpillover(controls, CH, 10);
    matrix.values.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v - TRUE[i][j])).toBeLessThan(0.005)));
    expect(diagnostics[0].negativeSource).toBe('same tube');
  });
  it('compensating a control with its estimated matrix removes the spillover', () => {
    const controls = [tube('unstained', null, 20000, 1), tube('fitc', 'FITC-A', 20000, 2), tube('pe', 'PE-A', 20000, 3), tube('apc', 'APC-A', 20000, 4)];
    const { matrix } = estimateSpillover(controls, CH, 10);
    const fitc = controls[1];
    const comp = compensate(CH.map((c) => fitc.columns.get(c)!), CH, matrix);
    // FITC positives (first 30%) and negatives (rest) differ in PE by ~5000
    // raw units before compensation and by less than the noise (50) after.
    const mean = (col: Float64Array, a: number, b: number) => { let s = 0; for (let e = a; e < b; e++) s += col[e]; return s / (b - a); };
    const raw = fitc.columns.get('PE-A')!;
    expect(mean(raw, 0, 6000) - mean(raw, 6000, 20000)).toBeGreaterThan(4000);
    expect(Math.abs(mean(comp[1], 0, 6000) - mean(comp[1], 6000, 20000))).toBeLessThan(50);
  });
  it('rejects bad input explicitly', () => {
    const u = tube('u', null, 20000, 1);
    expect(() => estimateSpillover([u, tube('a', 'FITC-A', 20000, 2)], CH)).toThrow(/two single-stain/);
    expect(() => estimateSpillover([tube('a', 'FITC-A', 20000, 2), tube('b', 'FITC-A', 20000, 3)], CH)).toThrow(/more than one control/);
    expect(() => estimateSpillover([tube('a', 'FITC-A', 500, 2), tube('b', 'PE-A', 500, 3)], CH, 10)).toThrow(/positive events/);
    expect(() => estimateSpillover([u, tube('a', 'FITC-A', 20000, 2, 0.3, 0), tube('b', 'PE-A', 20000, 3)], CH)).toThrow(/not separated/);
    expect(() => estimateSpillover([tube('a', 'FITC-A', 20000, 2), tube('b', 'PE-A', 20000, 3)], CH, 60)).toThrow(/between 0 and 50/);
  });
  it('warns when a control spills more into another channel than its own', () => {
    const odd = tube('odd', 'FITC-A', 20000, 2);
    // swap FITC and PE columns: the "FITC" tube now peaks in PE
    const f = odd.columns.get('FITC-A')!;
    odd.columns.set('FITC-A', odd.columns.get('PE-A')!);
    odd.columns.set('PE-A', f);
    const { diagnostics } = estimateSpillover([tube('u', null, 20000, 1), odd, tube('pe', 'PE-A', 20000, 3)], CH, 10);
    expect(diagnostics[0].warnings.join(' ')).toMatch(/spills more into PE-A/);
  });
});
