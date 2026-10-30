import type { FcsChannel } from '../core/fcs';
import { makeTransform, type Transform, type TransformSpec } from '../core/transforms';

export function isScatterOrTime(name: string) {
  return /^(FSC|SSC|Time)/i.test(name) || /^time$/i.test(name);
}

export function defaultTransform(c: FcsChannel, keywords: Record<string, string>): TransformSpec {
  const range = c.range > 0 ? c.range : 262144;
  if (/^time$/i.test(c.name)) {
    const ts = parseFloat(keywords['$TIMESTEP'] ?? '');
    return { kind: 'linear', T: range * (ts > 0 ? ts : 1), A: 0 };
  }
  if (isScatterOrTime(c.name)) return { kind: 'linear', T: range / (c.gain || 1), A: 0 };
  return { kind: 'logicle', T: range, W: 0.5, M: 4.5, A: 0 };
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
