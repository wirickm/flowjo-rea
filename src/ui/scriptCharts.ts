// Charts and movies made by scripts (docs/validation/ui-gaps/workspace.md O2):
// ChartAPI._toLayout puts the first layer's population in a layout chart with
// every layer on it, and ImageExporter / MediaExporter render that layout. The
// page does the same with the layout renderer (renderLayout), after the run.
import { populationPath, type LayoutPlot, type PlotSettings, type Workspace } from '../core/model';
import type { SampleMeta } from '../core/service';
import type { ChartSpec } from '../core/scriptApi';
import { composePages, composeSvgPages, GRAPH_H, GRAPH_W, renderLayout } from './Layout';
import { canvasesToPdf } from './pdf';
import type { createAnalysisClient } from './workerClient';

type Client = ReturnType<typeof createAnalysisClient>;

// DisplayType -> this app's graph types. Own rule: Timeseries and CDF draw as
// histograms and Heatmap Statistic as pseudocolor (the app has none of those).
export const PLOT_KIND: Record<string, PlotSettings['kind']> = {
  Contour: 'contour', Density: 'density', Zebra: 'zebra', Pseudocolor: 'pseudocolor', DotPlot: 'dot',
  Histogram: 'histogram', Timeseries: 'histogram', CDF: 'histogram', 'Heatmap Statistic': 'pseudocolor',
};

const hex = (c: number) => `#${((c >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;

// The layout chart for a script chart: the first layer's population and
// sample, the chart's parameters (else the population's saved graph), the
// other layers as overlays by path on that sample.
export function chartItem(ws: Workspace, spec: ChartSpec): LayoutPlot | null {
  const first = spec.layers[0];
  const s = first && ws.samples.find((x) => x.id === first.sampleId);
  if (!s) return null;
  const path = first.popId ? populationPath(s.populations, first.popId) : '';
  const saved = ws.plots?.[path];
  const names = s.channelNames;
  const x = spec.params[0] ?? saved?.x ?? names.find((n) => /^FSC-A$/i.test(n)) ?? names[0] ?? '';
  const y = spec.params[1] ?? saved?.y ?? names.find((n) => /^SSC-A$/i.test(n)) ?? names.find((n) => n !== x) ?? null;
  const overlays = spec.layers.slice(1).flatMap((l) => {
    const ls = ws.samples.find((q) => q.id === l.sampleId);
    return ls ? [l.popId ? populationPath(ls.populations, l.popId) : ''] : [];
  });
  return {
    id: 'script-chart', populationPath: path, sampleId: s.id, x, y, kind: PLOT_KIND[spec.type] ?? 'pseudocolor',
    ...(overlays.length ? { overlays } : {}), ...(first.color !== -1 ? { foreColor: hex(first.color) } : {}),
    left: 0, top: 0, width: GRAPH_W, height: GRAPH_H,
  };
}

async function render(client: Client, ws: Workspace, meta: Record<string, SampleMeta>, spec: ChartSpec) {
  const item = chartItem(ws, spec);
  if (!item) throw new Error('Error creating chart for export');
  const rendered = await renderLayout(client, ws, meta, [item], () => ws.samples.find((s) => s.id === item.sampleId));
  const r = rendered[0];
  if (!r?.canvas) throw new Error(r?.error ?? 'Error creating chart for export');
  return { item, rendered };
}

// ImageExporter.saveLayoutToFile: SVG and PDF as vector / page files, PNG and
// JPG as images. Own rule: GIF, TIFF and EMF are written as PNG (browsers
// cannot encode them); PS and SWF write nothing, as in FlowJo (no branch).
export async function chartFile(client: Client, ws: Workspace, meta: Record<string, SampleMeta>, spec: ChartSpec, file: string, type: string): Promise<{ name: string; blob: Blob } | null> {
  if (type === 'PS' || type === 'SWF') return null;
  const { item, rendered } = await render(client, ws, meta, spec);
  const page = { w: GRAPH_W, h: GRAPH_H };
  const ext = (e: string) => (new RegExp(`\\.${e}$`, 'i').test(file) ? file : `${file.replace(/\.[^.]*$/, '')}.${e}`);
  if (type === 'SVG') return { name: ext('svg'), blob: new Blob([composeSvgPages(rendered, [item], page)], { type: 'image/svg+xml' }) };
  const { canvas } = composePages(rendered, [item], page);
  if (type === 'PDF') return { name: ext('pdf'), blob: new Blob([await canvasesToPdf([canvas], page.w, page.h, 0) as BlobPart], { type: 'application/pdf' }) };
  const jpg = type === 'JPG';
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, jpg ? 'image/jpeg' : 'image/png', 0.92));
  if (!blob) throw new Error('Error exporting chart');
  return { name: jpg ? (/\.jpe?g$/i.test(file) ? file : ext('jpg')) : ext('png'), blob };
}

// One movie frame: the chart as a PNG data URL (MediaExporter.render).
export async function chartFrame(client: Client, ws: Workspace, meta: Record<string, SampleMeta>, spec: ChartSpec): Promise<string> {
  const { item, rendered } = await render(client, ws, meta, spec);
  return composePages(rendered, [item], { w: GRAPH_W, h: GRAPH_H }).canvas.toDataURL('image/png');
}

// HtmlMovieCreator: the frames shown one after another every delay ms, with
// play / pause and step buttons; autoPlay starts playing on load. Own rule:
// one HTML file with the frames inline instead of FlowJo's folder (media/
// frames/frame-N, media/config.js).
export function movieHtml(title: string, frames: string[], delay: number, autoPlay: boolean): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="margin:0;background:#fff;font:12px sans-serif">`
    + `<div>${frames.map((f, i) => `<img class="f" alt="frame ${i + 1}" src="${f}" style="display:${i ? 'none' : 'block'}">`).join('')}</div>`
    + `<div><button id="prev">&lt;</button><button id="play"></button><button id="next">&gt;</button> <span id="n"></span></div>`
    + `<script>var f=document.querySelectorAll('.f'),i=0,t=null,d=${Math.max(1, delay | 0)};`
    + `function show(k){if(!f.length)return;f[i].style.display='none';i=(k+f.length)%f.length;f[i].style.display='block';document.getElementById('n').textContent=(i+1)+' / '+f.length;}`
    + `function play(on){if(t){clearInterval(t);t=null;}if(on)t=setInterval(function(){show(i+1);},d);document.getElementById('play').textContent=on?'Pause':'Play';}`
    + `document.getElementById('prev').onclick=function(){play(false);show(i-1);};document.getElementById('next').onclick=function(){play(false);show(i+1);};`
    + `document.getElementById('play').onclick=function(){play(!t);};show(0);play(${autoPlay ? 'true' : 'false'});</script></body></html>`;
}
