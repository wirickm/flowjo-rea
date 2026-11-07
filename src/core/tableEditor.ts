// FlowJo 10.6.2 table editor and layout iteration (specs section 17):
// TableTemplate columns (statistic, keyword, formula), iteration by sample /
// keyword / panel (SIteration), outputs CSV / TAB / HTML (createTableAsCSV and
// friends), summary rows, heat map and SD highlighting, and batch tiling of a
// layout (BatchSettings). Read with javap / headless Ghidra; implemented
// independently. This module is the one owner of these rules.
import { compileFormula } from './formula';

export type TableColumn =
  | { kind: 'statistic'; header: string; statColumnId: string; format?: ColumnFormat }
  | { kind: 'keyword'; header: string; keyword: string; format?: ColumnFormat }
  | { kind: 'formula'; header: string; formula: string; format?: ColumnFormat };
export interface ColumnFormat { heatMap?: boolean; sdHighlight?: number; bold?: boolean }
export type IterationType = 'SAMPLE' | 'KEYWORD' | 'PANEL';
export interface Iteration { type: IterationType; keyword?: string; panelSize?: number }
export interface TableTemplate { id: string; name: string; columns: TableColumn[]; iteration: Iteration; summary?: boolean }
export interface RowSource { sample: string; keywords: Record<string, string>; stats: Record<string, number | string> }

// Iteration groups (SIteration): one per sample, per keyword value (in first-
// seen order, samples without the keyword left out) or per block of
// panelSize consecutive tubes.
export function iterate<T>(items: T[], it: Iteration, keywordOf: (t: T, k: string) => string | undefined): { label: string; items: T[] }[] {
  if (it.type === 'KEYWORD' && it.keyword) {
    const m = new Map<string, T[]>();
    for (const t of items) { const v = keywordOf(t, it.keyword); if (v === undefined || v === '') continue; (m.get(v) ?? m.set(v, []).get(v)!).push(t); }
    return [...m.entries()].map(([label, xs]) => ({ label, items: xs }));
  }
  if (it.type === 'PANEL') {
    const n = Math.max(1, Math.floor(it.panelSize ?? 1));
    const out: { label: string; items: T[] }[] = [];
    for (let i = 0; i < items.length; i += n) out.push({ label: `Panel ${out.length + 1}`, items: items.slice(i, i + n) });
    return out;
  }
  return items.map((t, i) => ({ label: String(i + 1), items: [t] }));
}

// Cell values: statistics from the table rows, keywords from the FCS file,
// formulas over the other columns of the same row (FJML, as derived
// parameters; a column is referenced by its header).
export function tableRows(t: TableTemplate, rows: RowSource[]): { sample: string; cells: (number | string)[] }[] {
  return rows.map((r) => {
    const cells: (number | string)[] = [];
    t.columns.forEach((c, k) => {
      if (c.kind === 'statistic') cells[k] = r.stats[c.statColumnId] ?? NaN;
      else if (c.kind === 'keyword') cells[k] = r.keywords[c.keyword.toUpperCase()] ?? r.keywords[c.keyword] ?? '';
    });
    t.columns.forEach((c, k) => {
      if (c.kind !== 'formula') return;
      try {
        const headers = t.columns.map((x) => x.header);
        const f = compileFormula(c.formula, headers);
        cells[k] = f.evaluate(Float64Array.from(f.variables, (h) => { const v = h === null ? NaN : Number(cells[headers.indexOf(h)]); return v; }));
      } catch (e) {
        cells[k] = `error: ${(e as Error).message}`;
      }
    });
    return { sample: r.sample, cells };
  });
}
// Header text: " (%)" is appended to a header containing "Freq." (FlowJo).
export const headerText = (h: string) => (h.includes('Freq.') && !h.includes('(%)') ? `${h} (%)` : h);
// "Show Summary Stats": Mean and Std. Deviation rows over the numeric cells.
export function summaryRows(rows: { cells: (number | string)[] }[], ncol: number): { sample: string; cells: (number | string)[] }[] {
  const col = (k: number) => rows.map((r) => Number(r.cells[k])).filter((v) => Number.isFinite(v));
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const sd = (a: number[]) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : NaN; };
  return [{ sample: 'Mean', cells: Array.from({ length: ncol }, (_, k) => mean(col(k))) }, { sample: 'Std. Deviation', cells: Array.from({ length: ncol }, (_, k) => sd(col(k))) }];
}
// CSV (createTableAsCSV): header cells with "," quoted, line breaks replaced;
// values with '"' doubled and "," quoted; TAB: tab separated, first header
// "Sample:".
const csvCell = (v: string) => (v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v.includes(',') ? `"${v}"` : v);
const fmt = (v: number | string) => (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NaN') : v);
export function tableCsv(t: TableTemplate, rows: { sample: string; cells: (number | string)[] }[]): string {
  const head = ['', ...t.columns.map((c) => headerText(c.header).replace(/[\r\n]+/g, ' '))].map(csvCell).join(',');
  return [head, ...rows.map((r) => [r.sample, ...r.cells.map(fmt)].map(csvCell).join(','))].join('\n') + '\n';
}
export function tableTab(t: TableTemplate, rows: { sample: string; cells: (number | string)[] }[]): string {
  const head = ['Sample:', ...t.columns.map((c) => headerText(c.header))].join('\t');
  return [head, ...rows.map((r) => [r.sample, ...r.cells.map(fmt)].join('\t'))].join('\n') + '\n';
}
const hesc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function tableHtml(t: TableTemplate, rows: { sample: string; cells: (number | string)[] }[]): string {
  const th = ['', ...t.columns.map((c) => headerText(c.header))].map((h) => `<th style="background:#ccc">${hesc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr><td>${hesc(r.sample)}</td>${r.cells.map((v, k) => {
    const style = cellStyle(t.columns[k]?.format, v, rows.map((x) => x.cells[k]));
    return `<td style="text-align:right;background:${style.background ?? '#fff'}${style.bold ? ';font-weight:bold' : ''}">${hesc(fmt(v))}</td>`;
  }).join('')}</tr>`).join('');
  return `<html><body><h3>${hesc(t.name)}</h3><table border="1">${`<tr>${th}</tr>`}${body}</table></body></html>\n`;
}
// Heat map: blue (column minimum) to yellow (maximum); SD highlight: values
// at least n SDs from the column mean.
export function cellStyle(f: ColumnFormat | undefined, v: number | string, column: (number | string)[]): { background?: string; bold?: boolean } {
  const x = Number(v);
  const nums = column.map(Number).filter((y) => Number.isFinite(y));
  if (!f || !Number.isFinite(x) || !nums.length) return { bold: f?.bold };
  const lo = Math.min(...nums), hi = Math.max(...nums);
  if (f.heatMap) {
    const u = hi > lo ? (x - lo) / (hi - lo) : 0;
    const r = Math.round(255 * u), g = Math.round(255 * u), b = Math.round(255 * (1 - u));
    return { background: `rgb(${r},${g},${b})`, bold: f.bold };
  }
  if (f.sdHighlight) {
    const m = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, nums.length - 1));
    if (sd > 0 && Math.abs(x - m) >= f.sdHighlight * sd) return { background: '#fdd', bold: f.bold };
  }
  return { bold: f.bold };
}

// Batch tiles (BatchSettings): each iteration renders the layout as one tile;
// tiles run Across (left to right) or Down in a fixed number of columns (or
// rows), "Separate Pages" puts each tile on its own page.
export interface BatchSettings { direction: 'COLUMNS' | 'ROWS'; length: number; order: 'ACROSS' | 'DOWN'; separatePages: boolean; perPage?: number }
export function tilePositions(count: number, b: BatchSettings): { page: number; row: number; col: number }[] {
  const L = Math.max(1, Math.floor(b.length));
  const per = b.separatePages ? 1 : b.perPage ?? Infinity;
  return Array.from({ length: count }, (_, i) => {
    const page = Math.floor(i / per), k = i % per;
    if (b.separatePages) return { page, row: 0, col: 0 };
    if (b.direction === 'COLUMNS') return b.order === 'ACROSS' ? { page, row: Math.floor(k / L), col: k % L } : { page, row: k % Math.ceil((Number.isFinite(per) ? per : count) / L), col: Math.floor(k / Math.ceil((Number.isFinite(per) ? per : count) / L)) };
    return b.order === 'DOWN' ? { page, row: k % L, col: Math.floor(k / L) } : { page, row: Math.floor(k / Math.ceil((Number.isFinite(per) ? per : count) / L)), col: k % Math.ceil((Number.isFinite(per) ? per : count) / L) };
  });
}
