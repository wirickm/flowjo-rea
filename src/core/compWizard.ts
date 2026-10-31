// Spillover estimation from single-stain controls. For each control stained
// for primary channel i, with positive events P and negative events N:
//   S[i][j] = (median_P(j) - median_N(j)) / (median_P(i) - median_N(i))
// N is the unstained control when given, otherwise the dimmest events of the
// same control on channel i. Controls whose positives are not separated from
// the negatives (median difference <= 3 robust SD of the negative) are
// rejected. Not compared with FlowJo's compensation wizard.
import type { SpilloverMatrix } from './compensation';
import { fail } from './errors';
import { quantileSorted } from './stats';

export interface ControlInput {
  label: string; // file name, for messages
  primary: string | null; // channel this tube is stained for; null = unstained
  columns: Map<string, Float64Array>; // raw (uncompensated) values per channel
  mask?: Uint8Array; // optional pre-gate (e.g. scatter); all events when absent
}

export interface ControlDiagnostic {
  label: string;
  primary: string;
  positives: number;
  negatives: number;
  negativeSource: 'unstained' | 'same tube';
  positiveMedian: number;
  negativeMedian: number;
  warnings: string[];
}

export interface WizardResult {
  matrix: SpilloverMatrix;
  diagnostics: ControlDiagnostic[];
}

const MIN_EVENTS = 100;

function median(col: Float64Array, idx: number[]): number {
  const v = Float64Array.from(idx, (i) => col[i]).sort();
  return quantileSorted(v, 0.5);
}

// positivePct: brightest percentage of the (gated) control on its primary
// channel taken as positive; the same percentage of dimmest events is the
// negative when no unstained control exists.
export function estimateSpillover(controls: ControlInput[], channels: string[], positivePct = 10): WizardResult {
  if (!(positivePct > 0 && positivePct < 50)) fail('COMP_INVALID', 'Positive percentage must be between 0 and 50');
  const stained = controls.filter((c) => c.primary !== null);
  const unstained = controls.filter((c) => c.primary === null);
  if (unstained.length > 1) fail('COMP_INVALID', 'Assign at most one unstained control');
  const prim = stained.map((c) => c.primary!);
  const dup = prim.find((p, i) => prim.indexOf(p) !== i);
  if (dup) fail('COMP_INVALID', `Channel ${dup} has more than one control`);
  const order = channels.filter((ch) => prim.includes(ch));
  if (order.length < 2) fail('COMP_INVALID', 'At least two single-stain controls are needed');
  for (const c of controls) {
    const missing = order.filter((ch) => !c.columns.has(ch));
    if (missing.length) fail('COMP_CHANNEL_MISMATCH', `${c.label} lacks channels: ${missing.join(', ')}`);
  }
  const gated = (c: ControlInput) => {
    const n = c.columns.get(order[0])!.length;
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (!c.mask || c.mask[i]) out.push(i);
    return out;
  };
  const un = unstained[0];
  const unIdx = un ? gated(un) : null;
  if (un && unIdx!.length < MIN_EVENTS) fail('COMP_INVALID', `Unstained control ${un.label} has only ${unIdx!.length} gated events`);

  const diagnostics: ControlDiagnostic[] = [];
  const values = order.map((ch) => {
    const c = stained.find((x) => x.primary === ch)!;
    const idx = gated(c);
    const prim = c.columns.get(ch)!;
    const sorted = [...idx].sort((a, b) => prim[a] - prim[b]);
    const k = Math.floor((sorted.length * positivePct) / 100);
    if (k < MIN_EVENTS) fail('COMP_INVALID', `${c.label}: only ${k} positive events at ${positivePct}% (need ${MIN_EVENTS})`);
    const pos = sorted.slice(sorted.length - k);
    const negIdx = unIdx ?? sorted.slice(0, k);
    const negCols = unIdx ? un.columns : c.columns;
    const warnings: string[] = [];
    const denom = median(prim, pos) - median(negCols.get(ch)!, negIdx);
    // Separation rule: positives must exceed the negatives by more than 3
    // robust SDs of the negative on the primary channel, else the "positive"
    // events are just the noise tail of an unstained tube.
    const negSorted = Float64Array.from(negIdx, (i) => negCols.get(ch)![i]).sort();
    const rsd = (quantileSorted(negSorted, 0.8413) - quantileSorted(negSorted, 0.1587)) / 2;
    if (!(denom > 3 * rsd)) fail('COMP_INVALID', `${c.label}: positive population is not separated from the negative on ${ch} (difference ${denom.toFixed(1)}, 3 x robust SD ${(3 * rsd).toFixed(1)})`);
    const row = order.map((other) => {
      if (other === ch) return 1;
      const s = (median(c.columns.get(other)!, pos) - median(negCols.get(other)!, negIdx)) / denom;
      if (s > 1) warnings.push(`spills more into ${other} (${s.toFixed(3)}) than into its own channel`);
      if (s < -0.05) warnings.push(`negative spillover into ${other} (${s.toFixed(3)}); check the negative population`);
      return s;
    });
    diagnostics.push({
      label: c.label,
      primary: ch,
      positives: pos.length,
      negatives: negIdx.length,
      negativeSource: unIdx ? 'unstained' : 'same tube',
      positiveMedian: median(prim, pos),
      negativeMedian: median(negCols.get(ch)!, negIdx),
      warnings,
    });
    return row;
  });
  return {
    matrix: { id: `wizard-${Date.now().toString(36)}`, name: `Wizard matrix (${order.length} controls)`, channels: order, values, source: 'compensation wizard' },
    diagnostics,
  };
}
