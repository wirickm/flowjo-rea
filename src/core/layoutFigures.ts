// FlowJo 10.6.2 layout figure properties, live text, header / footer and the
// layout list (docs/validation/ui-gaps/layout.md). Rules decoded with javap and
// written here independently; each names the FlowJo class that shows it.
import type { Box, PageSetup } from './layoutArrange';
import { sortNames, uniqueName } from './layoutArrange';
import type { LayoutItem, SavedLayout, Workspace } from './model';

// F1 (LineWeight, StrokeFactory): None 0, Hairline 0.5, Normal 1.5, Heavy 4,
// Very Heavy 8 pt.
export type LineWeight = 'none' | 'hairline' | 'normal' | 'heavy' | 'veryheavy';
export const LINE_WEIGHTS: Record<LineWeight, { pt: number; label: string; fj: string }> = {
  none: { pt: 0, label: 'None', fj: 'NoLine' },
  hairline: { pt: 0.5, label: 'Hairline', fj: 'Hairline' },
  normal: { pt: 1.5, label: 'Normal', fj: 'Normal' },
  heavy: { pt: 4, label: 'Heavy', fj: 'Heavy' },
  veryheavy: { pt: 8, label: 'Very Heavy', fj: 'Thick' },
};
// F2 (StrokeFactory$LineStyle): Solid, Dotted, Dashed (10 on, 10 off),
// Long-dashed (20 on, 20 off), Complex, Dot-dashed. The dotted, complex and
// dot-dashed patterns are this app's own (not read).
export type LineStyle = 'solid' | 'dotted' | 'dashed' | 'longdashed' | 'complex' | 'dotdash';
export const LINE_STYLES: Record<LineStyle, { dash: number[]; label: string; fj: string }> = {
  solid: { dash: [], label: 'Solid', fj: 'Solid' },
  dotted: { dash: [1, 3], label: 'Dotted', fj: 'Dotted' },
  dashed: { dash: [10, 10], label: 'Dashed', fj: 'Dashed' },
  longdashed: { dash: [20, 20], label: 'Long-dashed', fj: 'Long Dashed' },
  complex: { dash: [10, 4, 2, 4, 2, 4], label: 'Complex', fj: 'Complex' },
  dotdash: { dash: [8, 4, 1, 4], label: 'Dot-dashed', fj: 'Dot Dash' },
};
// F3 (GradientStyle): none, horizontal, vertical, diagonal; the fill runs from
// the fill colour to the gradient colour.
export type GradientType = 'none' | 'horizontal' | 'vertical' | 'diagonal';
export const GRADIENTS: GradientType[] = ['none', 'horizontal', 'vertical', 'diagonal'];
export interface FigStyle {
  fill?: string; // fill colour; absent = not filled
  line?: string; // line (stroke) colour
  gradient?: string; // second colour of a gradient fill
  gradientType?: GradientType;
  weight?: LineWeight;
  lineStyle?: LineStyle;
}
// P1-P3 (LEFigTemplateAction; LEditor.doCreateFigPreset / doApplyFigPreset /
// doDeleteFigPreset, Fig.makePreset): Add makes a preset named "New Preset"
// (made unique) from the focused figure, Apply copies it to every selected
// figure, Delete removes the chosen preset. Own scope: the figure properties
// and text font (FlowJo's chart and statistic-table presets also carry their
// chart settings).
export interface FigPreset { name: string; style?: FigStyle; text?: { font?: string; size?: number; bold?: boolean; italic?: boolean; color?: string } }
export function makePreset(it: LayoutItem, taken: string[]): FigPreset {
  const t = it.text !== undefined ? { font: it.font, size: it.size, bold: it.bold, italic: it.italic, color: it.color } : undefined;
  return { name: uniqueName('New Preset', taken), ...(it.style ? { style: { ...it.style } } : {}), ...(t ? { text: JSON.parse(JSON.stringify(t)) } : {}) };
}
export function applyPreset(it: LayoutItem, p: FigPreset): LayoutItem {
  const out = { ...it, style: p.style ? { ...p.style } : undefined } as LayoutItem;
  return out.text !== undefined && p.text ? ({ ...out, ...p.text } as LayoutItem) : out;
}
// Defaults per figure kind: shapes draw a Normal black line, unfilled; charts,
// text and images have no line (NoLine) and no fill.
export function styleOf(it: LayoutItem): Required<Pick<FigStyle, 'weight' | 'lineStyle' | 'gradientType'>> & FigStyle {
  const d = it.shape !== undefined ? { line: '#000000', weight: 'normal' as LineWeight } : { weight: 'none' as LineWeight };
  return { lineStyle: 'solid', gradientType: 'none', ...d, ...(it.style ?? {}) } as Required<Pick<FigStyle, 'weight' | 'lineStyle' | 'gradientType'>> & FigStyle;
}

// Paints a figure's background and outline (Fig.fillRect / paint with
// lineWeightToStroke) on a 2-D context in layout points.
export function paintFigFrame(ctx: CanvasRenderingContext2D, it: LayoutItem, b: Box) {
  const s = styleOf(it);
  const kind = it.shape ?? 'rect';
  const path = () => {
    ctx.beginPath();
    if (kind === 'ellipse') ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(0, b.w / 2), Math.max(0, b.h / 2), 0, 0, Math.PI * 2);
    else if (kind === 'roundrect') roundRect(ctx, b, Math.min(12, b.w / 4, b.h / 4));
    else ctx.rect(b.x, b.y, b.w, b.h);
  };
  if (kind === 'line') return paintLine(ctx, it, b);
  if (s.fill) {
    path();
    if (s.gradientType !== 'none' && s.gradient && ctx.createLinearGradient) {
      const [x2, y2] = s.gradientType === 'horizontal' ? [b.x + b.w, b.y] : s.gradientType === 'vertical' ? [b.x, b.y + b.h] : [b.x + b.w, b.y + b.h];
      const g = ctx.createLinearGradient(b.x, b.y, x2, y2);
      g.addColorStop(0, s.fill); g.addColorStop(1, s.gradient);
      ctx.fillStyle = g as unknown as string;
    } else ctx.fillStyle = s.fill;
    ctx.fill();
  }
  const w = LINE_WEIGHTS[s.weight].pt;
  if (w > 0) {
    path();
    ctx.strokeStyle = s.line ?? '#000000';
    ctx.lineWidth = w;
    ctx.setLineDash(LINE_STYLES[s.lineStyle].dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.moveTo(b.x + r, b.y);
  ctx.lineTo(b.x + b.w - r, b.y); ctx.quadraticCurveTo?.(b.x + b.w, b.y, b.x + b.w, b.y + r);
  ctx.lineTo(b.x + b.w, b.y + b.h - r); ctx.quadraticCurveTo?.(b.x + b.w, b.y + b.h, b.x + b.w - r, b.y + b.h);
  ctx.lineTo(b.x + r, b.y + b.h); ctx.quadraticCurveTo?.(b.x, b.y + b.h, b.x, b.y + b.h - r);
  ctx.lineTo(b.x, b.y + r); ctx.quadraticCurveTo?.(b.x, b.y, b.x + r, b.y);
  ctx.closePath();
}

// A line's end points in layout points.
export function lineEnds(it: LayoutItem, b: Box): [{ x: number; y: number }, { x: number; y: number }] {
  const e = (it.shape !== undefined && it.ends) || [0, 0, 1, 1];
  return [{ x: b.x + e[0] * b.w, y: b.y + e[1] * b.h }, { x: b.x + e[2] * b.w, y: b.y + e[3] * b.h }];
}
// F4 (FigLine.paintArrowhead): an arrowhead is a filled triangle 18 pt long and
// 18 pt wide in the line colour with its tip on the end point; Forward decorates
// the second point, Backward the first, Double both.
export const ARROW_PT = 18;
export function arrowHead(from: { x: number; y: number }, tip: { x: number; y: number }, size = ARROW_PT): { x: number; y: number }[] {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const bx = tip.x - size * Math.cos(a), by = tip.y - size * Math.sin(a);
  const nx = (size / 2) * Math.sin(a), ny = -(size / 2) * Math.cos(a);
  return [tip, { x: bx + nx, y: by + ny }, { x: bx - nx, y: by - ny }];
}
function paintLine(ctx: CanvasRenderingContext2D, it: LayoutItem, b: Box) {
  const s = styleOf(it);
  const [p1, p2] = lineEnds(it, b);
  const w = LINE_WEIGHTS[s.weight].pt;
  const color = s.line ?? '#000000';
  if (w > 0) {
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(LINE_STYLES[s.lineStyle].dash); ctx.stroke(); ctx.setLineDash([]);
  }
  const arrow = it.shape !== undefined ? it.arrow ?? 'none' : 'none';
  const head = (from: typeof p1, tip: typeof p1) => { const t = arrowHead(from, tip); ctx.beginPath(); ctx.moveTo(t[0].x, t[0].y); ctx.lineTo(t[1].x, t[1].y); ctx.lineTo(t[2].x, t[2].y); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); };
  if (arrow === 'forward' || arrow === 'double') head(p1, p2);
  if (arrow === 'backward' || arrow === 'double') head(p2, p1);
}
// Shift while drawing a line snaps its angle to a multiple of 22.5 degrees
// (FigLine.trackDrag, pi / 8).
export function snapLineAngle(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 8)) * (Math.PI / 8);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: Math.round(a.x + len * Math.cos(ang)), y: Math.round(a.y + len * Math.sin(ang)) };
}
// The box and ends of a line from p1 to p2.
export function lineFromPoints(p1: { x: number; y: number }, p2: { x: number; y: number }): { left: number; top: number; width: number; height: number; ends: [number, number, number, number] } {
  const left = Math.min(p1.x, p2.x), top = Math.min(p1.y, p2.y);
  return { left, top, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y), ends: [p1.x <= p2.x ? 0 : 1, p1.y <= p2.y ? 0 : 1, p1.x <= p2.x ? 1 : 0, p1.y <= p2.y ? 1 : 0] };
}

// T1 (SpecialCharacterPopupCallback, charsets CommonGreek / Sign /
// GeometricShape): the special-character map, three groups, as FlowJo's code
// points (the Greek group's code points are FlowJo's, some of which differ from
// the letter names; the button shows and inserts the same character).
export const SPECIAL_CHARS: { group: string; codes: number[] }[] = [
  { group: 'Greek Letters', codes: [945, 946, 947, 916, 923, 922, 956, 929, 930, 931, 939, 940, 937] },
  { group: 'Signs and Symbols', codes: [162, 163, 8364, 165, 8361, 169, 174, 8482, 177, 247] },
  { group: 'Geometric Shapes', codes: [9632, 9633, 9642, 9643, 9646, 9647, 9650, 9651, 9652, 9653, 9654, 9655, 9656, 9657, 9660, 9661, 9662, 9663, 9664, 9665, 9666, 9667, 9670, 9671, 9679, 9675] },
];

// T2-T3 (FigStyledText$AddKeywordActionHandler / AddAnnotationActionHandler,
// fjml Annotation): Insert Keyword puts a live <Key name= dataset=> command at
// the caret, Insert Annotation an <Anno name=> command; both show the current
// value for the figure's sample (the iteration's sample). Stored in the text as
// {{keyword:NAME}} and {{anno:KEY}}.
export const ANNOTATIONS: { key: string; label: string }[] = [
  { key: 'samplename', label: 'Sample Name' }, { key: 'popname', label: 'Subset Name' }, { key: 'fullpath', label: 'Full Gating Path' },
  { key: 'title', label: 'Title' }, { key: 'page', label: 'Page Number' }, { key: 'version', label: 'FlowJo Version' },
  { key: 'time', label: 'Time' }, { key: 'date', label: 'Date' }, { key: 'longdate', label: 'Long Date' },
  { key: 'compmatname', label: 'Compensation Matrix' },
];
export interface LiveContext { keyword: (name: string) => string | undefined; sampleName?: string; title?: string; page?: number; version?: string; compensation?: string; now?: Date }
export const keywordToken = (name: string) => `{{keyword:${name}}}`;
export const annoToken = (key: string) => `{{anno:${key}}}`;
export function liveText(text: string, c: LiveContext): string {
  const now = c.now ?? new Date();
  return text.replace(/\{\{(keyword|anno):([^}]*)\}\}/g, (_m, kind: string, name: string) => {
    if (kind === 'keyword') return c.keyword(name) ?? '';
    switch (name) {
      case 'samplename': return c.sampleName ?? '';
      case 'title': return c.title ?? '';
      case 'page': return String(c.page ?? 1);
      case 'version': return c.version ?? '';
      case 'time': return now.toLocaleTimeString();
      case 'date': return now.toLocaleDateString();
      case 'longdate': return now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      case 'compmatname': return c.compensation ?? '';
      default: return '';
    }
  });
}

// H1-H2 (LEEditHeaderAction, FJHeaderFooterDialog, Layout.createHeaderFooter):
// a header and a footer for every printed page, kept for the whole workspace;
// FlowJo writes them in HTML with the tags <DocumentName/> <Date/> <LongDate/>
// <Time/> <Version/> <PageNumber/>. Own model: a left and a right part each.
export interface HeaderFooter { header?: boolean; footer?: boolean; headerLeft?: string; headerRight?: string; footerLeft?: string; footerRight?: string }
export const DEFAULT_HEADER_FOOTER: Required<HeaderFooter> = { header: false, footer: false, headerLeft: '<DocumentName/>', headerRight: 'Page <PageNumber/>', footerLeft: '<LongDate/>', footerRight: '<Version/>' };
export function headerText(s: string, c: { document: string; page: number; version: string; now?: Date }): string {
  const now = c.now ?? new Date();
  return s.replace(/<DocumentName\/>/gi, c.document).replace(/<PageNumber\/>/gi, String(c.page)).replace(/<Version\/>/gi, c.version)
    .replace(/<LongDate\/>/gi, now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))
    .replace(/<Date\/>/gi, now.toLocaleDateString()).replace(/<Time\/>/gi, now.toLocaleTimeString());
}

// The layout list (LEListAction; SExplorer.doNewTemplate / doDuplicateTemplate /
// deleteSelectedTemplates). The current layout lives in the workspace's
// top-level layout fields; the others in otherLayouts.
export const DEFAULT_LAYOUT_NAME = 'Layout';
const KEYS = ['layout', 'layoutPage', 'layoutIteration', 'layoutGuides', 'layoutGrids', 'layoutGroup'] as const;
type LayoutPatch = Partial<Pick<Workspace, 'layout' | 'layoutPage' | 'layoutIteration' | 'layoutGuides' | 'layoutGrids' | 'layoutGroup' | 'layoutName' | 'otherLayouts'>>;
export const currentLayout = (ws: Workspace): SavedLayout => ({ name: ws.layoutName ?? DEFAULT_LAYOUT_NAME, layout: ws.layout, layoutPage: ws.layoutPage, layoutIteration: ws.layoutIteration, layoutGuides: ws.layoutGuides, layoutGrids: ws.layoutGrids, layoutGroup: ws.layoutGroup });
// Names in list order (by name, ignoring case).
export const layoutNames = (ws: Workspace) => sortNames([ws.layoutName ?? DEFAULT_LAYOUT_NAME, ...(ws.otherLayouts ?? []).map((l) => l.name)]);
const asCurrent = (l: SavedLayout, others: SavedLayout[]): LayoutPatch => ({ layoutName: l.name, layout: l.layout, layoutPage: l.layoutPage, layoutIteration: l.layoutIteration, layoutGuides: l.layoutGuides, layoutGrids: l.layoutGrids, layoutGroup: l.layoutGroup, otherLayouts: others.length ? others : undefined });
export function selectLayout(ws: Workspace, name: string): LayoutPatch {
  const others = ws.otherLayouts ?? [];
  const next = others.find((l) => l.name === name);
  if (!next) return {};
  return asCurrent(next, [...others.filter((l) => l !== next), currentLayout(ws)]);
}
// Add: a new empty layout named "Layout" made unique becomes current.
export function addLayout(ws: Workspace): LayoutPatch {
  const name = uniqueName(DEFAULT_LAYOUT_NAME, layoutNames(ws));
  return asCurrent({ name, layoutPage: ws.layoutPage ? { ...ws.layoutPage, scale: undefined } as PageSetup : undefined }, [...(ws.otherLayouts ?? []), currentLayout(ws)]);
}
// Duplicate: a copy of the current layout with a unique name becomes current.
export function duplicateLayout(ws: Workspace): LayoutPatch {
  const cur = currentLayout(ws);
  const copy = JSON.parse(JSON.stringify(cur)) as SavedLayout;
  copy.name = uniqueName(cur.name, layoutNames(ws));
  return asCurrent(copy, [...(ws.otherLayouts ?? []), cur]);
}
// Delete: the current layout goes; the layout now at its list position (else
// the last) becomes current; deleting the only layout leaves a new empty one.
export function deleteLayout(ws: Workspace): LayoutPatch {
  const names = layoutNames(ws);
  const at = names.indexOf(ws.layoutName ?? DEFAULT_LAYOUT_NAME);
  const others = ws.otherLayouts ?? [];
  if (!others.length) return { layoutName: undefined, layout: undefined, layoutGrids: undefined, layoutGuides: undefined, layoutIteration: undefined, layoutGroup: undefined, layoutPage: ws.layoutPage, otherLayouts: undefined };
  const rest = sortNames(others.map((l) => l.name));
  const pick = rest[Math.min(at, rest.length - 1)];
  const next = others.find((l) => l.name === pick)!;
  return asCurrent(next, others.filter((l) => l !== next));
}
// Rename: names stay unique (uniqueName against the other layouts).
export function renameLayout(ws: Workspace, name: string): LayoutPatch {
  const n = name.trim();
  if (!n) return {};
  return { layoutName: uniqueName(n, (ws.otherLayouts ?? []).map((l) => l.name)) };
}
export const LAYOUT_KEYS = KEYS;
