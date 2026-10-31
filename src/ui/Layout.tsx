// Layout editor: an ordered list of plots rendered for any sample, with
// single-sample and batch (every sample in the group) PNG export.
import { useEffect, useState } from 'react';
import { populationPath, type LayoutItem, type SampleState, type Workspace } from '../core/model';
import type { PlotResult, SampleMeta } from '../core/service';
import { makeAxis, sampleChannels } from './axes';
import { drawableGates } from './gateGeometry';
import { PLOT, renderPlot, type RenderOptions } from './renderPlot';
import { asCanvas, SvgContext } from './svgContext';
import type { createAnalysisClient } from './workerClient';

type Client = ReturnType<typeof createAnalysisClient>;
const TITLE_H = 22;

interface Rendered {
  item: LayoutItem;
  canvas: HTMLCanvasElement | null;
  options?: RenderOptions; // kept so the same plot can be re-rendered as SVG
  title: string;
  error?: string;
}

// Render every layout item for one sample into standalone canvases.
export async function renderLayout(client: Client, ws: Workspace, s: SampleState, meta: SampleMeta, items: LayoutItem[]): Promise<Rendered[]> {
  const base = { sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters };
  const analysis = await client.analyze(base);
  const counts: Record<string, { count: number; parentCount: number }> = {};
  for (const r of analysis.results) if (r) counts[r.id] = r;
  const out: Rendered[] = [];
  for (const item of items) {
    const pop = item.populationPath ? s.populations.find((p) => populationPath(s.populations, p.id) === item.populationPath) : null;
    const label = item.populationPath || 'All events';
    if (item.populationPath && !pop) {
      out.push({ item, canvas: null, title: `${s.fileName} / ${label}`, error: 'population not present in this sample' });
      continue;
    }
    const chans = sampleChannels(meta, s.compensation, ws.matrices, ws.derivedParameters);
    const x = makeAxis(chans, meta.keywords, ws.channelTransforms, item.x);
    const y = item.kind === 'histogram' ? null : makeAxis(chans, meta.keywords, ws.channelTransforms, item.y ?? '');
    if (!x || (item.kind !== 'histogram' && !y)) {
      out.push({ item, canvas: null, title: `${s.fileName} / ${label}`, error: `channel ${!x ? item.x : item.y} not in this sample` });
      continue;
    }
    const data: PlotResult = await client.plot({
      ...base,
      popId: pop?.id ?? null,
      x: { kind: 'channel', channel: x.channel, transform: x.spec },
      y: y ? { kind: 'channel', channel: y.channel, transform: y.spec } : null,
      bins: y ? 200 : 256,
      xRange: x.range,
      yRange: y ? y.range : null,
      maxPoints: 20000,
    });
    const overlays: { label: string; data: PlotResult }[] = [];
    for (const path of item.overlays ?? []) {
      const op = s.populations.find((q) => populationPath(s.populations, q.id) === path);
      if (!op) continue;
      overlays.push({ label: path, data: await client.plot({ ...base, popId: op.id, x: { kind: 'channel', channel: x.channel, transform: x.spec }, y: y ? { kind: 'channel', channel: y.channel, transform: y.spec } : null, bins: y ? 200 : 256, xRange: x.range, yRange: y ? y.range : null, maxPoints: 5000 }) });
    }
    const cv = document.createElement('canvas');
    cv.width = PLOT.w;
    cv.height = PLOT.h;
    const options: RenderOptions = { kind: item.kind, x, y, data, gates: drawableGates(s.populations, pop?.id ?? null, x, y), counts, contourLevel: item.contourLevel, showOutliers: item.showOutliers, overlays };
    renderPlot(cv.getContext('2d')!, options);
    out.push({ item, canvas: cv, options, title: `${s.fileName} / ${label} (${data.count.toLocaleString()} events)` });
  }
  return out;
}

// Compose rendered plots into one image, `cols` per row, each with a title.
export function compose(rendered: Rendered[], cols = 2): HTMLCanvasElement {
  const rows = Math.max(1, Math.ceil(rendered.length / cols));
  const cv = document.createElement('canvas');
  cv.width = cols * PLOT.w;
  cv.height = rows * (PLOT.h + TITLE_H);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  rendered.forEach((r, i) => {
    const x0 = (i % cols) * PLOT.w;
    const y0 = Math.floor(i / cols) * (PLOT.h + TITLE_H);
    ctx.fillStyle = '#111';
    ctx.font = '12px sans-serif';
    ctx.fillText(r.title, x0 + 8, y0 + 15, PLOT.w - 16);
    if (r.canvas) ctx.drawImage(r.canvas, x0, y0 + TITLE_H);
    else {
      ctx.fillStyle = '#b00020';
      ctx.fillText(r.error ?? 'not rendered', x0 + 20, y0 + TITLE_H + 40);
    }
  });
  return cv;
}

// Same arrangement as compose(), as an SVG document with vector plots.
export function composeSvg(rendered: Rendered[], cols = 2): string {
  const rows = Math.max(1, Math.ceil(rendered.length / cols));
  const svg = new SvgContext(cols * PLOT.w, rows * (PLOT.h + TITLE_H));
  rendered.forEach((r, i) => {
    const x0 = (i % cols) * PLOT.w;
    const y0 = Math.floor(i / cols) * (PLOT.h + TITLE_H);
    svg.font = '12px sans-serif';
    svg.fillStyle = r.options ? '#111' : '#b00020';
    svg.fillText(r.options ? r.title : `${r.title}: ${r.error ?? 'not rendered'}`, x0 + 8, y0 + 15);
    if (r.options) {
      const sub = new SvgContext(PLOT.w, PLOT.h);
      renderPlot(asCanvas(sub), r.options);
      svg.embed(sub.body(), x0, y0 + TITLE_H);
    }
  });
  return svg.toString();
}

export function LayoutView(p: {
  ws: Workspace;
  meta: Record<string, SampleMeta>;
  samples: SampleState[];
  client: Client;
  onChange: (items: LayoutItem[]) => void;
  onDownload: (name: string, blob: Blob) => void;
  onClose: () => void;
}) {
  const items = p.ws.layout ?? [];
  const loaded = p.samples.filter((s) => p.meta[s.id]);
  const [sampleId, setSampleId] = useState(loaded[0]?.id ?? '');
  const [rendered, setRendered] = useState<Rendered[]>([]);
  const [busy, setBusy] = useState(false);
  const [batchFormat, setBatchFormat] = useState<'png' | 'svg'>('png');
  const [error, setError] = useState('');
  const sample = p.samples.find((s) => s.id === sampleId);

  useEffect(() => {
    if (!sample || !p.meta[sample.id]) return setRendered([]);
    let live = true;
    renderLayout(p.client, p.ws, sample, p.meta[sample.id], items)
      .then((r) => live && setRendered(r))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [sampleId, p.ws, p.meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (i: number, d: number) => {
    const next = [...items];
    const [it] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, it);
    p.onChange(next);
  };
  const toBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  const safe = (s: string) => s.replace(/\.fcs$/i, '').replace(/[^\w.-]+/g, '_');

  return (
    <div className="modal-bg">
      <div className="modal wide layout" role="dialog" aria-label="Layout editor">
        <div className="modal-head">
          <b>Layout editor ({items.length} plots)</b>
          <button onClick={p.onClose} aria-label="Close">x</button>
        </div>
        <div className="modal-body">
          <div className="row">
            Sample <select value={sampleId} onChange={(e) => setSampleId(e.target.value)} data-testid="layout-sample">
              {loaded.map((s) => <option key={s.id} value={s.id}>{s.fileName}</option>)}
            </select>
            <button disabled={!rendered.length} data-testid="layout-export" onClick={async () => p.onDownload(`layout_${safe(sample!.fileName)}.png`, await toBlob(compose(rendered)))}>Export PNG (this sample)</button>
            <button disabled={!rendered.length} data-testid="layout-export-svg" onClick={() => p.onDownload(`layout_${safe(sample!.fileName)}.svg`, new Blob([composeSvg(rendered)], { type: 'image/svg+xml' }))}>Export SVG (this sample)</button>
            <button
              disabled={!items.length || busy}
              data-testid="layout-batch"
              onClick={async () => {
                setBusy(true);
                try {
                  for (const s of loaded) {
                    const r = await renderLayout(p.client, p.ws, s, p.meta[s.id], items);
                    p.onDownload(`layout_${safe(s.fileName)}.${batchFormat}`, batchFormat === 'svg' ? new Blob([composeSvg(r)], { type: 'image/svg+xml' }) : await toBlob(compose(r)));
                  }
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Batch export ({loaded.length} samples in group)
            </button>
            <select value={batchFormat} onChange={(e) => setBatchFormat(e.target.value as 'png' | 'svg')} data-testid="layout-batch-format">
              <option value="png">PNG</option>
              <option value="svg">SVG</option>
            </select>
            {busy && <span className="muted">exporting...</span>}
          </div>
          {loaded.length < p.samples.length && <p className="muted">{p.samples.length - loaded.length} sample(s) without loaded data are skipped.</p>}
          {error && <p className="error">{error}</p>}
          {!items.length && <p className="muted">Use "Add to layout" under a plot to place it here.</p>}
          <div className="layout-grid">
            {items.map((it, i) => {
              const r = rendered.find((x) => x.item.id === it.id);
              return (
                <div key={it.id} className="layout-card" data-testid="layout-card">
                  <div className="row">
                    <span className="pname">{r?.title ?? `${it.populationPath || 'All events'}`}</span>
                    <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="move up">up</button>
                    <button onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="move down">down</button>
                    <button onClick={() => p.onChange(items.filter((x) => x.id !== it.id))} data-testid="layout-remove">remove</button>
                  </div>
                  {r?.canvas ? <img alt={r.title} src={r.canvas.toDataURL()} width={PLOT.w / 1.5} /> : <p className="error">{r?.error ?? 'rendering...'}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
