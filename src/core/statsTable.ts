// Statistics table assembly and CSV serialisation (RFC 4180 quoting).
export interface StatsRow {
  group?: string;
  sample: string;
  annotations: string[];
  values: (number | string)[];
}

export function formatStat(v: number | string): string {
  if (typeof v === 'string') return v;
  if (Number.isNaN(v)) return 'NaN';
  return Number.isInteger(v) ? String(v) : v.toPrecision(6);
}

export const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function statsCsv(header: { group: boolean; annotations: string[]; columns: string[] }, rows: StatsRow[]): string {
  const head = [...(header.group ? ['Group'] : []), 'Sample', ...header.annotations, ...header.columns];
  const lines = rows.map((r) => [...(header.group ? [r.group ?? ''] : []), r.sample, ...r.annotations, ...r.values.map(formatStat)]);
  return [head, ...lines].map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}
