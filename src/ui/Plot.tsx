import { useEffect, useMemo, useRef, useState } from 'react';
import type { Gate, Population } from '../core/model';
import type { PlotResult } from '../core/service';
import { dragHandle, gateFromAxes } from '../core/ellipse';
import { defaultGrid } from '../core/gateGrid';
import {
  AUTO_GATE_BINS, autoGateContours, bisectorNames, firstQuadNumber, freehandCommit, FREEHAND_MIN_POINTS, nearestContour, quadNames, reduceFig,
  SPIDER_DRAG_MARGIN_PX, SPIDER_INITIAL_OFFSET_PX, spiderPolygons, type SpiderShape,
} from '../core/gateTools';
import { PLOT, ph, pw, renderPlot } from './renderPlot';
import { channelDim, drawableGates, ellipseDrawable, MIN_SHAPE_PX, pointInPolygon, quadrantSiblings, spiderHandles, splineDrawable, tooSmall, type Axis, type Drawable } from './gateGeometry';

export type PlotKind = 'pseudocolor' | 'density' | 'zebra' | 'dot' | 'contour' | 'histogram';
// FlowJo 10 gate tools (GateWinToolBar, full mode) plus this app's spline
// quadrant: Arrow, Rectangle, Range, Quad, Bisector, Ellipse, Polygon, Pencil,
// Auto Gate, Curly Quad, Spider Quad.
export type Tool = 'select' | 'rect' | 'range' | 'quadrant' | 'bisector' | 'ellipse' | 'polygon' | 'pencil' | 'autogate' | 'curlyquad' | 'spider' | 'spline';
export const TOOLS_2D: Tool[] = ['select', 'rect', 'quadrant', 'ellipse', 'polygon', 'pencil', 'autogate', 'curlyquad', 'spider', 'spline'];
export const TOOLS_1D: Tool[] = ['select', 'range', 'bisector'];
export const TOOL_LABELS: Record<Tool, string> = { select: 'Arrow', rect: 'Rectangle', range: 'Range', quadrant: 'Quad', bisector: 'Bisector', ellipse: 'Ellipse', polygon: 'Polygon', pencil: 'Pencil', autogate: 'Auto Gate', curlyquad: 'Curly Quad', spider: 'Spider Quad', spline: 'Spline quad' };
export const TOOL_HINTS: Record<Tool, string> = {
  select: 'drag gates, vertices or handles to edit',
  rect: 'drag to draw', range: 'drag to draw', ellipse: 'drag to draw',
  quadrant: 'click the centre (Alt+click: spider); drag a divider half to offset it',
  bisector: 'click the split',
  polygon: 'click vertices; click the first vertex or double-click to close',
  pencil: 'hold the button and draw; release to close',
  autogate: 'move over the plot to pick a contour, click to gate it',
  curlyquad: 'click the centre',
  spider: 'click the centre, then drag the centre or side points',
  spline: 'click the centre, then drag the divider points (select tool) to curve them',
};
// Single-key tool shortcuts on a focused plot (FlowJo EditorKeys).
export const TOOL_KEYS: Record<string, Tool> = { s: 'select', e: 'ellipse', f: 'pencil', a: 'autogate', p: 'polygon', i: 'range', r: 'rect', q: 'quadrant', x: 'spider', c: 'curlyquad' };

interface Props {
  kind: PlotKind;
  x: Axis;
  y: Axis | null;
  data: PlotResult | null;
  populations: Population[];
  parentId: string | null;
  counts: Record<string, { count: number; parentCount: number }>;
  tool: Tool;
  selectedId: string | null;
  onCreate: (gates: { name: string; gate: Gate }[]) => void;
  onUpdate: (updates: { id: string; gate: Gate }[]) => void;
  onSelect: (id: string) => void;
  onRefuse?: (message: string) => void;
  onTool?: (t: Tool) => void;
  canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
  contourLevel?: number;
  showOutliers?: boolean;
  normalize?: boolean;
  overlays?: { label: string; data: PlotResult }[];
  // Gate names: the stain of each axis when it has one, else the parameter.
  xLabel?: string;
  yLabel?: string;
  // Axis titles ("name :: stain"; specs 18.1).
  xTitle?: string;
  yTitle?: string;
  // Double-click inside a gate opens its population (FlowJo "Open Child
  // Population"; specs 18.3).
  onOpen?: (popId: string) => void;
  // Graph window plain keys (specs 19): Delete / Backspace on the selected
  // gate, Space / Shift+Space next / previous sample.
  onDelete?: (popId: string) => void;
  onNav?: (delta: number) => void;
  // 256 x 256 counts of the parent (index x * 256 + y) for the auto gate.
  autoCounts?: { counts: Float64Array; n: number } | null;
  // Magnetic gates as moved on this sample, anchored ranges as resolved.
  moved?: Record<string, Gate>;
  // Anchored gating armed: a histogram click gives (axis value, Alt, Shift).
  onAnchor?: (v: number, alt: boolean, shift: boolean) => void;
}

type Pt = [number, number];

export function Plot(p: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<{ mode: string; start: Pt; original: Drawable[]; vertex?: number; half?: number } | null>(null);
  const [preview, setPreview] = useState<Drawable[] | null>(null);
  // Pencil: committed vertices in screen pixels while the button is down.
  const [pencil, setPencil] = useState<Pt[] | null>(null);

  const yAxis: Axis = p.y ?? { channel: '', spec: { kind: 'none' }, t: null!, range: [0, 1] };
  const sx = (v: number) => PLOT.ml + ((v - p.x.range[0]) / (p.x.range[1] - p.x.range[0])) * pw;
  const sy = (v: number) => PLOT.mt + ph - ((v - yAxis.range[0]) / (yAxis.range[1] - yAxis.range[0])) * ph;
  const ix = (px: number) => p.x.range[0] + ((px - PLOT.ml) / pw) * (p.x.range[1] - p.x.range[0]);
  const iy = (py: number) => yAxis.range[0] + ((PLOT.mt + ph - py) / ph) * (yAxis.range[1] - yAxis.range[0]);

  const pops = useMemo(() => (p.moved ? p.populations.map((q) => (p.moved![q.id] ? { ...q, gate: p.moved![q.id] } : q)) : p.populations), [p.populations, p.moved]);
  const gates = useMemo(() => drawableGates(pops, p.parentId, p.x, p.y), [pops, p.parentId, p.x, p.y]);
  const contours = useMemo(() => (p.tool === 'autogate' && p.y && p.autoCounts ? autoGateContours(p.autoCounts.counts, p.autoCounts.n) : []), [p.tool, p.y, p.autoCounts]);
  const toGrid = (v: number, r: [number, number]) => Math.round(((v - r[0]) / (r[1] - r[0])) * AUTO_GATE_BINS);
  const fromGrid = (g: number, r: [number, number]) => r[0] + (g / AUTO_GATE_BINS) * (r[1] - r[0]);
  const autoPick = hover && contours.length ? nearestContour(contours, [toGrid(hover[0], p.x.range), toGrid(hover[1], yAxis.range)]) : null;
  const shown = preview ?? gates;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (p.canvasRef) p.canvasRef.current = cv;
    const ctx = cv.getContext('2d')!;
    cv.dataset.contourSegments = String(renderPlot(ctx, { kind: p.kind, x: p.x, y: p.y, data: p.data, gates: shown, counts: p.counts, selectedId: p.selectedId, contourLevel: p.contourLevel, showOutliers: p.showOutliers, overlays: p.overlays, normalize: p.normalize, xTitle: p.xTitle, yTitle: p.yTitle }));
    cv.dataset.overlayPoints = String((p.overlays ?? []).reduce((n, o) => n + (p.y ? o.data.points.length / 2 : o.data.count), 0));
    cv.dataset.autoContours = String(contours.length);
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLOT.ml, PLOT.mt, pw, ph);
    ctx.clip();
    // Auto gate: only the contour nearest the mouse is shown.
    if (autoPick) {
      ctx.strokeStyle = 'rgba(0, 110, 200, 0.8)';
      ctx.beginPath();
      autoPick.forEach(([a, b], i) => (i ? ctx.lineTo(sx(fromGrid(a, p.x.range)), sy(fromGrid(b, yAxis.range))) : ctx.moveTo(sx(fromGrid(a, p.x.range)), sy(fromGrid(b, yAxis.range)))));
      ctx.closePath();
      ctx.stroke();
    }
    // Draft polygon / box / pencil path
    const path = pencil ? (hover ? [...pencil.map(([a, b]): Pt => [ix(a), iy(b)]), hover] : pencil.map(([a, b]): Pt => [ix(a), iy(b)])) : null;
    if (draft.length || path) {
      ctx.strokeStyle = '#d0021b';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const pts = path ?? (hover ? [...draft, hover] : draft);
      if (p.tool === 'polygon' || path) pts.forEach(([a, b], i) => (i ? ctx.lineTo(sx(a), sy(b)) : ctx.moveTo(sx(a), sy(b))));
      else if (pts.length === 2) {
        const [[a0, b0], [a1, b1]] = pts;
        if (p.tool === 'rect') ctx.rect(sx(a0), sy(b0), sx(a1) - sx(a0), sy(b1) - sy(b0));
        if (p.tool === 'ellipse') ctx.ellipse((sx(a0) + sx(a1)) / 2, (sy(b0) + sy(b1)) / 2, Math.abs(sx(a1) - sx(a0)) / 2, Math.abs(sy(b1) - sy(b0)) / 2, 0, 0, 2 * Math.PI);
        if (p.tool === 'range') ctx.rect(sx(a0), PLOT.mt, sx(a1) - sx(a0), ph);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  });

  const screen = (e: React.MouseEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PLOT.w, ((e.clientY - r.top) / r.height) * PLOT.h];
  };
  const pos = (e: React.MouseEvent): Pt => {
    const [px, py] = screen(e);
    return [ix(px), p.y ? iy(py) : 0];
  };
  const pxDist = (a: Pt, b: Pt) => Math.hypot(sx(a[0]) - sx(b[0]), p.y ? sy(a[1]) - sy(b[1]) : 0);
  const childNames = () => p.populations.filter((q) => q.parentId === p.parentId).map((q) => q.name);
  const xl = p.xLabel ?? p.x.channel;
  const yl = p.yLabel ?? p.y?.channel ?? '';

  const hit = (pt: Pt): { g: Drawable; vertex?: number; half?: number; mode?: string } | null => {
    for (const g of [...gates].reverse()) {
      if (g.kind === 'polygon') {
        const v = g.pts.findIndex((q) => pxDist(q, pt) < 6);
        if (v >= 0) return { g, vertex: v };
        if (pointInPolygon(pt[0], pt[1], g.pts)) return { g };
      } else if (g.kind === 'rect') {
        const corners: Pt[] = [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]];
        const v = corners.findIndex((q) => pxDist(q, pt) < 7);
        if (v >= 0) return { g, vertex: v };
        if (pt[0] >= g.x0 && pt[0] <= g.x1 && pt[1] >= g.y0 && pt[1] <= g.y1) return { g };
      } else if (g.kind === 'range') {
        // Anchored ranges follow their statistic and cannot be dragged.
        if (p.populations.find((q) => q.id === g.pop.id)?.gate.type === 'anchored') {
          if (pt[0] >= g.x0 && pt[0] <= g.x1) return { g, mode: 'none' };
          continue;
        }
        // A bisector half: dragging near the split moves both halves.
        const bis = quadrantSiblings(p.populations, g.pop).length === 2;
        if (Math.abs(sx(pt[0]) - sx(g.x0)) < 6) return bis ? { g } : { g, vertex: 0 };
        if (Math.abs(sx(pt[0]) - sx(g.x1)) < 6) return bis ? { g } : { g, vertex: 1 };
        if (pt[0] >= g.x0 && pt[0] <= g.x1) return { g };
      } else if (g.kind === 'ellipse') {
        const v = g.handles.findIndex((q) => pxDist(q, pt) < 7);
        if (v >= 0) return { g, vertex: v };
        if (pointInPolygon(pt[0], pt[1], g.pts)) return { g };
      } else if (g.kind === 'quadrant') {
        if (pxDist([g.x, g.y], pt) < 10) return { g, vertex: 0 };
        // Offset drag (QuadOffsetDrag): press on a divider half within 15 px.
        const gate = g.pop.gate as Extract<Gate, { type: 'quadrant' }>;
        const up = pt[1] >= g.y, right = pt[0] >= g.x;
        if (Math.abs(sx(pt[0]) - sx(g.x)) < 15 && (gate.side[1] === 1) === up) return { g, mode: 'offsetV', half: up ? 1 : 0 };
        if (Math.abs(sy(pt[1]) - sy(g.y)) < 15 && (gate.side[0] === 1) === right) return { g, mode: 'offsetH', half: right ? 1 : 0 };
      } else if (g.kind === 'spline') {
        // Vertices 0..n-1: x divider points; n..: y divider points.
        const v = [...g.xPts, ...g.yPts].findIndex((q) => pxDist(q, pt) < 7);
        if (v >= 0) return { g, vertex: v };
      } else if (g.kind === 'curly') {
        // Only the centre handle moves a curly quad (CurlyQuadCenterDrag).
        if (pxDist(g.center, pt) < 10) return { g, vertex: 0 };
        if (pointInPolygon(pt[0], pt[1], g.pts)) return { g, mode: 'none' };
      } else if (g.kind === 'spider') {
        const hs = spiderHandles(g.shape).map(([a, b]): Pt => [Math.min(p.x.range[1], Math.max(p.x.range[0], a)), Math.min(yAxis.range[1], Math.max(yAxis.range[0], b))]);
        const v = hs.findIndex((q) => pxDist(q, pt) < 8);
        if (v >= 0) return { g, vertex: v };
        // Spiders move by their centre and side handles only.
        if (pointInPolygon(pt[0], pt[1], g.pts)) return { g, mode: 'none' };
      }
    }
    return null;
  };

  const finishShape = (pts: Pt[], tool = p.tool) => {
    const X = channelDim(p.x);
    const Y = p.y ? channelDim(p.y) : null;
    const n = p.populations.filter((q) => q.parentId === p.parentId).length + 1;
    if (tooSmall(pts.map((q) => [sx(q[0]), p.y ? sy(q[1]) : 0]), !!Y && tool !== 'range')) {
      p.onRefuse?.(`Shape ${MIN_SHAPE_PX} px or smaller discarded (as in FlowJo 10)`);
      return;
    }
    if (tool === 'rect' && Y) {
      const [[a0, b0], [a1, b1]] = pts;
      if (Math.abs(a1 - a0) < 1e-9 || Math.abs(b1 - b0) < 1e-9) return;
      p.onCreate([{ name: `Rect ${n}`, gate: { type: 'rect', dims: [X, Y], min: [Math.min(a0, a1), Math.min(b0, b1)], max: [Math.max(a0, a1), Math.max(b0, b1)] } }]);
    } else if (tool === 'range') {
      const [[a0], [a1]] = pts;
      if (Math.abs(a1 - a0) < 1e-9) return;
      p.onCreate([{ name: `Range ${n}`, gate: { type: 'rect', dims: [X], min: [Math.min(a0, a1)], max: [Math.max(a0, a1)] } }]);
    } else if (tool === 'ellipse' && Y) {
      const [[a0, b0], [a1, b1]] = pts;
      const rx = Math.abs(a1 - a0) / 2;
      const ry = Math.abs(b1 - b0) / 2;
      if (rx < 1e-9 || ry < 1e-9) return;
      p.onCreate([{ name: `Ellipse ${n}`, gate: { type: 'ellipsoid', dims: [X, Y], mean: [(a0 + a1) / 2, (b0 + b1) / 2], cov: [[rx * rx, 0], [0, ry * ry]], distanceSquare: 1, grid: defaultGrid([X, Y]) } }]);
    } else if ((tool === 'polygon' || tool === 'pencil' || tool === 'autogate') && Y) {
      if (pts.length < 3) return;
      p.onCreate([{ name: `Polygon ${n}`, gate: { type: 'polygon', dims: [X, Y], vertices: pts, grid: defaultGrid([X, Y]) } }]);
    }
  };

  // A spider from a click: side points 10 frame pixels (of 256) right of and
  // below the click; corners one data unit outside the axis (x max on the
  // axis), as FlowJo's PolyGate spider constructor does.
  const newSpider = (pt: Pt): SpiderShape => {
    const tx = p.x.t, ty = p.y!.t;
    const [x0, x1] = p.x.range, [y0, y1] = p.y!.range;
    const ox = (SPIDER_INITIAL_OFFSET_PX / 256) * (x1 - x0), oy = (SPIDER_INITIAL_OFFSET_PX / 256) * (y1 - y0);
    const out = (t: Axis['t'], v: number, d: number) => { const r = t.apply(t.inverse(v) + d); return Number.isFinite(r) ? r : v + d * 1e-3; };
    return { center: pt, top: pt[0] + ox, bottom: pt[0] + ox, left: pt[1] - oy, right: pt[1] - oy, x0: out(tx, x0, -1), x1, y0: out(ty, y0, -1), y1: out(ty, y1, 1) };
  };

  const onDown = (e: React.MouseEvent) => {
    const pt = pos(e);
    if (p.onAnchor && !p.y) {
      p.onAnchor(pt[0], e.altKey, e.shiftKey);
      return;
    }
    if (p.tool === 'select') {
      const h = hit(pt);
      if (h) {
        p.onSelect(h.g.pop.id);
        if ((h.g.kind === 'ellipse' || h.g.kind === 'spline' || h.g.kind === 'curly' || h.g.kind === 'spider') && !h.g.editable) {
          p.onRefuse?.(`"${h.g.pop.name}" was drawn on a different axis scale; set this plot's axes to the gate's scales to edit it`);
          return;
        }
        const grouped = ['quadrant', 'spline', 'curly', 'spider', 'range'].includes(h.g.kind);
        const group = grouped ? gates.filter((g) => quadrantSiblings(p.populations, h.g.pop).some((q) => q.id === g.pop.id)) : [h.g];
        setDrag({ mode: h.mode ?? (h.vertex !== undefined ? 'vertex' : 'move'), start: pt, original: group, vertex: h.vertex, half: h.half });
      }
      return;
    }
    if ((p.tool === 'quadrant' || p.tool === 'spider') && p.y) {
      const X = channelDim(p.x);
      const Y = channelDim(p.y);
      const names = quadNames(firstQuadNumber(childNames()), xl, yl);
      // Alt+click with the quad tool makes a spider (QuadLayer).
      if (p.tool === 'spider' || e.altKey) {
        const polygons = spiderPolygons(newSpider(pt));
        p.onCreate([2, 3, 0, 1].map((slot) => ({ name: names[slot], gate: { type: 'spider' as const, dims: [X, Y] as [typeof X, typeof Y], polygons, slot, grid: defaultGrid([X, Y]) } })));
        return;
      }
      // Created lower-left, lower-right, upper-left, upper-right (FlowJo order).
      const mk = (sxi: number, syi: number, name: string) => ({ name, gate: { type: 'quadrant' as const, dims: [X, Y], dividers: [[pt[0]], [pt[1]]], side: [sxi, syi] } });
      p.onCreate([mk(0, 0, names[2]), mk(1, 0, names[3]), mk(0, 1, names[0]), mk(1, 1, names[1])]);
      return;
    }
    if (p.tool === 'spline' && p.y) {
      // Curved quadrant (this app's own): each divider starts straight through
      // the click with three control points (ends at the axis limits).
      const X = channelDim(p.x);
      const Y = channelDim(p.y);
      const [y0, y1] = p.y.range;
      const [x0, x1] = p.x.range;
      const xDivider: Pt[] = [[pt[0], y0], [pt[0], pt[1]], [pt[0], y1]];
      const yDivider: Pt[] = [[x0, pt[1]], [pt[0], pt[1]], [x1, pt[1]]];
      const mk = (a: number, b: number, name: string) => ({ name, gate: { type: 'splineQuadrant' as const, dims: [X, Y] as [typeof X, typeof Y], xDivider, yDivider, side: [a, b] as [number, number] } });
      p.onCreate([mk(0, 1, `SQ1: ${p.x.channel}- , ${p.y.channel}+`), mk(1, 1, `SQ2: ${p.x.channel}+ , ${p.y.channel}+`), mk(1, 0, `SQ3: ${p.x.channel}+ , ${p.y.channel}-`), mk(0, 0, `SQ4: ${p.x.channel}- , ${p.y.channel}-`)]);
      return;
    }
    if (p.tool === 'curlyquad' && p.y) {
      const X = channelDim(p.x);
      const Y = channelDim(p.y);
      const names = quadNames(firstQuadNumber(childNames()), xl, yl);
      const frame: [[number, number], [number, number]] = [[...p.x.range], [...p.y.range]];
      p.onCreate([2, 3, 0, 1].map((q) => ({ name: names[q], gate: { type: 'curlyQuad' as const, dims: [X, Y] as [typeof X, typeof Y], center: pt, quadrant: q, frame, grid: defaultGrid([X, Y]) } })));
      return;
    }
    if (p.tool === 'bisector' && !p.y) {
      // RangeGateCreator.createBisectingChildren: split at the click.
      const X = channelDim(p.x);
      const [lo, hi] = bisectorNames(xl, p.x.channel, childNames());
      p.onCreate([{ name: lo, gate: { type: 'rect', dims: [X], min: [null], max: [pt[0]] } }, { name: hi, gate: { type: 'rect', dims: [X], min: [pt[0]], max: [null] } }]);
      return;
    }
    if (p.tool === 'autogate' && p.y) {
      const poly = nearestContour(contours, [toGrid(pt[0], p.x.range), toGrid(pt[1], yAxis.range)]);
      if (!poly) return p.onRefuse?.('No contour to gate (the auto gate needs events on this plot)');
      finishShape(reduceFig(poly).map(([a, b]): Pt => [fromGrid(a, p.x.range), fromGrid(b, yAxis.range)]));
      p.onTool?.('select');
      return;
    }
    if (p.tool === 'pencil' && p.y) {
      setPencil([screen(e)]);
      return;
    }
    if (p.tool === 'polygon') {
      // Closes within 6 px of the first vertex (FigPoly), or on double-click.
      const first = draft[0];
      if (draft.length >= 3 && Math.abs(sx(first[0]) - sx(pt[0])) < 6 && Math.abs(sy(first[1]) - sy(pt[1])) < 6) {
        finishShape(draft);
        setDraft([]);
      } else setDraft([...draft, pt]);
      return;
    }
    if (p.tool === 'rect' || p.tool === 'ellipse' || p.tool === 'range') setDraft([pt]);
  };

  const onMove = (e: React.MouseEvent) => {
    const pt = pos(e);
    setHover(pt);
    if (pencil) {
      const m = screen(e);
      if (freehandCommit(pencil, m)) setPencil([...pencil, m]);
      return;
    }
    if (!drag || drag.mode === 'none') return;
    const dx = pt[0] - drag.start[0];
    const dy = pt[1] - drag.start[1];
    setPreview(previewFor(drag, dx, dy, pt));
  };

  // Gates as moved by (dx, dy) in axis units under a drag (also arrow-key nudges).
  type DragState = { mode: string; start: Pt; original: Drawable[]; vertex?: number; half?: number };
  const previewFor = (drag: DragState, dx: number, dy: number, pt: Pt): Drawable[] => gates.map((g) => {
      const o = drag.original.find((q) => q.pop.id === g.pop.id);
      if (!o) return g;
      if (o.kind === 'polygon') {
        return { ...o, pts: o.pts.map((q, i) => (drag.mode === 'move' || i === drag.vertex ? [q[0] + dx, q[1] + dy] : q) as Pt) };
      }
      if (o.kind === 'rect') {
        if (drag.mode === 'move') return { ...o, x0: o.x0 + dx, x1: o.x1 + dx, y0: o.y0 + dy, y1: o.y1 + dy };
        const v = drag.vertex!;
        return { ...o, x0: v === 0 || v === 3 ? o.x0 + dx : o.x0, x1: v === 1 || v === 2 ? o.x1 + dx : o.x1, y0: v < 2 ? o.y0 + dy : o.y0, y1: v >= 2 ? o.y1 + dy : o.y1 };
      }
      if (o.kind === 'range') {
        if (drag.mode === 'move') return { ...o, x0: o.x0 + dx, x1: o.x1 + dx };
        return drag.vertex === 0 ? { ...o, x0: o.x0 + dx } : { ...o, x1: o.x1 + dx };
      }
      if (o.kind === 'ellipse' && p.y) {
        // Editable ellipses share the plot's scales, so axis space = gate space.
        const axes = drag.mode === 'move' ? { ...o.axes, cx: o.axes.cx + dx, cy: o.axes.cy + dy } : dragHandle(o.axes, drag.vertex!, pt);
        return ellipseDrawable(o.pop, axes, p.x, p.y);
      }
      if (o.kind === 'quadrant') {
        const gate = o.pop.gate as Extract<Gate, { type: 'quadrant' }>;
        // Offset drag: one half of a divider (mouse kept 20 px inside the frame).
        const inX = Math.min(ix(PLOT.ml + pw - 20), Math.max(ix(PLOT.ml + 20), pt[0]));
        const inY = Math.min(iy(PLOT.mt + 20), Math.max(iy(PLOT.mt + ph - 20), pt[1]));
        if (drag.mode === 'offsetV') return gate.side[1] === drag.half ? { ...o, x: inX } : o;
        if (drag.mode === 'offsetH') return gate.side[0] === drag.half ? { ...o, y: inY } : o;
        // Centre drag: every quadrant takes the new centre (setQuadPt).
        const c = drag.original.find((q) => q.pop.id === drag.original[0].pop.id) as Extract<Drawable, { kind: 'quadrant' }>;
        return { ...o, x: c.x + dx, y: c.y + dy };
      }
      if (o.kind === 'spline' && p.y) {
        // Editable splines share the plot's scales: axis space = gate space.
        const n = o.xPts.length;
        const v = drag.vertex!;
        const xs = o.xPts.map((q, i) => (i === v ? [q[0] + dx, q[1] + dy] : q) as Pt);
        const ys = o.yPts.map((q, i) => (i + n === v ? [q[0] + dx, q[1] + dy] : q) as Pt);
        return splineDrawable(o.pop, xs, ys, p.x, p.y);
      }
      if (o.kind === 'curly' && p.y) {
        const gate = o.pop.gate as Extract<Gate, { type: 'curlyQuad' }>;
        const pop = { ...o.pop, gate: { ...gate, center: [o.center[0] + dx, o.center[1] + dy] as Pt } };
        return drawableGates([pop], p.parentId, p.x, p.y)[0] ?? o;
      }
      if (o.kind === 'spider' && p.y) {
        const sh = { ...o.shape };
        const v = drag.mode === 'move' ? 0 : drag.vertex!;
        // Side points move along their side, kept 10 px from its ends.
        const okX = (x: number) => sx(x) - Math.max(PLOT.ml, sx(sh.x0)) > SPIDER_DRAG_MARGIN_PX && Math.min(PLOT.ml + pw, sx(sh.x1)) - sx(x) > SPIDER_DRAG_MARGIN_PX;
        const okY = (y: number) => sy(y) - Math.max(PLOT.mt, sy(sh.y1)) > SPIDER_DRAG_MARGIN_PX && Math.min(PLOT.mt + ph, sy(sh.y0)) - sy(y) > SPIDER_DRAG_MARGIN_PX;
        if (v === 0) sh.center = [Math.min(p.x.range[1], Math.max(p.x.range[0], sh.center[0] + dx)), Math.min(yAxis.range[1], Math.max(yAxis.range[0], sh.center[1] + dy))];
        if (v === 1 && okX(sh.top + dx)) sh.top += dx;
        if (v === 2 && okX(sh.bottom + dx)) sh.bottom += dx;
        if (v === 3 && okY(sh.left + dy)) sh.left += dy;
        if (v === 4 && okY(sh.right + dy)) sh.right += dy;
        const gate = o.pop.gate as Extract<Gate, { type: 'spider' }>;
        const polys = spiderPolygons(sh);
        return { ...o, shape: sh, pts: polys[gate.slot] };
      }
      return g;
    });

  // Commits moved gates (preview) for the populations in original.
  const commitPreview = (list: Drawable[], original: Drawable[]) => {
        const X = channelDim(p.x);
        const Y = p.y ? channelDim(p.y) : null;
        const ups: { id: string; gate: Gate }[] = [];
        for (const g of list) {
          if (!original.some((o) => o.pop.id === g.pop.id)) continue;
          const old = p.populations.find((q) => q.id === g.pop.id)!.gate;
          const keepDims = (gate: Gate) => {
            // Preserve per-dimension compensation of the original gate.
            if (gate.type === 'boolean' || old.type === 'boolean') return gate;
            gate.dims = gate.dims.map((d, k) => ({ ...d, compensation: old.dims[k]?.compensation })) as typeof gate.dims;
            return gate;
          };
          if (g.kind === 'polygon' && Y) ups.push({ id: g.pop.id, gate: keepDims({ type: 'polygon', dims: [X, Y], vertices: g.pts, grid: old.type === 'polygon' && old.grid ? old.grid : defaultGrid([X, Y]) }) });
          if (g.kind === 'rect' && Y && old.type === 'rect') {
            const open = (v: number, lo: number, hi: number) => (v < lo || v > hi ? null : v);
            ups.push({ id: g.pop.id, gate: keepDims({ type: 'rect', dims: [X, Y], min: [open(Math.min(g.x0, g.x1), p.x.range[0], p.x.range[1]), open(Math.min(g.y0, g.y1), p.y!.range[0], p.y!.range[1])], max: [open(Math.max(g.x0, g.x1), p.x.range[0], p.x.range[1]), open(Math.max(g.y0, g.y1), p.y!.range[0], p.y!.range[1])] }) });
          }
          if (g.kind === 'range' && old.type === 'rect') {
            const open = (v: number) => (v < p.x.range[0] || v > p.x.range[1] ? null : v);
            ups.push({ id: g.pop.id, gate: keepDims({ type: 'rect', dims: [X], min: [old.min[0] === null ? null : open(Math.min(g.x0, g.x1))], max: [old.max[0] === null ? null : open(Math.max(g.x0, g.x1))] }) });
          }
          if (g.kind === 'ellipse' && old.type === 'ellipsoid' && g.editable) ups.push({ id: g.pop.id, gate: { ...old, ...gateFromAxes(g.axes), edges: undefined } });
          if (g.kind === 'spline' && old.type === 'splineQuadrant' && g.editable) ups.push({ id: g.pop.id, gate: { ...old, xDivider: g.xPts, yDivider: g.yPts } });
          if (g.kind === 'quadrant' && Y && old.type === 'quadrant') ups.push({ id: g.pop.id, gate: keepDims({ ...old, dims: [X, Y], dividers: [[g.x], [g.y]] }) });
          if (g.kind === 'curly' && old.type === 'curlyQuad' && g.editable) ups.push({ id: g.pop.id, gate: { ...old, center: g.center } });
          if (g.kind === 'spider' && old.type === 'spider' && g.editable) ups.push({ id: g.pop.id, gate: { ...old, polygons: spiderPolygons(g.shape) } });
        }
        if (ups.length) p.onUpdate(ups);
  };

  // Graph window arrow keys (EditorKeys.nudge; specs 19): the selected gate
  // moves one pixel; Alt doubles, Ctrl doubles, Shift triples, multiplied.
  const nudge = (e: React.KeyboardEvent) => {
    const sel = gates.filter((g) => g.pop.id === p.selectedId && g.kind !== 'spline');
    if (!sel.length) return false;
    const k = (e.altKey ? 2 : 1) * (e.ctrlKey || e.metaKey ? 2 : 1) * (e.shiftKey ? 3 : 1);
    const ux = ((p.x.range[1] - p.x.range[0]) / pw) * k;
    const uy = p.y ? ((yAxis.range[1] - yAxis.range[0]) / ph) * k : 0;
    const dx = e.key === 'ArrowLeft' ? -ux : e.key === 'ArrowRight' ? ux : 0;
    const dy = p.y ? (e.key === 'ArrowDown' ? -uy : e.key === 'ArrowUp' ? uy : 0) : 0;
    if (!dx && !dy) return true;
    const original = p.y ? gates.filter((g) => sel.some((q) => q.pop.id === g.pop.id) || (g.kind === 'quadrant' && sel[0].kind === 'quadrant' && quadrantSiblings(p.populations, sel[0].pop).some((q) => q.id === g.pop.id))) : sel;
    commitPreview(previewFor({ mode: 'move', start: [0, 0], original }, dx, dy, [0, 0]), original);
    return true;
  };

  const onUp = (e: React.MouseEvent) => {
    const pt = pos(e);
    if (pencil) {
      // Release completes the pencil gate; fewer than 4 points abandons it.
      const path = [...pencil, screen(e)];
      setPencil(null);
      if (path.length < FREEHAND_MIN_POINTS) return p.onRefuse?.('Pencil path too short (FlowJo needs at least 4 points)');
      finishShape(path.map(([a, b]): Pt => [ix(a), iy(b)]), 'pencil');
      return;
    }
    if (drag) {
      if (preview && (pt[0] !== drag.start[0] || pt[1] !== drag.start[1])) {
        commitPreview(preview, drag.original);
      }
      setDrag(null);
      setPreview(null);
      return;
    }
    if ((p.tool === 'rect' || p.tool === 'ellipse' || p.tool === 'range') && draft.length === 1) {
      finishShape([draft[0], pt]);
      setDraft([]);
    }
  };

  return (
    <canvas
      ref={ref}
      width={PLOT.w}
      height={PLOT.h}
      data-testid="plot-canvas"
      style={{ width: PLOT.w, height: PLOT.h, cursor: p.tool === 'select' ? 'default' : 'crosshair', border: '1px solid #ccc', background: '#fff' }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={() => setHover(null)}
      onDoubleClick={(e) => {
        if (p.tool === 'polygon' && draft.length >= 3) {
          finishShape(draft);
          setDraft([]);
          return;
        }
        if (p.tool !== 'select' || draft.length || !p.onOpen) return;
        const h = hit(pos(e));
        if (h) p.onOpen(h.g.pop.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { setDraft([]); setPencil(null); return; }
        // Polygon in progress: Backspace / Delete removes the last vertex, Space
        // closes it (PolygonDrag; specs 19).
        if (p.tool === 'polygon' && draft.length) {
          if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); setDraft(draft.slice(0, -1)); return; }
          if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (draft.length >= 3) { finishShape(draft); setDraft([]); } return; }
        }
        if (e.key.startsWith('Arrow')) { if (nudge(e)) { e.preventDefault(); e.stopPropagation(); } return; }
        if ((e.key === 'Backspace' || e.key === 'Delete') && p.selectedId && p.onDelete && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); p.onDelete(p.selectedId); return; }
        if (e.key === ' ' && p.onNav && !(e.ctrlKey && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); p.onNav(e.shiftKey || e.ctrlKey || e.altKey ? -1 : 1); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = TOOL_KEYS[e.key.toLowerCase()];
        if (t && (p.y ? TOOLS_2D : TOOLS_1D).includes(t)) p.onTool?.(t);
      }}
      tabIndex={0}
    />
  );
}
