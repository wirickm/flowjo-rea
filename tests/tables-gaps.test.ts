// FlowJo 10.6.2 table editor and generated table window gaps
// (docs/validation/ui-gaps/tables.md).
import { describe, expect, it } from 'vitest';
import { acquisitionTime, boxStats, cellStyle, duplicateTable, findRows, headerFromTemplate, plotBlocked, regression, statKey, tableExcelXml, tableHtml, tableOutput, tableRows, tableText, type TableTemplate } from '../src/core/tableEditor';

const t: TableTemplate = { id: 't', name: 'T', iteration: { type: 'SAMPLE' }, columns: [
  { kind: 'statistic', header: 'Median', stat: { populationPath: 'Lymph/CD3+', stat: 'median', channel: 'FL1-A' } },
  { kind: 'keyword', header: 'Tube', keyword: '$SRC' },
] };
const rows = tableRows(t, [{ sample: 'a.fcs', keywords: { $SRC: 'T1' }, stats: { '#0': 10 } }, { sample: 'b.fcs', keywords: { $SRC: 'T2<' }, stats: { '#0': 30 } }]);

describe('statistic columns carry their own statistic (ColumnSpec)', () => {
  it('values come from the column\'s own key; older columns from their Statistics-panel column', () => {
    expect(rows.map((r) => r.cells[0])).toEqual([10, 30]);
    expect(statKey({ kind: 'statistic', header: 'x', statColumnId: 'c1' }, 3)).toBe('c1');
    expect(statKey(t.columns[0], 0)).toBe('#0');
  });
});

describe('formatting (ColumnSpec.getFontOptions)', () => {
  it('heat map: truncated blue = 255 (max - v) / range; white text on dark blue', () => {
    expect(cellStyle({ heatMap: true }, 30, [10, 30])).toMatchObject({ background: 'rgb(255,255,0)', color: '#000000' });
    expect(cellStyle({ heatMap: true }, 10, [10, 30])).toMatchObject({ background: 'rgb(0,0,255)', color: '#FFFFFF' });
    expect(cellStyle({ heatMap: true }, 20, [10, 30]).background).toBe('rgb(128,128,127)');
  });
  it('standard deviation: italic > 0.5 SD, bold > 1 SD, red > 2 SD', () => {
    const col = [0, 0, 0, 0, 0, 0, 0, 0, 0, 10];
    expect(cellStyle({ stdDev: true }, 10, col)).toMatchObject({ color: '#FF0000', bold: true, italic: true });
    expect(cellStyle({ stdDev: true }, 0, col)).toMatchObject({ color: '#000000', bold: false, italic: false });
  });
  it('expected range: cyan / down arrow below, yellow / up arrow above', () => {
    expect(cellStyle({ expectedRange: { min: 5, max: 20 } }, 2, [2, 30])).toMatchObject({ background: '#00FFFF', arrow: 'down' });
    expect(cellStyle({ expectedRange: { min: 5, max: 20 } }, 30, [2, 30])).toMatchObject({ background: '#FFFF00', arrow: 'up' });
    expect(cellStyle({ expectedRange: { min: 5, max: 20 } }, 10, [2, 30]).arrow).toBeUndefined();
  });
});

describe('Create Column Names (ColumnSpecUtil.getHeaderStrForColumn)', () => {
  it('replaces the quoted tokens', () => {
    const s = { populationPath: 'Lymph/CD3+', stat: 'median' as const, channel: 'FL1-A' };
    expect(headerFromTemplate("'Last Population Name' 'Statistic' 'Parameter Stain'", s, 'Median', 'CD4')).toBe('CD3+ Median CD4');
    expect(headerFromTemplate("'Complete Gating Path': 'Parameter Name'", s, 'Median')).toBe('Lymph/CD3+: FL1-A');
    expect(headerFromTemplate("'Statistic'", { populationPath: 'A/B', stat: 'percentile', percentile: 90, channel: 'X' }, 'Percentile')).toBe('90 Percentile');
    expect(headerFromTemplate("'Statistic'", { populationPath: 'A/B', stat: 'freqOf', ancestor: 'A' }, 'Freq. of')).toBe('Freq. of A');
  });
});

describe('table window commands', () => {
  it('Find: case-sensitive contains over every cell, empty text does nothing', () => {
    expect(findRows(rows, 'T2')).toEqual([1]);
    expect(findRows(rows, ' a.f ')).toEqual([0]);
    expect(findRows(rows, 't2')).toEqual([]);
    expect(findRows(rows, '  ')).toBeNull();
  });
  it('Duplicate keeps the columns under a new id and name', () => {
    const d = duplicateTable(t, 'u', 'T-1');
    expect(d).toMatchObject({ id: 'u', name: 'T-1' });
    expect(d.columns).toEqual(t.columns);
    expect(d.columns).not.toBe(t.columns);
  });
  it('Copy Table HTML: the body only, escaped, grey header', () => {
    const b = tableHtml(t, rows, { bodyOnly: true });
    expect(b.startsWith('<h1>T</h1>')).toBe(true);
    expect(b).toContain("bgcolor='#808080'");
    expect(b).toContain('T2&lt;');
    expect(b).not.toContain('<body>');
  });
  it('XML Excel: SpreadsheetML, typed cells', () => {
    const x = tableExcelXml(t, rows);
    expect(x).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(x).toContain('<Cell><Data ss:Type="String">Sample</Data></Cell>');
    expect(x).toContain('<Cell><Data ss:Type="Number">30</Data></Cell>');
    expect(tableOutput(t, rows, 'XML_EXCEL')).toBe(x);
    expect(tableOutput(t, rows, 'TAB').startsWith('Sample:\t')).toBe(true);
  });
  it('static text for the layout', () => {
    expect(tableText(t, rows).split('\n')).toEqual(['T', ' | Median | Tube', 'a.fcs | 10 | T1', 'b.fcs | 30 | T2<']);
  });
});

describe('table plots', () => {
  it('box and whisker (JFreeChart quartiles: halves include the median for an odd count)', () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 100])!;
    expect([b.median, b.q1, b.q3]).toEqual([5, 3, 7]);
    expect(b.hi).toBe(8);
    expect(b.farOut).toEqual([100]);
    const e = boxStats([1, 2, 3, 4])!;
    expect([e.median, e.q1, e.q3]).toEqual([2.5, 1.5, 3.5]);
  });
  it('correlation: least squares and Pearson R', () => {
    const r = regression([1, 2, 3, 4], [3, 5, 7, 9]);
    expect(r.slope).toBeCloseTo(2); expect(r.intercept).toBeCloseTo(1); expect(r.r).toBeCloseTo(1);
  });
  it('constant columns cannot be plotted', () => {
    expect(plotBlocked([[1, 1, 1]])).toBe(true);
    expect(plotBlocked([[1, 2, 3]])).toBe(false);
  });
  it('acquisition time from $DATE and $BTIM', () => {
    expect(acquisitionTime({ $DATE: '16-JAN-2015', $BTIM: '10:35:12.50' })).toBe(Date.parse('16 Jan 2015 10:35:12'));
    expect(acquisitionTime({})).toBeNull();
  });
});
