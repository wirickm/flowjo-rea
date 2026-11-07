// Compare Populations statistics against hand-computed values (spec
// docs/validation/ui-gaps/platforms.md, Compare Populations).
import { describe, expect, it } from 'vitest';
import { chiSquared, kolmogorovSmirnov, ksProbability, multivariateChi, overtonPositive, seDymaxPositive, tOf } from '../src/core/compare';

describe('Kolmogorov-Smirnov (KolmogorovSmirnoff::Calculate)', () => {
  it('fully separated populations', () => {
    const r = kolmogorovSmirnov([0, 10, 0, 0], [10, 0, 0, 0]);
    expect(r.d).toBe(1);
    expect(r.bucket).toBe(0);
    expect(r.lambda).toBeCloseTo(Math.sqrt(5), 5); // N = floor(100/20) = 5
    expect(r.text).toBe('greater than 99.9%');
  });
  it('half shifted', () => {
    const r = kolmogorovSmirnov([5, 5], [10, 0]);
    expect(r.d).toBe(0.5);
    expect(r.lambda).toBeCloseTo(0.5 * Math.sqrt(5), 5);
    expect(r).toMatchObject({ p: 0.1, text: 'between 80% and 90%' });
  });
  it('probability table edges', () => {
    expect(ksProbability(0).text).toBe('0%');
    expect(ksProbability(1).text).toBe('less than 80%');
    expect(ksProbability(1.4).text).toBe('between 95% and 98%');
    expect(ksProbability(1.9).text).toBe('between 99.8% and 99.9%');
  });
});

describe('Overton subtraction (BasicHistogram::OvertonPositive)', () => {
  it('all positive', () => expect(overtonPositive([0, 10], [10, 0])).toBeCloseTo(100, 4));
  it('identical gives 0', () => expect(overtonPositive([5, 5], [5, 5])).toBe(0));
  it('negative cancels lower positive', () => expect(overtonPositive([6, 2, 2], [2, 6, 2])).toBeCloseTo(0, 5));
  it('negative below stays', () => expect(overtonPositive([2, 2, 6], [6, 2, 2])).toBeCloseTo(40, 4));
});

describe('SE Dymax %Positive', () => {
  it('hand-computed 3-bucket case', () => {
    // m = 2, m2 = 1; c = 0.9, s = 0.4: 1 - 0.4/0.9 + 0.6*0.4/0.81 - 2/9
    expect(seDymaxPositive([1, 1, 2, 6], [4, 2, 3, 1])).toBeCloseTo(100 * (1 - 0.4 / 0.9 + 0.24 / 0.81 - 2 / 9), 3);
  });
});

describe('Chi-squared probability binning', () => {
  it('identical fractions give chi 0 and T 0', () => {
    const r = chiSquared([5, 5, 5, 5], [10, 0, 0, 10], 2);
    expect(r.chi).toBe(0);
    expect(r.tx).toBe(0);
  });
  it('different fractions', () => {
    const r = chiSquared([5, 5, 5, 5], [20, 0, 0, 0], 2);
    expect(r.chi).toBeCloseTo(0.25 / 1.5 + 0.5, 5);
    expect(r.tx).toBeCloseTo((r.chi - 0.1) / (Math.SQRT2 / 20), 3);
    expect(r.maxT).toBeCloseTo(1.9 / (Math.SQRT2 / 20), 3);
  });
  it('T(X) formula', () => {
    const t = tOf(1, 50, 1000);
    expect(t.tx).toBeCloseTo((1 - 0.05) / (Math.sqrt(50) / 1000), 1);
  });
  it('multivariate: same distribution low T, shifted high T', () => {
    const rnd = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = rnd(7);
    const mk = (n: number, dx: number) => Array.from({ length: n }, () => Float64Array.of(r() + dx, r()));
    const ctl = mk(4000, 0);
    const same = multivariateChi(ctl, mk(4000, 0), 2, 32);
    const diff = multivariateChi(ctl, mk(4000, 0.5), 2, 32);
    expect(same.bins).toBe(32);
    expect(diff.tx).toBeGreaterThan(same.tx * 10);
    expect(diff.chi).toBeGreaterThan(0.5);
  });
});

import { calibrationFormula, calibrationName, fitCalibration } from '../src/core/calibration';
import { compileFormula } from '../src/core/formula';
describe('MESF calibration (own rule)', () => {
  it('fits log-log regression and builds a formula', () => {
    // MESF = 50 * MFI^1.1 exactly
    const peaks = [10, 100, 1000, 10000].map((m) => ({ mfi: m, mesf: 50 * m ** 1.1 }));
    const f = fitCalibration(peaks)!;
    expect(f.slope).toBeCloseTo(1.1, 9);
    expect(10 ** f.intercept).toBeCloseTo(50, 6);
    expect(f.r).toBeCloseTo(1, 9);
    expect(calibrationName('FITC-A')).toBe('FITC_A_MESF');
    const fm = calibrationFormula('FITC-A', f);
    const c = compileFormula(fm, ['FITC-A']);
    expect(c.evaluate(Float64Array.of(100))).toBeCloseTo(50 * 100 ** 1.1, 3);
    expect(fitCalibration([{ mfi: 1, mesf: 2 }])).toBeNull();
  });
});
