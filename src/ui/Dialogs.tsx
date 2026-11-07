import { useState } from 'react';
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
  onAssign: (ref: string, scope: 'sample' | 'group') => void;
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
  const m = mats.find((x) => x.id === selected);
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
        <table className="grid">
          <thead><tr><th>Control</th><th>Stained channel</th><th>Positive</th><th>Negative</th></tr></thead>
          <tbody>
            {p.controls.filter((c) => c.loaded).map((c) => {
              const r = fj[c.id] ?? { primary: '', pos: '', neg: '' };
              const set = (patch: Partial<typeof r>) => setFj({ ...fj, [c.id]: { ...r, ...patch } });
              const paths = p.pathsBySample[c.id] ?? [];
              return (
                <tr key={c.id}>
                  <td>{c.fileName}</td>
                  <td><select value={r.primary} onChange={(e) => set({ primary: e.target.value })} data-testid={`fj-primary-${c.fileName}`}><option value="">not a control</option>{p.channels.map((ch) => <option key={ch}>{ch}</option>)}</select></td>
                  <td><select value={r.pos} onChange={(e) => set({ pos: e.target.value })} data-testid={`fj-pos-${c.fileName}`}><option value="">-</option>{paths.map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td><select value={r.neg} onChange={(e) => set({ neg: e.target.value })} data-testid={`fj-neg-${c.fileName}`}><option value="">{univ ? 'universal negative' : '-'}</option>{paths.map((x) => <option key={x}>{x}</option>)}</select></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button data-testid="fj-run" onClick={async () => {
          setFjErr(''); setFjRes(null);
          try {
            const [us, up] = univ ? [univ.slice(0, univ.indexOf('|')), univ.slice(univ.indexOf('|') + 1)] : ['', ''];
            const entries = Object.entries(fj).filter(([, v]) => v.primary).map(([sampleId, v]) => ({ sampleId, primary: v.primary, posPath: v.pos || null, negSampleId: v.neg ? sampleId : us, negPath: v.neg || up || null }));
            const r = await p.onFlowjoWizard(entries);
            setFjRes(r);
            if (r.matrix) add({ ...r.matrix, id: `m_${Date.now().toString(36)}`, name: `Wizard matrix (${r.matrix.channels.length} controls)` });
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
      <div className="row">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} data-testid="matrix-select">
          {mats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button disabled={!m} data-testid="mtx-save" onClick={() => m && saveText(`${m.name}.mtx`, writeMtx(m), 'application/xml')}>Save as .mtx</button>
        <button disabled={!m} data-testid="mtx-save-csv" onClick={() => m && saveText(`${m.name}.csv`, writeMatrixCsv(m), 'text/csv')}>Save as CSV</button>
        {m && <button onClick={() => { setMats(mats.filter((x) => x.id !== m.id)); setSelected(''); }}>Delete matrix</button>}
      </div>
      {m && (
        <>
          <p className="muted">
            {m.values.length !== m.channels.length
              ? `Spectral matrix: ${m.values.length} fluorochromes (rows) x ${m.channels.length} detectors (columns); unmixed by ordinary least squares. Unmixed channels appear in channel lists under the fluorochrome names.`
              : 'Spillover: row = fluorochrome channel, column = detector receiving spillover. Diagonal should be 1.'}
          </p>
          <div className="matrix-wrap">
            <table className="grid matrix">
              <thead><tr><th />{m.channels.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {m.values.map((r, i) => (
                  <tr key={i}>
                    <th>{m.outputNames?.[i] ?? m.channels[i]}</th>
                    {r.map((v, j) => (
                      <td key={j}>
                        <input
                          type="number"
                          step="any"
                          value={v}
                          onChange={(e) => {
                            const values = m.values.map((row) => [...row]);
                            values[i][j] = Number(e.target.value);
                            setMats(mats.map((x) => (x.id === m.id ? { ...m, values } : x)));
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <div className="row">
            <button disabled={check.startsWith('Invalid')} onClick={() => { p.onSave(mats); p.onAssign(m.id, 'sample'); }}>Save and apply to sample</button>
            <button disabled={check.startsWith('Invalid')} onClick={() => { p.onSave(mats); p.onAssign(m.id, 'group'); }}>Save and apply to group</button>
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
