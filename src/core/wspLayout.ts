// FlowJo 10.6.2 layout figures in a .wsp (<Layout>/<FigList>; specs 25.4):
// read and written from the format decoded from FlowJo's figure writers and
// readers (FigFactory.makeFig, Fig.getElement / setElementSelf,
// LEChartController.setElement, ChartAttributes.extract / install,
// FigStyledText, FigGroup, FigGridLayout). No fixture holds figures, so this
// is checked against the decoded format, not against FlowJo-saved files.
import type { CellRef, GridDef } from './layoutArrange';
import type { LayoutItem, LayoutPlot, PlotSettings } from './model';
import { attr, esc, kid, kids, local, type El } from './xml';

// The app's graph canvas around the plot frame (renderPlot PLOT); FlowJo's
// x / y / width / height of a chart are the plot frame's (256 pt x scale).
export const GRAPH_GEOM = { w: 460, h: 420, ml: 64, mr: 14, mt: 14, mb: 48 };
const PW = GRAPH_GEOM.w - GRAPH_GEOM.ml - GRAPH_GEOM.mr, PH = GRAPH_GEOM.h - GRAPH_GEOM.mt - GRAPH_GEOM.mb;
export const frameToBox = (f: { x: number; y: number; w: number; h: number }) => ({
  left: Math.round(f.x - (f.w * GRAPH_GEOM.ml) / PW), top: Math.round(f.y - (f.h * GRAPH_GEOM.mt) / PH),
  width: Math.round((f.w * GRAPH_GEOM.w) / PW), height: Math.round((f.h * GRAPH_GEOM.h) / PH),
});
export const boxToFrame = (b: { left: number; top: number; width: number; height: number }) => {
  const w = (b.width * PW) / GRAPH_GEOM.w, h = (b.height * PH) / GRAPH_GEOM.h;
  return { x: Math.round(b.left + (w * GRAPH_GEOM.ml) / PW), y: Math.round(b.top + (h * GRAPH_GEOM.mt) / PH), w: Math.round(w), h: Math.round(h) };
};

const KIND: Record<string, PlotSettings['kind']> = { Pseudocolor: 'pseudocolor', Dot: 'dot', Contour: 'contour', Histogram: 'histogram', Density: 'density', Zebra: 'zebra' };
const TYPE: Record<PlotSettings['kind'], string> = { pseudocolor: 'Pseudocolor', dot: 'Dot', contour: 'Contour', histogram: 'Histogram', density: 'Density', zebra: 'Zebra' };
const bool = (e: El, n: string, d = false) => { const v = attr(e, n); return v === undefined ? d : v === '1' || v === 'true'; };
const num = (e: El, n: string, d = 0) => { const v = Number(attr(e, n)); return Number.isFinite(v) && attr(e, n) !== undefined ? v : d; };
// Population paths: node names joined with "/" (a "/" inside a name is written "_").
const pathIn = (p: string) => p;
const pathOut = (p: string) => p;

export interface FigImport { items: LayoutItem[]; grids: GridDef[]; warnings: string[] }
// sample: FlowJo sampleID -> app sample id; channel: (FlowJo sampleID, FlowJo parameter name) -> app channel.
export function parseFigList(figList: El, sample: (wspId: string) => string | undefined, channel: (wspId: string, name: string) => string): FigImport {
  const items: LayoutItem[] = [], grids: GridDef[] = [], warnings: string[] = [];
  let seq = 0;
  const id = (p: string) => `${p}_wsp${++seq}`;
  const skipped = new Map<string, number>();
  const rect = (e: El) => ({ x: num(e, 'x'), y: num(e, 'y'), w: num(e, 'width'), h: num(e, 'height') });

  const chart = (e: El): LayoutPlot | null => {
    const layers = kids(kid(e, 'PopModelList') ?? e, 'DataLayer');
    const base = layers[0];
    const wspId = (base && attr(base, 'sampleID')) || attr(e, 'sampleID') || '';
    const g = kid(e, 'Graph');
    const axes = g ? kids(g, 'Axis') : [];
    const ax = (d: string) => { const a = axes.find((x) => attr(x, 'dimension') === d); return a && attr(a, 'name') ? channel(wspId, attr(a, 'name')!) : null; };
    const xName = ax('x');
    if (!g || !xName) { warnings.push('Layout chart without a graph definition; skipped'); return null; }
    const kind = KIND[attr(g, 'type') ?? ''] ?? 'pseudocolor';
    // Size: scaleH / scaleV x 256 (a value over 50 is a percent); position from the
    // final WindowPosition when present, else x / y.
    const sc = (n: string) => { const v = num(e, n, 1); return v > 50 ? v / 100 : v; };
    const wp = kids(e, 'WindowPosition').pop();
    const pos = wp && num(wp, 'width') > 0 ? rect(wp) : rect(e);
    const frame = { x: pos.x, y: pos.y, w: Math.round(256 * sc('scaleH')), h: Math.round(256 * sc('scaleV')) };
    const env = kid(g, 'GraphEnvironment'), set = kid(g, 'GraphSettings');
    const anc = kid(e, 'Ancestry'), mg = kid(e, 'Multigraph'), ann = kid(e, 'Annotation');
    const shown = (el: El | undefined) => !!el && !!kid(el, 'WindowPosition') && bool(kid(el, 'WindowPosition')!, 'displayed');
    const mgType = mg ? (attr(mg, 'type') ?? 'NONE').toUpperCase() : 'NONE';
    const mgParams = mg && kid(mg, 'Parameters') ? kids(kid(mg, 'Parameters')!).map((p) => attr(p, 'name') ?? (p.textContent ?? '').trim()).filter(Boolean) : [];
    const appSample = sample(wspId);
    if (!appSample) warnings.push(`Layout chart for FlowJo sample ${wspId || '?'} that is not in the workspace; it follows the chosen sample`);
    return {
      id: id('lay'), populationPath: pathIn(attr(base ?? e, 'path') ?? ''), sampleId: appSample, x: xName, y: kind === 'histogram' ? null : ax('y'), kind,
      ...frameToBox(frame),
      ...(layers.length > 1 ? { overlays: layers.slice(1).map((l) => pathIn(attr(l, 'path') ?? '')) } : {}),
      ...(env && !bool(env, 'showGates', true) ? { showGates: false } : {}),
      ...(env && !bool(env, 'showFreqOnPlots', true) ? { gateFreq: false } : {}),
      ...(env && !bool(env, 'showGateNameOnPlots', true) ? { gateNames: false } : {}),
      ...(env && attr(env, 'showAxes') && attr(env, 'showAxes') !== 'tnlTNL' ? { axes: attr(env, 'showAxes') === 'o' ? '' : attr(env, 'showAxes')!.replace('H', '') } : {}),
      ...(env && bool(env, 'showGrid') ? { grid: true } : {}),
      ...((env && bool(env, 'showMedians')) || bool(e, 'showMedians') ? { medians: true } : {}),
      ...(set && bool(set, 'drawLargeDots') ? { largeDots: true } : {}),
      ...(set && bool(set, 'showOutliers') ? { showOutliers: true } : {}),
      ...(bool(e, 'showAdjunctHistograms') ? { adjunct: true } : {}),
      ...(shown(anc) ? { ancestry: true, ...(bool(anc!, 'backgating') ? { backgating: true } : {}) } : {}),
      ...(mgType === 'NXN' || mgType === 'HISTOGRAMS' || mgType === 'HISTOGRAM' ? { multigraph: mgType === 'NXN' ? 'nxn' as const : 'histograms' as const, multiParams: mgParams.map((n) => channel(wspId, n)).slice(0, 10) } : {}),
      ...(shown(ann) ? { showAnnotation: true } : {}),
    };
  };

  // StyledText: <Content> holds Swing HTML escaped twice on disk; the XML parser
  // undoes one level, this undoes the other; FJML statistics become "{name: path}".
  const text = (e: El): LayoutItem => {
    const raw = kid(e, 'Content')?.textContent ?? attr(e, 'text') ?? '';
    const html = unescapeXml(raw);
    const withStats = html.replace(/<input[^>]*type="fjml"[^>]*value="([^"]*)"[^>]*>/gi, (_m, v: string) => {
      const x = decodeURIComponent(v.replace(/\+/g, ' '));
      const name = /name="([^"]*)"/.exec(x)?.[1] ?? 'value', path = /path="([^"]*)"/.exec(x)?.[1] ?? '';
      return `{${name}${path ? `: ${unescapeXml(path)}` : ''}}`;
    });
    const plain = unescapeXml(withStats.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')).split('\n').map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n').trim();
    const r = rect(e);
    return { id: id('txt'), text: plain, left: r.x, top: r.y, width: Math.max(20, r.w), height: Math.max(14, r.h) };
  };

  const walk = (parent: El, groupId?: string) => {
    for (const e of kids(parent)) {
      const k = local(e);
      if (k === 'ChartData' || k === 'Chart') { const c = chart(e); if (c) items.push({ ...c, ...(groupId ? { groupId } : {}) }); }
      else if (k === 'StyledText' || k === 'SimpleText') items.push({ ...text(e), ...(groupId ? { groupId } : {}) } as LayoutItem);
      else if (k === 'FigList' || k === 'Group') walk(e, groupId ?? id('grp'));
      else if (k === 'GridLayout') {
        const r = rect(e), rows = Math.max(1, num(e, 'rows', 3)), cols = Math.max(1, num(e, 'columns', 4));
        const sizes = (n: string) => kids(kid(e, n) ?? e, 'Size').map((s) => Math.max(15, num(s, 'value')));
        const rh = sizes('RowSizes'), cw = sizes('ColSizes');
        const pad = 4; // not saved by FlowJo (FigBaseGrid.setCellPadding)
        const gd: GridDef = { id: id('grid'), x: r.x, y: r.y, rows, cols, pad, cellW: Math.max(20, (cw.length ? Math.max(...cw) : r.w / cols) - 2 * pad), cellH: Math.max(20, (rh.length ? Math.max(...rh) : r.h / rows) - 2 * pad), bare: true };
        grids.push(gd);
        for (const cell of kids(kid(e, 'Content') ?? e, 'Cell')) {
          const row = num(cell, 'row'), col = num(cell, 'col');
          if (row >= rows || col >= cols) continue;
          const fig = kids(cell)[0];
          if (!fig) continue;
          const one = local(fig) === 'StyledText' ? text(fig) : chart(fig);
          if (one) items.push({ ...one, groupId: gd.id, cell: { grid: gd.id, row, col } } as LayoutItem);
        }
      } else skipped.set(k, (skipped.get(k) ?? 0) + 1);
    }
  };
  walk(figList);
  for (const [k, n] of skipped) warnings.push(`Layout figure type ${k} (${n}) is not supported; skipped`);
  return { items, grids, warnings };
}

export function unescapeXml(s: string): string {
  return s.replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Writes the items as a <FigList>; sampleId: app sample id -> FlowJo sampleID;
// param: (app sample id, app channel) -> FlowJo parameter name.
export function writeFigList(items: LayoutItem[], grids: GridDef[], sampleId: (appId: string | undefined) => string, param: (appId: string | undefined, ch: string) => string): string {
  const b = (v: boolean) => (v ? '1' : '0');
  const chartXml = (it: LayoutPlot, abs = true) => {
    const f = boxToFrame({ left: it.left ?? 0, top: it.top ?? 0, width: it.width ?? GRAPH_GEOM.w * (256 / PW), height: it.height ?? GRAPH_GEOM.h * (256 / PW) });
    const sid = sampleId(it.sampleId);
    const p = (ch: string) => esc(param(it.sampleId, ch));
    const env = `<GraphEnvironment showGrid="${b(!!it.grid)}"  showAxes="${esc(it.axes === undefined ? 'tnlTNL' : it.axes || 'o')}"  showGates="${b(it.showGates !== false)}"  showFreqOnPlots="${b(it.gateFreq !== false && !it.hideGateFreq)}"  showGateNameOnPlots="${b(it.gateNames !== false && !it.hideGateNames)}"  showMedians="${b(!!it.medians)}" />`;
    const graph = `<Graph type="${TYPE[it.kind]}" ><Axis dimension="x"  name="${p(it.x)}"  auto="auto" />${it.y && it.kind !== 'histogram' ? `<Axis dimension="y"  name="${p(it.y)}"  auto="auto" />` : ''}<GraphSettings showOutliers="${b(!!it.showOutliers)}"  drawLargeDots="${b(!!it.largeDots)}" />${env}</Graph>`;
    const dep = (name: string, on: boolean, extra = '', inner = '') => `<${name}${extra}><WindowPosition x="0"  y="0"  width="0"  height="0"  displayed="${b(on)}" />${inner}</${name}>`;
    const layers = [it.populationPath, ...(it.overlays ?? [])].map((path, k) => `<DataLayer path="${esc(pathOut(path))}"  panelValue="0"  discriminatorValue=""  sampleID="${sid}" ><LegendSpec text=""  control="0"${k ? ' color="#ff0000"' : ''} /></DataLayer>`).join('');
    const mgType = it.multigraph === 'nxn' ? 'NXN' : it.multigraph === 'histograms' ? 'HISTOGRAMS' : 'NONE';
    return `<ChartData x="${f.x}"  y="${f.y}"  width="${f.w}"  height="${f.h}"  dependents="1"  showAdjunctHistograms="${b(!!it.adjunct)}"  path="${esc(pathOut(it.populationPath))}"  sampleID="${sid}"  scaleH="${+(f.w / 256).toFixed(10)}"  scaleV="${+(f.h / 256).toFixed(10)}" >${graph}`
      + dep('Annotation', !!it.showAnnotation)
      + dep('Ancestry', !!it.ancestry, `  backgating="${b(!!it.backgating)}"  horizontal="1"`)
      + dep('Multigraph', !!it.multigraph, `  type="${mgType}"`, `<Parameters>${(it.multiParams ?? []).map((n) => `<Parameter name="${p(n)}" />`).join('')}</Parameters>`)
      + `<PopModelList>${layers}</PopModelList>${abs ? `<WindowPosition x="${f.x}"  y="${f.y}"  width="${f.w}"  height="${f.h}"  displayed="1" />` : ''}</ChartData>`;
  };
  const textXml = (it: Extract<LayoutItem, { text: string }>) => {
    const html = `<html><head></head><body>${it.text.split('\n').map((l) => `<p style="margin-top: 0">${esc(l)}</p>`).join('')}</body></html>`;
    // Escaped once for the HTML-in-text and once more by the workspace writer.
    return `<StyledText x="${it.left ?? 0}"  y="${it.top ?? 0}"  width="${it.width ?? 216}"  height="${it.height ?? 72}"  lineWeight="NoLine"  autoFitContents="0"  autoMinimumSize="1"  padding="2,2,2,2" ><Content>${esc(esc(html))}</Content></StyledText>`;
  };
  const one = (it: LayoutItem) => (it.text !== undefined ? textXml(it) : chartXml(it));
  const out: string[] = [];
  const doneGroups = new Set<string>();
  for (const it of items) {
    if (it.cell) {
      const g = grids.find((x) => x.id === it.cell!.grid);
      if (!g || doneGroups.has(g.id)) continue;
      doneGroups.add(g.id);
      const cells = items.filter((x) => x.cell?.grid === g.id);
      const size = (n: number, v: number) => Array.from({ length: n }, (_, k) => `<Size index="${k}"  value="${v + 2 * g.pad}" />`).join('');
      const cellRefs: CellRef[] = cells.map((c) => ({ id: c.id, ...c.cell! }));
      const lastRow = (col: number) => Math.max(...cellRefs.filter((c) => c.col === col).map((c) => c.row));
      const firstCol = (row: number) => Math.min(...cellRefs.filter((c) => c.row === row).map((c) => c.col));
      const labels = g.bare ? [...new Set(cellRefs.map((c) => c.row))].map((r) => `<Row index="${r}"  column="${firstCol(r)}" />`).join('') + [...new Set(cellRefs.map((c) => c.col))].map((c) => `<Column index="${c}"  row="${lastRow(c)}" />`).join('') : '';
      out.push(`<GridLayout x="${g.x}"  y="${g.y}"  width="${g.cols * (g.cellW + 2 * g.pad)}"  height="${g.rows * (g.cellH + 2 * g.pad)}"  rows="${g.rows}"  columns="${g.cols}"  drawGrid="1"  autoFitContents="0" ><RowSizes>${size(g.rows, g.cellH)}</RowSizes><ColSizes>${size(g.cols, g.cellW)}</ColSizes><Content>${cells.map((c) => `<Cell row="${c.cell!.row}"  col="${c.cell!.col}" >${one(c)}</Cell>`).join('')}</Content><Labels>${labels}</Labels></GridLayout>`);
    } else if (it.groupId) {
      if (doneGroups.has(it.groupId)) continue;
      doneGroups.add(it.groupId);
      const members = items.filter((x) => x.groupId === it.groupId && !x.cell);
      out.push(`<FigList>${members.map(one).join('')}</FigList>`);
    } else out.push(one(it));
  }
  return `<FigList>${out.join('')}</FigList>`;
}
