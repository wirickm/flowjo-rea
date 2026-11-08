// Layout editor follow-up gaps (docs/validation/ui-gaps/layout.md section 7
// and 3.3, 6.5, 6.8): table figures, plate display, ribbon, preferences, web
// page figure and Copy To New Layout.
import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type LayoutItem, type SampleState } from '../src/core/model';
import { annoText, boundRows, columnLabel, diffColor, diffColumnLabel, diffText, INSERT_ITEMS, newStatTable, rangeStyle, tableGeometry, teTableSpec } from '../src/core/layoutTables';
import { annotationLines, applyStatistics, autoRange, contrastColor, drawFace, faceOf, neutralFace, newPlateModel, NO_SAMPLES, NO_WELL_ID, parabola, removeUnused, SAME_WELL_ID, setTarget, targetsOf, unusedTarget, wellColor, wellMap } from '../src/core/layoutPlate';
import { addBand, defaultRibbon, DUPLICATE_BAND, HELP_URLS, LAST_BAND, moveBand, overlayNormalize, removeBand, webZoom } from '../src/core/layoutPrefs';
import { compGridItems, compLayoutName, newLayoutWith } from '../src/core/layoutFigures';
import { parseFigList, writeFigList } from '../src/core/wspLayout';
import { parseXml } from '../src/core/xml';

const sample = (id: string, kw: Record<string, string>): SampleState => ({ id, fileName: `${id}.fcs`, fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: kw, channelNames: [], eventCount: 1 } as SampleState);

describe('statistic and difference tables (FigStatTable, FigDifferenceTable)', () => {
  it('a new statistic table: Subset Name with Gating Path and Count, header on', () => {
    const t = newStatTable();
    expect(t.kind === 'stattable' && t.columns.map(columnLabel)).toEqual(['Subset Name with Gating Path', 'Count']);
    expect(t.kind === 'stattable' && t.showHeader).toBe(true);
  });
  it('Add Column offers the seven annotations then Count, Freq. of Total, Freq. of Parent', () => {
    expect(INSERT_ITEMS.map(columnLabel)).toEqual(['Subset Name', 'Subset Name indented', 'Subset Name with Gating Path', 'Sample Name', 'Workspace Annotation', 'Compensation Matrix', 'Full Gating Path', 'Count', 'Freq. of Total (%)', 'Freq. of Parent (%)']);
  });
  it('annotation cells', () => {
    const r = { sampleName: 'a.fcs', path: 'Lymph/CD3', keyword: () => undefined, compensation: 'Comp 1', wsAnnotation: 'Study' };
    expect(annoText('POPNAME', r)).toBe('CD3');
    expect(annoText('INDENTEDPOPNAME', r)).toBe('        CD3');
    expect(annoText('POPNAMEWITHPATH', r)).toBe('Lymph/CD3');
    expect(annoText('FULLGATEPATH', r)).toBe('a.fcs/Lymph/CD3');
    expect(annoText('POPNAMEWITHPATH', { ...r, path: '' })).toBe('a.fcs');
  });
  it('iteration moves non-control rows to the iteration sample (StatTableModel.bind)', () => {
    const rows = [{ sampleId: 'a', path: 'L', control: true }, { sampleId: 'a', path: 'L' }];
    expect(boundRows(rows, true, 'b').map((r) => r.sampleId)).toEqual(['a', 'b']);
    expect(boundRows(rows, false, 'b').map((r) => r.sampleId)).toEqual(['a', 'a']);
  });
  it('expected range cell styles: cyan below, yellow above', () => {
    const c = { type: 'stat' as const, stat: { stat: 'mean' as const, channel: 'FL1' }, range: { min: 10, max: 20 } };
    expect(rangeStyle(c, 5).arrow).toBe('down');
    expect(rangeStyle(c, 25).background).toBe('#FFFF00');
    expect(rangeStyle(c, 15).background).toBeUndefined();
  });
  it('difference cells: row minus control and FlowJo error texts', () => {
    const ok = { control: true, population: true, controlSample: true };
    expect(diffText(12, 10, ok)).toBe('2');
    expect(diffText(12, 10, { ...ok, controlSample: false })).toBe('<No control sample>');
    expect(diffText(12, 10, { ...ok, population: false })).toBe('<No population>');
    expect(diffText(12, 10, { ...ok, control: false })).toBe('<No control>');
  });
  it('difference colours: yellow up, blue down, alpha 1 - (1 - d)^2 (FigStatDifference.getHeatmapColor)', () => {
    expect(diffColor(0.5)).toBe('rgba(255,255,0,0.75)');
    expect(diffColor(-1)).toBe('rgba(0,0,255,1)');
    expect(diffColor(2)).toBe('rgba(255,255,0,1)');
    expect(diffColor(0)).toBe('rgba(0,0,255,0)');
  });
  it('difference column labels start with a delta for statistics', () => {
    expect(diffColumnLabel({ type: 'stat', stat: { stat: 'count' } })).toBe('Δ Count');
    expect(diffColumnLabel({ type: 'anno', anno: 'SAMPLENAME' })).toBe('Sample Name');
  });
  it('a table-editor table becomes a static TETable with a Sample column', () => {
    const t = teTableSpec('T', ['Count'], [{ sample: 'a.fcs', cells: [4000] }, { sample: 'b.fcs', cells: [1.234567891] }]);
    expect(t.kind === 'tetable' && t.header).toEqual(['Sample', 'Count']);
    expect(t.kind === 'tetable' && t.rows.map((r) => r.cells)).toEqual([['a.fcs', '4000'], ['b.fcs', '1.23457']]);
    expect(tableGeometry([['Sample', 'Count'], ['a.fcs', '4000']]).h).toBe(32);
  });
});

describe('plate display (FigPlateDisplay, PlateDisplayModel)', () => {
  it('wells from WELL ID keywords; missing and duplicate IDs are reported', () => {
    const m = wellMap([sample('a', { 'WELL ID': 'A01' }), sample('b', { 'WELL ID': 'C12' }), sample('c', {}), sample('d', { 'WELL ID': 'a1' })]);
    expect([m.rows, m.cols, m.wells.size]).toEqual([3, 12, 2]);
    expect(m.errors).toEqual([NO_WELL_ID, SAME_WELL_ID]);
    expect(wellMap([]).errors).toEqual([NO_SAMPLES]);
  });
  it('dropped statistics: Heatmap takes the first two, the group defaults to the current one', () => {
    const m = applyStatistics(newPlateModel(), ['s1', 's2', 's3'], 'All Samples');
    expect(m.groupName).toBe('All Samples');
    expect(m.stats.map((s) => s.target)).toEqual(['HEATMAP1', 'HEATMAP2', undefined]);
    expect(m.stats.every((s) => s.method === 'AUTO')).toBe(true);
  });
  it('Chernoff faces: each dropped statistic takes an unused feature', () => {
    const m = applyStatistics({ ...newPlateModel(), mode: 'CHERNOFF_FACE' }, ['s1', 's2']);
    expect(m.stats.map((s) => s.target)).toEqual(['CHERNOFF_PUPIL_SIZE', 'CHERNOFF_EYE_SPACING']);
    expect(targetsOf('CHERNOFF_FACE')).toHaveLength(10);
    expect(unusedTarget(m)).toBe('CHERNOFF_HEAD_SHAPE');
  });
  it('a target belongs to one statistic; Remove Unused drops statistics not shown', () => {
    let m = applyStatistics(newPlateModel(), ['s1', 's2']);
    m = setTarget(m, 's2', 'HEATMAP1');
    expect(m.stats.map((s) => s.target)).toEqual([undefined, 'HEATMAP1']);
    expect(removeUnused(m).stats.map((s) => s.statId)).toEqual(['s2']);
    expect(removeUnused({ ...m, mode: 'CHERNOFF_FACE' }).stats).toEqual([]);
  });
  it('AUTO range: min and max skipping NaN; the maximum starts at Double.MIN_VALUE', () => {
    expect(autoRange([3, NaN, 7])).toEqual({ min: 3, max: 7 });
    expect(autoRange([NaN])).toBeNull();
    expect(autoRange([-5, -2])).toEqual({ min: -5, max: 4.9e-324 });
  });
  it('well colours: blue at the minimum, yellow at the maximum; contrasting text', () => {
    expect(wellColor(3, { min: 3, max: 7 })).toBe('rgb(0,0,255)');
    expect(wellColor(7, { min: 3, max: 7 })).toBe('rgb(255,255,0)');
    expect(wellColor(5, { min: 3, max: 7 })).toBe('rgb(128,128,127)');
    expect(contrastColor('rgb(0,0,255)')).toBe('#ffffff');
    expect(contrastColor('rgb(255,255,0)')).toBe('#000000');
  });
  it('annotation lines', () => {
    const m = applyStatistics(newPlateModel(), ['s1'], 'G');
    expect(annotationLines(m, () => 'Mean', { s1: { min: 1, max: 2.5 } }, [])).toEqual(['Sample Group: G', 'Statistic: Mean', '    :: displayed as Heatmap = heatmap range 1 - 2.5']);
    expect(annotationLines(m, () => 'Mean', { s1: null }, ['x'])[2]).toContain('<Not Calculated>');
  });
  it('Chernoff face geometry (FacePainter): neutral face, scaled box, parabola mouth', () => {
    const ovals: number[][] = [], lines: number[][] = [];
    drawFace({ oval: (x, y, w, h, f) => ovals.push([x, y, w, h, f ? 1 : 0]), line: (...a) => lines.push(a) }, neutralFace(), 80, 80, 80, 80);
    // box: (80 - 10, 80 - 10 - 3, 100, 100): head radius 30 at (50, 50)
    expect(ovals[0]).toEqual([90, 87, 60, 60, 0]);
    expect(ovals.filter((o) => o[4]).length).toBe(2); // pupils
    expect(lines.length).toBeGreaterThan(20);
    const [A, B, C] = parabola(0, 0, 2, 0, 1, 1);
    expect([A, B, C].map((v) => +v.toFixed(6))).toEqual([-1, 2, 0]);
    const f = faceOf({ ...newPlateModel(), mode: 'CHERNOFF_FACE', stats: [{ statId: 's', target: 'CHERNOFF_MOUTH' }] }, { s: 7 }, { s: { min: 3, max: 7 } });
    expect(f[6]).toBe(1);
  });
});

describe('ribbon and preferences (LERibbonStructure, FJRibbonConfigDialog)', () => {
  it('default ribbon rows', () => {
    expect(defaultRibbon().LEDITOR).toEqual(['LAYOUTS', 'ITERATION', 'BATCH']);
    expect(defaultRibbon().ARRANGE).toEqual(['REORDER', 'VERTICAL', 'HORIZONTAL']);
  });
  it('add refuses a band the row has; remove refuses the last band; swap', () => {
    const c = defaultRibbon();
    expect(addBand(c, 'EDIT', 'SELECT').error).toBe(DUPLICATE_BAND);
    expect(addBand(c, 'FILE', 'SELECT').config.FILE).toEqual(['DOCUMENT', 'GO', 'SELECT']);
    expect(removeBand({ ...c, FILE: ['DOCUMENT'] }, 'FILE', 'DOCUMENT').error).toBe(LAST_BAND);
    expect(moveBand(c, 'FILE', 'GO', -1).FILE).toEqual(['GO', 'DOCUMENT']);
  });
  it('Overlay Mode: only Modal normalises (Unit falls back to Auto in 10.6.2)', () => {
    expect([overlayNormalize('auto'), overlayNormalize('modal'), overlayNormalize('unit')]).toEqual([false, true, false]);
  });
  it('help URLs are FlowJo 10 documentation pages', () => {
    expect(HELP_URLS.GRID_HELP).toBe('http://docs.flowjo.com/d2/graphical-reports/graph-options-and-annotation/le-grid/');
  });
  it('web page zoom: rotation / 10 within 0.1..3', () => {
    expect(webZoom(1, 1)).toBe(1.1);
    expect(webZoom(0.15, -1)).toBe(0.1);
    expect(webZoom(2.95, 2)).toBe(3);
  });
});

describe('Copy To New Layout and .wsp web pages', () => {
  it('a new layout named Comp-<group>, iteration off, holding the preview grid', () => {
    const ws = emptyWorkspace();
    const items = compGridItems(['A', 'B'], { kind: 'nxn' }, 's', 'L', 'm1', 'x');
    expect(items).toHaveLength(4);
    expect(items.map((i) => ('kind' in i ? i.kind : ''))).toEqual(['histogram', 'dot', 'dot', 'histogram']);
    const patch = newLayoutWith(ws, compLayoutName('All Samples'), items);
    expect(patch.layoutName).toBe('Comp-All Samples');
    expect(patch.layoutIteration).toEqual({ type: 'OFF' });
    expect(patch.otherLayouts?.[0].name).toBe('Layout');
    expect(compLayoutName()).toBe('Compensation');
  });
  it('FigWebBrowser round trip (url, zoom, offset)', () => {
    const r = parseFigList(parseXml('<FigList><FigWebBrowser x="10" y="20" width="300" height="200" url="http://example.org" zoom="1.5" offsetX="-4" offsetY="7" /></FigList>').documentElement, () => undefined, (_s, n) => n);
    const it = r.items[0] as LayoutItem;
    expect(it.object).toEqual({ kind: 'web', url: 'http://example.org', zoom: 1.5, offsetX: -4, offsetY: 7 });
    const xml = writeFigList(r.items, [], () => '1', (_a, c) => c);
    expect(xml).toContain('<FigWebBrowser x="10"  y="20"  width="300"  height="200"');
    expect(xml).toContain('url="http://example.org"  zoom="1.5"');
  });
});
