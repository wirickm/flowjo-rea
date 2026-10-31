import { describe, expect, it } from 'vitest';
import { flowjoBiexTable, logicleParams, makeTransform } from '../src/core/transforms';
import { haveFixtures, readText } from './fixtures';

describe.skipIf(!haveFixtures)('FlowJo biex vs FlowJo-exported lookup table', () => {
  // Table is printed with 6 significant digits; relative tolerance 1e-5.
  it('matches all 4096 entries within 1e-5 relative (abs 1e-4 near zero)', () => {
    const rows = readText('flowjo_xforms/tr_biex_l256_w-7.943282_n1.000000_m4.418540_r262144.000029.csv')
      .trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
    expect(rows.length).toBe(4096);
    const t = flowjoBiexTable({ max: 262144.000029, width: -7.943282, pos: 4.41854, neg: 1, channelRange: 4096 });
    for (const [i, v] of rows) {
      expect(Math.abs(t[i] - v)).toBeLessThanOrEqual(Math.max(1e-5 * Math.abs(v), 1e-4));
    }
  });
});

describe('Gating-ML scale definitions (independent closed forms)', () => {
  it('flin, flog, fasinh match the published formulas', () => {
    const lin = makeTransform({ kind: 'linear', T: 1000, A: 100 });
    expect(lin.apply(400)).toBeCloseTo(500 / 1100, 15);
    const log = makeTransform({ kind: 'log', T: 10000, M: 4 });
    expect(log.apply(100)).toBeCloseTo(0.5, 15); // log10(1e-2)/4 + 1
    const as = makeTransform({ kind: 'asinh', T: 1000, M: 4, A: 1 });
    expect(as.apply(0)).toBeCloseTo(1 / 5, 15); // A ln10 / ((M+A) ln10)
    expect(as.apply(1000)).toBeCloseTo((4 * Math.LN10 + Math.LN10) / (5 * Math.LN10), 12);
  });
  it('logicle: B(1)=T, zero at (W+A)/(M+A), inverse round-trip, odd symmetry', () => {
    const p = logicleParams(262144, 0.5, 4.5, 0);
    const t = makeTransform({ kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 });
    expect(t.apply(262144)).toBeCloseTo(1, 12);
    expect(t.apply(0)).toBeCloseTo(0.5 / 4.5, 14);
    for (const x of [-5000, -10, -0.01, 0.01, 1, 77, 1e3, 1e5]) {
      expect(t.inverse(t.apply(x))).toBeCloseTo(x, 6);
      expect(t.apply(x) + t.apply(-x)).toBeCloseTo(2 * p.x1, 12);
    }
    // one decade below T logicle is within 1e-3 of log10(x/T)/M + 1
    expect(Math.abs(t.apply(26214.4) - (1 - 1 / 4.5))).toBeLessThan(1e-3);
  });
  it('rejects invalid parameters', () => {
    expect(() => makeTransform({ kind: 'logicle', T: 262144, W: 3, M: 4.5, A: 0 })).toThrow(/W must be/);
    expect(() => makeTransform({ kind: 'log', T: -1, M: 4 })).toThrow(/positive/);
    expect(() => makeTransform({ kind: 'flowjo-biex', max: 262144, width: 10, pos: 4.4, neg: 0, channelRange: 4096 })).toThrow(/negative/);
  });
});
