// Host for the experiment platforms added by docs/validation/ui-gaps/platforms.md:
// Plate Editor, Compare Populations, 3D Viewer, Create Calibration Parameter
// and FCS Scan. App.tsx opens one through a single dialog kind.
import { useState } from 'react';
import type { SampleState, StatColumn, Workspace } from '../core/model';
import type { SampleMeta } from '../core/service';
import { parseText } from '../core/fcs';
import { calibrationFormula, calibrationName, fitCalibration } from '../core/calibration';
import { derivedNameError } from '../core/formula';
import { sampleChannels, withStains } from './axes';
import type { createAnalysisClient } from './workerClient';
import { PlateEditor } from './PlateEditor';
import { CompareDialog } from './Compare';
import { ThreeDViewer } from './ThreeD';

export type PlatformTool = 'plate' | 'compare' | 'threeD' | 'calibration' | 'fcsScan';
type Say = (level: 'info' | 'warn' | 'error', text: string) => void;
export interface ToolCtx {
  ws: Workspace;
  meta: Record<string, SampleMeta>;
  client: ReturnType<typeof createAnalysisClient>;
  sample: SampleState | null;
  popId: string | null;
  groupId: string;
  updateWs: (fn: (w: Workspace, say: Say) => void) => void;
  download: (name: string, data: string, type: string) => void;
  downloadBlob: (name: string, data: Blob) => void;
  addFiles: (files: File[]) => void;
  onClose: () => void;
}

export function PlatformToolHost(p: ToolCtx & { tool: PlatformTool }) {
  if (p.tool === 'plate') {
    const stats = async (s: SampleState, col: StatColumn, scales: Record<string, import('../core/flowjoStats').ChannelScale>) => (await p.client.stats({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: p.ws.matrices, derived: p.ws.derivedParameters, columns: [col], kinetics: p.ws.kinetics, scales }))[0];
    return <PlateEditor ws={p.ws} groups={p.ws.groups} currentGroupId={p.groupId} loaded={(id) => !!p.meta[id]} stats={stats} updateWs={p.updateWs} download={p.download} onClose={p.onClose} />;
  }
  if (p.tool === 'fcsScan') return <FcsScanDialog {...p} />;
  if (!p.sample || !p.meta[p.sample.id]) return <Notice title="Platforms" text="Select a loaded sample first." onClose={p.onClose} />;
  if (p.tool === 'compare') return <CompareDialog {...p} />;
  if (p.tool === 'threeD') return <ThreeDViewer {...p} />;
  return <CalibrationDialog {...p} />;
}

function Notice(p: { title: string; text: string; onClose: () => void }) {
  return <div className="modal-bg"><div className="modal" role="dialog" aria-label={p.title}><div className="modal-head"><b>{p.title}</b><button onClick={p.onClose}>x</button></div><div className="modal-body"><p>{p.text}</p></div></div></div>;
}

// Create Calibration Parameter: own rule (FlowJo 10.6.2 has no handler), see
// src/core/calibration.ts.
function CalibrationDialog(p: ToolCtx) {
  const s = p.sample!;
  const channels = sampleChannels(withStains(p.meta[s.id], s.stains), s.compensation, p.ws.matrices, p.ws.derivedParameters).map((c) => c.name);
  const [channel, setChannel] = useState(channels.find((c) => !/^(FSC|SSC|Time)/i.test(c)) ?? channels[0] ?? '');
  const [peaks, setPeaks] = useState(() => Array.from({ length: 4 }, () => ({ mfi: NaN, mesf: NaN })));
  const fit = fitCalibration(peaks);
  const name = calibrationName(channel);
  const nameErr = derivedNameError(name, [...channels, ...(p.ws.derivedParameters ?? []).map((d) => d.name)]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal" role="dialog" aria-label="Create Calibration Parameter" data-testid="calib-dialog">
        <div className="modal-head"><b>Define Calibrated Parameter</b><button onClick={p.onClose} aria-label="Close">x</button></div>
        <div className="modal-body">
          <p className="muted">This window enables you to create a new parameter that is calibrated to a known standard (MESF beads). Enter each bead peak's measured intensity and its known MESF value.</p>
          <label>Parameter <select value={channel} onChange={(e) => setChannel(e.target.value)} data-testid="calib-channel">{channels.map((c) => <option key={c}>{c}</option>)}</select></label>
          <table className="grid"><thead><tr><th>Peak</th><th>Intensity (MFI)</th><th>Known MESF values</th></tr></thead><tbody>
            {peaks.map((pk, i) => <tr key={i}><td>{i + 1}</td>
              <td><input type="number" value={Number.isNaN(pk.mfi) ? '' : pk.mfi} onChange={(e) => setPeaks((x) => x.map((y, k) => (k === i ? { ...y, mfi: e.target.value === '' ? NaN : Number(e.target.value) } : y)))} data-testid={`calib-mfi-${i}`} style={{ width: 90 }} /></td>
              <td><input type="number" value={Number.isNaN(pk.mesf) ? '' : pk.mesf} onChange={(e) => setPeaks((x) => x.map((y, k) => (k === i ? { ...y, mesf: e.target.value === '' ? NaN : Number(e.target.value) } : y)))} data-testid={`calib-mesf-${i}`} style={{ width: 90 }} /></td></tr>)}
          </tbody></table>
          <button onClick={() => setPeaks((x) => [...x, { mfi: NaN, mesf: NaN }])} data-testid="calib-add-peak">Add peak</button>
          <p data-testid="calib-fit">{fit ? <>Slope: {fit.slope.toFixed(4)} - Intercept: {fit.intercept.toFixed(4)} - Correlation Coefficient: {fit.r.toFixed(5)}</> : 'Enter at least two peaks with positive values.'}</p>
          {fit && <p className="muted" data-testid="calib-formula">{name} = {calibrationFormula(channel, fit)}</p>}
          {nameErr && fit && <p className="error">{nameErr}</p>}
          <button disabled={!fit || !!nameErr} data-testid="calib-define" onClick={() => { p.updateWs((w, say) => { w.derivedParameters = [...(w.derivedParameters ?? []), { name, formula: calibrationFormula(channel, fit!) }]; say('info', `Calibration parameter ${name} created`); }); p.onClose(); }}>Define</button>
        </div>
      </div>
    </div>
  );
}

// FCS Scan: own web equivalent of FlowJo's folder scan (FCSScanController):
// pick a folder (or files), list every FCS file with keywords, find by text,
// add the selected files to the workspace or save the list as a spreadsheet.
interface ScanRow { file: File; path: string; kw: Record<string, string>; error?: string }
export async function readFcsKeywords(file: Blob): Promise<Record<string, string>> {
  const head = new TextDecoder('latin1').decode(new Uint8Array(await file.slice(0, 58).arrayBuffer()));
  if (!/^FCS\d\.\d/.test(head)) throw new Error('Not an FCS file');
  const a = parseInt(head.slice(10, 18), 10), b = parseInt(head.slice(18, 26), 10);
  if (!(a > 0 && b >= a)) throw new Error('Bad TEXT offsets');
  return parseText(new Uint8Array(await file.slice(a, b + 1).arrayBuffer()), []);
}
const SCAN_COLS = ['$FIL', '$DATE', '$TOT', '$PAR', '$CYT', '$SRC'];
function FcsScanDialog(p: ToolCtx) {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [cols, setCols] = useState(SCAN_COLS);
  const [find, setFind] = useState('');
  const [dups, setDups] = useState(true);
  const [sel, setSel] = useState<number[]>([]);
  const [newCol, setNewCol] = useState('');
  const scan = async (files: FileList | null) => {
    if (!files) return;
    const out: ScanRow[] = [];
    for (const f of Array.from(files)) {
      if (!/\.(fcs|lmd)$/i.test(f.name)) continue;
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      try { out.push({ file: f, path, kw: await readFcsKeywords(f) }); } catch (e) { out.push({ file: f, path, kw: {}, error: (e as Error).message }); }
    }
    setRows(out);
    setSel([]);
  };
  const seen = new Set<string>();
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => {
    const key = `${r.kw.$FIL ?? r.file.name}|${r.kw.$TOT ?? ''}|${r.file.size}`;
    const dup = seen.has(key);
    seen.add(key);
    if (!dups && dup) return false;
    const q = find.trim().toLowerCase();
    return !q || r.path.toLowerCase().includes(q) || Object.values(r.kw).some((v) => v.toLowerCase().includes(q));
  });
  const csv = () => [['Path', ...cols].join(','), ...shown.filter(({ i }) => !sel.length || sel.includes(i)).map(({ r }) => [r.path, ...cols.map((c) => r.kw[c] ?? '')].map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','))].join('\n') + '\n';
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal layout" role="dialog" aria-label="FCS Scan" data-testid="fcsscan-dialog">
        <div className="modal-head"><b>FCS Scan</b><button onClick={p.onClose} aria-label="Close">x</button></div>
        <div className="modal-body">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="file-btn" title="List the FCS files in a folder">Choose folder...<input type="file" multiple data-testid="fcsscan-folder" {...{ webkitdirectory: '' }} onChange={(e) => void scan(e.target.files)} /></label>
            <label className="file-btn">Choose files...<input type="file" multiple accept=".fcs,.lmd" data-testid="fcsscan-files" onChange={(e) => void scan(e.target.files)} /></label>
            <label>Find: <input value={find} onChange={(e) => setFind(e.target.value)} data-testid="fcsscan-find" /></label>
            <label title="Select this box to show all duplicates files."><input type="checkbox" checked={dups} onChange={(e) => setDups(e.target.checked)} data-testid="fcsscan-dups" />Show duplicates</label>
            <input placeholder="Keyword" value={newCol} onChange={(e) => setNewCol(e.target.value)} style={{ width: 90 }} data-testid="fcsscan-kw" />
            <button disabled={!newCol || cols.includes(newCol)} onClick={() => { setCols([...cols, newCol]); setNewCol(''); }} data-testid="fcsscan-add-kw" title="Add keywords associated with the file your looking for.">Add keywords</button>
            <button onClick={() => setCols(SCAN_COLS)} data-testid="fcsscan-reset-kw">Reset keywords</button>
            <button disabled={!sel.length} onClick={() => { p.addFiles(rows.filter((_, i) => sel.includes(i)).map((r) => r.file)); p.onClose(); }} data-testid="fcsscan-to-ws" title="Saves selected files to a workspace.">Save to workspace</button>
            <button disabled={!shown.length} onClick={() => p.download('fcs-scan.csv', csv(), 'text/csv')} data-testid="fcsscan-to-csv" title="Saves selected files to a spreadsheet.">Save to spreadsheet</button>
          </div>
          {!rows.length && <p className="muted">Choose a folder (or files) to list the FCS files in it.</p>}
          <table className="grid" data-testid="fcsscan-table"><thead><tr><th><input type="checkbox" checked={!!shown.length && shown.every(({ i }) => sel.includes(i))} onChange={(e) => setSel(e.target.checked ? shown.map(({ i }) => i) : [])} data-testid="fcsscan-all" /></th><th>Path</th>{cols.map((c) => <th key={c}>{c} {!SCAN_COLS.includes(c) && <button className="x" onClick={() => setCols(cols.filter((x) => x !== c))} title="Removes keyword from the search criteria.">x</button>}</th>)}</tr></thead>
            <tbody>{shown.map(({ r, i }) => <tr key={i} data-testid={`fcsscan-row-${i}`}><td><input type="checkbox" checked={sel.includes(i)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, i] : s.filter((x) => x !== i)))} /></td><td>{r.path}{r.error && <span className="error"> ({r.error})</span>}</td>{cols.map((c) => <td key={c}>{r.kw[c] ?? ''}</td>)}</tr>)}</tbody></table>
          {rows.length > 0 && !sel.length && <p className="muted">No files are selected.</p>}
        </div>
      </div>
    </div>
  );
}
