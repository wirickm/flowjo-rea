// FlowJo 10.6.2 follow-up formats (docs/validation/ui-gaps/workspace.md
// section O): Import from / Export to FACSDiva (src/core/diva.ts), Import
// Parameters from CSV/CLR (src/core/paramImport.ts), Consensus Gate and
// Cluster Frequency (src/core/clusterParams.ts). Rules live in src/core.
import { useState } from 'react';
import { divaFcsFiles, divaWorksheetTemplates, exportDiva, importDiva } from '../core/diva';
import { encodeColumn, importBaseName, importKind, parseParameterFile } from '../core/paramImport';
import { clusterParamName, clusterSelectionError } from '../core/clusterParams';
import { populationPath, type DerivedParameter, type SampleState, type Workspace } from '../core/model';

interface Props {
  ws: Workspace;
  updateWs: (f: (w: Workspace) => void) => void;
  sample: SampleState | null;
  counts?: Record<string, number>;
  download: (name: string, data: BlobPart, type?: string) => void;
  note: (level: 'info' | 'warn' | 'error', text: string) => void;
}

const readText = (f: File) => f.text();

// File tab: Import from FACSDiva, Export to FACSDiva, Import Parameters from CSV/CLR.
export function FormatFileButtons(p: Props) {
  const { ws, updateWs, sample, note } = p;
  const [imp, setImp] = useState<null | { xml: string; worksheets: string[]; files: string[]; worksheet: string; fcs: string; paramsOnly: boolean; correct: boolean }>(null);
  const [exp, setExp] = useState<null | { xml: string | null; name: string; selected: string[]; applyAll: boolean; correct: boolean }>(null);

  const openImport = async (f: File) => {
    try {
      const xml = await readText(f);
      const worksheets = divaWorksheetTemplates(xml), files = divaFcsFiles(xml);
      setImp({ xml, worksheets, files, worksheet: worksheets[0] ?? '', fcs: files.find((x) => x === sample?.fileName) ?? files[0] ?? '', paramsOnly: false, correct: false });
    } catch (e) { note('error', (e as Error).message); }
  };
  const doImport = () => {
    if (!imp || !sample) return;
    try {
      const r = importDiva(imp.xml, { worksheet: imp.worksheet, fcsFile: imp.fcs, sampleName: sample.fileName, paramSettingsOnly: imp.paramsOnly, correctScatter: imp.correct });
      updateWs((w) => {
        const s = w.samples.find((x) => x.id === sample.id);
        if (!s) return;
        if (r.matrix) { w.matrices.push(r.matrix); s.compensation = r.matrix.id; }
        s.populations.push(...r.populations);
        for (const [ch, t] of Object.entries(r.transforms)) if (s.channelNames.includes(ch) || !s.channelNames.length) w.channelTransforms[ch] = t;
      });
      for (const m of r.warnings) note('warn', m);
      note('info', `Imported ${r.populations.length} gates${r.matrix ? ' and compensation' : ''} from FACSDiva`);
      setImp(null);
    } catch (e) { note('error', (e as Error).message); }
  };
  const doExport = () => {
    if (!exp?.xml || !sample) return;
    try {
      const matrix = ws.matrices.find((m) => m.id === sample.compensation) ?? null;
      const r = exportDiva(exp.xml, { sample, transforms: ws.channelTransforms, matrix, selected: exp.selected, counts: p.counts, experimentName: exp.name, applyToAll: exp.applyAll, correctScatter: exp.correct });
      for (const m of r.messages) note('warn', m);
      p.download(`${exp.name}.xml`, r.xml, 'application/xml');
      note('info', 'Export Completed');
      setExp(null);
    } catch (e) { note('error', (e as Error).message); }
  };
  const importParams = async (f: File) => {
    if (!sample) return;
    const kind = importKind(f.name);
    if (!kind) { note('error', 'Choose a parameter file (*.csv, *.clr)'); return; }
    try {
      const r = parseParameterFile(await readText(f), kind, importBaseName(f.name, sample.fileName), sample.eventCount);
      updateWs((w) => {
        const list = [...(w.derivedParameters ?? [])];
        r.names.forEach((name, i) => {
          const k = list.findIndex((d) => d.name === name);
          const prev = k >= 0 && 'imported' in list[k] ? (list[k] as Extract<DerivedParameter, { imported: unknown }>).imported.data : {};
          const d: DerivedParameter = { name, imported: { source: kind, file: f.name, range: r.range, data: { ...prev, [sample.id]: encodeColumn(r.columns[i]) } } };
          if (k >= 0) list[k] = d; else list.push(d);
          w.channelTransforms[name] = { kind: 'linear', T: r.range, A: 0 };
        });
        w.derivedParameters = list;
      });
      note('info', `Imported ${r.names.join(', ')} from ${f.name}`);
    } catch (e) { note('error', (e as Error).message); }
  };

  return (
    <>
      <label className="file-btn" title="Import gates and compensation from a FACSDiva experiment">Import from FACSDiva<input type="file" accept=".xml" disabled={!sample} data-testid="import-diva" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openImport(f); e.target.value = ''; }} /></label>
      <button disabled={!sample} data-testid="export-diva" title="Export gates and compensation to a FACSDiva experiment" onClick={() => setExp({ xml: null, name: 'FlowJo Export', selected: sample!.populations.filter((x) => x.gate.type !== 'quadrant').map((x) => x.id), applyAll: false, correct: false })}>Export to FACSDiva</button>
      <label className="file-btn" title="Import Parameters from CSV/CLR...: per-event values for the selected sample">Import Parameters from CSV/CLR...<input type="file" accept=".csv,.clr" disabled={!sample} data-testid="import-csv-clr" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importParams(f); e.target.value = ''; }} /></label>
      {imp && (
        <div className="modal-bg"><div className="modal" role="dialog" aria-label="Import from FACSDiva" data-testid="diva-import-dialog"><div className="modal-body">
          <h3>Import from FACSDiva</h3>
          <label>Worksheet <select data-testid="diva-import-worksheet" value={imp.worksheet} onChange={(e) => setImp({ ...imp, worksheet: e.target.value })}>{imp.worksheets.map((w) => <option key={w}>{w}</option>)}</select></label><br />
          <label>FCS file <select data-testid="diva-import-fcs" value={imp.fcs} onChange={(e) => setImp({ ...imp, fcs: e.target.value })}>{imp.files.map((w) => <option key={w}>{w}</option>)}</select></label><br />
          <label><input type="checkbox" data-testid="diva-import-params-only" checked={imp.paramsOnly} onChange={(e) => setImp({ ...imp, paramsOnly: e.target.checked })} /> Import parameter settings only</label><br />
          <label><input type="checkbox" data-testid="diva-import-correct" checked={imp.correct} onChange={(e) => setImp({ ...imp, correct: e.target.checked })} /> Correct height and width scatter parameters for Diva</label><br />
          <button data-testid="diva-import-ok" disabled={!imp.worksheet || !imp.fcs} onClick={doImport}>Import from FACS Diva</button>
          <button onClick={() => setImp(null)}>Cancel</button>
        </div></div></div>
      )}
      {exp && sample && (
        <div className="modal-bg"><div className="modal" role="dialog" aria-label="Export to FACSDiva" data-testid="diva-export-dialog"><div className="modal-body">
          <h3>Export to FACSDiva</h3>
          <p className="muted">The exported experiment will be a modified copy of an existing experiment. The existing experiment must already include the fcs file that you are exporting gates for.</p>
          <label className="file-btn">Select the Diva experiment to modify<input type="file" accept=".xml" data-testid="diva-export-input" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const xml = await readText(f); setExp((x) => (x ? { ...x, xml } : x)); } e.target.value = ''; }} /></label>
          <span data-testid="diva-export-input-state">{exp.xml ? ' experiment loaded' : ' no experiment chosen'}</span><br />
          <label>New FACSDiva experiment name <input data-testid="diva-export-name" value={exp.name} onChange={(e) => setExp({ ...exp, name: e.target.value })} /></label>
          <div>Select the gates to export:</div>
          <div style={{ maxHeight: 160, overflow: 'auto' }}>
            {sample.populations.filter((x) => x.gate.type !== 'quadrant').map((x) => (
              <label key={x.id} style={{ display: 'block' }}><input type="checkbox" data-testid={`diva-export-pop-${x.name}`} checked={exp.selected.includes(x.id)} onChange={(e) => setExp({ ...exp, selected: e.target.checked ? [...exp.selected, x.id] : exp.selected.filter((y) => y !== x.id) })} /> {populationPath(sample.populations, x.id)}</label>
            ))}
          </div>
          <label><input type="checkbox" data-testid="diva-export-all" checked={exp.applyAll} onChange={(e) => setExp({ ...exp, applyAll: e.target.checked })} /> Apply compensation and scaling to all files in experiment</label><br />
          <label><input type="checkbox" data-testid="diva-export-correct" checked={exp.correct} onChange={(e) => setExp({ ...exp, correct: e.target.checked })} /> Correct height and width scatter parameters for Diva</label><br />
          <button data-testid="diva-export-ok" disabled={!exp.xml || !exp.name.trim()} onClick={doExport}>Export to FACS Diva</button>
          <button onClick={() => setExp(null)}>Cancel</button>
        </div></div></div>
      )}
    </>
  );
}

// Workspace tab: Consensus Gate and Cluster Frequency from the selected
// populations of the current sample (focused population = primary).
export function ClusterParamButtons(p: Props & { focused: string | null; selected: string[] }) {
  const make = (type: 'consensus' | 'clusterFrequency') => {
    const s = p.sample;
    if (!s) return;
    const ids = type === 'consensus'
      ? [...new Set([...p.selected, ...(p.selected.length ? [] : p.focused ? [p.focused] : [])])]
      : p.focused ? [p.focused, ...p.selected.filter((x) => x !== p.focused)] : [];
    const err = clusterSelectionError(type, ids.length);
    if (err) { p.note('warn', err); return; }
    const pops = ids.map((id) => s.populations.find((x) => x.id === id)!).filter(Boolean);
    const name = clusterParamName(type, pops.map((x) => x.name));
    p.updateWs((w) => {
      const list = (w.derivedParameters ?? []).filter((d) => d.name !== name);
      list.push({ name, gateDerived: { type, sampleId: s.id, populations: pops.map((x) => x.id) } });
      w.derivedParameters = list;
      w.channelTransforms[name] = { kind: 'linear', T: type === 'consensus' ? 1 : 4096, A: 0 };
    });
    p.note('info', `Created derived parameter ${name}`);
  };
  return (
    <>
      <button disabled={!p.sample} data-testid="consensus-dp" title="Creates a derived parameter for the value for each event is the probability that the event was included across all of the selected populations." onClick={() => make('consensus')}>Consensus Gate</button>
      <button disabled={!p.sample} data-testid="cluster-freq-dp" title="Creates a derived parameter for the value for each event is the probability that the event was in the gold standard population." onClick={() => make('clusterFrequency')}>Cluster Frequency</button>
    </>
  );
}
