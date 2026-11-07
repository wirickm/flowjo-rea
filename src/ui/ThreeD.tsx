// FlowJo 10.6.2 3D Viewer (PlatformNavCommand.THREE_D, com.treestar.threeD;
// spec docs/validation/ui-gaps/platforms.md). Own rule: a canvas point cloud
// (FlowJo's default "Point Cloud" plot type) of three parameters on their
// display scales, rotated by dragging; Bubble, Voxel and Terrain plots and the
// Wiggle GIF are not provided.
import { useEffect, useMemo, useRef, useState } from 'react';
import { populationPath } from '../core/model';
import { makeAxis, sampleChannels, withStains } from './axes';
import type { ToolCtx } from './PlatformTools';

// ThreeDDataModel.SPECTRUM: violet, blue, cyan, green, yellow, red.
const SPECTRUM = [[127, 0, 255], [0, 0, 255], [0, 255, 255], [0, 255, 0], [255, 255, 0], [255, 0, 0]];
export function spectrum(u: number): string {
  const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)) * (SPECTRUM.length - 1);
  const i = Math.min(SPECTRUM.length - 2, Math.floor(t)), f = t - i;
  const c = SPECTRUM[i].map((v, k) => Math.round(v + (SPECTRUM[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
// Rotation about y (yaw) then x (pitch), orthographic projection.
export function project(x: number, y: number, z: number, yaw: number, pitch: number): [number, number, number] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
  return [x1, cp * y - sp * z1, sp * y + cp * z1];
}
const DEFAULT_VIEW = { yaw: -0.6, pitch: 0.4 };

export function ThreeDViewer(p: ToolCtx) {
  const [sampleId, setSampleId] = useState(p.sample!.id);
  const s = p.ws.samples.find((x) => x.id === sampleId) ?? p.sample!;
  const path = p.popId && p.sample ? populationPath(p.sample.populations, p.popId) : '';
  const meta = p.meta[s.id] ? withStains(p.meta[s.id], s.stains) : null;
  const channels = useMemo(() => (meta ? sampleChannels(meta, s.compensation, p.ws.matrices, p.ws.derivedParameters) : []), [meta, s.compensation, p.ws.matrices, p.ws.derivedParameters]);
  const names = channels.map((c) => c.name).filter((n) => !/^time$/i.test(n));
  const [axes, setAxes] = useState<string[]>(() => names.slice(0, 3));
  const [colorBy, setColorBy] = useState('');
  const [scale, setScale] = useState(2);
  const [cube, setCube] = useState(true);
  const [labels, setLabels] = useState(true);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [pts, setPts] = useState<{ v: Float32Array; n: number; dims: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; v: typeof view } | null>(null);
  const ranges = useRef<[number, number][]>([]);

  useEffect(() => {
    if (!meta) { setError('Sample data is not loaded'); return; }
    const pop = path ? s.populations.find((q) => populationPath(s.populations, q.id) === path) : null;
    if (path && !pop) { setError(`Population ${path} not found in ${s.fileName}`); setPts(null); return; }
    const chs = [...axes, ...(colorBy ? [colorBy] : [])];
    const ax = chs.map((ch) => makeAxis(channels, meta.keywords, p.ws.channelTransforms, ch));
    if (ax.some((a) => !a)) return;
    ranges.current = ax.map((a) => a!.range);
    let live = true;
    p.client.eventMatrix({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: p.ws.matrices, derived: p.ws.derivedParameters, popId: pop?.id ?? null, dims: ax.map((a) => ({ kind: 'channel' as const, channel: a!.channel, transform: a!.spec })), maxEvents: 8000 })
      .then((m) => { if (live) { setPts({ v: m.values, n: m.count, dims: chs.length }); setError(null); } }, (e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [sampleId, axes.join('|'), colorBy, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const W = cv.width, H = cv.height, R = Math.min(W, H) * 0.32;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    const toScreen = (x: number, y: number, z: number) => { const [a, b, c] = project(x, y, z, view.yaw, view.pitch); return [W / 2 + a * R, H / 2 - b * R, c]; };
    if (cube) {
      g.strokeStyle = '#999';
      const c = [-1, 1];
      for (const a of c) for (const b of c) for (const [p0, p1] of [[[-1, a, b], [1, a, b]], [[a, -1, b], [a, 1, b]], [[a, b, -1], [a, b, 1]]] as const) {
        const [x0, y0] = toScreen(p0[0], p0[1], p0[2]), [x1, y1] = toScreen(p1[0], p1[1], p1[2]);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
    if (pts) {
      const rg = ranges.current;
      const nrm = (v: number, k: number) => ((v - rg[k][0]) / (rg[k][1] - rg[k][0])) * 2 - 1;
      const order: [number, number, number, string][] = [];
      for (let i = 0; i < pts.n; i++) {
        const o = i * pts.dims;
        const [x, y, z] = toScreen(nrm(pts.v[o], 0), nrm(pts.v[o + 1], 1), nrm(pts.v[o + 2], 2));
        order.push([x, y, z, pts.dims > 3 ? spectrum((nrm(pts.v[o + 3], 3) + 1) / 2) : '#1f4fb4']);
      }
      order.sort((a, b) => a[2] - b[2]);
      for (const [x, y, , c] of order) { g.fillStyle = c; g.fillRect(x - scale / 2, y - scale / 2, scale, scale); }
    }
    if (labels) {
      g.fillStyle = '#000';
      g.font = '12px sans-serif';
      const ends = [[1.15, -1, -1], [-1, 1.15, -1], [-1, -1, 1.15]];
      axes.forEach((a, k) => { const [x, y] = toScreen(ends[k][0], ends[k][1], ends[k][2]); g.fillText(a, x, y); });
    }
  }, [pts, view, cube, labels, scale, axes]);

  const idx = p.ws.samples.findIndex((x) => x.id === s.id);
  const step = (d: number) => { const n = p.ws.samples.length; for (let k = 1; k <= n; k++) { const t = p.ws.samples[(idx + d * k + n * k) % n]; if (p.meta[t.id]) { setSampleId(t.id); return; } } };
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal wide" role="dialog" aria-label="3D Viewer" data-testid="threed-dialog">
        <div className="modal-head"><b>3D Viewer - {s.fileName}/{path || 'All events'}</b><button onClick={p.onClose} aria-label="Close" data-testid="threed-close">x</button></div>
        <div className="modal-body">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {['X', 'Y', 'Z'].map((l, k) => <label key={l}>{l} <select value={axes[k] ?? ''} onChange={(e) => setAxes((a) => a.map((x, i) => (i === k ? e.target.value : x)))} data-testid={`threed-axis-${l}`}>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>)}
            <label title="Map a parameter to plot point color.">Color Parameter <select value={colorBy} onChange={(e) => setColorBy(e.target.value)} data-testid="threed-color"><option value="">Static</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label title="Set plot point size">Point Scale <input type="number" min={1} max={8} value={scale} onChange={(e) => setScale(Math.max(1, Number(e.target.value) || 1))} style={{ width: 40 }} data-testid="threed-scale" /></label>
            <label><input type="checkbox" checked={cube} onChange={(e) => setCube(e.target.checked)} data-testid="threed-cube" />Cube</label>
            <label><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} data-testid="threed-labels" />Labels</label>
            <button onClick={() => setView(DEFAULT_VIEW)} data-testid="threed-reset" title="Reset the rotation of the axes to the default perspective.">Reset</button>
            <button onClick={() => step(-1)} data-testid="threed-prev" title="Go to the previous sample in the workspace.">Previous Sample</button>
            <button onClick={() => step(1)} data-testid="threed-next" title="Go to the next sample in the workspace.">Next Sample</button>
            <button onClick={() => canvas.current?.toBlob((b) => b && p.downloadBlob('3d.png', b))} data-testid="threed-export" title="Export the current plot as an image format.">Export...</button>
          </div>
          {error && <p className="error" data-testid="threed-error">{error}</p>}
          <canvas ref={canvas} width={640} height={480} data-testid="threed-canvas" data-points={pts?.n ?? 0} data-yaw={view.yaw.toFixed(3)} style={{ border: '1px solid #ccc', cursor: 'grab' }}
            onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, v: view }; }}
            onMouseMove={(e) => { const d = drag.current; if (d) setView({ yaw: d.v.yaw + (e.clientX - d.x) * 0.01, pitch: Math.max(-1.55, Math.min(1.55, d.v.pitch + (e.clientY - d.y) * 0.01)) }); }}
            onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }} />
          <p className="muted">Drag to rotate. {pts ? `${pts.n} events shown` : ''}</p>
        </div>
      </div>
    </div>
  );
}
