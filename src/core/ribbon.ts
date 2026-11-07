// Ribbon customisation (WSCommand / TECommand / PECommand RIBBONCONFIG,
// RIBBONSETDEFAULT, RIBBONCOMMITTOPREFS): docs/validation/ui-gaps/workspace.md.
// Rules from AbstractRibbonStructure (addBand / removeBand / XML form),
// FJRibbonDropTargetListener.drop and the Ribbon*Action classes; implemented
// independently. A structure lists, per task (tab), the band ids in order.

export type RibbonStructure = Record<string, string[]>;

export const RIBBON_MESSAGES = {
  lastBand: 'Unable to remove the last band from a task.',
  duplicate: 'No band was added since it already exists in the selected task.',
  setDefaultsConfirm: 'Are you sure? This will discard all ribbon customizations saved to your preferences.',
  commitConfirm: 'Are you sure? This will discard any previous configurations saved to your preferences.',
  prompt: 'Drag bands to add them to the ribbon.\nTo remove a band, drag it off of the ribbon.\nTo swap positions of existing bands, drag them.',
};

export interface RibbonResult { structure: RibbonStructure; error?: string }

const copy = (s: RibbonStructure): RibbonStructure => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, [...v]]));

// removeBand: the last band of a task cannot be removed.
export function removeBand(s: RibbonStructure, task: string, band: string): RibbonResult {
  const bands = s[task];
  if (!bands || !bands.includes(band)) return { structure: s };
  if (bands.length === 1) return { structure: s, error: RIBBON_MESSAGES.lastBand };
  const out = copy(s);
  out[task] = bands.filter((b) => b !== band);
  return { structure: out };
}

// addBand: appended, or placed before / after a band of the task; a band
// already in the task is refused.
export function addBand(s: RibbonStructure, task: string, band: string, at?: { target: string; after: boolean }): RibbonResult {
  const bands = s[task];
  if (!bands) return { structure: s };
  if (bands.includes(band)) return { structure: s, error: RIBBON_MESSAGES.duplicate };
  const out = copy(s);
  const i = at ? bands.indexOf(at.target) : -1;
  if (at && i < 0) return { structure: s };
  if (i < 0) out[task].push(band);
  else out[task].splice(i + (at!.after ? 1 : 0), 0, band);
  return { structure: out };
}

// Drop of a dragged band on a band of the task (FJRibbonDropTargetListener):
// dropping a band on itself does nothing; a band already in the task is
// moved, otherwise it is added before (left half) or after (right half).
export function dropBand(s: RibbonStructure, task: string, band: string, target: string, after: boolean): RibbonResult {
  if (band === target || !s[task]?.includes(target)) return { structure: s };
  let cur = s;
  if (cur[task].includes(band)) cur = removeBand(cur, task, band).structure;
  return addBand(cur, task, band, { target, after });
}

// AbstractRibbonStructure(SElement): tasks and bands by name; unknown names
// are skipped; a task missing from the saved form keeps its default bands.
export function parseStructure(raw: unknown, defaults: RibbonStructure, bandIds: string[]): RibbonStructure {
  const out = copy(defaults);
  if (!raw || typeof raw !== 'object') return out;
  for (const [task, bands] of Object.entries(raw as Record<string, unknown>)) {
    if (!(task in out) || !Array.isArray(bands)) continue;
    const ok = [...new Set(bands.filter((b): b is string => typeof b === 'string' && bandIds.includes(b)))];
    if (ok.length) out[task] = ok;
  }
  return out;
}

export function sameStructure(a: RibbonStructure, b: RibbonStructure): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Storage: the current structure lives for the browser session; Commit to
// Preferences copies it to the preferences (local storage) that new windows
// start from; Apply defaults restores the defaults and clears them.
const PREFS = (editor: string) => `flowjo-rea.ribbon.${editor}`;
const CURRENT = (editor: string) => `flowjo-rea.ribbon.${editor}.current`;

function read(store: Storage | undefined, key: string): unknown {
  try { const t = store?.getItem(key); return t ? JSON.parse(t) : null; } catch { return null; }
}

export function loadRibbon(editor: string, defaults: RibbonStructure, bandIds: string[]): RibbonStructure {
  const ss = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
  const ls = typeof localStorage !== 'undefined' ? localStorage : undefined;
  return parseStructure(read(ss, CURRENT(editor)) ?? read(ls, PREFS(editor)), defaults, bandIds);
}

export function saveCurrent(editor: string, s: RibbonStructure): void {
  try { sessionStorage.setItem(CURRENT(editor), JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function commitToPrefs(editor: string, s: RibbonStructure): void {
  try { localStorage.setItem(PREFS(editor), JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function clearPrefs(editor: string): void {
  try { localStorage.removeItem(PREFS(editor)); sessionStorage.removeItem(CURRENT(editor)); } catch { /* storage unavailable */ }
}
