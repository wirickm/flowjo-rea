import { describe, expect, it } from 'vitest';
import { boxToFrame, frameToBox, parseFigList, writeFigList } from '../src/core/wspLayout';
import { parseXml } from '../src/core/xml';
import { emptyWorkspace, isPlotItem, type LayoutItem } from '../src/core/model';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';

// A FigList as decoded from FlowJo 10.6.2's writers (docs: specs 25.4).
const FIG = `<FigList>
  <ChartData x="72"  y="90"  width="160"  height="160"  dependents="1"  showAdjunctHistograms="1"  path="Lymphocytes/Single Cells"  sampleID="3"  scaleH="0.625"  scaleV="0.625"  z="0" >
    <Graph type="Pseudocolor" >
      <Axis dimension="x"  name="Comp-CD3"  auto="auto" />
      <Axis dimension="y"  name="Comp-CD4"  auto="auto" />
      <GraphSettings drawLargeDots="0"  showOutliers="0" />
      <GraphEnvironment showGrid="1"  showAxes="tnl"  showGates="1"  showFreqOnPlots="0"  showGateNameOnPlots="1" />
    </Graph>
    <Annotation><Content></Content><WindowPosition x="0"  y="-18"  width="160"  height="16"  displayed="1" /></Annotation>
    <Ancestry backgating="1"  horizontal="1" ><WindowPosition x="0"  y="200"  width="160"  height="80"  displayed="1" /></Ancestry>
    <Multigraph type="NONE" ><WindowPosition x="0"  y="0"  width="0"  height="0"  displayed="0" /><Parameters/></Multigraph>
    <PopModelList>
      <DataLayer path="Lymphocytes/Single Cells"  sampleID="3" ><LegendSpec control="0" /></DataLayer>
      <DataLayer path="Lymphocytes/Single Cells/CD4+"  sampleID="3" ><LegendSpec control="0" /></DataLayer>
    </PopModelList>
    <WindowPosition x="72"  y="90"  width="160"  height="160"  displayed="1" />
  </ChartData>
  <StyledText x="300"  y="96"  width="180"  height="24" >
    <Content>&amp;lt;html&amp;gt;&amp;lt;head&amp;gt;&amp;lt;/head&amp;gt;&amp;lt;body&amp;gt;&amp;lt;p&amp;gt;&amp;lt;b&amp;gt;CD4 T cells&amp;lt;/b&amp;gt;: &amp;lt;input type=&amp;quot;fjml&amp;quot; value=&amp;quot;%3CStatistic+path%3D%22Lymphocytes%2FCD4%2B%22+name%3D%22Freq.+of+Parent%22%2F%3E&amp;quot;&amp;gt;&amp;lt;/p&amp;gt;&amp;lt;/body&amp;gt;&amp;lt;/html&amp;gt;</Content>
  </StyledText>
  <FigList x="0"  y="400"  width="10"  height="10" >
    <StyledText x="10"  y="400"  width="80"  height="20" ><Content>&amp;lt;html&amp;gt;&amp;lt;body&amp;gt;A&amp;lt;/body&amp;gt;&amp;lt;/html&amp;gt;</Content></StyledText>
    <StyledText x="100"  y="400"  width="80"  height="20" ><Content>&amp;lt;html&amp;gt;&amp;lt;body&amp;gt;B&amp;lt;/body&amp;gt;&amp;lt;/html&amp;gt;</Content></StyledText>
  </FigList>
  <GridLayout x="40"  y="500"  width="400"  height="200"  rows="1"  columns="2"  drawGrid="1" >
    <RowSizes><Size index="0"  value="200" /></RowSizes>
    <ColSizes><Size index="0"  value="200" /><Size index="1"  value="200" /></ColSizes>
    <Content><Cell row="0"  col="1" ><ChartData x="0"  y="0"  width="160"  height="160"  path=""  sampleID="3"  scaleH="0.625"  scaleV="0.625" ><Graph type="Histogram" ><Axis dimension="x"  name="FSC-A" /></Graph><PopModelList><DataLayer path=""  sampleID="3" /></PopModelList></ChartData></Cell></Content>
    <Labels><Row index="0"  column="1" /><Column index="1"  row="0" /></Labels>
  </GridLayout>
  <Image url="logo.png"  x="0"  y="0"  width="10"  height="10" />
  <StatTable x="0"  y="0"  width="10"  height="10" />
</FigList>`;

const strip = (n: string) => n.replace(/^Comp-/, '');

describe('.wsp layout figures (specs 25.4)', () => {
  const r = parseFigList(parseXml(FIG).documentElement, (sid) => (sid === '3' ? 's3' : undefined), (_sid, n) => strip(n));
  it('a ChartData becomes a graph of its sample and population, sized from scaleH / scaleV, with its flags and overlays', () => {
    const c = r.items[0] as Extract<LayoutItem, { kind: string }>;
    expect(c).toMatchObject({ sampleId: 's3', populationPath: 'Lymphocytes/Single Cells', x: 'CD3', y: 'CD4', kind: 'pseudocolor', overlays: ['Lymphocytes/Single Cells/CD4+'], gateFreq: false, axes: 'tnl', grid: true, adjunct: true, ancestry: true, backgating: true, showAnnotation: true });
    expect(boxToFrame({ left: c.left!, top: c.top!, width: c.width!, height: c.height! })).toEqual({ x: 72, y: 90, w: 160, h: 160 });
  });
  it('StyledText content is unescaped twice and FJML statistics become {name: path}', () => {
    expect(r.items[1]).toMatchObject({ text: 'CD4 T cells: {Freq. of Parent: Lymphocytes/CD4+}', left: 300, top: 96 });
  });
  it('a nested FigList is a group; a GridLayout is a grid with its cells', () => {
    expect(r.items[2].groupId).toBeDefined();
    expect(r.items[2].groupId).toBe(r.items[3].groupId);
    expect(r.grids[0]).toMatchObject({ rows: 1, cols: 2, x: 40, y: 500, cellW: 192, cellH: 192 });
    expect(r.items[4]).toMatchObject({ kind: 'histogram', cell: { row: 0, col: 1 } });
  });
  it('unsupported figures are reported', () => {
    expect(r.warnings.join('\n')).toMatch(/StatTable \(1\) is not supported/);
    expect(r.items.length).toBe(6);
  });
  it('an Image figure is imported with its URL (Insert Graphic)', () => {
    expect(r.items[5]).toMatchObject({ image: 'logo.png', left: 0, top: 0, width: 10, height: 10 });
    expect(r.warnings.join('\n')).not.toMatch(/Image/);
  });
  it('writes the figures back so they read the same', () => {
    const xml = writeFigList(r.items, r.grids, (id) => (id === 's3' ? '3' : '1'), (_id, ch) => (ch.startsWith('CD') ? `Comp-${ch}` : ch));
    expect(xml).toContain('<ChartData x="72"  y="90"  width="160"  height="160"');
    expect(xml).toContain('scaleH="0.625"');
    expect(xml).toContain('&amp;lt;html&amp;gt;');
    const back = parseFigList(parseXml(xml).documentElement, (sid) => (sid === '3' ? 's3' : undefined), (_sid, n) => strip(n));
    const pick = (it: LayoutItem) => (it.text !== undefined ? { text: it.text, left: it.left } : !isPlotItem(it) ? { left: it.left } : { path: it.populationPath, x: it.x, y: it.y, kind: it.kind, left: it.left, top: it.top, cell: it.cell ? `${it.cell.row},${it.cell.col}` : '' });
    expect(back.items.map(pick)).toEqual(r.items.map(pick));
    expect(back.grids[0]).toMatchObject({ rows: 1, cols: 2, cellW: 192 });
  });
  it('frame and box geometry are inverses', () => {
    const b = frameToBox({ x: 100, y: 50, w: 256, h: 256 });
    expect(boxToFrame(b)).toEqual({ x: 100, y: 50, w: 256, h: 256 });
  });
  it('a whole workspace keeps its layout through .wsp export and import', () => {
    const ws = emptyWorkspace();
    ws.samples.push({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [{ id: 'p', name: 'Lymph', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'FSC-A', transform: { kind: 'linear', T: 262144, A: 0 } }, { kind: 'channel', channel: 'SSC-A', transform: { kind: 'linear', T: 262144, A: 0 } }], min: [1, 1], max: [100, 100] } }], keywordsSnapshot: {}, channelNames: ['FSC-A', 'SSC-A'], eventCount: 1 });
    ws.groups[0].sampleIds = ['s'];
    ws.layoutPage = { paper: 'letter', orientation: 'landscape' };
    ws.layoutIteration = { type: 'SAMPLE' };
    ws.layout = [{ id: 'g1', populationPath: 'Lymph', sampleId: 's', x: 'FSC-A', y: 'SSC-A', kind: 'dot', left: 30, top: 40, width: 308, height: 281 }, { id: 't1', text: 'Figure 1', left: 400, top: 40, width: 200, height: 40 }];
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    const back = parseWsp(xml).workspace;
    expect(back.layoutPage).toEqual({ paper: 'letter', orientation: 'landscape' });
    expect(back.layoutIteration).toEqual({ type: 'SAMPLE' });
    expect(back.layout?.map((it) => (it.text !== undefined ? it.text : !isPlotItem(it) ? '' : `${it.populationPath}|${it.kind}|${it.sampleId}`))).toEqual(['Lymph|dot|s1', 'Figure 1']);
  });
});
