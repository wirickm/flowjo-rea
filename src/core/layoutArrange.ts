// FlowJo 10.6.2 Layout Editor geometry (specs 21). Behavior decoded with javap
// and written here independently; every rule names the FlowJo function that
// shows it. Units are points (1/72 inch), integers as in FlowJo.

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locked?: boolean;
  groupId?: string;
}

// P2-P4: US Letter (A4 for metric locales), portrait, 1 inch margins
// (CustomPaper.<clinit>, CustomPaper.DEFAULT_INSETS, PrintLayout.getDefaultPageFormat).
export type Paper = 'letter' | 'a4';
export type Orientation = 'portrait' | 'landscape';
export const PAPERS: Record<Paper, { w: number; h: number; label: string }> = {
  letter: { w: 612, h: 792, label: 'US Letter' },
  a4: { w: 8.2677 * 72, h: 11.6929 * 72, label: 'A4' },
};
export const MARGIN = 72;
// scale: print content scaling (Scale To Page / Width / Height, P14); default 1.
export interface PageSetup { paper: Paper; orientation: Orientation; scale?: number }
export const DEFAULT_PAGE: PageSetup = { paper: 'letter', orientation: 'portrait' };
// P6: the editor's page is the imageable area (paper minus margins), scale 1.
export function usablePage(p: PageSetup = DEFAULT_PAGE): { w: number; h: number } {
  const paper = PAPERS[p.paper];
  const w = Math.round(paper.w - 2 * MARGIN), h = Math.round(paper.h - 2 * MARGIN);
  return p.orientation === 'landscape' ? { w: h, h: w } : { w, h };
}
// The page in layout points: the imageable area times the content scaling.
export function scaledPage(p: PageSetup = DEFAULT_PAGE): { w: number; h: number } {
  const u = usablePage(p), k = p.scale && p.scale > 0 ? p.scale : 1;
  return { w: Math.round(u.w * k), h: Math.round(u.h * k) };
}
// P6: a point lies on page floor(coord / page) + 1 (LayoutEditorController.pointToPage).
export const pageOf = (coord: number, size: number) => Math.floor(coord / size) + 1;
// Pages needed to hold every box (at least one each way).
export function pageGrid(boxes: Box[], page: { w: number; h: number }): { cols: number; rows: number } {
  const right = Math.max(0, ...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(0, ...boxes.map((b) => b.y + b.h));
  return { cols: Math.max(1, Math.ceil(right / page.w)), rows: Math.max(1, Math.ceil(bottom / page.h)) };
}

// P13: a graph's plot frame is 256 x 256 pt (FigLightweightChartBox.getFrameWidth).
export const FRAME_PT = 256;
// P10: "Copy to Layout Editor" centres the graph on (200, 200), no cascade (GWAction.copyToLayout).
export const COPY_TO_LAYOUT_POINT = { x: 200, y: 200 };
// P11: pasted figures move by (+4, +4); Duplicate copies at (+8, +8)
// (LEPasteAction.doAction, AbstractLayerDiagram.duplicateSelection).
export const PASTE_OFFSET = 4;
export const DUPLICATE_OFFSET = 8;
// P8: dropped figures form one row (a column when not "across") with 30 pt
// between them; the first is centred on the drop point, then kept at x, y >= 0
// (LayoutEditor.addFigs, FigList.distribute).
export const DROP_GAP = 30;
export function placeRow(sizes: { w: number; h: number }[], at: { x: number; y: number }, across = true): { x: number; y: number }[] {
  if (!sizes.length) return [];
  let x = Math.max(0, Math.round(at.x - sizes[0].w / 2));
  let y = Math.max(0, Math.round(at.y - sizes[0].h / 2));
  return sizes.map((s) => {
    const p = { x, y };
    if (across) x += s.w + DROP_GAP; else y += s.h + DROP_GAP;
    return p;
  });
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';
// A2-A7 (AlignableLayerDiagram.setX/setY/setRight/setBottom/setHCenter/setVCenter):
// left/top/right/bottom use the selection's extent; centres use the integer mean
// of the figures' centres (x + floor(w / 2)). Locks are not tested (A24).
export function align(boxes: Box[], mode: AlignMode): Box[] {
  if (boxes.length < 2) return boxes.map((b) => ({ ...b }));
  const n = boxes.length;
  const half = (v: number) => Math.floor(v / 2);
  switch (mode) {
    case 'left': { const v = Math.min(...boxes.map((b) => b.x)); return boxes.map((b) => ({ ...b, x: v })); }
    case 'top': { const v = Math.min(...boxes.map((b) => b.y)); return boxes.map((b) => ({ ...b, y: v })); }
    case 'right': { const v = Math.max(...boxes.map((b) => b.x + b.w)); return boxes.map((b) => ({ ...b, x: v - b.w })); }
    case 'bottom': { const v = Math.max(...boxes.map((b) => b.y + b.h)); return boxes.map((b) => ({ ...b, y: v - b.h })); }
    case 'hcenter': { const c = Math.trunc(boxes.reduce((s, b) => s + b.x + half(b.w), 0) / n); return boxes.map((b) => ({ ...b, x: c - half(b.w) })); }
    case 'vcenter': { const c = Math.trunc(boxes.reduce((s, b) => s + b.y + half(b.h), 0) / n); return boxes.map((b) => ({ ...b, y: c - half(b.h) })); }
  }
}

// A8-A9 (AlignableLayerDiagram.setSpacing): sort by leading edge; step =
// floor((centre of last - centre of first) / (n - 1)), at least 0; the first
// and last stay; each middle figure's leading edge = previous new edge + step.
export function spacing(boxes: Box[], axis: 'h' | 'v'): Box[] {
  const out = boxes.map((b) => ({ ...b }));
  if (out.length < 2) return out;
  const pos = axis === 'h' ? 'x' : 'y';
  const size = axis === 'h' ? 'w' : 'h';
  const sorted = [...out].sort((a, b) => a[pos] - b[pos]);
  const centre = (b: Box) => b[pos] + Math.floor(b[size] / 2);
  const step = Math.max(0, Math.floor((centre(sorted[sorted.length - 1]) - centre(sorted[0])) / (sorted.length - 1)));
  for (let i = 1; i < sorted.length - 1; i++) sorted[i][pos] = sorted[i - 1][pos] + step;
  return out;
}

// A11 (AlignableLayerDiagram.alignToGrid, GuideGrid.snapPt): top-left to
// trunc((v + trunc(g / 2)) / g) * g; grid 36 pt (pref gridSize).
export const GRID_PT = 36;
export const snapToGrid = (v: number, g = GRID_PT) => Math.trunc((v + Math.trunc(g / 2)) / g) * g;
export const alignToGrid = (boxes: Box[], g = GRID_PT): Box[] => boxes.map((b) => ({ ...b, x: snapToGrid(b.x, g), y: snapToGrid(b.y, g) }));

// A15-A17: z-order is the list order (index 0 at the back).
// Bring to Front: each selected id, in selection order, moves to the end.
export function bringToFront(order: string[], selected: string[]): string[] {
  const out = [...order];
  for (const id of selected) { const i = out.indexOf(id); if (i >= 0) { out.splice(i, 1); out.push(id); } }
  return out;
}
// Send to Back: each selected id, in selection order, moves to index 0, so the
// last selected ends at the very back (AbstractLayerDiagram.sendToBack).
export function sendToBack(order: string[], selected: string[]): string[] {
  const out = [...order];
  for (const id of selected) { const i = out.indexOf(id); if (i >= 0) { out.splice(i, 1); out.unshift(id); } }
  return out;
}
// Bring Forward / Send Backward: one position past the next figure up / down
// (AbstractLayerDiagram.bringForward/sendBackward).
export function stepOrder(order: string[], selected: string[], dir: 1 | -1): string[] {
  const out = [...order];
  const ids = dir === 1 ? [...selected].sort((a, b) => out.indexOf(b) - out.indexOf(a)) : [...selected].sort((a, b) => out.indexOf(a) - out.indexOf(b));
  for (const id of ids) {
    const i = out.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= out.length || selected.includes(out[j])) continue;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// S1 (EditorKeys.nudge): arrows move 1 pt; Alt x2, Ctrl/Cmd x2, Shift x3,
// multiplied (1, 2, 3, 4, 6, 12); position-locked figures stay.
export const nudgeStep = (alt: boolean, ctrl: boolean, shift: boolean) => (alt ? 2 : 1) * (ctrl ? 2 : 1) * (shift ? 3 : 1);
export const nudge = (boxes: Box[], dx: number, dy: number): Box[] => boxes.map((b) => (b.locked ? { ...b } : { ...b, x: b.x + dx, y: b.y + dy }));

// A20 / A22 (LEGroupAction.doGroup, FigGroup.ungroup): grouped figures move,
// align and order as one figure whose bounds are the members' union.
export function unionBox(boxes: Box[], id = 'group'): Box {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { id, x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

// A23 (LayerDiagram.avoidPageBreaks): a figure crossing a vertical page break
// moves right to the next page's start, the push accumulating for later figures
// (taken in order of position); then the same down across horizontal breaks,
// allowing 5 pt above the figure. Figures larger than a page are skipped.
// Repeats until nothing moves.
export function avoidPageBreaks(boxes: Box[], page: { w: number; h: number }): Box[] {
  const out = boxes.map((b) => ({ ...b }));
  const pass = (pos: 'x' | 'y', size: 'w' | 'h', pageSize: number, slack: number) => {
    let moved = false;
    let push = 0;
    for (const b of [...out].sort((a, c) => a[pos] - c[pos])) {
      if (b[size] + slack > pageSize) continue;
      b[pos] += push;
      const start = b[pos] - slack;
      const p0 = Math.floor(start / pageSize), p1 = Math.floor((b[pos] + b[size] - 1) / pageSize);
      if (p1 > p0) {
        const d = p1 * pageSize + slack - b[pos];
        b[pos] += d;
        push += d;
        moved = true;
      }
    }
    return moved;
  };
  for (let guard = 0; guard < 20; guard++) {
    const a = pass('x', 'w', page.w, 0);
    const b = pass('y', 'h', page.h, 5);
    if (!a && !b) break;
  }
  return out;
}

// G1-G3 (FigGridLayout, FJLayoutGrid): a grid of 3 rows x 4 columns with 4 pt
// cell padding, filled row by row; items that do not fit are left out. Own
// model: the grid is applied as positions (cells as large as the largest item).
export const GRID_ROWS = 3, GRID_COLS = 4, CELL_PAD = 4;
export function gridPositions(boxes: Box[], origin: { x: number; y: number }, rows = GRID_ROWS, cols = GRID_COLS, pad = CELL_PAD): { placed: Box[]; left: string[] } {
  const cw = Math.max(...boxes.map((b) => b.w)) + 2 * pad, ch = Math.max(...boxes.map((b) => b.h)) + 2 * pad;
  const placed: Box[] = [], left: string[] = [];
  boxes.forEach((b, i) => {
    if (i >= rows * cols) return left.push(b.id);
    const r = Math.floor(i / cols), c = i % cols;
    placed.push({ ...b, x: origin.x + c * cw + pad, y: origin.y + r * ch + pad });
  });
  return { placed, left };
}

// I10 (Batch.getLayoutOffset): with pages, a tile spans the layout's right and
// bottom extent rounded up to whole pages: (floor(extent / page) + 1) * page.
export const tilePitch = (extent: number, page: number) => (Math.floor(extent / page) + 1) * page;

// I3-I7 (PopModel.bind, Iteration.getSampleByPanel/getSampleByKey/findSampleByKey):
// which sample a layout graph shows for the current iteration value.
export type LayoutIteration = { type: 'OFF' } | { type: 'SAMPLE' } | { type: 'PANEL'; size: number } | { type: 'KEYWORD'; keyword: string; discriminator?: string };
export function bindSample<S extends { id: string }>(origId: string | undefined, it: LayoutIteration, value: string, group: S[], kw: (s: S, k: string) => string | undefined): S | undefined {
  const orig = group.find((s) => s.id === origId);
  switch (it.type) {
    case 'OFF': return orig;
    case 'SAMPLE': return group.find((s) => s.id === value);
    case 'PANEL': {
      const n = Math.max(1, Math.floor(it.size));
      const offset = orig ? group.indexOf(orig) % n : 0;
      const vi = group.findIndex((s) => s.id === value);
      if (vi < 0) return undefined;
      return group[Math.floor(vi / n) * n + offset];
    }
    case 'KEYWORD': {
      const withValue = group.filter((s) => kw(s, it.keyword) === value);
      if (it.discriminator && orig) return withValue.find((s) => kw(s, it.discriminator!) === kw(orig, it.discriminator!));
      if (!orig) return withValue[0];
      const v0 = kw(orig, it.keyword);
      const k = group.filter((s) => kw(s, it.keyword) === v0).indexOf(orig);
      return withValue[Math.max(0, k)];
    }
  }
}
// I8 (Iteration.getIterVals): keyword iteration walks the group's distinct
// values (first-seen order; FlowJo's order was not read); otherwise sample ids.
export function iterationValues<S extends { id: string }>(it: LayoutIteration, group: S[], kw: (s: S, k: string) => string | undefined): string[] {
  if (it.type === 'KEYWORD') return [...new Set(group.map((s) => kw(s, it.keyword)).filter((v): v is string => !!v))];
  if (it.type === 'PANEL') { const n = Math.max(1, Math.floor(it.size)); return group.filter((_, i) => i % n === 0).map((s) => s.id); }
  return group.map((s) => s.id);
}

// S4-S5 (LayerGuides.<init>/snap, DragMove.continueDrag): a new layout has one
// vertical and one horizontal guide at 250 pt, at most 8 guides; while guides
// are shown, a moved selection's enclosing rectangle snaps its left or right
// edge (and top or bottom edge) to the nearest guide within 30 pt.
export interface Guides { v: number[]; h: number[] }
export const DEFAULT_GUIDES: Guides = { v: [250], h: [250] };
export const MAX_GUIDES = 8;
export const SNAP_RADIUS = 30;
export function snapToGuides(rect: Box, dx: number, dy: number, g: Guides, radius = SNAP_RADIUS): { dx: number; dy: number } {
  const best = (edges: number[], lines: number[]) => {
    let d: number | null = null;
    for (const e of edges) for (const l of lines) { const k = l - e; if (Math.abs(k) <= radius && (d === null || Math.abs(k) < Math.abs(d))) d = k; }
    return d;
  };
  const sx = best([rect.x + dx, rect.x + dx + rect.w], g.v);
  const sy = best([rect.y + dy, rect.y + dy + rect.h], g.h);
  return { dx: dx + (sx ?? 0), dy: dy + (sy ?? 0) };
}

// Grid figures (FigGridLayout / FJLayoutGrid / GridUtil; specs 25.2): a grid of
// rows x cols cells of one size with a padding; each cell holds at most one
// item, addressed by (row, col).
export interface GridDef { id: string; x: number; y: number; rows: number; cols: number; pad: number; cellW: number; cellH: number; bare: boolean }
export interface CellRef { id: string; row: number; col: number }
// Cell position of an item (top-left inside the padding).
export const cellOrigin = (g: GridDef, row: number, col: number) => ({ x: g.x + col * (g.cellW + 2 * g.pad) + g.pad, y: g.y + row * (g.cellH + 2 * g.pad) + g.pad });
// The grid's own bounds.
export const gridBounds = (g: GridDef): Box => ({ id: g.id, x: g.x, y: g.y, w: g.cols * (g.cellW + 2 * g.pad), h: g.rows * (g.cellH + 2 * g.pad) });
// Bare charts with axes on the border (G5-G7): bottom row X, left column Y.
export const borderAxes = (g: GridDef, c: CellRef, cells: CellRef[]) => {
  if (!g.bare) return 'tnlTNL';
  const lastRow = Math.max(...cells.filter((x) => x.col === c.col).map((x) => x.row));
  const firstCol = Math.min(...cells.filter((x) => x.row === c.row).map((x) => x.col));
  return `${c.row === lastRow ? 'tnl' : ''}${c.col === firstCol ? 'TNL' : ''}`;
};
// Insert Rows or Columns: a row (column) inserted at index `at`; later cells move down (right).
export function gridInsert(g: GridDef, cells: CellRef[], axis: 'row' | 'col', at: number): { grid: GridDef; cells: CellRef[] } {
  const k = axis === 'row' ? 'row' : 'col';
  return { grid: axis === 'row' ? { ...g, rows: g.rows + 1 } : { ...g, cols: g.cols + 1 }, cells: cells.map((c) => (c[k] >= at ? { ...c, [k]: c[k] + 1 } : c)) };
}
// Delete Rows or Columns: the cells in that row (column) are removed with their
// contents; later cells move up (left). Returns the removed item ids.
export function gridDelete(g: GridDef, cells: CellRef[], axis: 'row' | 'col', at: number): { grid: GridDef; cells: CellRef[]; removed: string[] } {
  const k = axis === 'row' ? 'row' : 'col';
  const n = axis === 'row' ? g.rows : g.cols;
  if (n <= 1) return { grid: g, cells, removed: [] };
  return {
    grid: axis === 'row' ? { ...g, rows: g.rows - 1 } : { ...g, cols: g.cols - 1 },
    cells: cells.filter((c) => c[k] !== at).map((c) => (c[k] > at ? { ...c, [k]: c[k] - 1 } : c)),
    removed: cells.filter((c) => c[k] === at).map((c) => c.id),
  };
}
// Set Grid Dimensions: cells outside the new size leave the grid (kept as free items).
export function gridResize(g: GridDef, cells: CellRef[], rows: number, cols: number): { grid: GridDef; cells: CellRef[]; released: string[] } {
  const r = Math.max(1, Math.floor(rows)), c = Math.max(1, Math.floor(cols));
  return { grid: { ...g, rows: r, cols: c }, cells: cells.filter((x) => x.row < r && x.col < c), released: cells.filter((x) => x.row >= r || x.col >= c).map((x) => x.id) };
}
// The next free cell, row by row (FJLayoutGrid.getNextCell), or null when full.
export function nextFreeCell(g: GridDef, cells: CellRef[]): { row: number; col: number } | null {
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (!cells.some((x) => x.row === r && x.col === c)) return { row: r, col: c };
  return null;
}

// R1-R4 (Fig.pointToHandleIndex / resizeClick / shouldStartResize, ResizeDrag,
// FigEditable.doResize): a figure resizes from its four corner handles only;
// a handle is hit within 6 pt of the corner; the opposite corner stays put;
// Shift (without Ctrl), or a locked aspect ratio, keeps the aspect ratio by
// moving the dragged corner to the closest point on the diagonal through the
// fixed corner; figures are at least 4 pt (Fig.MIN_SIZE); size-locked figures
// do not resize. Handles are numbered 1..9, row by row (1 top-left, 3 top-right,
// 7 bottom-left, 9 bottom-right; 5 = inside, -1 = outside).
export const HANDLE_SLOP = 6;
export const MIN_FIG = 4;
export function handleAt(b: Box, pt: { x: number; y: number }, slop = HANDLE_SLOP): number {
  if (pt.x < b.x - slop || pt.x > b.x + b.w + slop || pt.y < b.y - slop || pt.y > b.y + b.h + slop) return -1;
  const col = Math.abs(pt.x - b.x) < slop ? 0 : Math.abs(pt.x - (b.x + b.w / 2)) < slop ? 1 : Math.abs(pt.x - (b.x + b.w)) < slop ? 2 : -1;
  const row = Math.abs(pt.y - b.y) < slop ? 0 : Math.abs(pt.y - (b.y + b.h / 2)) < slop ? 1 : Math.abs(pt.y - (b.y + b.h)) < slop ? 2 : -1;
  if (col < 0 || row < 0) return 5;
  const h = row * 3 + col + 1;
  return h % 2 === 0 ? 5 : h; // edge midpoints act as the inside (move)
}
export const isCornerHandle = (h: number) => h === 1 || h === 3 || h === 7 || h === 9;
export function resizeBox(b: Box, handle: number, pt: { x: number; y: number }, keepAspect = false): Box {
  if (!isCornerHandle(handle)) return { ...b };
  const ax = handle === 1 || handle === 7 ? b.x + b.w : b.x;
  const ay = handle === 1 || handle === 3 ? b.y + b.h : b.y;
  let px = pt.x, py = pt.y;
  if (keepAspect && b.w > 0 && b.h > 0) {
    // Closest point on the line through the anchor with slope +-h/w.
    const sx = px < ax ? -1 : 1, sy = py < ay ? -1 : 1;
    const dx = sx * b.w, dy = sy * b.h;
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    px = ax + t * dx; py = ay + t * dy;
  }
  const x = Math.round(Math.min(ax, px)), y = Math.round(Math.min(ay, py));
  return { ...b, x, y, w: Math.max(MIN_FIG, Math.round(Math.abs(px - ax))), h: Math.max(MIN_FIG, Math.round(Math.abs(py - ay))) };
}

// Z1-Z4 (EditorZoom): zoom steps 12, 25, 33, 50, 66, 75, 100, 150, 200, 400 %.
// The current step is the first step >= the scale; Zoom In takes the next step
// (at most 400 %), Zoom Out the previous (at least 12 %); Fit to Window takes
// the step before the first step >= the ratio that fits the figures' enclosing
// rectangle into the window, at least 12 %; Reset Zoom is 100 %.
export const ZOOM_STEPS = [12, 25, 33, 50, 66, 75, 100, 150, 200, 400];
const stepIndex = (pct: number) => { const i = ZOOM_STEPS.findIndex((s) => s >= pct); return i < 0 ? ZOOM_STEPS.length - 1 : i; };
export const zoomIndex = (scale: number) => stepIndex(Math.round(scale * 1000) / 10);
export const zoomIn = (scale: number) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex(scale) + 1)] / 100;
export const zoomOut = (scale: number) => ZOOM_STEPS[Math.max(0, zoomIndex(scale) - 1)] / 100;
export function zoomFit(view: { w: number; h: number }, content: { w: number; h: number }): number {
  if (content.w <= 0 || content.h <= 0) return 1;
  const r = Math.min(view.w / content.w, view.h / content.h);
  return ZOOM_STEPS[Math.max(0, stepIndex(Math.trunc(r * 100)) - 1)] / 100;
}

// P14 (LayoutEditor.setAutoPageScale, PrintLayout.setContentScaling): Scale To
// Width / Height / Page set the page's content scaling to the figures' right
// (bottom) extent over the page width (height), Page the larger of the two, so
// all figures print on one page width, height or page. With figures smaller
// than 50 pt either way the scaling is 1. A page then holds page x scaling
// layout points. Undoable (SetScaleEdit).
export type ScaleType = 'page' | 'width' | 'height';
export function autoPageScale(boxes: Box[], page: { w: number; h: number }, type: ScaleType): number {
  let right = Math.max(0, ...boxes.map((b) => b.x + b.w)), bottom = Math.max(0, ...boxes.map((b) => b.y + b.h));
  if (right < 50 || bottom < 50) { right = page.w; bottom = page.h; }
  const rw = right / page.w, rh = bottom / page.h;
  return type === 'width' ? rw : type === 'height' ? rh : Math.max(rw, rh);
}

// C1-C4 (LECopyAction, FJClipboardUtil.copy, LEPasteAction.paste): Copy puts
// the selected figures (all figures when none is selected) on the clipboard as
// figures and as an image (PNG with transparency, else opaque); Paste places
// them back moved so their top-left lies in the visible area, then by (+4, +4).
export function pasteOffset(bounds: { x: number; y: number }, visible: Box): { dx: number; dy: number } {
  const inside = bounds.x >= visible.x && bounds.x < visible.x + visible.w && bounds.y >= visible.y && bounds.y < visible.y + visible.h;
  const dx = inside ? 0 : visible.x - bounds.x, dy = inside ? 0 : visible.y - bounds.y;
  return { dx: dx + PASTE_OFFSET, dy: dy + PASTE_OFFSET };
}
// Pasted text or a pasted image becomes a figure at (30, 50).
export const PASTE_TEXT_POINT = { x: 30, y: 50 };

// SEL1-SEL2 (LESelectionAction, QuadLayer.selectAll / toggleSelection).
export const invertSelection = (all: string[], sel: string[]) => all.filter((id) => !sel.includes(id));

// L1-L4 (SExplorer.doNewTemplate / doDuplicateTemplate / deleteSelectedTemplates /
// sortTemplateList, NameUtil.uniqueName): layouts are listed by name, ignoring
// case; a new layout is "Layout", made unique; a name in use gets "-1", "-2", ...
// after any "-<1 to 3 digits>" suffix is dropped.
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  let base = name;
  const dash = name.lastIndexOf('-');
  if (dash > 2 && dash > name.length - 4 && dash < name.length - 1 && /^\d+$/.test(name.slice(dash + 1))) base = name.slice(0, dash);
  for (let i = 1; i < 1000; i++) { const n = `${base}-${i}`; if (!taken.includes(n)) return n; }
  return `${name}${Date.now()}`;
}
export const sortNames = (names: string[]) => [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
