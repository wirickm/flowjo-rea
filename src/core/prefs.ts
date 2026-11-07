// FlowJo 10.6.2 preferences (specs section 16): the workspace, graph and gate
// preferences this app honours, "Don't Ask Again" memory (SDialogs.confirm,
// PrefsFJML.DialogsDontAsk), auto-save (AutoSaveTask) and the edge-event
// warning (GateWinController.updateEventsOnAxis). Read with headless Ghidra /
// javap; implemented independently. This module is the one owner of these
// rules.

export interface Prefs {
  noUndo: boolean; // Workspace / Disable Undo
  autoSave: boolean;
  autoSaveMinutes: number;
  resetDontAskOnExit: boolean;
  eventsOnAxis: boolean; // Graphs / edge-event warning
  warningThreshold: number; // percent
  useStainForGateName: boolean;
  dontAsk: string[]; // message keys answered "don't ask again"
}
export const DEFAULT_PREFS: Prefs = { noUndo: false, autoSave: false, autoSaveMinutes: 10, resetDontAskOnExit: false, eventsOnAxis: true, warningThreshold: 5, useStainForGateName: true, dontAsk: [] };

// Confirmations that offer "Don't ask again" (STreeMgr.confirmNodeDeletion);
// group deletion always asks.
export const CONFIRM = {
  statistics: { key: 'ws.mgr.confirmation1', text: 'Are you sure you want to delete statistic(s)?' },
  populations: { key: 'ws.mgr.confirmation2', text: 'Are you sure you want to delete this population(s)?' },
  samples: { key: 'ws.mgr.delete.sample.confirmation', text: (group: string) => `Are you sure you want to remove sample(s) from the ${group} ?` },
  groups: { key: 'ws.groupmgr.deleteprompt', text: 'Do you want to delete group(s)?' },
  layout: { key: 'le.delete.confirm', text: 'Are you sure you want to delete this layout? ' },
  table: { key: 'te.delete.confirm', text: 'Are you sure you want to delete this table? ' },
};
// A remembered key answers Yes without asking (whatever was answered when it
// was stored, as FlowJo does).
export const skipConfirm = (p: Prefs, key: string) => p.dontAsk.includes(key);
export const rememberDontAsk = (p: Prefs, key: string): Prefs => (p.dontAsk.includes(key) ? p : { ...p, dontAsk: [...p.dontAsk, key] });
export const resetDontAsk = (p: Prefs): Prefs => ({ ...p, dontAsk: [] });

// Auto-save: only a workspace already saved once that has samples.
export const shouldAutoSave = (p: Prefs, savedOnce: boolean, sampleCount: number) => p.autoSave && savedOnce && sampleCount > 0;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
// "Auto-Saved <name> on EEE, d MMM yyyy HH:mm:ss"
export const autoSaveMessage = (name: string, d: Date) => `Auto-Saved ${name} on ${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

// Edge-event warning: an axis is flagged when the fraction of the displayed
// events on its lower or upper bound is greater than threshold / 100; the
// message gives int(100 x (sum of the four fractions + 0.005)).
export interface EdgeCounts { n: number; xLow: number; xHigh: number; yLow: number; yHigh: number }
export function edgeWarning(p: Prefs, c: EdgeCounts): { x: boolean; y: boolean; text: string | null } {
  if (!p.eventsOnAxis || c.n <= 0) return { x: false, y: false, text: null };
  const t = p.warningThreshold / 100;
  const f = { xl: c.xLow / c.n, xh: c.xHigh / c.n, yl: c.yLow / c.n, yh: c.yHigh / c.n };
  const x = f.xl > t || f.xh > t, y = f.yl > t || f.yh > t;
  if (!x && !y) return { x, y, text: null };
  const pct = Math.trunc(100 * (f.xl + f.xh + f.yl + f.yh + 0.005));
  return { x, y, text: pct < 98 ? `Warning: ${pct}% of events are on the chart edges!` : 'Warning: Nearly all events are on the chart edges!' };
}

const KEY = 'flowjo-rea.prefs';
export function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable: preferences last for this session */ }
}
