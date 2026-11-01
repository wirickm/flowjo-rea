// FlowJo 10 histogram statistics: median, percentiles, robust SD and robust
// CV are read from a 4096-channel histogram of the population on the
// channel's FlowJo scale, then converted back to data values.
// Spec: docs/validation/flowjo-engine-specs.md, section 4.
import { logicleTable, tableIndex } from './gateGrid';
import type { TransformSpec } from './transforms';

export type ChannelScale =
  | { kind: 'linear'; min: number; max: number }
  | { kind: 'logicle'; T: number; W: number; M: number; A: number };

const N = 4096;

function channelOf(s: ChannelScale, v: number): number {
  if (s.kind === 'logicle') return tableIndex(logicleTable(s.T, s.W, s.M, s.A), v);
  const c = Math.floor(((Math.fround(v) - s.min) * N) / (s.max - s.min) + 0.5);
  return c < 0 ? 0 : c > N - 1 ? N - 1 : c;
}

function valueOf(s: ChannelScale, c: number): number {
  if (s.kind === 'logicle') {
    const t = logicleTable(s.T, s.W, s.M, s.A);
    return t[Math.min(c, t.length - 1)];
  }
  return s.min + (c * (s.max - s.min)) / N;
}

class Histogram {
  bins = new Float64Array(N);
  constructor(readonly scale: ChannelScale, values: Float64Array, readonly n = values.length) {
    for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) this.bins[channelOf(scale, values[i])]++;
  }
  // First channel whose cumulative count reaches n * p / 100 (single
  // precision, as FlowJo); the last channel if none of the first N-1 does.
  channel(p: number): number {
    const target = Math.fround(Math.fround(Math.fround(this.n) * Math.fround(p)) * 0.01);
    if (!(target > 0)) return 0;
    let cum = 0;
    for (let k = 0; k < N - 1; k++) {
      cum += this.bins[k];
      if (Math.fround(cum) >= target) return k;
    }
    return N - 1;
  }
  value(p: number): number {
    return valueOf(this.scale, this.channel(p));
  }
}

export function flowjoPercentile(values: Float64Array, s: ChannelScale, p: number): number {
  if (values.length === 0) return NaN;
  return new Histogram(s, values).value(p);
}

// FlowJo robust SD: (P84.13 - P15.87) / 2, with one-sided fallbacks when the
// histogram is saturated at either end or the lower half is compressed.
export function flowjoRobustSd(values: Float64Array, s: ChannelScale): number {
  if (values.length === 0) return NaN;
  const h = new Histogram(s, values);
  const c16 = h.channel(15.87), c84 = h.channel(84.13);
  const lo = Math.fround(valueOf(s, c16)), hi = Math.fround(valueOf(s, c84)), med = Math.fround(h.value(50));
  if (c84 > N - 2) return med - lo;
  const up = hi - med;
  if (c16 < 1) return up;
  if (0.75 * up > med - lo && (med < 0 || 0.05 * N > c16)) return up;
  return (hi - lo) * 0.5;
}

// 100 x robust SD / median; FlowJo reports 0 below 6 events.
export function flowjoRobustCv(values: Float64Array, s: ChannelScale): number {
  if (values.length === 0) return NaN;
  if (values.length < 6) return 0;
  return (100 * flowjoRobustSd(values, s)) / new Histogram(s, values).value(50);
}

// The FlowJo scale of a channel: an imported FlowJo linear range, else the
// workspace display scale when it is linear or logicle. Undefined otherwise
// (statistics then use exact order statistics).
export function channelScale(spec: TransformSpec | undefined, flowjoRange?: [number, number]): ChannelScale | undefined {
  if (flowjoRange) return { kind: 'linear', min: flowjoRange[0], max: flowjoRange[1] };
  if (spec?.kind === 'linear') return { kind: 'linear', min: -spec.A, max: spec.T };
  if (spec?.kind === 'logicle') return { kind: 'logicle', T: spec.T, W: spec.W, M: spec.M, A: spec.A };
  return undefined;
}

// Scales for the statistic channels of one sample.
export function statScales(
  channelTransforms: Record<string, TransformSpec>,
  flowjoLinearRanges: Record<string, [number, number]> | undefined,
  channels: (string | undefined)[],
): Record<string, ChannelScale> {
  const out: Record<string, ChannelScale> = {};
  for (const ch of channels) {
    if (!ch || ch in out) continue;
    const s = channelScale(channelTransforms[ch], flowjoLinearRanges?.[ch] ?? flowjoLinearRanges?.[`Comp-${ch}`]);
    if (s) out[ch] = s;
  }
  return out;
}
