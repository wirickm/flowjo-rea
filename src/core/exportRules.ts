// FlowJo 10.6.2 event export rules (specs section 9): event cap,
// concatenation grouping and order, CSV values, channels and header. Read
// with REA's Ghidra provider (Exporter, FCS3Exporter, ExportRequest) and
// headless Ghidra / javap (PopulationExporter2, ExportModel); implemented
// independently. This module is the one owner of these rules.
import { logicleTable, tableIndex } from './gateGrid';
import { makeTransform, type TransformSpec } from './transforms';

// "No more than N" (Exporter::WriteSample): not random. step =
// trunc(count / N) in single precision (1 when count = N); events are taken
// every step-th, in file order, until N are written. For a whole sample the
// taken positions are 0, step, 2 step, ...; for a gated population they are
// the step-th, 2 step-th, ... event of the population (1-based). N < 0 or
// N >= count takes every event.
export function capPositions(count: number, cap: number | undefined, gated: boolean): number[] {
  const all = () => Array.from({ length: count }, (_, i) => i);
  if (cap === undefined || cap < 0 || cap >= count) return all();
  if (cap === 0) return [];
  const step = count === cap ? 1 : Math.trunc(Math.fround(count) / Math.fround(cap));
  const out: number[] = [];
  if (!gated) {
    for (let i = 0; i < count && out.length < cap; i += step) out.push(i);
  } else {
    for (let k = 1; k <= count && out.length < cap; k++) if (k % step === 0) out.push(k - 1);
  }
  return out;
}

// Events requested per population (PopulationExporter2.resolveNumEvents):
// all, or min(N, count).
export const resolveNumEvents = (count: number, cap: number | undefined) => (cap === undefined ? count : Math.min(cap, count));

// Concatenation: one output per group. "every N" splits the list in order
// into runs of N ("all" is one run); "equal keyword" groups by the
// keyword's value, groups ordered by value (Java string order) and samples
// without a value left out. Inside an output the populations are ordered by
// $ETIM (HH:mm:ss) ascending; a missing or unreadable time compares equal
// (stable order). The cap per population in a concatenated file is
// trunc(sum of min(N, count) / number of populations).
export type ConcatMode = { kind: 'all' } | { kind: 'everyN'; n: number } | { kind: 'equalKeyword'; keyword: string };
export function concatGroups<T>(items: T[], mode: ConcatMode, keywordOf: (t: T, k: string) => string | undefined): T[][] {
  if (mode.kind === 'all') return items.length ? [items] : [];
  if (mode.kind === 'everyN') {
    const n = Math.max(1, Math.floor(mode.n));
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
    return out;
  }
  const byValue = new Map<string, T[]>();
  for (const t of items) {
    const v = keywordOf(t, mode.keyword);
    if (v === undefined || v === '') continue;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(t);
  }
  return [...byValue.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => byValue.get(k)!);
}
const etimSeconds = (s: string | undefined): number | undefined => {
  const m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})/.exec((s ?? '').trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
};
export function orderByEndTime<T>(items: T[], etimOf: (t: T) => string | undefined): T[] {
  return [...items].sort((a, b) => {
    const x = etimSeconds(etimOf(a)), y = etimSeconds(etimOf(b));
    return x === undefined || y === undefined ? 0 : x - y;
  });
}
export const concatCap = (counts: number[], cap: number | undefined) =>
  cap === undefined ? undefined : Math.trunc(counts.reduce((s, c) => s + resolveNumEvents(c, cap), 0) / Math.max(1, counts.length));

// C printf "%g" (6 significant digits, trailing zeros removed, exponent form
// when the exponent is below -4 or at least 6, two-digit exponent).
export function printfG(v: number): string {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  if (v === 0) return Object.is(v, -0) ? '-0' : '0';
  const e = Math.floor(Math.log10(Math.abs(Number(v.toPrecision(6)))));
  const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (e < -4 || e >= 6) {
    const [mant, exp] = v.toExponential(5).split('e');
    const n = Number(exp);
    return `${trim(mant)}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  return trim(v.toFixed(Math.max(0, 5 - e)));
}

// One CSV value (Exporter::WriteRow): scale values print with %g, values
// within 1e-6 of zero as "0"; channel values print as integers.
export const csvScaleValue = (v: number) => (v > -1e-6 && v < 1e-6 ? '0' : printfG(v));

// FlowJo's default channel range for CSV channel values (ExportRequest
// "channelRange", not set by FlowJo's dialog).
export const CSV_CHANNEL_RANGE = 1024;
// Channel of a value on a parameter's scale with R channels: linear axes
// floor((v - min) R / (max - min) + 0.5); logicle axes the 4096-entry table
// index scaled to R and truncated; clamped to 0..R-1. Other scales use the
// display position truncated (FlowJo's mapping for them is not decoded).
export function channelValue(v: number, spec: TransformSpec, R = CSV_CHANNEL_RANGE): number {
  const t = makeTransform(spec);
  let c: number;
  if (spec.kind === 'logicle') c = Math.trunc((tableIndex(logicleTable(spec.T, spec.W, spec.M, spec.A), v) * R) / 4096);
  else if (spec.kind === 'linear') {
    const lo = t.inverse(t.displayMin), hi = t.inverse(t.displayMax);
    c = Math.floor(((Math.fround(v) - lo) * R) / (hi - lo) + 0.5);
  }
  else c = Math.floor(((t.apply(v) - t.displayMin) * R) / (t.displayMax - t.displayMin));
  return c < 0 ? 0 : c > R - 1 ? R - 1 : c;
}

// CSV header (Exporter::WriteParamHeaderRow): parameter name ("p"), stain
// ("s") or both ("ps", joined with " :: "); a missing stain falls back to the
// name. Columns are separated by "," and lines end with "\n".
export type HeaderFormat = 'p' | 's' | 'ps';
export function headerName(name: string, stain: string | undefined, f: HeaderFormat): string {
  const st = (stain ?? '').trim();
  if (f === 'p' || !st) return name;
  return f === 's' ? st : `${name} :: ${st}`;
}

// Name of the concatenation sample-ID parameter; values are the 1-based
// position of each population in the file (Exporter::GetSampleIDParameter).
export const SAMPLE_ID_PARAMETER = 'SampleID';
