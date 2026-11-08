// FlowJo 10.6.2 Plate Editor (PlatformNavCommand.PLATE, PECommand; spec
// docs/validation/ui-gaps/platforms.md). Pure plate model: wells keyed by
// well ID ("A1"), attributes as keyword/value pairs. Rules decoded from
// com.treestar.flowjo.application.peditor.* and implemented independently.
import type { SampleState } from './model';
import { descendants, parseXml } from './xml';

export type Attrs = Record<string, string>;

export interface PlateDef {
  name: string;
  rows: number;
  cols: number;
  plateID: string;
  experimentID: string;
  wells: Record<string, Attrs>; // only wells with attributes
  keywordFilter?: string; // PlateModel.keywordFilter ('' = all keywords)
  showNEntries?: boolean;
  heatmap?: boolean;
  enumBorders?: boolean;
  thickBorders?: boolean;
}

export interface StagingWell { name: string; attrs: Attrs }
export interface SavedSelection { name: string; wells: string[] }

export interface PlateEditorState {
  plates: PlateDef[];
  current: number;
  keywordTable: { attribute: string; value: string }[]; // "Keyword/Values - Drag to Wells"
  staging: StagingWell[];
  selections: SavedSelection[];
  hideInstructions?: boolean;
}

// PlateDimensionDialog: the standard sizes (columns x rows); Custom allows
// 1..48 columns and 1..32 rows.
export const PLATE_SIZES = { 96: { cols: 12, rows: 8 }, 384: { cols: 24, rows: 16 }, 1536: { cols: 48, rows: 32 } } as const;
export const MAX_COLS = 48;
export const MAX_ROWS = 32;
// PlateModel.wellNotation: row letters A..Z then a..f (32 rows).
export const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';

export function wellId(row: number, col: number): string {
  return `${ROW_LETTERS[row]}${col + 1}`;
}

// PlateWell.nameToPoint / isWellDesignation: at most 3 characters, a first
// character from 'A' to 'g' (char codes 65..103) and a column 1..48. The row
// is (char - 'A'), so lower-case letters do not map back onto ROW_LETTERS
// rows 27..32 (a FlowJo quirk kept here).
export function parseWellDesignation(s: string): { row: number; col: number } | null {
  if (!s || s.length > 3) return null;
  const c = s.charCodeAt(0);
  if (c < 65 || c > 103) return null;
  const col = parseInt(s.slice(1), 10);
  if (!(col >= 1 && col <= 48)) return null;
  return { row: c - 65, col: col - 1 };
}

// Sample.getWellIDKeywordPossibilities (preference first, then these).
export const WELL_ID_KEYWORDS = ['WELL ID', 'GTI$WELL', '$WELLID', 'WELL_ID', 'well id'];
export const PLATE_ID_KEYWORDS = ['PLATE ID', '$PLATEID', '$PLATE_ID', 'PLATEID', 'plate id'];
export const PLATE_NAME_KEYWORDS = ['PLATE_NAME', '$PLATENAME', '$PLATE_NAME', 'PLATENAME', 'plate name'];
export const EXPERIMENT_KEYWORDS = ['EXPERIMENT_NAME', '$EXPERIMENTNAME', '$EXPERIMENT_NAME', 'EXPERIMENTNAME', 'experiment name'];

const kv = (s: SampleState, k: string) => s.annotations?.[k] ?? s.keywordsSnapshot[k];
export function firstKeyword(s: SampleState, keys: string[]): string | undefined {
  for (const k of keys) { const v = kv(s, k); if (v !== undefined) return v; }
  return undefined;
}

// WellID.fromString: letters and digits are collected separately; the row is
// the first letter (case-insensitive, a = 0), the column the digits minus 1;
// both must be 0..200. "A01", "a1" and "1A" all name A1.
export function parseSampleWell(v: string | undefined): { row: number; col: number } | null {
  if (!v) return null;
  let letters = '', digits = '';
  for (const ch of v) { if (/[0-9]/.test(ch)) digits += ch; else if (/\p{L}/u.test(ch)) letters += ch; }
  if (!letters || !digits) return null;
  const row = letters.toLowerCase().charCodeAt(0) - 97;
  const col = parseInt(digits, 10) - 1;
  if (row < 0 || row > 200 || col < 0 || col > 200) return null;
  return { row, col };
}
export function sampleWell(s: SampleState): string | null {
  const p = parseSampleWell(firstKeyword(s, WELL_ID_KEYWORDS));
  return p && p.row < ROW_LETTERS.length ? wellId(p.row, p.col) : null;
}

// PlateModel(String, PlateEditor): name, plateID "00000", experimentID
// "000-00000"; the size comes from the plate-size preference, else 96 wells.
export function newPlate(name: string, size: { cols: number; rows: number } = PLATE_SIZES[96]): PlateDef {
  return { name, rows: size.rows, cols: size.cols, plateID: '00000', experimentID: '000-00000', wells: {}, keywordFilter: '', showNEntries: true };
}
export function newEditorState(): PlateEditorState {
  // PEditorStagingArea.defineStagingWells: four empty staging wells.
  return { plates: [newPlate('Plate')], current: 0, keywordTable: [], staging: [1, 2, 3, 4].map((n) => ({ name: `Staging Well ${n}`, attrs: {} })), selections: [] };
}

export function allWells(p: PlateDef): string[] {
  const out: string[] = [];
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) out.push(wellId(r, c));
  return out;
}

export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}
// StagingWell.getDefaultStagingWellName: "Staging Well n", smallest unused n.
export function nextStagingName(staging: StagingWell[]): string {
  for (let n = 1; ; n++) if (!staging.some((s) => s.name === `Staging Well ${n}`)) return `Staging Well ${n}`;
}

// Well.addAttribute: an identical pair is skipped; a different value of an
// existing attribute replaces it (FlowJo asks "This keyword exists, do you
// want to overwrite it?"; this app overwrites, see spec).
export function addAttrs(p: PlateDef, well: string, attrs: Attrs) {
  if (!Object.keys(attrs).length) return;
  p.wells[well] = { ...(p.wells[well] ?? {}), ...attrs };
}
export function removeAttr(p: PlateDef, well: string, key: string) {
  const w = p.wells[well];
  if (!w) return;
  delete w[key];
  if (!Object.keys(w).length) delete p.wells[well];
}
// Plate.clearSelectedWells: with a keyword filter only that keyword is
// removed, otherwise every attribute.
export function clearWells(p: PlateDef, wells: string[], filter?: string) {
  for (const w of wells) {
    if (filter) removeAttr(p, w, filter);
    else delete p.wells[w];
  }
}

// PlateModel.setPlateSize: wells outside the new grid are dropped.
export function setDimensions(p: PlateDef, cols: number, rows: number) {
  p.cols = Math.max(1, Math.min(MAX_COLS, Math.floor(cols)));
  p.rows = Math.max(1, Math.min(MAX_ROWS, Math.floor(rows)));
  for (const w of Object.keys(p.wells)) {
    const pt = parseWellDesignation(w);
    if (!pt || pt.row >= p.rows || pt.col >= p.cols) delete p.wells[w];
  }
}

export function plateKeywords(p: PlateDef): string[] {
  return [...new Set(Object.values(p.wells).flatMap((a) => Object.keys(a)))].sort();
}

// --- selection (PlateModel.selectAll / selectNone / invertSelection / selectRange)
export function invert(p: PlateDef, sel: string[]): string[] {
  const s = new Set(sel);
  return allWells(p).filter((w) => !s.has(w));
}
export function rectangle(a: string, b: string): string[] {
  const pa = parseWellDesignation(a), pb = parseWellDesignation(b);
  if (!pa || !pb) return [];
  const out: string[] = [];
  for (let r = Math.min(pa.row, pb.row); r <= Math.max(pa.row, pb.row); r++) for (let c = Math.min(pa.col, pb.col); c <= Math.max(pa.col, pb.col); c++) out.push(wellId(r, c));
  return out;
}
export function rowWells(p: PlateDef, r: number) { return Array.from({ length: p.cols }, (_, c) => wellId(r, c)); }
export function colWells(p: PlateDef, c: number) { return Array.from({ length: p.rows }, (_, r) => wellId(r, c)); }

// Plate.fillDown: per column, the topmost selected well's attributes are
// added to the run of selected wells directly below it (stopping at the first
// unselected well). FlowJo skips a column whose topmost selected well is in
// the last two rows (its index test is off by one); kept.
export function fillDown(p: PlateDef, sel: string[]) {
  const s = new Set(sel);
  for (let c = 0; c < p.cols; c++) {
    let r = 0;
    while (r < p.rows && !s.has(wellId(r, c))) r++;
    if (r + 1 >= p.rows - 1) continue;
    const src = { ...(p.wells[wellId(r, c)] ?? {}) };
    for (let k = r + 1; k < p.rows && s.has(wellId(k, c)); k++) addAttrs(p, wellId(k, c), src);
  }
}
// Plate.fillRight: the same along rows.
export function fillRight(p: PlateDef, sel: string[]) {
  const s = new Set(sel);
  for (let r = 0; r < p.rows; r++) {
    let c = 0;
    while (c < p.cols && !s.has(wellId(r, c))) c++;
    if (c + 1 >= p.cols - 1) continue;
    const src = { ...(p.wells[wellId(r, c)] ?? {}) };
    for (let k = c + 1; k < p.cols && s.has(wellId(r, k)); k++) addAttrs(p, wellId(r, k), src);
  }
}

// Java Double.toString, as FlowJo writes series values ("1.0", "0.5", "1.0E-4").
export function javaDouble(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e7) { const s = String(v); return s.includes('.') ? s : `${s}.0`; }
  const [m, e] = v.toExponential().split('e');
  return `${m.includes('.') ? m : `${m}.0`}E${Number(e)}`;
}

export interface Series { attribute: string; start: number; repeats: number; multiplier: number; increment: number }
export const DEFAULT_SERIES: Series = { attribute: 'Concentration (µg/ml)', start: 1, repeats: 1, multiplier: 1, increment: 0 };

// Plate.fillSeries (PlateTitrationDlog, "Dilution Series..."): per column
// (down) or row (right) of the selection, every well from the first to the
// last selected one gets attribute = value; after each `repeats` wells the
// value becomes value*multiplier + increment. Fill Right does not add the
// increment (FlowJo's horizontal branch omits it; kept).
export function dilutionSeries(p: PlateDef, sel: string[], s: Series, down: boolean) {
  const attribute = s.attribute || DEFAULT_SERIES.attribute;
  const pts = sel.map(parseWellDesignation).filter((x): x is { row: number; col: number } => !!x);
  const lines = down ? p.cols : p.rows;
  for (let i = 0; i < lines; i++) {
    const idx = pts.filter((q) => (down ? q.col : q.row) === i).map((q) => (down ? q.row : q.col));
    if (!idx.length) continue;
    let value = s.start, left = Math.max(0, Math.floor(s.repeats) - 1);
    for (let k = Math.min(...idx); k <= Math.max(...idx); k++) {
      addAttrs(p, down ? wellId(k, i) : wellId(i, k), { [attribute]: javaDouble(value) });
      if (left > 0) left--;
      else { value = value * s.multiplier + (down ? s.increment : 0); left = Math.max(0, Math.floor(s.repeats) - 1); }
    }
  }
}

// --- CSV (PlateModel.makeTable / importString)
const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
// "WELL ID" then one column per keyword found in any well (FlowJo: hash set
// order; here sorted), one row per well in row-major order, empty wells too.
export function plateCsv(p: PlateDef): string {
  const keys = plateKeywords(p);
  const lines = [['WELL ID', ...keys].map(csvCell).join(',')];
  for (const w of allWells(p)) lines.push([w, ...keys.map((k) => p.wells[w]?.[k] ?? '')].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

export function parseCsv(text: string, delim = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export class PlateImportError extends Error {}
// Import: the header column named like a well ID keyword (case-insensitive,
// trimmed; the last such column wins) holds well IDs; each other non-empty
// header/value pair is added to that well. Rows without a valid well ID or a
// well outside the plate are ignored.
export function importCsv(p: PlateDef, text: string): { applied: number; ignored: number } {
  const rows = parseCsv(text);
  const head = rows[0] ?? [];
  let wc = -1;
  head.forEach((h, i) => { if (WELL_ID_KEYWORDS.some((k) => k.toLowerCase() === h.trim().toLowerCase())) wc = i; });
  if (wc < 0) throw new PlateImportError('The well id was not found in any column');
  let applied = 0, ignored = 0;
  for (const r of rows.slice(1)) {
    if (r.length < wc + 1 || !r[wc]) continue;
    const pt = parseWellDesignation(r[wc].trim());
    if (!pt || pt.row >= p.rows || pt.col >= p.cols) { ignored++; continue; }
    const a: Attrs = {};
    r.forEach((v, i) => { if (i !== wc && head[i] && v) a[head[i]] = v; });
    addAttrs(p, wellId(pt.row, pt.col), a);
    applied++;
  }
  return { applied, ignored };
}

// PEditorKeywordTable.addKeywordFile: each line "attribute,value" (at least
// two fields) is added to the top of the keyword table, skipping duplicates.
export function keywordFilePairs(text: string): { attribute: string; value: string }[] {
  return text.split(/\r?\n/).map((l) => l.split(',')).filter((f) => f.length >= 2).map((f) => ({ attribute: f[0], value: f[1] }));
}
export function addPairs(st: PlateEditorState, pairs: { attribute: string; value: string }[]) {
  for (const pr of pairs) {
    if (!pr.attribute || !pr.value) continue;
    if (!st.keywordTable.some((x) => x.attribute === pr.attribute && x.value === pr.value)) st.keywordTable.unshift(pr);
  }
}

// Copy / Paste (PEEditAction, PlateWellsTransferable): tab/newline text with
// attributes in the first row and well IDs in the first column.
export function copyText(p: PlateDef, sel: string[]): string {
  const wells = allWells(p).filter((w) => sel.includes(w));
  const keys = [...new Set(wells.flatMap((w) => Object.keys(p.wells[w] ?? {})))].sort();
  return [['WELL ID', ...keys].join('\t'), ...wells.map((w) => [w, ...keys.map((k) => p.wells[w]?.[k] ?? '')].join('\t'))].join('\n');
}
export function pasteText(p: PlateDef, text: string): number {
  const rows = text.split(/\r?\n/).filter((l) => l.length).map((l) => l.split('\t'));
  const head = rows[0] ?? [];
  let n = 0;
  for (const r of rows.slice(1)) {
    const pt = parseWellDesignation((r[0] ?? '').trim());
    if (!pt || pt.row >= p.rows || pt.col >= p.cols) continue;
    const a: Attrs = {};
    for (let i = 1; i < r.length; i++) if (head[i] && r[i]) a[head[i]] = r[i];
    addAttrs(p, wellId(pt.row, pt.col), a);
    n++;
  }
  return n;
}

// --- display (PlateWell.getWellDisplayText, CalculatedTable.getHeatMapColoring)
export function wellText(p: PlateDef, w: string): string {
  const f = p.keywordFilter ?? '';
  if (!f || f.toLowerCase().includes('well') || f.toLowerCase() === 'all') return w;
  return p.wells[w]?.[f] ?? '';
}
// PlateModel.getWellValueRange: a Range starting at [0, 0] widened by every
// numeric value of the keyword.
export function valueRange(p: PlateDef, key: string): [number, number] {
  let lo = 0, hi = 0;
  for (const a of Object.values(p.wells)) {
    const v = a[key];
    if (v === undefined || v.trim() === '' || !Number.isFinite(Number(v))) continue;
    const x = Number(v);
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}
// Blue at the range minimum to yellow at the maximum: u = pin((max - v) /
// width, 0, 1), blue = int(255 u), red = green = 255 - blue.
export function heatColor(v: number, [lo, hi]: [number, number]): [number, number, number] {
  let u = (hi - v) / (hi - lo);
  u = Number.isNaN(u) ? 0 : Math.min(1, Math.max(0, u));
  const b = Math.trunc(u * 255);
  return [255 - b, 255 - b, b];
}

// --- workspace links (PlateEditor.attachSamplesFromGroup, fillWellsFromWorkspace, PEAction.wellsToWorkspace)
export function samplesByWell(p: PlateDef, samples: SampleState[]): Record<string, SampleState[]> {
  const out: Record<string, SampleState[]> = {};
  for (const s of samples) {
    const w = sampleWell(s);
    if (!w) continue;
    const pt = parseWellDesignation(w);
    if (!pt || pt.row >= p.rows || pt.col >= p.cols) continue;
    (out[w] ??= []).push(s);
  }
  return out;
}

// KeywordedParameterList.isInteresting: keywords copied into plate wells.
export function interestingKeyword(k: string, v: string): boolean {
  if (!k.trim() || !v || !v.trim()) return false;
  if (/^(FJ_FCS|AUTOBS|APPLY COMP|WINDOW EXTENSION|\$DATATYPE|\$BEGIN|\$END|\$NEXT|\$MODE|\$BYTEORD|LASER)/.test(k)) return false;
  if (/^P\d/.test(k)) return false;
  if (/^\$P\d/.test(k) && !/[SN]$/.test(k)) return false;
  return true;
}

// Read Attributes from Group: each well with exactly one sample of the group
// gets that sample's interesting keywords that are not common to the whole
// group; the plate ID, name and experiment come from the common keywords.
export function readAttributesFromGroup(p: PlateDef, samples: SampleState[]): { filled: number; missing: number } {
  const all = (s: SampleState) => ({ ...s.keywordsSnapshot, ...(s.annotations ?? {}) });
  const maps = samples.map(all);
  const common: Attrs = {};
  if (maps.length) for (const [k, v] of Object.entries(maps[0])) if (maps.every((m) => m[k] === v)) common[k] = v;
  const missing = samples.filter((s) => !sampleWell(s)).length;
  let filled = 0;
  for (const [w, list] of Object.entries(samplesByWell(p, samples))) {
    if (list.length !== 1) continue;
    const a: Attrs = {};
    for (const [k, v] of Object.entries(all(list[0]))) if (interestingKeyword(k, v) && common[k] !== v) a[k] = v;
    addAttrs(p, w, a);
    filled++;
  }
  const pick = (keys: string[]) => { for (const k of keys) if (common[k]) return common[k]; return undefined; };
  p.plateID = pick(PLATE_ID_KEYWORDS) ?? p.plateID;
  p.name = pick(PLATE_NAME_KEYWORDS) ?? p.name;
  p.experimentID = pick(EXPERIMENT_KEYWORDS) ?? p.experimentID;
  return { filled, missing };
}

// Apply Plate Keywords to Group: each well's attributes become annotations
// of the group's sample in that well.
export function applyToSamples(p: PlateDef, samples: SampleState[]): number {
  let n = 0;
  const by = samplesByWell(p, samples);
  for (const [w, list] of Object.entries(by)) {
    const a = p.wells[w];
    if (!a || !Object.keys(a).length) continue;
    for (const s of list) { s.annotations = { ...(s.annotations ?? {}), ...a }; n++; }
  }
  return n;
}

// Select Group: the wells of the samples in a group.
export function wellsOfSamples(p: PlateDef, samples: SampleState[]): string[] {
  return Object.keys(samplesByWell(p, samples));
}

// --- Save / Open (XML plate definition)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function plateXml(st: PlateEditorState): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<PlateEditor>'];
  for (const p of st.plates) {
    out.push(`  <PlateModel name="${esc(p.name)}" rows="${p.rows}" columns="${p.cols}" plateID="${esc(p.plateID)}" expID="${esc(p.experimentID)}" format="Plate">`);
    for (const w of allWells(p)) {
      const a = p.wells[w];
      if (!a) continue;
      const pt = parseWellDesignation(w)!;
      out.push(`    <Protocol name="${w}" format="platewell" row="${pt.row}" column="${pt.col}">`);
      for (const [k, v] of Object.entries(a)) out.push(`      <Keyword attribute="${esc(k)}" value="${esc(v)}"/>`);
      out.push('    </Protocol>');
    }
    out.push('  </PlateModel>');
  }
  for (const s of st.staging) out.push(`  <StagingWell name="${esc(s.name)}">${Object.entries(s.attrs).map(([k, v]) => `<Keyword attribute="${esc(k)}" value="${esc(v)}"/>`).join('')}</StagingWell>`);
  out.push('</PlateEditor>');
  return out.join('\n');
}
export function parsePlateXml(xml: string): PlateEditorState {
  let doc: Document;
  try { doc = parseXml(xml); } catch { throw new PlateImportError('Protocol file could not be parsed.'); }
  const root = doc.documentElement;
  const kws = (el: Element): Attrs => Object.fromEntries(descendants(el, 'Keyword').map((k) => [k.getAttribute('attribute') ?? '', k.getAttribute('value') ?? '']).filter(([k]) => k));
  const plates = [root, ...descendants(root, 'PlateModel')].filter((e) => e.localName === 'PlateModel').map((el) => {
    const p = newPlate(el.getAttribute('name') || 'Plate', { cols: Number(el.getAttribute('columns')) || 12, rows: Number(el.getAttribute('rows')) || 8 });
    p.plateID = el.getAttribute('plateID') || p.plateID;
    p.experimentID = el.getAttribute('expID') || p.experimentID;
    for (const w of descendants(el, 'Protocol')) {
      const r = Number(w.getAttribute('row')), c = Number(w.getAttribute('column'));
      const id = w.hasAttribute('row') && Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 ? wellId(r, c) : w.getAttribute('name') ?? '';
      const pt = parseWellDesignation(id);
      if (pt && pt.row < p.rows && pt.col < p.cols) addAttrs(p, id, kws(w));
    }
    return p;
  });
  if (!plates.length) throw new PlateImportError('Protocol file could not be parsed.');
  const st = newEditorState();
  st.plates = plates;
  const stg = descendants(root, 'StagingWell').map((el) => ({ name: el.getAttribute('name') || 'Staging Well', attrs: kws(el) }));
  if (stg.length) st.staging = stg;
  return st;
}
