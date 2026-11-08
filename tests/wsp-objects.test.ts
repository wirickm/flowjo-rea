import { describe, expect, it } from 'vitest';
import { parseFigList, parseRangeName, rangeName, statNodeName, writeFigList } from '../src/core/wspLayout';
import { parseXml } from '../src/core/xml';
import { emptyWorkspace, type LayoutItem, type LayoutObject, type LayoutPlot, type StatColumn } from '../src/core/model';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';
import { batchLayoutPatch, pptxFromImages, pptxScale, webImageName, webPageHtml } from '../src/core/layoutBatch';
import { readZip } from '../src/core/zip';

// Object figures in a .wsp FigList (docs/validation/flowjo-figlist-format.md
// section 9), as decoded from FlowJo 10.6.2's writers and readers.
const sample = (sid: string) => ({ '1': 's1', '2': 's2' } as Record<string, string>)[sid];
const channel = (_sid: string, n: string) => n.replace(/^Comp-/, '');
const sampleId = (id: string | undefined) => (id === 's2' ? '2' : '1');
const param = (_id: string | undefined, ch: string) => (ch.startsWith('CD') ? `Comp-${ch}` : ch);
const parse = (xml: string, cols: StatColumn[] = []) => parseFigList(parseXml(xml).documentElement, sample, channel, { statColumns: cols });
const objOf = (it: LayoutItem) => (it as LayoutObject).object;

// Hand-written FigList with one of each object figure, following the decoded schema.
const FIG = `<FigList>
  <StatTable x="20"  y="30"  width="300"  height="64"  lineWeight="NoLine"  fill="#00ffffff"  rows="3"  columns="4"  drawGrid="1"  autoFitContents="0"  z="0" >
    <RowSizes><Size index="0"  value="16" /><Size index="1"  value="16" /><Size index="2"  value="16" /></RowSizes>
    <ColSizes><Size index="0"  value="75" /><Size index="1"  value="75" /><Size index="2"  value="75" /><Size index="3"  value="75" /></ColSizes>
    <StatTableModel showHeader="0"  enableContentIteration="1" >
      <Populations>
        <NodeReference rootID="1"  path="Lymphocytes" />
        <NodeReference rootID="2"  path="Lymphocytes/CD4+"  control="1" />
        <NodeReference rootID="All Samples"  isGroup="1"  path="Lymphocytes" />
      </Populations>
      <Columns>
        <Anno name="fj.anno.popnamewithpath" />
        <Key name="$FIL" />
        <Statistic name="Median"  id="Comp-CD3"  expectedRange="10 - 500" />
        <Statistic name="Percentile"  id="Comp-CD4"  percent="95" />
        <Statistic name="fj.stat.freqof"  ancestor="Lymphocytes" />
        <Graph type="Histogram" />
      </Columns>
      <TextTraits font="SansSerif"  size="11"  name="Content"  style="plain"  color="#000000"  background="#00ffffff"  just="left" />
    </StatTableModel>
  </StatTable>
  <DifferenceTable x="20"  y="200"  width="200"  height="48"  rows="2"  columns="2" >
    <Model showHeader="1"  enableContentIteration="0" >
      <Populations><NodeReference rootID="1"  path="Lymphocytes" /></Populations>
      <Columns><Anno name="fj.anno.samplename" /><Statistic name="fj.stat.freqofparent" /></Columns>
      <Control sampleID="2" />
    </Model>
  </DifferenceTable>
  <TETable x="20"  y="300"  width="160"  height="48"  rows="3"  columns="2"  drawGrid="1" >
    <RowSizes><Size index="0"  value="16" /><Size index="1"  value="16" /><Size index="2"  value="16" /></RowSizes>
    <ColSizes><Size index="0"  value="80" /><Size index="1"  value="80" /></ColSizes>
    <Content>
      <Cell row="0"  col="0" ><StyledText x="0"  y="0"  width="80"  height="16" ><Content>&amp;lt;html&amp;gt;&amp;lt;body&amp;gt;&amp;lt;/body&amp;gt;&amp;lt;/html&amp;gt;</Content></StyledText></Cell>
      <Cell row="0"  col="1" ><StyledText x="0"  y="0"  width="80"  height="16" ><Content>&amp;lt;html&amp;gt;&amp;lt;body&amp;gt;Count&amp;lt;/body&amp;gt;&amp;lt;/html&amp;gt;</Content></StyledText></Cell>
      <Cell row="1"  col="0" ><SimpleFJML x="0"  y="0"  width="80"  height="16"  fill="#00ffffff"  padding="1,4,1,4" ><Content>A1.fcs</Content><TextTraits font="SansSerif"  size="11"  name=""  style="plain"  color="#000000" /></SimpleFJML></Cell>
      <Cell row="1"  col="1" ><SimpleFJML x="0"  y="0"  width="80"  height="16"  fill="#ffff00"  padding="1,4,1,4" ><Content>1200</Content><TextTraits font="SansSerif"  size="11"  name=""  style="bold"  color="#ff0000" /></SimpleFJML></Cell>
      <Cell row="2"  col="0" ><SimpleFJML x="0"  y="0"  width="80"  height="16" ><Content>A2 &amp;amp; B.fcs</Content><TextTraits style="italic" /></SimpleFJML></Cell>
      <Cell row="2"  col="1" ><SimpleFJML x="0"  y="0"  width="80"  height="16" ><Content>800</Content><TextTraits style="plain" /></SimpleFJML></Cell>
    </Content>
    <Labels></Labels>
  </TETable>
  <PlateDisplay x="400"  y="30"  width="360"  height="240"  rows="8"  columns="12" >
    <PlateDisplayModel groupName="Plate 1"  displayMode="le.plate.display.mode.chernoffface" >
      <Statistics>
        <PlateStatisticReference path="Lymphocytes/Freq. of Parent"  displayTarget="le.plate.display.comp.face.headshape" ><HeatmapRange method="fj.heatmap.method.auto" /></PlateStatisticReference>
        <PlateStatisticReference path="Lymphocytes/Median : Comp-CD3"  displayTarget="LE.PLATE.DISPLAY.COMP.FACE.GRIN" ><HeatmapRange method="fj.heatmap.method.expectedrange"  range="0 - 1000" /></PlateStatisticReference>
        <PlateStatisticReference path="Count" ><HeatmapRange method="fj.heatmap.method.expectedrange"  range="My Range" /></PlateStatisticReference>
      </Statistics>
    </PlateDisplayModel>
  </PlateDisplay>
</FigList>`;

describe('.wsp object figures: a FigList with all four types', () => {
  const cols: StatColumn[] = [{ id: 'col1', populationPath: 'Lymphocytes', stat: 'freqParent' }];
  const r = parse(FIG, cols);
  it('StatTable: NodeReference rows (control, group rows skipped), Anno / Key / Statistic columns, header and iteration flags', () => {
    expect(r.items[0]).toMatchObject({ left: 20, top: 30, width: 300, height: 64 });
    expect(objOf(r.items[0])).toEqual({
      kind: 'stattable', showHeader: false, iterate: true,
      rows: [{ sampleId: 's1', path: 'Lymphocytes' }, { sampleId: 's2', path: 'Lymphocytes/CD4+', control: true }],
      columns: [
        { type: 'anno', anno: 'POPNAMEWITHPATH' }, { type: 'keyword', name: '$FIL' },
        { type: 'stat', stat: { stat: 'median', channel: 'CD3' }, range: { min: 10, max: 500 } },
        { type: 'stat', stat: { stat: 'percentile', channel: 'CD4', percentile: 95 } },
        { type: 'stat', stat: { stat: 'freqOf', ancestor: 'Lymphocytes' } },
      ],
    });
    expect(r.warnings.join('\n')).toMatch(/group All Samples/);
    expect(r.warnings.join('\n')).toMatch(/column type Graph is not supported/);
  });
  it('DifferenceTable: the Model element with its Control sample', () => {
    expect(objOf(r.items[1])).toEqual({ kind: 'difftable', rows: [{ sampleId: 's1', path: 'Lymphocytes' }], columns: [{ type: 'anno', anno: 'SAMPLENAME' }, { type: 'stat', stat: { stat: 'freqParent' } }], controlSampleId: 's2' });
  });
  it('TETable: header StyledText row, SimpleFJML cells with fill, colour and style', () => {
    expect(objOf(r.items[2])).toEqual({
      kind: 'tetable', name: 'Table', header: ['', 'Count'],
      rows: [
        { cells: ['A1.fcs', '1200'], styles: [null, { background: '#ffff00', color: '#ff0000', bold: true }] },
        { cells: ['A2 & B.fcs', '800'], styles: [{ italic: true }, null] },
      ],
    });
  });
  it('PlateDisplay: group, display mode, statistics matched or added by node path, targets and ranges', () => {
    const o = objOf(r.items[3]);
    expect(o).toEqual({ kind: 'plate', model: { groupName: 'Plate 1', mode: 'CHERNOFF_FACE', stats: [
      { statId: 'col1', target: 'CHERNOFF_HEAD_SHAPE', method: 'AUTO' },
      { statId: 'col2', target: 'CHERNOFF_MOUTH_HEIGHT', method: 'EXPECTED_RANGE', range: { min: 0, max: 1000 } },
      { statId: 'col3', method: 'EXPECTED_RANGE' },
    ] } });
    expect(cols.slice(1)).toEqual([{ id: 'col2', populationPath: 'Lymphocytes', stat: 'median', channel: 'CD3' }, { id: 'col3', populationPath: '', stat: 'count' }]);
    expect(r.warnings.join('\n')).toMatch(/preference range "My Range"/);
  });
});

describe('.wsp object figures: round trips', () => {
  const back = (items: LayoutItem[], cols: StatColumn[] = []) => {
    const xml = writeFigList(items, [], sampleId, param, { statColumns: cols });
    const cols2 = cols.map((c) => ({ ...c }));
    return { xml, r: parseFigList(parseXml(xml).documentElement, sample, channel, { statColumns: cols2 }), cols2 };
  };
  const place = { left: 10, top: 20, width: 300, height: 80 };
  it('StatTable round trip', () => {
    const it0: LayoutObject = { id: 'a', ...place, object: { kind: 'stattable', showHeader: true, iterate: true, rows: [{ sampleId: 's1', path: '' }, { sampleId: 's2', path: 'Lymphocytes', control: true }], columns: [{ type: 'anno', anno: 'FULLGATEPATH' }, { type: 'keyword', name: 'WELL ID' }, { type: 'stat', stat: { stat: 'cv', channel: 'CD8' }, range: { min: -5, max: 2.5 } }, { type: 'stat', stat: { stat: 'correlation', channel: 'CD3', correlate: 'CD4' } }] } };
    const { xml, r } = back([it0]);
    expect(xml).toContain('<StatTable x="10"  y="20"  width="300"  height="80"');
    expect(xml).toContain('<StatTableModel showHeader="1"  enableContentIteration="1" >');
    expect(xml).toContain('<NodeReference rootID="2"  path="Lymphocytes"  control="1" />');
    expect(xml).toContain('<Statistic name="CV"  id="Comp-CD8"  expectedRange="-5 - 2.5" />');
    expect(xml).toContain('<Anno name="fj.anno.fullpath" />');
    expect(r.items[0]).toMatchObject(place);
    expect(objOf(r.items[0])).toEqual(it0.object);
  });
  it('DifferenceTable round trip', () => {
    const it0: LayoutObject = { id: 'b', ...place, object: { kind: 'difftable', rows: [{ sampleId: 's1', path: 'Lymphocytes' }], columns: [{ type: 'stat', stat: { stat: 'mean', channel: 'FSC-A' } }], controlSampleId: 's2' } };
    const { xml, r } = back([it0]);
    expect(xml).toMatch(/<DifferenceTable [^>]*><RowSizes>.*<Model showHeader="1"  enableContentIteration="0" >.*<Control sampleID="2" \/><\/Model><\/DifferenceTable>/);
    expect(objOf(r.items[0])).toEqual(it0.object);
  });
  it('TETable round trip', () => {
    const it0: LayoutObject = { id: 'c', ...place, object: { kind: 'tetable', name: 'My table', header: ['Sample', 'Count', 'Median : CD3'], rows: [{ cells: ['A1.fcs', '10', '<5'] }, { cells: ['A2.fcs', '20', '7'], styles: [null, { background: '#00ffff', color: '#ffffff', bold: true, italic: true }, null] }] } };
    const { xml, r } = back([it0]);
    expect(xml).toContain('<Cell row="2"  col="1" ><SimpleFJML');
    expect(xml).toContain('style="bold-italic"');
    expect(xml).toContain('<Content>&amp;lt;5</Content>');
    expect(objOf(r.items[0])).toEqual(it0.object);
  });
  it('TETable: rgb() backgrounds are written as hex; arrows are not in the format', () => {
    const it0: LayoutObject = { id: 'c', object: { kind: 'tetable', name: 'T', header: ['Sample', 'X'], rows: [{ cells: ['a', '1'], styles: [null, { background: 'rgb(255,255,0)', arrow: 'up' }] }] } };
    const { r } = back([it0]);
    expect(objOf(r.items[0])).toMatchObject({ rows: [{ styles: [null, { background: '#ffff00' }] }] });
  });
  it('PlateDisplay round trip (statistics by node path)', () => {
    const cols: StatColumn[] = [{ id: 'c1', populationPath: 'Lymphocytes', stat: 'percentile', channel: 'CD3', percentile: 50 }, { id: 'c2', populationPath: 'Lymphocytes/CD4+', stat: 'freqOf', ancestor: 'Lymphocytes' }];
    const it0: LayoutObject = { id: 'd', ...place, object: { kind: 'plate', model: { groupName: 'G', mode: 'HEATMAP', showSampleName: true, stats: [{ statId: 'c1', target: 'HEATMAP1', method: 'AUTO' }, { statId: 'c2', target: 'HEATMAP2', method: 'EXPECTED_RANGE', range: { min: 1, max: 9 } }] } } };
    const { xml, r, cols2 } = back([it0], cols);
    expect(xml).toContain('<PlateStatisticReference path="Lymphocytes/Percentile (50.0) : Comp-CD3"  displayTarget="le.plate.display.comp.heatmap1" ><HeatmapRange method="fj.heatmap.method.auto" /></PlateStatisticReference>');
    expect(xml).toContain('path="Lymphocytes/CD4+/Freq. of Lymphocytes"');
    expect(xml).toContain('displayMode="le.plate.display.mode.heatmap"');
    expect(objOf(r.items[0])).toEqual(it0.object);
    expect(cols2.length).toBe(2);
  });
  it('statistic node names and range names', () => {
    expect(statNodeName({ stat: 'correlation', channel: 'CD3', correlate: 'CD4' }, (c) => `Comp-${c}`)).toBe('Correlation : Comp-CD3 / Comp-CD4');
    expect(statNodeName({ stat: 'percentile', channel: 'X', percentile: 2.5 }, (c) => c)).toBe('Percentile (2.5) : X');
    expect(parseRangeName(rangeName({ min: -1e-3, max: 7 }))).toEqual({ min: -1e-3, max: 7 });
    expect(parseRangeName('Normal')).toBeUndefined();
  });
  it('a workspace keeps its object figures through .wsp export and import', () => {
    const ws = emptyWorkspace();
    ws.samples.push({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [{ id: 'p', name: 'Lymph', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'FSC-A', transform: { kind: 'linear', T: 262144, A: 0 } }, { kind: 'channel', channel: 'SSC-A', transform: { kind: 'linear', T: 262144, A: 0 } }], min: [1, 1], max: [100, 100] } }], keywordsSnapshot: {}, channelNames: ['FSC-A', 'SSC-A'], eventCount: 1 });
    ws.groups[0].sampleIds = ['s'];
    ws.statColumns = [{ id: 'col1', populationPath: 'Lymph', stat: 'median', channel: 'FSC-A' }];
    ws.layout = [
      { id: 'o1', left: 10, top: 10, width: 200, height: 50, object: { kind: 'stattable', showHeader: true, rows: [{ sampleId: 's', path: 'Lymph' }], columns: [{ type: 'stat', stat: { stat: 'median', channel: 'FSC-A' } }] } },
      { id: 'o2', left: 10, top: 100, width: 300, height: 200, object: { kind: 'plate', model: { groupName: 'All Samples', stats: [{ statId: 'col1', target: 'HEATMAP1', method: 'AUTO' }] } } },
    ];
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    const backWs = parseWsp(xml).workspace;
    const objs = (backWs.layout ?? []).map(objOf);
    expect(objs[0]).toEqual({ kind: 'stattable', showHeader: true, rows: [{ sampleId: 's1', path: 'Lymph' }], columns: [{ type: 'stat', stat: { stat: 'median', channel: 'FSC-A' } }] });
    const st = objs[1] as Extract<typeof objs[1], { kind: 'plate' }>;
    const col = backWs.statColumns.find((c) => c.id === st.model.stats[0].statId);
    expect(col).toMatchObject({ populationPath: 'Lymph', stat: 'median', channel: 'FSC-A' });
  });
});

describe('.wsp chart flags (re-audit fixes)', () => {
  const chart = (extra: Partial<LayoutPlot>): LayoutPlot => ({ id: 'g', populationPath: 'Lymphocytes', sampleId: 's1', x: 'CD3', y: 'CD4', kind: 'dot', left: 30, top: 40, width: 308, height: 281, overlays: ['Lymphocytes/CD4+', 'Lymphocytes/CD8+'], ...extra });
  const rt = (it: LayoutPlot) => { const xml = writeFigList([it], [], sampleId, param); return { xml, c: parseFigList(parseXml(xml).documentElement, sample, channel).items[0] as LayoutPlot }; };
  it('a vertical ancestry (BACKGATINGVERT) is written as horizontal="0" and read back, with the backgating display flags', () => {
    const { xml, c } = rt(chart({ ancestry: true, backgating: true, ancestryVertical: true, backgateLarge: true, backgateContours: true }));
    expect(xml).toContain('horizontal="0"  backgatingLargeDots="1"  backgatingContours="1"');
    expect(c).toMatchObject({ ancestry: true, backgating: true, ancestryVertical: true, backgateLarge: true, backgateContours: true });
    expect(rt(chart({ ancestry: true })).c.ancestryVertical).toBeUndefined();
  });
  it('Set As Control is written as LegendSpec control="1" on that overlay and read back', () => {
    const { xml, c } = rt(chart({ controls: ['Lymphocytes/CD8+'] }));
    expect(xml.match(/control="1"/g)?.length).toBe(1);
    expect(c.controls).toEqual(['Lymphocytes/CD8+']);
  });
  it('multigraph types use FigChartGrid$GridType names (HISTOS, NXN, HALFNXN, ALLBY, SLINKY) and the N x N display type', () => {
    for (const [m, t] of [['histograms', 'HISTOS'], ['nxn', 'NXN'], ['halfnxn', 'HALFNXN'], ['allby', 'ALLBY'], ['slinky', 'SLINKY']] as const) {
      const { xml, c } = rt(chart({ multigraph: m, multiParams: ['CD3', 'CD4'], multiKind: 'contour' }));
      expect(xml).toContain(`type="${t}"`);
      expect(c).toMatchObject({ multigraph: m, multiParams: ['CD3', 'CD4'] });
      if (m === 'nxn') { expect(xml).toContain('displayType="Contour"'); expect(c.multiKind).toBe('contour'); }
    }
    const legacy = `<FigList><ChartData x="0" y="0" width="10" height="10" path="" sampleID="1"><Graph type="Dot"><Axis dimension="x" name="FSC-A"/><Axis dimension="y" name="SSC-A"/></Graph><Multigraph type="le.chart.half.nxn" displayType="DotPlot"><WindowPosition displayed="1" width="0"/><Parameters><Parameter name="FSC-A"/></Parameters></Multigraph></ChartData></FigList>`;
    expect(parseFigList(parseXml(legacy).documentElement, sample, channel).items[0]).toMatchObject({ multigraph: 'halfnxn', multiKind: 'dot' });
  });
});

describe('batch output targets (Batch$BatchDestination)', () => {
  it('Layout: a new current layout named after the batch, iteration off, the old one kept', () => {
    const ws = emptyWorkspace();
    ws.layout = [{ id: 't', text: 'x' }];
    ws.layoutIteration = { type: 'SAMPLE' };
    ws.layoutGroup = 'G';
    const p = batchLayoutPatch(ws, 'Layout', [{ id: 'n', text: 'y' }]);
    expect(p).toMatchObject({ layoutName: 'Layout-1', layout: [{ id: 'n', text: 'y' }], layoutIteration: { type: 'OFF' }, layoutGroup: 'G' });
    expect(p.otherLayouts?.[0]).toMatchObject({ name: 'Layout', layoutIteration: { type: 'SAMPLE' } });
  });
  it('Web: title, h2, one image per tile named index.sample, footer', () => {
    expect(webImageName(3, 'a/b\\c:d.fcs')).toBe('3.a_b_c_d.fcs');
    const html = webPageHtml('batch', [{ name: '0.A1', src: 'data:image/png;base64,AA' }], 'flowjo-rea', new Date(2026, 0, 2, 3, 4, 5));
    expect(html).toMatch(/<title>\nbatch<\/title>\n<body><p>\n<h2>batch<\/h2>\n<hr><p>\n<IMG src="data:image\/png;base64,AA"/);
    expect(html).toContain('This page was created by flowjo-rea<BR>');
  });
  it('PowerPoint: one slide per tile, picture scaled by (int) min(9000000 / w, 6750000 / h)', () => {
    expect(pptxScale(600, 400)).toBe(15000);
    const z = readZip(pptxFromImages([{ png: new Uint8Array([137, 80, 78, 71]), w: 600, h: 400 }, { png: new Uint8Array([1]), w: 100, h: 100 }]));
    const names = z.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/media/image2.png', 'ppt/theme/theme1.xml']));
    const s1 = new TextDecoder().decode(z.find((e) => e.name === 'ppt/slides/slide1.xml')!.data);
    expect(s1).toContain('<a:ext cx="9000000" cy="6000000"/>');
  });
});
