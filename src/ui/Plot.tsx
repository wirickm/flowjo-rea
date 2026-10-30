import { useEffect, useMemo, useRef, useState } from 'react';
import type { Gate, Population } from '../core/model';
import type { PlotResult } from '../core/service';
import { ticks } from './axes';
import { dragHandle, gateFromAxes } from '../core/ellipse';
import { channelDim, drawableGates, ellipseDrawable, pointInPolygon, quadrantSiblings, type Axis, type Drawable } from './gateGeometry';

export type PlotKind = 'pseudocolor' | 'dot' | 'histogram';
export type Tool = 'select' | 'rect' | 'polygon' | 'ellipse' | 'quadrant' | 'range';

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
}

export const PLOT = { w: 460, h: 420, ml: 64, mr: 14, mt: 14, mb: 48 };
const pw = PLOT.w - PLOT.ml - PLOT.mr;
const ph = PLOT.h - PLOT.mt - PLOT.mb;

// Perceptual blue -> green -> yellow -> red ramp for pseudocolor density.
function ramp(t: number): [number, number, number] {
  const stops: [number, number, number][] = [[20, 40, 160], [0, 150, 220], [40, 190, 90], [240, 220, 40], [230, 60, 30]];
  const s = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(s);
  const f = s - i;
  return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)) as [number, number, number];
}

// Draws "10^4" as 10 with a superscript exponent.
function drawLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, align: 'center' | 'right') {
  const m = /^(-?10)\^(\d+)$/.exec(label);
  ctx.save();
  ctx.textAlign = 'left';
  if (!m) {
    const w = ctx.measureText(label).width;
    ctx.fillText(label, align === 'center' ? x - w / 2 : x - w, y);
  } else {
    ctx.font = '10px sans-serif';
    const wb = ctx.measureText(m[1]).width;
    ctx.font = '8px sans-serif';
    const we = ctx.measureText(m[2]).width;
    const x0 = align === 'center' ? x - (wb + we) / 2 : x - wb - we;
    ctx.font = '10px sans-serif';
    ctx.fillText(m[1], x0, y);
    ctx.font = '8px sans-serif';
    ctx.fillText(m[2], x0 + wb, y - 5);
  }
  ctx.restore();
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

  const histMax = useMemo(() => {
    if (!p.data || p.y) return 1;
    let m = 0;
    for (const v of p.data.density) m = Math.max(m, v);
    return m || 1;
  }, [p.data, p.y]);
  const hy = (c: number) => PLOT.mt + ph - (c / (histMax * 1.05)) * ph;

  const gates = useMemo(() => drawableGates(p.populations, p.parentId, p.x, p.y), [p.populations, p.parentId, p.x, p.y]);
  const shown = preview ?? gates;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (p.canvasRef) p.canvasRef.current = cv;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PLOT.w, PLOT.h);
    const d = p.data;
    if (d) {
      if (p.y && p.kind === 'pseudocolor') {
        const B = d.bins;
        let mx = 0;
        for (const v of d.density) mx = Math.max(mx, v);
        const img = ctx.createImageData(pw, ph);
        const lmx = Math.log1p(mx);
        for (let py = 0; py < ph; py++) {
          const by = Math.floor(((ph - 1 - py) / ph) * B);
          for (let px = 0; px < pw; px++) {
            const bx = Math.floor((px / pw) * B);
            const c = d.density[by * B + bx];
            const o = (py * pw + px) * 4;
            if (c > 0) {
              const [r, g, b] = ramp(Math.log1p(c) / lmx);
              img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
            } else img.data[o + 3] = 0;
          }
        }
        const tmp = document.createElement('canvas');
        tmp.width = pw; tmp.height = ph;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        ctx.drawImage(tmp, PLOT.ml, PLOT.mt);
      } else if (p.y) {
        ctx.fillStyle = 'rgba(20,40,120,0.55)';
        for (let i = 0; i < d.points.length; i += 2) {
          const X = sx(Math.min(Math.max(d.points[i], p.x.range[0]), p.x.range[1]));
          const Y = sy(Math.min(Math.max(d.points[i + 1], yAxis.range[0]), yAxis.range[1]));
          ctx.fillRect(X, Y - 1, 1.5, 1.5);
        }
      } else {
        const B = d.bins;
        ctx.beginPath();
        ctx.moveTo(PLOT.ml, PLOT.mt + ph);
        for (let i = 0; i < B; i++) {
          const x0 = PLOT.ml + (i / B) * pw;
          ctx.lineTo(x0, hy(d.density[i]));
          ctx.lineTo(x0 + pw / B, hy(d.density[i]));
        }
        ctx.lineTo(PLOT.ml + pw, PLOT.mt + ph);
        ctx.closePath();
        ctx.fillStyle = 'rgba(60,110,200,0.35)';
        ctx.fill();
        ctx.strokeStyle = '#2a4f9c';
        ctx.stroke();
      }
    }
    // Axes and ticks
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(PLOT.ml + 0.5, PLOT.mt + 0.5, pw, ph);
    ctx.fillStyle = '#222';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (const t of ticks(p.x.t)) {
      const X = sx(t.pos);
      ctx.beginPath(); ctx.moveTo(X, PLOT.mt + ph); ctx.lineTo(X, PLOT.mt + ph + (t.major ? 5 : 2)); ctx.stroke();
      if (t.label) drawLabel(ctx, t.label, X, PLOT.mt + ph + 16, 'center');
    }
    ctx.font = '11px sans-serif';
    ctx.fillText(p.x.channel, PLOT.ml + pw / 2, PLOT.h - 8);
    ctx.textAlign = 'right';
    ctx.font = '10px sans-serif';
    if (p.y) {
      for (const t of ticks(p.y.t)) {
        const Y = sy(t.pos);
        ctx.beginPath(); ctx.moveTo(PLOT.ml, Y); ctx.lineTo(PLOT.ml - (t.major ? 5 : 2), Y); ctx.stroke();
        if (t.label) drawLabel(ctx, t.label, PLOT.ml - 7, Y + 3, 'right');
      }
    } else {
      for (let k = 0; k <= 4; k++) {
        const c = (histMax * 1.05 * k) / 4;
        ctx.fillText(String(Math.round(c)), PLOT.ml - 7, hy(c) + 3);
      }
    }
    ctx.save();
    ctx.translate(12, PLOT.mt + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    ctx.fillText(p.y ? p.y.channel : 'Count', 0, 0);
    ctx.restore();
    // Gates
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLOT.ml, PLOT.mt, pw, ph);
    ctx.clip();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    for (const g of shown) {
      const sel = g.pop.id === p.selectedId;
      ctx.strokeStyle = sel ? '#d0021b' : '#111';
      ctx.lineWidth = sel ? 2 : 1.3;
      const c = p.counts[g.pop.id];
      const pct = c && c.parentCount > 0 ? `${((100 * c.count) / c.parentCount).toFixed(2)}%` : '';
      let lx = 0, ly = 0;
      ctx.beginPath();
      if (g.kind === 'rect') {
        ctx.rect(sx(g.x0), sy(g.y1), sx(g.x1) - sx(g.x0), sy(g.y0) - sy(g.y1));
        lx = sx(g.x0) + 3; ly = sy(g.y1) + 12;
      } else if (g.kind === 'range') {
        const yy = PLOT.mt + 30;
        ctx.moveTo(sx(g.x0), yy - 8); ctx.lineTo(sx(g.x0), yy + 8); ctx.moveTo(sx(g.x0), yy); ctx.lineTo(sx(g.x1), yy); ctx.moveTo(sx(g.x1), yy - 8); ctx.lineTo(sx(g.x1), yy + 8);
        lx = sx(g.x0) + 3; ly = yy - 10;
      } else if (g.kind === 'polygon' || g.kind === 'ellipse') {
        g.pts.forEach(([a, b], i) => (i ? ctx.lineTo(sx(a), sy(b)) : ctx.moveTo(sx(a), sy(b))));
        ctx.closePath();
        lx = Math.min(...g.pts.map((q) => sx(q[0]))); ly = Math.min(...g.pts.map((q) => sy(q[1]))) - 3;
      } else if (g.kind === 'quadrant') {
        ctx.moveTo(sx(g.x), PLOT.mt); ctx.lineTo(sx(g.x), PLOT.mt + ph); ctx.moveTo(PLOT.ml, sy(g.y)); ctx.lineTo(PLOT.ml + pw, sy(g.y));
        const gate = g.pop.gate as Extract<Gate, { type: 'quadrant' }>;
        lx = gate.side[0] ? PLOT.ml + pw - 110 : PLOT.ml + 4;
        ly = gate.side[1] ? PLOT.mt + 14 : PLOT.mt + ph - 6;
      }
      ctx.stroke();
      if (g.kind === 'polygon' && sel) for (const [a, b] of g.pts) ctx.strokeRect(sx(a) - 3, sy(b) - 3, 6, 6);
      if (g.kind === 'ellipse' && sel && g.editable) for (const [a, b] of g.handles) ctx.strokeRect(sx(a) - 3, sy(b) - 3, 6, 6);
      ctx.fillStyle = sel ? '#d0021b' : '#111';
      ctx.fillText(`${g.pop.name} ${pct}`, Math.max(PLOT.ml + 2, lx), Math.max(PLOT.mt + 11, ly));
    }
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
        if (h.g.kind === 'ellipse' && !h.g.editable) {
          p.onRefuse?.(`"${h.g.pop.name}" was drawn on a different axis scale; set this plot's axes to the gate's scales to edit it`);
          return;
        }
        const group = h.g.kind === 'quadrant' ? gates.filter((g) => quadrantSiblings(p.populations, h.g.pop).some((q) => q.id === g.pop.id)) : [h.g];
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
