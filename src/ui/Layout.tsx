// Layout editor (FlowJo 10.6.2 layout logic, specs 21): graphs and text placed
// on pages in points, with FlowJo's arrange commands, z-order, groups, locks,
// nudge, iteration binding and page-by-page export. The geometry rules live in
// src/core/layoutArrange.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  align, alignToGrid, avoidPageBreaks, bindSample, bringToFront, DEFAULT_PAGE, DUPLICATE_OFFSET, FRAME_PT, GRID_PT, gridPositions, iterationValues, MARGIN, nudge, nudgeStep,
  pageGrid, PAPERS, sendToBack, spacing, stepOrder, tilePitch, unionBox, usablePage, DEFAULT_GUIDES, MAX_GUIDES, snapToGuides, type AlignMode, type Box, type Guides, type LayoutIteration, type PageSetup,
} from '../core/layoutArrange';
import { populationPath, type LayoutItem, type SampleState, type Workspace } from '../core/model';
import type { PlotResult, SampleMeta } from '../core/service';
import { makeAxis, sampleChannels, withStains } from './axes';
import { channelDisplayName } from '../core/fcs';
import { drawableGates } from './gateGeometry';
import { PLOT, pw as PLOT_PW, renderPlot, type RenderOptions } from './renderPlot';
import { asCanvas, SvgContext } from './svgContext';
import { canvasesToPdf } from './pdf';
import type { createAnalysisClient } from './workerClient';

type Client = ReturnType<typeof createAnalysisClient>;

// A graph's footprint: the 256 pt plot frame (P13) with this app's axes around it.
export const GRAPH_SCALE = FRAME_PT / PLOT_PW;
export const GRAPH_W = Math.round(PLOT.w * GRAPH_SCALE);
export const GRAPH_H = Math.round(PLOT.h * GRAPH_SCALE);
const TEXT_W = 216, TEXT_H = 72;
const ANNOT_H = 14; // the annotation line drawn above a graph (Show Annotation)

// Position of an item; items saved before positions existed are laid out two
// across in list order (own migration rule).
export function boxOf(it: LayoutItem, i: number): Box {
  const w = it.width ?? (it.text !== undefined ? TEXT_W : GRAPH_W);
  const h = it.height ?? (it.text !== undefined ? TEXT_H : GRAPH_H);
  return { id: it.id, x: it.left ?? (i % 2) * (GRAPH_W + 30), y: it.top ?? Math.floor(i / 2) * (GRAPH_H + 30), w, h, locked: it.locked, groupId: it.groupId };
}
const withBox = (it: LayoutItem, b: Box): LayoutItem => ({ ...it, left: b.x, top: b.y, width: b.w, height: b.h });

// Greedy word wrap at ~7 pt per character; also splits on explicit newlines.
function wrapText(text: string, widthPt: number): string[] {
  const max = Math.max(8, Math.floor(widthPt / 7));
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
}

// The sample a layout item shows for an iteration value (I1-I7). Items saved
// without their sample follow the value's sample.
export type Bind = (it: LayoutItem) => SampleState | undefined;

// Render every layout item for its bound sample.
export async function renderLayout(client: Client, ws: Workspace, meta: Record<string, SampleMeta>, items: LayoutItem[], bind: Bind): Promise<Rendered[]> {
  const counts = new Map<string, Record<string, { count: number; parentCount: number }>>();
  const out: Rendered[] = [];
  for (const item of items) {
    if (item.text !== undefined) { out.push({ item, canvas: null, text: item.text, title: '' }); continue; }
    const s = bind(item);
    const label = item.populationPath || 'All events';
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
    const chans = sampleChannels(m, s.compensation, ws.matrices, ws.derivedParameters);
    const x = makeAxis(chans, m.keywords, ws.channelTransforms, item.x);
    const y = item.kind === 'histogram' ? null : makeAxis(chans, m.keywords, ws.channelTransforms, item.y ?? '');
    if (!x || (item.kind !== 'histogram' && !y)) { out.push({ item, canvas: null, title: `${s.fileName} / ${label}`, error: `channel ${!x ? item.x : item.y} not in this sample` }); continue; }
    const req = (popId: string | null, maxPoints: number) => client.plot({ ...base, popId, x: { kind: 'channel', channel: x.channel, transform: x.spec }, y: y ? { kind: 'channel', channel: y.channel, transform: y.spec } : null, bins: y ? 200 : 256, xRange: x.range, yRange: y ? y.range : null, maxPoints });
    const data: PlotResult = await req(pop?.id ?? null, 20000);
    const overlays: { label: string; data: PlotResult }[] = [];
    for (const path of item.overlays ?? []) {
      const op = s.populations.find((q) => populationPath(s.populations, q.id) === path);
      if (op) overlays.push({ label: path, data: await req(op.id, 5000) });
    }
    const title = (ch: string) => { const c = chans.find((q) => q.name === ch); return c ? channelDisplayName(c) : ch; };
    const options: RenderOptions = { kind: item.kind, x, y, data, gates: item.showGates === false ? [] : drawableGates(s.populations, pop?.id ?? null, x, y), counts: counts.get(s.id)!, contourLevel: item.contourLevel, showOutliers: item.showOutliers, overlays, normalize: item.normalize, xTitle: title(x.channel), yTitle: y ? title(y.channel) : undefined, gateNames: item.gateNames !== false, gateFreq: item.gateFreq !== false, axes: item.axes };
    const cv = document.createElement('canvas');
    cv.width = PLOT.w;
    cv.height = PLOT.h;
    renderPlot(cv.getContext('2d')!, options);
    out.push({ item, canvas: cv, options, title: `${s.fileName} / ${label} (${data.count.toLocaleString()} events)` });
  }
  return out;
}

// The whole layout as pages: one canvas covering cols x rows pages (points x
// scale), items drawn in z-order at their boxes.
export function composePages(rendered: Rendered[], items: LayoutItem[], page: { w: number; h: number }, scale = 2): { canvas: HTMLCanvasElement; cols: number; rows: number } {
  const boxes = items.map(boxOf);
  const { cols, rows } = pageGrid(boxes, page);
  const cv = document.createElement('canvas');
  cv.width = Math.round(cols * page.w * scale);
  cv.height = Math.round(rows * page.h * scale);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.scale(scale, scale);
  items.forEach((it, i) => {
    const b = boxes[i];
    const r = rendered.find((x) => x.item.id === it.id);
    ctx.fillStyle = '#111';
    if (it.text !== undefined) {
      ctx.font = '11px sans-serif';
      wrapText(it.text, b.w - 8).forEach((ln, k) => ctx.fillText(ln, b.x + 4, b.y + 14 + k * 14));
      return;
    }
    if (it.showAnnotation && r) { ctx.font = '9px sans-serif'; ctx.fillText(r.title, b.x, b.y - 4, b.w); }
    if (r?.canvas) ctx.drawImage(r.canvas, b.x, b.y, b.w, b.h);
    else { ctx.fillStyle = '#b00020'; ctx.font = '10px sans-serif'; ctx.fillText(r?.error ?? 'not rendered', b.x + 8, b.y + 20, b.w - 16); }
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

// The same pages as one SVG document with vector plots.
export function composeSvgPages(rendered: Rendered[], items: LayoutItem[], page: { w: number; h: number }): string {
  const boxes = items.map(boxOf);
  const { cols, rows } = pageGrid(boxes, page);
  const svg = new SvgContext(Math.round(cols * page.w), Math.round(rows * page.h));
  items.forEach((it, i) => {
    const b = boxes[i];
    const r = rendered.find((x) => x.item.id === it.id);
    svg.fillStyle = '#111';
    if (it.text !== undefined) {
      svg.font = '11px sans-serif';
      wrapText(it.text, b.w - 8).forEach((ln, k) => svg.fillText(ln, b.x + 4, b.y + 14 + k * 14));
      return;
    }
    if (it.showAnnotation && r) { svg.font = '9px sans-serif'; svg.fillText(r.title, b.x, b.y - 4); }
    if (r?.options) {
      const sub = new SvgContext(PLOT.w, PLOT.h);
      renderPlot(asCanvas(sub), r.options);
      svg.embed(sub.body(), b.x, b.y, b.w / PLOT.w);
    } else { svg.fillStyle = '#b00020'; svg.font = '10px sans-serif'; svg.fillText(r?.error ?? 'not rendered', b.x + 8, b.y + 20); }
  });
  return svg.toString();
}

const ALIGN: { mode: AlignMode; label: string; key: string }[] = [
  { mode: 'left', label: 'Left', key: 'l' }, { mode: 'hcenter', label: 'Center', key: '' }, { mode: 'right', label: 'Right', key: 'r' },
  { mode: 'top', label: 'Top', key: 't' }, { mode: 'vcenter', label: 'Middle', key: 'm' }, { mode: 'bottom', label: 'Bottom', key: 'b' },
];

export function LayoutView(p: {
  ws: Workspace;
  meta: Record<string, SampleMeta>;
  samples: SampleState[];
  client: Client;
  onChange: (items: LayoutItem[]) => void;
  onSettings: (patch: { layoutPage?: PageSetup; layoutIteration?: LayoutIteration; layoutGuides?: Guides }) => void;
  onDownload: (name: string, blob: Blob) => void;
  onClose: () => void;
}) {
  const items = useMemo(() => p.ws.layout ?? [], [p.ws.layout]);
  const setup = p.ws.layoutPage ?? DEFAULT_PAGE;
  const page = usablePage(setup);
  const iter: LayoutIteration = p.ws.layoutIteration ?? { type: 'OFF' };
  const loaded = p.samples.filter((s) => p.meta[s.id]);
  const kw = (s: SampleState, k: string) => s.keywordsSnapshot[k.toUpperCase()] ?? s.keywordsSnapshot[k] ?? s.annotations?.[k];
  const values = iter.type === 'OFF' ? loaded.map((s) => s.id) : iterationValues(iter, loaded, kw);
  const [value, setValue] = useState(values[0] ?? '');
  const cur = values.includes(value) ? value : values[0] ?? '';
  const [sel, setSel] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  // P7: guides off by default; S5: one vertical and one horizontal guide at 250 pt.
  const [showGuides, setShowGuides] = useState(false);
  const guides = p.ws.layoutGuides ?? DEFAULT_GUIDES;
  const [guideDrag, setGuideDrag] = useState<{ axis: 'v' | 'h'; i: number; at: number } | null>(null);
  const [rendered, setRendered] = useState<Rendered[]>([]);
  const [busy, setBusy] = useState(false);
  const [batchFormat, setBatchFormat] = useState<'png' | 'svg' | 'pdf'>('pdf');
  const [tileCols, setTileCols] = useState(0);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<{ x0: number; y0: number; dx: number; dy: number; ids: string[] } | null>(null);
  const [gridRows, setGridRows] = useState(3), [gridCols, setGridCols] = useState(4);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const bindFor = (v: string): Bind => (it) => {
    if (it.text !== undefined) return undefined;
    const valueSample = loaded.find((s) => s.id === v);
    if (iter.type === 'OFF' || !values.length) return loaded.find((s) => s.id === it.sampleId) ?? valueSample;
    return bindSample(it.sampleId ?? valueSample?.id, iter, v, loaded, kw);
  };

  useEffect(() => {
    let live = true;
    renderLayout(p.client, p.ws, p.meta, items, bindFor(cur)).then((r) => live && setRendered(r)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [cur, p.ws, p.meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const boxes = items.map(boxOf);
  // Selecting a grouped item selects its group (FigGroup is one figure).
  const expand = (ids: string[]) => { const gs = new Set(boxes.filter((b) => ids.includes(b.id) && b.groupId).map((b) => b.groupId)); return [...new Set([...ids, ...boxes.filter((b) => b.groupId && gs.has(b.groupId)).map((b) => b.id)])]; };
  const selBoxes = boxes.filter((b) => sel.includes(b.id));
  const commit = (next: Box[]) => p.onChange(items.map((it) => { const b = next.find((x) => x.id === it.id); return b ? withBox(it, b) : it; }));
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
  const duplicate = () => {
    const stamp = Date.now().toString(36);
    const gmap = new Map<string, string>();
    const copies = items.filter((i) => sel.includes(i.id)).map((it, k) => {
      const b = boxOf(it, items.indexOf(it));
      const g = it.groupId ? gmap.get(it.groupId) ?? gmap.set(it.groupId, `grp_${stamp}_${k}`).get(it.groupId) : undefined;
      return { ...withBox(it, { ...b, x: b.x + DUPLICATE_OFFSET, y: b.y + DUPLICATE_OFFSET }), id: `${it.id}_d${stamp}${k}`, groupId: g, locked: undefined };
    });
    p.onChange([...items, ...copies]);
    setSel(copies.map((c) => c.id));
  };
  const group = () => {
    const gid = `grp_${Date.now().toString(36)}`;
    // A20: the group goes on top of the z-order.
    const members = items.filter((i) => sel.includes(i.id)).map((i) => ({ ...withBox(i, boxOf(i, items.indexOf(i))), groupId: gid }));
    p.onChange([...items.filter((i) => !sel.includes(i.id)), ...members]);
  };
  const ungroup = () => p.onChange(items.map((i) => (sel.includes(i.id) ? { ...withBox(i, boxOf(i, items.indexOf(i))), groupId: undefined } : i)));
  const toggleLock = () => { const on = !selBoxes.every((b) => b.locked); p.onChange(items.map((i) => (sel.includes(i.id) ? { ...withBox(i, boxOf(i, items.indexOf(i))), locked: on || undefined } : i))); };
  const setItem = (id: string, patch: Partial<LayoutItem>) => p.onChange(items.map((i) => (i.id === id ? ({ ...i, ...patch } as LayoutItem) : i)));
  const addText = () => {
    const id = `txt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    p.onChange([...items, { id, text: 'New text', left: 30, top: 50, width: TEXT_W, height: TEXT_H }]); // P11: text at (30, 50)
    setSel([id]);
  };

  const step = (d: number) => { const i = values.indexOf(cur); const j = d === Infinity ? values.length - 1 : d === -Infinity ? 0 : i + d; if (values[j]) setValue(values[j]); };
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
    let next = sel;
    if (e.shiftKey || e.ctrlKey || e.metaKey) next = sel.includes(id) ? sel.filter((x) => !expand([id]).includes(x)) : expand([...sel, id]);
    else if (!sel.includes(id)) next = expand([id]);
    setSel(next);
    const pt = ptAt(e);
    setDrag({ x0: pt.x, y0: pt.y, dx: 0, dy: 0, ids: next.filter((x) => !boxes.find((b) => b.id === x)?.locked) });
  };
  const onMove = (e: React.MouseEvent) => {
    const pt = ptAt(e);
    if (guideDrag) return setGuideDrag({ ...guideDrag, at: Math.round(guideDrag.axis === 'v' ? pt.x : pt.y) });
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
    if (drag && (drag.dx || drag.dy)) commit(boxes.filter((b) => drag.ids.includes(b.id)).map((b) => ({ ...b, x: Math.max(0, b.x + drag.dx), y: Math.max(0, b.y + drag.dy) })));
    setDrag(null);
  };

  const view = (b: Box) => (drag?.ids.includes(b.id) ? { ...b, x: b.x + drag.dx, y: b.y + drag.dy } : b);
  const grid = pageGrid(boxes, page);
  const W = grid.cols * page.w, H = grid.rows * page.h;
  const safe = (s: string) => s.replace(/\.fcs$/i, '').replace(/[^\w.-]+/g, '_');
  const valueLabel = (v: string) => (iter.type === 'KEYWORD' ? v : loaded.find((s) => s.id === v)?.fileName ?? v);
  const paper = PAPERS[setup.paper];
  const paperSize = setup.orientation === 'landscape' ? { w: paper.h, h: paper.w } : { w: paper.w, h: paper.h };
  const toBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  const exportAs = async (fmt: 'png' | 'svg' | 'pdf', name: string, r: Rendered[], its: LayoutItem[]) => {
    if (fmt === 'svg') return p.onDownload(`${name}.svg`, new Blob([composeSvgPages(r, its, page)], { type: 'image/svg+xml' }));
    const all = composePages(r, its, page);
    if (fmt === 'png') return p.onDownload(`${name}.png`, await toBlob(all.canvas));
    p.onDownload(`${name}.pdf`, new Blob([await canvasesToPdf(splitPages(all, page), paperSize.w, paperSize.h, MARGIN)], { type: 'application/pdf' }));
  };
  const selected = items.find((i) => i.id === sel[0]);
  const enabled = (n: number) => sel.length >= n;

  return (
    <div className="modal-bg">
      <div className="modal wide layout" role="dialog" aria-label="Layout editor">
        <div className="modal-head">
          <b>Layout editor ({items.length} items)</b>
          <button onClick={p.onClose} aria-label="Close">x</button>
        </div>
        <div className="modal-body">
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
            Zoom <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))} data-testid="layout-zoom">{[0.5, 0.75, 1, 1.5].map((z) => <option key={z} value={z}>{z * 100}%</option>)}</select>
            <label><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} data-testid="layout-show-grid" /> Grid</label>
            <label title="Moved items snap to a guide within 30 pt"><input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} data-testid="layout-show-guides" /> Guides</label>
            {showGuides && <>
              <button disabled={guides.v.length + guides.h.length >= MAX_GUIDES} onClick={() => p.onSettings({ layoutGuides: { ...guides, v: [...guides.v, 250] } })} data-testid="layout-add-vguide">+ vertical guide</button>
              <button disabled={guides.v.length + guides.h.length >= MAX_GUIDES} onClick={() => p.onSettings({ layoutGuides: { ...guides, h: [...guides.h, 250] } })} data-testid="layout-add-hguide">+ horizontal guide</button>
              <span className="muted">drag a guide off the page to remove it</span>
            </>}
          </div>
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
            <button disabled={!enabled(1)} onClick={toggleLock} data-testid="layout-lock" title="Lock position (drag and nudge skip it; align still moves it, as in FlowJo)">{selBoxes.length && selBoxes.every((b) => b.locked) ? 'Unlock' : 'Lock'}</button>
            <button disabled={!enabled(1)} onClick={duplicate} data-testid="layout-duplicate" title="Duplicate at +8 pt (Ctrl/Cmd+D)">Duplicate</button>
            <button disabled={!enabled(1)} onClick={remove} data-testid="layout-remove">Delete</button>
            | <button disabled={!items.length} onClick={() => commit(avoidPageBreaks(boxes, page))} data-testid="layout-avoid-breaks">Avoid page breaks</button>
            <button disabled={!enabled(1)} onClick={() => { const { placed, left } = gridPositions(selBoxes, { x: Math.min(...selBoxes.map((b) => b.x)), y: Math.min(...selBoxes.map((b) => b.y)) }, gridRows, gridCols); commit(placed); if (left.length) setError(`${left.length} item(s) did not fit the ${gridRows} x ${gridCols} grid`); }} data-testid="layout-grid">Grid layout</button>
            <input type="number" min={1} style={{ width: 40 }} value={gridRows} onChange={(e) => setGridRows(Math.max(1, Number(e.target.value) || 1))} aria-label="grid rows" /> x <input type="number" min={1} style={{ width: 40 }} value={gridCols} onChange={(e) => setGridCols(Math.max(1, Number(e.target.value) || 1))} aria-label="grid columns" />
            <button data-testid="layout-add-text" onClick={addText}>Add text</button>
          </div>
          {/* Always present, so selecting does not shift the page under the pointer. */}
          <div className="row layout-selrow">
            {!selected ? <span className="muted">Click an item to select it; Shift-click adds to the selection.</span> : <>
              {selected.text !== undefined ? (
                <textarea value={selected.text} data-testid="layout-text" onChange={(e) => setItem(selected.id, { text: e.target.value })} style={{ width: '60%', minHeight: 40 }} />
              ) : (
                <>
                  <label><input type="checkbox" checked={selected.showGates !== false} onChange={(e) => setItem(selected.id, { showGates: e.target.checked ? undefined : false })} data-testid="layout-show-gates" /> Show Gates</label>
                  <label title="Only while Show Gates is on (AnnotationPanel.adjust)"><input type="checkbox" disabled={selected.showGates === false} checked={selected.gateFreq !== false} onChange={(e) => setItem(selected.id, { gateFreq: e.target.checked ? undefined : false })} data-testid="layout-gate-freq" /> with Frequencies</label>
                  <label><input type="checkbox" disabled={selected.showGates === false} checked={selected.gateNames !== false} onChange={(e) => setItem(selected.id, { gateNames: e.target.checked ? undefined : false })} data-testid="layout-gate-names" /> with Names</label>
                  <label><input type="checkbox" checked={!!selected.showAnnotation} onChange={(e) => setItem(selected.id, { showAnnotation: e.target.checked || undefined })} data-testid="layout-show-annotation" /> Show Annotation</label>
                  {(['x', 'y'] as const).map((axis) => (['ticks', 'numbers', 'label'] as const).map((part) => {
                    const ch = { ticks: 't', numbers: 'n', label: 'l' }[part];
                    const letter = axis === 'x' ? ch : ch.toUpperCase();
                    const cur = selected.axes ?? 'tnlTNL';
                    return <label key={axis + part}><input type="checkbox" checked={!cur.includes(letter)} onChange={(e) => setItem(selected.id, { axes: e.target.checked ? cur.replace(letter, '') : cur + letter })} data-testid={`layout-hide-${axis}-${part}`} /> hide {axis.toUpperCase()} {part}</label>;
                  }))}
                </>
              )}
              <span className="muted">{sel.length} selected; arrows nudge 1 pt (Alt x2, Ctrl x2, Shift x3)</span>
            </>}
          </div>
          <div className="row">
            <button disabled={!rendered.length} data-testid="layout-export" onClick={() => void exportAs('png', `layout_${safe(valueLabel(cur))}`, rendered, items)}>Export PNG</button>
            <button disabled={!rendered.length} data-testid="layout-export-svg" onClick={() => void exportAs('svg', `layout_${safe(valueLabel(cur))}`, rendered, items)}>Export SVG</button>
            <button disabled={!rendered.length} data-testid="layout-export-pdf" onClick={() => void exportAs('pdf', `layout_${safe(valueLabel(cur))}`, rendered, items)}>Export PDF ({grid.cols * grid.rows} page{grid.cols * grid.rows > 1 ? 's' : ''})</button>
            <button
              disabled={!items.length || busy || iter.type === 'OFF'}
              title={iter.type === 'OFF' ? 'Choose an iteration to batch' : undefined}
              data-testid="layout-batch"
              onClick={async () => {
                setBusy(true);
                try {
                  if (tileCols <= 0) {
                    for (const v of values) await exportAs(batchFormat, `layout_${safe(valueLabel(v))}`, await renderLayout(p.client, p.ws, p.meta, items, bindFor(v)), items);
                  } else {
                    // I10: each value is one tile; tiles step by whole pages.
                    const ext = pageGrid(boxes, page);
                    const pitchX = tilePitch(ext.cols * page.w - 1, page.w), pitchY = tilePitch(ext.rows * page.h - 1, page.h);
                    const allItems: LayoutItem[] = [], allR: Rendered[] = [];
                    for (const [k, v] of values.entries()) {
                      const r = await renderLayout(p.client, p.ws, p.meta, items, bindFor(v));
                      const ox = (k % tileCols) * pitchX, oy = Math.floor(k / tileCols) * pitchY;
                      items.forEach((it, i) => { const b = boxOf(it, i); const c = { ...withBox(it, { ...b, x: b.x + ox, y: b.y + oy }), id: `${it.id}#${k}` } as LayoutItem; allItems.push(c); const ri = r.find((x) => x.item.id === it.id); if (ri) allR.push({ ...ri, item: c }); });
                    }
                    await exportAs(batchFormat, 'layout_batch', allR, allItems);
                  }
                } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
              }}
            >Batch ({values.length} value{values.length === 1 ? '' : 's'})</button>
            <select value={batchFormat} onChange={(e) => setBatchFormat(e.target.value as 'png' | 'svg' | 'pdf')} data-testid="layout-batch-format">
              <option value="pdf">PDF</option><option value="png">PNG</option><option value="svg">SVG</option>
            </select>
            Tiles across <input type="number" min={0} style={{ width: 50 }} data-testid="layout-tiles" title="0: one file per iteration value" value={tileCols} onChange={(e) => setTileCols(Math.max(0, Number(e.target.value) || 0))} />
            {busy && <span className="muted">exporting...</span>}
          </div>
          {error && <p className="error">{error}</p>}
          {!items.length && <p className="muted">Use "Add to layout" under a plot (or right-click a gate, Copy to Layout Editor) to place it at (200, 200).</p>}
          <div className="layout-scroll">
            <div
              ref={pageRef}
              className="layout-page"
              tabIndex={0}
              data-testid="layout-page"
              style={{ width: W * zoom, height: H * zoom, backgroundSize: `${GRID_PT * zoom}px ${GRID_PT * zoom}px`, backgroundImage: showGrid ? 'linear-gradient(#eee 1px, transparent 1px), linear-gradient(90deg, #eee 1px, transparent 1px)' : undefined }}
              onKeyDown={onKey}
              onMouseDown={() => { setSel([]); pageRef.current?.focus({ preventScroll: true }); }}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
            >
              {Array.from({ length: grid.cols - 1 }, (_, i) => <div key={`v${i}`} className="page-break v" style={{ left: (i + 1) * page.w * zoom, height: H * zoom }} />)}
              {Array.from({ length: grid.rows - 1 }, (_, i) => <div key={`h${i}`} className="page-break h" style={{ top: (i + 1) * page.h * zoom, width: W * zoom }} />)}
              {showGuides && (['v', 'h'] as const).flatMap((axis) => guides[axis].map((g, i) => {
                const at = guideDrag && guideDrag.axis === axis && guideDrag.i === i ? guideDrag.at : g;
                return <div key={`g${axis}${i}`} className={`layout-guide ${axis}`} data-testid={`layout-guide-${axis}`} data-at={at}
                  style={axis === 'v' ? { left: at * zoom - 3, height: H * zoom } : { top: at * zoom - 3, width: W * zoom }}
                  onMouseDown={(e) => { e.stopPropagation(); setGuideDrag({ axis, i, at: g }); }} />;
              }))}
              {items.map((it, i) => {
                const b = view(boxes[i]);
                const r = rendered.find((x) => x.item.id === it.id);
                return (
                  <div
                    key={it.id}
                    className={`layout-card ${sel.includes(it.id) ? 'sel' : ''} ${it.locked ? 'locked' : ''}`}
                    data-testid="layout-card"
                    data-id={it.id}
                    data-group={it.groupId}
                    data-box={`${b.x},${b.y},${b.w},${b.h}`}
                    style={{ left: b.x * zoom, top: b.y * zoom, width: b.w * zoom, height: b.h * zoom, zIndex: i + 1 }}
                    onMouseDown={(e) => onItemDown(e, it.id)}
                    title={r?.title}
                  >
                    {it.text === undefined && it.showAnnotation && r && <div className="layout-annot" style={{ top: -ANNOT_H * zoom, fontSize: 9 * zoom }}>{r.title}</div>}
                    {it.text !== undefined ? <div className="layout-textbox" style={{ fontSize: 11 * zoom }}>{it.text}</div>
                      : r?.canvas ? <img alt={r.title} src={r.canvas.toDataURL()} draggable={false} />
                        : <p className="error">{r?.error ?? 'rendering...'}</p>}
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
