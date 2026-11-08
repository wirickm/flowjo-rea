// FlowJo 10.6.2 3D Viewer (com.treestar.threeD: ThreeDController, ThreeDFrame,
// ThreeDJPlot, the Scatter / Bubble / Surface builders and actions.*; spec
// docs/validation/ui-gaps/platforms.md section 5). Rules live in
// src/core/threeD.ts; this file draws them on a 2D canvas with a depth buffer
// (own rule: no Java 3D / WebGL scene graph).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { populationPath } from '../core/model';
import { bubbleRadius, bubbleStep, defaultAxes, EYE_ANGLE, GRADIENTS, gradientColor, IDENTITY, MOUSE_FACTOR, mul, pointPixels, populationAxis, project, QUICK_COLORS, rotX, rotY, spinStep, SPECTRUM, terrainHeights, CONTOUR_RESOLUTION, wiggleHtml, type Mat3 } from '../core/threeD';
import { makeAxis, sampleChannels, withStains } from './axes';
import type { ToolCtx } from './PlatformTools';

export type PlotType = 'pointcloud' | 'bubble' | 'terrain';
// ThreeDController$PlotType (10.6.2 has no Voxel type; plat.3d.voxel is an
// unused dictionary entry).
const PLOT_TYPES: [PlotType, string][] = [['pointcloud', 'Point Cloud'], ['bubble', 'Bubble Plot'], ['terrain', 'Terrain Plot']];
export interface ThreeDModel { name: string; data: Float32Array[]; color: string; enabled: boolean }
interface Settings { type: PlotType; axes: [number, number, number]; size: number; colorAxis: number; gradient: number; sizeFactor: number; cube: boolean; labels: boolean }

const rgba = (c: number[]) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${(c[3] / 255).toFixed(3)})`;
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

// Draws the plot into a canvas context for the view matrix m.
export function drawThreeD(g: CanvasRenderingContext2D, W: number, H: number, m: Mat3, names: string[], models: ThreeDModel[], s: Settings) {
  g.fillStyle = '#fff'; // PrefsFJML$ThreeD.backgroundColor
  g.fillRect(0, 0, W, H);
  const half = Math.min(W, H) / 2, cx = W / 2, cy = H / 2;
  const P = (x: number, y: number, z: number) => project(m, x - 0.5, y - 0.5, z - 0.5, half, cx, cy);
  const on = models.filter((x) => x.enabled && x.data.length);
  const multi = on.length > 1; // ThreeDController.computeMultiPlot: one colour per population
  const [ax, ay, az] = s.axes;
  const colorOf = (md: ThreeDModel, i: number) => (multi ? hex(md.color) : gradientColor(GRADIENTS[s.gradient] ?? SPECTRUM, md.data[s.colorAxis]?.[i] ?? 0));
  if (s.type === 'pointcloud') {
    const img = g.getImageData(0, 0, W, H), zb = new Float32Array(W * H).fill(-Infinity), px = pointPixels(s.sizeFactor), r0 = Math.floor((px - 1) / 2);
    for (const md of on) {
      const X = md.data[ax], Y = md.data[ay], Z = md.data[az];
      for (let i = 0; i < X.length; i++) {
        const [sx, sy, sz] = P(X[i], Y[i], Z[i]);
        const c = colorOf(md, i), a = c[3] / 255;
        const x0 = Math.round(sx) - r0, y0 = Math.round(sy) - r0;
        for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) {
          if (px > 2 && (dx - (px - 1) / 2) ** 2 + (dy - (px - 1) / 2) ** 2 > (px / 2) ** 2) continue;
          const xx = x0 + dx, yy = y0 + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx;
          if (sz < zb[k]) continue;
          zb[k] = sz;
          const o = k * 4;
          for (let q = 0; q < 3; q++) img.data[o + q] = img.data[o + q] * (1 - a) + c[q] * a;
        }
      }
    }
    g.putImageData(img, 0, 0);
  } else if (s.type === 'bubble') {
    const items: [number, number, number, number, number[]][] = [];
    for (const md of on) {
      const X = md.data[ax], Y = md.data[ay], Z = md.data[az], S = s.size >= 0 ? md.data[s.size] : null;
      for (let i = 0; i < X.length; i += bubbleStep(X.length)) {
        const [sx, sy, sz, k] = P(X[i], Y[i], Z[i]);
        items.push([sx, sy, sz, bubbleRadius(s.sizeFactor, S ? S[i] : null) * k * half, colorOf(md, i)]);
      }
    }
    items.sort((a, b) => a[2] - b[2]);
    for (const [sx, sy, , r, c] of items) {
      const grd = g.createRadialGradient(sx - r / 3, sy - r / 3, r / 8, sx, sy, r);
      grd.addColorStop(0, rgba([255, 255, 255, c[3]]));
      grd.addColorStop(0.4, rgba(c));
      grd.addColorStop(1, rgba([c[0] * 0.35, c[1] * 0.35, c[2] * 0.35, c[3]]));
      g.fillStyle = grd;
      g.beginPath(); g.arc(sx, sy, Math.max(0.5, r), 0, Math.PI * 2); g.fill();
    }
  } else {
    // Terrain: heights over X (columns) and Z (rows); one material colour,
    // that of the first event (ThreeDSurfaceBuilder with colour axes set).
    for (const md of on) {
      const n = CONTOUR_RESOLUTION, h = terrainHeights(md.data[ax], md.data[az], n), w = 1 / n, base = colorOf(md, 0);
      const quads: [number, [number, number][], number][] = [];
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
        const corners: [number, number, number][] = [[i, j, h[i * n + j]], [i, j + 1, h[i * n + j + 1]], [i + 1, j + 1, h[(i + 1) * n + j + 1]], [i + 1, j, h[(i + 1) * n + j]]].map(([a, b, y]) => [w / 2 + a * w, y, w / 2 + b * w]);
        const pr = corners.map(([x, y, z]) => P(x, y, z));
        // Lambert shading of the quad normal against a light from the viewer.
        const u = [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]], v = [corners[3][0] - corners[1][0], corners[3][1] - corners[1][1], corners[3][2] - corners[1][2]];
        const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(nn[0], nn[1], nn[2]) || 1;
        const vz = Math.abs(m[6] * nn[0] + m[7] * nn[1] + m[8] * nn[2]) / len, vy = Math.abs(nn[1]) / len;
        quads.push([pr.reduce((a, p) => a + p[2], 0) / 4, pr.map((p) => [p[0], p[1]]), 0.35 + 0.45 * vz + 0.2 * vy]);
      }
      quads.sort((a, b) => a[0] - b[0]);
      for (const [, pts, l] of quads) {
        g.fillStyle = rgba([Math.min(255, base[0] * l + 40 * l), Math.min(255, base[1] * l + 40 * l), Math.min(255, base[2] * l + 40 * l), 255]);
        g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      }
    }
  }
  const line = (a: number[], b: number[], color: string) => { const p0 = P(a[0], a[1], a[2]), p1 = P(b[0], b[1], b[2]); g.strokeStyle = color; g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke(); };
  if (s.cube) for (const a of [0, 1]) for (const b of [0, 1]) { line([0, a, b], [1, a, b], '#999'); line([a, 0, b], [a, 1, b], '#999'); line([a, b, 0], [a, b, 1], '#999'); }
  // Axes from the origin corner (X, Y, Z builders; no Y axis on a terrain).
  const ends: [number, number[], number[], number][] = [[0, [1, 0, 0], [1.08, -0.04, 0], ax], [1, [0, 1, 0], [-0.04, 1.06, 0], ay], [2, [0, 0, 1], [0, -0.04, 1.08], az]];
  for (const [k, end, lab, idx] of ends) {
    if (k === 1 && s.type === 'terrain') continue;
    line([0, 0, 0], end, '#000');
    if (s.labels) { const p = P(lab[0], lab[1], lab[2]); g.fillStyle = '#000'; g.font = '12px sans-serif'; g.fillText(names[idx] ?? '', p[0], p[1]); }
  }
}

export function ThreeDView(p: { title: string; names: string[]; models: ThreeDModel[]; setModels?: (m: ThreeDModel[]) => void; init: Settings; fileBase: string; error?: string | null; extra?: ReactNode; onClose: () => void; downloadBlob: (name: string, b: Blob) => void; download: (name: string, data: string, type: string) => void }) {
  const [s, setS] = useState<Settings>(p.init);
  const [view, setView] = useState<Mat3>(IDENTITY);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; m: Mat3; lastX: number; dx: number } | null>(null);
  const [spin, setSpin] = useState(0);
  useEffect(() => { setS((x) => ({ ...x, ...p.init, type: x.type, sizeFactor: x.sizeFactor, cube: x.cube, labels: x.labels, gradient: x.gradient })); }, [p.init.axes.join(','), p.init.colorAxis]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!spin) return;
    const t = setInterval(() => setView((m) => mul(m, rotY(spin))), 40);
    return () => clearInterval(t);
  }, [spin]);
  useEffect(() => {
    const cv = canvas.current, g = cv?.getContext('2d');
    if (cv && g) drawThreeD(g, cv.width, cv.height, view, p.names, p.models, s);
  }, [view, s, p.models, p.names]);
  const render = (m: Mat3) => { const c = document.createElement('canvas'); c.width = 640; c.height = 640; drawThreeD(c.getContext('2d')!, 640, 640, m, p.names, p.models, s); return c; };
  const sel = (label: string, value: number, set: (v: number) => void, testId: string, extra?: ReactNode, disabled?: boolean) => <label key={testId}>{label} <select value={value} disabled={disabled} onChange={(e) => set(Number(e.target.value))} data-testid={testId}>{extra}{p.names.map((n, i) => <option key={i} value={i}>{n}</option>)}</select></label>;
  const nPts = p.models.filter((m) => m.enabled).reduce((a, m) => a + (m.data[0]?.length ?? 0), 0);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal wide" role="dialog" aria-label="3D Viewer" data-testid="threed-dialog">
        <div className="modal-head"><b>{p.title}</b><button onClick={p.onClose} aria-label="Close" data-testid="threed-close">x</button></div>
        <div className="modal-body">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label title="Select between the different types of 3D representations.">Set the graph type <select value={s.type} onChange={(e) => setS({ ...s, type: e.target.value as PlotType })} data-testid="threed-type">{PLOT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <button onClick={() => canvas.current?.toBlob((b) => b && p.downloadBlob(`${p.fileBase}.png`, b))} data-testid="threed-export" title="Export the current plot as an image format.">Export...</button>
            <label title="Toggle display of the axes labels."><input type="checkbox" checked={s.labels} onChange={(e) => setS({ ...s, labels: e.target.checked })} data-testid="threed-labels" />Labels</label>
            <label title="Toggle display of the wireframe cube."><input type="checkbox" checked={s.cube} onChange={(e) => setS({ ...s, cube: e.target.checked })} data-testid="threed-cube" />Cube</label>
            <button onClick={() => { setSpin(0); setView(IDENTITY); }} data-testid="threed-reset" title="Reset the rotation of the axes to the default perspective.">Reset</button>
            <button data-testid="threed-wiggle" title="Save a GIF file animating between a slight offset of the perspective." onClick={() => p.download(`${p.fileBase}-wiggle.html`, wiggleHtml(p.title, [render(mul(view, rotY(-EYE_ANGLE))).toDataURL('image/png'), render(view).toDataURL('image/png')]), 'text/html')}>Wiggle...</button>
            {p.extra}
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {(['X', 'Y', 'Z'] as const).map((l, k) => sel(l, s.axes[k], (v) => setS({ ...s, axes: s.axes.map((x, i) => (i === k ? v : x)) as Settings['axes'] }), `threed-axis-${l}`))}
            {sel('Color Parameter', s.colorAxis, (v) => setS({ ...s, colorAxis: v }), 'threed-color')}
            <label title="Choose a point color.  Select a gradient to see color variation based on the selected Color Parameter">Color <select value={s.gradient} onChange={(e) => setS({ ...s, gradient: Number(e.target.value) })} data-testid="threed-gradient">{GRADIENTS.map((g, i) => <option key={g.name} value={i}>{g.name}</option>)}</select></label>
            {sel('Size Parameter', s.size, (v) => setS({ ...s, size: v }), 'threed-size', <option value={-1}>Static</option>, s.type !== 'bubble')}
            <label title="Set plot point size">Point Scale <input type="range" min={0} max={100} value={Math.round(s.sizeFactor * 100)} onChange={(e) => setS({ ...s, sizeFactor: Number(e.target.value) / 100 })} data-testid="threed-scale" /></label>
          </div>
          {p.setModels && p.models.length > 1 && <div className="row" style={{ flexWrap: 'wrap' }} data-testid="threed-pops">{p.models.map((m, i) => <label key={i}><input type="checkbox" checked={m.enabled} onChange={(e) => p.setModels!(p.models.map((x, k) => (k === i ? { ...x, enabled: e.target.checked } : x)))} data-testid={`threed-pop-on-${i}`} /><input type="color" value={m.color} onChange={(e) => p.setModels!(p.models.map((x, k) => (k === i ? { ...x, color: e.target.value } : x)))} data-testid={`threed-pop-color-${i}`} />{m.name}</label>)}</div>}
          {p.error && <p className="error" data-testid="threed-error">{p.error}</p>}
          <canvas ref={canvas} width={640} height={480} data-testid="threed-canvas" data-points={nPts} data-type={s.type} data-view={view.map((v) => v.toFixed(3)).join(',')} style={{ border: '1px solid #ccc', cursor: 'grab' }}
            onMouseDown={(e) => { setSpin(0); drag.current = { x: e.clientX, y: e.clientY, m: view, lastX: e.clientX, dx: 0 }; }}
            onMouseMove={(e) => { const d = drag.current; if (!d) return; d.dx = e.clientX - d.lastX; d.lastX = e.clientX; setView(mul(mul(rotY((e.clientX - d.x) * MOUSE_FACTOR), rotX((e.clientY - d.y) * MOUSE_FACTOR)), d.m)); }}
            onMouseUp={() => { const d = drag.current; drag.current = null; if (d) setSpin(spinStep(d.dx)); }} onMouseLeave={() => { drag.current = null; }} />
          <p className="muted">Drag to rotate (flick to keep it spinning). {nPts} events shown.</p>
        </div>
      </div>
    </div>
  );
}

const baseSettings = (names: string[], a: { x: string; y: string; z: string; color: string }, sizeFactor: number, gradient: number): Settings => ({
  type: 'pointcloud', axes: [names.indexOf(a.x), names.indexOf(a.y), names.indexOf(a.z)].map((v) => Math.max(0, v)) as Settings['axes'], size: -1, colorAxis: Math.max(0, names.indexOf(a.color)), gradient, sizeFactor, cube: true, labels: true,
});

// 3D Viewer of a population (Platforms 3D Viewer and graph window Show in 3D,
// GWNavAction.openCubeView -> ThreeDNode). Default point scale 0.01
// (ThreeDSettings), colour axis an unused parameter with the Spectrum
// gradient (ThreeDNode.setDefaults).
export function ThreeDViewer(p: ToolCtx & { axes?: (string | null)[] }) {
  const [sampleId, setSampleId] = useState(p.sample!.id);
  const s = p.ws.samples.find((x) => x.id === sampleId) ?? p.sample!;
  const path = p.popId && p.sample ? populationPath(p.sample.populations, p.popId) : '';
  const meta = p.meta[s.id] ? withStains(p.meta[s.id], s.stains) : null;
  const channels = useMemo(() => (meta ? sampleChannels(meta, s.compensation, p.ws.matrices, p.ws.derivedParameters) : []), [meta, s.compensation, p.ws.matrices, p.ws.derivedParameters]);
  const names = useMemo(() => channels.map((c) => c.name), [channels]);
  const init = useMemo(() => baseSettings(names, defaultAxes(names, p.axes?.[0] ?? undefined, p.axes?.[1]), 0.01, GRADIENTS.indexOf(SPECTRUM)), [names.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [extraPaths, setExtraPaths] = useState<string[]>([]);
  const [models, setModels] = useState<ThreeDModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addPath, setAddPath] = useState('');
  useEffect(() => {
    if (!meta) { setError('Sample data is not loaded'); return; }
    let live = true;
    (async () => {
      const dims = names.map((ch) => makeAxis(channels, meta.keywords, p.ws.channelTransforms, ch)).filter((a) => !!a);
      const out: ThreeDModel[] = [];
      for (const [k, pth] of [path, ...extraPaths].entries()) {
        const pop = pth ? s.populations.find((q) => populationPath(s.populations, q.id) === pth) : null;
        if (pth && !pop) throw new Error(`Population ${pth} not found in ${s.fileName}`);
        const m = await p.client.eventMatrix({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: p.ws.matrices, derived: p.ws.derivedParameters, popId: pop?.id ?? null, dims: dims.map((a) => ({ kind: 'channel' as const, channel: a!.channel, transform: a!.spec })), maxEvents: 100000 });
        const data = dims.map((a, d) => populationAxis(Float32Array.from({ length: m.count }, (_, i) => (m.values[i * dims.length + d] - a!.range[0]) / (a!.range[1] - a!.range[0]))));
        out.push({ name: pth || 'All events', data, color: QUICK_COLORS[k % QUICK_COLORS.length], enabled: models[k]?.enabled ?? true });
      }
      if (live) { setModels(out); setError(null); }
    })().catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [sampleId, extraPaths.join('|'), meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const idx = p.ws.samples.findIndex((x) => x.id === s.id);
  const step = (d: number) => { const n = p.ws.samples.length; for (let k = 1; k <= n; k++) { const t = p.ws.samples[(idx + d * k + n * k) % n]; if (p.meta[t.id]) { setSampleId(t.id); return; } } };
  const pops = s.populations.map((q) => populationPath(s.populations, q.id)).filter((x) => x !== path && !extraPaths.includes(x));
  return <ThreeDView title={`3D Viewer - ${s.fileName}/${path || 'All events'}`} names={names} models={models} setModels={setModels} init={init} fileBase={`${s.fileName}+3D`} error={error} onClose={p.onClose} downloadBlob={p.downloadBlob} download={p.download}
    extra={<>
      <button onClick={() => step(-1)} data-testid="threed-prev" title="Go to the previous sample in the workspace.">Previous Sample</button>
      <button onClick={() => step(1)} data-testid="threed-next" title="Go to the next sample in the workspace.">Next Sample</button>
      <select value={addPath} onChange={(e) => setAddPath(e.target.value)} data-testid="threed-add-pop-path"><option value="">Add population...</option>{pops.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      <button disabled={!addPath} onClick={() => { setExtraPaths([...extraPaths, addPath]); setAddPath(''); }} data-testid="threed-add-pop">Add</button>
    </>} />;
}

// Table editor 3D Plot (TEPlotAction PLOTPOINTCLOUD): the selected columns
// with ThreeDDataModel(TableData) axes, point scale 0.8, colour axis the third
// column with the Spectrum gradient.
export function TableThreeD(p: { title: string; axes: { name: string; values: Float32Array }[]; onClose: () => void; downloadBlob: (name: string, b: Blob) => void; download: (name: string, data: string, type: string) => void }) {
  const names = p.axes.map((a) => a.name);
  const models = useMemo(() => [{ name: p.title, data: p.axes.map((a) => a.values), color: QUICK_COLORS[0], enabled: true }], [p.axes, p.title]);
  const init = useMemo(() => ({ ...baseSettings(names, { x: names[0], y: names[1] ?? names[0], z: names[2] ?? names[0], color: names[2] ?? names[0] }, 0.8, GRADIENTS.indexOf(SPECTRUM)) }), [names.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ThreeDView title={`3D Plot - ${p.title}`} names={names} models={models} init={init} fileBase={`${p.title}-3D`} onClose={p.onClose} downloadBlob={p.downloadBlob} download={p.download} />;
}
