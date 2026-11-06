import { isSpectral, type SpilloverMatrix } from '../core/compensation';
import type { DerivedParameter } from '../core/model';
import type { FcsChannel } from '../core/fcs';
import { makeTransform, type Transform, type TransformSpec } from '../core/transforms';

export function isScatterOrTime(name: string) {
  return /^(FSC|SSC|Time)/i.test(name) || /^time$/i.test(name);
}

// FlowJo 10: a parameter's range is 0..$PnR, 1024 when $PnR is missing (specs 6.7).
export const MISSING_RANGE = 1024;
export function channelRange(c: FcsChannel): number {
  return c.range > 0 ? c.range : MISSING_RANGE;
}

export function defaultTransform(c: FcsChannel, keywords: Record<string, string>): TransformSpec {
  const range = channelRange(c);
  if (/^time$/i.test(c.name)) {
    const ts = parseFloat(keywords['$TIMESTEP'] ?? '');
    return { kind: 'linear', T: range * (ts > 0 ? ts : 1), A: 0 };
  }
  if (isScatterOrTime(c.name)) return { kind: 'linear', T: range / (c.gain || 1), A: 0 };
  if (c.label === 'derived') return { kind: 'linear', T: range, A: 0 }; // ratio parameter
  return { kind: 'logicle', T: range, W: 0.5, M: 4.5, A: 0 };
}

// Top of scale of a spec (T, or max for FlowJo biex); null when it has none.
export function specTop(s: TransformSpec): number | null {
  if ('T' in s) return s.T;
  if (s.kind === 'flowjo-biex') return s.max;
  return null;
}

// Spec of another scale type for the scale dialog. The range is kept, as in
// FlowJo 10: the current top of scale, else the channel's 0..$PnR (specs 6.7).
export function specForKind(kind: string, from: TransformSpec, channelTop: number): TransformSpec {
  const T = specTop(from) ?? channelTop;
  switch (kind) {
    case 'linear': return { kind: 'linear', T, A: 0 };
    case 'log': return { kind: 'log', T, M: 4.5 };
    case 'asinh': return { kind: 'asinh', T, M: 4.5, A: 0 };
    case 'logicle': return { kind: 'logicle', T, W: 0.5, M: 4.5, A: 0 };
    case 'hyperlog': return { kind: 'hyperlog', T, W: 0.5, M: 4.5, A: 0 };
    case 'flowjo-biex': return { kind: 'flowjo-biex', max: T, width: -10, pos: 4.418539922, neg: 0, channelRange: 4096 };
    case 'flowjo-log': return { kind: 'flowjo-log', offset: 1, decades: 4.5 };
    default: throw new Error(`Unknown scale type ${kind}`);
  }
}

export function axisRange(t: Transform): [number, number] {
  if (Number.isFinite(t.displayMin) && Number.isFinite(t.displayMax)) return [t.displayMin, t.displayMax];
  return [0, 1];
}

export interface Tick {
  pos: number; // display units
  label: string;
  major: boolean;
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return `${Number((v / 1000).toPrecision(3))}K`;
  return Number(v.toPrecision(3)).toString();
}

export function ticks(t: Transform): Tick[] {
  const [d0, d1] = axisRange(t);
  const lo = t.inverse(d0);
  const hi = t.inverse(d1);
  const kind = t.spec.kind;
  const out: Tick[] = [];
  if (kind === 'linear' || kind === 'none') {
    const span = hi - lo;
    const step = 10 ** Math.floor(Math.log10(span / 5));
    const mult = span / step > 25 ? 5 : span / step > 10 ? 2 : 1;
    const s = step * mult;
    for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push({ pos: t.apply(v), label: fmt(v), major: true });
    return out;
  }
  // Log-like scales: decade ticks with minor ticks, including negatives.
  const maxE = Math.ceil(Math.log10(Math.max(Math.abs(hi), Math.abs(lo), 1)));
  out.push({ pos: t.apply(0), label: '0', major: true });
  for (let e = 0; e <= maxE; e++) {
    for (let m = 1; m < 10; m++) {
      for (const sgn of [1, -1]) {
        const v = sgn * m * 10 ** e;
        if (v < lo || v > hi) continue;
        const pos = t.apply(v);
        if (!Number.isFinite(pos)) continue;
        out.push({ pos, label: m === 1 && e >= 1 ? `${sgn < 0 ? '-' : ''}10^${e}` : '', major: m === 1 });
      }
    }
  }
  // Drop labels closer than 7% of the axis to an already kept label, keeping
  // 0 and positive decades first.
  const span = d1 - d0;
  const kept: number[] = [];
  const order = out.filter((x) => x.label).sort((a, b) => (a.label === '0' ? -1 : b.label === '0' ? 1 : b.pos - a.pos));
  for (const tk of order) {
    if (kept.some((k) => Math.abs(k - tk.pos) < span * 0.07)) tk.label = '';
    else kept.push(tk.pos);
  }
  return out.filter((x) => x.pos >= d0 - 1e-9 && x.pos <= d1 + 1e-9);
}

export const transformOf = (spec: TransformSpec) => makeTransform(spec);

// Axis for a channel of a loaded sample, using the workspace scale if set.
export function makeAxis(channels: FcsChannel[], keywords: Record<string, string>, channelTransforms: Record<string, TransformSpec>, ch: string) {
  const c = channels.find((x) => x.name === ch);
  if (!c) return null;
  const spec = channelTransforms[ch] ?? defaultTransform(c, keywords);
  const t = makeTransform(spec);
  return { channel: ch, spec, t, range: axisRange(t) };
}

// Channels a sample offers for plots and stats: its FCS parameters plus the
// unmixed fluorochromes of a spectral matrix assigned to it.
export function sampleChannels(meta: { channels: FcsChannel[] }, compensation: string, matrices: SpilloverMatrix[], derived: DerivedParameter[] = []): FcsChannel[] {
  const out = [...meta.channels];
  const m = matrices.find((x) => x.id === compensation);
  if (m && isSpectral(m) && m.outputNames) {
    const range = Math.max(...meta.channels.filter((c) => m.channels.includes(c.name)).map((c) => c.range), 1);
    out.push(...m.outputNames.map((name, i) => ({ index: meta.channels.length + i + 1, name, label: 'unmixed', bits: 32, range, logDecades: 0, logOffset: 0, gain: 1 })));
  }
  // Derived ratio parameters typically span ~0..a few; use a modest range.
  // FlowJo's default scale for a formula parameter is linear 0..1000; this
  // app's older ratio parameters keep 0..16.
  out.push(...derived.map((d, i) => ({ index: out.length + i + 1, name: d.name, label: 'derived', bits: 32, range: d.formula !== undefined ? 1000 : 16, logDecades: 0, logOffset: 0, gain: 1 })));
  return out;
}
