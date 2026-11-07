// FlowJo 10.6.2 spectral detector weight optimisation (CompCommand.OPTIMIZEWT
// "Optimize Weights", SSM-based processing): a coordinate search over the
// detector weights of the weighted least squares unmixing that minimises the
// sum of the spillover spreading matrix of the single-stain controls.
// Behaviour from libNativeEngine 3.6.2 WeightOptimizer::OptimizeWeights /
// CalculateSSM / CalculateSSMCoefficient (decoded with headless Ghidra; spec:
// docs/validation/ui-gaps/compensation.md, "OPTIMIZEWT"). Implemented
// independently. This module is the one owner of these rules.
import { unmixingOperator, type SpilloverMatrix } from './compensation';
import { ssmCoefficient } from './compFlowjo';
import { fail } from './errors';
import { flowjoPercentile, type ChannelScale } from './flowjoStats';

// WeightOptimizer::MAX_ITERATIONS. The loop stops once the 0-based iteration
// index exceeds it, so at most MAX_ITERATIONS + 2 sweeps run (the progress
// bar, sized for 50, is full before that).
export const MAX_ITERATIONS = 50;
// First multiplier pair (f, 1/f) and its damping; after the first stall the
// search switches to the second pair with the second damping.
export const FIRST_FACTOR = Math.fround(0.6667);
export const FIRST_DAMPING = Math.fround(0.9);
export const SECOND_FACTOR = Math.fround(0.3333);
export const SECOND_DAMPING = Math.fround(0.5);
// A sweep that lowers the best SSM sum by less than 1% is a stall; stalls
// count from iteration index 5 on, and the third stall ends the search.
export const IMPROVEMENT = 0.99;
export const FIRST_STALL_ITERATION = 5;
export const STALLS_TO_STOP = 3;

// Progress (WeightOptimizer::setProgress): 0.5% "Compensating.", 1%
// "Compensation Completed." and "Calculating SSM.", 2% "Evaluating SSM ",
// then 3% plus 1.94% / detectors per detector visited, "Done." at 100%.
export interface WeightOptProgress { fraction: number; message: string }

// One sweep step of the search: the objective is evaluated on trial weights.
export class WeightSearch {
  weights: number[];
  best: number; // float32, as the engine keeps it
  iteration = 0;
  detector = 0;
  done = false;
  evaluations = 0;
  private pair: [number, number] = [FIRST_FACTOR, 0];
  private damping = FIRST_DAMPING;
  private switched = false;
  private stalls = 0;
  private startBest: number;
  private percent = 3;
  constructor(n: number, readonly evaluate: (w: number[]) => number, initialSum = evaluate(new Array(n).fill(1))) {
    if (n < 1) fail('COMP_INVALID', 'Weight optimisation needs at least one detector');
    this.weights = new Array(n).fill(1);
    this.best = Math.fround(initialSum);
    this.startBest = this.best;
    this.pair[1] = Math.fround(1 / this.pair[0]);
  }
  get progress(): WeightOptProgress {
    if (this.done) return { fraction: 1, message: 'Done.' };
    return { fraction: Math.min(1, Math.fround(this.percent * Math.fround(0.01))), message: `Iteration ${this.iteration + 1} : Optimizing detector ${this.detector + 1}, current best SSM sum is ${this.best}. ` };
  }
  // Visits one detector: tries f x weight and (1/f) x weight with the other
  // weights fixed, keeps the trial with the lowest SSM sum if it beats the
  // best so far. After the last detector the sweep's stopping rule runs.
  step(): boolean {
    if (this.done) return false;
    const d = this.detector;
    const base = this.weights[d];
    let keep = base;
    for (const f of this.pair) {
      const trial = this.weights.slice();
      trial[d] = f * base;
      const s = Math.fround(this.evaluate(trial));
      this.evaluations++;
      if (s < this.best) { this.best = s; keep = trial[d]; }
    }
    this.weights[d] = keep;
    this.percent = Math.fround(this.percent + Math.fround(Math.fround(1 / this.weights.length) * Math.fround(1.94)));
    this.detector++;
    if (this.detector < this.weights.length) return true;
    this.endSweep();
    return !this.done;
  }
  private endSweep() {
    const it = this.iteration;
    let stop = false;
    if (this.best >= this.startBest * IMPROVEMENT) {
      if (it >= FIRST_STALL_ITERATION) {
        this.stalls++;
        if (this.stalls === STALLS_TO_STOP) stop = true;
        else if (!this.switched) {
          this.switched = true;
          this.damping = SECOND_DAMPING;
          this.pair = [SECOND_FACTOR, Math.fround(2)];
        }
      }
    } else this.stalls = 0;
    if (it > MAX_ITERATIONS) stop = true;
    // The factor moves toward 1 by the damping every sweep: f = (f - 1) d + 1.
    this.pair[0] = Math.fround((this.pair[0] - 1) * this.damping + 1);
    this.pair[1] = Math.fround(1 / this.pair[0]);
    this.iteration++;
    this.detector = 0;
    this.startBest = this.best;
    this.done = stop;
  }
  run(): number[] {
    while (this.step()) { /* next detector */ }
    return this.weights;
  }
}

// --- SSM of the unmixed controls (WeightOptimizer::CalculateSSM) -----------
// One single-stain control per fluorochrome (matrix row), with its positive
// and negative populations as raw detector values in the matrix's detector
// order. Populations are referenced by index so a universal negative is
// unmixed once per evaluation.
export interface WeightOptInput {
  matrix: SpilloverMatrix; // spectral: fluorochrome rows x detector columns
  populations: Float64Array[][]; // [population][detector] raw values
  controls: { pos: number; neg: number }[]; // aligned with matrix rows
  scales: ChannelScale[]; // statistic scale per fluorochrome
}

// Percentiles 50 and 84 of every fluorochrome for each population, unmixed
// with the given weights.
function populationStats(input: WeightOptInput, weights: number[]): { p50: number[]; p84: number[] }[] {
  const M = unmixingOperator({ ...input.matrix, weights });
  const nd = input.matrix.channels.length, nf = input.matrix.values.length;
  const used = new Set(input.controls.flatMap((c) => [c.pos, c.neg]));
  return input.populations.map((pop, pi) => {
    if (!used.has(pi)) return { p50: [], p84: [] };
    const n = pop[0]?.length ?? 0;
    const p50: number[] = [], p84: number[] = [];
    const col = new Float64Array(n);
    for (let f = 0; f < nf; f++) {
      col.fill(0);
      for (let d = 0; d < nd; d++) {
        const x = pop[d], m = M[d][f];
        if (m === 0) continue;
        for (let e = 0; e < n; e++) col[e] += x[e] * m;
      }
      p50.push(flowjoPercentile(col, input.scales[f], 50));
      p84.push(flowjoPercentile(col, input.scales[f], 84));
    }
    return { p50, p84 };
  });
}

// SSM(i, j): spread of control i into fluorochrome j (rows = controls, as the
// wizard SSM), CalculateSSMCoefficient on the unmixed percentiles; 0 on the
// diagonal.
export function ssmForWeights(input: WeightOptInput, weights: number[]): number[][] {
  const st = populationStats(input, weights);
  const nf = input.matrix.values.length;
  return input.controls.map((c, i) => {
    const P = st[c.pos], N = st[c.neg];
    return Array.from({ length: nf }, (_, j) => (i === j ? 0 : ssmCoefficient(P.p84[j], P.p50[j], N.p84[j], N.p50[j], P.p50[i], N.p50[i])));
  });
}
export const ssmSum = (ssm: number[][]) => ssm.reduce((s, r) => r.reduce((t, v) => t + v, s), 0);

export function checkWeightOptInput(input: WeightOptInput): void {
  const { matrix } = input;
  const nf = matrix.values.length, nd = matrix.channels.length;
  if (nf < 2) fail('COMP_INVALID', 'Weight optimisation needs a spectral matrix with at least 2 fluorochromes');
  if (input.controls.length !== nf) fail('COMP_INVALID', 'Every fluorochrome needs a control with a positive and a negative population');
  if (input.scales.length !== nf) fail('COMP_INVALID', 'Every fluorochrome needs a statistic scale');
  for (const c of input.controls) {
    for (const k of [c.pos, c.neg]) {
      const p = input.populations[k];
      if (!p || p.length !== nd) fail('COMP_INVALID', 'Control populations must have one column per detector');
      if (!(p[0]?.length > 0)) fail('COMP_INVALID', 'A control population has no events');
    }
  }
  unmixingOperator(matrix);
}

// The whole optimisation: weights start at 1 (the engine's default), the
// initial SSM sum is taken there, and the search runs to its stopping rule.
export function createWeightSearch(input: WeightOptInput): WeightSearch {
  checkWeightOptInput(input);
  return new WeightSearch(input.matrix.channels.length, (w) => ssmSum(ssmForWeights(input, w)));
}
export function optimizeWeights(input: WeightOptInput): { weights: number[]; ssm: number[][]; iterations: number; best: number } {
  const s = createWeightSearch(input);
  const weights = s.run();
  return { weights, ssm: ssmForWeights(input, weights), iterations: s.iteration, best: s.best };
}

// "You already have customized weights": FlowJo asks before overwriting when
// any stored weight lies strictly between 0 and 1 (CompPerspective.shouldOptimize).
export const hasCustomWeights = (w: number[] | undefined) => !!w && w.some((v) => v > 0 && v < 1);
export const OVERWRITE_PROMPT = 'Optimizing weights take some time to finish. You already have customized weights for this workspace. Do you want to overwrite them?';
export const PROGRESS_NOTE = 'The progress bar is based on the maximum of 50 iterations, however, the weight optimization typically converges in about 10-15 iterations.';
