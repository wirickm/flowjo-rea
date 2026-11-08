// FlowJo 10.6.2 layout figures in a .wsp (<Layout>/<FigList>; specs 25.4):
// read and written from the format decoded from FlowJo's figure writers and
// readers (FigFactory.makeFig, Fig.getElement / setElementSelf,
// LEChartController.setElement, ChartAttributes.extract / install,
// FigStyledText, FigGroup, FigGridLayout; the object figures StatTable,
// DifferenceTable, TETable and PlateDisplay from FigStatTable, StatTableModel,
// NodeReference, Statistic, FigDifferenceTable, DifferenceTableModel,
// FigTableDisplay, FigPlateDisplay, PlateDisplayModel, PlateDisplayStatistic,
// HeatmapRange; docs/validation/flowjo-figlist-format.md). No fixture holds
// figures, so this is checked against the decoded format, not against
// FlowJo-saved files.
import type { CellRef, GridDef } from './layoutArrange';
import { isPlotItem, type LayoutItem, type LayoutObject, type LayoutPlot, type LayoutShape, type LayoutText, type PlotSettings, type StatColumn, type StatKind } from './model';
import { tableGeometry, type AnnoColumn, type LayoutObjectSpec, type StatTableColumn, type TableRowRef, type TableStat } from './layoutTables';
import { TARGETS, type DisplayTarget, type PlateStat } from './layoutPlate';
import type { CellStyle } from './tableEditor';
import { FLOWJO_STAT_NAMES, STAT_NEEDS_CHANNEL } from './stats';
import { GRADIENTS, LINE_STYLES, LINE_WEIGHTS, type FigStyle, type GradientType, type LineStyle, type LineWeight } from './layoutFigures';
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
// FigChartGrid$GridType: written as the enum name; read ignoring case, also
// as the command key (le.chart.*) or a legacy label (fromFCML). HISTOGRAMS is
// what earlier versions of this app wrote.
type MG = NonNullable<LayoutPlot['multigraph']>;
const MG_OUT: Record<MG, string> = { histograms: 'HISTOS', nxn: 'NXN', halfnxn: 'HALFNXN', allby: 'ALLBY', slinky: 'SLINKY' };
const MG_TYPES: Record<string, MG> = { histos: 'histograms', histograms: 'histograms', histogram: 'histograms', 'le.chart.histograms': 'histograms', 'show all histograms': 'histograms', nxn: 'nxn', 'le.chart.nxn': 'nxn', halfnxn: 'halfnxn', 'le.chart.half.nxn': 'halfnxn', allby: 'allby', 'le.chart.allby': 'allby', slinky: 'slinky', 'le.chart.slinky': 'slinky' };
// Multigraph@displayType (DisplayType.toString / fromString) for the N x N plot kind.
const MG_KIND: Record<string, 'pseudocolor' | 'dot' | 'contour'> = { pseudocolor: 'pseudocolor', dotplot: 'dot', contour: 'contour' };
const MG_KIND_OUT: Record<'pseudocolor' | 'dot' | 'contour', string> = { pseudocolor: 'Pseudocolor', dot: 'Dot Plot', contour: 'Contour' };
const bool = (e: El, n: string, d = false) => { const v = attr(e, n); return v === undefined ? d : v === '1' || v === 'true'; };
const num = (e: El, n: string, d = 0) => { const v = Number(attr(e, n)); return Number.isFinite(v) && attr(e, n) !== undefined ? v : d; };
// Population paths: node names joined with "/" (a "/" inside a name is written "_").
const pathIn = (p: string) => p;
const pathOut = (p: string) => p;


// Object figures (flowjo-figlist-format.md section 9).
// Annotation columns (lib.fjml.types.Annotation keys, element Anno).
const ANNO_FJ: Record<AnnoColumn, string> = { POPNAME: 'fj.anno.popname', INDENTEDPOPNAME: 'fj.anno.indentedpopname', POPNAMEWITHPATH: 'fj.anno.popnamewithpath', SAMPLENAME: 'fj.anno.samplename', WSANNO: 'fj.anno.wsanno', COMPMATNAME: 'fj.anno.compmatname', FULLGATEPATH: 'fj.anno.fullpath' };
const ANNO_BY_FJ = Object.fromEntries(Object.entries(ANNO_FJ).map(([k, v]) => [v, k as AnnoColumn])) as Record<string, AnnoColumn>;
// Statistic name attribute: FlowJo's StatKey strings, display names accepted.
const STAT_BY_NAME: Record<string, StatKind> = { ...Object.fromEntries(Object.entries(FLOWJO_STAT_NAMES).map(([k, v]) => [v, k as StatKind])), 'Freq. of Parent': 'freqParent', 'Freq. of Grandparent': 'freqGrandparent', 'Freq. of Total': 'freqTotal', 'Freq. of': 'freqOf' };
// Statistic node display label (StatKey.lookup): the fj.stat.* keys have dictionary texts, the others are their own text.
const STAT_LABEL: Partial<Record<StatKind, string>> = { ...FLOWJO_STAT_NAMES, freqParent: 'Freq. of Parent', freqGrandparent: 'Freq. of Grandparent', freqTotal: 'Freq. of Total', freqOf: 'Freq. of' };
const STAT_BY_LABEL = Object.fromEntries(Object.entries(STAT_LABEL).map(([k, v]) => [v, k as StatKind])) as Record<string, StatKind>;
// Expected ranges are named preference ranges in FlowJo (Statistic expectedRange,
// HeatmapRange range); own rule: the app's numeric range is written as the name "min - max".
export const rangeName = (r: { min: number; max: number }) => `${r.min} - ${r.max}`;
export function parseRangeName(n: string | undefined): { min: number; max: number } | undefined {
  const m = /^\s*(-?[\d.]+(?:e[-+]?\d+)?)\s+-\s+(-?[\d.]+(?:e[-+]?\d+)?)\s*$/i.exec(n ?? '');
  return m ? { min: Number(m[1]), max: Number(m[2]) } : undefined;
}
// Java's Double.toString for the percentile in a statistic node name (50 -> "50.0").
const javaDouble = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
// The name of a statistic node (StatisticNode.getName with a sample, i.e.
// Statistic.getDescription): label, " (p)" for percentiles, " : parameter",
// " / second parameter" for correlations; Freq. of adds the ancestor.
export function statNodeName(c: Omit<StatColumn, 'id' | 'populationPath'>, param: (ch: string) => string): string {
  const label = c.stat === 'freqOf' ? `Freq. of ${c.ancestor ?? ''}` : STAT_LABEL[c.stat] ?? c.stat;
  return `${label}${c.stat === 'percentile' ? ` (${javaDouble(c.percentile ?? 50)})` : ''}${c.channel ? ` : ${param(c.channel)}` : ''}${c.stat === 'correlation' && c.correlate ? ` / ${param(c.correlate)}` : ''}`;
}
// Splits a statistic node path at the last "/" that is not the " / " of a correlation name.
function splitStatPath(p: string): [string, string] {
  for (let i = p.length - 1; i >= 0; i--) if (p[i] === '/' && !(p[i - 1] === ' ' && p[i + 1] === ' ')) return [p.slice(0, i), p.slice(i + 1)];
  return ['', p];
}
const PLATE_MODE: Record<string, 'HEATMAP' | 'CHERNOFF_FACE'> = { 'le.plate.display.mode.heatmap': 'HEATMAP', 'le.plate.display.mode.chernoffface': 'CHERNOFF_FACE' };
// PlateDisplayStatistic$DisplayTarget.toFCML keys, in enum order.
const TARGET_KEYS: Record<DisplayTarget, string> = { HEATMAP1: 'heatmap1', HEATMAP2: 'heatmap2', CHERNOFF_PUPIL_SIZE: 'face.pupilsize', CHERNOFF_EYE_SPACING: 'face.eyespacing', CHERNOFF_HEAD_SHAPE: 'face.headshape', CHERNOFF_EYE_SIZE: 'face.eyesize', CHERNOFF_EYE_SHAPE: 'face.eyeshape', CHERNOFF_EYEBROW: 'face.eyebrows', CHERNOFF_NOSE: 'face.nose', CHERNOFF_MOUTH_SIZE: 'face.mouthsize', CHERNOFF_MOUTH_HEIGHT: 'face.grin', CHERNOFF_MOUTH: 'face.mouth' };
const targetKey = (t: DisplayTarget) => `le.plate.display.comp.${TARGET_KEYS[t]}`;
// FJMLUtil.find: the key is matched ignoring case.
const targetOf = (k: string | undefined) => TARGETS.find((x) => targetKey(x.t).toLowerCase() === (k ?? '').toLowerCase())?.t;
const toHex = (c: string | undefined): string | undefined => {
  if (!c) return undefined;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : c.toLowerCase();
};
// Optional context: the workspace statistics (plate statistics are statistic nodes;
// the app keeps them as statistics columns, matched or added by node path).
export interface FigContext { statColumns?: StatColumn[] }

export interface FigImport { items: LayoutItem[]; grids: GridDef[]; warnings: string[] }
// sample: FlowJo sampleID -> app sample id; channel: (FlowJo sampleID, FlowJo parameter name) -> app channel.
export function parseFigList(figList: El, sample: (wspId: string) => string | undefined, channel: (wspId: string, name: string) => string, ctx: FigContext = {}): FigImport {
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
    const mgRaw = mg ? (attr(mg, 'type') ?? '').toLowerCase() : '';
    const mgType = MG_TYPES[mgRaw] ?? (mgRaw.startsWith('show all by') ? 'allby' : mgRaw.startsWith('show nxn') ? 'nxn' : undefined);
    const mgKind = mg ? MG_KIND[(attr(mg, 'displayType') ?? '').replace(/\s+/g, '').toLowerCase()] : undefined;
    const controls = layers.slice(1).filter((l) => kid(l, 'LegendSpec') && bool(kid(l, 'LegendSpec')!, 'control')).map((l) => pathIn(attr(l, 'path') ?? ''));
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
      // FigChartRow: horizontal (default on) off = a vertical ancestry column; backgating display flags.
      ...(anc && attr(anc, 'horizontal') !== undefined && !bool(anc, 'horizontal') ? { ancestryVertical: true } : {}),
      ...(anc && bool(anc, 'backgatingLargeDots') ? { backgateLarge: true } : {}),
      ...(anc && bool(anc, 'backgatingContours') ? { backgateContours: true } : {}),
      ...(mgType && shown(mg) ? { multigraph: mgType, multiParams: mgParams.map((n) => channel(wspId, n)).slice(0, 10), ...(mgKind ? { multiKind: mgKind } : {}) } : {}),
      ...(controls.length ? { controls } : {}),
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
      if (/^<Key\b/.test(x)) return `{{keyword:${unescapeXml(/name="([^"]*)"/.exec(x)?.[1] ?? '')}}}`;
      if (/^<Anno\b/.test(x)) return `{{anno:${(/name="([^"]*)"/.exec(x)?.[1] ?? '').replace(/^fj\.anno\./, '')}}}`;
      const name = /name="([^"]*)"/.exec(x)?.[1] ?? 'value', path = /path="([^"]*)"/.exec(x)?.[1] ?? '';
      return `{${name}${path ? `: ${unescapeXml(path)}` : ''}}`;
    });
    const plain = unescapeXml(withStats.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')).split('\n').map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n').trim();
    const r = rect(e);
    const span = /<body[^>]*>\s*(?:<p[^>]*>\s*)?<span style="([^"]*)"/i.exec(html)?.[1] ?? '';
    const css = (k: string) => new RegExp(`${k}:\\s*([^;]+)`, 'i').exec(span)?.[1].trim();
    const font = css('font-family'), size = parseFloat(css('font-size') ?? ''), color = css('color');
    return { id: id('txt'), text: plain, left: r.x, top: r.y, width: Math.max(20, r.w), height: Math.max(14, r.h), ...style(e),
      ...(font ? { font } : {}), ...(Number.isFinite(size) ? { size } : {}), ...(color ? { color } : {}), ...(/bold/i.test(css('font-weight') ?? '') ? { bold: true } : {}), ...(/italic/i.test(css('font-style') ?? '') ? { italic: true } : {}) } as LayoutText;
  };
  // Common Fig attributes (Fig.setElementSelf): colours, line weight and style,
  // gradient, aspect ratio lock. lock / sizeLock / contentLock are not read by
  // FlowJo 10.6.2 and are not read here either.
  const style = (e: El): { style?: FigStyle; aspectLock?: boolean } => {
    const st: FigStyle = {};
    const fill = attr(e, 'fill');
    if (fill && !(fill.length === 9 && /^#00/i.test(fill))) st.fill = fill;
    if (attr(e, 'stroke')) st.line = attr(e, 'stroke');
    const lw = (attr(e, 'lineWeight') ?? '').toUpperCase();
    const w = (Object.keys(LINE_WEIGHTS) as LineWeight[]).find((k) => LINE_WEIGHTS[k].fj.toUpperCase() === lw || (k === 'veryheavy' && lw === 'VERY HEAVY'));
    if (lw) st.weight = w ?? 'hairline';
    const ls = (attr(e, 'lineStyle') ?? '').toUpperCase();
    const l = (Object.keys(LINE_STYLES) as LineStyle[]).find((k) => LINE_STYLES[k].fj.toUpperCase() === ls);
    if (l && l !== 'solid') st.lineStyle = l;
    const g = (attr(e, 'gradientStyle') ?? '').replace('le.gradientstyle.', '') as GradientType;
    if (GRADIENTS.includes(g) && g !== 'none') { st.gradientType = g; if (attr(e, 'gradientColor')) st.gradient = attr(e, 'gradientColor'); }
    return { ...(Object.keys(st).length ? { style: st } : {}), ...(bool(e, 'aspectRatioLock') ? { aspectLock: true } : {}) };
  };
  const SHAPES: Record<string, LayoutShape['shape']> = { Rectangle: 'rect', RoundRect: 'roundrect', Oval: 'ellipse', Ellipse: 'ellipse', Line: 'line' };
  const shape = (e: El): LayoutItem => {
    const k = SHAPES[local(e)];
    if (k === 'line') {
      const x1 = num(e, 'x1'), y1 = num(e, 'y1'), x2 = num(e, 'x2'), y2 = num(e, 'y2');
      const a = (attr(e, 'arrow') ?? '').toLowerCase();
      const arrow: LayoutShape['arrow'] = a === 'forward' ? 'forward' : a === 'backward' ? 'backward' : a.startsWith('double') ? 'double' : undefined;
      return { id: id('shp'), shape: 'line', left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), ends: [x1 <= x2 ? 0 : 1, y1 <= y2 ? 0 : 1, x1 <= x2 ? 1 : 0, y1 <= y2 ? 1 : 0], ...(arrow ? { arrow } : {}), ...style(e) };
    }
    const r = rect(e);
    return { id: id('shp'), shape: k, left: r.x, top: r.y, width: r.w, height: r.h, ...style(e) };
  };
  // Image (FigImage): only the URL is saved; a data: or http(s) URL is shown,
  // a file URL cannot be read by the browser and shows as a placeholder.
  const image = (e: El): LayoutItem => { const r = rect(e); return { id: id('img'), image: attr(e, 'url') ?? '', left: r.x, top: r.y, width: Math.max(4, r.w), height: Math.max(4, r.h), ...style(e) }; };

  // FigWebBrowser (FigRect bounds plus url, zoom, offsetX, offsetY; url
  // defaults to http://www.flowjo.com).
  const web = (e: El): LayoutItem => { const r = rect(e); return { id: id('obj'), object: { kind: 'web', url: attr(e, 'url') ?? 'http://www.flowjo.com', zoom: num(e, 'zoom', 1) || 1, offsetX: num(e, 'offsetX'), offsetY: num(e, 'offsetY') }, left: r.x, top: r.y, width: Math.max(4, r.w), height: Math.max(4, r.h), ...style(e) }; };

  // StatTable / DifferenceTable (FigStatTable, FigDifferenceTable): the grid
  // attributes plus the model child (StatTableModel / Model): rows are
  // NodeReferences (rootID = FlowJo sampleID, analysis path, control), columns
  // Statistic / Key / Anno (Graph columns are not supported).
  const tableModel = (m: El | undefined, what: string) => {
    const rows: TableRowRef[] = [], columns: StatTableColumn[] = [];
    let firstWsp = '';
    for (const n of m ? kids(kid(m, 'Populations') ?? m, 'NodeReference') : []) {
      const root = attr(n, 'rootID') || attr(n, 'sampleID') || '';
      const sid = bool(n, 'isGroup') ? undefined : sample(root);
      if (!sid) { warnings.push(`${what} row "${attr(n, 'path') ?? ''}" of ${bool(n, 'isGroup') ? 'group' : 'FlowJo sample'} ${root || '?'} is not a workspace sample; skipped`); continue; }
      firstWsp ||= root;
      rows.push({ sampleId: sid, path: pathIn(attr(n, 'path') ?? ''), ...(bool(n, 'control') ? { control: true } : {}) });
    }
    const cols = m ? kid(m, 'Columns') : undefined;
    for (const c of cols ? kids(cols) : []) {
      const k = local(c);
      if (k === 'Anno') { const a = ANNO_BY_FJ[attr(c, 'name') ?? '']; if (a) columns.push({ type: 'anno', anno: a }); else warnings.push(`${what} annotation column ${attr(c, 'name') ?? '?'} is not supported; skipped`); }
      else if (k === 'Key') columns.push({ type: 'keyword', name: attr(c, 'name') ?? '' });
      else if (k === 'Statistic') {
        const st = STAT_BY_NAME[attr(c, 'name') ?? ''];
        const ch = (n: string | undefined) => (n ? channel(firstWsp, n) : undefined);
        if (!st || attr(c, 'subPopulation') || (STAT_NEEDS_CHANNEL(st) && !attr(c, 'id'))) { warnings.push(`${what} statistic column ${attr(c, 'name') ?? '?'}${attr(c, 'subPopulation') ? ` of sub-population ${attr(c, 'subPopulation')}` : ''} is not supported; skipped`); continue; }
        const stat: TableStat = { stat: st, ...(STAT_NEEDS_CHANNEL(st) ? { channel: ch(attr(c, 'id')) } : {}), ...(st === 'percentile' ? { percentile: num(c, 'percent', 50) } : {}), ...(st === 'freqOf' ? { ancestor: attr(c, 'ancestor') ?? '' } : {}), ...(st === 'correlation' && attr(c, 'correlate') ? { correlate: ch(attr(c, 'correlate')) } : {}) };
        const range = parseRangeName(attr(c, 'expectedRange'));
        if (attr(c, 'expectedRange') && !range) warnings.push(`${what} expected range "${attr(c, 'expectedRange')}" is a FlowJo preference range; not applied`);
        columns.push({ type: 'stat', stat, ...(range ? { range } : {}) });
      } else warnings.push(`${what} column type ${k} is not supported; skipped`);
    }
    // StatTableModel.setColumnDefsElement: no Columns element gives the default columns.
    if (!cols) columns.push({ type: 'anno', anno: 'POPNAMEWITHPATH' }, { type: 'stat', stat: { stat: 'count' } });
    return { rows, columns, showHeader: m ? bool(m, 'showHeader', true) : true, iterate: m ? bool(m, 'enableContentIteration') : false };
  };
  const place = (e: El) => { const r = rect(e); return { left: r.x, top: r.y, width: Math.max(4, r.w), height: Math.max(4, r.h), ...style(e) }; };
  const statTable = (e: El): LayoutObject => {
    const t = tableModel(kid(e, 'StatTableModel'), 'Statistic table');
    return { id: id('obj'), object: { kind: 'stattable', rows: t.rows, columns: t.columns, showHeader: t.showHeader, ...(t.iterate ? { iterate: true } : {}) }, ...place(e) };
  };
  const diffTable = (e: El): LayoutObject => {
    const m = kid(e, 'Model'), t = tableModel(m, 'Difference table');
    const ctl = m ? kid(m, 'Control') : undefined;
    const controlSampleId = ctl && attr(ctl, 'sampleID') ? sample(attr(ctl, 'sampleID')!) : undefined;
    if (ctl && attr(ctl, 'sampleID') && !controlSampleId) warnings.push(`Difference table control sample ${attr(ctl, 'sampleID')} is not in the workspace`);
    return { id: id('obj'), object: { kind: 'difftable', rows: t.rows, columns: t.columns, ...(controlSampleId ? { controlSampleId } : {}), ...(t.iterate ? { iterate: true } : {}) }, ...place(e) };
  };
  // TETable (FigTableDisplay extends FigGridLayout): GridLayout content; row 0
  // holds the header StyledText figures, the other rows SimpleFJML cells whose
  // fill is the format background and whose TextTraits carry colour and style.
  const teTable = (e: El): LayoutObject => {
    const nr = Math.max(1, num(e, 'rows', 1)), nc = Math.max(1, num(e, 'columns', 1));
    const header: string[] = Array.from({ length: nc }, () => '');
    const rows = Array.from({ length: nr - 1 }, () => ({ cells: Array.from({ length: nc }, () => ''), styles: Array.from({ length: nc }, () => null as CellStyle | null) }));
    for (const cell of kids(kid(e, 'Content') ?? e, 'Cell')) {
      const r = num(cell, 'row'), c = num(cell, 'col'), fig = kids(cell)[0];
      if (!fig || r >= nr || c >= nc) continue;
      if (local(fig) === 'StyledText') { const t = (text(fig) as LayoutText).text; if (r === 0) header[c] = t; else rows[r - 1].cells[c] = t; continue; }
      const t = unescapeXml(kid(fig, 'Content')?.textContent ?? '').trim();
      if (r === 0) { header[c] = t; continue; }
      rows[r - 1].cells[c] = t;
      const tt = kid(fig, 'TextTraits'), fill = attr(fig, 'fill'), color = tt ? attr(tt, 'color') : undefined, sty = (tt ? attr(tt, 'style') : '') ?? '';
      const st: CellStyle = { ...(fill && !/^#00/i.test(fill.length === 9 ? fill : '') && fill.toLowerCase() !== '#ffffff' ? { background: fill } : {}), ...(color && color.toLowerCase() !== '#000000' ? { color } : {}), ...(/bold/.test(sty) ? { bold: true } : {}), ...(/italic/.test(sty) ? { italic: true } : {}) };
      rows[r - 1].styles[c] = Object.keys(st).length ? st : null;
    }
    return { id: id('obj'), object: { kind: 'tetable', name: attr(e, 'name') ?? 'Table', header, rows: rows.map((x) => ({ cells: x.cells, ...(x.styles.some(Boolean) ? { styles: x.styles } : {}) })) }, ...place(e) };
  };
  // PlateDisplay (FigPlateDisplay): grid attributes plus PlateDisplayModel
  // (groupName, displayMode, Statistics of PlateStatisticReference path =
  // statistic node path, displayTarget, HeatmapRange method / range).
  const plate = (e: El): LayoutObject => {
    const m = kid(e, 'PlateDisplayModel');
    const stats: PlateStat[] = [];
    const cols = ctx.statColumns;
    for (const ref of m && kid(m, 'Statistics') ? kids(kid(m, 'Statistics')!) : []) {
      const path = attr(ref, 'path') ?? '';
      const [pop, node] = splitStatPath(path);
      const mt = /^(.*?)(?: \(([-\d.eE]+)\))?(?: : (.+?))?(?: \/ (.+))?$/.exec(node)!;
      const kind = STAT_BY_LABEL[mt[1]] ?? (mt[1].startsWith('Freq. of ') ? 'freqOf' : undefined);
      if (!kind || !cols) { warnings.push(`Plate statistic "${path}" is not a statistic this app reads; skipped`); continue; }
      const want = { stat: kind, ...(STAT_NEEDS_CHANNEL(kind) && mt[3] ? { channel: channel('', mt[3]) } : {}), ...(kind === 'percentile' ? { percentile: Number(mt[2] ?? 50) } : {}), ...(kind === 'freqOf' ? { ancestor: mt[1].slice('Freq. of '.length) } : {}), ...(kind === 'correlation' && mt[4] ? { correlate: channel('', mt[4]) } : {}) };
      const same = (c: StatColumn) => c.populationPath === pop && c.stat === want.stat && c.channel === want.channel && c.percentile === want.percentile && (c.ancestor ?? undefined) === want.ancestor && (c.correlate ?? undefined) === want.correlate;
      let col = cols.find(same);
      if (!col) { col = { id: `col${cols.length + 1}`, populationPath: pop, ...want }; cols.push(col); }
      const hr = kid(ref, 'HeatmapRange');
      const method = hr && (attr(hr, 'method') ?? '').toLowerCase() === 'fj.heatmap.method.expectedrange' ? 'EXPECTED_RANGE' as const : 'AUTO' as const;
      const range = hr ? parseRangeName(attr(hr, 'range')) : undefined;
      if (method === 'EXPECTED_RANGE' && !range) warnings.push(`Plate statistic "${path}" uses FlowJo preference range "${hr ? attr(hr, 'range') ?? '' : ''}"; not applied`);
      const target = targetOf(attr(ref, 'displayTarget'));
      stats.push({ statId: col.id, ...(target ? { target } : {}), method, ...(range ? { range } : {}) });
    }
    const mode = m ? PLATE_MODE[(attr(m, 'displayMode') ?? '').toLowerCase()] : undefined;
    return { id: id('obj'), object: { kind: 'plate', model: { ...(m && attr(m, 'groupName') ? { groupName: attr(m, 'groupName') } : {}), ...(mode ? { mode } : {}), ...(m && bool(m, 'showSampleName') ? { showSampleName: true } : {}), stats } }, ...place(e) };
  };
  const OBJECTS: Record<string, (e: El) => LayoutObject> = { StatTable: statTable, DifferenceTable: diffTable, TETable: teTable, PlateDisplay: plate };
  const walk = (parent: El, groupId?: string) => {
    for (const e of kids(parent)) {
      const k = local(e);
      if (k === 'ChartData' || k === 'Chart') { const c = chart(e); if (c) items.push({ ...c, ...(groupId ? { groupId } : {}) }); }
      else if (k === 'StyledText' || k === 'SimpleText') items.push({ ...text(e), ...(groupId ? { groupId } : {}) } as LayoutItem);
      else if (SHAPES[k]) items.push({ ...shape(e), ...(groupId ? { groupId } : {}) } as LayoutItem);
      else if (k === 'Image') items.push({ ...image(e), ...(groupId ? { groupId } : {}) } as LayoutItem);
      else if (k === 'FigWebBrowser') items.push({ ...web(e), ...(groupId ? { groupId } : {}) } as LayoutItem);
      else if (OBJECTS[k]) items.push({ ...OBJECTS[k](e), ...(groupId ? { groupId } : {}) });
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
export function writeFigList(items: LayoutItem[], grids: GridDef[], sampleId: (appId: string | undefined) => string, param: (appId: string | undefined, ch: string) => string, ctx: FigContext = {}): string {
  const b = (v: boolean) => (v ? '1' : '0');
  const chartXml = (it: LayoutPlot, abs = true) => {
    const f = boxToFrame({ left: it.left ?? 0, top: it.top ?? 0, width: it.width ?? GRAPH_GEOM.w * (256 / PW), height: it.height ?? GRAPH_GEOM.h * (256 / PW) });
    const sid = sampleId(it.sampleId);
    const p = (ch: string) => esc(param(it.sampleId, ch));
    const env = `<GraphEnvironment showGrid="${b(!!it.grid)}"  showAxes="${esc(it.axes === undefined ? 'tnlTNL' : it.axes || 'o')}"  showGates="${b(it.showGates !== false)}"  showFreqOnPlots="${b(it.gateFreq !== false && !it.hideGateFreq)}"  showGateNameOnPlots="${b(it.gateNames !== false && !it.hideGateNames)}"  showMedians="${b(!!it.medians)}" />`;
    const graph = `<Graph type="${TYPE[it.kind]}" ><Axis dimension="x"  name="${p(it.x)}"  auto="auto" />${it.y && it.kind !== 'histogram' ? `<Axis dimension="y"  name="${p(it.y)}"  auto="auto" />` : ''}<GraphSettings showOutliers="${b(!!it.showOutliers)}"  drawLargeDots="${b(!!it.largeDots)}" />${env}</Graph>`;
    const dep = (name: string, on: boolean, extra = '', inner = '') => `<${name}${extra}><WindowPosition x="0"  y="0"  width="0"  height="0"  displayed="${b(on)}" />${inner}</${name}>`;
    const layers = [it.populationPath, ...(it.overlays ?? [])].map((path, k) => `<DataLayer path="${esc(pathOut(path))}"  panelValue="0"  discriminatorValue=""  sampleID="${sid}" ><LegendSpec text=""  control="${b(k > 0 && !!it.controls?.includes(path))}"${k ? ' color="#ff0000"' : ''} /></DataLayer>`).join('');
    const mgType = it.multigraph ? MG_OUT[it.multigraph] : 'NONE';
    return `<ChartData x="${f.x}"  y="${f.y}"  width="${f.w}"  height="${f.h}"  dependents="1"  showAdjunctHistograms="${b(!!it.adjunct)}"  path="${esc(pathOut(it.populationPath))}"  sampleID="${sid}"  scaleH="${+(f.w / 256).toFixed(10)}"  scaleV="${+(f.h / 256).toFixed(10)}" >${graph}`
      + dep('Annotation', !!it.showAnnotation)
      + dep('Ancestry', !!it.ancestry, `  backgating="${b(!!it.backgating)}"  horizontal="${b(!it.ancestryVertical)}"  backgatingLargeDots="${b(!!it.backgateLarge)}"  backgatingContours="${b(!!it.backgateContours)}"`)
      + dep('Multigraph', !!it.multigraph, `  type="${mgType}"  displayType="${it.multigraph === 'histograms' || it.multigraph === 'slinky' ? 'Histogram' : MG_KIND_OUT[it.multiKind ?? 'pseudocolor']}"`, `<Parameters>${(it.multiParams ?? []).map((n) => `<Parameter name="${p(n)}" />`).join('')}</Parameters>`)
      + `<PopModelList>${layers}</PopModelList>${abs ? `<WindowPosition x="${f.x}"  y="${f.y}"  width="${f.w}"  height="${f.h}"  displayed="1" />` : ''}</ChartData>`;
  };
  // Common Fig attributes (Fig.getElement).
  const figAttrs = (it: LayoutItem, defWeight: LineWeight) => {
    const st = it.style ?? {};
    return `lineWeight="${LINE_WEIGHTS[st.weight ?? defWeight].fj}"  fill="${esc(st.fill ?? '#00ffffff')}"  stroke="${esc(st.line ?? '#000000')}"  lineStyle="${LINE_STYLES[st.lineStyle ?? 'solid'].fj}"  gradientColor="${esc(st.gradient ?? '#ffffff')}"  gradientStyle="le.gradientstyle.${st.gradientType ?? 'none'}"  aspectRatioLock="${b(!!it.aspectLock)}"  lock="${b(!!it.locked)}"  sizeLock="${b(!!it.sizeLock)}"  contentLock="${b(!!it.contentLock)}"`;
  };
  // Live fields become FJML input tags (FJTextPane.makeFjmlTag).
  const fjml = (cmd: string) => `<input type="fjml" value="${encodeURIComponent(cmd).replace(/%20/g, '+')}">`;
  const textHtml = (l: string) => esc(l).replace(/\{\{(keyword|anno):([^}]*)\}\}/g, (_m, k: string, n: string) => (k === 'keyword' ? fjml(`<Key name="${n}"/>`) : fjml(`<Anno name="fj.anno.${n}"/>`)));
  const textXml = (it: LayoutText) => {
    const css = [it.font ? `font-family: ${it.font}` : '', it.size ? `font-size: ${it.size}pt` : '', it.color ? `color: ${it.color}` : '', it.bold ? 'font-weight: bold' : '', it.italic ? 'font-style: italic' : ''].filter(Boolean).join('; ');
    const html = `<html><head></head><body>${it.text.split('\n').map((l) => `<p style="margin-top: 0">${css ? `<span style="${css}">${textHtml(l)}</span>` : textHtml(l)}</p>`).join('')}</body></html>`;
    // Escaped once for the HTML-in-text and once more by the workspace writer.
    return `<StyledText x="${it.left ?? 0}"  y="${it.top ?? 0}"  width="${it.width ?? 216}"  height="${it.height ?? 72}"  ${figAttrs(it, 'none')}  autoFitContents="0"  autoMinimumSize="1"  padding="2,2,2,2" ><Content>${esc(esc(html))}</Content></StyledText>`;
  };
  const NAMES: Record<LayoutShape['shape'], string> = { rect: 'Rectangle', roundrect: 'RoundRect', ellipse: 'Ellipse', line: 'Line' };
  const shapeXml = (it: LayoutShape) => {
    const r = { x: it.left ?? 0, y: it.top ?? 0, w: it.width ?? 0, h: it.height ?? 0 };
    if (it.shape === 'line') {
      const e = it.ends ?? [0, 0, 1, 1];
      const arrow = { none: 'None', forward: 'Forward', backward: 'Backward', double: 'Double-headed' }[it.arrow ?? 'none'];
      return `<Line x1="${r.x + e[0] * r.w}"  y1="${r.y + e[1] * r.h}"  x2="${r.x + e[2] * r.w}"  y2="${r.y + e[3] * r.h}"  arrow="${arrow}"  ${figAttrs(it, 'normal')} />`;
    }
    return `<${NAMES[it.shape]} x="${r.x}"  y="${r.y}"  width="${r.w}"  height="${r.h}"  ${figAttrs(it, 'normal')} />`;
  };
  const webXml = (it: LayoutItem & { object: { kind: 'web'; url: string; zoom: number; offsetX: number; offsetY: number } }) => `<FigWebBrowser x="${it.left ?? 0}"  y="${it.top ?? 0}"  width="${it.width ?? 400}"  height="${it.height ?? 300}"  ${figAttrs(it, 'none')}  offsetX="${Math.round(it.object.offsetX)}"  offsetY="${Math.round(it.object.offsetY)}"  url="${esc(it.object.url)}"  zoom="${it.object.zoom}" />`;

  // Object figures (flowjo-figlist-format.md section 9).
  const box = (it: LayoutItem, w: number, h: number) => ({ x: it.left ?? 0, y: it.top ?? 0, w: Math.round(it.width ?? w), h: Math.round(it.height ?? h) });
  // FigBaseGrid.getElement: rows, columns, drawGrid, autoFitContents, RowSizes, ColSizes (sizes divide the box).
  const gridAttrs = (it: LayoutItem, rows: number, cols: number, w: number, h: number, rowH?: number[], colW?: number[]) => {
    const r = box(it, w, h);
    const sizes = (tag: string, n: number, v: number[] | undefined, total: number) => `<${tag}>${Array.from({ length: n }, (_, k) => `<Size index="${k}"  value="${+(v?.[k] ?? total / n).toFixed(4)}" />`).join('')}</${tag}>`;
    return { open: `x="${r.x}"  y="${r.y}"  width="${r.w}"  height="${r.h}"  ${figAttrs(it, 'none')}  rows="${rows}"  columns="${cols}"  drawGrid="1"  autoFitContents="0"`, sizes: sizes('RowSizes', rows, rowH, r.h) + sizes('ColSizes', cols, colW, r.w) };
  };
  const statAttrs = (s: TableStat, sid: string | undefined, range?: { min: number; max: number }) => {
    const name = FLOWJO_STAT_NAMES[s.stat];
    if (!name) return '';
    return `<Statistic name="${esc(name)}"${s.channel ? `  id="${esc(param(sid, s.channel))}"` : ''}${s.stat === 'percentile' ? `  percent="${s.percentile ?? 50}"` : ''}${s.stat === 'freqOf' && s.ancestor ? `  ancestor="${esc(s.ancestor)}"` : ''}${s.stat === 'correlation' && s.correlate ? `  correlate="${esc(param(sid, s.correlate))}"` : ''}${range ? `  expectedRange="${esc(rangeName(range))}"` : ''} />`;
  };
  const TT = (name: string, st?: CellStyle | null) => `<TextTraits font="SansSerif"  size="11"  name="${name}"  style="${st?.bold && st.italic ? 'bold-italic' : st?.bold ? 'bold' : st?.italic ? 'italic' : 'plain'}"  color="${esc(toHex(st?.color) ?? '#000000')}"  background="#00ffffff"  just="left" />`;
  const modelXml = (tag: string, o: { rows: TableRowRef[]; columns: StatTableColumn[]; showHeader?: boolean; iterate?: boolean }, extra = '') => {
    const sid = o.rows[0]?.sampleId;
    const rows = o.rows.map((r) => `<NodeReference rootID="${esc(sampleId(r.sampleId))}"  path="${esc(pathOut(r.path))}"${r.control ? '  control="1"' : ''} />`).join('');
    const cols = o.columns.map((c) => (c.type === 'anno' ? `<Anno name="${ANNO_FJ[c.anno]}" />` : c.type === 'keyword' ? `<Key name="${esc(c.name)}" />` : statAttrs(c.stat, sid, c.range))).join('');
    return `<${tag} showHeader="${b(o.showHeader !== false)}"  enableContentIteration="${b(!!o.iterate)}" ><Populations>${rows}</Populations><Columns>${cols}</Columns>${TT('Content')}${extra}</${tag}>`;
  };
  const objectXml = (it: LayoutObject): string => {
    const o: LayoutObjectSpec = it.object;
    if (o.kind === 'stattable' || o.kind === 'difftable') {
      const g = gridAttrs(it, o.rows.length + 1, Math.max(1, o.columns.length), 240, 16 * (o.rows.length + 1));
      return o.kind === 'stattable'
        ? `<StatTable ${g.open} >${g.sizes}${modelXml('StatTableModel', o)}</StatTable>`
        : `<DifferenceTable ${g.open} >${g.sizes}${modelXml('Model', o, o.controlSampleId ? `<Control sampleID="${esc(sampleId(o.controlSampleId))}" />` : '')}</DifferenceTable>`;
    }
    if (o.kind === 'tetable') {
      const cells = [o.header, ...o.rows.map((r) => r.cells)];
      const geo = tableGeometry(cells);
      const g = gridAttrs(it, cells.length, Math.max(1, geo.colW.length), geo.w, geo.h, cells.map(() => geo.rowH), geo.colW);
      const content = cells.map((row, r) => row.map((t, c) => {
        if (r === 0) return `<Cell row="0"  col="${c}" >${textXml({ id: '', text: t, left: 0, top: 0, width: geo.colW[c], height: geo.rowH })}</Cell>`;
        const st = o.rows[r - 1].styles?.[c];
        return `<Cell row="${r}"  col="${c}" ><SimpleFJML x="0"  y="0"  width="${geo.colW[c]}"  height="${geo.rowH}"  lineWeight="NoLine"  fill="${esc(toHex(st?.background) ?? '#00ffffff')}"  stroke="#000000"  autoFitContents="0"  autoMinimumSize="1"  padding="1,4,1,4" ><Content>${esc(esc(t))}</Content>${TT('', st)}</SimpleFJML></Cell>`;
      }).join('')).join('');
      return `<TETable ${g.open}  name="${esc(o.name)}" >${g.sizes}<Content>${content}</Content><Labels></Labels></TETable>`;
    }
    if (o.kind === 'plate') {
      const m = o.model;
      const g = gridAttrs(it, 8, 12, 360, 240);
      const refs = m.stats.map((s) => {
        const c = ctx.statColumns?.find((x) => x.id === s.statId);
        if (!c) return '';
        const node = statNodeName(c, (ch) => param(undefined, ch));
        const path = c.populationPath ? `${pathOut(c.populationPath)}/${node}` : node;
        const hr = `<HeatmapRange method="${s.method === 'EXPECTED_RANGE' ? 'fj.heatmap.method.expectedrange' : 'fj.heatmap.method.auto'}"${s.method === 'EXPECTED_RANGE' && s.range ? `  range="${esc(rangeName(s.range))}"` : ''} />`;
        return `<PlateStatisticReference path="${esc(path)}"${s.target ? `  displayTarget="${targetKey(s.target)}"` : ''} >${hr}</PlateStatisticReference>`;
      }).join('');
      return `<PlateDisplay ${g.open} >${g.sizes}<PlateDisplayModel groupName="${esc(m.groupName ?? '')}"  displayMode="${m.mode === 'CHERNOFF_FACE' ? 'le.plate.display.mode.chernoffface' : 'le.plate.display.mode.heatmap'}"${m.showSampleName ? '  showSampleName="1"' : ''} ><Statistics>${refs}</Statistics></PlateDisplayModel></PlateDisplay>`;
    }
    return webXml(it as Parameters<typeof webXml>[0]);
  };
  const one = (it: LayoutItem): string => (it.object !== undefined ? objectXml(it) : it.text !== undefined ? textXml(it) : it.shape !== undefined ? shapeXml(it) : it.image !== undefined ? `<Image x="${it.left ?? 0}"  y="${it.top ?? 0}"  width="${it.width ?? 100}"  height="${it.height ?? 100}"  ${figAttrs(it, 'none')}  url="${esc(it.image)}" />` : isPlotItem(it) ? chartXml(it) : '');
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
