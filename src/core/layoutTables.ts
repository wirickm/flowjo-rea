// Layout table figures of FlowJo 10.6.2 (docs/validation/ui-gaps/layout.md
// section 7): the statistic table (FigStatTable, StatTableModel,
// StatTableSettingsPanel), the difference table (FigDifferenceTable,
// DifferenceTableModel, FigStatDifference) and the static table-editor table
// (FigTableDisplay, element TETable). Rules decoded with javap and written
// here independently; the plate display lives in layoutPlate.ts.
import type { StatColumn, StatKind } from './model';
import { STAT_LABELS } from './stats';
import { cellStyle, type CellStyle } from './tableEditor';
import type { PlateDisplayModel } from './layoutPlate';

// Annotation columns (lib.fjml.types.Annotation): the INSERT_ITEMS of the
// settings panel's "Add Column" menu, in FlowJo's order.
export type AnnoColumn = 'POPNAME' | 'INDENTEDPOPNAME' | 'POPNAMEWITHPATH' | 'SAMPLENAME' | 'WSANNO' | 'COMPMATNAME' | 'FULLGATEPATH';
export const ANNO_LABELS: Record<AnnoColumn, string> = {
  POPNAME: 'Subset Name',
  INDENTEDPOPNAME: 'Subset Name indented',
  POPNAMEWITHPATH: 'Subset Name with Gating Path',
  SAMPLENAME: 'Sample Name',
  WSANNO: 'Workspace Annotation',
  COMPMATNAME: 'Compensation Matrix',
  FULLGATEPATH: 'Full Gating Path',
};
export type TableStat = Omit<StatColumn, 'id' | 'populationPath'>;
// A column: an annotation, a statistic of the row's population (with an
// optional expected range, LECommand.EXPECTED_RANGE), or an FCS keyword.
export type StatTableColumn =
  | { type: 'anno'; anno: AnnoColumn }
  | { type: 'stat'; stat: TableStat; range?: { min: number; max: number } }
  | { type: 'keyword'; name: string };
// A row (NodeReference): a population (path '' = the sample) of a sample;
// control rows keep their sample when the table iterates (StatTableModel.bind).
export interface TableRowRef { sampleId: string; path: string; control?: boolean }

export type LayoutObjectSpec =
  | { kind: 'stattable'; rows: TableRowRef[]; columns: StatTableColumn[]; showHeader: boolean; iterate?: boolean }
  | { kind: 'difftable'; rows: TableRowRef[]; columns: StatTableColumn[]; controlSampleId?: string; iterate?: boolean }
  | { kind: 'tetable'; name: string; header: string[]; rows: { cells: string[]; styles?: (CellStyle | null)[] }[] }
  | { kind: 'plate'; model: PlateDisplayModel }
  | { kind: 'web'; url: string; zoom: number; offsetX: number; offsetY: number };

// The "Add Column" items (StatTableSettingsPanel.INSERT_ITEMS): the seven
// annotations, then Count, Freq. of Total and Freq. of Parent.
export const INSERT_ITEMS: StatTableColumn[] = [
  ...(['POPNAME', 'INDENTEDPOPNAME', 'POPNAMEWITHPATH', 'SAMPLENAME', 'WSANNO', 'COMPMATNAME', 'FULLGATEPATH'] as AnnoColumn[]).map((a) => ({ type: 'anno' as const, anno: a })),
  ...(['count', 'freqTotal', 'freqParent'] as StatKind[]).map((s) => ({ type: 'stat' as const, stat: { stat: s } })),
];
// A new statistic table: no rows, columns Subset Name with Gating Path and
// Count (StatTableModel.getDefaultColumns), header shown, iteration off.
export const newStatTable = (): LayoutObjectSpec => ({ kind: 'stattable', rows: [], columns: [{ type: 'anno', anno: 'POPNAMEWITHPATH' }, { type: 'stat', stat: { stat: 'count' } }], showHeader: true });
export const newDiffTable = (): LayoutObjectSpec => ({ kind: 'difftable', rows: [], columns: [{ type: 'anno', anno: 'POPNAMEWITHPATH' }, { type: 'stat', stat: { stat: 'count' } }] });
// Legend columns of a chart (LegendModel.DEFAULT_COLS).
export const LEGEND_DEFAULT_COLUMNS: StatTableColumn[] = [{ type: 'anno', anno: 'SAMPLENAME' }, { type: 'anno', anno: 'POPNAME' }, { type: 'stat', stat: { stat: 'count' } }];

const statName = (s: TableStat) => `${s.stat === 'freqOf' ? `Freq. of ${s.ancestor ?? ''}` : STAT_LABELS[s.stat]}${s.stat === 'percentile' ? ` ${s.percentile ?? ''}` : ''}${s.channel ? ` (${s.channel})` : ''}`;
// Column header text (TextPresentable.getPresentationString).
export function columnLabel(c: StatTableColumn): string {
  return c.type === 'anno' ? ANNO_LABELS[c.anno] : c.type === 'keyword' ? c.name : statName(c.stat);
}
// Difference table column index labels (FigDifferenceTable.getColumnIndexLabel):
// a statistic is "Δ " plus its name; others their name; drawn diagonally.
export const diffColumnLabel = (c: StatTableColumn) => (c.type === 'stat' ? `Δ ${columnLabel(c)}` : columnLabel(c));

export interface RowContext { sampleName: string; path: string; keyword: (k: string) => string | undefined; compensation: string; wsAnnotation: string }
// Annotation cell text for a row.
export function annoText(a: AnnoColumn, r: RowContext): string {
  const parts = r.path ? r.path.split('/') : [];
  const last = parts[parts.length - 1] ?? r.sampleName;
  switch (a) {
    case 'POPNAME': return last;
    case 'INDENTEDPOPNAME': return `${'    '.repeat(parts.length)}${last}`;
    case 'POPNAMEWITHPATH': return parts.length ? parts.join('/') : r.sampleName;
    case 'SAMPLENAME': return r.sampleName;
    case 'WSANNO': return r.wsAnnotation;
    case 'COMPMATNAME': return r.compensation;
    case 'FULLGATEPATH': return [r.sampleName, ...parts].join('/');
  }
}
// The StatColumn the analysis worker evaluates for a statistic cell.
export const statColumnFor = (s: TableStat, path: string, id: string): StatColumn => ({ ...s, id, populationPath: path });
// Statistic text (FJNumberFormatter, own precision: 6 significant digits).
export function formatValue(v: number | string | undefined): string {
  if (v === undefined) return '-';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return 'NaN';
  return Number.isInteger(v) ? String(v) : String(+v.toPrecision(6));
}
// StatTableModel.EMPTY_CELL_STR; header fill #DDDDDD to #EEEEEE (vertical).
export const EMPTY_CELL = '-';
export const HEADER_FILL = '#DDDDDD', HEADER_GRADIENT = '#EEEEEE';

// The rows a table shows for an iteration sample (StatTableModel.bind): with
// iteration enabled and an iteration sample, every non-control row moves to
// that sample, keeping its population path; control rows stay.
export function boundRows(rows: TableRowRef[], iterate: boolean | undefined, iterSampleId: string | undefined): TableRowRef[] {
  if (!iterate || !iterSampleId) return rows;
  return rows.map((r) => (r.control ? r : { ...r, sampleId: iterSampleId }));
}

// Expected-range style of a statistic cell (heat-mapping range of a column).
export const rangeStyle = (c: StatTableColumn, v: number | string | undefined): CellStyle => (c.type === 'stat' && c.range && v !== undefined ? cellStyle({ expectedRange: c.range }, v, [v]) : {});

// FigStatDifference.getHeatmapColor(d, -1, 1): d > 0 yellow with alpha
// 1 - (1 - pin(d, 0, 1))^2; d < 0 blue with alpha 1 - (1 - pin(d / -1, 0, 1))^2;
// 0 transparent. d is the difference of the two values in channel units of the
// statistic's parameter divided by the channel range, i.e. the difference of
// their display positions (0..1). Statistics without a parameter get no colour.
export function diffColor(d: number): string | null {
  if (!Number.isFinite(d)) return null;
  if (d > 0) { const u = Math.min(1, Math.max(0, d)); return `rgba(255,255,0,${+(1 - (1 - u) ** 2).toFixed(4)})`; }
  if (d < 0) { const u = Math.min(1, Math.max(0, d / -1)); return `rgba(0,0,255,${+(1 - (1 - u) ** 2).toFixed(4)})`; }
  return 'rgba(0,0,255,0)';
}
// Difference cell text (FigStatDifference.reparse): row value minus the same
// population's value in the control sample; error texts when parts are missing.
export function diffText(row: number | string | undefined, control: number | string | undefined, has: { control: boolean; population: boolean; controlSample: boolean }): string {
  if (!has.controlSample) return '<No control sample>';
  if (!has.population) return '<No population>';
  if (!has.control) return '<No control>';
  if (typeof row !== 'number' || typeof control !== 'number') return EMPTY_CELL;
  return formatValue(row - control);
}

// Static table from the table editor (FigTableDisplay.install): a header row
// of the column names, then the rows with their format colours.
export const TETABLE_NOTE = 'Calculated tables added to the layout are not live and will not update.';
export function teTableSpec(name: string, header: string[], rows: { sample: string; cells: (number | string)[] }[], styles?: (CellStyle | null)[][]): LayoutObjectSpec {
  return { kind: 'tetable', name, header: ['Sample', ...header], rows: rows.map((r, i) => ({ cells: [r.sample, ...r.cells.map((v) => formatValue(v))], ...(styles?.[i] ? { styles: [null, ...styles[i]] } : {}) })) };
}

// Table size in points: rows of 16 pt (12 pt text with 1 pt / 4 pt padding),
// columns sized to their longest text at ~6 pt per character, at least 40 pt.
export function tableGeometry(cells: string[][]): { colW: number[]; rowH: number; w: number; h: number } {
  const n = Math.max(0, ...cells.map((r) => r.length));
  const colW = Array.from({ length: n }, (_, k) => Math.max(40, 8 + 6 * Math.max(...cells.map((r) => (r[k] ?? '').length))));
  const rowH = 16;
  return { colW, rowH, w: colW.reduce((a, b) => a + b, 0), h: rowH * cells.length };
}
