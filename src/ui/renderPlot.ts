// Draws a complete plot (data, axes, gates) into a 460x420 canvas context.
// Shared by the interactive plot and the layout editor.
import { contourLevels, marchingSquares, probabilityBands, probabilityThresholds } from '../core/contour';
import type { Gate } from '../core/model';
import type { PlotResult } from '../core/service';
import { canShowOutliers, smoothCurve, smoothGrid } from '../core/graphDisplay';
import { ticks } from './axes';
import { spiderHandles, type Axis, type Drawable } from './gateGeometry';

export const PLOT = { w: 460, h: 420, ml: 64, mr: 14, mt: 14, mb: 48 };
export const pw = PLOT.w - PLOT.ml - PLOT.mr;
export const ph = PLOT.h - PLOT.mt - PLOT.mb;

// Perceptual blue -> green -> yellow -> red ramp for pseudocolor density.
// table: a colour table (Adjust color table) replacing the built-in ramp.
function ramp(t: number, table?: [number, number, number][]): [number, number, number] {
  if (table?.length) return table[Math.min(table.length - 1, Math.max(0, Math.floor(t * table.length)))];
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

function drawLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, align: 'center' | 'right', scientific = true) {
  const m0 = /^(-?)10\^(\d+)$/.exec(label);
  // Preference "Use Scientific Notation" off: the plain number.
  if (m0 && !scientific) label = `${m0[1]}${(10 ** Number(m0[2])).toFixed(0)}`;
  const m = scientific ? /^(-?10)\^(\d+)$/.exec(label) : null;
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
  // Populations drawn on top (backgating): dots on 2-D plots, curves on
  // histograms. Histograms share one count axis unless normalize is set.
  overlays?: { label: string; data: PlotResult }[];
  overlayLarge?: boolean; // overlay dots drawn large (layout BACKGATELARGE)
  noLegend?: boolean; // hide the overlay legend (layout Legend toggle)
  // Histograms: FlowJo's "Normalized To Mode": every curve scaled so its mode is
  // 100; the axis is relabelled. Off by default, as in FlowJo 10 (specs 6.7).
  normalize?: boolean;
  // Axis titles; FlowJo's Graph Window shows "name :: stain" when the
  // parameter has a stain (preference "Include Parameter Stain", on by default;
  // specs 18.1). Default: the parameter name.
  xTitle?: string;
  yTitle?: string;
  // Gate annotations (FlowJo showGateNameOnPlots / showFreqOnPlots; default on).
  gateNames?: boolean;
  gateFreq?: boolean;
  // FlowJo's axes string (AnnotationPanel.getShowAxes): x letters t n l (ticks,
  // numbers, label), y letters T N L; a letter shown when present. Default all.
  axes?: string;
  // Graph window Display menu (GWActionManager.getDisplayActions; specs 22.1):
  // grid at the labelled ticks, large dots, medians. Defaults off.
  grid?: boolean;
  largeDots?: boolean;
  medians?: boolean;
  // Colour axis: pseudocolor cells take the colour of the bin's mean of the
  // colour parameter over its range (blue, green, yellow, red), not the density.
  colorBy?: { values: ArrayLike<number>; range: [number, number]; label: string };
  // Graph window options (docs/validation/ui-gaps/graph.md): smoothing amount
  // in effect (0 off; FlowJo draws every amount above 0 alike), foreground
  // (dots, curves, contour lines, outliers) and background colours, a
  // transparent canvas (Copy Image), the histogram Y top (undefined = Auto),
  // the scientific-notation preference and a colour table.
  smoothing?: number;
  foreColor?: string;
  backColor?: string;
  transparent?: boolean;
  yMax?: number;
  scientific?: boolean;
  colorTable?: [number, number, number][];
}

// Gate frequency text (specs 22.1): 3 significant figures, trailing zeros kept,
// at most 2 decimals, no % sign; between 0 and 0.01 scientific ("4.00E-3").
export function formatFreq(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v > 0 && v < 0.01) return v.toExponential(2).replace('e', 'E').replace('E+', 'E');
  const p = v.toPrecision(3);
  const dec = p.includes('.') ? p.split('.')[1].length : 0;
  return dec > 2 ? v.toFixed(2) : p.includes('e') ? String(Math.round(v)) : p;
}

// Median of a binned marginal (bin index, fractional), or null when empty.
function medianBin(m: ArrayLike<number>): number | null {
  let tot = 0;
  for (let i = 0; i < m.length; i++) tot += m[i];
  if (!tot) return null;
  let acc = 0;
  for (let i = 0; i < m.length; i++) { acc += m[i]; if (acc >= tot / 2) return i + 0.5; }
  return m.length - 0.5;
}

const maxOf = (a: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, a[i]);
  return m;
};

// Histogram y scale: per-curve factor and the axis maximum. Raw counts share
// one axis over the base and every overlay; normalized curves peak at 100.
export function histogramScale(base: ArrayLike<number> | null, overlays: ArrayLike<number>[], normalize: boolean): { factor: (d: ArrayLike<number>) => number; max: number; label: string } {
  if (normalize) return { factor: (d) => { const m = maxOf(d); return m > 0 ? 100 / m : 0; }, max: 100, label: 'Normalized To Mode' };
  const max = Math.max(base ? maxOf(base) : 0, ...overlays.map(maxOf)) || 1;
  return { factor: () => 1, max, label: 'Count' };
}

export const OVERLAY_COLORS = ['#e6194b', '#3cb44b', '#f58231', '#911eb4', '#008080', '#9a6324'];

// Returns the number of contour segments drawn (0 for other plot kinds).
export function renderPlot(ctx: CanvasRenderingContext2D, o: RenderOptions): number {
  let contourSegments = 0;
  const yAxis: Axis = o.y ?? { channel: '', spec: { kind: 'none' }, t: null!, range: [0, 1] };
  const sx = (v: number) => PLOT.ml + ((v - o.x.range[0]) / (o.x.range[1] - o.x.range[0])) * pw;
  const sy = (v: number) => PLOT.mt + ph - ((v - yAxis.range[0]) / (yAxis.range[1] - yAxis.range[0])) * ph;
  const smoothOn = (o.smoothing ?? 0) > 0;
  // Histograms: smoothed curves when smoothing is on (BasicHistogram::Smooth).
  const curve = (dd: ArrayLike<number>) => (smoothOn && !o.y ? smoothCurve(dd) : dd);
  const baseCurve = o.data && !o.y ? curve(o.data.density) : null;
  const hs = histogramScale(baseCurve, (o.overlays ?? []).map((ov) => curve(ov.data.density)), !!o.normalize);
  // Set Y Axis Range: Manual sets the top of the count axis (no 5% headroom).
  const manualY = !o.y && !o.normalize && o.yMax !== undefined && o.yMax > 0;
  const histMax = manualY ? o.yMax! / 1.05 : hs.max;
  const hy = (c: number) => PLOT.mt + ph - (Math.min(c, histMax * 1.05) / (histMax * 1.05)) * ph;
    if (o.transparent) ctx.clearRect(0, 0, PLOT.w, PLOT.h);
    else { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PLOT.w, PLOT.h); }
    if (o.backColor) { ctx.fillStyle = o.backColor; ctx.fillRect(PLOT.ml, PLOT.mt, pw, ph); }
    const fore = o.foreColor;
    const d = o.data;
    if (d) {
      if (o.y && (o.kind === 'pseudocolor' || o.kind === 'density' || o.kind === 'zebra')) {
        const B = d.bins;
        // density: Gaussian-smoothed counts; zebra: equal-probability bands of
        // the smoothed density, alternating light/dark shades per band.
        // Smooth on: the engine's adaptive kernel; off: the raw counts.
        const smoothed = smoothOn ? smoothGrid(d.density, B) : null;
        const levels = contourLevels(o.contourLevel ?? 10);
        const bandGrid = smoothed ?? Float64Array.from(d.density);
        const bands = o.kind === 'zebra' ? probabilityBands(bandGrid, probabilityThresholds(bandGrid, levels)) : null;
        // Show Outliers (smoothed pseudocolor / density / zebra): cells under the
        // outermost 2% level are left empty and their events drawn as dots.
        const outT = o.showOutliers && smoothed && canShowOutliers(o.kind, true) ? probabilityThresholds(smoothed, contourLevels(2))[0] : NaN;
        const grid: ArrayLike<number> = smoothed ?? d.density;
        let mx = 0;
        for (let i = 0; i < grid.length; i++) mx = Math.max(mx, grid[i]);
        const img = ctx.createImageData(pw, ph);
        const greyBase = !!o.overlays?.length;
        const lmx = Math.log1p(mx);
        const table = o.colorTable;
        const colorBy = o.colorBy && o.kind === 'pseudocolor' ? o.colorBy : null;
        for (let py = 0; py < ph; py++) {
          const by = Math.floor(((ph - 1 - py) / ph) * B);
          for (let px = 0; px < pw; px++) {
            const bx = Math.floor((px / pw) * B);
            const c = grid[by * B + bx];
            const o = (py * pw + px) * 4;
            if (bands) {
              const k = bands[by * B + bx];
              if ((k > 0 || d.density[by * B + bx] > 0) && !(bandGrid[by * B + bx] < outT)) {
                const [r, g, b] = ramp(k / levels.length, table);
                const shade = k % 2 ? 1 : 0.78;
                img.data[o] = r * shade; img.data[o + 1] = g * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
              } else img.data[o + 3] = 0;
            } else if (c > (smoothed ? mx * 1e-4 : 0) && !(c < outT)) {
              // Greyscale base when overlays are shown so overlay colours stay distinct.
              const cv = colorBy ? colorBy.values[by * B + bx] : NaN;
              const tt = colorBy && Number.isFinite(cv) ? (cv - colorBy.range[0]) / ((colorBy.range[1] - colorBy.range[0]) || 1) : Math.log1p(c) / lmx;
              const [r, g, b] = greyBase ? ([1, 1, 1].map(() => Math.round(215 - 135 * tt)) as [number, number, number]) : ramp(tt, table);
              img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
            } else img.data[o + 3] = 0;
          }
        }
        const tmp = document.createElement('canvas');
        tmp.width = pw; tmp.height = ph;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        ctx.drawImage(tmp, PLOT.ml, PLOT.mt);
        if (Number.isFinite(outT)) {
          ctx.fillStyle = fore ?? 'rgba(40,40,40,0.6)';
          for (let i = 0; i < d.points.length; i += 2) {
            const bx = Math.floor(((d.points[i] - o.x.range[0]) / (o.x.range[1] - o.x.range[0])) * B);
            const by = Math.floor(((d.points[i + 1] - yAxis.range[0]) / (yAxis.range[1] - yAxis.range[0])) * B);
            if (smoothed![Math.min(B - 1, Math.max(0, by)) * B + Math.min(B - 1, Math.max(0, bx))] < outT) ctx.fillRect(sx(Math.min(Math.max(d.points[i], o.x.range[0]), o.x.range[1])), sy(Math.min(Math.max(d.points[i + 1], yAxis.range[0]), yAxis.range[1])) - 1, 1.5, 1.5);
          }
        }
      } else if (o.y && o.kind === 'contour') {
        contourSegments = drawContours(ctx, d, o, sx, sy, yAxis);
      } else if (o.y) {
        ctx.fillStyle = fore ?? 'rgba(20,40,120,0.55)';
        for (let i = 0; i < d.points.length; i += 2) {
          const X = sx(Math.min(Math.max(d.points[i], o.x.range[0]), o.x.range[1]));
          const Y = sy(Math.min(Math.max(d.points[i + 1], yAxis.range[0]), yAxis.range[1]));
          if (o.largeDots) ctx.fillRect(X - 1, Y - 2, 3, 3); else ctx.fillRect(X, Y - 1, 1.5, 1.5);
        }
      } else {
        const B = d.bins;
        const hd = baseCurve!;
        const f = hs.factor(hd);
        ctx.beginPath();
        ctx.moveTo(PLOT.ml, PLOT.mt + ph);
        for (let i = 0; i < B; i++) {
          const x0 = PLOT.ml + (i / B) * pw;
          ctx.lineTo(x0, hy(hd[i] * f));
          ctx.lineTo(x0 + pw / B, hy(hd[i] * f));
        }
        ctx.lineTo(PLOT.ml + pw, PLOT.mt + ph);
        ctx.closePath();
        ctx.save();
        if (fore) { ctx.globalAlpha = 0.35; ctx.fillStyle = fore; } else ctx.fillStyle = 'rgba(60,110,200,0.35)';
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = fore ?? '#2a4f9c';
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
            if (o.overlayLarge) ctx.fillRect(X - 1.5, Y - 1.5, 3, 3); else ctx.fillRect(X - 0.75, Y - 0.75, 1.6, 1.6);
          }
        } else {
          const D = curve(ov.data.density);
          const f = hs.factor(D);
          if (maxOf(D) > 0) {
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < D.length; i++) {
              const X = PLOT.ml + ((i + 0.5) / D.length) * pw;
              const Y = hy(D[i] * f);
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
      if (!o.noLegend) o.overlays.forEach((ov, k) => {
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
    const ax = o.axes ?? 'tnlTNL';
    for (const t of ticks(o.x.t)) {
      const X = sx(t.pos);
      if (ax.includes('t')) { ctx.beginPath(); ctx.moveTo(X, PLOT.mt + ph); ctx.lineTo(X, PLOT.mt + ph + (t.major ? 5 : 2)); ctx.stroke(); }
      if (t.label && ax.includes('n')) drawLabel(ctx, t.label, X, PLOT.mt + ph + 16, 'center', o.scientific !== false);
    }
    ctx.font = '11px sans-serif';
    if (ax.includes('l')) ctx.fillText(o.xTitle ?? o.x.channel, PLOT.ml + pw / 2, PLOT.h - 8);
    ctx.textAlign = 'right';
    ctx.font = '10px sans-serif';
    if (o.y) {
      for (const t of ticks(o.y.t)) {
        const Y = sy(t.pos);
        if (ax.includes('T')) { ctx.beginPath(); ctx.moveTo(PLOT.ml, Y); ctx.lineTo(PLOT.ml - (t.major ? 5 : 2), Y); ctx.stroke(); }
        if (t.label && ax.includes('N')) drawLabel(ctx, t.label, PLOT.ml - 7, Y + 3, 'right', o.scientific !== false);
      }
    } else if (ax.includes('N')) {
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
    if (ax.includes('L')) ctx.fillText(o.y ? o.yTitle ?? o.y.channel : hs.label, 0, 0);
    ctx.restore();
    // Show Grid: light grey lines at the labelled ticks, over the data, under the gates.
    if (o.grid) {
      ctx.save();
      ctx.strokeStyle = '#d4d4d4';
      ctx.lineWidth = 1;
      for (const t of ticks(o.x.t)) if (t.major) { const X = Math.round(sx(t.pos)) + 0.5; ctx.beginPath(); ctx.moveTo(X, PLOT.mt); ctx.lineTo(X, PLOT.mt + ph); ctx.stroke(); }
      if (o.y) for (const t of ticks(o.y.t)) if (t.major) { const Y = Math.round(sy(t.pos)) + 0.5; ctx.beginPath(); ctx.moveTo(PLOT.ml, Y); ctx.lineTo(PLOT.ml + pw, Y); ctx.stroke(); }
      ctx.restore();
    }
    // Show Medians: a 20 px "+" at the medians when the population has more than
    // 10 events; on a histogram a dotted vertical line (own: from the display bins).
    if (o.medians && d && d.count > 10) {
      const B = d.bins;
      ctx.save();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.2;
      const toX = (b: number) => sx(o.x.range[0] + (b / B) * (o.x.range[1] - o.x.range[0]));
      if (o.y && d.density.length === B * B) {
        const mx = new Float64Array(B), my = new Float64Array(B);
        for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const c = d.density[y * B + x]; mx[x] += c; my[y] += c; }
        const bx = medianBin(mx), by = medianBin(my);
        if (bx !== null && by !== null) {
          const X = toX(bx), Y = sy(yAxis.range[0] + (by / B) * (yAxis.range[1] - yAxis.range[0]));
          ctx.beginPath(); ctx.moveTo(X - 10, Y); ctx.lineTo(X + 10, Y); ctx.moveTo(X, Y - 10); ctx.lineTo(X, Y + 10); ctx.stroke();
        }
      } else if (!o.y) {
        const bx = medianBin(d.density);
        if (bx !== null) { ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(toX(bx), PLOT.mt); ctx.lineTo(toX(bx), PLOT.mt + ph); ctx.stroke(); }
      }
      ctx.restore();
    }
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
      // Gate colour (Gate.getTint) and Tint: a tinted gate is outlined in its
      // colour and filled at 40%.
      const gateColor = g.pop.tint ?? '#111';
      ctx.strokeStyle = sel ? '#d0021b' : gateColor;
      ctx.lineWidth = sel ? 2 : 1.3;
      const c = o.counts[g.pop.id];
      const pct = c && c.parentCount > 0 ? formatFreq((100 * c.count) / c.parentCount) : '';
      let lx = 0, ly = 0, centred = false;
      ctx.beginPath();
      if (g.kind === 'rect') {
        ctx.rect(sx(g.x0), sy(g.y1), sx(g.x1) - sx(g.x0), sy(g.y0) - sy(g.y1));
        lx = (sx(g.x0) + sx(g.x1)) / 2; ly = (sy(g.y0) + sy(g.y1)) / 2;
        centred = true;
      } else if (g.kind === 'range') {
        const yy = PLOT.mt + 30;
        ctx.moveTo(sx(g.x0), yy - 8); ctx.lineTo(sx(g.x0), yy + 8); ctx.moveTo(sx(g.x0), yy); ctx.lineTo(sx(g.x1), yy); ctx.moveTo(sx(g.x1), yy - 8); ctx.lineTo(sx(g.x1), yy + 8);
        lx = sx(g.x0) + 3; ly = yy - 10;
      } else if (g.kind === 'polygon' || g.kind === 'ellipse' || g.kind === 'curly' || g.kind === 'spider') {
        g.pts.forEach(([a, b], i) => (i ? ctx.lineTo(sx(a), sy(b)) : ctx.moveTo(sx(a), sy(b))));
        ctx.closePath();
        // "inside": centred on the gate's bounding box (specs 22.1).
        lx = (Math.min(...g.pts.map((q) => sx(q[0]))) + Math.max(...g.pts.map((q) => sx(q[0])))) / 2; ly = (Math.min(...g.pts.map((q) => sy(q[1]))) + Math.max(...g.pts.map((q) => sy(q[1])))) / 2;
        centred = true;
      } else if (g.kind === 'spline') {
        g.xCurve.forEach(([a, b], i) => (i ? ctx.lineTo(sx(a), sy(b)) : ctx.moveTo(sx(a), sy(b))));
        g.yCurve.forEach(([a, b], i) => (i ? ctx.lineTo(sx(a), sy(b)) : ctx.moveTo(sx(a), sy(b))));
        const gate = g.pop.gate as Extract<Gate, { type: 'splineQuadrant' }>;
        lx = gate.side[0] ? PLOT.ml + pw - 110 : PLOT.ml + 4;
        ly = gate.side[1] ? PLOT.mt + 14 : PLOT.mt + ph - 6;
      } else if (g.kind === 'quadrant') {
        // The two half-lines bounding this quadrant: the four together draw
        // the cross, or a stepped cross for an offset quad.
        const gate = g.pop.gate as Extract<Gate, { type: 'quadrant' }>;
        ctx.moveTo(sx(g.x), sy(g.y)); ctx.lineTo(sx(g.x), gate.side[1] ? PLOT.mt : PLOT.mt + ph);
        ctx.moveTo(sx(g.x), sy(g.y)); ctx.lineTo(gate.side[0] ? PLOT.ml + pw : PLOT.ml, sy(g.y));
        lx = gate.side[0] ? PLOT.ml + pw - 110 : PLOT.ml + 4;
        ly = gate.side[1] ? PLOT.mt + 14 : PLOT.mt + ph - 6;
      }
      if (g.pop.tinted && g.kind !== 'range' && g.kind !== 'quadrant' && g.kind !== 'spline') {
        ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = g.pop.tint ?? '#808080'; ctx.fill(); ctx.restore();
      }
      ctx.stroke();
      if (g.kind === 'polygon' && sel) for (const [a, b] of g.pts) ctx.strokeRect(sx(a) - 3, sy(b) - 3, 6, 6);
      if (g.kind === 'ellipse' && sel && g.editable) for (const [a, b] of g.handles) ctx.strokeRect(sx(a) - 3, sy(b) - 3, 6, 6);
      if (g.kind === 'curly' && sel) ctx.strokeRect(sx(g.center[0]) - 3, sy(g.center[1]) - 3, 6, 6);
      if (g.kind === 'spider' && sel) {
        // Side points sit on the frame edges; keep their handles on the plot.
        const cl = (v: number, lo: number, hi: number) => Math.min(hi - 3, Math.max(lo + 3, v));
        for (const [a, b] of spiderHandles(g.shape)) ctx.strokeRect(cl(sx(a), PLOT.ml, PLOT.ml + pw) - 3, cl(sy(b), PLOT.mt, PLOT.mt + ph) - 3, 6, 6);
      }
      if (g.kind === 'spline' && sel && g.editable) for (const [a, b] of [...g.xPts, ...g.yPts]) ctx.strokeRect(sx(a) - 3, sy(b) - 3, 6, 6);
      ctx.fillStyle = sel ? '#d0021b' : gateColor;
      // Name on the first line, frequency on the second; quadrant names up to the colon.
      const name = o.gateNames === false ? '' : g.kind === 'quadrant' || g.kind === 'spline' ? g.pop.name.split(':')[0] : g.pop.name;
      const lines = [name, o.gateFreq === false ? '' : pct].filter(Boolean);
      if (!lines.length) continue;
      const wMax = Math.max(...lines.map((t) => ctx.measureText(t).width));
      const x0 = centred ? lx - wMax / 2 : lx;
      const y0 = centred ? ly - ((lines.length - 1) * 12) / 2 + 4 : ly;
      const p = placeLabel(placed, wMax, x0, y0, { x0: PLOT.ml + 2, y0: PLOT.mt + 11, x1: PLOT.ml + pw - 2, y1: PLOT.mt + ph - 2 - (lines.length - 1) * 12 });
      lines.forEach((t, k) => ctx.fillText(t, p.x + (centred ? (wMax - ctx.measureText(t).width) / 2 : 0), p.y + k * 12));
      if (lines.length > 1) placed.push({ x: p.x, y: p.y + 12, w: wMax });
    }
  ctx.restore();
  return contourSegments;
}

function drawContours(ctx: CanvasRenderingContext2D, d: PlotResult, o: RenderOptions, sx: (v: number) => number, sy: (v: number) => number, yAxis: Axis): number {
  let n = 0;
  const B = d.bins;
  // Contours are always smoothed (DisplayType.isSmoothedByDefault), with the
  // engine's adaptive kernel.
  const sm = smoothGrid(d.density, B);
  const ts = probabilityThresholds(sm, contourLevels(o.contourLevel ?? 5));
  if (o.showOutliers && ts.length) {
    // Events in bins below the outermost contour are drawn as dots.
    ctx.fillStyle = o.foreColor ?? 'rgba(40,40,40,0.6)';
    for (let i = 0; i < d.points.length; i += 2) {
      const bx = Math.min(B - 1, Math.max(0, Math.floor(((d.points[i] - o.x.range[0]) / (o.x.range[1] - o.x.range[0])) * B)));
      const by = Math.min(B - 1, Math.max(0, Math.floor(((d.points[i + 1] - yAxis.range[0]) / (yAxis.range[1] - yAxis.range[0])) * B)));
      if (sm[by * B + bx] < ts[0]) ctx.fillRect(sx(d.points[i]), sy(d.points[i + 1]) - 1, 1.5, 1.5);
    }
  }
  ctx.strokeStyle = o.foreColor ?? '#1d2a55';
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
