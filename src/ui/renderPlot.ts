// Draws a complete plot (data, axes, gates) into a 460x420 canvas context.
// Shared by the interactive plot and the layout editor.
import { contourLevels, marchingSquares, probabilityBands, probabilityThresholds, smooth } from '../core/contour';
import type { Gate } from '../core/model';
import type { PlotResult } from '../core/service';
import { ticks } from './axes';
import type { Axis, Drawable } from './gateGeometry';

export const PLOT = { w: 460, h: 420, ml: 64, mr: 14, mt: 14, mb: 48 };
export const pw = PLOT.w - PLOT.ml - PLOT.mr;
export const ph = PLOT.h - PLOT.mt - PLOT.mb;

// Perceptual blue -> green -> yellow -> red ramp for pseudocolor density.
function ramp(t: number): [number, number, number] {
  const stops: [number, number, number][] = [[20, 40, 160], [0, 150, 220], [40, 190, 90], [240, 220, 40], [230, 60, 30]];
  const s = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(s);
  const f = s - i;
  return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)) as [number, number, number];
}

// Draws "10^4" as 10 with a superscript exponent.
// Gate label placement: kept inside the plot area and moved down (then up)
// in line steps until it does not overlap a label already placed.
export interface LabelBox { x: number; y: number; w: number }
const LINE = 13;
export function placeLabel(placed: LabelBox[], w: number, x: number, y: number, area: { x0: number; y0: number; x1: number; y1: number }): LabelBox {
  const px = Math.max(area.x0, Math.min(x, area.x1 - w));
  const py = Math.max(area.y0, Math.min(y, area.y1));
  const free = (cy: number) => placed.every((b) => cy <= b.y - LINE || cy >= b.y + LINE || px + w <= b.x || px >= b.x + b.w);
  for (let k = 0; k < 40; k++) {
    for (const cy of k === 0 ? [py] : [py + k * LINE, py - k * LINE]) {
      if (cy < area.y0 || cy > area.y1 || !free(cy)) continue;
      const box = { x: px, y: cy, w };
      placed.push(box);
      return box;
    }
  }
  const box = { x: px, y: py, w };
  placed.push(box);
  return box;
}

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

export interface RenderOptions {
  kind: 'pseudocolor' | 'density' | 'zebra' | 'dot' | 'contour' | 'histogram';
  x: Axis;
  y: Axis | null;
  data: PlotResult | null;
  gates: Drawable[];
  counts: Record<string, { count: number; parentCount: number }>;
  selectedId?: string | null;
  contourLevel?: number; // percent per contour step
  showOutliers?: boolean;
  // Populations drawn on top (backgating): dots on 2-D plots, curves normalised
  // to their own maximum on histograms.
  overlays?: { label: string; data: PlotResult }[];
}

export const OVERLAY_COLORS = ['#e6194b', '#3cb44b', '#f58231', '#911eb4', '#008080', '#9a6324'];

// Returns the number of contour segments drawn (0 for other plot kinds).
export function renderPlot(ctx: CanvasRenderingContext2D, o: RenderOptions): number {
  let contourSegments = 0;
  const yAxis: Axis = o.y ?? { channel: '', spec: { kind: 'none' }, t: null!, range: [0, 1] };
  const sx = (v: number) => PLOT.ml + ((v - o.x.range[0]) / (o.x.range[1] - o.x.range[0])) * pw;
  const sy = (v: number) => PLOT.mt + ph - ((v - yAxis.range[0]) / (yAxis.range[1] - yAxis.range[0])) * ph;
  let histMax = 1;
  if (o.data && !o.y) {
    histMax = 0;
    for (const v of o.data.density) histMax = Math.max(histMax, v);
    histMax = histMax || 1;
  }
  const hy = (c: number) => PLOT.mt + ph - (c / (histMax * 1.05)) * ph;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PLOT.w, PLOT.h);
    const d = o.data;
    if (d) {
      if (o.y && (o.kind === 'pseudocolor' || o.kind === 'density' || o.kind === 'zebra')) {
        const B = d.bins;
        // density: Gaussian-smoothed counts; zebra: equal-probability bands of
        // the smoothed density, alternating light/dark shades per band.
        const smoothed = o.kind === 'pseudocolor' ? null : smooth(d.density, B, 1.5);
        const levels = contourLevels(o.contourLevel ?? 10);
        const bands = o.kind === 'zebra' ? probabilityBands(smoothed!, probabilityThresholds(smoothed!, levels)) : null;
        const grid: ArrayLike<number> = smoothed ?? d.density;
        let mx = 0;
        for (let i = 0; i < grid.length; i++) mx = Math.max(mx, grid[i]);
        const img = ctx.createImageData(pw, ph);
        const greyBase = !!o.overlays?.length;
        const lmx = Math.log1p(mx);
        for (let py = 0; py < ph; py++) {
          const by = Math.floor(((ph - 1 - py) / ph) * B);
          for (let px = 0; px < pw; px++) {
            const bx = Math.floor((px / pw) * B);
            const c = grid[by * B + bx];
            const o = (py * pw + px) * 4;
            if (bands) {
              const k = bands[by * B + bx];
              if (k > 0 || d.density[by * B + bx] > 0) {
                const [r, g, b] = ramp(k / levels.length);
                const shade = k % 2 ? 1 : 0.78;
                img.data[o] = r * shade; img.data[o + 1] = g * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
              } else img.data[o + 3] = 0;
            } else if (c > (smoothed ? mx * 1e-4 : 0)) {
              // Greyscale base when overlays are shown so overlay colours stay distinct.
              const tt = Math.log1p(c) / lmx;
              const [r, g, b] = greyBase ? ([1, 1, 1].map(() => Math.round(215 - 135 * tt)) as [number, number, number]) : ramp(tt);
              img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
            } else img.data[o + 3] = 0;
          }
        }
        const tmp = document.createElement('canvas');
        tmp.width = pw; tmp.height = ph;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        ctx.drawImage(tmp, PLOT.ml, PLOT.mt);
      } else if (o.y && o.kind === 'contour') {
        contourSegments = drawContours(ctx, d, o, sx, sy, yAxis);
      } else if (o.y) {
        ctx.fillStyle = 'rgba(20,40,120,0.55)';
        for (let i = 0; i < d.points.length; i += 2) {
          const X = sx(Math.min(Math.max(d.points[i], o.x.range[0]), o.x.range[1]));
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
    if (o.overlays?.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(PLOT.ml, PLOT.mt, pw, ph);
      ctx.clip();
      o.overlays.forEach((ov, k) => {
        const col = OVERLAY_COLORS[k % OVERLAY_COLORS.length];
        if (o.y) {
          ctx.fillStyle = col;
          const P = ov.data.points;
          for (let i = 0; i < P.length; i += 2) {
            const X = sx(Math.min(Math.max(P[i], o.x.range[0]), o.x.range[1]));
            const Y = sy(Math.min(Math.max(P[i + 1], yAxis.range[0]), yAxis.range[1]));
            ctx.fillRect(X - 0.75, Y - 0.75, 1.6, 1.6);
          }
        } else {
          const D = ov.data.density;
          let m = 0;
          for (const v of D) m = Math.max(m, v);
          if (m > 0) {
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < D.length; i++) {
              const X = PLOT.ml + ((i + 0.5) / D.length) * pw;
              const Y = PLOT.mt + ph - (D[i] / m) * ph * 0.95;
              if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
            }
            ctx.stroke();
          }
        }
      });
      ctx.restore();
      // legend
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      o.overlays.forEach((ov, k) => {
        ctx.fillStyle = OVERLAY_COLORS[k % OVERLAY_COLORS.length];
        ctx.fillText(`${ov.label} (${ov.data.count.toLocaleString()})`, PLOT.ml + pw - 4, PLOT.mt + 26 + k * 13);
      });
      ctx.textAlign = 'left';
    }
    // Axes and ticks
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(PLOT.ml + 0.5, PLOT.mt + 0.5, pw, ph);
    ctx.fillStyle = '#222';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (const t of ticks(o.x.t)) {
      const X = sx(t.pos);
      ctx.beginPath(); ctx.moveTo(X, PLOT.mt + ph); ctx.lineTo(X, PLOT.mt + ph + (t.major ? 5 : 2)); ctx.stroke();
      if (t.label) drawLabel(ctx, t.label, X, PLOT.mt + ph + 16, 'center');
    }
    ctx.font = '11px sans-serif';
    ctx.fillText(o.x.channel, PLOT.ml + pw / 2, PLOT.h - 8);
    ctx.textAlign = 'right';
    ctx.font = '10px sans-serif';
    if (o.y) {
      for (const t of ticks(o.y.t)) {
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
    ctx.fillText(o.y ? o.y.channel : 'Count', 0, 0);
    ctx.restore();
    // Gates
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLOT.ml, PLOT.mt, pw, ph);
    ctx.clip();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    const placed: LabelBox[] = [];
    for (const g of o.gates) {
      const sel = g.pop.id === o.selectedId;
      ctx.strokeStyle = sel ? '#d0021b' : '#111';
      ctx.lineWidth = sel ? 2 : 1.3;
      const c = o.counts[g.pop.id];
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
      } else if (g.kind === 'spline') {
        g.xCurve.forEach(([a, b], i) => (i ? ctx.lineTo(sx(a), sy(b)) : ctx.moveTo(sx(a), sy(b))));
        g.yCurve.forEach(([a, b], i) => (i ? ctx.lineTo(sx(a), sy(b)) : ctx.moveTo(sx(a), sy(b))));
        const gate = g.pop.gate as Extract<Gate, { type: 'splineQuadrant' }>;
        lx = gate.side[0] ? PLOT.ml + pw - 110 : PLOT.ml + 4;
        ly = gate.side[1] ? PLOT.mt + 14 : PLOT.mt + ph - 6;
      } else if (g.kind === 'quadrant') {
        ctx.moveTo(sx(g.x), PLOT.mt); ctx.lineTo(sx(g.x), PLOT.mt + ph); ctx.moveTo(PLOT.ml, sy(g.y)); ctx.lineTo(PLOT.ml + pw, sy(g.y));
        const gate = g.pop.gate as Extract<Gate, { type: 'quadrant' }>;
        lx = gate.side[0] ? PLOT.ml + pw - 110 : PLOT.ml + 4;
        ly = gate.side[1] ? PLOT.mt + 14 : PLOT.mt + ph - 6;
      }
      ctx.stroke();
      if (g.kind === 'polygon' && sel) for (const [a, b] of g.pts) ctx.strokeRect(sx(a) - 3, sy(b) - 3, 6, 6);
      if (g.kind === 'ellipse' && sel && g.editable) for (const [a, b] of g.handles) ctx.strokeRect(sx(a) - 3, sy(b) - 3, 6, 6);
      if (g.kind === 'spline' && sel && g.editable) for (const [a, b] of [...g.xPts, ...g.yPts]) ctx.strokeRect(sx(a) - 3, sy(b) - 3, 6, 6);
      ctx.fillStyle = sel ? '#d0021b' : '#111';
      const text = `${g.pop.name} ${pct}`;
      const p = placeLabel(placed, ctx.measureText(text).width, lx, ly, { x0: PLOT.ml + 2, y0: PLOT.mt + 11, x1: PLOT.ml + pw - 2, y1: PLOT.mt + ph - 2 });
      ctx.fillText(text, p.x, p.y);
    }
  ctx.restore();
  return contourSegments;
}

function drawContours(ctx: CanvasRenderingContext2D, d: PlotResult, o: RenderOptions, sx: (v: number) => number, sy: (v: number) => number, yAxis: Axis): number {
  let n = 0;
  const B = d.bins;
  const sm = smooth(d.density, B, 1.5);
  const ts = probabilityThresholds(sm, contourLevels(o.contourLevel ?? 5));
  if (o.showOutliers && ts.length) {
    // Events in bins below the outermost contour are drawn as dots.
    ctx.fillStyle = 'rgba(40,40,40,0.6)';
    for (let i = 0; i < d.points.length; i += 2) {
      const bx = Math.min(B - 1, Math.max(0, Math.floor(((d.points[i] - o.x.range[0]) / (o.x.range[1] - o.x.range[0])) * B)));
      const by = Math.min(B - 1, Math.max(0, Math.floor(((d.points[i + 1] - yAxis.range[0]) / (yAxis.range[1] - yAxis.range[0])) * B)));
      if (sm[by * B + bx] < ts[0]) ctx.fillRect(sx(d.points[i]), sy(d.points[i + 1]) - 1, 1.5, 1.5);
    }
  }
  ctx.strokeStyle = '#1d2a55';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const t of ts) {
    if (!(t > 0)) continue;
    const seg = marchingSquares(sm, B, t);
    n += seg.length / 4;
    for (let i = 0; i < seg.length; i += 4) {
      ctx.moveTo(PLOT.ml + (seg[i] / B) * pw, PLOT.mt + ph - (seg[i + 1] / B) * ph);
      ctx.lineTo(PLOT.ml + (seg[i + 2] / B) * pw, PLOT.mt + ph - (seg[i + 3] / B) * ph);
    }
  }
  ctx.stroke();
  return n;
}
