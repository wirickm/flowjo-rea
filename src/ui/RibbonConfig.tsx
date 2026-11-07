// Ribbon customisation dialog and state (FJRibbonConfigDialog and the
// Ribbon*Action classes): docs/validation/ui-gaps/workspace.md. The rules are
// in src/core/ribbon.ts; editors render their bands from the structure.
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  RIBBON_MESSAGES, addBand, clearPrefs, commitToPrefs, dropBand, loadRibbon, removeBand, saveCurrent,
  type RibbonResult, type RibbonStructure,
} from '../core/ribbon';

export interface RibbonSpec {
  editor: string; // storage key: 'ws', 'te', 'pe'
  defaults: RibbonStructure;
  bands: Record<string, string>; // band id -> title
  canCommit: boolean; // the editor has a Commit to Preferences command
}

export function useRibbon(spec: RibbonSpec) {
  const ids = Object.keys(spec.bands);
  const [structure, setStructure] = useState<RibbonStructure>(() => loadRibbon(spec.editor, spec.defaults, ids));
  const [open, setOpen] = useState<string | null>(null);
  const set = (s: RibbonStructure) => { setStructure(s); saveCurrent(spec.editor, s); };
  return {
    structure,
    // Is the band shown on this task, and its position (CSS order).
    has: (task: string, band: string) => !!structure[task]?.includes(band),
    style: (task: string, band: string): CSSProperties => ({ order: structure[task]?.indexOf(band) ?? 0 }),
    openConfig: (task: string) => setOpen(task),
    dialog: open === null ? null : (
      <RibbonConfigDialog spec={spec} structure={structure} task={open} setTask={setOpen}
        onChange={set} onClose={() => setOpen(null)} />
    ),
  };
}

function RibbonConfigDialog(p: { spec: RibbonSpec; structure: RibbonStructure; task: string; setTask: (t: string) => void; onChange: (s: RibbonStructure) => void; onClose: () => void }) {
  const { spec, structure, task } = p;
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ band: string; fromTask: boolean } | null>(null);
  const bands = structure[task] ?? [];
  const apply = (r: RibbonResult) => { setError(r.error ?? null); if (!r.error) p.onChange(r.structure); };
  const title = (id: string) => spec.bands[id] ?? id;
  const chip = (id: string, inTask: boolean, extra?: ReactNode) => (
    <span key={id} draggable className="rib-chip" data-testid={`${inTask ? 'rib-band' : 'rib-palette'}-${id}`}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', id); setDrag({ band: id, fromTask: inTask }); }}
      onDragEnd={() => setDrag(null)}
      onDragOver={inTask ? (e) => e.preventDefault() : undefined}
      onDrop={inTask ? (e) => {
        e.preventDefault(); e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const band = drag?.band ?? e.dataTransfer.getData('text/plain');
        if (band) apply(dropBand(structure, task, band, id, e.clientX > r.left + r.width / 2));
        setDrag(null);
      } : undefined}
      style={{ display: 'inline-flex', gap: 4, alignItems: 'center', border: '1px solid #b8c0cf', borderRadius: 3, padding: '2px 6px', margin: 2, background: inTask ? '#eef3fb' : '#fff', cursor: 'grab' }}>
      {title(id)}{extra}
    </span>
  );
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal" role="dialog" aria-label="Ribbon Configuration" data-testid={`ribbon-config-${spec.editor}`} style={{ width: 'min(720px, 96vw)' }}>
        <div className="modal-head"><b>Ribbon Configuration</b><button onClick={p.onClose} aria-label="Close" data-testid="rib-close-x">x</button></div>
        <div className="modal-body">
          <p className="muted" style={{ whiteSpace: 'pre-line', margin: '0 0 6px' }}>{RIBBON_MESSAGES.prompt}</p>
          <div className="row">
            Task <select value={task} onChange={(e) => { setError(null); p.setTask(e.target.value); }} data-testid="rib-task">
              {Object.keys(structure).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <fieldset data-testid="rib-task-bands" onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const band = drag?.band; if (band && !drag?.fromTask) apply(addBand(structure, task, band)); setDrag(null); }}>
            <legend>Bands on {task} (drop here to add; drag onto a band to place it before or after)</legend>
            {bands.map((id, i) => chip(id, true, <>
              <button className="link" title="Move left" disabled={i === 0} onClick={() => apply(dropBand(structure, task, id, bands[i - 1], false))} data-testid={`rib-left-${id}`}>&lt;</button>
              <button className="link" title="Move right" disabled={i === bands.length - 1} onClick={() => apply(dropBand(structure, task, id, bands[i + 1], true))} data-testid={`rib-right-${id}`}>&gt;</button>
              <button className="link" title="Remove this band from the current task." onClick={() => apply(removeBand(structure, task, id))} data-testid={`rib-remove-${id}`}>Remove</button>
            </>))}
          </fieldset>
          <fieldset data-testid="rib-palette" onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (drag?.fromTask) apply(removeBand(structure, task, drag.band)); setDrag(null); }}>
            <legend>All bands (drag onto the task to add; drag a task band here to remove it)</legend>
            {Object.keys(spec.bands).map((id) => chip(id, false, <button className="link" title="Add Band" onClick={() => apply(addBand(structure, task, id))} data-testid={`rib-add-${id}`}>Add</button>))}
          </fieldset>
          {error && <p className="error" data-testid="rib-error">{error}</p>}
          <div className="row">
            <button data-testid="rib-defaults" title="Applies the default ribbon configuration, discarding all user modifications."
              onClick={() => { if (!window.confirm(RIBBON_MESSAGES.setDefaultsConfirm)) return; clearPrefs(spec.editor); setError(null); p.onChange(structuredClone(spec.defaults)); }}>Apply defaults</button>
            {spec.canCommit && <button data-testid="rib-commit" title="Copy the current configuration to your preference file and use it in new workspaces."
              onClick={() => { if (window.confirm(RIBBON_MESSAGES.commitConfirm)) commitToPrefs(spec.editor, structure); }}>Commit to Preferences</button>}
            <button data-testid="rib-close" onClick={p.onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
