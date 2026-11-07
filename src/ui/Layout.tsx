// Layout editor (FlowJo 10.6.2 layout logic, specs 21): graphs and text placed
// on pages in points, with FlowJo's arrange commands, z-order, groups, locks,
// nudge, iteration binding and page-by-page export. The geometry rules live in
// src/core/layoutArrange.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  align, alignToGrid, avoidPageBreaks, bindSample, bringToFront, DEFAULT_PAGE, DUPLICATE_OFFSET, FRAME_PT, GRID_PT, gridPositions, iterationValues, MARGIN, nudge, nudgeStep,
  pageGrid, PAPERS, sendToBack, spacing, stepOrder, tilePitch, unionBox, DEFAULT_GUIDES, MAX_GUIDES, snapToGuides, borderAxes, cellOrigin, gridBounds, gridDelete, gridInsert, gridResize, type AlignMode, type Box, type CellRef, type GridDef, type Guides, type LayoutIteration, type PageSetup,
  scaledPage, handleAt, isCornerHandle, resizeBox, ZOOM_STEPS, zoomIn, zoomOut, zoomFit, autoPageScale, pasteOffset, PASTE_TEXT_POINT, invertSelection, DROP_GAP, type ScaleType,
} from '../core/layoutArrange';
import { isPlotItem, populationPath, type LayoutItem, type LayoutPlot, type LayoutShape, type LayoutText, type SampleState, type Workspace } from '../core/model';
import {
  ANNOTATIONS, annoToken, DEFAULT_HEADER_FOOTER, GRADIENTS, headerText, keywordToken, LINE_STYLES, LINE_WEIGHTS, liveText, paintFigFrame, SPECIAL_CHARS, styleOf,
  addLayout, deleteLayout, duplicateLayout, layoutNames, renameLayout, selectLayout, DEFAULT_LAYOUT_NAME, type FigStyle, type GradientType, type HeaderFooter, type LineStyle, type LineWeight,
} from '../core/layoutFigures';
import type { PlotResult, SampleMeta } from '../core/service';
import { makeAxis, sampleChannels, withStains, withUncompTwins } from './axes';
import { channelDisplayName } from '../core/fcs';
import { EVENT_NUMBER } from '../core/formula';
import { drawableGates } from './gateGeometry';
import { PLOT, pw as PLOT_PW, renderPlot, type RenderOptions } from './renderPlot';
import { asCanvas, SvgContext } from './svgContext';
import { canvasesToPdf } from './pdf';
import { usablePage as usablePageOf } from '../core/layoutArrange';
import type { createAnalysisClient } from './workerClient';

type Client = ReturnType<typeof createAnalysisClient>;

// A graph's footprint: the 256 pt plot frame (P13) with this app's axes around it.
export const GRAPH_SCALE = FRAME_PT / PLOT_PW;
export const GRAPH_W = Math.round(PLOT.w * GRAPH_SCALE);
export const GRAPH_H = Math.round(PLOT.h * GRAPH_SCALE);
const TEXT_W = 216, TEXT_H = 72;
const ANNOT_H = 14; // the annotation line drawn above a graph (Show Annotation)
// Ancestry charts are 140 pt, 8 pt apart, to the right of the graph (FigChartRow);
// adjunct histograms are strips along the top and right edges (own size 40 px).
const ANC_PX = Math.round(140 / GRAPH_SCALE), ANC_GAP = Math.round(8 / GRAPH_SCALE), ADJ_PX = 40;
const ancestorCount = (path: string) => (path ? path.split('/').length : 0);
// Footprint of a graph with its ancestry row and adjunct histograms (pixels of the composite).
// Show Multigraph (FigChartGrid, at most multiGraphLimit = 10 parameters): a grid
// of small charts after the graph: one histogram per parameter (Histograms),
// every pair (N x N), the diagonal and the cells below it (half N x N), every
// parameter against the graph's Y (All Parameters by Y, one row), or one chart of
// all histograms stacked (Slinky; own static form of FlowJo's interactive one).
const MG_PX = Math.round(PLOT.h * 0.42), MG_LIMIT = 10;
type MgItem = { multigraph?: LayoutPlot['multigraph']; multiParams?: string[]; y?: string | null };
export const multigraphCells = (it: MgItem) => {
  const n = Math.min(MG_LIMIT, it.multiParams?.length ?? 0);
  if (!it.multigraph || !n) return { cols: 0, rows: 0 };
  if (it.multigraph === 'nxn' || it.multigraph === 'halfnxn') return { cols: n, rows: n };
  if (it.multigraph === 'allby') { const k = (it.multiParams ?? []).slice(0, MG_LIMIT).filter((p) => p !== it.y).length; return { cols: k, rows: k ? 1 : 0 }; }
  if (it.multigraph === 'slinky') return { cols: 2, rows: 2 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
};
type SizeItem = MgItem & { populationPath: string; ancestry?: boolean; ancestryVertical?: boolean; adjunct?: boolean; kind: string };
export function graphCanvasSize(it: SizeItem): { w: number; h: number } {
  const n = it.ancestry ? ancestorCount(it.populationPath) : 0;
  const adj = it.adjunct && it.kind !== 'histogram' ? ADJ_PX : 0;
  const mg = multigraphCells(it);
  const mgW = mg.cols ? ANC_GAP + mg.cols * MG_PX * (PLOT.w / PLOT.h) : 0;
  const ancW = ANC_PX * (PLOT.w / PLOT.h);
  // Vertical ancestry (BACKGATINGVERT): the ancestry charts in a column below the graph.
  if (it.ancestryVertical && n) return { w: Math.ceil(Math.max(PLOT.w + adj, ancW) + mgW), h: Math.max(PLOT.h + adj + n * (ANC_GAP + ANC_PX), mg.rows * MG_PX) };
  return { w: Math.ceil(PLOT.w + adj + n * (ANC_GAP + ancW) + ANC_GAP + mgW), h: Math.max(PLOT.h + adj, mg.rows * MG_PX) };
}
export const graphBoxSize = (it: SizeItem) => { const c = graphCanvasSize(it); return { w: Math.round(c.w * GRAPH_SCALE), h: Math.round(c.h * GRAPH_SCALE) }; };

// Position of an item; items saved before positions existed are laid out two
// across in list order (own migration rule).
export function boxOf(it: LayoutItem, i: number): Box {
  const w = it.width ?? (isPlotItem(it) ? GRAPH_W : TEXT_W);
  const h = it.height ?? (isPlotItem(it) ? GRAPH_H : TEXT_H);
  return { id: it.id, x: it.left ?? (i % 2) * (GRAPH_W + 30), y: it.top ?? Math.floor(i / 2) * (GRAPH_H + 30), w, h, locked: it.locked, groupId: it.groupId };
}
const withBox = (it: LayoutItem, b: Box): LayoutItem => ({ ...it, left: b.x, top: b.y, width: b.w, height: b.h });

// Text figure font: FlowJo's SansSerif / Serif / Monospaced, 11 pt by default.
const FONTS: Record<string, string> = { SansSerif: 'sans-serif', Serif: 'serif', Monospaced: 'monospace' };
export const textFont = (it: LayoutText, zoom = 1) => `${it.italic ? 'italic ' : ''}${it.bold ? 'bold ' : ''}${(it.size ?? 11) * zoom}px ${FONTS[it.font ?? 'SansSerif'] ?? it.font ?? 'sans-serif'}`;
// Greedy word wrap at ~0.6 em per character; also splits on explicit newlines.
function wrapText(text: string, widthPt: number, size = 11): string[] {
  const max = Math.max(8, Math.floor(widthPt / (size * 0.6)));
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      if (cur && (cur + ' ' + word).length > max) { lines.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
    }
    lines.push(cur);
  }
  return lines;
}

interface Rendered {
  item: LayoutItem;
  canvas: HTMLCanvasElement | null;
  options?: RenderOptions;
  text?: string;
  title: string;
  error?: string;
  placeholder?: boolean;
}

// The sample a layout item shows for an iteration value (I1-I7). Items saved
// without their sample follow the value's sample.
export type Bind = (it: LayoutItem) => SampleState | undefined;
export interface RenderExtras { valueSample?: SampleState; placeholders?: boolean; title?: string; page?: number }

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image not available')); im.src = src; });

// Render every layout item for its bound sample.
export async function renderLayout(client: Client, ws: Workspace, meta: Record<string, SampleMeta>, items: LayoutItem[], bind: Bind, extras: RenderExtras = {}): Promise<Rendered[]> {
  const counts = new Map<string, Record<string, { count: number; parentCount: number }>>();
  const out: Rendered[] = [];
  for (const item of items) {
    if (item.text !== undefined) {
      // Live text (Insert Keyword / Insert Annotation) for the iteration's sample.
      const s = extras.valueSample;
      const kwOf = (k: string) => s ? s.keywordsSnapshot[k.toUpperCase()] ?? s.keywordsSnapshot[k] ?? s.annotations?.[k] : undefined;
      out.push({ item, canvas: null, text: liveText(item.text, { keyword: kwOf, sampleName: s?.fileName, title: extras.title, page: extras.page, version: 'flowjo-rea', compensation: s ? (s.compensation === 'none' ? 'None' : s.compensation === 'file' ? 'Acquisition-defined' : ws.matrices.find((m) => m.id === s.compensation)?.name) : undefined }), title: '' });
      continue;
    }
    if (item.shape !== undefined) { out.push({ item, canvas: null, title: '' }); continue; }
    if (item.image !== undefined) {
      try {
        const im = await loadImage(item.image);
        const cv = document.createElement('canvas');
        cv.width = im.naturalWidth || 1; cv.height = im.naturalHeight || 1;
        cv.getContext('2d')!.drawImage(im, 0, 0);
        out.push({ item, canvas: cv, title: 'Image' });
      } catch (e) { out.push({ item, canvas: null, title: 'Image', error: (e as Error).message }); }
      continue;
    }
    const label = item.populationPath || 'All events';
    if (item.empty) { out.push({ item, canvas: null, title: 'Empty chart', placeholder: true }); continue; }
    if (extras.placeholders) { out.push({ item, canvas: null, title: label, placeholder: true }); continue; }
    const s = bind(item);
    if (!s || !meta[s.id]) { out.push({ item, canvas: null, title: label, error: 'no sample for this iteration value' }); continue; }
    const base = { sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters };
    if (!counts.has(s.id)) {
      const a = await client.analyze(base);
      const c: Record<string, { count: number; parentCount: number }> = {};
      for (const r of a.results) if (r) c[r.id] = r;
      counts.set(s.id, c);
    }
    const pop = item.populationPath ? s.populations.find((p) => populationPath(s.populations, p.id) === item.populationPath) : null;
    if (item.populationPath && !pop) { out.push({ item, canvas: null, title: `${s.fileName} / ${label}`, error: 'population not present in this sample' }); continue; }
    const m = withStains(meta[s.id], s.stains);
    let base0 = sampleChannels(m, s.compensation, ws.matrices, ws.derivedParameters);
    if (ws.showUncompensated && s.compensation !== 'none') base0 = withUncompTwins(base0, (s.compensation === 'file' ? m.spillover : ws.matrices.find((x) => x.id === s.compensation))?.channels ?? []);
    const chans = ws.showEventNumber ? [...base0, { index: base0.length + 1, name: EVENT_NUMBER, label: '', bits: 32, range: Math.max(1, s.eventCount), logDecades: 0, logOffset: 0, gain: 1 }] : base0;
    const x = makeAxis(chans, m.keywords, ws.channelTransforms, item.x);
    const y = item.kind === 'histogram' ? null : makeAxis(chans, m.keywords, ws.channelTransforms, item.y ?? '');
    if (!x || (item.kind !== 'histogram' && !y)) { out.push({ item, canvas: null, title: `${s.fileName} / ${label}`, error: `channel ${!x ? item.x : item.y} not in this sample` }); continue; }
    const cAxis = item.kind === 'pseudocolor' && item.colorBy && y ? makeAxis(chans, m.keywords, ws.channelTransforms, item.colorBy) : null;
    const req = (popId: string | null, maxPoints: number, withColor = false) => client.plot({ ...base, popId, ...(withColor && cAxis ? { color: { kind: 'channel' as const, channel: cAxis.channel, transform: cAxis.spec } } : {}), x: { kind: 'channel', channel: x.channel, transform: x.spec }, y: y ? { kind: 'channel', channel: y.channel, transform: y.spec } : null, bins: y ? 200 : 256, xRange: x.range, yRange: y ? y.range : null, maxPoints });
    const data: PlotResult = await req(pop?.id ?? null, 20000, true);
    const overlays: { label: string; data: PlotResult }[] = [];
    for (const path of item.overlays ?? []) {
      const op = s.populations.find((q) => populationPath(s.populations, q.id) === path);
      if (op) overlays.push({ label: path, data: await req(op.id, 5000) });
    }
    const title = (ch: string) => { const c = chans.find((q) => q.name === ch); return c ? channelDisplayName(c) : ch; };
    const options: RenderOptions = { kind: item.kind, x, y, data, gates: item.showGates === false ? [] : drawableGates(s.populations, pop?.id ?? null, x, y), counts: counts.get(s.id)!, contourLevel: item.contourLevel, showOutliers: item.showOutliers, overlays, noLegend: item.legend === false, normalize: item.normalize, xTitle: title(x.channel), yTitle: y ? title(y.channel) : undefined, gateNames: item.gateNames !== false && !item.hideGateNames, gateFreq: item.gateFreq !== false && !item.hideGateFreq, axes: item.axes, grid: item.grid, largeDots: item.largeDots, medians: item.medians, ...(cAxis && data.colorMean ? { colorBy: { values: data.colorMean, range: cAxis.range, label: cAxis.channel } } : {}) };
    let cv = document.createElement('canvas');
    cv.width = PLOT.w;
    cv.height = PLOT.h;
    renderPlot(cv.getContext('2d')!, options);
    if ((item.adjunct && y) || (item.ancestry && item.populationPath) || multigraphCells(item).cols) {
      const size = graphCanvasSize(item);
      const comp = document.createElement('canvas');
      comp.width = size.w; comp.height = size.h;
      const ctx = comp.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.w, size.h);
      const adj = item.adjunct && y ? ADJ_PX : 0;
      ctx.drawImage(cv, 0, adj);
      if (adj && y) {
        // Show Adjunct Histograms (FigChartAdjunctHistogram): X distribution above, Y to the right.
        const strip = async (dim: typeof x, along: 'x' | 'y') => {
          const h = await client.plot({ ...base, popId: pop?.id ?? null, x: { kind: 'channel', channel: dim.channel, transform: dim.spec }, y: null, bins: 128, xRange: dim.range, yRange: null, maxPoints: 0 });
          const mx = Math.max(1, ...Array.from(h.density));
          ctx.fillStyle = '#7d8fb3';
          for (let i = 0; i < h.bins; i++) {
            const v = (h.density[i] / mx) * (ADJ_PX - 6);
            if (along === 'x') { const px = PLOT.ml + (i / h.bins) * (PLOT.w - PLOT.ml - PLOT.mr); ctx.fillRect(px, adj - 3 - v, (PLOT.w - PLOT.ml - PLOT.mr) / h.bins + 0.5, v); }
            else { const py = adj + PLOT.mt + (PLOT.h - PLOT.mt - PLOT.mb) * (1 - (i + 1) / h.bins); ctx.fillRect(PLOT.w + 3, py, v, (PLOT.h - PLOT.mt - PLOT.mb) / h.bins + 0.5); }
          }
        };
        await strip(x, 'x');
        await strip(y, 'y');
      }
      if (item.ancestry && item.populationPath) {
        // Show Ancestry (FigChartRow): one chart per ancestor level, each showing the
        // gate that leads to the next level; with Backgating the graph's population is
        // overlaid (as large dots or as contours when chosen). Horizontal: a row to
        // the right; Vertical: a column below.
        const chain: (typeof s.populations[number] | null)[] = [null];
        for (let q = pop; q && q.parentId; q = s.populations.find((z) => z.id === q!.parentId)) chain.splice(1, 0, s.populations.find((z) => z.id === q!.parentId) ?? null);
        const ancW = ANC_PX * (PLOT.w / PLOT.h);
        let ox = PLOT.w + adj + ANC_GAP, oy = PLOT.h + adj + ANC_GAP;
        for (const anc of chain) {
          const path = anc ? populationPath(s.populations, anc.id) : '';
          const saved = ws.plots?.[path];
          const ax = makeAxis(chans, m.keywords, ws.channelTransforms, saved?.x ?? item.x);
          const ay = makeAxis(chans, m.keywords, ws.channelTransforms, saved?.y ?? item.y ?? '');
          const at = item.ancestryVertical ? { x: 0, y: oy } : { x: ox, y: adj + (PLOT.h - ANC_PX) / 2 };
          if (item.ancestryVertical) oy += ANC_PX + ANC_GAP; else ox += ancW + ANC_GAP;
          if (!ax || !ay) continue;
          const reqA = (pid: string | null, mp: number) => client.plot({ ...base, popId: pid, x: { kind: 'channel', channel: ax.channel, transform: ax.spec }, y: { kind: 'channel', channel: ay.channel, transform: ay.spec }, bins: 160, xRange: ax.range, yRange: ay.range, maxPoints: mp });
          const ad = await reqA(anc?.id ?? null, 5000);
          const ov = item.backgating && !item.backgateContours ? [{ label: label, data: await reqA(pop?.id ?? null, 3000) }] : [];
          const mini = document.createElement('canvas');
          mini.width = PLOT.w; mini.height = PLOT.h;
          const mctx = mini.getContext('2d')!;
          renderPlot(mctx, { kind: 'pseudocolor', x: ax, y: ay, data: ad, gates: drawableGates(s.populations, anc?.id ?? null, ax, ay).filter((g) => { const gp = populationPath(s.populations, g.pop.id); return item.populationPath === gp || item.populationPath.startsWith(`${gp}/`); }), counts: counts.get(s.id)!, overlays: ov, overlayLarge: item.backgateLarge, xTitle: title(ax.channel), yTitle: title(ay.channel), axes: 'lL' });
          if (item.backgating && item.backgateContours) {
            // Show Contours: the backgated population as contour lines over the chart.
            const cd = await reqA(pop?.id ?? null, 0);
            const c2 = document.createElement('canvas');
            c2.width = PLOT.w; c2.height = PLOT.h;
            renderPlot(c2.getContext('2d')!, { kind: 'contour', x: ax, y: ay, data: cd, gates: [], counts: {}, axes: 'lL' });
            mctx.globalCompositeOperation = 'multiply';
            mctx.drawImage(c2, 0, 0);
            mctx.globalCompositeOperation = 'source-over';
          }
          ctx.drawImage(mini, item.ancestryVertical ? (PLOT.w - ancW) / 2 : at.x, at.y, ancW, ANC_PX);
        }
      }
      const mg = multigraphCells(item);
      if (mg.cols) {
        const params = (item.multiParams ?? []).slice(0, MG_LIMIT).map((ch) => makeAxis(chans, m.keywords, ws.channelTransforms, ch)).filter((a): a is NonNullable<typeof a> => !!a);
        const cw = MG_PX * (PLOT.w / PLOT.h);
        const x0 = size.w - mg.cols * cw;
        const k2 = item.multiKind ?? 'pseudocolor';
        const cell = async (r: number, c: number, ax: NonNullable<typeof x>, ay: NonNullable<typeof x> | null) => {
          const d = await client.plot({ ...base, popId: pop?.id ?? null, x: { kind: 'channel', channel: ax.channel, transform: ax.spec }, y: ay ? { kind: 'channel', channel: ay.channel, transform: ay.spec } : null, bins: ay ? 120 : 128, xRange: ax.range, yRange: ay ? ay.range : null, maxPoints: ay && k2 === 'dot' ? 3000 : 0 });
          const mini = document.createElement('canvas');
          mini.width = PLOT.w; mini.height = PLOT.h;
          renderPlot(mini.getContext('2d')!, { kind: ay ? k2 : 'histogram', x: ax, y: ay, data: d, gates: [], counts: {}, xTitle: title(ax.channel), yTitle: ay ? title(ay.channel) : undefined, axes: 'lL' });
          ctx.drawImage(mini, x0 + c * cw, r * MG_PX, cw, MG_PX);
        };
        if (item.multigraph === 'nxn' || item.multigraph === 'halfnxn') {
          for (let r = 0; r < params.length; r++) for (let c = 0; c < params.length; c++) if (item.multigraph === 'nxn' || c <= r) await cell(r, c, params[c], r === c ? null : params[r]);
        } else if (item.multigraph === 'allby' && y) {
          let k = 0;
          for (const pa of params) if (pa.channel !== y.channel) await cell(0, k++, pa, y);
        } else if (item.multigraph === 'slinky') {
          // Slinky: every parameter's histogram, normalised to its mode, stacked with an offset.
          const W = mg.cols * cw, H = mg.rows * MG_PX, step = (H - 20) / Math.max(1, params.length + 1);
          ctx.font = '10px sans-serif';
          for (const [k, pa] of params.entries()) {
            const d = await client.plot({ ...base, popId: pop?.id ?? null, x: { kind: 'channel', channel: pa.channel, transform: pa.spec }, y: null, bins: 128, xRange: pa.range, yRange: null, maxPoints: 0 });
            const mx = Math.max(1, ...Array.from(d.density));
            const baseY = H - 10 - k * step;
            ctx.strokeStyle = `hsl(${(k * 47) % 360} 60% 40%)`; ctx.lineWidth = 1.2; ctx.beginPath();
            for (let i = 0; i < d.bins; i++) { const X = x0 + 30 + (i / d.bins) * (W - 40), Y = baseY - (d.density[i] / mx) * step * 2; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
            ctx.stroke();
            ctx.fillStyle = ctx.strokeStyle; ctx.fillText(title(pa.channel), x0 + 2, baseY - 2, 28);
          }
        } else {
          for (let k = 0; k < params.length; k++) await cell(Math.floor(k / mg.cols), k % mg.cols, params[k], null);
        }
      }
      cv = comp;
    }
    out.push({ item, canvas: cv, options, title: `${s.fileName} / ${label} (${data.count.toLocaleString()} events)` });
  }
  return out;
}

// Background, outline, shape, text or image of a non-chart figure, and the
// fill / outline of a chart's box (Figure Properties), in layout points.
function drawFig(ctx: CanvasRenderingContext2D, it: LayoutItem, b: Box, r: Rendered | undefined) {
  paintFigFrame(ctx, it, b);
  if (it.text !== undefined) {
    ctx.fillStyle = it.color ?? '#111';
    ctx.font = textFont(it);
    const sz = it.size ?? 11;
    wrapText(r?.text ?? it.text, b.w - 8, sz).forEach((ln, k) => ctx.fillText(ln, b.x + 4, b.y + sz + 3 + k * Math.round(sz * 1.27)));
  } else if (it.image !== undefined) {
    if (r?.canvas) ctx.drawImage(r.canvas, b.x, b.y, b.w, b.h);
    else { ctx.strokeStyle = '#999'; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.fillText(r?.error ?? 'image', b.x + 4, b.y + 14); }
  }
}
const drawPlaceholder = (ctx: CanvasRenderingContext2D, b: Box, label: string) => { ctx.fillStyle = '#f3f3f3'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeStyle = '#999'; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.fillStyle = '#666'; ctx.font = '10px sans-serif'; ctx.fillText(label, b.x + 6, b.y + 16, b.w - 12); };

// The whole layout as pages: one canvas covering cols x rows pages (points x
// scale), items drawn in z-order at their boxes. transparent: no white page.
export function composePages(rendered: Rendered[], items: LayoutItem[], page: { w: number; h: number }, scale = 2, transparent = false): { canvas: HTMLCanvasElement; cols: number; rows: number } {
  const boxes = items.map(boxOf);
  const { cols, rows } = pageGrid(boxes, page);
  const cv = document.createElement('canvas');
  cv.width = Math.round(cols * page.w * scale);
  cv.height = Math.round(rows * page.h * scale);
  const ctx = cv.getContext('2d')!;
  if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.scale(scale, scale);
  items.forEach((it, i) => {
    const b = boxes[i];
    const r = rendered.find((x) => x.item.id === it.id);
    if (!isPlotItem(it)) return drawFig(ctx, it, b, r);
    ctx.fillStyle = '#111';
    if (it.showAnnotation && r) { ctx.font = '9px sans-serif'; ctx.fillText(r.title, b.x, b.y - 4, b.w); }
    if (r?.placeholder) drawPlaceholder(ctx, b, r.title);
    else if (r?.canvas) ctx.drawImage(r.canvas, b.x, b.y, b.w, b.h);
    else { ctx.fillStyle = '#b00020'; ctx.font = '10px sans-serif'; ctx.fillText(r?.error ?? 'not rendered', b.x + 8, b.y + 20, b.w - 16); }
    if (it.style) paintFigFrame(ctx, { ...it, style: { ...it.style, fill: undefined } }, b);
  });
  return { canvas: cv, cols, rows };
}

// One canvas per page, row by row (the PDF pages).
export function splitPages(all: { canvas: HTMLCanvasElement; cols: number; rows: number }, page: { w: number; h: number }, scale = 2): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let r = 0; r < all.rows; r++) for (let c = 0; c < all.cols; c++) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(page.w * scale);
    cv.height = Math.round(page.h * scale);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(all.canvas, -c * page.w * scale, -r * page.h * scale);
    out.push(cv);
  }
  return out;
}

// H1: each page on the whole paper with the header in the top margin and the
// footer in the bottom margin (left and right parts).
export function withHeaderFooter(pages: HTMLCanvasElement[], paper: { w: number; h: number }, hf: HeaderFooter, doc: string, scale = 2): HTMLCanvasElement[] {
  const d = { ...DEFAULT_HEADER_FOOTER, ...hf };
  return pages.map((pg, k) => {
    const cv = document.createElement('canvas');
    cv.width = Math.round(paper.w * scale); cv.height = Math.round(paper.h * scale);
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(pg, MARGIN * scale, MARGIN * scale, (paper.w - 2 * MARGIN) * scale, (paper.h - 2 * MARGIN) * scale);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#111'; ctx.font = '9px sans-serif';
    const t = (s: string) => headerText(s, { document: doc, page: k + 1, version: 'flowjo-rea' });
    const line = (y: number, left: string, right: string) => { ctx.textAlign = 'left'; ctx.fillText(t(left), MARGIN, y); ctx.textAlign = 'right'; ctx.fillText(t(right), paper.w - MARGIN, y); ctx.textAlign = 'left'; };
    if (d.header) line(MARGIN / 2, d.headerLeft, d.headerRight);
    if (d.footer) line(paper.h - MARGIN / 2, d.footerLeft, d.footerRight);
    return cv;
  });
}

// The same pages as one SVG document with vector plots and shapes.
export function composeSvgPages(rendered: Rendered[], items: LayoutItem[], page: { w: number; h: number }): string {
  const boxes = items.map(boxOf);
  const { cols, rows } = pageGrid(boxes, page);
  const svg = new SvgContext(Math.round(cols * page.w), Math.round(rows * page.h));
  items.forEach((it, i) => {
    const b = boxes[i];
    const r = rendered.find((x) => x.item.id === it.id);
    if (it.image !== undefined) {
      paintFigFrame(asCanvas(svg), it, b);
      if (r?.canvas) svg.embed(`<image x="0" y="0" width="${b.w}" height="${b.h}" preserveAspectRatio="none" href="${r.canvas.toDataURL()}"/>`, b.x, b.y);
      return;
    }
    if (!isPlotItem(it)) return drawFig(asCanvas(svg), it, b, r);
    svg.fillStyle = '#111';
    if (it.showAnnotation && r) { svg.font = '9px sans-serif'; svg.fillText(r.title, b.x, b.y - 4); }
    if (r?.options && !multigraphCells(it).cols && !it.ancestry && !it.adjunct) {
      const sub = new SvgContext(PLOT.w, PLOT.h);
      renderPlot(asCanvas(sub), r.options);
      svg.embed(sub.body(), b.x, b.y, b.w / PLOT.w);
    } else if (r?.canvas) svg.embed(`<image x="0" y="0" width="${b.w}" height="${b.h}" preserveAspectRatio="none" href="${r.canvas.toDataURL()}"/>`, b.x, b.y);
    else if (r?.placeholder) drawPlaceholder(asCanvas(svg), b, r.title);
    else { svg.fillStyle = '#b00020'; svg.font = '10px sans-serif'; svg.fillText(r?.error ?? 'not rendered', b.x + 8, b.y + 20); }
    if (it.style) paintFigFrame(asCanvas(svg), { ...it, style: { ...it.style, fill: undefined } }, b);
  });
  return svg.toString();
}

const ALIGN: { mode: AlignMode; label: string; key: string }[] = [
  { mode: 'left', label: 'Left', key: 'l' }, { mode: 'hcenter', label: 'Center', key: '' }, { mode: 'right', label: 'Right', key: 'r' },
  { mode: 'top', label: 'Top', key: 't' }, { mode: 'vcenter', label: 'Middle', key: 'm' }, { mode: 'bottom', label: 'Bottom', key: 'b' },
];

// The layout editor's clipboard (Copy / Cut / Paste within and between layouts).
let clipboard: LayoutItem[] = [];
const newFigId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const FONT_NAMES = ['SansSerif', 'Serif', 'Monospaced'];

export function LayoutView(p: {
  ws: Workspace;
  meta: Record<string, SampleMeta>;
  samples: SampleState[];
  client: Client;
  onChange: (items: LayoutItem[]) => void;
  onSettings: (patch: Partial<Workspace>) => void;
  onDownload: (name: string, blob: Blob) => void;
  onClose: () => void;
  onOpenGraph?: (sampleId: string, populationPath: string) => void;
}) {
  const items = useMemo(() => p.ws.layout ?? [], [p.ws.layout]);
  const setup = p.ws.layoutPage ?? DEFAULT_PAGE;
  const page = scaledPage(setup);
  const pageScale = setup.scale && setup.scale > 0 ? setup.scale : 1;
  const iter: LayoutIteration = p.ws.layoutIteration ?? { type: 'OFF' };
  const loaded = p.samples.filter((s) => p.meta[s.id]);
  const kw = (s: SampleState, k: string) => s.keywordsSnapshot[k.toUpperCase()] ?? s.keywordsSnapshot[k] ?? s.annotations?.[k];
  const values = iter.type === 'OFF' ? loaded.map((s) => s.id) : iterationValues(iter, loaded, kw);
  const [value, setValue] = useState(values[0] ?? '');
  const cur = values.includes(value) ? value : values[0] ?? '';
  const [sel, setSel] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [showBreaks, setShowBreaks] = useState(true);
  const [showRulers, setShowRulers] = useState(false);
  const [placeholders, setPlaceholders] = useState(false);
  // P7: guides off by default; S5: one vertical and one horizontal guide at 250 pt.
  const [showGuides, setShowGuides] = useState(false);
  const guides = p.ws.layoutGuides ?? DEFAULT_GUIDES;
  const [guideDrag, setGuideDrag] = useState<{ axis: 'v' | 'h'; i: number; at: number } | null>(null);
  const [rendered, setRendered] = useState<Rendered[]>([]);
  const [busy, setBusy] = useState(false);
  const [batchFormat, setBatchFormat] = useState<'png' | 'svg' | 'pdf'>('pdf');
  const [tileCols, setTileCols] = useState(0);
  const [tileOrder, setTileOrder] = useState<'across' | 'down'>('across');
  const [tileFixed, setTileFixed] = useState<'cols' | 'rows'>('cols');
  const [separatePages, setSeparatePages] = useState(true);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<{ x0: number; y0: number; dx: number; dy: number; ids: string[] } | null>(null);
  const [resize, setResize] = useState<{ id: string; handle: number; box: Box } | null>(null);
  const [gridRows, setGridRows] = useState(3), [gridCols, setGridCols] = useState(4);
  const [gridBare, setGridBare] = useState(true);
  const [showChars, setShowChars] = useState(false);
  const [showHF, setShowHF] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const layoutName = p.ws.layoutName ?? DEFAULT_LAYOUT_NAME;
  const hf = { ...DEFAULT_HEADER_FOOTER, ...(p.ws.layoutHeaderFooter ?? {}) };

  const bindFor = (v: string): Bind => (it) => {
    if (!isPlotItem(it)) return undefined;
    const valueSample = loaded.find((s) => s.id === v);
    if (iter.type === 'OFF' || !values.length) return loaded.find((s) => s.id === it.sampleId) ?? valueSample;
    return bindSample(it.sampleId ?? valueSample?.id, iter, v, loaded, kw);
  };
  // The sample live text shows for a value: the value's sample, or for keyword
  // iteration the first sample with that keyword value.
  const valueSampleFor = (v: string) => loaded.find((s) => s.id === v) ?? (iter.type === 'KEYWORD' ? loaded.find((s) => kw(s, iter.keyword) === v) : undefined) ?? loaded[0];
  const extrasFor = (v: string) => ({ valueSample: valueSampleFor(v), placeholders, title: layoutName });

  useEffect(() => {
    let live = true;
    renderLayout(p.client, p.ws, p.meta, items, bindFor(cur), extrasFor(cur)).then((r) => live && setRendered(r)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [cur, p.ws, p.meta, placeholders]); // eslint-disable-line react-hooks/exhaustive-deps

  const boxes = items.map(boxOf);
  // Selecting a grouped item selects its group (FigGroup is one figure).
  const expand = (ids: string[]) => { const gs = new Set(boxes.filter((b) => ids.includes(b.id) && b.groupId).map((b) => b.groupId)); return [...new Set([...ids, ...boxes.filter((b) => b.groupId && gs.has(b.groupId)).map((b) => b.id)])]; };
  const selBoxes = boxes.filter((b) => sel.includes(b.id));
  const selItems = items.filter((i) => sel.includes(i.id));
  const commit = (next: Box[]) => {
    const out = items.map((it) => { const b = next.find((x) => x.id === it.id); return b ? withBox(it, b) : it; });
    // A moved grid figure carries its grid with it.
    const moved = grids.map((g) => { const it = out.find((x) => x.cell?.grid === g.id && next.some((b) => b.id === x.id)); if (!it || !it.cell) return g; const o = cellOrigin(g, it.cell.row, it.cell.col); return { ...g, x: g.x + (it.left ?? 0) - o.x, y: g.y + (it.top ?? 0) - o.y }; });
    if (moved.some((g, i) => g !== grids[i])) p.onSettings({ layout: out, layoutGrids: moved }); else p.onChange(out);
  };
  // Arrange on "units": a group acts as one figure, its members follow.
  const arrange = (fn: (units: Box[]) => Box[]) => {
    const units: { box: Box; members: Box[] }[] = [];
    for (const b of selBoxes) {
      if (b.groupId) { if (units.some((u) => u.box.id === b.groupId)) continue; const members = boxes.filter((x) => x.groupId === b.groupId); units.push({ box: unionBox(members, b.groupId), members }); } else units.push({ box: b, members: [b] });
    }
    const moved = fn(units.map((u) => u.box));
    commit(units.flatMap((u, i) => u.members.map((m) => ({ ...m, x: m.x + moved[i].x - u.box.x, y: m.y + moved[i].y - u.box.y }))));
  };
  const reorder = (fn: (order: string[]) => string[]) => { const order = fn(items.map((i) => i.id)); p.onChange(order.map((id) => items.find((i) => i.id === id)!)); };
  const remove = () => { p.onChange(items.filter((i) => !sel.includes(i.id))); setSel([]); };
  // Copies of figures with new ids (groups get new group ids), moved by (dx, dy).
  const copiesOf = (src: LayoutItem[], dx: number, dy: number) => {
    const stamp = Date.now().toString(36);
    const gmap = new Map<string, string>();
    return src.map((it, k) => {
      const b = boxOf(it, k);
      const g = it.groupId ? gmap.get(it.groupId) ?? gmap.set(it.groupId, `grp_${stamp}_${k}`).get(it.groupId) : undefined;
      return { ...withBox(it, { ...b, x: b.x + dx, y: b.y + dy }), id: `${it.id.replace(/_[dp][0-9a-z]+$/, '')}_d${stamp}${k}`, groupId: g, cell: undefined, locked: undefined } as LayoutItem;
    });
  };
  const duplicate = () => {
    const copies = copiesOf(selItems, DUPLICATE_OFFSET, DUPLICATE_OFFSET);
    p.onChange([...items, ...copies]);
    setSel(copies.map((c) => c.id));
  };
  // C1: Copy takes the selection, or every figure when nothing is selected.
  const copy = () => { clipboard = JSON.parse(JSON.stringify(sel.length ? selItems : items)) as LayoutItem[]; };
  const cut = () => { if (!sel.length) return; copy(); remove(); };
  const visibleRect = (): Box => {
    const el = scrollRef.current;
    return el ? { id: 'v', x: el.scrollLeft / zoom, y: el.scrollTop / zoom, w: el.clientWidth / zoom, h: el.clientHeight / zoom } : { id: 'v', x: 0, y: 0, w: page.w, h: page.h };
  };
  const paste = () => {
    if (!clipboard.length) return;
    const u = unionBox(clipboard.map(boxOf));
    const { dx, dy } = pasteOffset(u, visibleRect());
    const copies = copiesOf(clipboard, dx, dy);
    p.onChange([...items, ...copies]);
    setSel(copies.map((c) => c.id));
  };
  // Paste from the system clipboard: an image becomes an image figure, text a
  // text figure, both at (30, 50) (LEPasteAction.paste).
  const pasteSystem = async () => {
    try {
      const data = await navigator.clipboard.read();
      for (const ci of data) {
        const t = ci.types.find((x) => x.startsWith('image/'));
        if (t) { const url = await blobUrl(await ci.getType(t)); return addImageFig(url); }
        if (ci.types.includes('text/plain')) { const txt = await (await ci.getType('text/plain')).text(); if (txt) return addText(txt); }
      }
    } catch { /* no system clipboard access: the layout clipboard only */ }
  };
  const blobUrl = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });
  // C3-C4: Copy Selection With / Without Transparency: the selection (or all) as
  // a PNG image on the system clipboard, transparent or on white.
  const copyImage = async (transparent: boolean) => {
    const its = sel.length ? selItems : items;
    if (!its.length) return;
    const u = unionBox(its.map(boxOf));
    const shifted = its.map((it) => { const b = boxOf(it, 0); return withBox(it, { ...b, x: b.x - u.x, y: b.y - u.y }); });
    const all = composePages(rendered.map((r) => ({ ...r, item: shifted.find((s) => s.id === r.item.id) ?? r.item })), shifted, { w: u.w, h: u.h }, 2, transparent);
    const blob = await new Promise<Blob | null>((res) => all.canvas.toBlob(res, 'image/png'));
    if (!blob) return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setError(''); } catch { p.onDownload(`${layoutName}_selection.png`, blob); }
  };
  const group = () => {
    const gid = `grp_${Date.now().toString(36)}`;
    // A20: the group goes on top of the z-order.
    const members = items.filter((i) => sel.includes(i.id)).map((i) => ({ ...withBox(i, boxOf(i, items.indexOf(i))), groupId: gid }));
    p.onChange([...items.filter((i) => !sel.includes(i.id)), ...members]);
  };
  const ungroup = () => p.onChange(items.map((i) => (sel.includes(i.id) ? { ...withBox(i, boxOf(i, items.indexOf(i))), groupId: undefined } : i)));
  // LELockAction: the first selected figure's lock decides; all selected follow.
  const toggle = (key: 'locked' | 'sizeLock' | 'contentLock') => { const on = !selItems[0]?.[key]; p.onChange(items.map((i) => (sel.includes(i.id) ? ({ ...withBox(i, boxOf(i, items.indexOf(i))), [key]: on || undefined } as LayoutItem) : i))); };
  const setItem = (id: string, patch: Partial<LayoutItem>) => p.onChange(items.map((i) => (i.id === id ? ({ ...i, ...patch } as LayoutItem) : i)));
  // Figure Properties apply to every selected figure (LEColorAction, LEFigPropAction).
  const setStyle = (patch: Partial<FigStyle>) => p.onChange(items.map((i) => (sel.includes(i.id) ? ({ ...i, style: { ...(i.style ?? {}), ...patch } } as LayoutItem) : i)));
  const addFig = (it: LayoutItem) => { p.onChange([...items, it]); setSel([it.id]); };
  const addText = (text = 'New text') => addFig({ id: newFigId('txt'), text, left: PASTE_TEXT_POINT.x, top: PASTE_TEXT_POINT.y, width: TEXT_W, height: TEXT_H }); // P11: text at (30, 50)
  // Drawing tools: a new shape at (30, 50), 144 x 72 pt (a line 144 pt long);
  // resize it with its corner handles (own placement; FlowJo draws by dragging).
  const addShape = (shape: LayoutShape['shape'], arrow?: LayoutShape['arrow']) => addFig({ id: newFigId('shp'), shape, left: 30, top: 50, width: 144, height: shape === 'line' ? 0 : 72, ...(shape === 'line' ? { ends: [0, 0, 1, 0] as [number, number, number, number] } : {}), ...(arrow ? { arrow } : {}) });
  // Insert Graphic / pasted image (FigImage): at (30, 50), its own size in points.
  const addImageFig = async (url: string) => {
    const im = await new Promise<HTMLImageElement>((res, rej) => { const x = new Image(); x.onload = () => res(x); x.onerror = rej; x.src = url; }).catch(() => null);
    addFig({ id: newFigId('img'), image: url, left: 30, top: 50, width: im?.naturalWidth || 100, height: im?.naturalHeight || 100 });
  };

  const step = (d: number) => { const i = values.indexOf(cur); const j = d === Infinity ? values.length - 1 : d === -Infinity ? 0 : i + d; if (values[j]) setValue(values[j]); };
  const fit = () => { const el = scrollRef.current; if (!el || !items.length) return setZoom(1); const u = unionBox(boxes); setZoom(zoomFit({ w: el.clientWidth, h: el.clientHeight }, { w: u.x + u.w, h: u.y + u.h })); };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'Escape') return;
    e.stopPropagation();
    const menu = e.ctrlKey || e.metaKey;
    if (e.key.startsWith('Arrow') && sel.length) {
      e.preventDefault();
      const k = nudgeStep(e.altKey, menu, e.shiftKey);
      const dx = e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0, dy = e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0;
      return commit(nudge(selBoxes, dx, dy));
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); return remove(); }
    // I9: PageDown next value, PageUp previous, Home first, End last.
    if (e.key === 'PageDown') { e.preventDefault(); return step(1); }
    if (e.key === 'PageUp') { e.preventDefault(); return step(-1); }
    if (e.key === 'Home') { e.preventDefault(); return step(-Infinity); }
    if (e.key === 'End') { e.preventDefault(); return step(Infinity); }
    if (menu) {
      const k = e.key.toLowerCase();
      if (k === 'a') { e.preventDefault(); return setSel(items.map((i) => i.id)); }
      if (k === 'c') { e.preventDefault(); return e.shiftKey ? void copyImage(true) : copy(); }
      if (k === 'x') { e.preventDefault(); return cut(); }
      if (k === 'v') { e.preventDefault(); return clipboard.length ? paste() : void pasteSystem(); }
      if (k === '=' || k === '+') { e.preventDefault(); return setZoom(zoomIn(zoom)); }
      if (k === '-') { e.preventDefault(); return setZoom(zoomOut(zoom)); }
      if (k === 'o' && selected && isPlotItem(selected)) { e.preventDefault(); return openGraph(); }
    }
    if (menu && sel.length) {
      // A12 (AlignableLayerDiagram.processAlignKey): L T R B M, K vertical, J horizontal spacing.
      const a = ALIGN.find((x) => x.key && x.key === e.key.toLowerCase());
      if (a) { e.preventDefault(); return arrange((u) => align(u, a.mode)); }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); return arrange((u) => spacing(u, 'v')); }
      if (e.key.toLowerCase() === 'j') { e.preventDefault(); return arrange((u) => spacing(u, 'h')); }
      if (e.key.toLowerCase() === 'd') { e.preventDefault(); return duplicate(); }
    }
  };

  const ptAt = (e: React.MouseEvent) => { const r = pageRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; };
  const onItemDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    pageRef.current?.focus({ preventScroll: true });
    const pt = ptAt(e);
    // R1: a corner handle of a selected, size-unlocked figure starts a resize.
    const b = boxes.find((x) => x.id === id)!;
    const it = items.find((x) => x.id === id)!;
    const h = handleAt(b, pt);
    if (sel.length === 1 && sel[0] === id && isCornerHandle(h) && !it.sizeLock) { setResize({ id, handle: h, box: b }); return; }
    let next = sel;
    if (e.shiftKey || e.ctrlKey || e.metaKey) next = sel.includes(id) ? sel.filter((x) => !expand([id]).includes(x)) : expand([...sel, id]);
    else if (!sel.includes(id)) next = expand([id]);
    setSel(next);
    setDrag({ x0: pt.x, y0: pt.y, dx: 0, dy: 0, ids: next.filter((x) => !boxes.find((bb) => bb.id === x)?.locked) });
  };
  const onMove = (e: React.MouseEvent) => {
    const pt = ptAt(e);
    if (guideDrag) return setGuideDrag({ ...guideDrag, at: Math.round(guideDrag.axis === 'v' ? pt.x : pt.y) });
    if (resize) {
      const it = items.find((x) => x.id === resize.id)!;
      const orig = boxes.find((x) => x.id === resize.id)!;
      return setResize({ ...resize, box: resizeBox(orig, resize.handle, pt, (e.shiftKey && !e.ctrlKey) || !!it.aspectLock) });
    }
    if (!drag) return;
    let dx = Math.round(pt.x - drag.x0), dy = Math.round(pt.y - drag.y0);
    const moving = boxes.filter((b) => drag.ids.includes(b.id));
    if (showGuides && moving.length) ({ dx, dy } = snapToGuides(unionBox(moving), dx, dy, guides)); // S4
    setDrag({ ...drag, dx, dy });
  };
  const onUp = () => {
    if (guideDrag) {
      // A guide dragged off the page is removed.
      const list = [...guides[guideDrag.axis]];
      if (guideDrag.at < 0) list.splice(guideDrag.i, 1); else list[guideDrag.i] = guideDrag.at;
      p.onSettings({ layoutGuides: { ...guides, [guideDrag.axis]: list } });
      setGuideDrag(null);
      return;
    }
    if (resize) { const o = boxes.find((x) => x.id === resize.id)!; if (o.x !== resize.box.x || o.y !== resize.box.y || o.w !== resize.box.w || o.h !== resize.box.h) commit([resize.box]); setResize(null); return; }
    if (drag && (drag.dx || drag.dy)) commit(boxes.filter((b) => drag.ids.includes(b.id)).map((b) => ({ ...b, x: Math.max(0, b.x + drag.dx), y: Math.max(0, b.y + drag.dy) })));
    setDrag(null);
  };

  const view = (b: Box) => (resize?.id === b.id ? resize.box : drag?.ids.includes(b.id) ? { ...b, x: b.x + drag.dx, y: b.y + drag.dy } : b);
  const grid = pageGrid(boxes, page);
  const W = grid.cols * page.w, H = grid.rows * page.h;
  const safe = (s: string) => s.replace(/\.fcs$/i, '').replace(/[^\w.-]+/g, '_');
  const valueLabel = (v: string) => (iter.type === 'KEYWORD' ? v : loaded.find((s) => s.id === v)?.fileName ?? v);
  const paper = PAPERS[setup.paper];
  const paperSize = setup.orientation === 'landscape' ? { w: paper.h, h: paper.w } : { w: paper.w, h: paper.h };
  const toBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  const exportAs = async (fmt: 'png' | 'svg' | 'pdf', name: string, r: Rendered[], its: LayoutItem[]) => {
    if (fmt === 'svg') return p.onDownload(`${name}.svg`, new Blob([composeSvgPages(r, its, page)], { type: 'image/svg+xml' }));
    const k = 2 / pageScale;
    const all = composePages(r, its, page, k);
    if (fmt === 'png') return p.onDownload(`${name}.png`, await toBlob(all.canvas));
    const pages = splitPages(all, page, k);
    // H1: with a header or footer, each PDF page is the whole paper.
    if (hf.header || hf.footer) return p.onDownload(`${name}.pdf`, new Blob([await canvasesToPdf(withHeaderFooter(pages, paperSize, hf, layoutName), paperSize.w, paperSize.h, 0)], { type: 'application/pdf' }));
    p.onDownload(`${name}.pdf`, new Blob([await canvasesToPdf(pages, paperSize.w, paperSize.h, MARGIN)], { type: 'application/pdf' }));
  };
  // Grid figures (FigGridLayout; specs 25.2): a grid object (rows, columns,
  // padding, cell size) whose cells hold the items, row by row. By default the
  // cells hold bare charts and only the border shows axes; the cells form one group.
  const grids = p.ws.layoutGrids ?? [];
  // Re-place a grid's cells and their border axes; one undo step with the grid list.
  const applyGrids = (nextGrids: GridDef[], base: LayoutItem[], released: string[] = [], removed: string[] = []) => {
    const out = base.filter((it) => !removed.includes(it.id)).map((it) => {
      if (released.includes(it.id)) { const { cell: _c, groupId: _g, ...rest } = it; void _c; void _g; return { ...rest, axes: undefined } as LayoutItem; }
      const g = it.cell && nextGrids.find((x) => x.id === it.cell!.grid);
      if (!g || !it.cell) return it;
      const cells: CellRef[] = base.filter((x) => x.cell?.grid === g.id && !removed.includes(x.id) && !released.includes(x.id)).map((x) => ({ id: x.id, ...x.cell! }));
      const o = cellOrigin(g, it.cell.row, it.cell.col);
      const b0 = boxOf(it, base.indexOf(it));
      return { ...it, left: o.x, top: o.y, width: b0.w, height: b0.h, groupId: g.id, ...(isPlotItem(it) ? { axes: borderAxes(g, { id: it.id, ...it.cell }, cells) } : {}) } as LayoutItem;
    });
    p.onSettings({ layout: out, layoutGrids: nextGrids });
  };
  const makeGrid = () => {
    const ordered = [...selBoxes].sort((a, b) => a.y - b.y || a.x - b.x);
    const g: GridDef = { id: `grid_${Date.now().toString(36)}`, x: Math.min(...ordered.map((b) => b.x)), y: Math.min(...ordered.map((b) => b.y)), rows: gridRows, cols: gridCols, pad: 4, cellW: Math.max(...ordered.map((b) => b.w)), cellH: Math.max(...ordered.map((b) => b.h)), bare: gridBare };
    const fitIn = ordered.slice(0, g.rows * g.cols);
    const base = items.map((it) => { const k = fitIn.findIndex((b) => b.id === it.id); return k < 0 ? it : ({ ...it, cell: { grid: g.id, row: Math.floor(k / g.cols), col: k % g.cols } } as LayoutItem); });
    applyGrids([...grids, g], base);
    if (ordered.length > fitIn.length) setError(`${ordered.length - fitIn.length} item(s) did not fit the ${g.rows} x ${g.cols} grid`);
  };
  // The grid of the first selected cell, and that cell.
  const selCell = items.find((i) => sel.includes(i.id) && i.cell)?.cell;
  const selGrid = selCell ? grids.find((g) => g.id === selCell.grid) : undefined;
  const cellsOf = (g: GridDef): CellRef[] => items.filter((x) => x.cell?.grid === g.id).map((x) => ({ id: x.id, ...x.cell! }));
  const withCells = (g: GridDef, cells: CellRef[]) => items.map((it) => { const c = cells.find((x) => x.id === it.id); return c ? ({ ...it, cell: { grid: g.id, row: c.row, col: c.col } } as LayoutItem) : it; });
  const gridOp = (op: 'insertRow' | 'insertCol' | 'deleteRow' | 'deleteCol') => {
    if (!selGrid || !selCell) return;
    const cells = cellsOf(selGrid);
    const r = op === 'insertRow' ? gridInsert(selGrid, cells, 'row', selCell.row) : op === 'insertCol' ? gridInsert(selGrid, cells, 'col', selCell.col) : gridDelete(selGrid, cells, op === 'deleteRow' ? 'row' : 'col', op === 'deleteRow' ? selCell.row : selCell.col);
    const removed: string[] = 'removed' in r ? (r as { removed: string[] }).removed : [];
    applyGrids(grids.map((g) => (g.id === selGrid.id ? r.grid : g)), withCells(r.grid, r.cells), [], removed);
    if (removed.length) setSel([]);
  };
  const setGrid = (patch: Partial<GridDef>) => {
    if (!selGrid) return;
    const cells = cellsOf(selGrid);
    if (patch.rows !== undefined || patch.cols !== undefined) {
      const r = gridResize(selGrid, cells, patch.rows ?? selGrid.rows, patch.cols ?? selGrid.cols);
      return applyGrids(grids.map((g) => (g.id === selGrid.id ? { ...r.grid, ...patch, rows: r.grid.rows, cols: r.grid.cols } : g)), withCells(r.grid, r.cells), r.released);
    }
    applyGrids(grids.map((g) => (g.id === selGrid.id ? { ...g, ...patch } : g)), items);
  };
  // Autofit Cells: cells as large as the largest content.
  const autofit = () => { if (!selGrid) return; const bs = items.filter((x) => x.cell?.grid === selGrid.id).map((x) => boxOf(x, items.indexOf(x))); if (bs.length) setGrid({ cellW: Math.max(...bs.map((b) => b.w)), cellH: Math.max(...bs.map((b) => b.h)) }); };
  // Clear Cells: the selected cells' contents are removed; the cells stay.
  const clearCells = () => { if (!selGrid) return; applyGrids(grids, items, [], items.filter((x) => sel.includes(x.id) && x.cell?.grid === selGrid.id).map((x) => x.id)); setSel([]); };
  // Extract Cells from Grid: the grid goes, each figure stays where it is.
  const extractGrid = () => { if (!selGrid) return; p.onSettings({ layoutGrids: grids.filter((g) => g.id !== selGrid.id), layout: items.map((it) => (it.cell?.grid === selGrid.id ? ({ ...it, cell: undefined, groupId: undefined } as LayoutItem) : it)) }); };
  const selected = items.find((i) => i.id === sel[0]);
  const selPlot = selected && isPlotItem(selected) ? selected : undefined;
  // Parameters offered to Multigraph: the first loaded sample's fluorescence channels.
  const allParams = loaded[0] ? p.meta[loaded[0].id]?.channels.map((c) => c.name) ?? [] : [];
  const graphParams = allParams.filter((n) => !/^(FSC|SSC|Time)/i.test(n));
  // Populations offered for a chart: the paths of its bound sample (else the first).
  const popSample = selPlot ? bindFor(cur)(selPlot) ?? loaded[0] : loaded[0];
  const popPaths = popSample ? ['', ...popSample.populations.map((q) => populationPath(popSample.populations, q.id))] : [''];
  const enabled = (n: number) => sel.length >= n;
  const locked = !!selected?.contentLock;
  // Open Original Graph (LENavAction OPENGRAPH): the chart's population in its graph window.
  const openGraph = () => { if (!selPlot) return; const s = bindFor(cur)(selPlot); if (s && p.onOpenGraph) p.onOpenGraph(s.id, selPlot.populationPath); };
  // Change a chart's population or axes after placement (ChartCommand.XAXIS / YAXIS; drop a population).
  const setPlot = (patch: Partial<LayoutPlot>) => { if (!selPlot) return; const next = { ...selPlot, ...patch }; const sz = graphBoxSize(next); setItem(selPlot.id, { ...patch, ...(patch.multigraph !== undefined || patch.multiParams || patch.ancestry !== undefined || patch.ancestryVertical !== undefined || patch.adjunct !== undefined || patch.populationPath !== undefined ? { width: sz.w, height: sz.h } : {}) } as Partial<LayoutItem>); };
  const insertAtCaret = (s: string) => {
    if (!selected || selected.text === undefined) return;
    const ta = textRef.current;
    const at = ta ? ta.selectionStart : selected.text.length, end = ta ? ta.selectionEnd : at;
    setItem(selected.id, { text: selected.text.slice(0, at) + s + selected.text.slice(end) });
  };
  const valueSample = valueSampleFor(cur);
  const keywordNames = valueSample ? Object.keys(valueSample.keywordsSnapshot).sort() : [];
  const st = selected ? styleOf(selected) : undefined;
  const names = layoutNames(p.ws);
  // Batch tile placement (I10, LEGeometryAction): tile k at (col, row) for
  // Across / Down with a fixed number of columns or rows; tiles step by whole
  // pages with Separate Pages, else by the layout's extent plus 30 pt.
  const tileAt = (k: number, n: number) => {
    const fixed = Math.max(1, tileCols);
    const cols = tileFixed === 'cols' ? fixed : Math.ceil(n / fixed), rows = tileFixed === 'rows' ? fixed : Math.ceil(n / fixed);
    return tileOrder === 'across' ? { c: k % cols, r: Math.floor(k / cols) } : { c: Math.floor(k / rows), r: k % rows };
  };
  const baseName = fileName.trim() || 'layout';

  return (
    <div className="modal-bg">
      <div className="modal wide layout" role="dialog" aria-label="Layout editor">
        <div className="modal-head">
          <b>Layout editor ({items.length} items)</b>
          <button onClick={p.onClose} aria-label="Close">x</button>
        </div>
        <div className="modal-body">
          <div className="row" role="toolbar" aria-label="Layouts">
            Layout {renaming !== null ? (
              <input autoFocus data-testid="layout-rename-input" value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={() => { p.onSettings(renameLayout(p.ws, renaming)); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { p.onSettings(renameLayout(p.ws, renaming)); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); }} />
            ) : (
              <select value={layoutName} onChange={(e) => { setSel([]); p.onSettings(selectLayout(p.ws, e.target.value)); }} data-testid="layout-list">{names.map((n) => <option key={n} value={n}>{n}</option>)}</select>
            )}
            <button data-testid="layout-list-add" title="Create: add a new layout" onClick={() => { setSel([]); p.onSettings(addLayout(p.ws)); }}>Add</button>
            <button data-testid="layout-list-duplicate" title="Duplicate: another layout starting from this one" onClick={() => { setSel([]); p.onSettings(duplicateLayout(p.ws)); }}>Duplicate</button>
            <button data-testid="layout-list-delete" title="Delete this layout" onClick={() => { if (window.confirm(`Delete the layout "${layoutName}"?`)) { setSel([]); p.onSettings(deleteLayout(p.ws)); } }}>Delete</button>
            <button data-testid="layout-list-rename" onClick={() => setRenaming(layoutName)}>Rename</button>
            | Zoom <button data-testid="layout-zoom-out" title="Zoom Out (Ctrl/Cmd+-)" onClick={() => setZoom(zoomOut(zoom))}>-</button>
            <select value={ZOOM_STEPS.includes(Math.round(zoom * 100)) ? zoom : ''} onChange={(e) => setZoom(Number(e.target.value))} data-testid="layout-zoom">{!ZOOM_STEPS.includes(Math.round(zoom * 100)) && <option value="">{Math.round(zoom * 100)}%</option>}{ZOOM_STEPS.map((z) => <option key={z} value={z / 100}>{z}%</option>)}</select>
            <button data-testid="layout-zoom-in" title="Zoom In (Ctrl/Cmd+=)" onClick={() => setZoom(zoomIn(zoom))}>+</button>
            <button data-testid="layout-zoom-fit" title="Fit to Window" onClick={fit}>Fit</button>
            <button data-testid="layout-zoom-100" title="Reset Zoom" onClick={() => setZoom(1)}>100%</button>
            | Scale <button data-testid="layout-scale-page" title="Scale To Page" onClick={() => p.onSettings({ layoutPage: { ...setup, scale: autoPageScale(boxes, usablePageOf(setup), 'page') } })}>Page</button>
            <button data-testid="layout-scale-width" title="Scale To Width" onClick={() => p.onSettings({ layoutPage: { ...setup, scale: autoPageScale(boxes, usablePageOf(setup), 'width') } })}>Width</button>
            <button data-testid="layout-scale-height" title="Scale To Height" onClick={() => p.onSettings({ layoutPage: { ...setup, scale: autoPageScale(boxes, usablePageOf(setup), 'height') } })}>Height</button>
            <button data-testid="layout-scale-reset" disabled={pageScale === 1} onClick={() => p.onSettings({ layoutPage: { ...setup, scale: undefined } })}>1:1</button>
            <span className="muted" data-testid="layout-scale">{Math.round(100 / pageScale)}%</span>
          </div>
          <div className="row">
            Iterate <select value={iter.type} onChange={(e) => p.onSettings({ layoutIteration: e.target.value === 'KEYWORD' ? { type: 'KEYWORD', keyword: '$FIL' } : e.target.value === 'PANEL' ? { type: 'PANEL', size: 2 } : { type: e.target.value as 'OFF' | 'SAMPLE' } })} data-testid="layout-iter">
              <option value="OFF">Off</option><option value="SAMPLE">Sample</option><option value="KEYWORD">Keyword</option><option value="PANEL">Panel</option>
            </select>
            {iter.type === 'KEYWORD' && <input data-testid="layout-iter-kw" placeholder="keyword" value={iter.keyword} onChange={(e) => p.onSettings({ layoutIteration: { ...iter, keyword: e.target.value } })} />}
            {iter.type === 'KEYWORD' && <input data-testid="layout-iter-disc" placeholder="discriminator (optional)" value={iter.discriminator ?? ''} onChange={(e) => p.onSettings({ layoutIteration: { ...iter, discriminator: e.target.value || undefined } })} />}
            {iter.type === 'PANEL' && <input type="number" min={1} style={{ width: 50 }} data-testid="layout-iter-panel" value={iter.size} onChange={(e) => p.onSettings({ layoutIteration: { type: 'PANEL', size: Number(e.target.value) || 1 } })} />}
            {iter.type === 'OFF' ? 'Sample for graphs without one' : 'Value'} <select value={cur} onChange={(e) => setValue(e.target.value)} data-testid="layout-sample" title="PageDown / PageUp / Home / End on the page step through the values">
              {values.map((v) => <option key={v} value={v}>{valueLabel(v)}</option>)}
            </select>
            Paper <select value={setup.paper} onChange={(e) => p.onSettings({ layoutPage: { ...setup, paper: e.target.value as PageSetup['paper'] } })} data-testid="layout-paper">
              {Object.entries(PAPERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={setup.orientation} onChange={(e) => p.onSettings({ layoutPage: { ...setup, orientation: e.target.value as PageSetup['orientation'] } })} data-testid="layout-orientation">
              <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
            </select>
            <label><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} data-testid="layout-show-grid" /> Grid</label>
            <label><input type="checkbox" checked={showBreaks} onChange={(e) => setShowBreaks(e.target.checked)} data-testid="layout-show-breaks" /> Page breaks</label>
            <label><input type="checkbox" checked={showRulers} onChange={(e) => setShowRulers(e.target.checked)} data-testid="layout-show-rulers" /> Rulers</label>
            <label title="Empty boxes stand in for graphs while editing"><input type="checkbox" checked={placeholders} onChange={(e) => setPlaceholders(e.target.checked)} data-testid="layout-placeholders" /> Placeholders</label>
            <label title="Moved items snap to a guide within 30 pt"><input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} data-testid="layout-show-guides" /> Guides</label>
            {showGuides && <>
              <button disabled={guides.v.length + guides.h.length >= MAX_GUIDES} onClick={() => p.onSettings({ layoutGuides: { ...guides, v: [...guides.v, 250] } })} data-testid="layout-add-vguide">+ vertical guide</button>
              <button disabled={guides.v.length + guides.h.length >= MAX_GUIDES} onClick={() => p.onSettings({ layoutGuides: { ...guides, h: [...guides.h, 250] } })} data-testid="layout-add-hguide">+ horizontal guide</button>
              <span className="muted">drag a guide off the page to remove it</span>
            </>}
            <button data-testid="layout-header-footer" onClick={() => setShowHF(!showHF)} title="Edit Header / Footer of the printed pages">Header / Footer</button>
          </div>
          {showHF && (
            <div className="row" data-testid="layout-hf">
              <label><input type="checkbox" checked={hf.header} onChange={(e) => p.onSettings({ layoutHeaderFooter: { ...hf, header: e.target.checked } })} data-testid="layout-hf-header" /> Header</label>
              <input value={hf.headerLeft} onChange={(e) => p.onSettings({ layoutHeaderFooter: { ...hf, headerLeft: e.target.value } })} data-testid="layout-hf-header-left" />
              <input value={hf.headerRight} onChange={(e) => p.onSettings({ layoutHeaderFooter: { ...hf, headerRight: e.target.value } })} data-testid="layout-hf-header-right" />
              <label><input type="checkbox" checked={hf.footer} onChange={(e) => p.onSettings({ layoutHeaderFooter: { ...hf, footer: e.target.checked } })} data-testid="layout-hf-footer" /> Footer</label>
              <input value={hf.footerLeft} onChange={(e) => p.onSettings({ layoutHeaderFooter: { ...hf, footerLeft: e.target.value } })} data-testid="layout-hf-footer-left" />
              <input value={hf.footerRight} onChange={(e) => p.onSettings({ layoutHeaderFooter: { ...hf, footerRight: e.target.value } })} data-testid="layout-hf-footer-right" />
              <span className="muted" data-testid="layout-hf-preview">{headerText(hf.headerRight, { document: layoutName, page: 1, version: 'flowjo-rea' })}; tags: &lt;DocumentName/&gt; &lt;Date/&gt; &lt;LongDate/&gt; &lt;Time/&gt; &lt;Version/&gt; &lt;PageNumber/&gt;</span>
            </div>
          )}
          <div className="row" role="toolbar" aria-label="Arrange">
            Align {ALIGN.map((a) => <button key={a.mode} disabled={!enabled(2)} onClick={() => arrange((u) => align(u, a.mode))} data-testid={`layout-align-${a.mode}`} title={a.key ? `Ctrl/Cmd+${a.key.toUpperCase()}` : undefined}>{a.label}</button>)}
            <button disabled={!enabled(3)} onClick={() => arrange((u) => spacing(u, 'h'))} data-testid="layout-space-h" title="Horizontal spacing (Ctrl/Cmd+J)">Space H</button>
            <button disabled={!enabled(3)} onClick={() => arrange((u) => spacing(u, 'v'))} data-testid="layout-space-v" title="Vertical spacing (Ctrl/Cmd+K)">Space V</button>
            <button disabled={!enabled(1)} onClick={() => arrange((u) => alignToGrid(u))} data-testid="layout-align-grid" title={`Snap the top-left to the ${GRID_PT} pt grid`}>To grid</button>
            | <button disabled={!enabled(1)} onClick={() => reorder((o) => bringToFront(o, expand(sel)))} data-testid="layout-front">Front</button>
            <button disabled={!enabled(1)} onClick={() => reorder((o) => stepOrder(o, expand(sel), 1))} data-testid="layout-forward">Forward</button>
            <button disabled={!enabled(1)} onClick={() => reorder((o) => stepOrder(o, expand(sel), -1))} data-testid="layout-backward">Backward</button>
            <button disabled={!enabled(1)} onClick={() => reorder((o) => sendToBack(o, expand(sel)))} data-testid="layout-back">Back</button>
            | <button disabled={!enabled(2)} onClick={group} data-testid="layout-group">Group</button>
            <button disabled={!selBoxes.some((b) => b.groupId)} onClick={ungroup} data-testid="layout-ungroup">Ungroup</button>
            <button disabled={!enabled(1)} onClick={() => toggle('locked')} data-testid="layout-lock" title="Lock position (drag and nudge skip it; align still moves it, as in FlowJo)">{selItems.length && selItems[0].locked ? 'Unlock' : 'Lock'}</button>
            <button disabled={!enabled(1)} onClick={() => toggle('sizeLock')} data-testid="layout-lock-size" title="Lock Size: no resize handles">{selItems[0]?.sizeLock ? 'Unlock size' : 'Lock size'}</button>
            <button disabled={!enabled(1)} onClick={() => toggle('contentLock')} data-testid="layout-lock-content" title="Lock Content: chart settings and text cannot change">{selItems[0]?.contentLock ? 'Unlock content' : 'Lock content'}</button>
            <button disabled={!enabled(1)} onClick={duplicate} data-testid="layout-duplicate" title="Duplicate at +8 pt (Ctrl/Cmd+D)">Duplicate</button>
            <button disabled={!enabled(1)} onClick={remove} data-testid="layout-remove">Delete</button>
            | <button disabled={!items.length} onClick={() => commit(avoidPageBreaks(boxes, page))} data-testid="layout-avoid-breaks">Avoid page breaks</button>
            <button disabled={!enabled(1)} onClick={makeGrid} data-testid="layout-grid">Grid layout</button>
            <label title="Cells hold bare charts; X axes on the bottom border, Y axes on the left border (FigGridLayout: minimalChartInGrids, border axes)"><input type="checkbox" checked={gridBare} onChange={(e) => setGridBare(e.target.checked)} data-testid="layout-grid-bare" /> bare charts, border axes</label>
            <input type="number" min={1} style={{ width: 40 }} value={gridRows} onChange={(e) => setGridRows(Math.max(1, Number(e.target.value) || 1))} aria-label="grid rows" /> x <input type="number" min={1} style={{ width: 40 }} value={gridCols} onChange={(e) => setGridCols(Math.max(1, Number(e.target.value) || 1))} aria-label="grid columns" />
          </div>
          <div className="row" role="toolbar" aria-label="Edit and insert">
            <button disabled={!items.length} onClick={() => setSel(items.map((i) => i.id))} data-testid="layout-select-all" title="Select All (Ctrl/Cmd+A)">Select all</button>
            <button disabled={!items.length} onClick={() => setSel(invertSelection(items.map((i) => i.id), sel))} data-testid="layout-select-invert" title="Invert Selection">Invert</button>
            <button disabled={!items.length} onClick={copy} data-testid="layout-copy" title="Copy (Ctrl/Cmd+C): the selection, or all figures">Copy</button>
            <button disabled={!enabled(1)} onClick={cut} data-testid="layout-cut" title="Cut (Ctrl/Cmd+X)">Cut</button>
            <button onClick={() => (clipboard.length ? paste() : void pasteSystem())} data-testid="layout-paste" title="Paste (Ctrl/Cmd+V): placed in view, +4 pt">Paste</button>
            <button disabled={!items.length} onClick={() => void copyImage(true)} data-testid="layout-copy-transparent" title="Copy Selection With Transparency (Ctrl/Cmd+Shift+C)">Copy image (transparent)</button>
            <button disabled={!items.length} onClick={() => void copyImage(false)} data-testid="layout-copy-opaque" title="Copy Selection Without transparency">Copy image (opaque)</button>
            | Insert <button data-testid="layout-add-text" onClick={() => addText()}>Text</button>
            <button data-testid="layout-add-rect" onClick={() => addShape('rect')}>Rectangle</button>
            <button data-testid="layout-add-roundrect" onClick={() => addShape('roundrect')}>Rounded</button>
            <button data-testid="layout-add-ellipse" onClick={() => addShape('ellipse')}>Ellipse</button>
            <button data-testid="layout-add-line" onClick={() => addShape('line')}>Line</button>
            <button data-testid="layout-add-arrow" onClick={() => addShape('line', 'forward')}>Arrow</button>
            <label className="button-like" title="Insert Graphic: an image file at (30, 50)">Graphic... <input type="file" accept="image/*" style={{ display: 'none' }} data-testid="layout-insert-graphic" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await addImageFig(await blobUrl(f)); e.target.value = ''; }} /></label>
          </div>
          {selected && (
            <div className="row" data-testid="layout-props" role="toolbar" aria-label="Figure properties">
              <b>Properties</b>
              <label title="Fill colour (None: unfilled)"><input type="checkbox" checked={!!st?.fill} onChange={(e) => setStyle({ fill: e.target.checked ? st?.fill ?? '#ffffff' : undefined })} data-testid="layout-fill-on" /> Fill</label>
              <input type="color" value={st?.fill ?? '#ffffff'} onChange={(e) => setStyle({ fill: e.target.value })} data-testid="layout-fill" />
              Line <input type="color" value={st?.line ?? '#000000'} onChange={(e) => setStyle({ line: e.target.value, ...(st?.weight === 'none' ? { weight: 'normal' as LineWeight } : {}) })} data-testid="layout-line-color" />
              <select value={st?.weight} onChange={(e) => setStyle({ weight: e.target.value as LineWeight })} data-testid="layout-line-weight" title="Line Weight">{(Object.keys(LINE_WEIGHTS) as LineWeight[]).map((k) => <option key={k} value={k}>{LINE_WEIGHTS[k].label}</option>)}</select>
              <select value={st?.lineStyle} onChange={(e) => setStyle({ lineStyle: e.target.value as LineStyle })} data-testid="layout-line-style" title="Line Style">{(Object.keys(LINE_STYLES) as LineStyle[]).map((k) => <option key={k} value={k}>{LINE_STYLES[k].label}</option>)}</select>
              Gradient <input type="color" value={st?.gradient ?? '#ffffff'} onChange={(e) => setStyle({ gradient: e.target.value })} data-testid="layout-gradient" />
              <select value={st?.gradientType} onChange={(e) => setStyle({ gradientType: e.target.value as GradientType, ...(e.target.value !== 'none' && !st?.fill ? { fill: '#ffffff' } : {}), ...(e.target.value !== 'none' && !st?.gradient ? { gradient: '#808080' } : {}) })} data-testid="layout-gradient-type" title="Gradient Type">{GRADIENTS.map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}</select>
              {selected.shape === 'line' && <>Arrow <select value={selected.arrow ?? 'none'} onChange={(e) => p.onChange(items.map((i) => (sel.includes(i.id) && i.shape === 'line' ? { ...i, arrow: e.target.value as LayoutShape['arrow'] } : i)))} data-testid="layout-arrowhead"><option value="none">None</option><option value="forward">Forward</option><option value="backward">Backward</option><option value="double">Double-headed</option></select></>}
              <label title="Resizing keeps the aspect ratio (Shift while dragging does too)"><input type="checkbox" checked={!!selected.aspectLock} onChange={(e) => p.onChange(items.map((i) => (sel.includes(i.id) ? ({ ...i, aspectLock: e.target.checked || undefined } as LayoutItem) : i)))} data-testid="layout-aspect-lock" /> Keep aspect</label>
              <span className="muted" data-testid="layout-sel-box">{selBoxes[0] ? `${selBoxes[0].w} x ${selBoxes[0].h} pt` : ''}</span>
            </div>
          )}
          {/* Always present, so selecting does not shift the page under the pointer. */}
          <div className="row layout-selrow">
            {!selected ? <span className="muted">Click an item to select it; Shift-click adds to the selection; drag a corner of a selected item to resize it (Shift keeps the aspect ratio).</span> : <>
              {selected.text !== undefined ? (
                <>
                  <textarea ref={textRef} value={selected.text} disabled={locked} data-testid="layout-text" onChange={(e) => setItem(selected.id, { text: e.target.value })} style={{ width: '35%', minHeight: 40 }} />
                  <select value={selected.font ?? 'SansSerif'} disabled={locked} onChange={(e) => setItem(selected.id, { font: e.target.value === 'SansSerif' ? undefined : e.target.value })} data-testid="layout-text-font">{FONT_NAMES.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                  <input type="number" min={4} max={144} style={{ width: 46 }} disabled={locked} value={selected.size ?? 11} onChange={(e) => setItem(selected.id, { size: Math.max(4, Number(e.target.value) || 11) })} data-testid="layout-text-size" title="Size (pt)" />
                  <label><input type="checkbox" disabled={locked} checked={!!selected.bold} onChange={(e) => setItem(selected.id, { bold: e.target.checked || undefined })} data-testid="layout-text-bold" /> <b>B</b></label>
                  <label><input type="checkbox" disabled={locked} checked={!!selected.italic} onChange={(e) => setItem(selected.id, { italic: e.target.checked || undefined })} data-testid="layout-text-italic" /> <i>I</i></label>
                  <input type="color" disabled={locked} value={selected.color ?? '#111111'} onChange={(e) => setItem(selected.id, { color: e.target.value })} data-testid="layout-text-color" title="Text colour" />
                  <select value="" disabled={locked} onChange={(e) => e.target.value && insertAtCaret(keywordToken(e.target.value))} data-testid="layout-insert-keyword" title="Insert Keyword: a live keyword value of the iteration's sample"><option value="">Insert Keyword...</option>{keywordNames.map((k) => <option key={k} value={k}>{k}</option>)}</select>
                  <select value="" disabled={locked} onChange={(e) => e.target.value && insertAtCaret(annoToken(e.target.value))} data-testid="layout-insert-annotation" title="Insert Annotation"><option value="">Insert Annotation...</option>{ANNOTATIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
                  <button disabled={locked} onClick={() => setShowChars(!showChars)} data-testid="layout-special-chars" title="Special Characters">&Sigma;</button>
                  {showChars && <span className="layout-chars" data-testid="layout-chars">{SPECIAL_CHARS.map((g) => <span key={g.group} title={g.group}>{g.codes.map((c) => <button key={c} title={`${g.group}: U+${c.toString(16).toUpperCase().padStart(4, '0')}`} onClick={() => insertAtCaret(String.fromCharCode(c))} data-testid="layout-char">{String.fromCharCode(c)}</button>)}</span>)}</span>}
                  <span className="muted" data-testid="layout-text-live">{rendered.find((r) => r.item.id === selected.id)?.text}</span>
                </>
              ) : selPlot ? (
                <>
                  <button onClick={openGraph} disabled={!p.onOpenGraph || !!selPlot.empty} data-testid="layout-open-graph" title="Open Original Graph (Ctrl/Cmd+O)">Open graph</button>
                  Population <select value={selPlot.empty ? '\u0000' : selPlot.populationPath} disabled={locked} onChange={(e) => setPlot({ populationPath: e.target.value, empty: undefined })} data-testid="layout-chart-pop">{selPlot.empty && <option value={'\u0000'}>(empty)</option>}{popPaths.map((q) => <option key={q} value={q}>{q || 'All events'}</option>)}{!popPaths.includes(selPlot.populationPath) && !selPlot.empty && <option value={selPlot.populationPath}>{selPlot.populationPath}</option>}</select>
                  X <select value={selPlot.x} disabled={locked} onChange={(e) => setPlot({ x: e.target.value })} data-testid="layout-chart-x" title="Chart X Axis">{[...new Set([selPlot.x, ...allParams])].map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  {selPlot.kind !== 'histogram' && <>Y <select value={selPlot.y ?? ''} disabled={locked} onChange={(e) => setPlot({ y: e.target.value })} data-testid="layout-chart-y" title="Chart Y Axis">{[...new Set([selPlot.y ?? '', ...allParams])].filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}</select></>}
                  <button disabled={locked || !!selPlot.empty} onClick={() => setPlot({ empty: true })} data-testid="layout-remove-data" title="Remove Data from Chart: leave an empty drop box">Remove data</button>
                  <label><input type="checkbox" disabled={locked} checked={selPlot.showGates !== false} onChange={(e) => setPlot({ showGates: e.target.checked ? undefined : false })} data-testid="layout-show-gates" /> Show Gates</label>
                  <label title="Only while Show Gates is on (AnnotationPanel.adjust)"><input type="checkbox" disabled={locked || selPlot.showGates === false} checked={selPlot.gateFreq !== false} onChange={(e) => setPlot({ gateFreq: e.target.checked ? undefined : false })} data-testid="layout-gate-freq" /> with Frequencies</label>
                  <label><input type="checkbox" disabled={locked || selPlot.showGates === false} checked={selPlot.gateNames !== false} onChange={(e) => setPlot({ gateNames: e.target.checked ? undefined : false })} data-testid="layout-gate-names" /> with Names</label>
                  <label><input type="checkbox" disabled={locked} checked={!!selPlot.showAnnotation} onChange={(e) => setPlot({ showAnnotation: e.target.checked || undefined })} data-testid="layout-show-annotation" /> Show Annotation</label>
                  <label title="Legend of the overlaid populations"><input type="checkbox" disabled={locked || !selPlot.overlays?.length} checked={selPlot.legend !== false} onChange={(e) => setPlot({ legend: e.target.checked ? undefined : false })} data-testid="layout-legend" /> Legend</label>
                  <label title="1-D distributions of X and Y along the edges of a 2-D plot"><input type="checkbox" disabled={locked || selPlot.kind === 'histogram'} checked={!!selPlot.adjunct} onChange={(e) => setPlot({ adjunct: e.target.checked || undefined })} data-testid="layout-adjunct" /> Show Adjunct Histograms</label>
                  <label title="One chart per ancestor level, 140 pt"><input type="checkbox" disabled={locked || !selPlot.populationPath} checked={!!selPlot.ancestry} onChange={(e) => setPlot({ ancestry: e.target.checked || undefined, backgating: e.target.checked ? selPlot.backgating : undefined })} data-testid="layout-ancestry" /> Show Ancestry</label>
                  <select value={selPlot.ancestryVertical ? 'v' : 'h'} disabled={locked || !selPlot.ancestry} onChange={(e) => setPlot({ ancestryVertical: e.target.value === 'v' || undefined })} data-testid="layout-ancestry-dir" title="Horizontal: a row to the right; Vertical: a column below"><option value="h">Horizontal</option><option value="v">Vertical</option></select>
                  <label><input type="checkbox" disabled={locked || !selPlot.ancestry} checked={!!selPlot.backgating} onChange={(e) => setPlot({ backgating: e.target.checked || undefined })} data-testid="layout-backgating" /> with Backgating</label>
                  <label><input type="checkbox" disabled={locked || !selPlot.backgating} checked={!!selPlot.backgateLarge} onChange={(e) => setPlot({ backgateLarge: e.target.checked || undefined })} data-testid="layout-backgate-large" /> Large Dots</label>
                  <label><input type="checkbox" disabled={locked || !selPlot.backgating} checked={!!selPlot.backgateContours} onChange={(e) => setPlot({ backgateContours: e.target.checked || undefined })} data-testid="layout-backgate-contours" /> Contours</label>
                  <label title="Other parameter combinations for the same population (at most 10 parameters)">Multigraph <select value={selPlot.multigraph ?? ''} disabled={locked} onChange={(e) => setPlot({ multigraph: (e.target.value || undefined) as LayoutPlot['multigraph'], multiParams: selPlot.multiParams ?? graphParams.slice(0, 4) })} data-testid="layout-multigraph"><option value="">off</option><option value="histograms">Histograms</option><option value="nxn">N x N</option><option value="halfnxn">Half N x N</option><option value="allby">All by Y</option><option value="slinky">Slinky</option></select></label>
                  {selPlot.multigraph && <select multiple size={4} disabled={locked} value={selPlot.multiParams ?? []} onChange={(e) => setPlot({ multiParams: Array.from(e.target.selectedOptions).map((o) => o.value).slice(0, 10) })} data-testid="layout-multigraph-params">{graphParams.map((n) => <option key={n} value={n}>{n}</option>)}</select>}
                  {selPlot.multigraph && selPlot.multigraph !== 'histograms' && selPlot.multigraph !== 'slinky' && <select value={selPlot.multiKind ?? 'pseudocolor'} disabled={locked} onChange={(e) => setPlot({ multiKind: e.target.value === 'pseudocolor' ? undefined : e.target.value as LayoutPlot['multiKind'] })} data-testid="layout-multigraph-kind" title="Make NxN Dot / Contour / Pseudocolor Plots"><option value="pseudocolor">Pseudocolor</option><option value="dot">Dot</option><option value="contour">Contour</option></select>}
                  {(['x', 'y'] as const).map((axis) => (['ticks', 'numbers', 'label'] as const).map((part) => {
                    const ch = { ticks: 't', numbers: 'n', label: 'l' }[part];
                    const letter = axis === 'x' ? ch : ch.toUpperCase();
                    const cur0 = selPlot.axes ?? 'tnlTNL';
                    return <label key={axis + part}><input type="checkbox" disabled={locked} checked={!cur0.includes(letter)} onChange={(e) => setPlot({ axes: e.target.checked ? cur0.replace(letter, '') : cur0 + letter })} data-testid={`layout-hide-${axis}-${part}`} /> hide {axis.toUpperCase()} {part}</label>;
                  }))}
                </>
              ) : null}
              <span className="muted">{sel.length} selected; arrows nudge 1 pt (Alt x2, Ctrl x2, Shift x3)</span>
            </>}
          </div>
          {selGrid && (
            <div className="row layout-gridbar" data-testid="layout-gridbar">
              <b>Grid {selGrid.rows} x {selGrid.cols}</b>
              <button onClick={() => gridOp('insertRow')} data-testid="grid-insert-row" title="Insert a row above the selected cell">Insert row</button>
              <button onClick={() => gridOp('insertCol')} data-testid="grid-insert-col" title="Insert a column left of the selected cell">Insert column</button>
              <button onClick={() => gridOp('deleteRow')} disabled={selGrid.rows <= 1} data-testid="grid-delete-row" title="Delete the selected cell's row with its contents">Delete row</button>
              <button onClick={() => gridOp('deleteCol')} disabled={selGrid.cols <= 1} data-testid="grid-delete-col" title="Delete the selected cell's column with its contents">Delete column</button>
              <button onClick={() => setGrid({})} data-testid="grid-even" title="Make Rows or Columns Even: put every cell back in place">Make even</button>
              <button onClick={autofit} data-testid="grid-autofit" title="Autofit Cells to their contents">Autofit</button>
              <button onClick={clearCells} data-testid="grid-clear" title="Clear the selected cells">Clear cells</button>
              Rows <input type="number" min={1} style={{ width: 40 }} value={selGrid.rows} onChange={(e) => setGrid({ rows: Math.max(1, Number(e.target.value) || 1) })} data-testid="grid-rows" />
              Columns <input type="number" min={1} style={{ width: 40 }} value={selGrid.cols} onChange={(e) => setGrid({ cols: Math.max(1, Number(e.target.value) || 1) })} data-testid="grid-cols" />
              Padding <input type="number" min={0} style={{ width: 40 }} value={selGrid.pad} onChange={(e) => setGrid({ pad: Math.max(0, Number(e.target.value) || 0) })} data-testid="grid-pad" /> pt
              <label><input type="checkbox" checked={selGrid.bare} onChange={(e) => setGrid({ bare: e.target.checked })} data-testid="grid-bare" /> bare charts, border axes</label>
              <button onClick={extractGrid} data-testid="grid-extract" title="Extract Cells from Grid">Extract cells</button>
            </div>
          )}
          <div className="row">
            <button disabled={!rendered.length} data-testid="layout-export" onClick={() => void exportAs('png', `${baseName}_${safe(valueLabel(cur))}`, rendered, items)}>Export PNG</button>
            <button disabled={!rendered.length} data-testid="layout-export-svg" onClick={() => void exportAs('svg', `${baseName}_${safe(valueLabel(cur))}`, rendered, items)}>Export SVG</button>
            <button disabled={!rendered.length} data-testid="layout-export-pdf" onClick={() => void exportAs('pdf', `${baseName}_${safe(valueLabel(cur))}`, rendered, items)} title="Print: the pages as a PDF to print">Export PDF ({grid.cols * grid.rows} page{grid.cols * grid.rows > 1 ? 's' : ''})</button>
            <button
              disabled={!items.length || busy || iter.type === 'OFF'}
              title={iter.type === 'OFF' ? 'Choose an iteration to batch' : undefined}
              data-testid="layout-batch"
              onClick={async () => {
                setBusy(true);
                try {
                  if (tileCols <= 0) {
                    for (const v of values) await exportAs(batchFormat, `${baseName}_${safe(valueLabel(v))}`, await renderLayout(p.client, p.ws, p.meta, items, bindFor(v), extrasFor(v)), items);
                  } else {
                    // I10: each value is one tile; tiles step by whole pages (Separate Pages) or by the extent.
                    const ext = pageGrid(boxes, page);
                    const u = unionBox(boxes.length ? boxes : [{ id: 'z', x: 0, y: 0, w: 1, h: 1 }]);
                    const pitchX = separatePages ? tilePitch(ext.cols * page.w - 1, page.w) : u.x + u.w + DROP_GAP, pitchY = separatePages ? tilePitch(ext.rows * page.h - 1, page.h) : u.y + u.h + DROP_GAP;
                    const allItems: LayoutItem[] = [], allR: Rendered[] = [];
                    for (const [k, v] of values.entries()) {
                      const r = await renderLayout(p.client, p.ws, p.meta, items, bindFor(v), extrasFor(v));
                      const t = tileAt(k, values.length);
                      const ox = t.c * pitchX, oy = t.r * pitchY;
                      items.forEach((it, i) => { const b = boxOf(it, i); const c = { ...withBox(it, { ...b, x: b.x + ox, y: b.y + oy }), id: `${it.id}#${k}` } as LayoutItem; allItems.push(c); const ri = r.find((x) => x.item.id === it.id); if (ri) allR.push({ ...ri, item: c }); });
                    }
                    await exportAs(batchFormat, `${baseName}_batch`, allR, allItems);
                  }
                } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
              }}
            >Batch ({values.length} value{values.length === 1 ? '' : 's'})</button>
            <select value={batchFormat} onChange={(e) => setBatchFormat(e.target.value as 'png' | 'svg' | 'pdf')} data-testid="layout-batch-format" title="Output Target">
              <option value="pdf">PDF</option><option value="png">PNG</option><option value="svg">SVG</option>
            </select>
            File name <input style={{ width: 90 }} placeholder="layout" value={fileName} onChange={(e) => setFileName(e.target.value)} data-testid="layout-file-name" />
            Tiles <input type="number" min={0} style={{ width: 50 }} data-testid="layout-tiles" title="0: one file per iteration value" value={tileCols} onChange={(e) => setTileCols(Math.max(0, Number(e.target.value) || 0))} />
            <select value={tileFixed} onChange={(e) => setTileFixed(e.target.value as 'cols' | 'rows')} data-testid="layout-tile-fixed"><option value="cols">columns</option><option value="rows">rows</option></select>
            <select value={tileOrder} onChange={(e) => setTileOrder(e.target.value as 'across' | 'down')} data-testid="layout-tile-order"><option value="across">Across</option><option value="down">Down</option></select>
            <label><input type="checkbox" checked={separatePages} onChange={(e) => setSeparatePages(e.target.checked)} data-testid="layout-separate-pages" /> Separate pages</label>
            {busy && <span className="muted">exporting...</span>}
          </div>
          {error && <p className="error">{error}</p>}
          {!items.length && <p className="muted">Use "Add to layout" under a plot (or right-click a gate, Copy to Layout Editor) to place it at (200, 200).</p>}
          <div className="layout-scroll" ref={scrollRef}>
            {showRulers && <div className="layout-ruler h" data-testid="layout-ruler" style={{ width: W * zoom, backgroundSize: `${72 * zoom / pageScale}px 100%` }}>{Array.from({ length: Math.ceil(W / (72 / pageScale)) }, (_, i) => <span key={i} style={{ left: i * 72 * zoom / pageScale }}>{i}</span>)}</div>}
            <div
              ref={pageRef}
              className="layout-page"
              tabIndex={0}
              data-testid="layout-page"
              data-zoom={zoom}
              style={{ width: W * zoom, height: H * zoom, backgroundSize: `${GRID_PT * zoom}px ${GRID_PT * zoom}px`, backgroundImage: showGrid ? 'linear-gradient(#eee 1px, transparent 1px), linear-gradient(90deg, #eee 1px, transparent 1px)' : undefined }}
              onKeyDown={onKey}
              onMouseDown={() => { setSel([]); pageRef.current?.focus({ preventScroll: true }); }}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
            >
              {showBreaks && Array.from({ length: grid.cols - 1 }, (_, i) => <div key={`v${i}`} className="page-break v" style={{ left: (i + 1) * page.w * zoom, height: H * zoom }} />)}
              {showBreaks && Array.from({ length: grid.rows - 1 }, (_, i) => <div key={`h${i}`} className="page-break h" style={{ top: (i + 1) * page.h * zoom, width: W * zoom }} />)}
              {grids.map((g) => { const b = gridBounds(g); const cw = (g.cellW + 2 * g.pad) * zoom, ch = (g.cellH + 2 * g.pad) * zoom; return <div key={g.id} className="layout-gridlines" data-testid="layout-gridlines" style={{ left: b.x * zoom, top: b.y * zoom, width: b.w * zoom, height: b.h * zoom, backgroundSize: `${cw}px ${ch}px` }} />; })}
              {showGuides && (['v', 'h'] as const).flatMap((axis) => guides[axis].map((g, i) => {
                const at = guideDrag && guideDrag.axis === axis && guideDrag.i === i ? guideDrag.at : g;
                return <div key={`g${axis}${i}`} className={`layout-guide ${axis}`} data-testid={`layout-guide-${axis}`} data-at={at}
                  style={axis === 'v' ? { left: at * zoom - 3, height: H * zoom } : { top: at * zoom - 3, width: W * zoom }}
                  onMouseDown={(e) => { e.stopPropagation(); setGuideDrag({ axis, i, at: g }); }} />;
              }))}
              {items.map((it, i) => {
                const b = view(boxes[i]);
                const r = rendered.find((x) => x.item.id === it.id);
                const isSel = sel.includes(it.id);
                const pad = 10; // room for strokes and arrowheads outside thin boxes
                return (
                  <div
                    key={it.id}
                    className={`layout-card ${isSel ? 'sel' : ''} ${it.locked ? 'locked' : ''} ${it.shape !== undefined ? 'shape' : ''}`}
                    data-testid="layout-card"
                    data-id={it.id}
                    data-kind={it.text !== undefined ? 'text' : it.shape ?? (it.image !== undefined ? 'image' : 'chart')}
                    data-group={it.groupId}
                    data-style={it.style ? JSON.stringify(it.style) : undefined}
                    data-box={`${b.x},${b.y},${b.w},${b.h}`}
                    style={{ left: b.x * zoom, top: b.y * zoom, width: Math.max(b.w, 2) * zoom, height: Math.max(b.h, 2) * zoom, zIndex: i + 1 }}
                    onMouseDown={(e) => onItemDown(e, it.id)}
                    title={r?.title}
                  >
                    {isPlotItem(it) && it.showAnnotation && r && <div className="layout-annot" style={{ top: -ANNOT_H * zoom, fontSize: 9 * zoom }}>{r.title}</div>}
                    {!isPlotItem(it) || it.style ? <FigFace it={it} b={b} r={r} zoom={zoom} pad={pad} /> : null}
                    {it.text !== undefined ? <div className="layout-textbox" style={{ font: textFont(it, zoom), color: it.color }}>{r?.text ?? it.text}</div>
                      : it.shape !== undefined || it.image !== undefined ? null
                        : r?.placeholder ? <p className="muted layout-placeholder">{r.title}</p>
                          : r?.canvas ? <img alt={r.title} src={r.canvas.toDataURL()} draggable={false} />
                            : <p className="error">{r?.error ?? 'rendering...'}</p>}
                    {isSel && sel.length === 1 && !it.sizeLock && [1, 3, 7, 9].map((h) => <span key={h} className={`layout-handle h${h}`} data-testid={`layout-handle-${h}`} />)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// A non-chart figure's face (shape, image, fill and outline) drawn on a canvas
// the size of the card plus a margin for strokes and arrowheads.
function FigFace({ it, b, r, zoom, pad }: { it: LayoutItem; b: Box; r: Rendered | undefined; zoom: number; pad: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const w = Math.max(1, b.w) + 2 * pad, h = Math.max(1, b.h) + 2 * pad;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const k = zoom * (window.devicePixelRatio || 1);
    cv.width = Math.ceil(w * k); cv.height = Math.ceil(h * k);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const box = { ...b, x: pad, y: pad };
    if (it.text !== undefined || isPlotItem(it)) paintFigFrame(ctx, isPlotItem(it) ? { ...it, style: { ...it.style, fill: undefined } } : it, box);
    else drawFig(ctx, it, box, r);
  });
  return <canvas ref={ref} className="layout-face" style={{ left: -pad * zoom, top: -pad * zoom, width: w * zoom, height: h * zoom }} />;
}
