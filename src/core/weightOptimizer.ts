// FlowJo 10.6.2 spectral detector weight optimisation (CompCommand.OPTIMIZEWT
// "Optimize Weights", SSM-based processing): a coordinate search over the
// detector weights of the weighted least squares unmixing that minimises the
// sum of the spillover spreading matrix of the single-stain controls.
// Behaviour from libNativeEngine 3.6.2 WeightOptimizer::OptimizeWeights /
// CalculateSSM / CalculateSSMCoefficient (decoded with headless Ghidra; spec:
// docs/validation/ui-gaps/compensation.md, "OPTIMIZEWT"). Implemented
// independently. This module is the one owner of these rules.
import { eventLambdas, unmixEventWeighted, unmixingOperator, type SpilloverMatrix, type WeightOptimizationModel } from './compensation';
import { ssmCoefficient } from './compFlowjo';
import { fail } from './errors';
import { flowjoPercentile, flowjoSd, type ChannelScale } from './flowjoStats';

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

// Percentiles 50 and 84 of every fluorochrome for each population used by a
// control; `unmixed` returns a population's fluorochrome columns.
type PopStats = { p50: number[]; p84: number[] };
function populationStats(input: WeightOptInput, unmixed: (pop: Float64Array[]) => Float64Array[]): PopStats[] {
  const used = new Set(input.controls.flatMap((c) => [c.pos, c.neg]));
  return input.populations.map((pop, pi) => {
    if (!used.has(pi)) return { p50: [], p84: [] };
    const cols = unmixed(pop);
    return { p50: cols.map((c, f) => flowjoPercentile(c, input.scales[f], 50)), p84: cols.map((c, f) => flowjoPercentile(c, input.scales[f], 84)) };
  });
}
// The same unmixing operator for every event (detector weights).
function staticUnmix(input: WeightOptInput, weights: number[]) {
  const M = unmixingOperator({ ...input.matrix, weights });
  const nd = input.matrix.channels.length, nf = input.matrix.values.length;
  return (pop: Float64Array[]): Float64Array[] => {
    const n = pop[0]?.length ?? 0;
    return Array.from({ length: nf }, (_, f) => {
      const col = new Float64Array(n);
      for (let d = 0; d < nd; d++) {
        const x = pop[d], m = M[d][f];
        if (m === 0) continue;
        for (let e = 0; e < n; e++) col[e] += x[e] * m;
      }
      return col;
    });
  };
}

// SSM(i, j): spread of control i into fluorochrome j (rows = controls, as the
// wizard SSM), CalculateSSMCoefficient on the unmixed percentiles; 0 on the
// diagonal.
function ssmFromStats(input: WeightOptInput, st: PopStats[]): number[][] {
  const nf = input.matrix.values.length;
  return input.controls.map((c, i) => {
    const P = st[c.pos], N = st[c.neg];
    return Array.from({ length: nf }, (_, j) => (i === j ? 0 : ssmCoefficient(P.p84[j], P.p50[j], N.p84[j], N.p50[j], P.p50[i], N.p50[i])));
  });
}
export function ssmForWeights(input: WeightOptInput, weights: number[]): number[][] {
  return ssmFromStats(input, populationStats(input, staticUnmix(input, weights)));
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

// --- Method choice (OptimizeWeightDialog) and event-based processing --------
// The dialog opens only when the WeightOptimization preference has type
// EventBasedOptimizationProcessing and show on (CompensationAction.
// isEventOptimizationEnabledInPrefs); otherwise Sample Based runs directly.
export const METHOD_DIALOG_TITLE = 'Weight Optimization Selection';
export const SAMPLE_BASED = 'Sample Based Weight Optimization';
export const EVENT_BASED = 'Event Based Weight Optimization';
export const LAMBDA_INFO = '<Lambda = 0 means use variance based lambda.>';
// The Lambda field: a RangedDoubleTextField from 0 to Float.MAX_VALUE, shown
// as 0. Text that is not a number or is out of range is not accepted (the
// field returns to its last good value).
export const LAMBDA_MAX = 3.4028234663852886e38;
export function parseLambda(text: string): number | null {
  const t = text.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 && v <= LAMBDA_MAX ? v : null;
}
// OptimizeWeightDialog.runOptimization: the lambda is taken as a float; 0
// means the engine computes variance based lambdas (an engine run), any
// other value is stored on the matrix as its fixed lambda without a run.
export function eventModelForLambda(fieldValue: number): { runEngine: boolean; model: WeightOptimizationModel } {
  const lambda = Math.fround(fieldValue);
  return { runEngine: lambda === 0, model: { type: 'EventBasedOptimizationProcessing', engineBasedLambda: false, lambda } };
}
// WeightOptimizationThread.setOptimizedWeights for an event-based result:
// the returned lambdas are kept, engineBasedLambda is cleared and the lambda
// is the result's lambda attribute, which the engine does not write (0).
export const eventModelFromResult = (lambdas: { name: string; value: number }[]): WeightOptimizationModel => ({ type: 'EventBasedOptimizationProcessing', engineBasedLambda: false, lambda: 0, lambdas });

// Event-based input: the SSM controls plus the statistic scale of every raw
// detector (matrix order) for the SD of the negative populations.
export interface EventOptInput extends WeightOptInput { detectorScales: (ChannelScale | undefined)[] }

// Sample SD (n - 1) of exact values, for a detector without a FlowJo scale.
function exactSd(v: Float64Array): number {
  const n = v.length;
  if (n < 2) return NaN;
  let m = 0;
  for (let i = 0; i < n; i++) m += v[i];
  m /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (v[i] - m) * (v[i] - m);
  return Math.sqrt(ss / (n - 1));
}
// Variance based lambdas (RunVariableLambdaProcessing): for each detector,
// the mean over the controls of the squared SD statistic of the raw detector
// in the control's negative population.
export function variableLambdas(input: EventOptInput): number[] {
  const nc = input.controls.length;
  return input.matrix.channels.map((_, d) => {
    let s = 0;
    for (const c of input.controls) {
      const v = input.populations[c.neg][d], sc = input.detectorScales[d];
      const sd = sc ? flowjoSd(v, sc) : exactSd(v);
      s += (sd * sd) / nc;
    }
    return s;
  });
}
// A population unmixed event by event with weights 1 / (x + lambda_d).
export function eventUnmix(matrix: SpilloverMatrix, lambdas: number[], pop: Float64Array[]): Float64Array[] {
  const nd = matrix.channels.length, nf = matrix.values.length;
  const n = pop[0]?.length ?? 0;
  const cols = Array.from({ length: nf }, () => new Float64Array(n));
  const x = new Float64Array(nd), f = new Float64Array(nf);
  for (let e = 0; e < n; e++) {
    for (let d = 0; d < nd; d++) x[d] = pop[d][e];
    unmixEventWeighted(matrix.values, x, lambdas, f);
    for (let k = 0; k < nf; k++) cols[k][e] = f[k];
  }
  return cols;
}
export function eventSsm(input: WeightOptInput, lambdas: number[]): number[][] {
  return ssmFromStats(input, populationStats(input, (pop) => eventUnmix(input.matrix, lambdas, pop)));
}

// C++ ostream output of a float (6 significant digits, %g style), as the
// engine writes the SSM sum into its message.
export function formatG(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  if (v === 0) return '0';
  const [mant, ex] = v.toExponential(5).split('e');
  const x = Number(ex);
  const strip = (t: string) => (t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t);
  if (x < -4 || x >= 6) return `${strip(mant)}e${x < 0 ? '-' : '+'}${String(Math.abs(x)).padStart(2, '0')}`;
  return strip(v.toFixed(5 - x));
}

// The event-based run in slices: lambdas, then one control population
// unmixed per step, then the SSM. Progress: 0.5% "Compensating." while it
// runs, then 100% "Current best SSM sum is <sum as float>. ".
export class EventOptimization {
  lambdas: number[] = [];
  ssm: number[][] = [];
  done = false;
  private unmixed = new Map<number, Float64Array[]>();
  private queue: number[];
  private sum = 0;
  constructor(readonly input: EventOptInput) {
    checkWeightOptInput(input);
    if (input.detectorScales.length !== input.matrix.channels.length) fail('COMP_INVALID', 'Every detector needs a statistic scale entry');
    this.queue = [...new Set(input.controls.flatMap((c) => [c.pos, c.neg]))].sort((a, b) => a - b);
  }
  get progress(): WeightOptProgress {
    return this.done ? { fraction: 1, message: `Current best SSM sum is ${formatG(Math.fround(this.sum))}. ` } : { fraction: Math.fround(0.005), message: 'Compensating.' };
  }
  step(): boolean {
    if (this.done) return false;
    if (!this.lambdas.length) { this.lambdas = variableLambdas(this.input); return true; }
    const k = this.queue.shift();
    if (k !== undefined) { this.unmixed.set(k, eventUnmix(this.input.matrix, this.lambdas, this.input.populations[k])); return true; }
    this.ssm = ssmFromStats(this.input, populationStats(this.input, (pop) => this.unmixed.get(this.input.populations.indexOf(pop))!));
    this.sum = ssmSum(this.ssm);
    this.done = true;
    return false;
  }
  run(): { lambdas: { name: string; value: number }[]; ssm: number[][] } {
    while (this.step()) { /* next phase */ }
    return this.result;
  }
  get result() {
    return { lambdas: this.input.matrix.channels.map((name, d) => ({ name, value: this.lambdas[d] })), ssm: this.ssm };
  }
}

// How an event-weighted matrix unmixes, for the editor's description; null
// when the matrix is not event weighted.
export function eventUnmixText(m: SpilloverMatrix): string | null {
  const lam = eventLambdas(m);
  if (!lam) return null;
  const varying = lam.some((v) => v !== lam[0]);
  return `per-event weighted least squares, weights 1 / (value + lambda) with ${varying ? `lambdas ${lam.map((v) => +v.toPrecision(4)).join(', ')}` : `lambda ${lam[0]}`}`;
}
