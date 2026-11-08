// Annotate Experiment... (WSCommand.MIFlowCyt / MIFLOW, MIFlowCytDialog;
// spec docs/validation/ui-gaps/workspace.md). Tabs Overview, Specimen,
// Instrument, Analysis, Figures (ws.anno.nav.0-4); OK stores the annotation in
// the workspace (Workspace.setMetaData), Open / Save As read and write a
// MIFlowCyt XML file, Print shows the HTML summary, Save to Preferences as
// Default keeps it as the start value for workspaces without one.
import { useState } from 'react';
import { ANALYSIS_FIELDS, experimentHtml, experimentXml, INSTRUMENT_FIELDS, LONG_FIELDS, newExperiment, OVERVIEW_FIELDS, readExperiment, SPECIMEN_FIELDS, type Experiment } from '../core/miflowcyt';
import { parseXml } from '../core/xml';

export const MIFLOWCYT_PREF = 'flowjo-rea.miflowcyt';
// WSController.openMIFlowCytDialog: the workspace annotation when it has
// content, otherwise the preference default (FJPrefs.getMIFlowCyt).
export function initialExperiment(ws: Experiment | undefined): Experiment {
  if (ws) return structuredClone(ws);
  try { const s = localStorage.getItem(MIFLOWCYT_PREF); if (s) return readExperiment(parseXml(s).documentElement); } catch { /* no preference */ }
  return newExperiment();
}

type Section = 'fields' | 'specimen' | 'instrument' | 'analysis';
const TABS: [string, Section | 'figures', [string, string][]][] = [['Overview', 'fields', OVERVIEW_FIELDS], ['Specimen', 'specimen', SPECIMEN_FIELDS], ['Instrument', 'instrument', INSTRUMENT_FIELDS], ['Analysis', 'analysis', ANALYSIS_FIELDS], ['Figures', 'figures', []]];

export function ExperimentDialog(p: { initial: Experiment | undefined; docName: string; groupNames: string[]; gatingText: () => string; compText: () => string; figureNames: string[]; onOk: (e: Experiment) => void; download: (name: string, data: string, type: string) => void; onClose: () => void }) {
  const [e, setE] = useState<Experiment>(() => initialExperiment(p.initial));
  const [tab, setTab] = useState(0);
  const [msg, setMsg] = useState('');
  const set = (sec: Section, k: string, v: string) => setE((x) => ({ ...x, [sec]: { ...x[sec], [k]: v } }));
  const append = (sec: Section, k: string, v: string) => set(sec, k, `${e[sec][k] ? `${e[sec][k]}\n` : ''}${v}`);
  const [, sec, fields] = TABS[tab];
  const open = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xml';
    inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { const root = parseXml(await f.text()).documentElement; setE(readExperiment(root.localName === 'experiment' ? root : root.querySelector('experiment') ?? root)); setMsg(`Opened ${f.name}`); } catch (err) { setMsg((err as Error).message); } };
    inp.click();
  };
  return (
    <div className="modal-bg" onMouseDown={(ev) => ev.target === ev.currentTarget && p.onClose()}>
      <div className="modal wide" role="dialog" aria-label="Annotate Experiment" data-testid="miflow-dialog">
        <div className="modal-head"><b>Annotate Experiment (MIFlowCyt)</b><button onClick={p.onClose} aria-label="Close">x</button></div>
        <div className="modal-body">
          <p className="muted">High-level descriptions of cytometry experiments are being developed as per the <i>MIFlowCyt</i> recommendations. These annotations are important to the initiatives in data sharing within the flow cytometry community.</p>
          <div className="row">{TABS.map(([l], i) => <button key={l} className={i === tab ? 'active' : ''} onClick={() => setTab(i)} data-testid={`miflow-tab-${l}`}>{l}</button>)}</div>
          {sec !== 'figures' ? <table className="grid"><tbody>{fields.map(([k, l]) => <tr key={k}><th style={{ textAlign: 'left' }}>{l}</th><td>
            {LONG_FIELDS.has(k) ? <textarea rows={3} cols={60} value={e[sec][k] ?? ''} onChange={(ev) => set(sec, k, ev.target.value)} data-testid={`miflow-${k}`} /> : <input size={50} value={e[sec][k] ?? ''} onChange={(ev) => set(sec, k, ev.target.value)} data-testid={`miflow-${k}`} />}
          </td></tr>)}</tbody></table> : <div>
            <table className="grid" data-testid="miflow-figures"><thead><tr><th>Name</th><th>Type</th><th>Description</th><th /></tr></thead><tbody>{e.figures.map((f, i) => <tr key={i}>
              <td><input value={f.id} onChange={(ev) => setE({ ...e, figures: e.figures.map((x, k) => (k === i ? { ...x, id: ev.target.value } : x)) })} /></td><td>{f.mimetype}</td>
              <td><input size={40} value={f.description} onChange={(ev) => setE({ ...e, figures: e.figures.map((x, k) => (k === i ? { ...x, description: ev.target.value } : x)) })} data-testid={`miflow-fig-desc-${i}`} /></td>
              <td><button onClick={() => setE({ ...e, figures: e.figures.filter((_, k) => k !== i) })}>Remove</button></td></tr>)}</tbody></table>
            <select value="" onChange={(ev) => ev.target.value && setE({ ...e, figures: [...e.figures, { id: ev.target.value, mimetype: 'image/png', description: '' }] })} data-testid="miflow-add-figure"><option value="">Add figure...</option>{p.figureNames.map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </div>}
          {sec === 'analysis' && <div className="row">
            <button onClick={() => set('analysis', 'groups', p.groupNames.join('\n'))} data-testid="miflow-autofill-groups" title="Fill Grouping with the workspace's groups">Auto-fill groups</button>
            <button onClick={() => append('analysis', 'gating', p.gatingText())} data-testid="miflow-append-gating" title="Append the gating tree of the selected sample">Append gating tree of selected sample</button>
          </div>}
          {sec === 'instrument' && <button onClick={() => append('instrument', 'compensation', p.compText())} data-testid="miflow-append-comp" title="Append the compensation matrix of the selected sample">Append compensation of selected sample</button>}
          {msg && <p className="muted" data-testid="miflow-msg">{msg}</p>}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button onClick={() => setTab(Math.max(0, tab - 1))} disabled={!tab}>Previous</button>
            <button onClick={() => setTab(Math.min(TABS.length - 1, tab + 1))} disabled={tab === TABS.length - 1}>Next</button>
            <button onClick={open} data-testid="miflow-open" title="Open a MIFlowCyt XML file">Open...</button>
            <button onClick={() => p.download(`${p.docName} Summary.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n${experimentXml(e)}\n`, 'application/xml')} data-testid="miflow-save-as">Save As...</button>
            <button onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(experimentHtml(e)); w.document.close(); w.print(); } }} data-testid="miflow-print">Print...</button>
            <button onClick={() => { try { localStorage.setItem(MIFLOWCYT_PREF, experimentXml(e)); setMsg('Saved to preferences as the default annotation'); } catch { setMsg('Preferences are not available'); } p.onOk(e); }} data-testid="miflow-save-prefs">Save to Preferences as Default</button>
            <button onClick={() => p.onOk(e)} data-testid="miflow-ok">OK</button>
            <button onClick={p.onClose} data-testid="miflow-cancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
