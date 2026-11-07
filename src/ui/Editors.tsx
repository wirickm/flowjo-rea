// Preferences dialog (specs 16) and table editor (specs 17).
import { resetDontAsk, type Prefs } from '../core/prefs';

export function PrefsDialog({ prefs, onChange, onClose }: { prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
  const set = (k: keyof Prefs, v: unknown) => onChange({ ...prefs, [k]: v });
  return (
    <div className="modal-bg"><div className="modal" role="dialog" aria-label="Preferences" data-testid="prefs-dialog"><div className="modal-body">
      <h3>Preferences</h3>
      <label><input type="checkbox" data-testid="pref-noundo" checked={prefs.noUndo} onChange={(e) => set('noUndo', e.target.checked)} /> Disable Undo</label><br />
      <label><input type="checkbox" data-testid="pref-autosave" checked={prefs.autoSave} onChange={(e) => set('autoSave', e.target.checked)} /> Auto-save every </label>
      <input type="number" min={1} style={{ width: 50 }} data-testid="pref-autosave-min" value={prefs.autoSaveMinutes} onChange={(e) => set('autoSaveMinutes', Math.max(1, Number(e.target.value) || 1))} /> minutes<br />
      <label><input type="checkbox" data-testid="pref-edge" checked={prefs.eventsOnAxis} onChange={(e) => set('eventsOnAxis', e.target.checked)} /> Warn when more than </label>
      <input type="number" min={0} max={100} style={{ width: 50 }} data-testid="pref-edge-pct" value={prefs.warningThreshold} onChange={(e) => set('warningThreshold', Number(e.target.value) || 0)} />% of events are on an axis edge<br />
      <h4>Graphs</h4>
      <label><input type="checkbox" data-testid="pref-scinot" checked={prefs.scientificNotation} onChange={(e) => set('scientificNotation', e.target.checked)} /> Use Scientific Notation</label><br />
      <label><input type="checkbox" data-testid="pref-smooth1d" checked={prefs.smoothing1D} onChange={(e) => set('smoothing1D', e.target.checked)} /> Smooth histograms</label><br />
      <label>Dots to draw <input type="number" min={0} max={100000} style={{ width: 70 }} data-testid="pref-dots" value={prefs.dotsToDraw} onChange={(e) => set('dotsToDraw', Math.max(0, Math.min(100000, Math.trunc(Number(e.target.value) || 0))))} /></label><br />
      <label><input type="checkbox" data-testid="pref-adjustcolor" checked={prefs.adjustColor} onChange={(e) => set('adjustColor', e.target.checked)} /> Show "Adjust color table"</label><br />
      <button data-testid="pref-reset-dontask" disabled={!prefs.dontAsk.length} onClick={() => onChange(resetDontAsk(prefs))}>Reset All Don't Show Memory ({prefs.dontAsk.length})</button>
      <div><button data-testid="prefs-close" onClick={onClose}>Close</button></div>
    </div></div></div>
  );
}

// The table editor lives in TableEditor.tsx (docs/validation/ui-gaps/tables.md).
export { TablesDialog } from './TableEditor';
