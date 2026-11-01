import { useEffect, useMemo, useRef, useState } from 'react';
import type { Gate, Population } from '../core/model';
import type { PlotResult } from '../core/service';
import { dragHandle, gateFromAxes } from '../core/ellipse';
import { PLOT, ph, pw, renderPlot } from './renderPlot';
import { channelDim, drawableGates, ellipseDrawable, pointInPolygon, quadrantSiblings, splineDrawable, type Axis, type Drawable } from './gateGeometry';

export type PlotKind = 'pseudocolor' | 'density' | 'zebra' | 'dot' | 'contour' | 'histogram';
export type Tool = 'select' | 'rect' | 'polygon' | 'ellipse' | 'quadrant' | 'spline' | 'range';

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
  canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
  contourLevel?: number;
  showOutliers?: boolean;
  overlays?: { label: string; data: PlotResult }[];
}

export function Plot(p: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<{ mode: string; start: [number, number]; original: Drawable[]; vertex?: number } | null>(null);
  const [preview, setPreview] = useState<Drawable[] | null>(null);

  const yAxis: Axis = p.y ?? { channel: '', spec: { kind: 'none' }, t: null!, range: [0, 1] };
  const sx = (v: number) => PLOT.ml + ((v - p.x.range[0]) / (p.x.range[1] - p.x.range[0])) * pw;
  const sy = (v: number) => PLOT.mt + ph - ((v - yAxis.range[0]) / (yAxis.range[1] - yAxis.range[0])) * ph;
  const ix = (px: number) => p.x.range[0] + ((px - PLOT.ml) / pw) * (p.x.range[1] - p.x.range[0]);
  const iy = (py: number) => yAxis.range[0] + ((PLOT.mt + ph - py) / ph) * (yAxis.range[1] - yAxis.range[0]);


  const gates = useMemo(() => drawableGates(p.populations, p.parentId, p.x, p.y), [p.populations, p.parentId, p.x, p.y]);
  const shown = preview ?? gates;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (p.canvasRef) p.canvasRef.current = cv;
    const ctx = cv.getContext('2d')!;
    cv.dataset.contourSegments = String(renderPlot(ctx, { kind: p.kind, x: p.x, y: p.y, data: p.data, gates: shown, counts: p.counts, selectedId: p.selectedId, contourLevel: p.contourLevel, showOutliers: p.showOutliers, overlays: p.overlays }));
    cv.dataset.overlayPoints = String((p.overlays ?? []).reduce((n, o) => n + (p.y ? o.data.points.length / 2 : o.data.count), 0));
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLOT.ml, PLOT.mt, pw, ph);
    ctx.clip();
    // Draft polygon / box
    if (draft.length) {
      ctx.strokeStyle = '#d0021b';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const pts = hover ? [...draft, hover] : draft;
      if (p.tool === 'polygon') pts.forEach(([a, b], i) => (i ? ctx.lineTo(sx(a), sy(b)) : ctx.moveTo(sx(a), sy(b))));
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

  const pos = (e: React.MouseEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * PLOT.w;
    const py = ((e.clientY - r.top) / r.height) * PLOT.h;
    return [ix(px), p.y ? iy(py) : 0];
  };
  const pxDist = (a: [number, number], b: [number, number]) => Math.hypot(sx(a[0]) - sx(b[0]), p.y ? sy(a[1]) - sy(b[1]) : 0);

  const hit = (pt: [number, number]): { g: Drawable; vertex?: number } | null => {
    for (const g of [...gates].reverse()) {
      if (g.kind === 'polygon') {
        const v = g.pts.findIndex((q) => pxDist(q, pt) < 6);
        if (v >= 0) return { g, vertex: v };
        if (pointInPolygon(pt[0], pt[1], g.pts)) return { g };
      } else if (g.kind === 'rect') {
        const corners: [number, number][] = [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]];
        const v = corners.findIndex((q) => pxDist(q, pt) < 7);
        if (v >= 0) return { g, vertex: v };
        if (pt[0] >= g.x0 && pt[0] <= g.x1 && pt[1] >= g.y0 && pt[1] <= g.y1) return { g };
      } else if (g.kind === 'range') {
        if (Math.abs(sx(pt[0]) - sx(g.x0)) < 6) return { g, vertex: 0 };
        if (Math.abs(sx(pt[0]) - sx(g.x1)) < 6) return { g, vertex: 1 };
        if (pt[0] >= g.x0 && pt[0] <= g.x1) return { g };
      } else if (g.kind === 'ellipse') {
        const v = g.handles.findIndex((q) => pxDist(q, pt) < 7);
        if (v >= 0) return { g, vertex: v };
        if (pointInPolygon(pt[0], pt[1], g.pts)) return { g };
      } else if (g.kind === 'quadrant') {
        if (pxDist([g.x, g.y], pt) < 10) return { g, vertex: 0 };
      } else if (g.kind === 'spline') {
        // Vertices 0..n-1: x divider points; n..: y divider points.
        const v = [...g.xPts, ...g.yPts].findIndex((q) => pxDist(q, pt) < 7);
        if (v >= 0) return { g, vertex: v };
      }
    }
    return null;
  };

  const finishShape = (pts: [number, number][]) => {
    const X = channelDim(p.x);
    const Y = p.y ? channelDim(p.y) : null;
    const n = p.populations.filter((q) => q.parentId === p.parentId).length + 1;
    if (p.tool === 'rect' && Y) {
      const [[a0, b0], [a1, b1]] = pts;
      if (Math.abs(a1 - a0) < 1e-9 || Math.abs(b1 - b0) < 1e-9) return;
      p.onCreate([{ name: `Rect ${n}`, gate: { type: 'rect', dims: [X, Y], min: [Math.min(a0, a1), Math.min(b0, b1)], max: [Math.max(a0, a1), Math.max(b0, b1)] } }]);
    } else if (p.tool === 'range') {
      const [[a0], [a1]] = pts;
      if (Math.abs(a1 - a0) < 1e-9) return;
      p.onCreate([{ name: `Range ${n}`, gate: { type: 'rect', dims: [X], min: [Math.min(a0, a1)], max: [Math.max(a0, a1)] } }]);
    } else if (p.tool === 'ellipse' && Y) {
      const [[a0, b0], [a1, b1]] = pts;
      const rx = Math.abs(a1 - a0) / 2;
      const ry = Math.abs(b1 - b0) / 2;
      if (rx < 1e-9 || ry < 1e-9) return;
      p.onCreate([{ name: `Ellipse ${n}`, gate: { type: 'ellipsoid', dims: [X, Y], mean: [(a0 + a1) / 2, (b0 + b1) / 2], cov: [[rx * rx, 0], [0, ry * ry]], distanceSquare: 1 } }]);
    } else if (p.tool === 'polygon' && Y) {
      if (pts.length < 3) return;
      p.onCreate([{ name: `Polygon ${n}`, gate: { type: 'polygon', dims: [X, Y], vertices: pts } }]);
    }
  };

  const onDown = (e: React.MouseEvent) => {
    const pt = pos(e);
    if (p.tool === 'select') {
      const h = hit(pt);
      if (h) {
        p.onSelect(h.g.pop.id);
        if ((h.g.kind === 'ellipse' || h.g.kind === 'spline') && !h.g.editable) {
          p.onRefuse?.(`"${h.g.pop.name}" was drawn on a different axis scale; set this plot's axes to the gate's scales to edit it`);
          return;
        }
        const group = h.g.kind === 'quadrant' || h.g.kind === 'spline' ? gates.filter((g) => quadrantSiblings(p.populations, h.g.pop).some((q) => q.id === g.pop.id)) : [h.g];
        setDrag({ mode: h.vertex !== undefined ? 'vertex' : 'move', start: pt, original: group, vertex: h.vertex });
      }
      return;
    }
    if (p.tool === 'quadrant' && p.y) {
      const X = channelDim(p.x);
      const Y = channelDim(p.y);
      const mk = (sxi: number, syi: number, name: string) => ({ name, gate: { type: 'quadrant' as const, dims: [X, Y], dividers: [[pt[0]], [pt[1]]], side: [sxi, syi] } });
      p.onCreate([mk(0, 1, `Q1: ${p.x.channel}- , ${p.y.channel}+`), mk(1, 1, `Q2: ${p.x.channel}+ , ${p.y.channel}+`), mk(1, 0, `Q3: ${p.x.channel}+ , ${p.y.channel}-`), mk(0, 0, `Q4: ${p.x.channel}- , ${p.y.channel}-`)]);
      return;
    }
    if (p.tool === 'spline' && p.y) {
      // Curved quadrant: each divider starts straight through the click with
      // three control points (ends at the axis limits) to drag into a curve.
      const X = channelDim(p.x);
      const Y = channelDim(p.y);
      const [y0, y1] = p.y.range;
      const [x0, x1] = p.x.range;
      const xDivider: [number, number][] = [[pt[0], y0], [pt[0], pt[1]], [pt[0], y1]];
      const yDivider: [number, number][] = [[x0, pt[1]], [pt[0], pt[1]], [x1, pt[1]]];
      const mk = (a: number, b: number, name: string) => ({ name, gate: { type: 'splineQuadrant' as const, dims: [X, Y] as [typeof X, typeof Y], xDivider, yDivider, side: [a, b] as [number, number] } });
      p.onCreate([mk(0, 1, `SQ1: ${p.x.channel}- , ${p.y.channel}+`), mk(1, 1, `SQ2: ${p.x.channel}+ , ${p.y.channel}+`), mk(1, 0, `SQ3: ${p.x.channel}+ , ${p.y.channel}-`), mk(0, 0, `SQ4: ${p.x.channel}- , ${p.y.channel}-`)]);
      return;
    }
    if (p.tool === 'polygon') {
      if (draft.length >= 3 && pxDist(draft[0], pt) < 8) {
        finishShape(draft);
        setDraft([]);
      } else setDraft([...draft, pt]);
      return;
    }
    setDraft([pt]);
  };

  const onMove = (e: React.MouseEvent) => {
    const pt = pos(e);
    setHover(pt);
    if (!drag) return;
    const dx = pt[0] - drag.start[0];
    const dy = pt[1] - drag.start[1];
    setPreview(gates.map((g) => {
      const o = drag.original.find((q) => q.pop.id === g.pop.id);
      if (!o) return g;
      if (o.kind === 'polygon') {
        return { ...o, pts: o.pts.map((q, i) => (drag.mode === 'move' || i === drag.vertex ? [q[0] + dx, q[1] + dy] : q) as [number, number]) };
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
      if (o.kind === 'quadrant') return { ...o, x: o.x + dx, y: o.y + dy };
      if (o.kind === 'spline' && p.y) {
        // Editable splines share the plot's scales: axis space = gate space.
        const n = o.xPts.length;
        const v = drag.vertex!;
        const xs = o.xPts.map((q, i) => (i === v ? [q[0] + dx, q[1] + dy] : q) as [number, number]);
        const ys = o.yPts.map((q, i) => (i + n === v ? [q[0] + dx, q[1] + dy] : q) as [number, number]);
        return splineDrawable(o.pop, xs, ys, p.x, p.y);
      }
      return g;
    }));
  };

  const onUp = (e: React.MouseEvent) => {
    const pt = pos(e);
    if (drag) {
      if (preview && (pt[0] !== drag.start[0] || pt[1] !== drag.start[1])) {
        const X = channelDim(p.x);
        const Y = p.y ? channelDim(p.y) : null;
        const ups: { id: string; gate: Gate }[] = [];
        for (const g of preview) {
          if (!drag.original.some((o) => o.pop.id === g.pop.id)) continue;
          const old = g.pop.gate;
          const keepDims = (gate: Gate) => {
            // Preserve per-dimension compensation of the original gate.
            if (gate.type === 'boolean' || old.type === 'boolean') return gate;
            gate.dims = gate.dims.map((d, k) => ({ ...d, compensation: old.dims[k]?.compensation })) as typeof gate.dims;
            return gate;
          };
          if (g.kind === 'polygon' && Y) ups.push({ id: g.pop.id, gate: keepDims({ type: 'polygon', dims: [X, Y], vertices: g.pts }) });
          if (g.kind === 'rect' && Y && old.type === 'rect') {
            const open = (v: number, lo: number, hi: number) => (v < lo || v > hi ? null : v);
            ups.push({ id: g.pop.id, gate: keepDims({ type: 'rect', dims: [X, Y], min: [open(Math.min(g.x0, g.x1), p.x.range[0], p.x.range[1]), open(Math.min(g.y0, g.y1), p.y!.range[0], p.y!.range[1])], max: [open(Math.max(g.x0, g.x1), p.x.range[0], p.x.range[1]), open(Math.max(g.y0, g.y1), p.y!.range[0], p.y!.range[1])] }) });
          }
          if (g.kind === 'range' && old.type === 'rect') {
            const open = (v: number) => (v < p.x.range[0] || v > p.x.range[1] ? null : v);
            ups.push({ id: g.pop.id, gate: keepDims({ type: 'rect', dims: [X], min: [open(Math.min(g.x0, g.x1))], max: [open(Math.max(g.x0, g.x1))] }) });
          }
          if (g.kind === 'ellipse' && old.type === 'ellipsoid' && g.editable) ups.push({ id: g.pop.id, gate: { ...old, ...gateFromAxes(g.axes) } });
          if (g.kind === 'spline' && old.type === 'splineQuadrant' && g.editable) ups.push({ id: g.pop.id, gate: { ...old, xDivider: g.xPts, yDivider: g.yPts } });
          if (g.kind === 'quadrant' && Y && old.type === 'quadrant') ups.push({ id: g.pop.id, gate: keepDims({ ...old, dims: [X, Y], dividers: [[g.x], [g.y]] }) });
        }
        if (ups.length) p.onUpdate(ups);
      }
      setDrag(null);
      setPreview(null);
      return;
    }
    if (p.tool !== 'polygon' && draft.length === 1) {
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
      onDoubleClick={() => {
        if (p.tool === 'polygon' && draft.length >= 3) {
          finishShape(draft);
          setDraft([]);
        }
      }}
      onKeyDown={(e) => e.key === 'Escape' && setDraft([])}
      tabIndex={0}
    />
  );
}
