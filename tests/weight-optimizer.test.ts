// Spectral detector weight optimisation (CompCommand.OPTIMIZEWT; libNativeEngine
// 3.6.2 WeightOptimizer, docs/validation/ui-gaps/compensation.md).
import { describe, expect, it } from 'vitest';
import type { SpilloverMatrix } from '../src/core/compensation';
import { ssmCoefficient } from '../src/core/compFlowjo';
import { flowjoPercentile, type ChannelScale } from '../src/core/flowjoStats';
import {
  FIRST_FACTOR, hasCustomWeights, MAX_ITERATIONS, optimizeWeights, SECOND_DAMPING, ssmForWeights, ssmSum, WeightSearch, type WeightOptInput,
} from '../src/core/weightOptimizer';

describe('weight search (OptimizeWeights)', () => {
  it('stops after the third stall counted from iteration index 5 when nothing improves', () => {
    const s = new WeightSearch(3, () => 10);
    s.run();
    // Sweeps 0..7: stalls at 5, 6, 7; two trials per detector per sweep.
    expect(s.iteration).toBe(8);
    expect(s.evaluations).toBe(2 * 3 * 8);
    expect(s.weights).toEqual([1, 1, 1]);
    expect(s.progress).toEqual({ fraction: 1, message: 'Done.' });
  });
  it('tries f and 1/f times the weight and keeps the better trial', () => {
    const s = new WeightSearch(1, (w) => Math.abs(w[0] - 0.5) + 1);
    expect(s.best).toBe(1.5);
    s.step();
    // 0.6667 x 1 gives 1.1667 < 1.5; 1.49993 x 1 gives 1.99993.
    expect(s.weights[0]).toBe(FIRST_FACTOR);
    expect(s.best).toBe(Math.fround(Math.abs(FIRST_FACTOR - 0.5) + 1));
    expect(s.iteration).toBe(1);
  });
  it('the factor moves toward 1 by 0.9 each sweep', () => {
    const seen: number[] = [];
    const s = new WeightSearch(1, (w) => { seen.push(w[0]); return 5; });
    s.step();
    s.step();
    // seen[0] is the initial sum at weights 1. Second sweep trials: f1 = (0.6667 - 1) x 0.9 + 1 and 1 / f1, from weight 1.
    const f1 = Math.fround((FIRST_FACTOR - 1) * Math.fround(0.9) + 1);
    expect(seen.slice(3)).toEqual([f1, Math.fround(1 / f1)]);
  });
  it('switches to the second pair (0.3333, damping 0.5) at the first stall', () => {
    const seen: number[] = [];
    const s = new WeightSearch(1, (w) => { seen.push(w[0]); return 5; });
    for (let i = 0; i < 7; i++) s.step();
    // Sweep 5 stalls: the factor becomes (0.3333 - 1) x 0.5 + 1 for sweep 6.
    const f6 = Math.fround((Math.fround(0.3333) - 1) * SECOND_DAMPING + 1);
    expect(seen.slice(13, 15)).toEqual([f6, Math.fround(1 / f6)]);
  });
  it('stops once the 0-based sweep index exceeds MAX_ITERATIONS (52 sweeps) while every sweep improves by 1% or more', () => {
    let k = 100;
    const s = new WeightSearch(2, () => (k *= 0.9));
    s.run();
    expect(s.iteration).toBe(MAX_ITERATIONS + 2);
  });
  it('progress starts at 3% and grows 1.94% per sweep with the iteration message', () => {
    const s = new WeightSearch(2, () => 4);
    expect(s.progress.fraction).toBeCloseTo(0.03, 6);
    expect(s.progress.message).toBe('Iteration 1 : Optimizing detector 1, current best SSM sum is 4. ');
    s.step(); s.step();
    expect(s.progress.fraction).toBeCloseTo(0.0494, 5);
  });
  it('customized weights are those strictly between 0 and 1', () => {
    expect(hasCustomWeights(undefined)).toBe(false);
    expect(hasCustomWeights([1, 2, 1])).toBe(false);
    expect(hasCustomWeights([1, 0.5])).toBe(true);
  });
});

// Two dyes on three detectors; detector 3 carries much more noise.
function synthetic(): WeightOptInput {
  const S = [[1, 0.2, 0.5], [0.3, 1, 0.5]];
  const matrix: SpilloverMatrix = { id: 's', name: 's', channels: ['D1', 'D2', 'D3'], outputNames: ['A', 'B'], values: S, source: 'test', kind: 'spectral' };
  let st = 7;
  const u = () => ((st = (1664525 * st + 1013904223) >>> 0) + 0.5) / 4294967296;
  const nrm = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const pop = (dye: number, n: number) => {
    const cols = [0, 1, 2].map(() => new Float64Array(n));
    for (let e = 0; e < n; e++) {
      const b = dye < 0 ? 0 : 20000 * (1 + 0.2 * nrm());
      // Photon-like noise grows with the signal; detector 3 is much noisier.
      for (let d = 0; d < 3; d++) {
        const sig = dye < 0 ? 0 : b * S[dye][d];
        cols[d][e] = 300 + sig + (d === 2 ? 200 : 40) * nrm() + (d === 2 ? 12 : 2) * Math.sqrt(sig) * nrm();
      }
    }
    return cols;
  };
  const scale: ChannelScale = { kind: 'linear', min: -20000, max: 262144 };
  return { matrix, populations: [pop(0, 3000), pop(1, 3000), pop(-1, 4000)], controls: [{ pos: 0, neg: 2 }, { pos: 1, neg: 2 }], scales: [scale, scale] };
}

describe('SSM of the unmixed controls (CalculateSSM)', () => {
  it('equals CalculateSSMCoefficient on percentiles of the unmixed populations', () => {
    const inp = synthetic();
    const ssm = ssmForWeights(inp, [1, 1, 1]);
    // Unmix by hand with ordinary least squares and recompute SSM(A, B).
    const S = inp.matrix.values;
    const StS = [[0, 0], [0, 0]];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let d = 0; d < 3; d++) StS[i][j] += S[i][d] * S[j][d];
    const det = StS[0][0] * StS[1][1] - StS[0][1] * StS[1][0];
    const inv = [[StS[1][1] / det, -StS[0][1] / det], [-StS[1][0] / det, StS[0][0] / det]];
    const un = (pop: Float64Array[], f: number) => Float64Array.from(pop[0], (_, e) => [0, 1, 2].reduce((s, d) => s + pop[d][e] * (inv[0][f] * S[0][d] + inv[1][f] * S[1][d]), 0));
    const pc = (pop: Float64Array[], f: number, q: number) => flowjoPercentile(un(pop, f), inp.scales[f], q);
    const [P, , N] = inp.populations;
    const want = ssmCoefficient(pc(P, 1, 84), pc(P, 1, 50), pc(N, 1, 84), pc(N, 1, 50), pc(P, 0, 50), pc(N, 0, 50));
    expect(ssm[0][1]).toBeCloseTo(want, 9);
    expect(ssm[0][0]).toBe(0);
    expect(ssm[1][1]).toBe(0);
  });
  it('optimisation lowers the SSM sum by down-weighting the noisy detector, deterministically', () => {
    const inp = synthetic();
    const before = ssmSum(ssmForWeights(inp, [1, 1, 1]));
    const a = optimizeWeights(inp);
    const b = optimizeWeights(synthetic());
    expect(a.weights).toEqual(b.weights);
    expect(a.best).toBe(b.best);
    expect(a.best).toBeLessThan(Math.fround(before));
    expect(a.weights[2]).toBeLessThan(Math.min(a.weights[0], a.weights[1]));
    expect(a.iterations).toBeGreaterThan(5);
    expect(a.iterations).toBeLessThanOrEqual(MAX_ITERATIONS + 2);
    expect(ssmSum(a.ssm)).toBeCloseTo(a.best, 2);
  });
  it('refuses a fluorochrome without a control', () => {
    const inp = synthetic();
    expect(() => optimizeWeights({ ...inp, controls: inp.controls.slice(0, 1) })).toThrow(/Every fluorochrome needs a control/);
  });
});
