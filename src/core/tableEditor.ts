// FlowJo 10.6.2 table editor and layout iteration (specs section 17):
// TableTemplate columns (statistic, keyword, formula), iteration by sample /
// keyword / panel (SIteration), outputs CSV / TAB / HTML (createTableAsCSV and
// friends), summary rows, heat map and SD highlighting, and batch tiling of a
// layout (BatchSettings). Read with javap / headless Ghidra; implemented
// independently. This module is the one owner of these rules.
import { compileFormula } from './formula';

// A statistic column names its statistic itself (stat: population path,
// statistic, parameter, ancestor; ColumnSpec in FlowJo); older tables point
// at a Statistics-panel column instead (statColumnId).
export type StatSpec = Omit<import('./model').StatColumn, 'id'>;
export type TableColumn =
  | { kind: 'statistic'; header: string; statColumnId?: string; stat?: StatSpec; format?: ColumnFormat }
  | { kind: 'keyword'; header: string; keyword: string; format?: ColumnFormat }
  | { kind: 'formula'; header: string; formula: string; format?: ColumnFormat };
// Formatting (TEFormattingBand: one of Heat Map, Standard Deviation, Expected
// Range). expectedRange is entered on the column (own rule: FlowJo picks a
// range by name from its preferences).
export interface ColumnFormat { heatMap?: boolean; stdDev?: boolean; expectedRange?: { min: number; max: number }; bold?: boolean }
export type TableDestination = 'DISPLAY' | 'CLIPBOARD' | 'FILE' | 'LAYOUT' | 'PRINT';
export type OutputFormat = 'CSV' | 'TAB' | 'HTML' | 'XML_EXCEL';
export type IterationType = 'SAMPLE' | 'KEYWORD' | 'PANEL';
export interface Iteration { type: IterationType; keyword?: string; panelSize?: number }
export interface TableTemplate {
  id: string; name: string; columns: TableColumn[]; iteration: Iteration; summary?: boolean;
  destination?: TableDestination; outputFormat?: OutputFormat; // defaults DISPLAY, CSV
  header?: string; footer?: string; // Edit Header / Footer: print outs only
  autoColumnName?: string; // Create Column Names template
}
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
      if (c.kind === 'statistic') cells[k] = r.stats[statKey(c, k)] ?? NaN;
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
// Where a statistic cell's value is found in RowSource.stats.
export const statKey = (c: TableColumn, k: number) => (c.kind === 'statistic' && !c.stat && c.statColumnId ? c.statColumnId : `#${k}`);
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
type Rows = { sample: string; cells: (number | string)[] }[];
// HTML (createTableAsHTML): title and h1 the table name, grey header row with
// white text, one header line per header line, right-aligned value cells in
// the cell's format colours (bold / italic from Standard Deviation). Summary
// rows are not formatted. bodyOnly: what Copy Table puts on the clipboard
// (the part between <body> and </body>).
export function tableHtml(t: TableTemplate, rows: Rows, opts: { bodyOnly?: boolean; data?: number } = {}): string {
  const n = opts.data ?? rows.length;
  const th = t.columns.map((c) => `<th align="center" valign="bottom" bgcolor='#808080'><font color='#FFFFFF' >${hesc(headerText(c.header)).replace(/\n/g, '<br>')}</font></th>`).join('');
  const body = rows.map((r, i) => `<tr><td bgcolor="#FFFFFF"><font color="#000000" >${hesc(r.sample)}</font></td>${r.cells.map((v, k) => {
    const st = i < n ? cellStyle(t.columns[k]?.format, v, rows.slice(0, n).map((x) => x.cells[k])) : {};
    let txt = hesc(fmt(v));
    if (st.italic) txt = `<i>${txt}</i>`;
    if (st.bold) txt = `<b>${txt}</b>`;
    return `<td align="right" bgcolor="${st.background ?? '#FFFFFF'}"><font color="${st.color ?? '#000000'}">${txt}</font></td>`;
  }).join('')}</tr>`).join('\n');
  const inner = `<h1>${hesc(t.name)}</h1>\n<div bgcolor="#000000"><table width='100%' cellspacing='1' cellpadding='4'  border = '1' >\n<tr><td bgcolor="#808080"></td>${th}</tr>\n${body}\n</table></div>`;
  return opts.bodyOnly ? inner : `<html>\n<head><title>${hesc(t.name)}</title></head>\n<body>\n${inner}</body></html>\n`;
}
// XML Excel (createTableAsExcelXML): a SpreadsheetML 2003 workbook (opens in
// Excel, no binary writer needed); one worksheet named after the table, a
// "Sample" header cell, numbers typed Number and everything else String.
const xesc = (s: string) => hesc(s).replace(/"/g, '&quot;');
export function tableExcelXml(t: TableTemplate, rows: Rows): string {
  const cell = (v: number | string) => (typeof v === 'number' && Number.isFinite(v) ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${xesc(fmt(v))}</Data></Cell>`);
  const head = `<Row>${['Sample', ...t.columns.map((c) => headerText(c.header).replace(/[\r\n]+/g, ' '))].map((h) => cell(h)).join('')}</Row>`;
  const body = rows.map((r) => `<Row>${cell(r.sample)}${r.cells.map(cell).join('')}</Row>`).join('\n');
  return `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">\n<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"/>\n<ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel"><ProtectStructure>False</ProtectStructure><ProtectWindows>False</ProtectWindows></ExcelWorkbook>\n<Styles/>\n<Worksheet ss:Name="${xesc(t.name.slice(0, 31))}"><Table>\n${head}\n${body}\n</Table></Worksheet>\n</Workbook>\n`;
}
// One output (createTableByFileType): text, file extension and media type.
export const OUTPUT_FORMATS: Record<OutputFormat, { label: string; ext: string; type: string }> = {
  CSV: { label: 'CSV (comma separated)', ext: 'csv', type: 'text/csv' },
  TAB: { label: 'TXT (tab delimited)', ext: 'txt', type: 'text/plain' },
  HTML: { label: 'HTML', ext: 'html', type: 'text/html' },
  XML_EXCEL: { label: 'XML Excel (SpreadsheetML)', ext: 'xml', type: 'application/vnd.ms-excel' },
};
export function tableOutput(t: TableTemplate, rows: Rows, f: OutputFormat, data?: number): string {
  return f === 'CSV' ? tableCsv(t, rows) : f === 'TAB' ? tableTab(t, rows) : f === 'HTML' ? tableHtml(t, rows, { data }) : tableExcelXml(t, rows);
}

// Cell formats (ColumnSpec.getFontOptions, CalculatedTable.getHeatMapColoring):
// - Heat Map: u = clamp((max - v) / (max - min), 0, 1), blue = int(255 u),
//   red = green = 255 - blue (column maximum yellow, minimum blue); white
//   text when blue > 128 and red < 128, else black.
// - Standard Deviation: z = |v - mean| / SD (sample SD over the column):
//   red text when z > 2, bold when z > 1, italic when z > 0.5; white cell.
// - Expected Range: below min a cyan cell and a down arrow, above max a
//   yellow cell and an up arrow.
export interface CellStyle { background?: string; color?: string; bold?: boolean; italic?: boolean; arrow?: 'up' | 'down' }
export function cellStyle(f: ColumnFormat | undefined, v: number | string, column: (number | string)[]): CellStyle {
  const x = Number(v);
  const nums = column.map(Number).filter((y) => Number.isFinite(y));
  if (!f || v === '' || !Number.isFinite(x) || !nums.length) return { bold: f?.bold };
  const lo = Math.min(...nums), hi = Math.max(...nums);
  if (f.heatMap) {
    const u = hi > lo ? Math.min(1, Math.max(0, (hi - x) / (hi - lo))) : 0;
    const b = Math.trunc(255 * u), r = 255 - b;
    return { background: `rgb(${r},${r},${b})`, color: b > 128 && r < 128 ? '#FFFFFF' : '#000000', bold: f.bold };
  }
  if (f.expectedRange) {
    const { min, max } = f.expectedRange;
    if (x < min) return { background: '#00FFFF', color: '#000000', arrow: 'down', bold: f.bold };
    if (x > max) return { background: '#FFFF00', color: '#000000', arrow: 'up', bold: f.bold };
    return { bold: f.bold };
  }
  if (f.stdDev) {
    const m = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, nums.length - 1));
    const z = sd > 0 ? Math.abs(x - m) / sd : 0;
    return { background: '#FFFFFF', color: z > 2 ? '#FF0000' : '#000000', bold: z > 1 || !!f.bold, italic: z > 0.5 };
  }
  return { bold: f.bold };
}

// Create Column Names (ColumnNamingDialog, ColumnSpecUtil): a template with
// the tokens below renames every statistic column (keyword and formula
// columns keep their names); an empty template restores the automatic names.
export const NAME_TOKENS = ['Last Population Name', 'Complete Gating Path', 'Statistic', 'Parameter Name', 'Parameter Stain'] as const;
export function headerFromTemplate(template: string, s: StatSpec, statLabel: string, stain?: string): string {
  const path = s.populationPath || '';
  const last = path.split('/').filter(Boolean).pop() ?? '';
  const stat = s.stat === 'freqOf' && s.ancestor ? `${statLabel} ${s.ancestor}` : s.stat === 'percentile' ? `${s.percentile} ${statLabel}` : statLabel;
  const val: Record<string, string> = { 'Last Population Name': last, 'Complete Gating Path': path, Statistic: stat, 'Parameter Name': s.channel ?? '', 'Parameter Stain': stain || s.channel || '' };
  let out = template;
  for (const k of NAME_TOKENS) out = out.split(`'${k}'`).join(val[k]);
  return out;
}

// Duplicate (SExplorer.doDuplicateTemplate): a copy of the selected table,
// named uniquely from its name (NameUtil.uniqueName).
export function duplicateTable(t: TableTemplate, id: string, name: string): TableTemplate {
  return { ...structuredClone(t), id, name };
}

// Find (FJTableAction.showFindDialog): the trimmed text, case sensitive,
// selects every row with a cell (sample name included) that contains it;
// empty text does nothing.
export function findRows(rows: Rows, text: string): number[] | null {
  const q = text.trim();
  if (!q) return null;
  return rows.flatMap((r, i) => ([r.sample, ...r.cells.map(fmt)].some((c) => c.includes(q)) ? [i] : []));
}

// Table plots. Box-n-Whisker (FJBoxAndWhiskerFrame, JFreeChart
// BoxAndWhiskerCalculator): median, mean, Q1 / Q3 as the medians of the lower
// and upper halves (an odd count includes the median in both), whiskers at
// the most extreme values within 1.5 IQR of the box, values beyond are
// outliers (beyond 2 IQR far outliers).
const medianOf = (a: number[], i: number, j: number) => { const n = j - i + 1; const m = i + Math.floor(n / 2); return n % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export interface BoxStats { n: number; mean: number; median: number; q1: number; q3: number; lo: number; hi: number; outliers: number[]; farOut: number[] }
export function boxStats(values: number[]): BoxStats | null {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  const median = medianOf(a, 0, n - 1);
  const q1 = n === 1 ? a[0] : medianOf(a, 0, n % 2 ? Math.floor(n / 2) : n / 2 - 1);
  const q3 = n === 1 ? a[0] : medianOf(a, Math.floor(n / 2), n - 1);
  const iqr = q3 - q1;
  const inside = a.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return {
    n, mean: a.reduce((x, y) => x + y, 0) / n, median, q1, q3,
    lo: inside.length ? inside[0] : q1, hi: inside.length ? inside[inside.length - 1] : q3,
    outliers: a.filter((v) => (v < q1 - 1.5 * iqr && v >= q1 - 2 * iqr) || (v > q3 + 1.5 * iqr && v <= q3 + 2 * iqr)),
    farOut: a.filter((v) => v < q1 - 2 * iqr || v > q3 + 2 * iqr),
  };
}
// Correlation (ScatterPlotController with a regression): least-squares line
// of y on x and Pearson R ("R:", "Slope:", "Intercept:").
export function regression(xs: number[], ys: number[]): { n: number; r: number; slope: number; intercept: number } {
  const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = p.length;
  const mx = p.reduce((a, [x]) => a + x, 0) / n, my = p.reduce((a, [, y]) => a + y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of p) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const slope = sxy / sxx;
  return { n, r: sxy / Math.sqrt(sxx * syy), slope, intercept: my - slope * mx };
}
// TEPlotAction.plot: a selected column whose values do not vary (SD under
// 1e-4) cannot be plotted.
export const PLOT_SAME_VALUE = "Can't plot variables that are all the same value.";
export function plotBlocked(columns: number[][]): boolean {
  return columns.some((c) => { const a = c.filter(Number.isFinite); if (a.length < 2) return true; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) < 1e-4; });
}
// Acquisition time of a sample for Time Series ($DATE and $BTIM), in ms;
// null when the keywords are missing or unreadable.
export function acquisitionTime(kw: Record<string, string>): number | null {
  const d = kw['$DATE'], t = kw['$BTIM'];
  if (!d) return null;
  const ms = Date.parse(`${d.replace(/-/g, ' ')} ${(t ?? '00:00:00').slice(0, 8)}`);
  return Number.isFinite(ms) ? ms : null;
}

// A static text copy of a table for the layout (Add to Layout: FlowJo warns
// "Calculated tables added to the layout are not live and will not update.").
export function tableText(t: TableTemplate, rows: Rows): string {
  const head = ['', ...t.columns.map((c) => headerText(c.header).replace(/[\r\n]+/g, ' '))];
  const body = rows.map((r) => [r.sample, ...r.cells.map((v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toPrecision(6)) : 'NaN') : v))]);
  return [t.name, ...[head, ...body].map((r) => r.join(' | '))].join('\n');
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
