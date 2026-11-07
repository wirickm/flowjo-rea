import { useEffect, useRef, useState } from 'react';
import { invert, isSpectral, parseSpilloverCsv, unmixingOperator, validateMatrix, type SpilloverMatrix } from '../core/compensation';
import { describeTransform, makeTransform, type TransformSpec } from '../core/transforms';
import type { SampleMeta } from '../core/service';
import type { WizardResult } from '../core/compWizard';
import { withAutofluorescence } from '../core/autofluorescence';
import { derivedFormula, type DerivedParameter, type SampleState } from '../core/model';
import { findKeywords, type FindHit } from '../core/project';
import { compileFormula, defaultDerivedName, derivedNameError, EVENT_NUMBER, FORMULA_FUNCTIONS } from '../core/formula';
import { specForKind } from './axes';
import { readMtx, ssmCsv, writeMatrixCsv, writeMtx, type FlowjoWizardResult } from '../core/compFlowjo';
import { animationScales, compareMatrices, DEFAULT_ZOOM, duplicateMatrix, fitZoom, fromDisplay, identityMatrix, loadCompPrefs, removeUnusedParameters, saveCompPrefs, scaleLabel, scaleSpillover, ssmWithSums, toDisplay, zoomIn, zoomOut, type CompPrefs, type CompView } from '../core/compEditor';
import { CompPlotGrid, MATRIX_DRAG_TYPE, WeightsPanel } from './CompEditor';

function saveText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Modal(p: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className={`modal ${p.wide ? 'wide' : ''}`} role="dialog" aria-label={p.title}>
        <div className="modal-head">
          <b>{p.title}</b>
          <button onClick={p.onClose} aria-label="Close">x</button>
        </div>
        <div className="modal-body">{p.children}</div>
      </div>
    </div>
  );
}

// onStain: edit a parameter's stain ($PnS), the name shown with the parameter
// on axes and in gate names (FlowJo edits it as a keyword; specs 18.1).
// allSamples: apply to every sample that has the parameter.
export function KeywordsDialog(p: { meta: SampleMeta; onClose: () => void; onStain?: (channel: string, stain: string, allSamples: boolean) => void }) {
  const [filter, setFilter] = useState('');
  const [allSamples, setAllSamples] = useState(true);
  const kws = Object.entries(p.meta.keywords).filter(([k, v]) => !filter || k.includes(filter.toUpperCase()) || v.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Modal title={`Sample: ${p.meta.fileName}`} onClose={p.onClose} wide>
      <p>
        {p.meta.version}, {p.meta.eventCount.toLocaleString()} events, {p.meta.channels.length} parameters, {p.meta.fileSize.toLocaleString()} bytes. SHA-256 {p.meta.fingerprint.slice(0, 16)}...
        {p.meta.datasetCount > 1 && ` File contains ${p.meta.datasetCount} data sets; showing data set 1.`}
      </p>
      {p.meta.warnings.length > 0 && (
        <div className="warn">
          <b>Parser warnings</b>
          <ul>{p.meta.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <h4>Parameters</h4>
      {p.onStain && (
        <p className="muted">
          Edit a $PnS stain to rename the parameter on axes ("name :: stain") and in new gate names.{' '}
          <label><input type="checkbox" checked={allSamples} onChange={(e) => setAllSamples(e.target.checked)} data-testid="stain-all" /> apply to all samples with this parameter</label>
        </p>
      )}
      <table className="grid">
        <thead><tr><th>#</th><th>$PnN</th><th>$PnS</th><th>Bits</th><th>Range</th><th>$PnE</th><th>$PnG</th></tr></thead>
        <tbody>
          {p.meta.channels.map((c) => (
            <tr key={c.index}><td>{c.index}</td><td>{c.name}</td><td>{p.onStain ? (
              <input
                key={c.label}
                defaultValue={c.label}
                aria-label={`Stain of ${c.name}`}
                data-testid={`stain-${c.name}`}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== c.label) p.onStain!(c.name, v, allSamples); }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : c.label}</td><td>{c.bits}</td><td>{c.range}</td><td>{c.logDecades},{c.logOffset}</td><td>{c.gain}</td></tr>
          ))}
        </tbody>
      </table>
      <h4>Keywords <input placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} /></h4>
      <table className="grid">
        <tbody>{kws.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
      </table>
    </Modal>
  );
}

const PARAMS: Record<string, string[]> = {
  linear: ['T', 'A'],
  log: ['T', 'M'],
  asinh: ['T', 'M', 'A'],
  logicle: ['T', 'W', 'M', 'A'],
  hyperlog: ['T', 'W', 'M', 'A'],
  'flowjo-biex': ['max', 'width', 'pos', 'neg', 'channelRange'],
  'flowjo-log': ['offset', 'decades'],
};

// channelTop: the channel's 0..$PnR top (1024 when missing), used when the
// current spec has no top of scale (specs 6.7).
export function TransformDialog(p: { channel: string; spec: TransformSpec; channelTop: number; onApply: (s: TransformSpec) => void; onClose: () => void }) {
  const [spec, setSpec] = useState<TransformSpec>(p.spec.kind === 'none' || p.spec.kind === 'scale' ? specForKind('linear', p.spec, p.channelTop) : p.spec);
  let error = '';
  try {
    makeTransform(spec);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <Modal title={`Scale for ${p.channel}`} onClose={p.onClose}>
      <label>
        Type{' '}
        <select value={spec.kind} onChange={(e) => setSpec(specForKind(e.target.value, spec, p.channelTop))} data-testid="transform-kind">
          {Object.keys(PARAMS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <div className="params">
        {PARAMS[spec.kind].map((k) => (
          <label key={k}>
            {k}{' '}
            <input
              type="number"
              step="any"
              value={(spec as unknown as Record<string, number>)[k]}
              onChange={(e) => setSpec({ ...spec, [k]: Number(e.target.value) } as TransformSpec)}
            />
          </label>
        ))}
      </div>
      <p className="muted">{describeTransform(spec)}. Applies to plot display of this channel in all samples; existing gates keep their own scale.</p>
      {error && <p className="error">{error}</p>}
      <button disabled={!!error} onClick={() => p.onApply(spec)}>Apply</button>
    </Modal>
  );
}

export function CompensationDialog(p: {
  matrices: SpilloverMatrix[];
  meta: SampleMeta | null;
  current: string;
  onSave: (m: SpilloverMatrix[]) => void;
  // scope: the current sample, the current group, every sample ('workspace')
  // or a named group ('group:<id>').
  onAssign: (ref: string, scope: 'sample' | 'group' | 'workspace' | `group:${string}`) => void;
  // Matrix Editor (MatrixEditorNavPanel): preview samples with their
  // population paths, the initial preview, groups to apply to, display scales
  // and the preview data source.
  samples?: { id: string; fileName: string; loaded: boolean; paths: string[] }[];
  preview?: { sampleId: string; path: string };
  groups?: { id: string; name: string }[];
  transformFor?: (ch: string) => TransformSpec | undefined;
  onPreview?: (sampleId: string, path: string, channels: string[]) => Promise<{ count: number; raw: Record<string, Float32Array>; missing: string[] }>;
  onClose: () => void;
  // Compensation wizard: candidate control samples (current group), channels
  // of the current sample, population paths usable as a pre-gate.
  controls: { id: string; fileName: string; loaded: boolean }[];
  channels: string[];
  gatePaths: string[];
  onWizard: (roles: { sampleId: string; primary: string | null }[], positivePct: number, gatePath: string) => Promise<WizardResult>;
  onEstimateAf: (sampleId: string, detectors: string[], gatePath: string) => Promise<number[]>;
  // FlowJo wizard: population paths per control sample, and the run.
  pathsBySample: Record<string, string[]>;
  onFlowjoWizard: (entries: { sampleId: string; primary: string; posPath: string | null; negSampleId: string; negPath: string | null }[]) => Promise<FlowjoWizardResult & { ssm: { channels: string[]; values: number[][] } }>;
}) {
  const [fj, setFj] = useState<Record<string, { primary: string; pos: string; neg: string }>>({});
  const [univ, setUniv] = useState('');
  const [fjRes, setFjRes] = useState<(FlowjoWizardResult & { ssm: { channels: string[]; values: number[][] } }) | null>(null);
  const [fjErr, setFjErr] = useState('');
  const [mats, setMats] = useState<SpilloverMatrix[]>(p.matrices);
  const [roles, setRoles] = useState<Record<string, string>>({}); // sampleId -> '' | 'unstained' | channel
  const [pct, setPct] = useState(10);
  const [gatePath, setGatePath] = useState('');
  const [diag, setDiag] = useState<WizardResult['diagnostics'] | null>(null);
  const [wizErr, setWizErr] = useState('');
  const [afControl, setAfControl] = useState('');
  const [afGate, setAfGate] = useState('');
  const [afErr, setAfErr] = useState('');
  const [selected, setSelected] = useState<string>(p.matrices[0]?.id ?? '');
  const [msg, setMsg] = useState('');
  // Matrix Editor state (MatrixController): parameter visibility, display
  // mode, preview, zoom, comparison, SSM view, weights, animation.
  const [prefs, setPrefsState] = useState<CompPrefs>(() => loadCompPrefs());
  const setPrefs = (x: CompPrefs) => { setPrefsState(x); saveCompPrefs(x); };
  const [showPrefs, setShowPrefs] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [identityPick, setIdentityPick] = useState<string[] | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [ssmView, setSsmView] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [view, setView] = useState<CompView>({ kind: 'nxn' });
  const [overlay, setOverlay] = useState(prefs.overlay);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pv, setPv] = useState(p.preview ?? { sampleId: p.samples?.[0]?.id ?? '', path: '' });
  const [pvData, setPvData] = useState<{ count: number; raw: Record<string, Float32Array>; missing: string[] } | null>(null);
  const [pvErr, setPvErr] = useState('');
  const [anim, setAnim] = useState(1);
  const [animating, setAnimating] = useState(false);
  const [applyGroup, setApplyGroup] = useState(p.groups?.[0]?.id ?? '');
  const [fjParams, setFjParams] = useState<string[]>(p.channels);
  const gridBox = useRef<HTMLDivElement>(null);
  const m = mats.find((x) => x.id === selected);
  const pvKey = m ? m.channels.join('|') : '';
  useEffect(() => {
    if (!p.onPreview || !m || !pv.sampleId) { setPvData(null); return; }
    let live = true;
    setPvErr('');
    p.onPreview(pv.sampleId, pv.path, m.channels).then((d) => live && setPvData(d), (e) => live && (setPvData(null), setPvErr((e as Error).message)));
    return () => { live = false; };
    // Re-read only when the preview or the matrix detectors change; edits to
    // values recompensate the cached events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pv.sampleId, pv.path, pvKey]);
  const outNames = m ? (isSpectral(m) ? m.outputNames ?? [] : m.channels) : [];
  const visible = (c: string) => showAll || !hidden.includes(c);
  const visibleOut = outNames.filter(visible);
  const saved = m ? p.matrices.find((x) => x.id === m.id) : undefined;
  const cmp = compareIds.length >= 2 ? compareMatrices(compareIds.map((id) => mats.find((x) => x.id === id)!).filter(Boolean)) : null;
  const status = cmp ? (cmp.error ?? `Displaying ${cmp.method} of ${compareIds.length} matrices`) : m ? (ssmView && m.ssm ? `Displaying SSM of matrix '${m.name}'` : `Displaying matrix '${m.name}'`) : 'Select one or more matrices';
  const setCell = (i: number, j: number, v: number) => {
    if (!m) return;
    const values = m.values.map((row) => [...row]);
    values[i][j] = v;
    setMats(mats.map((x) => (x.id === m.id ? { ...m, values } : x)));
  };
  const animate = async () => {
    setAnimating(true);
    for (const s of animationScales()) { setAnim(s); await new Promise((r) => setTimeout(r, 350)); }
    setAnim(1);
    setAnimating(false);
  };
  const pvSample = p.samples?.find((x) => x.id === pv.sampleId);
  let check = '';
  if (m) {
    try {
      if (p.meta) validateMatrix(m, p.meta.channels.map((c) => c.name)).forEach((w) => (check += w + '. '));
      if (isSpectral(m)) unmixingOperator(m);
      else invert(m.values);
      check = check || 'Matrix is valid and invertible.';
    } catch (e) {
      check = `Invalid: ${(e as Error).message}`;
    }
  }
  const add = (nm: SpilloverMatrix) => {
    setMats([...mats, nm]);
    setSelected(nm.id);
  };
  return (
    <Modal title="Compensation" onClose={p.onClose} wide>
      <p>
        Current sample uses: <b data-testid="comp-current">{p.current === 'none' ? 'Uncompensated' : p.current === 'file' ? 'File spillover keyword' : mats.find((x) => x.id === p.current)?.name ?? p.current}</b>
      </p>
      <div className="row">
        <button onClick={() => p.onAssign('none', 'sample')}>Uncompensated (sample)</button>
        <button disabled={!p.meta?.hasSpillover} title={p.meta?.hasSpillover ? '' : 'Sample has no spillover keyword'} onClick={() => p.onAssign('file', 'sample')}>Use file keyword (sample)</button>
        <button disabled={!p.meta?.hasSpillover} onClick={() => p.onAssign('file', 'group')}>Use file keyword (group)</button>
      </div>
      <div className="row">
        <button disabled={!p.meta?.spillover} onClick={() => add({ ...p.meta!.spillover!, id: `m_${Date.now().toString(36)}`, name: `Copy of ${p.meta!.fileName} spillover`, values: p.meta!.spillover!.values.map((r) => [...r]) })}>
          New matrix from file keyword
        </button>
        <label className="file-btn">
          Import matrix CSV
          <input
            type="file"
            accept=".csv,.txt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                add(parseSpilloverCsv(await f.text(), f.name));
                setMsg('');
              } catch (err) {
                setMsg((err as Error).message);
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <div className="row">
        <label className="file-btn">
          Load FlowJo matrix (.mtx)
          <input
            type="file"
            accept=".mtx,.xml"
            data-testid="mtx-load"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const m = readMtx(await f.text(), f.name.replace(/\.[^.]+$/, ''));
                add({ ...m, id: `m_${Date.now().toString(36)}` });
                setMsg('');
              } catch (err) {
                setMsg((err as Error).message);
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {msg && <p className="error">{msg}</p>}
      <details data-testid="fj-wizard">
        <summary>FlowJo compensation wizard (positive / negative populations)</summary>
        <p className="muted">As FlowJo 10: for each single-stain control pick its stained channel and its positive and negative populations (or a universal negative). Spillover = (median positive - median negative) in each detector / the same difference in the stained detector; populations need 100 events and 2% of their parent. Also gives the spillover spreading matrix (SSM).</p>
        <div className="row">
          Univ. Negative <select value={univ} onChange={(e) => setUniv(e.target.value)} data-testid="fj-univ">
            <option value="">none</option>
            {p.controls.flatMap((c) => (p.pathsBySample[c.id] ?? []).map((path) => <option key={`${c.id}|${path}`} value={`${c.id}|${path}`}>{c.fileName}: {path}</option>))}
          </select>
        </div>
        <details data-testid="fj-params">
          <summary>Parameter ({fjParams.length} of {p.channels.length})</summary>
          <p className="muted">The set of parameters for which to build the matrix (Choose Parameters). Unchecked parameters are left out.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {p.channels.map((ch) => <label key={ch}><input type="checkbox" data-testid={`fj-param-${ch}`} checked={fjParams.includes(ch)} onChange={(e) => setFjParams(e.target.checked ? p.channels.filter((c) => c === ch || fjParams.includes(c)) : fjParams.filter((c) => c !== ch))} /> {ch}</label>)}
          </div>
          <div className="row">
            <button data-testid="fj-remove-unused" title="Remove all parameters that have no samples." onClick={() => setFjParams(removeUnusedParameters(fjParams, Object.values(fj).map((v) => v.primary).filter(Boolean)))}>Remove Unused Parameters</button>
            <button data-testid="fj-reset-params" title="Recalculate with the full parameter set." onClick={() => setFjParams(p.channels)}>Reset All</button>
          </div>
        </details>
        <table className="grid">
          <thead><tr><th>Control</th><th>Stained channel</th><th>Positive</th><th>Negative</th><th /></tr></thead>
          <tbody>
            {p.controls.filter((c) => c.loaded).map((c) => {
              const r = fj[c.id] ?? { primary: '', pos: '', neg: '' };
              const set = (patch: Partial<typeof r>) => setFj({ ...fj, [c.id]: { ...r, ...patch } });
              const paths = p.pathsBySample[c.id] ?? [];
              return (
                <tr key={c.id}>
                  <td>{c.fileName}</td>
                  <td><select value={r.primary} onChange={(e) => set({ primary: e.target.value })} data-testid={`fj-primary-${c.fileName}`}><option value="">not a control</option>{p.channels.filter((ch) => fjParams.includes(ch) || ch === r.primary).map((ch) => <option key={ch}>{ch}</option>)}</select></td>
                  <td><select value={r.pos} onChange={(e) => set({ pos: e.target.value })} data-testid={`fj-pos-${c.fileName}`}><option value="">-</option>{paths.map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td><select value={r.neg} onChange={(e) => set({ neg: e.target.value })} data-testid={`fj-neg-${c.fileName}`}><option value="">{univ ? 'universal negative' : '-'}</option>{paths.map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td>{r.primary && <button data-testid={`fj-remove-${c.fileName}`} title="Remove this parameter from the compensation." onClick={() => { setFjParams(fjParams.filter((x) => x !== r.primary)); set({ primary: '', pos: '', neg: '' }); }}>Remove</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button data-testid="fj-run" onClick={async () => {
          setFjErr(''); setFjRes(null);
          try {
            const [us, up] = univ ? [univ.slice(0, univ.indexOf('|')), univ.slice(univ.indexOf('|') + 1)] : ['', ''];
            const entries = Object.entries(fj).filter(([, v]) => v.primary && fjParams.includes(v.primary)).map(([sampleId, v]) => ({ sampleId, primary: v.primary, posPath: v.pos || null, negSampleId: v.neg ? sampleId : us, negPath: v.neg || up || null }));
            const r = await p.onFlowjoWizard(entries);
            setFjRes(r);
            if (r.matrix) add({ ...r.matrix, id: `m_${Date.now().toString(36)}`, name: `Wizard matrix (${r.matrix.channels.length} controls)`, ...(r.ssm.channels.length ? { ssm: r.ssm } : {}) });
          } catch (e) { setFjErr((e as Error).message); }
        }}>Calculate</button>
        {fjErr && <p className="error">{fjErr}</p>}
        {fjRes && (
          <div data-testid="fj-result">
            <p>Status: <b data-testid="fj-status">{fjRes.status}</b></p>
            {fjRes.badges.map((b, i) => <p key={i} className={b.level === 'error' ? 'error' : 'warn'} data-testid="fj-badge">{b.primary}: {b.text}</p>)}
            {fjRes.ssm.channels.length > 0 && (
              <>
                <table className="grid" data-testid="fj-ssm">
                  <thead><tr><th>SSM</th>{fjRes.ssm.channels.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{fjRes.ssm.values.map((r, i) => <tr key={i}><th>{fjRes.ssm.channels[i]}</th>{r.map((v, j) => <td key={j}>{v.toFixed(3)}</td>)}</tr>)}</tbody>
                </table>
                <button data-testid="fj-ssm-save" onClick={() => saveText(`SSM_${m?.name ?? 'matrix'}.csv`, ssmCsv(fjRes.ssm), 'text/csv')}>Save SSM</button>
              </>
            )}
          </div>
        )}
      </details>
      <details data-testid="wizard">
        <summary>Compensation wizard (from single-stain controls)</summary>
        <p className="muted">Assign each control tube its stained channel (or Unstained). Spillover = (median of the brightest {pct}% minus median of the negative) in each channel, divided by the same difference in the stained channel. Negative = unstained control if assigned, else the dimmest {pct}% of the same tube. Not compared with FlowJo's wizard.</p>
        <table className="grid">
          <tbody>
            {p.controls.map((c) => (
              <tr key={c.id}>
                <td>{c.fileName}</td>
                <td>
                  <select disabled={!c.loaded} value={roles[c.id] ?? ''} onChange={(e) => setRoles({ ...roles, [c.id]: e.target.value })} data-testid={`wizard-role-${c.fileName}`}>
                    <option value="">not a control</option>
                    <option value="unstained">Unstained</option>
                    {p.channels.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                  {!c.loaded && <span className="muted"> data not loaded</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <label>Positive % <input type="number" min={1} max={49} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ width: 60 }} data-testid="wizard-pct" /></label>
          <label>Pre-gate <select value={gatePath} onChange={(e) => setGatePath(e.target.value)} data-testid="wizard-gate">
            <option value="">all events</option>
            {p.gatePaths.map((g) => <option key={g} value={g}>{g}</option>)}
          </select></label>
          <button
            data-testid="wizard-run"
            onClick={async () => {
              setWizErr('');
              setDiag(null);
              try {
                const assigned = Object.entries(roles).filter(([, v]) => v).map(([sampleId, v]) => ({ sampleId, primary: v === 'unstained' ? null : v }));
                const r = await p.onWizard(assigned, pct, gatePath);
                add(r.matrix);
                setDiag(r.diagnostics);
              } catch (e) {
                setWizErr((e as Error).message);
              }
            }}
          >
            Calculate matrix
          </button>
        </div>
        {wizErr && <p className="error" data-testid="wizard-error">{wizErr}</p>}
        {diag && (
          <table className="grid" data-testid="wizard-diagnostics">
            <thead><tr><th>Control</th><th>Channel</th><th>Positives</th><th>Negatives</th><th>Negative from</th><th>Pos. median</th><th>Neg. median</th><th>Warnings</th></tr></thead>
            <tbody>
              {diag.map((d) => (
                <tr key={d.primary}><td>{d.label}</td><td>{d.primary}</td><td>{d.positives}</td><td>{d.negatives}</td><td>{d.negativeSource}</td><td>{d.positiveMedian.toFixed(1)}</td><td>{d.negativeMedian.toFixed(1)}</td><td className={d.warnings.length ? 'error' : ''}>{d.warnings.join('; ')}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
      <h4 style={{ margin: '8px 0 4px' }}>Matrix Editor</h4>
      <div className="row">
        <select value={selected} onChange={(e) => { setSelected(e.target.value); setSsmView(false); setWeightsOpen(false); }} data-testid="matrix-select">
          {mats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button data-testid="comp-identity" title="Create an empty matrix" onClick={() => setIdentityPick(identityPick ? null : (p.meta?.channels ?? []).map((c) => c.name).filter((c) => p.channels.includes(c)))}>New Identity Matrix</button>
        <button disabled={!m} data-testid="comp-duplicate" title="Create an editable copy of this matrix" onClick={() => m && add(duplicateMatrix(m, mats.map((x) => x.name)))}>Duplicate Matrix</button>
        <button disabled={!m} data-testid="mtx-save" onClick={() => m && saveText(`${m.name}.mtx`, writeMtx(m), 'application/xml')}>Save as .mtx</button>
        <button disabled={!m} data-testid="mtx-save-csv" onClick={() => m && saveText(`${m.name}.csv`, writeMatrixCsv(m), 'text/csv')}>Save as CSV</button>
        {m && <button data-testid="comp-remove-matrix" title="Delete this matrix from the workspace" onClick={() => { setMats(mats.filter((x) => x.id !== m.id)); setSelected(''); }}>Delete matrix</button>}
        <button data-testid="comp-prefs" onClick={() => setShowPrefs(!showPrefs)}>Preferences...</button>
      </div>
      {showPrefs && (
        <div className="row" data-testid="comp-prefs-panel" style={{ flexWrap: 'wrap' }}>
          <b>Matrix Editor:</b>
          <label><input type="checkbox" data-testid="comp-pref-overlay" checked={prefs.overlay} onChange={(e) => setPrefs({ ...prefs, overlay: e.target.checked })} /> Overlay Uncompensated</label>
          <label><input type="checkbox" data-testid="comp-pref-status" checked={prefs.showStatus} onChange={(e) => setPrefs({ ...prefs, showStatus: e.target.checked })} /> Show Status</label>
          <label><input type="checkbox" data-testid="comp-pref-percent" checked={prefs.usePercent} onChange={(e) => setPrefs({ ...prefs, usePercent: e.target.checked })} /> Use Percent for spillover</label>
        </div>
      )}
      {identityPick && (
        <div data-testid="comp-identity-panel" style={{ border: '1px solid #c7cfdc', padding: 6 }}>
          <span className="muted">Parameters of the new identity matrix:</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {(p.meta?.channels ?? []).map((c) => <label key={c.name}><input type="checkbox" data-testid={`comp-identity-${c.name}`} checked={identityPick.includes(c.name)} onChange={(e) => setIdentityPick(e.target.checked ? (p.meta?.channels ?? []).map((x) => x.name).filter((x) => x === c.name || identityPick.includes(x)) : identityPick.filter((x) => x !== c.name))} /> {c.name}</label>)}
          </div>
          <button disabled={!identityPick.length} data-testid="comp-identity-create" onClick={() => { add(identityMatrix(identityPick, mats.map((x) => x.name))); setIdentityPick(null); }}>Create</button>
        </div>
      )}
      {mats.length > 1 && (
        <div className="row" data-testid="comp-compare" style={{ flexWrap: 'wrap' }}>
          <span className="muted" title="Select two matrices for their difference, three or more for their standard deviation">Compare:</span>
          {mats.map((x) => <label key={x.id}><input type="checkbox" data-testid={`comp-compare-${x.name}`} checked={compareIds.includes(x.id)} onChange={(e) => setCompareIds(e.target.checked ? mats.map((y) => y.id).filter((id) => id === x.id || compareIds.includes(id)) : compareIds.filter((id) => id !== x.id))} /> {x.name}</label>)}
        </div>
      )}
      {prefs.showStatus && <p className="muted" data-testid="comp-status">{status}</p>}
      {cmp?.matrix && (
        <table className="grid" data-testid="comp-compare-result">
          <thead><tr><th>{cmp.method}</th>{cmp.matrix.channels.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{cmp.matrix.values.map((r, i) => <tr key={i}><th>{cmp.matrix!.channels[i]}</th>{r.map((v, j) => <td key={j}>{toDisplay(v, prefs.usePercent)}</td>)}</tr>)}</tbody>
        </table>
      )}
      {m && !cmp && (
        <>
          <p className="muted">
            {m.values.length !== m.channels.length
              ? `Spectral matrix: ${m.values.length} fluorochromes (rows) x ${m.channels.length} detectors (columns); unmixed by ${m.weights ? 'weighted' : 'ordinary'} least squares. Unmixed channels appear in channel lists under the fluorochrome names.`
              : 'Spillover: row = fluorochrome channel, column = detector receiving spillover. Diagonal should be 1.'}
            {prefs.usePercent ? ' Values in percent.' : ''}
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }} data-testid="comp-visibility">
            <label title="When checked all fluorochromes are visible. Otherwise unchecked parameter names will be hidden."><input type="checkbox" data-testid="comp-showall" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show All</label>
            {outNames.map((c) => <label key={c}><input type="checkbox" data-testid={`comp-vis-${c}`} disabled={showAll} checked={showAll || !hidden.includes(c)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((x) => x !== c) : [...hidden, c])} /> {c}</label>)}
            {!showAll && hidden.filter((c) => outNames.includes(c)).length > 0 && <span className="muted" data-testid="comp-hidden-count">({hidden.filter((c) => outNames.includes(c)).length} hidden)</span>}
          </div>
          <div className="row">
            <button disabled={!m.ssm} data-testid="comp-ssm-view" title={m.ssm ? (ssmView ? 'Switch back to the spillover matrix' : 'Display the SSM matrix') : "Select a matrix that was created with FlowJo's compensation wizard to display or export the SSM"} onClick={() => setSsmView(!ssmView)}>{ssmView ? 'Display Matrix' : 'Display SSM'}</button>
            <button disabled={!m.ssm} data-testid="comp-ssm-export" title="Export the SSM matrix to a CSV file" onClick={() => m.ssm && saveText(`SSM_${m.name}.csv`, ssmCsv(m.ssm), 'text/csv')}>Export SSM</button>
            <button disabled={!saved || JSON.stringify(saved) === JSON.stringify(m)} data-testid="comp-reset" title="Remove any edits made here since the matrix was last saved" onClick={() => saved && setMats(mats.map((x) => (x.id === m.id ? structuredClone(saved) : x)))}>Reset</button>
            {isSpectral(m) && <button data-testid="comp-weights" title="Preview, import or export weights for the weighted least square unmixing algorithm used for spectral compensation." onClick={() => setWeightsOpen(!weightsOpen)}>Weights</button>}
          </div>
          {weightsOpen && isSpectral(m) && <WeightsPanel matrix={m} save={(n, t) => saveText(n, t, 'text/csv')} onClose={(w) => { setMats(mats.map((x) => (x.id === m.id ? { ...m, weights: w.every((v) => v === 1) ? undefined : w } : x))); setWeightsOpen(false); }} />}
          {ssmView && m.ssm ? (() => {
            const t = ssmWithSums(m.ssm.values);
            return (
              <table className="grid" data-testid="comp-ssm-table">
                <thead><tr><th>SSM</th>{m.ssm.channels.map((c) => <th key={c}>{c}</th>)}<th>Sum</th></tr></thead>
                <tbody>
                  {t.rows.map((r, i) => <tr key={i}><th>{m.ssm!.channels[i]}</th>{r.map((v, j) => <td key={j}>{v.toFixed(3)}</td>)}</tr>)}
                  <tr><th>Sum</th>{t.colSums.map((v, j) => <td key={j}>{v.toFixed(3)}</td>)}<td>{t.total.toFixed(3)}</td></tr>
                </tbody>
              </table>
            );
          })() : (
          <div className="matrix-wrap">
            <table className="grid matrix">
              <thead><tr><th />{m.channels.map((c) => (isSpectral(m) || visible(c)) && <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {m.values.map((r, i) => visible(outNames[i] ?? m.channels[i]) && (
                  <tr key={i}>
                    <th>{m.outputNames?.[i] ?? m.channels[i]}</th>
                    {r.map((v, j) => (isSpectral(m) || visible(m.channels[j])) && (
                      <td key={j}>
                        <input
                          type="number"
                          step="any"
                          title={`Spillover from parameter ${m.outputNames?.[i] ?? m.channels[i]} into ${m.channels[j]}`}
                          value={toDisplay(v, prefs.usePercent)}
                          onChange={(e) => setCell(i, j, fromDisplay(Number(e.target.value), prefs.usePercent))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <p className={check.startsWith('Invalid') ? 'error' : 'muted'} data-testid="matrix-check">{check}</p>
          {m.values.length !== m.channels.length && (
            <div className="row" data-testid="af-row">
              <span className="muted">Autofluorescence:</span>
              <select value={afControl} onChange={(e) => setAfControl(e.target.value)} data-testid="af-control">
                <option value="">unstained control...</option>
                {p.controls.filter((c) => c.loaded).map((c) => <option key={c.id} value={c.id}>{c.fileName}</option>)}
              </select>
              <select value={afGate} onChange={(e) => setAfGate(e.target.value)} data-testid="af-gate">
                <option value="">all events</option>
                {p.gatePaths.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <button
                disabled={!afControl}
                data-testid="af-add"
                onClick={async () => {
                  setAfErr('');
                  try {
                    const spectrum = await p.onEstimateAf(afControl, m.channels, afGate);
                    add(withAutofluorescence(m, spectrum));
                  } catch (e) {
                    setAfErr((e as Error).message);
                  }
                }}
              >
                Add AF row from unstained
              </button>
              {afErr && <span className="error" data-testid="af-error">{afErr}</span>}
            </div>
          )}
          {p.onPreview && p.samples && (
            <div data-testid="comp-preview" style={{ border: '1px solid #c7cfdc', padding: 6, margin: '6px 0' }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <label title="Select a sample to preview with this matrix">Preview Sample <select data-testid="comp-preview-sample" value={pv.sampleId} onChange={(e) => {
                  const s = p.samples!.find((x) => x.id === e.target.value);
                  // The population path is kept when the new sample has it.
                  setPv({ sampleId: e.target.value, path: s?.paths.includes(pv.path) ? pv.path : '' });
                }}>{p.samples.map((s) => <option key={s.id} value={s.id} disabled={!s.loaded}>{s.fileName}</option>)}</select></label>
                <label title="Select a sub-population to graph of the selected sample">Preview Population <select data-testid="comp-preview-pop" value={pv.path} onChange={(e) => setPv({ ...pv, path: e.target.value })}>
                  <option value="">All events</option>
                  {(pvSample?.paths ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
                </select></label>
                <label>View <select data-testid="comp-view" value={view.kind === 'allby' ? `allby:${view.channel}` : view.kind} onChange={(e) => { const v = e.target.value; setView(v === 'nxn' ? { kind: 'nxn' } : v === 'histos' ? { kind: 'histos' } : { kind: 'allby', channel: v.slice(6) }); }}>
                  <option value="nxn">N x N View</option>
                  {visibleOut.map((c) => <option key={c} value={`allby:${c}`}>All By... {c}</option>)}
                  <option value="histos">Histograms</option>
                </select></label>
                <label title="Draw the raw collected parameter on top of the compensated equivalent to show the differences."><input type="checkbox" data-testid="comp-overlay" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Overlay Uncompensated</label>
              </div>
              <div className="row">
                <button data-testid="comp-zoom-out" title="Decrease scale to see more plots." onClick={() => setZoom(zoomOut(zoom))}>Zoom Out</button>
                <button data-testid="comp-zoom-in" title="Increase magnification to see larger plots." onClick={() => setZoom(zoomIn(zoom))}>Zoom In</button>
                <button data-testid="comp-zoom-fit" title="Sets scale to see all plots" onClick={() => setZoom(fitZoom(gridBox.current?.clientWidth ?? 0, view.kind === 'nxn' ? visibleOut.length : Math.max(1, visibleOut.length - (view.kind === 'allby' ? 1 : 0))))}>Scale To Fit</button>
                <button data-testid="comp-zoom-100" title="Resets scale to full view" onClick={() => setZoom(100)}>Reset Scale</button>
                <span className="muted" data-testid="comp-zoom">{Math.round(zoom)}%</span>
                <button data-testid="comp-animate" disabled={animating || !pvData} title="Show the compensation applied from 0.1% to 400% of the calculated amount." onClick={() => void animate()}>Animate</button>
                {animating && <b data-testid="comp-anim-label">{scaleLabel(anim)}</b>}
                <span
                  data-testid="comp-matrix-icon"
                  draggable
                  title="Drop this on samples or groups to apply this matrix."
                  style={{ cursor: 'grab', border: '1px solid #7a86a0', borderRadius: 3, padding: '1px 6px', background: '#eef2f8' }}
                  onDragStart={(e) => {
                    p.onSave(mats);
                    e.dataTransfer.setData(MATRIX_DRAG_TYPE, m.id);
                    e.dataTransfer.effectAllowed = 'copy';
                    // Let the drop reach the workspace under the dialog until
                    // the drag ends.
                    const bg = e.currentTarget.closest('.modal-bg') as HTMLElement | null;
                    if (!bg) return;
                    let done = false;
                    const restore = () => { done = true; bg.style.pointerEvents = ''; window.removeEventListener('dragend', restore, true); window.removeEventListener('drop', restore, true); };
                    window.addEventListener('dragend', restore, true);
                    window.addEventListener('drop', restore, true);
                    setTimeout(() => { if (!done) bg.style.pointerEvents = 'none'; }, 0);
                  }}
                >Matrix Icon</span>
              </div>
              {pvErr && <p className="error">{pvErr}</p>}
              {pvData && pvData.missing.length > 0 && <p className="error" data-testid="comp-preview-missing">Preview sample lacks: {pvData.missing.join(', ')}</p>}
              {pvData && <p className="muted" data-testid="comp-preview-count">{pvData.count.toLocaleString()} events{Object.values(pvData.raw)[0] && Object.values(pvData.raw)[0].length < pvData.count ? ` (${Object.values(pvData.raw)[0].length.toLocaleString()} shown)` : ''}</p>}
              <div ref={gridBox}>
                {pvData && pvData.missing.length === 0 && !check.startsWith('Invalid') && <CompPlotGrid raw={pvData.raw} matrix={scaleSpillover(m, anim)} channels={visibleOut} view={view} overlay={overlay} zoom={zoom} transformFor={p.transformFor ?? (() => undefined)} />}
              </div>
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button disabled={check.startsWith('Invalid')} onClick={() => { p.onSave(mats); p.onAssign(m.id, 'sample'); }}>Save and apply to sample</button>
            <button disabled={check.startsWith('Invalid')} onClick={() => { p.onSave(mats); p.onAssign(m.id, 'group'); }}>Save and apply to group</button>
            <button disabled={check.startsWith('Invalid')} data-testid="comp-apply-workspace" title="Set all samples in the experiment to refer to this matrix." onClick={() => { p.onSave(mats); p.onAssign(m.id, 'workspace'); }}>Apply To Workspace</button>
            {p.groups && p.groups.length > 0 && (
              <>
                <select data-testid="comp-apply-group-select" value={applyGroup} onChange={(e) => setApplyGroup(e.target.value)}>{p.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                <button disabled={check.startsWith('Invalid') || !applyGroup} data-testid="comp-apply-group" title="Use this compensation matrix for all samples in the chosen group." onClick={() => { p.onSave(mats); p.onAssign(m.id, `group:${applyGroup}`); }}>Apply To Group</button>
              </>
            )}
          </div>
        </>
      )}
      <button onClick={() => p.onSave(mats)}>Save matrices</button>
    </Modal>
  );
}

export function DerivedDialog(p: {
  params: DerivedParameter[];
  channels: string[];
  usersOf: (name: string) => string[];
  onClose: () => void;
  onChange: (params: DerivedParameter[]) => void;
}) {
  // FlowJo 10 "Derive Parameters" (specs 12): a name (letters, digits,
  // underscore; default "Derived"), a formula with references and functions
  // inserted from lists, validated as it is typed.
  const takenNames = [...p.channels, ...p.params.map((x) => x.name)];
  const [name, setName] = useState(defaultDerivedName(takenNames));
  const [formula, setFormula] = useState('');
  // Deleting a parameter that gates or statistics use asks first (UAT a3-03).
  const [pending, setPending] = useState<{ name: string; users: string[] } | null>(null);
  const remove = (n: string) => p.onChange(p.params.filter((x) => x.name !== n));
  const askRemove = (n: string) => {
    const users = p.usersOf(n);
    if (users.length === 0) remove(n);
    else setPending({ name: n, users });
  };
  const nameErr = derivedNameError(name.trim(), takenNames);
  let formulaErr: string | null = null;
  if (!formula.trim()) formulaErr = 'Empty expression.';
  else if (formula.trim().toUpperCase() !== EVENT_NUMBER.toUpperCase()) {
    try {
      const f = compileFormula(formula, [...p.channels, ...p.params.map((x) => x.name)]);
      if (f.variables.some((v) => v === null)) formulaErr = 'Unknown parameter name in the formula';
    } catch (e) {
      formulaErr = (e as Error).message;
    }
  }
  const insert = (t: string) => setFormula((f) => f + t);
  const add = () => {
    if (nameErr || formulaErr) return;
    const n = name.trim();
    p.onChange([...p.params, { name: n, formula: formula.trim() }]);
    setFormula('');
    setName(defaultDerivedName([...takenNames, n]));
  };
  return (
    <Modal title="Derive Parameters" onClose={p.onClose} wide>
      <p className="muted">A derived parameter is computed per event from a formula on the sample's compensated values, as FlowJo 10 evaluates it. It appears in channel lists for plots, gates and statistics.</p>
      {p.params.length > 0 && (
        <table className="grid" data-testid="derived-list">
          <thead><tr><th>Name</th><th>Formula</th><th /></tr></thead>
          <tbody>
            {p.params.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td>{derivedFormula(d)}</td>
                <td><button className="x" aria-label={`remove ${d.name}`} onClick={() => askRemove(d.name)}>x</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pending && (
        <div className="warn" role="alertdialog" data-testid="derived-confirm">
          <p>"{pending.name}" is used by {pending.users.length} item(s). They will show an error until it is restored (Undo restores it):</p>
          <ul>{pending.users.map((u) => <li key={u}>{u}</li>)}</ul>
          <button onClick={() => { remove(pending.name); setPending(null); }} data-testid="derived-confirm-delete">Delete anyway</button>
          <button onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      <div className="row">
        Name <input value={name} onChange={(e) => setName(e.target.value)} data-testid="derived-name" style={{ width: 140 }} />
        <select value="" data-testid="derived-insert-ref" onChange={(e) => e.target.value && insert(e.target.value)}>
          <option value="">Insert Reference</option>
          {[...p.channels, EVENT_NUMBER].map((ch) => <option key={ch} value={ch}>{ch}</option>)}
        </select>
        <select value="" data-testid="derived-insert-fn" onChange={(e) => e.target.value && insert(e.target.value)}>
          <option value="">Insert Function</option>
          {FORMULA_FUNCTIONS.map((f) => <option key={f} value={f.replace(/\(.*\)/, '(')}>{f}</option>)}
        </select>
        <select value="" data-testid="derived-insert-op" onChange={(e) => e.target.value && insert(e.target.value)}>
          <option value="">Insert Operator</option>
          {['+', '-', '*', '/', '%', '^', '=', '<>', '<', '>', '<=', '>=', '&', '|', '!'].map((o) => <option key={o} value={` ${o} `}>{o}</option>)}
        </select>
      </div>
      <textarea value={formula} onChange={(e) => setFormula(e.target.value)} data-testid="derived-formula" rows={3} style={{ width: '100%' }} placeholder="e.g. FL1-A / FL2-A" />
      {nameErr && name.trim() && <p className="error" data-testid="derived-name-error">{nameErr}</p>}
      {formula.trim() && formulaErr && <p className="error" data-testid="derived-error">Cannot parse the current equation: {formulaErr}</p>}
      <div className="row">
        <button onClick={add} disabled={!!nameErr || !!formulaErr} data-testid="derived-add">OK</button>
      </div>
    </Modal>
  );
}

// FlowJo 10 "Subpopulation Identification" (GateNamerDialog; specs 18.2):
// shown after a gate is drawn. The name must be unique among the siblings;
// Favorites are the common gate names, + adds and - removes the shown name.
// Cancel discards the new gate.
export function GateNamerDialog(p: { initial: string; siblings: string[]; favorites: string[]; onFavorites: (names: string[]) => void; onOk: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(p.initial);
  const [error, setError] = useState('');
  const ok = () => {
    const n = name.trim();
    if (!n) return;
    if (p.siblings.includes(n)) return setError('Name must be unique.');
    p.onOk(n);
  };
  return (
    <Modal title="Subpopulation Identification" onClose={p.onCancel}>
      <label title="Give a biologically meaningful name to this set of events">
        Enter the name of this subpopulation:{' '}
        <input
          autoFocus
          value={name}
          data-testid="gate-namer-name"
          onFocus={(e) => e.target.select()}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { e.stopPropagation(); p.onCancel(); } }}
        />
      </label>
      <div className="row">
        <select value="" onChange={(e) => { if (e.target.value) { setName(e.target.value); setError(''); } }} data-testid="gate-namer-favorites" title="Shows a list of favorite population names">
          <option value="">Favorites</option>
          {p.favorites.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button title="Adds the displayed subpopulation name to the saved list of favorites." disabled={!name.trim() || p.favorites.includes(name.trim())} onClick={() => p.onFavorites([...p.favorites, name.trim()])} data-testid="gate-namer-memorize">+</button>
        <button title="Removes the displayed subpopulation name from the saved list of favorites." disabled={!p.favorites.includes(name.trim())} onClick={() => p.onFavorites(p.favorites.filter((f) => f !== name.trim()))} data-testid="gate-namer-forget">-</button>
      </div>
      {error && <p className="error" data-testid="gate-namer-error">{error}</p>}
      <div className="row">
        <button onClick={ok} disabled={!name.trim()} data-testid="gate-namer-ok">OK</button>
        <button onClick={p.onCancel} data-testid="gate-namer-cancel">Cancel</button>
      </div>
    </Modal>
  );
}

// Add Keyword (specs 22.4, WSKeywordMgr.addKeyword): a name only, pre-filled "SampleID".
export function AddKeywordDialog(p: { onOk: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('SampleID');
  return (
    <Modal title="Add Keyword" onClose={p.onClose}>
      <label>Keyword name <input autoFocus value={name} data-testid="add-keyword-name" onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && p.onOk(name)} /></label>
      <p className="muted">Added to every sample with an empty value; fill values in the Annotations panel or paste them from a spreadsheet.</p>
      <div className="row"><button disabled={!name.trim()} onClick={() => p.onOk(name)} data-testid="add-keyword-ok">OK</button><button onClick={p.onClose}>Cancel</button></div>
    </Modal>
  );
}

// Find / Replace (specs 22.4, ws.find.*): keyword values; Sample | Keyword | Value.
export function FindDialog(p: { samples: SampleState[]; keywords: string[]; onReplace: (hits: FindHit[], what: string, withText: string, opts: { matchCase: boolean; partial: boolean }) => void; onShow: (sampleId: string) => void; onClose: () => void }) {
  const [what, setWhat] = useState('');
  const [withText, setWithText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [partial, setPartial] = useState(true);
  const [at, setAt] = useState(-1);
  const hits = findKeywords(p.samples, what, { keyword: keyword || undefined, matchCase, wholeWord });
  const next = () => { if (!hits.length) return; const i = (at + 1) % hits.length; setAt(i); p.onShow(hits[i].sampleId); }; // Find Next wraps
  return (
    <Modal title="Find" onClose={p.onClose} wide>
      <div className="row">
        <label>Find what <input autoFocus value={what} onChange={(e) => { setWhat(e.target.value); setAt(-1); }} onKeyDown={(e) => e.key === 'Enter' && next()} data-testid="find-what" /></label>
        <label>Replace with <input value={withText} onChange={(e) => setWithText(e.target.value)} data-testid="find-replace" /></label>
        <label>Context <select value={keyword} onChange={(e) => setKeyword(e.target.value)} data-testid="find-context"><option value="">All Keywords</option>{p.keywords.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
      </div>
      <div className="row">
        <label><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} data-testid="find-case" /> Match case</label>
        <label><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} data-testid="find-whole" /> Match whole word</label>
        <label><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Replace partial</label>
        <button disabled={!hits.length} onClick={next} data-testid="find-next">Find Next</button>
        <button disabled={!hits.some((h) => h.editable)} title="File keywords are read-only; annotation keywords are replaced" onClick={() => p.onReplace(hits, what, withText, { matchCase, partial })} data-testid="find-replace-all">Replace All</button>
        <span className="muted" data-testid="find-count">{what ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : ''}</span>
      </div>
      <table className="grid" data-testid="find-results">
        <thead><tr><th>Sample</th><th>Keyword</th><th>Value</th></tr></thead>
        <tbody>{hits.slice(0, 500).map((h, i) => <tr key={`${h.sampleId}-${h.keyword}-${h.editable}`} className={i === at ? 'sel' : ''} onClick={() => { setAt(i); p.onShow(h.sampleId); }}><td>{h.fileName}</td><td>{h.keyword}{h.editable ? '' : ' (file)'}</td><td>{h.value}</td></tr>)}</tbody>
      </table>
    </Modal>
  );
}
