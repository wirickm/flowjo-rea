// Layout editor preferences and helpers of FlowJo 10.6.2
// (docs/validation/ui-gaps/layout.md sections 3.3, 6.5, 6.8, 7.1): the
// customisable ribbon (LERibbonStructure, LERibbonConfigDialog,
// FJRibbonConfigDialog, AbstractRibbonStructure.addBand / removeBand,
// LERibbonSetDefaultAction), the Overlay Mode preference
// (FJPrefsFJML$Graph.histoOverlayScale, NewOverlayEnum, YAxisPanel$YScaleType),
// the help pages (FJHelpAction, Help.getHelpPrefix, LEGraphDefAction) and the
// web page figure's zoom rules (FigWebBrowser). Decoded with javap; written
// here independently.

// --- ribbon ---------------------------------------------------------------
export type RibbonTask = 'LEDITOR' | 'FILE' | 'EDIT' | 'OBJECT' | 'ARRANGE';
export type RibbonBand = 'LAYOUTS' | 'ITERATION' | 'BATCH' | 'DOCUMENT' | 'GO' | 'CLIPBOARD' | 'SELECT' | 'SHOWHIDE' | 'PROPERTIES' | 'LOCKS' | 'TEXT' | 'FIGPRESET' | 'REORDER' | 'VERTICAL' | 'HORIZONTAL' | 'ANNOTATE';
// le.ribbon.task.* and le.ribbon.band.* labels; bands in LERibbonCommand$Band order.
export const TASK_LABELS: Record<RibbonTask, string> = { LEDITOR: 'Layout Editor', FILE: 'File', EDIT: 'Edit', OBJECT: 'Object', ARRANGE: 'Arrange' };
export const BAND_LABELS: Record<RibbonBand, string> = {
  LAYOUTS: 'Layouts', DOCUMENT: 'Document', ITERATION: 'Iteration', CLIPBOARD: 'Clipboard', BATCH: 'Batch', PROPERTIES: 'Properties', LOCKS: 'Locks', SELECT: 'Select',
  REORDER: 'Reorder', SHOWHIDE: 'Show & Hide', TEXT: 'Text', FIGPRESET: 'Figure Presets', VERTICAL: 'Vertical Alignment', GO: 'Go', HORIZONTAL: 'Horizontal Alignment', ANNOTATE: 'Annotate',
};
export const ALL_BANDS = Object.keys(BAND_LABELS) as RibbonBand[];
export const TASKS: RibbonTask[] = ['LEDITOR', 'FILE', 'EDIT', 'OBJECT', 'ARRANGE'];
export type RibbonConfig = Record<RibbonTask, RibbonBand[]>;
// LERibbonStructure.loadDefaults; ANNOTATE (the insert tools here) is added to
// Object (own rule: FlowJo inserts figures from its tool palette).
export const defaultRibbon = (): RibbonConfig => ({
  LEDITOR: ['LAYOUTS', 'ITERATION', 'BATCH'],
  FILE: ['DOCUMENT', 'GO'],
  EDIT: ['CLIPBOARD', 'SELECT', 'SHOWHIDE'],
  OBJECT: ['PROPERTIES', 'LOCKS', 'TEXT', 'FIGPRESET', 'ANNOTATE'],
  ARRANGE: ['REORDER', 'VERTICAL', 'HORIZONTAL'],
});
export const DUPLICATE_BAND = 'No band was added since it already exists in the selected task.';
export const LAST_BAND = 'Unable to remove the last band from a task.';
export const SET_DEFAULTS_CONFIRM = 'Are you sure? This will discard all ribbon customizations saved to your preferences.';
export const CONFIG_PROMPT = 'Drag bands to add them to the ribbon. To remove a band, drag it off of the ribbon. To swap positions of existing bands, drag them.';
// addBand: refused when the task already has the band; a band may be in several tasks.
export function addBand(c: RibbonConfig, task: RibbonTask, band: RibbonBand, at?: number): { config: RibbonConfig; error?: string } {
  if (c[task].includes(band)) return { config: c, error: DUPLICATE_BAND };
  const list = [...c[task]];
  list.splice(at ?? list.length, 0, band);
  return { config: { ...c, [task]: list } };
}
// removeBand: refused for a task's last band.
export function removeBand(c: RibbonConfig, task: RibbonTask, band: RibbonBand): { config: RibbonConfig; error?: string } {
  if (c[task].length === 1) return { config: c, error: LAST_BAND };
  return { config: { ...c, [task]: c[task].filter((b) => b !== band) } };
}
// Swapping positions of two bands of a task.
export function moveBand(c: RibbonConfig, task: RibbonTask, band: RibbonBand, step: -1 | 1): RibbonConfig {
  const list = [...c[task]], i = list.indexOf(band), j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return c;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...c, [task]: list };
}
const RIBBON_KEY = 'flowjo-rea.layoutRibbon';
// The ribbon is kept with the preferences (FJPrefs.setLERibbon), per viewer.
export function loadRibbon(): RibbonConfig {
  try {
    const v = JSON.parse(localStorage.getItem(RIBBON_KEY) ?? 'null') as RibbonConfig | null;
    if (v && TASKS.every((t) => Array.isArray(v[t]) && v[t].length && v[t].every((b) => ALL_BANDS.includes(b)))) return v;
  } catch { /* storage unavailable */ }
  return defaultRibbon();
}
export function saveRibbon(c: RibbonConfig | null) {
  try { if (c) localStorage.setItem(RIBBON_KEY, JSON.stringify(c)); else localStorage.removeItem(RIBBON_KEY); } catch { /* storage unavailable */ }
}

// --- Overlay Mode (Preferences > Graphs, LECommand.OVERLAY) ----------------
// Values auto / modal / unit (NewOverlayEnum); a new graph's Y axis scaling
// is YScaleType.fromString(value) (GraphSpec.defaultGraphSpec), which matches
// "auto", "manual", "modal" and "unitarea" exactly, so "unit" falls back to
// Auto in 10.6.2. Modal draws every histogram layer normalised to its mode;
// Auto draws counts on one axis up to the tallest layer
// (HistoScalingUtil.setGraphSpecForHistoOverlay).
export type OverlayMode = 'auto' | 'modal' | 'unit';
export const OVERLAY_LABELS: Record<OverlayMode, string> = { auto: 'Auto', modal: 'Modal', unit: 'Unit' };
const OVERLAY_KEY = 'flowjo-rea.overlayMode';
export function loadOverlayMode(): OverlayMode {
  try { const v = localStorage.getItem(OVERLAY_KEY); if (v === 'modal' || v === 'unit' || v === 'auto') return v; } catch { /* storage unavailable */ }
  return 'auto'; // histoOverlayScale default: YScaleType.AUTO
}
export function saveOverlayMode(m: OverlayMode) { try { localStorage.setItem(OVERLAY_KEY, m); } catch { /* storage unavailable */ } }
// The Y scaling a new histogram gets: normalised to mode only for Modal.
export const overlayNormalize = (m: OverlayMode): boolean => m === 'modal';

// --- help pages -------------------------------------------------------------
// FJHelpAction: the dictionary "<command>.url" path after Help.getHelpPrefix()
// ("http://docs.flowjo.com/d2/" with online documentation);
// LEGraphDefAction calls Help.help with its own path. STAT_TABLE_HELP has no
// handler in 10.6.2.
export const HELP_PREFIX = 'http://docs.flowjo.com/d2/';
export const HELP_URLS = {
  HELP: `${HELP_PREFIX}graphical-reports/graph-options-and-annotation/le-graphdef/`,
  GRID_HELP: `${HELP_PREFIX}graphical-reports/graph-options-and-annotation/le-grid/`,
  FJML_HELP: `${HELP_PREFIX}graphical-reports/equations-statistics-and-tables/le-fjml/`,
} as const;

// --- web page figure (FigWebBrowser) ---------------------------------------
// Default URL http://www.flowjo.com; the mouse wheel while editing the figure
// zooms by rotation / 10 (adds; wheel down enlarges) within 0.1..3 (WebZoomer); dragging pans the page
// (offsetX / offsetY); Reset Zoom sets 1, Reset Position the offset to 0, 0.
export const WEB_DEFAULT_URL = 'http://www.flowjo.com';
export const WEB_PROMPT = 'Enter Link:';
export const webZoom = (zoom: number, notches: number) => Math.min(3, Math.max(0.1, +(zoom + notches / 10).toFixed(4)));
