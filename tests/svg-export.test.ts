// Vector SVG output of the shared plot renderer (histogram, contour, gates).
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import type { Population } from '../src/core/model';
import type { PlotResult } from '../src/core/service';
import { makeTransform } from '../src/core/transforms';
import { drawableGates, type Axis } from '../src/ui/gateGeometry';
import { PLOT, renderPlot } from '../src/ui/renderPlot';
import { asCanvas, SvgContext } from '../src/ui/svgContext';

const axis = (channel: string): Axis => {
  const spec = { kind: 'logicle' as const, T: 262144, W: 0.5, M: 4.5, A: 0 };
  return { channel, spec, t: makeTransform(spec), range: [0, 1] };
};
const parse = (svg: string) => {
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: { error: (m) => errors.push(m), fatalError: (m) => errors.push(m) } }).parseFromString(svg, 'image/svg+xml');
  expect(errors).toEqual([]);
  return doc;
};

describe('SVG plot export', () => {
  const B = 64;
  const density = new Float32Array(B * B);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) density[y * B + x] = 100 * Math.exp(-((x - 32) ** 2 + (y - 30) ** 2) / 50);
  const data: PlotResult = { count: 1000, bins: B, density, points: new Float32Array([0.5, 0.5, 0.4, 0.45]), xExtent: [0, 1], yExtent: [0, 1] };
  const x = axis('CD3');
  const y = axis('CD4');
  const pops: Population[] = [{ id: 'g', name: 'Gate A', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'CD3', transform: x.spec }, { kind: 'channel', channel: 'CD4', transform: y.spec }], min: [0.3, 0.3], max: [0.7, 0.7] } }];

  it('contour plot is fully vector: contour paths, axes, labels, gate and percentage', () => {
    const svg = new SvgContext(PLOT.w, PLOT.h);
    const segs = renderPlot(asCanvas(svg), { kind: 'contour', x, y, data, gates: drawableGates(pops, null, x, y), counts: { g: { count: 250, parentCount: 1000 } }, contourLevel: 10 });
    const doc = parse(svg.toString());
    expect(segs).toBeGreaterThan(0);
    expect(doc.getElementsByTagName('image').length).toBe(0);
    const texts = Array.from(doc.getElementsByTagName('text')).map((t) => t.textContent);
    expect(texts).toContain('CD3');
    expect(texts).toContain('CD4');
    expect(texts).toContain('Gate A 25.00%');
    expect(doc.getElementsByTagName('path').length).toBeGreaterThan(3);
    expect(doc.getElementsByTagName('clipPath').length).toBeGreaterThan(0);
  });

  it('histogram renders as a vector path with count axis', () => {
    const svg = new SvgContext(PLOT.w, PLOT.h);
    const hist: PlotResult = { ...data, density: Float32Array.from({ length: 256 }, (_, i) => Math.exp(-((i - 128) ** 2) / 400) * 50), bins: 256, yExtent: null };
    renderPlot(asCanvas(svg), { kind: 'histogram', x, y: null, data: hist, gates: [], counts: {} });
    const doc = parse(svg.toString());
    const texts = Array.from(doc.getElementsByTagName('text')).map((t) => t.textContent);
    expect(texts).toContain('Count');
    expect(doc.getElementsByTagName('path').length).toBeGreaterThan(2);
  });

  it('escapes special characters in labels', () => {
    const svg = new SvgContext(10, 10);
    svg.fillText('a<b & "c"', 0, 0);
    expect(svg.toString()).toContain('a&lt;b &amp; &quot;c&quot;');
    parse(svg.toString());
  });
});
