// Spectral detector weight optimisation (CompCommand.OPTIMIZEWT; libNativeEngine
// 3.6.2 WeightOptimizer, docs/validation/ui-gaps/compensation.md).
import { describe, expect, it } from 'vitest';
import { eventLambdas, MIN_EVENT_LAMBDA, unmix, unmixEventWeighted, type SpilloverMatrix } from '../src/core/compensation';
import { ssmCoefficient } from '../src/core/compFlowjo';
import { flowjoPercentile, type ChannelScale } from '../src/core/flowjoStats';
import {
  FIRST_FACTOR, hasCustomWeights, MAX_ITERATIONS, optimizeWeights, SECOND_DAMPING, ssmForWeights, ssmSum, WeightSearch, type WeightOptInput,
} from '../src/core/weightOptimizer';
import { EventOptimization, eventModelForLambda, eventModelFromResult, eventSsm, eventUnmixText, formatG, LAMBDA_MAX, parseLambda, variableLambdas, type EventOptInput } from '../src/core/weightOptimizer';

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

// Event based weight optimisation (OptimizeWeightDialog, WeightOptimizer::
// RunVariableLambdaProcessing, Compensator::Compensate event weighting).

describe('event-weighted unmixing (Compensator::Compensate)', () => {
  const one: SpilloverMatrix = { id: 'e', name: 'e', channels: ['D1', 'D2'], outputNames: ['A'], values: [[1, 1]], source: 't', kind: 'spectral' };
  it('weights each detector by 1 / (value + lambda)', () => {
    const f = new Float64Array(1);
    // w = 1/2, 1/4: f = (2/2 + 4/4) / (1/2 + 1/4) = 8/3.
    unmixEventWeighted([[1, 1]], [2, 4], [0, 0], f);
    expect(f[0]).toBeCloseTo(8 / 3, 12);
    // A huge lambda makes the weights equal: the plain mean 3.
    unmixEventWeighted([[1, 1]], [2, 4], [1e12, 1e12], f);
    expect(f[0]).toBeCloseTo(3, 6);
  });
  it('lambda 0.001 or less reads as 0.001; the lambdas list is used by position only with engineBasedLambda', () => {
    expect(eventLambdas(one)).toBeNull();
    const ev = (wo: Partial<NonNullable<SpilloverMatrix['weightOptimization']>>) => eventLambdas({ ...one, weightOptimization: { type: 'EventBasedOptimizationProcessing', engineBasedLambda: false, lambda: 0, ...wo } });
    expect(ev({})).toEqual([MIN_EVENT_LAMBDA, MIN_EVENT_LAMBDA]);
    expect(ev({ lambda: 5 })).toEqual([5, 5]);
    const lambdas = [{ name: 'D2', value: 7 }, { name: 'D1', value: 9 }];
    expect(ev({ lambda: 5, lambdas })).toEqual([5, 5]);
    expect(ev({ lambda: 5, engineBasedLambda: true, lambdas })).toEqual([7, 9]);
  });
  it('unmix applies the per-event weights and ignores the static detector weights', () => {
    const m: SpilloverMatrix = { ...one, weights: [1, 100], weightOptimization: { type: 'EventBasedOptimizationProcessing', engineBasedLambda: false, lambda: 1 } };
    const out = unmix([Float64Array.of(1, 9), Float64Array.of(3, 1)], ['D1', 'D2'], m).get('A')!;
    // Event 1: w = 1/2, 1/4 -> (1/2 + 3/4) / (3/4) = 5/3. Event 2: w = 1/10, 1/2 -> (0.9 + 0.5) / 0.6.
    expect(out[0]).toBeCloseTo(5 / 3, 12);
    expect(out[1]).toBeCloseTo(1.4 / 0.6, 12);
  });
});

describe('method dialog (OptimizeWeightDialog)', () => {
  it('the Lambda field accepts numbers from 0 to Float.MAX_VALUE', () => {
    expect(parseLambda('0')).toBe(0);
    expect(parseLambda(' 2.5 ')).toBe(2.5);
    expect(parseLambda('3.4e38')).toBe(3.4e38);
    expect(parseLambda(String(LAMBDA_MAX))).toBe(LAMBDA_MAX);
    expect(parseLambda('-1')).toBeNull();
    expect(parseLambda('1e39')).toBeNull();
    expect(parseLambda('abc')).toBeNull();
    expect(parseLambda('')).toBeNull();
  });
  it('lambda 0 runs the engine (variance based lambdas); another lambda is stored as a float without a run', () => {
    expect(eventModelForLambda(0)).toEqual({ runEngine: true, model: { type: 'EventBasedOptimizationProcessing', engineBasedLambda: false, lambda: 0 } });
    const r = eventModelForLambda(0.1);
    expect(r.runEngine).toBe(false);
    expect(r.model.lambda).toBe(Math.fround(0.1));
    expect(eventModelFromResult([{ name: 'D1', value: 2 }])).toEqual({ type: 'EventBasedOptimizationProcessing', engineBasedLambda: false, lambda: 0, lambdas: [{ name: 'D1', value: 2 }] });
  });
  it('formats the SSM sum as a C++ float stream does', () => {
    expect(formatG(12.3456789)).toBe('12.3457');
    expect(formatG(100)).toBe('100');
    expect(formatG(1234567)).toBe('1.23457e+06');
    expect(formatG(0.0001)).toBe('0.0001');
    expect(formatG(0.00001234)).toBe('1.234e-05');
    expect(formatG(0)).toBe('0');
  });
});

describe('variance based lambdas and the event-based run (RunVariableLambdaProcessing)', () => {
  const tiny = (negB: number[][]): EventOptInput => {
    const matrix: SpilloverMatrix = { id: 't', name: 't', channels: ['D1', 'D2'], outputNames: ['A', 'B'], values: [[1, 0.1], [0.2, 1]], source: 't', kind: 'spectral' };
    const pos = [Float64Array.of(100, 110, 120), Float64Array.of(10, 12, 14)];
    const negA = [Float64Array.of(1, 2, 3), Float64Array.of(5, 5, 8)];
    const lin: ChannelScale = { kind: 'linear', min: 0, max: 1000 };
    return { matrix, populations: [pos, negA, negB.map((c) => Float64Array.from(c)), pos], controls: [{ pos: 0, neg: 1 }, { pos: 3, neg: 2 }], scales: [lin, lin], detectorScales: [undefined, undefined] };
  };
  it('each detector gets the mean over the controls of the squared SD of its negative population', () => {
    // D1: SD [1,2,3] = 1 and SD [0,2,4] = 2 -> (1 + 4) / 2. D2: SD [5,5,8] = sqrt(3), SD [1,1,1] = 0 -> 3 / 2.
    const l = variableLambdas(tiny([[0, 2, 4], [1, 1, 1]]));
    expect(l[0]).toBe(2.5);
    expect(l[1]).toBeCloseTo(1.5, 12);
    // A universal negative counts once per control.
    const u = tiny([[1, 2, 3], [5, 5, 8]]);
    const lu = variableLambdas({ ...u, controls: [{ pos: 0, neg: 1 }, { pos: 3, neg: 1 }] });
    expect(lu[0]).toBe(1);
    expect(lu[1]).toBeCloseTo(3, 12);
  });
  it('uses the FlowJo SD statistic on a detector scale', () => {
    const inp = tiny([[0, 2, 4], [1, 1, 1]]);
    const lin: ChannelScale = { kind: 'linear', min: 0, max: 4096 };
    // On a 4096-channel scale of 0..4096 the channel values are the data values.
    expect(variableLambdas({ ...inp, detectorScales: [lin, lin] })[0]).toBeCloseTo(2.5, 5);
  });
  it('runs in slices: Compensating. at 0.5%, then the SSM sum message at 100%, deterministically', () => {
    const base = synthetic();
    const inp: EventOptInput = { ...base, detectorScales: [undefined, undefined, undefined] };
    const run = new EventOptimization(inp);
    expect(run.progress).toEqual({ fraction: Math.fround(0.005), message: 'Compensating.' });
    let steps = 0;
    while (run.step()) steps++;
    // lambdas, then the three used populations.
    expect(steps).toBe(4);
    const lambdas = variableLambdas(inp);
    expect(run.result.lambdas).toEqual(['D1', 'D2', 'D3'].map((name, d) => ({ name, value: lambdas[d] })));
    expect(run.ssm).toEqual(eventSsm(inp, lambdas));
    expect(run.progress).toEqual({ fraction: 1, message: `Current best SSM sum is ${formatG(Math.fround(ssmSum(run.ssm)))}. ` });
    // The noisy detector D3 has the largest variance based lambda.
    expect(lambdas[2]).toBeGreaterThan(Math.max(lambdas[0], lambdas[1]));
    const again = new EventOptimization({ ...synthetic(), detectorScales: [undefined, undefined, undefined] }).run();
    expect(again).toEqual(run.result);
    expect(run.ssm[0][0]).toBe(0);
    expect(run.ssm[0][1]).toBeGreaterThan(0);
  });
  it('describes an event-weighted matrix', () => {
    const m = synthetic().matrix;
    expect(eventUnmixText(m)).toBeNull();
    expect(eventUnmixText({ ...m, weightOptimization: { type: 'EventBasedOptimizationProcessing', engineBasedLambda: false, lambda: 0 } })).toBe('per-event weighted least squares, weights 1 / (value + lambda) with lambda 0.001');
  });
});
