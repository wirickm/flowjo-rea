// Layout editor object figures (docs/validation/ui-gaps/layout.md section 7):
// statistic and difference tables, table-editor tables, plate displays and
// web pages: their evaluation for an iteration sample, their drawing on a 2-D
// context (screen, PNG, PDF and SVG) and their property panels. The rules are
// in src/core/layoutTables.ts, layoutPlate.ts and layoutPrefs.ts.
import { useState } from 'react';
import { populationPath, type LayoutObject, type SampleState, type StatColumn, type StatKind, type Workspace } from '../core/model';
import type { SampleMeta } from '../core/service';
import { statScales } from '../core/flowjoStats';
import { STAT_LABELS, STAT_NEEDS_CHANNEL } from '../core/stats';
import type { CellStyle } from '../core/tableEditor';
import {
  annoText, boundRows, columnLabel, diffColor, diffColumnLabel, diffText, EMPTY_CELL, formatValue, HEADER_FILL, HEADER_GRADIENT, INSERT_ITEMS, rangeStyle, statColumnFor, tableGeometry,
  type LayoutObjectSpec, type StatTableColumn, type TableRowRef,
} from '../core/layoutTables';
import {
  annotationLines, applyStatistics, cellKey, contrastColor, drawFace, faceOf, isVisible, MODE_LABELS, modeOf, removeStat, removeUnused, rowLabel, setTarget, statRange, TARGETS, targetsOf, wellColor, wellMap,
  type DisplayTarget, type PlateDisplayModel, type PlateMode,
} from '../core/layoutPlate';
import { HELP_URLS, WEB_PROMPT } from '../core/layoutPrefs';
import { makeAxis, sampleChannels, withStains } from './axes';
import type { createAnalysisClient } from './workerClient';

type Client = ReturnType<typeof createAnalysisClient>;
type Box = { x: number; y: number; w: number; h: number };

export interface TableRender { kind: 'table'; cells: string[][]; styles: (CellStyle | null)[][]; header: boolean; italic: boolean[]; diag?: string[]; caption?: string }
export interface PlateRender {
  kind: 'plate'; rows: number; cols: number; mode: PlateMode; showName: boolean; hasData: boolean;
  wells: { r: number; c: number; name: string; c1: string | null; c2: string | null; face?: number[] }[];
  lines: string[]; legend: { min: number; max: number; min2?: number; max2?: number } | null;
}
export interface WebRender { kind: 'web'; url: string }
export type ObjRender = TableRender | PlateRender | WebRender;

const statsFor = async (client: Client, ws: Workspace, s: SampleState, cols: StatColumn[]) =>
  cols.length ? client.stats({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters, columns: cols, kinetics: ws.kinetics, scales: statScales(ws.channelTransforms, s.flowjoLinearRanges, cols.map((c) => c.channel)) }) : [];
const compName = (ws: Workspace, s: SampleState) => (s.compensation === 'none' ? 'None' : s.compensation === 'file' ? 'Acquisition-defined' : ws.matrices.find((m) => m.id === s.compensation)?.name ?? '');
const kwOf = (s: SampleState, k: string) => s.keywordsSnapshot[k.toUpperCase()] ?? s.keywordsSnapshot[k] ?? s.annotations?.[k];
const hasPath = (s: SampleState, path: string) => !path || s.populations.some((q) => populationPath(s.populations, q.id) === path);

// Cell texts of one row for the given columns (statistics evaluated by the worker).
async function rowCells(client: Client, ws: Workspace, meta: Record<string, SampleMeta>, s: SampleState | undefined, path: string, columns: StatTableColumn[]): Promise<{ text: string[]; values: (number | string | undefined)[] }> {
  if (!s) return { text: columns.map(() => EMPTY_CELL), values: columns.map(() => undefined) };
  const ctx = { sampleName: s.fileName, path, keyword: (k: string) => kwOf(s, k), compensation: compName(ws, s), wsAnnotation: ws.notes.split('\n')[0] ?? '' };
  const statCols = columns.map((c, k) => (c.type === 'stat' ? statColumnFor(c.stat, path, `#${k}`) : null));
  const want = statCols.filter((c): c is StatColumn => !!c);
  const vals = meta[s.id] && hasPath(s, path) ? await statsFor(client, ws, s, want) : [];
  const values = columns.map((c, k) => { const i = want.findIndex((x) => x.id === `#${k}`); return c.type === 'stat' && i >= 0 ? vals[i] : undefined; });
  const text = columns.map((c, k) => (c.type === 'anno' ? annoText(c.anno, ctx) : c.type === 'keyword' ? kwOf(s, c.name) ?? EMPTY_CELL : !meta[s.id] || !hasPath(s, path) ? EMPTY_CELL : formatValue(values[k])));
  return { text, values };
}

// Display position (0..1) of a value on a channel's scale, for difference colours.
function positionOf(ws: Workspace, meta: Record<string, SampleMeta>, s: SampleState, ch: string) {
  const m = meta[s.id];
  if (!m) return null;
  const a = makeAxis(sampleChannels(withStains(m, s.stains), s.compensation, ws.matrices, ws.derivedParameters), m.keywords, ws.channelTransforms, ch);
  return a ? (v: number) => (a.t.apply(v) - a.range[0]) / (a.range[1] - a.range[0]) : null;
}

// Evaluate an object figure for the iteration's sample.
export async function evaluateObject(client: Client, ws: Workspace, meta: Record<string, SampleMeta>, it: LayoutObject, iterSample: SampleState | undefined): Promise<ObjRender> {
  const o = it.object;
  const sampleOf = (id?: string) => ws.samples.find((s) => s.id === id);
  if (o.kind === 'web') return { kind: 'web', url: o.url };
  if (o.kind === 'tetable') return { kind: 'table', header: true, cells: [o.header, ...o.rows.map((r) => r.cells)], styles: [o.header.map(() => null), ...o.rows.map((r) => r.styles ?? r.cells.map(() => null))], italic: [] };
  if (o.kind === 'stattable') {
    const rows = boundRows(o.rows, o.iterate, iterSample?.id);
    const cells: string[][] = [], styles: (CellStyle | null)[][] = [];
    for (const r of rows) {
      const rc = await rowCells(client, ws, meta, sampleOf(r.sampleId), r.path, o.columns);
      cells.push(rc.text);
      styles.push(o.columns.map((c, k) => { const st = rangeStyle(c, rc.values[k]); return st.background ? st : null; }));
    }
    const head = o.showHeader ? [o.columns.map(columnLabel)] : [];
    return { kind: 'table', header: o.showHeader, cells: [...head, ...cells], styles: [...head.map((h) => h.map(() => null)), ...styles], italic: [...head.map(() => false), ...rows.map((r) => !!r.control)] };
  }
  if (o.kind === 'difftable') {
    const rows = boundRows(o.rows, o.iterate, iterSample?.id);
    const ctl = sampleOf(o.controlSampleId);
    const cells: string[][] = [], styles: (CellStyle | null)[][] = [];
    for (const r of rows) {
      const s = sampleOf(r.sampleId);
      const rc = await rowCells(client, ws, meta, s, r.path, o.columns);
      const cc = ctl ? await rowCells(client, ws, meta, ctl, r.path, o.columns) : null;
      cells.push(o.columns.map((c, k) => (c.type !== 'stat' ? rc.text[k] : diffText(rc.values[k], cc?.values[k], { controlSample: !!ctl, population: !!s && hasPath(s, r.path), control: !!ctl && hasPath(ctl, r.path) }))));
      styles.push(o.columns.map((c, k) => {
        if (c.type !== 'stat' || !c.stat.channel || !s || !ctl) return null;
        const a = rc.values[k], b = cc?.values[k];
        const pos = positionOf(ws, meta, s, c.stat.channel);
        if (typeof a !== 'number' || typeof b !== 'number' || !pos) return null;
        const col = diffColor(pos(a) - pos(b));
        return col ? { background: col } : null;
      }));
    }
    return { kind: 'table', header: false, cells, styles, italic: [], diag: o.columns.map(diffColumnLabel), caption: `Control Sample: ${ctl ? ctl.fileName : '<None Set>'}` };
  }
  // plate
  const m = o.model;
  const g = m.groupName ? ws.groups.find((x) => x.name === m.groupName) : undefined;
  const samples = g ? ws.samples.filter((s) => g.sampleIds.includes(s.id)) : [];
  const wm = wellMap(samples);
  const shown = m.stats.filter((s) => isVisible(m, s.target));
  const cols = shown.map((s) => ws.statColumns.find((c) => c.id === s.statId)).filter((c): c is StatColumn => !!c);
  const values = new Map<string, Record<string, number>>();
  for (const [k, s] of wm.wells) {
    const v = meta[s.id] ? await statsFor(client, ws, s, cols) : [];
    values.set(k, Object.fromEntries(cols.map((c, i) => [c.id, typeof v[i] === 'number' ? (v[i] as number) : NaN])));
  }
  const ranges: Record<string, { min: number; max: number } | null> = {};
  for (const s of shown) ranges[s.statId] = statRange(s, [...values.values()].map((v) => v[s.statId] ?? NaN));
  const by = (t: DisplayTarget) => shown.find((s) => s.target === t);
  const h1 = by('HEATMAP1'), h2 = by('HEATMAP2');
  const wells = [...wm.wells].map(([k, s]) => {
    const [r, c] = k.split(',').map(Number);
    const v = values.get(k) ?? {};
    return {
      r, c, name: s.fileName,
      c1: modeOf(m) === 'HEATMAP' && h1 ? wellColor(v[h1.statId] ?? NaN, ranges[h1.statId]) : null,
      c2: modeOf(m) === 'HEATMAP' && h2 ? wellColor(v[h2.statId] ?? NaN, ranges[h2.statId]) : null,
      face: modeOf(m) === 'CHERNOFF_FACE' ? faceOf(m, v, ranges) : undefined,
    };
  });
  const statName = (id: string) => { const c = ws.statColumns.find((x) => x.id === id); return c ? `${c.populationPath || 'All events'}: ${STAT_LABELS[c.stat]}${c.channel ? ` (${c.channel})` : ''}` : id; };
  const r1 = h1 ? ranges[h1.statId] : null, r2 = h2 ? ranges[h2.statId] : null;
  return {
    kind: 'plate', rows: wm.rows, cols: wm.cols, mode: modeOf(m), showName: !!m.showSampleName, hasData: wm.wells.size > 0, wells,
    lines: annotationLines(m, statName, ranges, samples.length || m.groupName ? wm.errors : []),
    legend: modeOf(m) === 'HEATMAP' && r1 ? { ...r1, ...(r2 ? { min2: r2.min, max2: r2.max } : {}) } : null,
  };
}

// Natural size of an evaluated object, in points (tables: their grid; plates
// 20 pt wells plus indices, legend and annotation; web pages 400 x 300).
export function objectSize(r: ObjRender | undefined, spec: LayoutObjectSpec): { w: number; h: number } {
  if (spec.kind === 'web') return { w: 400, h: 300 };
  if (r?.kind === 'table') { const g = tableGeometry(r.cells); return { w: Math.max(80, g.w), h: Math.max(20, g.h + (r.diag ? 60 : 0) + (r.caption ? 16 : 0)) }; }
  if (r?.kind === 'plate') return { w: Math.max(160, 16 + 20 * Math.max(r.cols, 4) + 50), h: Math.max(120, 14 + 20 * Math.max(r.rows, 3) + 14 * r.lines.length + 8) };
  return { w: 200, h: 120 };
}

const PLATE_EMPTY = '(Drag Plate Statistics Here)';
// Draws an object figure in layout points.
export function drawObject(ctx: CanvasRenderingContext2D, it: LayoutObject, b: Box, r: ObjRender | undefined) {
  ctx.save();
  if (!r) { ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.fillText('calculating...', b.x + 4, b.y + 14); ctx.restore(); return; }
  if (r.kind === 'web') {
    // Exports: a framed placeholder with the address (own rule: a cross-origin page cannot be drawn).
    ctx.fillStyle = '#f4f6fa'; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#7a8599'; ctx.lineWidth = 1; ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#334'; ctx.font = '10px sans-serif';
    ctx.fillText('Web page:', b.x + 6, b.y + 16); ctx.fillText(r.url, b.x + 6, b.y + 30);
  } else if (r.kind === 'table') {
    const g = tableGeometry(r.cells);
    let y0 = b.y;
    if (r.diag) {
      // FigDifferenceTable: no header row; column labels drawn diagonally above the columns.
      ctx.fillStyle = '#111'; ctx.font = '9px sans-serif';
      let x = b.x;
      r.diag.forEach((t, k) => { ctx.save(); ctx.translate(x + g.colW[k] / 2, b.y + 56); ctx.rotate(-Math.PI / 4); ctx.fillText(t, 0, 0); ctx.restore(); x += g.colW[k]; });
      y0 += 60;
    }
    r.cells.forEach((row, i) => {
      const y = y0 + i * g.rowH;
      let x = b.x;
      const head = r.header && i === 0;
      row.forEach((t, k) => {
        const w = g.colW[k], st = r.styles[i]?.[k];
        if (head) {
          if (ctx.createLinearGradient) { const gr = ctx.createLinearGradient(0, y, 0, y + g.rowH); gr.addColorStop(0, HEADER_FILL); gr.addColorStop(1, HEADER_GRADIENT); ctx.fillStyle = gr as unknown as string; } else ctx.fillStyle = HEADER_FILL;
          ctx.fillRect(x, y, w, g.rowH);
        } else if (st?.background) { ctx.fillStyle = st.background; ctx.fillRect(x, y, w, g.rowH); }
        ctx.strokeStyle = '#c8ccd4'; ctx.lineWidth = 0.5; ctx.strokeRect(x, y, w, g.rowH);
        ctx.fillStyle = st?.color ?? '#111';
        ctx.font = `${r.italic[i] ? 'italic ' : ''}${head || st?.bold ? 'bold ' : ''}${head ? 10 : 9}px sans-serif`;
        const num = !head && /^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(t);
        const txt = `${st?.arrow === 'up' ? '▲ ' : st?.arrow === 'down' ? '▼ ' : ''}${t}`;
        // Statistics right-justified, text left, headers centred (StatTableModel.getCellFig / getHeaderCellFig).
        ctx.textAlign = head ? 'center' : num ? 'right' : 'left';
        ctx.fillText(txt, head ? x + w / 2 : num ? x + w - 4 : x + 4, y + g.rowH - 4);
        ctx.textAlign = 'left';
        x += w;
      });
    });
    if (r.caption) { ctx.fillStyle = '#111'; ctx.font = '9px sans-serif'; ctx.fillText(r.caption, b.x + 5, y0 + r.cells.length * g.rowH + 12); }
  } else {
    drawPlate(ctx, b, r);
  }
  ctx.restore();
}

function drawPlate(ctx: CanvasRenderingContext2D, b: Box, r: PlateRender) {
  const legendW = r.legend ? 50 : 0, annH = 14 * r.lines.length + 4;
  if (!r.hasData) {
    // doPaint without data: a grey frame and the drop prompt in the middle.
    ctx.strokeStyle = '#808080'; ctx.lineWidth = 1; ctx.strokeRect(b.x, b.y, b.w, b.h - annH);
    ctx.fillStyle = '#808080'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(PLATE_EMPTY, b.x + b.w / 2, b.y + (b.h - annH) / 2); ctx.textAlign = 'left';
  } else {
    const cs = Math.max(4, Math.min((b.w - 16 - legendW) / r.cols, (b.h - 14 - annH) / r.rows));
    const x0 = b.x + 16, y0 = b.y + 14;
    ctx.fillStyle = '#333'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    for (let c = 0; c < r.cols; c++) ctx.fillText(String(c + 1), x0 + c * cs + cs / 2, b.y + 10);
    for (let q = 0; q < r.rows; q++) ctx.fillText(rowLabel(q), b.x + 8, y0 + q * cs + cs / 2 + 3);
    ctx.textAlign = 'left';
    for (const w of r.wells) {
      const x = x0 + w.c * cs, y = y0 + w.r * cs;
      if (w.c1) { ctx.fillStyle = w.c1; ctx.fillRect(x, y, cs, cs); }
      if (w.c2) {
        // Heatmap Upper Half: the triangle (x, y + h), (x, y), (x + w, y) (getSplitPoints).
        ctx.fillStyle = w.c2; ctx.beginPath(); ctx.moveTo(x, y + cs); ctx.lineTo(x, y); ctx.lineTo(x + cs, y); ctx.closePath(); ctx.fill();
      }
      if (w.face) {
        ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 0.5;
        drawFace({
          oval: (ox, oy, ow, oh, fill) => { ctx.beginPath(); ctx.ellipse(ox + ow / 2, oy + oh / 2, Math.max(0, ow / 2), Math.max(0, oh / 2), 0, 0, Math.PI * 2); if (fill) ctx.fill(); else ctx.stroke(); },
          line: (a, bb, c2, d) => { ctx.beginPath(); ctx.moveTo(a, bb); ctx.lineTo(c2, d); ctx.stroke(); },
        }, w.face, x, y, cs, cs);
      }
      if (r.showName) {
        // drawSampleName: centred (at least 5 from the left), mid-height for heat maps, else the bottom.
        ctx.font = `${Math.min(12, Math.max(5, cs / 4))}px sans-serif`;
        ctx.fillStyle = contrastColor(w.c2 ?? w.c1);
        const tw = ctx.measureText(w.name).width;
        ctx.fillText(w.name, x + Math.max(5, cs / 2 - tw / 2), r.mode === 'HEATMAP' ? y + cs / 2 + 3 : y + cs - 2);
      }
      ctx.strokeStyle = '#999'; ctx.lineWidth = 0.5; ctx.strokeRect(x, y, cs, cs);
    }
    if (r.legend) {
      // FigPlateLegend: a 20 pt bar right of the plate, heat colours from min (bottom) to max (top).
      const lx = x0 + r.cols * cs + 15, ly = y0, lh = r.rows * cs;
      for (let i = 0; i < lh; i++) { const u = 1 - i / lh; const bl = Math.trunc((1 - u) * 255); ctx.fillStyle = `rgb(${255 - bl},${255 - bl},${bl})`; ctx.fillRect(lx, ly + i, 20, 1.2); }
      ctx.fillStyle = '#111'; ctx.font = '8px sans-serif';
      ctx.fillText(formatValue(r.legend.max), lx + 22, ly + 8); ctx.fillText(formatValue(r.legend.min), lx + 22, ly + lh);
    }
  }
  ctx.fillStyle = '#111'; ctx.font = '9px sans-serif';
  r.lines.forEach((t, k) => ctx.fillText(t, b.x + 4, b.y + b.h - annH + 12 + k * 14));
}

// --- property panels ---------------------------------------------------------
const STAT_KINDS: StatKind[] = ['count', 'freqParent', 'freqGrandparent', 'freqTotal', 'mean', 'median', 'geomean', 'sd', 'cv', 'robustSd', 'robustCv', 'mad', 'min', 'max', 'mode'];
const openHelp = (url: string) => { window.open(url, '_blank', 'noopener'); };

export function ColumnEditor({ columns, onChange, keywords, channels, testid }: { columns: StatTableColumn[]; onChange: (c: StatTableColumn[]) => void; keywords: string[]; channels: string[]; testid: string }) {
  const [sel, setSel] = useState(-1);
  const [statKind, setStatKind] = useState<StatKind>('median');
  const [ch, setCh] = useState('');
  const c = columns[sel];
  return (
    <span className="layout-band" data-testid={`${testid}-columns`}>
      Columns <select size={1} value={sel} onChange={(e) => setSel(Number(e.target.value))} data-testid={`${testid}-col-list`}><option value={-1}>({columns.length})</option>{columns.map((x, k) => <option key={k} value={k}>{columnLabel(x)}{x.type === 'stat' && x.range ? ` [${x.range.min}..${x.range.max}]` : ''}</option>)}</select>
      <button disabled={sel < 0} onClick={() => { onChange(columns.filter((_, k) => k !== sel)); setSel(-1); }} data-testid={`${testid}-col-remove`}>Remove</button>
      <select value="" onChange={(e) => e.target.value && onChange([...columns, INSERT_ITEMS[Number(e.target.value)]])} data-testid={`${testid}-add-column`} title="Add Column: add a pre-defined column"><option value="">Add Column...</option>{INSERT_ITEMS.map((x, k) => <option key={k} value={k}>{columnLabel(x)}</option>)}</select>
      <select value={statKind} onChange={(e) => setStatKind(e.target.value as StatKind)} data-testid={`${testid}-stat-kind`}>{STAT_KINDS.map((k) => <option key={k} value={k}>{STAT_LABELS[k]}</option>)}</select>
      {STAT_NEEDS_CHANNEL(statKind) && <select value={ch} onChange={(e) => setCh(e.target.value)} data-testid={`${testid}-stat-channel`}><option value="">parameter...</option>{channels.map((x) => <option key={x} value={x}>{x}</option>)}</select>}
      <button disabled={STAT_NEEDS_CHANNEL(statKind) && !ch} onClick={() => onChange([...columns, { type: 'stat', stat: { stat: statKind, ...(STAT_NEEDS_CHANNEL(statKind) ? { channel: ch } : {}) } }])} data-testid={`${testid}-add-stat`} title="Add Statistic: statistics as additional columns">Add Statistic</button>
      <select value="" onChange={(e) => e.target.value && onChange([...columns, { type: 'keyword', name: e.target.value }])} data-testid={`${testid}-add-keyword`} title="Add Keyword: include keywords from the FCS file"><option value="">Add Keyword...</option>{keywords.map((k) => <option key={k} value={k}>{k}</option>)}</select>
      {c?.type === 'stat' && <>
        Range <input type="number" style={{ width: 60 }} placeholder="min" value={c.range?.min ?? ''} onChange={(e) => onChange(columns.map((x, k) => (k === sel && x.type === 'stat' ? { ...x, range: { min: Number(e.target.value), max: x.range?.max ?? 100 } } : x)))} data-testid={`${testid}-range-min`} title="Expected Range: heat-map statistic values outside it" />
        <input type="number" style={{ width: 60 }} placeholder="max" value={c.range?.max ?? ''} onChange={(e) => onChange(columns.map((x, k) => (k === sel && x.type === 'stat' ? { ...x, range: { min: x.range?.min ?? 0, max: Number(e.target.value) } } : x)))} data-testid={`${testid}-range-max`} />
        <button onClick={() => onChange(columns.map((x, k) => (k === sel && x.type === 'stat' ? { type: 'stat', stat: x.stat } : x)))} data-testid={`${testid}-range-none`}>-- No Range --</button>
      </>}
    </span>
  );
}

export function RowEditor({ rows, onChange, ws, testid }: { rows: TableRowRef[]; onChange: (r: TableRowRef[]) => void; ws: Workspace; testid: string }) {
  const [sid, setSid] = useState(ws.samples[0]?.id ?? '');
  const [path, setPath] = useState('');
  const s = ws.samples.find((x) => x.id === sid);
  const paths = s ? ['', ...s.populations.map((q) => populationPath(s.populations, q.id))] : [''];
  return (
    <span className="layout-band" data-testid={`${testid}-rows`}>
      Rows <select value={sid} onChange={(e) => setSid(e.target.value)} data-testid={`${testid}-row-sample`}>{ws.samples.map((x) => <option key={x.id} value={x.id}>{x.fileName}</option>)}</select>
      <select value={path} onChange={(e) => setPath(e.target.value)} data-testid={`${testid}-row-pop`}>{paths.map((q) => <option key={q} value={q}>{q || '(sample)'}</option>)}</select>
      <button disabled={!sid} onClick={() => onChange([...rows, { sampleId: sid, path }])} data-testid={`${testid}-add-row`} title="Drag Samples or Populations Here">Add row</button>
      {rows.map((r, k) => (
        <span key={k} className="chip" data-testid={`${testid}-row`}>
          {(ws.samples.find((x) => x.id === r.sampleId)?.fileName ?? '?') + (r.path ? `/${r.path}` : '')}
          <label title="Set item as control (FlowJo: double click): keeps its sample when the table iterates"><input type="checkbox" checked={!!r.control} onChange={(e) => onChange(rows.map((x, i) => (i === k ? { ...x, control: e.target.checked || undefined } : x)))} data-testid={`${testid}-row-control`} /> control</label>
          <button onClick={() => onChange(rows.filter((_, i) => i !== k))} data-testid={`${testid}-row-remove`}>x</button>
        </span>
      ))}
    </span>
  );
}

export function ObjectPanel({ it, ws, keywords, channels, locked, onChange, onRefresh, editing, setEditing }: {
  it: LayoutObject; ws: Workspace; keywords: string[]; channels: string[]; locked: boolean;
  onChange: (o: LayoutObjectSpec) => void; onRefresh: () => void; editing: boolean; setEditing: (on: boolean) => void;
}) {
  const o = it.object;
  if (o.kind === 'stattable' || o.kind === 'difftable') {
    const t = o.kind === 'stattable' ? 'stattable' : 'difftable';
    return (
      <fieldset disabled={locked} style={{ display: 'contents' }}>
        <b>{o.kind === 'stattable' ? 'Statistic Table' : 'Difference Table'}</b>
        {o.kind === 'difftable' && <>Control Sample: <select value={o.controlSampleId ?? ''} onChange={(e) => onChange({ ...o, controlSampleId: e.target.value || undefined })} data-testid="difftable-control" title="Select a control sample"><option value="">&lt;Drag Sample Here&gt;</option>{ws.samples.map((s) => <option key={s.id} value={s.id}>{s.fileName}</option>)}</select></>}
        <RowEditor rows={o.rows} ws={ws} testid={t} onChange={(rows) => onChange({ ...o, rows })} />
        <ColumnEditor columns={o.columns} keywords={keywords} channels={channels} testid={t} onChange={(columns) => onChange({ ...o, columns })} />
        {o.kind === 'stattable' && <label><input type="checkbox" checked={o.showHeader} onChange={(e) => onChange({ ...o, showHeader: e.target.checked })} data-testid="stattable-headers" /> Show Column Headers</label>}
        <label title="Enable or disable iteration for this grid when batching"><input type="checkbox" checked={!!o.iterate} onChange={(e) => onChange({ ...o, iterate: e.target.checked || undefined })} data-testid={`${t}-iterate`} /> Enable Iteration</label>
      </fieldset>
    );
  }
  if (o.kind === 'plate') return <PlatePanel m={o.model} ws={ws} locked={locked} onChange={(model) => onChange({ ...o, model })} onRefresh={onRefresh} />;
  if (o.kind === 'web') {
    return (
      <>
        <b>Web page</b> <span className="muted" data-testid="web-url">{o.url}</span>
        <button disabled={locked} onClick={() => { const u = window.prompt(WEB_PROMPT, o.url); if (u) onChange({ ...o, url: u }); }} data-testid="web-navigate" title="Navigate To...: enter a new navigable resource">Navigate To...</button>
        <button onClick={onRefresh} data-testid="web-refresh-image" title="Refresh Image: update the cached render of this resource">Refresh Image</button>
        <button onClick={onRefresh} data-testid="web-reload" title="Reload Page: reload the current resource">Reload Page</button>
        <button disabled={locked} onClick={() => onChange({ ...o, zoom: 1 })} data-testid="web-reset-zoom" title="Reset Zoom: the internal image back to 100%">Reset Zoom</button>
        <button disabled={locked} onClick={() => onChange({ ...o, offsetX: 0, offsetY: 0 })} data-testid="web-reset-position" title="Reset Position: the internal image back to the figure's origin">Reset Position</button>
        <span className="muted" data-testid="web-zoom">{Math.round(o.zoom * 100)}%</span>
        <label title="Edit the page inside the figure: the mouse wheel zooms, dragging pans (FlowJo: double click)"><input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} data-testid="web-editing" /> Edit inside</label>
      </>
    );
  }
  return <><b>Table</b> <span className="muted">{o.name}: not live (from the table editor)</span></>;
}

function PlatePanel({ m, ws, locked, onChange, onRefresh }: { m: PlateDisplayModel; ws: Workspace; locked: boolean; onChange: (m: PlateDisplayModel) => void; onRefresh: () => void }) {
  const statLabel = (id: string) => { const c = ws.statColumns.find((x) => x.id === id); return c ? `${c.populationPath || 'All events'}: ${STAT_LABELS[c.stat]}${c.channel ? ` (${c.channel})` : ''}` : id; };
  return (
    <fieldset disabled={locked} style={{ display: 'contents' }}>
      <b>Plate</b>
      <select value={m.groupName ?? ''} onChange={(e) => onChange({ ...m, groupName: e.target.value || undefined })} data-testid="plate-group" title="Choose Group: a sample group to display in this plate"><option value="">&lt;No Group Selected&gt;</option>{ws.groups.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}</select>
      <select value={modeOf(m)} onChange={(e) => onChange({ ...m, mode: e.target.value as PlateMode })} data-testid="plate-mode" title="Display Type: how statistics are shown in the wells">{(Object.keys(MODE_LABELS) as PlateMode[]).map((k) => <option key={k} value={k}>{MODE_LABELS[k]}</option>)}</select>
      <label title="Show the sample name in each well"><input type="checkbox" checked={!!m.showSampleName} onChange={(e) => onChange({ ...m, showSampleName: e.target.checked || undefined })} data-testid="plate-show-sample" /> Show Sample Name</label>
      <select value="" onChange={(e) => e.target.value && onChange(applyStatistics(m, [e.target.value], ws.groups[0]?.name))} data-testid="plate-add-stat" title="Drag statistic nodes onto this plate to add statistics"><option value="">{m.stats.length ? 'Add statistic...' : 'No Statistics'}</option>{ws.statColumns.map((c) => <option key={c.id} value={c.id}>{statLabel(c.id)}</option>)}</select>
      {m.stats.map((s) => (
        <span key={s.statId} className="chip" data-testid="plate-stat">
          {statLabel(s.statId)}
          <select value={s.target ?? ''} onChange={(e) => onChange(setTarget(m, s.statId, (e.target.value || undefined) as DisplayTarget | undefined))} data-testid="plate-stat-target" title="Display As: the visual component of the well for this statistic"><option value="">(unused)</option>{targetsOf(modeOf(m)).map((t) => <option key={t} value={t}>{TARGETS.find((x) => x.t === t)!.label}</option>)}</select>
          <select value={s.method ?? 'AUTO'} onChange={(e) => onChange({ ...m, stats: m.stats.map((x) => (x.statId === s.statId ? { ...x, method: e.target.value as 'AUTO' | 'EXPECTED_RANGE', range: x.range ?? { min: 0, max: 100 } } : x)) })} data-testid="plate-stat-range" title="Statistic Heatmapping Range"><option value="AUTO">Auto</option><option value="EXPECTED_RANGE">Expected Range</option></select>
          {s.method === 'EXPECTED_RANGE' && <>
            <input type="number" style={{ width: 55 }} value={s.range?.min ?? 0} onChange={(e) => onChange({ ...m, stats: m.stats.map((x) => (x.statId === s.statId ? { ...x, range: { min: Number(e.target.value), max: x.range?.max ?? 100 } } : x)) })} data-testid="plate-stat-min" />
            <input type="number" style={{ width: 55 }} value={s.range?.max ?? 100} onChange={(e) => onChange({ ...m, stats: m.stats.map((x) => (x.statId === s.statId ? { ...x, range: { min: x.range?.min ?? 0, max: Number(e.target.value) } } : x)) })} data-testid="plate-stat-max" />
          </>}
          <button onClick={() => onChange(removeStat(m, s.statId))} data-testid="plate-stat-remove" title="Delete Statistic: delete this statistic from the plate">Delete</button>
        </span>
      ))}
      <button disabled={!m.stats.length} onClick={() => onChange(removeUnused(m))} data-testid="plate-remove-unused" title="Remove Unused: remove all unused statistics">Remove Unused</button>
      <button onClick={onRefresh} data-testid="plate-refresh" title="Refresh the plate's contents">Refresh</button>
    </fieldset>
  );
}

export { openHelp, HELP_URLS, cellKey };
