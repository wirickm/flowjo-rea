// Follow-up formats decoded from FlowJo 10.6.2 reader / writer classes
// (docs/validation/ui-gaps/workspace.md section O, tables.md section 3):
// FACSDiva experiment import / export, CSV / CLR parameter import, Consensus
// Gate and Cluster Frequency parameters, table output FlowJo XML and SQL.
import { describe, expect, it } from 'vitest';
import { divaFcsFiles, divaScaleFromFJWidth, divaWorksheetTemplates, ellipsePoints, exportDiva, fjWidthFromDivaScale, importDiva, javaDouble } from '../src/core/diva';
import { decodeColumn, encodeColumn, importBaseName, importKind, parseParameterFile } from '../src/core/paramImport';
import { clusterFrequencyColumn, clusterParamName, consensusColumn } from '../src/core/clusterParams';
import { SampleEngine } from '../src/core/analysis';
import { tableFlowJoXml, tableOutput, tableRows, tableSql, type TableTemplate } from '../src/core/tableEditor';
import type { FcsFile } from '../src/core/fcs';
import type { Population, SampleState } from '../src/core/model';
import { makeTransform } from '../src/core/transforms';
import { parseXml, kids, kid, text, type El } from '../src/core/xml';

// A minimal FACSDiva experiment built from the element names the FlowJo Diva
// classes read and write (no FACSDiva file is copied).
const param = (name: string, log: boolean, extra = '') => `<parameter name="${name}" type="30"><is_log>${log}</is_log><min>0.0</min><max>262143.0</max><biexp_scale>-1</biexp_scale><comp_biexp_scale>-1</comp_biexp_scale><manual_biexp_scale>${log ? 100 : -1}</manual_biexp_scale>${extra}</parameter>`;
const comp = (vals: number[]) => `<compensation>${vals.map((v) => `<compensation_coefficient>${v}</compensation_coefficient>`).join('')}</compensation>`;
const inst = (auto: boolean) => `<instrument_settings name="Cytometer Settings"><use_auto_biexp_scale>${auto}</use_auto_biexp_scale>${param('FSC-A', false)}${param('SSC-A', false)}${param('FITC-A', true, comp([1, -0.25]))}${param('PE-A', true, comp([-0.1, 1]))}</instrument_settings>`;
const gate = (full: string, name: string, parent: string, region: string, xlog = false, ylog = false, xs = false, ys = false) =>
  `<gate fullname="${full}" type="Region_Classifier"><name>${name}</name><color>0xff0000</color><visible>true</visible><dotsize>0</dotsize><enabled>true</enabled><num_events>0</num_events><parent>${parent}</parent>${region}<is_x_parameter_scaled>${xs}</is_x_parameter_scaled><is_y_parameter_scaled>${ys}</is_y_parameter_scaled><is_x_parameter_log>${xlog}</is_x_parameter_log><is_y_parameter_log>${ylog}</is_y_parameter_log><x_parameter_scale_value>100</x_parameter_scale_value><y_parameter_scale_value>100</y_parameter_scale_value><input>${parent}</input></gate>`;
const pts = (p: [number, number][]) => `<points>${p.map(([x, y]) => `<point x="${x}" y="${y}"/>`).join('')}</points>`;
const DIVA = `<?xml version="1.0" encoding="UTF-8"?><bdfacs version="Version 8.5"><experiment name="Exp"><date>2019-02-21T11:27:35</date><export_time>2019-02-21T11:39:52</export_time>
<acquisition_worksheets name="Global Worksheets"><worksheet_template name="Tmpl">${inst(false)}<gates>
<gate fullname="All Events" type="EventSource_Classifier"><name>All Events</name></gate>
${gate('All Events\\P1', 'P1', 'All Events', `<region name="P1" xparm="FSC-A" yparm="SSC-A" type="RECTANGLE_REGION">${pts([[1000, 50000], [90000, 50000], [90000, 2000], [1000, 2000]])}</region>`)}
${gate('All Events\\P1\\P2', 'P2', 'All Events\\P1', `<region name="P2" xparm="FITC-A" yparm="PE-A" type="POLYGON_REGION">${pts([[1, 1], [3, 1], [3, 4], [1, 3]])}</region>`, true, true)}
${gate('All Events\\P1\\P3', 'P3', 'All Events\\P1', `<region name="P3" xparm="FITC-A" yparm="" type="INTERVAL_REGION">${pts([[1000, 100], [3000, 100]])}</region>`, true, false, true, false)}
<gate fullname="All Events\\P1\\$1" type="Composite_Classifier"><name>$1</name><parent>All Events\\P1</parent><region name="$1" xparm="FSC-A" yparm="SSC-A" type="BINNER_REGION">${pts([[5000, 6000], [5000, 6000], [5000, 6000]])}</region><bin>All Events\\P1\\Q1</bin><bin>All Events\\P1\\Q2</bin><bin>All Events\\P1\\Q3</bin><bin>All Events\\P1\\Q4</bin></gate>
<gate fullname="All Events\\P1\\Q1" type="Region_Classifier"><name>Q1</name></gate><gate fullname="All Events\\P1\\Q2" type="Region_Classifier"><name>Q2</name></gate><gate fullname="All Events\\P1\\Q3" type="Region_Classifier"><name>Q3</name></gate><gate fullname="All Events\\P1\\Q4" type="Region_Classifier"><name>Q4</name></gate>
</gates></worksheet_template></acquisition_worksheets>
<specimen name="Specimen_001"><tube name="T1"><data_filename>t1.fcs</data_filename>${inst(false)}</tube><tube name="T2"><data_filename>t2.fcs</data_filename>${inst(true)}</tube></specimen></experiment></bdfacs>`;

describe('FACSDiva import (DivaXMLImporter, FJtoDivaGateMapper)', () => {
  it('lists worksheet templates and tube FCS files', () => {
    expect(divaWorksheetTemplates(DIVA)).toEqual(['Tmpl']);
    expect(divaFcsFiles(DIVA)).toEqual(['t1.fcs', 't2.fcs']);
  });
  const r = importDiva(DIVA, { worksheet: 'Tmpl', fcsFile: 't1.fcs', sampleName: 't1.fcs' });
  const by = (n: string) => r.populations.find((p) => p.name === n)!;
  it('rectangle on linear axes: bounds are the point extremes in data units', () => {
    expect(by('P1').parentId).toBeNull();
    expect(by('P1').gate).toMatchObject({ type: 'rect', min: [1000, 2000], max: [90000, 50000] });
  });
  it('log polygon: Diva log10 coordinates become log-scale vertices of the child of P1', () => {
    const g = by('P2').gate as Extract<Population['gate'], { type: 'polygon' }>;
    expect(by('P2').parentId).toBe(by('P1').id);
    const t = makeTransform(g.dims[0].transform);
    expect(t.inverse(g.vertices[1][0])).toBeCloseTo(1000, 6);
    expect(t.inverse(g.vertices[2][1])).toBeCloseTo(10000, 6);
  });
  it('interval on a biex scale: channel coordinates through the 4096-channel table of width from the Diva scale', () => {
    const g = by('P3').gate as Extract<Population['gate'], { type: 'rect' }>;
    expect(g.dims.length).toBe(1);
    expect(g.dims[0].transform).toMatchObject({ kind: 'flowjo-biex', max: 262144, pos: 4.5, neg: 0, channelRange: 4096, width: fjWidthFromDivaScale(100) });
    expect(g.min[0]).toBeCloseTo(1000, 6);
    expect(g.max[0]).toBeCloseTo(3000, 6);
  });
  it('quadrant group: four quadrants upper-left, upper-right, lower-left, lower-right at the centre point', () => {
    expect(['Q1', 'Q2', 'Q3', 'Q4'].map((n) => (by(n).gate as { side: number[] }).side)).toEqual([[0, 1], [1, 1], [0, 0], [1, 0]]);
    expect(by('Q1').gate).toMatchObject({ dividers: [[5000], [6000]] });
    expect(r.populations.length).toBe(7);
  });
  it('compensation: the inverse of the coefficient rows, named DivaCompMtx_<sample>', () => {
    expect(r.matrix?.name).toBe('DivaCompMtx_t1.fcs');
    expect(r.matrix?.channels).toEqual(['FITC-A', 'PE-A']);
    const v = r.matrix!.values;
    const prod = [[1, -0.25], [-0.1, 1]].map((row, i) => [0, 1].map((j) => row[0] * v[0][j] + row[1] * v[1][j]));
    expect(prod[0][0]).toBeCloseTo(1, 12); expect(prod[0][1]).toBeCloseTo(0, 12); expect(prod[1][1]).toBeCloseTo(1, 12);
  });
  it('axis scales: log scatter stays log, other log parameters become biex; parameter settings only skips gates', () => {
    expect(r.transforms['FSC-A'].kind).toBe('linear');
    expect(r.transforms['FITC-A'].kind).toBe('flowjo-biex');
    expect(importDiva(DIVA, { worksheet: 'Tmpl', fcsFile: 't1.fcs', sampleName: 's', paramSettingsOnly: true }).populations).toEqual([]);
  });
  it('biex scale value <-> width: export uses log10(262144) - 1 decades (round(-10 w)), import 4.5', () => {
    expect(Math.round(divaScaleFromFJWidth(-10))).toBe(100);
    expect(fjWidthFromDivaScale(100)).toBeCloseTo(-(100 / 262144) * 10 ** 4.5, 9);
  });
});

describe('FACSDiva export (DivaXMLManipulator) and round trip', () => {
  const lin = (c: string) => ({ kind: 'channel' as const, channel: c, transform: { kind: 'none' as const } });
  const logd = (c: string) => ({ kind: 'channel' as const, channel: c, transform: { kind: 'flowjo-log' as const, offset: 1, decades: 5.4185380935668945 } });
  const pops: Population[] = [
    { id: 'a', name: 'Cells', parentId: null, gate: { type: 'rect', dims: [lin('FSC-A'), lin('SSC-A')], min: [1000, 2000], max: [90000, 50000] } },
    { id: 'b', name: 'Pos', parentId: 'a', gate: { type: 'polygon', dims: [logd('FITC-A'), logd('PE-A')], vertices: [[0.2, 0.2], [0.6, 0.2], [0.6, 0.7], [0.2, 0.5]] } },
    { id: 'c', name: 'Hi', parentId: 'a', gate: { type: 'rect', dims: [lin('FSC-A')], min: [500], max: [7000] } },
    ...[[0, 1], [1, 1], [0, 0], [1, 0]].map((side, k) => ({ id: `q${k}`, name: `Q${k + 1}`, parentId: 'a', gate: { type: 'quadrant' as const, dims: [lin('FSC-A'), lin('SSC-A')], dividers: [[5000], [6000]], side } })),
  ];
  const sample: SampleState = { id: 's1', fileName: 't1.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'm', populations: pops, keywordsSnapshot: {}, channelNames: [], eventCount: 1234 };
  const matrix = { id: 'm', name: 'M', channels: ['FITC-A', 'PE-A'], values: [[1, 0.2], [0.05, 1]], source: 't' };
  const transforms = { 'FSC-A': { kind: 'linear' as const, T: 262143, A: 0 }, 'FITC-A': { kind: 'flowjo-log' as const, offset: 1, decades: 5.4185380935668945 }, 'PE-A': { kind: 'flowjo-log' as const, offset: 1, decades: 5.4185380935668945 } };
  const out = exportDiva(DIVA, { sample, transforms, matrix, selected: ['a', 'b', 'c'], experimentName: 'New', now: new Date(2026, 10, 7, 9, 5, 3), random: () => 0.5, applyToAll: true });
  const doc = parseXml(out.xml).documentElement as unknown as El;
  const exp = kid(doc, 'experiment')!;
  const wt = kids(kid(exp, 'acquisition_worksheets')!, 'worksheet_template').find((e) => e.getAttribute('name') === 'FlowJo Exported Gates')!;
  it('renames the experiment, stamps the time and adds the "FlowJo Exported Gates" template', () => {
    expect(exp.getAttribute('name')).toBe('New');
    expect(text(kid(exp, 'date')!)).toBe('2026-11-07T09:05:03');
    expect(wt).toBeTruthy();
    const gs = kids(kid(wt, 'gates')!, 'gate');
    expect(gs.map((g) => g.getAttribute('fullname'))).toEqual(['All Events', 'All Events\\Cells', 'All Events\\Cells\\Pos', 'All Events\\Cells\\Hi', 'All Events\\Cells\\$5555555555555', 'All Events\\Cells\\Q1', 'All Events\\Cells\\Q2', 'All Events\\Cells\\Q3', 'All Events\\Cells\\Q4']);
    expect(text(kid(gs[0], 'num_events')!)).toBe('1234');
    expect(kid(gs[1], 'region')!.getAttribute('type')).toBe('RECTANGLE_REGION');
    expect(kids(kid(kid(gs[1], 'region')!, 'points')!, 'point').map((p) => [p.getAttribute('x'), p.getAttribute('y')])).toEqual([['1000.0', '50000.0'], ['90000.0', '50000.0'], ['90000.0', '2000.0'], ['1000.0', '2000.0']]);
    expect(text(kid(gs[2], 'is_x_parameter_log')!)).toBe('true');
    expect(text(kid(gs[2], 'is_x_parameter_scaled')!)).toBe('false');
    expect(kid(gs[3], 'region')!.getAttribute('type')).toBe('INTERVAL_REGION');
    expect(gs[4].getAttribute('type')).toBe('Composite_Classifier');
    expect(text(kid(gs[5], 'input')!)).toBe('All Events\\Cells\\$5555555555555');
    expect(text(kid(gs[5], 'enabled')!)).toBe('false');
  });
  it('writes the inverse spillover as coefficients on the compensated parameters of every matching tube', () => {
    for (const tube of kids(kid(exp, 'specimen')!, 'tube')) {
      const fitc = kids(kid(tube, 'instrument_settings')!, 'parameter').find((p) => p.getAttribute('name') === 'FITC-A')!;
      const c = kids(kid(fitc, 'compensation')!, 'compensation_coefficient').map((e) => Number(text(e)));
      expect(c[0]).toBeCloseTo(1 / (1 - 0.01), 12);
      expect(c[1]).toBeCloseTo(-0.2 / (1 - 0.01), 12);
      expect(text(kid(kid(tube, 'instrument_settings')!, 'use_auto_biexp_scale')!)).toBe('false');
    }
  });
  it('round trip: importing the exported template gives back the gates and the matrix', () => {
    const back = importDiva(out.xml, { worksheet: 'FlowJo Exported Gates', fcsFile: 't1.fcs', sampleName: 't1.fcs' });
    const by = (n: string) => back.populations.find((p) => p.name === n)!;
    expect(back.populations.map((p) => p.name)).toEqual(['Cells', 'Pos', 'Hi', 'Q1', 'Q2', 'Q3', 'Q4']);
    expect(by('Cells').gate).toMatchObject({ min: [1000, 2000], max: [90000, 50000] });
    expect(by('Pos').parentId).toBe(by('Cells').id);
    const pg = by('Pos').gate as Extract<Population['gate'], { type: 'polygon' }>;
    pg.vertices.forEach((v, i) => { expect(v[0]).toBeCloseTo((pops[1].gate as typeof pg).vertices[i][0], 9); expect(v[1]).toBeCloseTo((pops[1].gate as typeof pg).vertices[i][1], 9); });
    expect(by('Hi').gate).toMatchObject({ min: [500], max: [7000] });
    expect(by('Q3').gate).toMatchObject({ side: [0, 0], dividers: [[5000], [6000]] });
    back.matrix!.values.forEach((r, i) => r.forEach((v, j) => expect(v).toBeCloseTo(matrix.values[i][j], 12)));
  });
  it('rejects an experiment without the sample FCS file or a non-Diva file', () => {
    expect(() => exportDiva(DIVA, { sample: { ...sample, fileName: 'zz.fcs' }, transforms, matrix, selected: [], experimentName: 'X' })).toThrow(/does not include zz.fcs/);
    expect(() => importDiva('<x/>', { worksheet: 'a', fcsFile: 'b', sampleName: 'c' })).toThrow(/not a valid Diva experiment/);
  });
  it('Java number text and the 20-point ellipse outline', () => {
    expect([javaDouble(100), javaDouble(0.5), javaDouble(1.5e7), javaDouble(0)]).toEqual(['100.0', '0.5', '1.5E7', '0.0']);
    const e = ellipsePoints([[10, 0], [-10, 0], [0, 5], [0, -5]]);
    expect(e.length).toBe(20);
    expect(e[0][0]).toBeCloseTo(10, 9);
    expect(e[5][1]).toBeCloseTo(5, 9);
  });
});

describe('Import Parameters from CSV/CLR (FlowCAPUtil, Sample::CreateImportCsv/ClrParameter)', () => {
  it('kind from the extension; the sample name prefix and one separator are removed from the name', () => {
    expect([importKind('a.CSV'), importKind('b.clr'), importKind('c.txt')]).toEqual(['csv', 'clr', null]);
    expect(importBaseName('Tube1_CD4.csv', 'Tube1.fcs')).toBe('CD4');
    expect(importBaseName('other.csv', 'Tube1.fcs')).toBe('other');
  });
  it('CSV with a header: tab or comma, quotes removed, rows must equal the event count', () => {
    const r = parseParameterFile('"tSNE1"\t"tSNE2"\n1.5\t2\n3\t-4.25\n', 'csv', 'x', 2);
    expect(r.names).toEqual(['tSNE1', 'tSNE2']);
    expect([...r.columns[1]]).toEqual([2, -4.25]);
    expect(r.range).toBe(3);
    expect(() => parseParameterFile('a\n1\n', 'csv', 'x', 2)).toThrow(/1 data rows but the sample has 2/);
  });
  it('CSV without a header: every line is data, named after the file', () => {
    const r = parseParameterFile('1\n2\n7.9\n', 'csv', 'Score', 3);
    expect(r.names).toEqual(['Score']);
    expect(r.range).toBe(7);
    expect(parseParameterFile('1,2\n3,4\n', 'csv', 'S', 2).names).toEqual(['S1', 'S2']);
  });
  it('CLR: 0 becomes 0.001, values are multiplied by 9800, range 10000, binary flag', () => {
    const r = parseParameterFile('c1,c2\n0,1\n1,0\n', 'clr', 'x', 2);
    expect(r.columns[0][0]).toBeCloseTo(9.8, 4);
    expect(r.columns[0][1]).toBe(9800);
    expect(r.range).toBe(10000);
    expect(r.binary).toBe(true);
    expect(parseParameterFile('0.5\n1\n', 'clr', 'x', 2).binary).toBe(false);
  });
  it('values round-trip through the workspace encoding and reach the analysis engine for their sample only', () => {
    const v = Float32Array.from([1, 2.5, -3]);
    expect([...decodeColumn(encodeColumn(v))]).toEqual([1, 2.5, -3]);
    const fcs = { eventCount: 3, channels: [{ name: 'FSC-A' }], data: [Float64Array.from([1, 2, 3])], keywords: {} } as unknown as FcsFile;
    const dp = [{ name: 'Imp', imported: { source: 'csv' as const, file: 'f.csv', range: 3, data: { s1: encodeColumn(v) } } }];
    expect([...new SampleEngine(fcs, { compensation: 'none', populations: [] }, [], dp, 's1').run().column('Imp')]).toEqual([1, 2.5, -3]);
    expect([...new SampleEngine(fcs, { compensation: 'none', populations: [] }, [], dp, 's2').run().column('Imp')].every(Number.isNaN)).toBe(true);
  });
});

describe('Consensus Gate and Cluster Frequency (Sample::CreateConsensusGateParameter / CreateClusterFrequencyParameter)', () => {
  const a = Uint8Array.from([1, 1, 0, 0]), b = Uint8Array.from([1, 0, 1, 0]);
  it('names: each population then "Consensus" / "ClusterFreq"', () => {
    expect(clusterParamName('consensus', ['A', 'B'])).toBe('A.B.Consensus');
    expect(clusterParamName('clusterFrequency', ['P', 'A'])).toBe('P.A.ClusterFreq');
  });
  it('consensus: fraction of populations containing the event, 0 replaced by 0.001', () => {
    expect([...consensusColumn([a, b], 4)]).toEqual([1, 0.5, 0.5, Math.fround(0.001)]);
  });
  it('cluster frequency: 10 outside the primary, 30 + 100 x fraction inside, scaled so the maximum is 3723.6', () => {
    const v = clusterFrequencyColumn(a, [b], 4);
    const f = Math.fround(3723.636282928721 / 130);
    expect([...v]).toEqual([Math.fround(130 * f), Math.fround(30 * f), Math.fround(10 * f), Math.fround(10 * f)]);
  });
  it('the engine recomputes them from the sample populations', () => {
    const fcs = { eventCount: 4, channels: [{ name: 'X' }], data: [Float64Array.from([1, 2, 3, 4])], keywords: {} } as unknown as FcsFile;
    const dim = { kind: 'channel' as const, channel: 'X', transform: { kind: 'none' as const } };
    const pops: Population[] = [
      { id: 'A', name: 'A', parentId: null, gate: { type: 'rect', dims: [dim], min: [0], max: [2.5] } },
      { id: 'B', name: 'B', parentId: null, gate: { type: 'rect', dims: [dim], min: [1.5], max: [3.5] } },
    ];
    const eng = new SampleEngine(fcs, { compensation: 'none', populations: pops }, [], [{ name: 'A.B.Consensus', gateDerived: { type: 'consensus', sampleId: 's', populations: ['A', 'B'] } }], 's').run();
    expect([...eng.column('A.B.Consensus')]).toEqual([0.5, 1, 0.5, Math.fround(0.001)]);
  });
});

describe('table output FlowJo XML and SQL (TableGenerator.createTableAsFlowJoXML / createTableAsSQL)', () => {
  const t: TableTemplate = { id: 't', name: "My 'T'", iteration: { type: 'SAMPLE' }, columns: [
    { kind: 'statistic', header: 'Median FL1', stat: { populationPath: 'Lymph/CD3+', stat: 'median', channel: 'FL1-A' } },
    { kind: 'keyword', header: 'Tube', keyword: '$SRC' },
  ] };
  const rows = tableRows(t, [{ sample: 'a.fcs', keywords: { $SRC: 'T1' }, stats: { '#0': 10 } }, { sample: 'b.fcs', keywords: { $SRC: 'T&2' }, stats: { '#0': 30 } }]);
  it('FlowJo XML: Table / Columns / Row / Entry as SElement prints them', () => {
    const x = tableFlowJoXml(t, rows, { workspaceTitle: 'WS', autoHeader: (c) => (c.kind === 'keyword' ? c.header : 'auto'), stainOf: () => 'CD3' });
    expect(x).toBe(`<Table name="My 'T'">
  <Columns>
    <Column id="0" customRename="Median FL1" analysisPath="Lymph/CD3+" statistic="Median" population="CD3+" parameterName="FL1-A" stain="CD3"/>
    <Column id="1" keyword="$SRC"/>
  </Columns>
  <Row sample="a.fcs" workspaceTitle="WS">
    <Entry colId="0">10</Entry>
    <Entry colId="1">T1</Entry>
  </Row>
  <Row sample="b.fcs" workspaceTitle="WS">
    <Entry colId="0">30</Entry>
    <Entry colId="1">T&amp;2</Entry>
  </Row>
</Table>
`);
    expect(parseXml(x).documentElement.nodeName).toBe('Table');
  });
  it('SQL: one INSERT per row, quotes in the name doubled, headers paired with sample and the first n-1 cells (as FlowJo)', () => {
    expect(tableSql(t, rows)).toBe(`INSERT INTO 'My "T"' ('Median FL1','Tube') VALUES ('a.fcs','10')\nINSERT INTO 'My "T"' ('Median FL1','Tube') VALUES ('b.fcs','30')\n`);
    expect(tableSql(t, [])).toBe('');
    expect(tableOutput(t, rows, 'SQL')).toBe(tableSql(t, rows));
  });
});
