// The workspace window's sample table beyond the default three columns
// (docs/validation/ui-gaps/workspace.md, section T): FlowJo 10.6.2 column keys
// (AppNodePropertyKey, SampleKeywordProxy), Edit Columns, sorting
// (SampleComparator), keyword value series (KeywordValueSeriesDialog) and the
// Export to Excel table (SampleTreeTable.buildTableData).
import type { SampleState, TableColumn, Workspace } from './model';
import { populationPath } from './model';
import { sampleValue } from './project';

export const NAME = 'fj.appnode.prop.name';
export const STATISTIC = 'fj.appnode.prop.statistic';
export const NCELLS = 'fj.appnode.prop.ncells';
// Node annotation (AppNodePropertyKey -> getAnnotation; fj.appnode.prop.anno).
export const ANNOTATION = 'fj.appnode.prop.anno';
export const DEFAULT_COLUMNS: TableColumn[] = [{ key: NAME }, { key: STATISTIC }, { key: NCELLS }];

// The special columns this app can fill, with FlowJo's header texts
// (ws.column.special.*); FlowJo lists more (gate coordinates, graph spec,
// transformation settings, sample state, quality), not offered here.
export const SPECIAL_COLUMNS: { key: string; label: string }[] = [
  { key: NAME, label: 'Name' },
  { key: STATISTIC, label: 'Statistic' },
  { key: NCELLS, label: '#Cells' },
  { key: 'fj.appnode.prop.filename', label: 'File Name' },
  { key: 'fj.appnode.prop.matrix', label: 'Compensation Matrix' },
  { key: 'fj.appnode.prop.group', label: 'Owner Group' },
  { key: 'fj.appnode.prop.gateparms', label: 'Gating Parameters' },
  { key: 'fj.appnode.prop.size', label: '$TOT' },
  { key: 'fj.appnode.prop.wellid', label: 'Well ID' },
  { key: 'fj.appnode.prop.collectiontime', label: 'Collection Time' },
  { key: ANNOTATION, label: 'Annotation' },
];

export const isKeywordColumn = (key: string) => key.startsWith('kw:');
export const keywordColumn = (keyword: string) => `kw:${keyword}`;
export const columnLabel = (key: string) => (isKeywordColumn(key) ? key.slice(3) : SPECIAL_COLUMNS.find((c) => c.key === key)?.label ?? key);
export const tableColumns = (ws: Pick<Workspace, 'tableColumns'>): TableColumn[] => ws.tableColumns?.length ? ws.tableColumns : DEFAULT_COLUMNS;

// FlowJo's keyword cells are editable except for the FCS structure keywords
// (SampleKeywordProxy.isEditable); here edits go to the sample's annotations.
const LOCKED = ['$BEGINDATA', '$ENDDATA', '$BEGINANALYSIS', '$ENDANALYSIS', '$BEGINSTEXT', '$ENDSTEXT', '$NEXTDATA', '$PAR', '$TOT', '$MODE', '$DATATYPE', '$BYTEORD'];
export const keywordEditable = (keyword: string) => !LOCKED.includes(keyword.toUpperCase()) && !/^\$P\d+[A-Z]$/i.test(keyword);

// A sample-level cell value (null = no value).
export function sampleCell(ws: Pick<Workspace, 'matrices' | 'groups'>, s: SampleState, key: string): string | null {
  if (isKeywordColumn(key)) return sampleValue(s, key.slice(3)) ?? null;
  switch (key) {
    case NAME: case 'fj.appnode.prop.filename': return s.fileName;
    case NCELLS: case 'fj.appnode.prop.size': return String(s.eventCount);
    case 'fj.appnode.prop.matrix': return s.compensation === 'none' ? null : s.compensation === 'file' ? 'Acquisition-defined' : ws.matrices.find((m) => m.id === s.compensation)?.name ?? s.compensation;
    case 'fj.appnode.prop.wellid': return sampleValue(s, 'WELL ID') ?? sampleValue(s, '$WELLID') ?? null;
    case 'fj.appnode.prop.collectiontime': return sampleValue(s, '$BTIM') ?? null;
    case ANNOTATION: return s.nodeAnnotation ?? null;
    default: return null;
  }
}

// A population-level cell value for the extra columns (Name, Statistic and
// #Cells are filled by the table itself).
export function populationCell(ws: Pick<Workspace, 'groups'>, s: SampleState, popId: string, key: string): string | null {
  const p = s.populations.find((q) => q.id === popId);
  if (!p) return null;
  if (key === ANNOTATION) return p.annotation ?? null;
  if (key === 'fj.appnode.prop.group') return p.owningGroup ? ws.groups.find((g) => g.id === p.owningGroup)?.name ?? null : null;
  if (key === 'fj.appnode.prop.gateparms') return p.gate.type === 'boolean' ? null : p.gate.dims.map((d) => (d.kind === 'channel' ? d.channel : `${d.num}/${d.den}`)).join(', ');
  return null;
}

// StringUtil.macStyleCompare: case-insensitive, digit runs compared as numbers.
export function naturalCompare(a: string, b: string): number {
  const ta = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const tb = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i], y = tb[i];
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const d = Number(x) - Number(y);
      if (d) return d < 0 ? -1 : 1;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return ta.length - tb.length;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// SampleComparator.parseDate: dd-MMM-yy, dd_MM_yyyy, dd-MMM-yyyy, dd MMM yyyy,
// yyyy-MM-dd, yyyy-MMM-dd (a leading 4-digit field means year first).
export function parseFcsDate(v: string): number | null {
  const parts = v.trim().split(/[-_ ]/);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (d.length === 4) [y, m, d] = [d, m, y];
  const mi = /^\d+$/.test(m) ? Number(m) - 1 : MONTHS.indexOf(m.slice(0, 3).toLowerCase());
  let yi = Number(y);
  if (!Number.isFinite(yi) || mi < 0 || mi > 11 || !/^\d+$/.test(d)) return null;
  if (y.length === 2) yi += yi < 50 ? 2000 : 1900;
  return Date.UTC(yi, mi, Number(d));
}

// SampleComparator.compare for one key: a missing value sorts first in both
// directions; $DATE compares as a date; otherwise the natural order.
export function compareSamples(ws: Pick<Workspace, 'matrices' | 'groups'>, a: SampleState, b: SampleState, key: string, ascending: boolean): number {
  const va = sampleCell(ws, a, key), vb = sampleCell(ws, b, key);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? -1 : 1;
  const sign = ascending ? 1 : -1;
  if (key === keywordColumn('$DATE')) {
    const da = parseFcsDate(va), db = parseFcsDate(vb);
    if (da !== null && db !== null) return Math.sign(da - db) * sign;
  }
  return naturalCompare(va, vb) * sign;
}

// Samples in table order: the sort keys in turn (FlowJo sorts by one column;
// up to three keys is this app's own Sort 1 / 2 / 3), ties keep group order.
export function sortSamples(ws: Pick<Workspace, 'matrices' | 'groups' | 'tableSort'>, samples: SampleState[]): SampleState[] {
  const keys = ws.tableSort ?? [];
  if (!keys.length) return samples;
  return samples.map((s, i) => [s, i] as const).sort(([a, i], [b, j]) => {
    for (const k of keys) { const c = compareSamples(ws, a, b, k.key, k.ascending); if (c) return c; }
    return i - j;
  }).map(([s]) => s);
}

// KeywordValueSeriesDialog.getValueSeries: n values (at least 2) from start;
// each value is used `repeat` times, the next value is (previous + increment)
// * multiplier, and after every `restartEvery` samples (when > 1) the series
// starts over from the starting value.
export function valueSeries(n: number, start: number, increment: number, multiplier: number, repeat: number, restartEvery: number): number[] {
  n = Math.max(2, Math.floor(n));
  repeat = Math.max(1, Math.floor(repeat));
  const out: number[] = [];
  let prev = start, cur = start;
  while (out.length < n) {
    for (let k = 0; k < repeat && out.length < n; k++) {
      out.push(cur);
      if (restartEvery > 1 && out.length % restartEvery === 0 && out.length < n) { cur = prev = start; break; }
      prev = cur;
    }
    if (restartEvery > 1 && out.length % restartEvery === 0) continue;
    cur = (prev + increment) * multiplier;
  }
  return out;
}

// ParseUtil.engineFormat as used for series values: whole numbers without a
// decimal point, others with up to 6 significant decimals.
export const formatSeriesValue = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10))));

// Keyword names FlowJo's Add Keyword changes ("Off", "Sample", "Panel" get "_"
// so they do not clash with the iteration choices).
export function keywordName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;
  return ['Off', 'Sample', 'Panel'].includes(name) ? `${name}_` : name;
}

// Sets one annotation keyword on the given samples (Copy value to group,
// Add Keyword to Group, value series). values: one per sample, or one for all.
export function setKeyword(samples: SampleState[], keyword: string, values: string[] | string, keepExisting = false): number {
  let n = 0;
  samples.forEach((s, i) => {
    const v = typeof values === 'string' ? values : values[i];
    if (v === undefined) return;
    if (keepExisting && s.annotations && keyword in s.annotations) return;
    s.annotations = { ...(s.annotations ?? {}), [keyword]: v };
    n++;
  });
  return n;
}

// Export to Excel (SampleTreeTable.writeExcel / buildTableData): a "Depth"
// column of ">" marks, then the visible columns; a statistic row's name is its
// label, a sample or population row's name is its path from the sample.
export interface TableRow { depth: number; sample: SampleState; popId: string | null; statLabel?: string; cells: string[] }
export function excelRows(columnLabels: string[], rows: TableRow[]): string[][] {
  return [['Depth', ...columnLabels], ...rows.map((r) => {
    const name = r.statLabel ?? (r.popId ? `${r.sample.fileName}/${populationPath(r.sample.populations, r.popId)}` : r.sample.fileName);
    return ['>'.repeat(r.depth), name, ...r.cells.slice(1)];
  })];
}
