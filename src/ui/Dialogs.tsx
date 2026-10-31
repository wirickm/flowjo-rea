import { useState } from 'react';
import { invert, isSpectral, parseSpilloverCsv, unmixingOperator, validateMatrix, type SpilloverMatrix } from '../core/compensation';
import { describeTransform, makeTransform, type TransformSpec } from '../core/transforms';
import type { SampleMeta } from '../core/service';
import type { WizardResult } from '../core/compWizard';

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

export function KeywordsDialog(p: { meta: SampleMeta; onClose: () => void }) {
  const [filter, setFilter] = useState('');
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
      <table className="grid">
        <thead><tr><th>#</th><th>$PnN</th><th>$PnS</th><th>Bits</th><th>Range</th><th>$PnE</th><th>$PnG</th></tr></thead>
        <tbody>
          {p.meta.channels.map((c) => (
            <tr key={c.index}><td>{c.index}</td><td>{c.name}</td><td>{c.label}</td><td>{c.bits}</td><td>{c.range}</td><td>{c.logDecades},{c.logOffset}</td><td>{c.gain}</td></tr>
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

const DEFAULTS: Record<string, TransformSpec> = {
  linear: { kind: 'linear', T: 262144, A: 0 },
  log: { kind: 'log', T: 262144, M: 4.5 },
  asinh: { kind: 'asinh', T: 262144, M: 4.5, A: 0 },
  logicle: { kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 },
  hyperlog: { kind: 'hyperlog', T: 262144, W: 0.5, M: 4.5, A: 0 },
  'flowjo-biex': { kind: 'flowjo-biex', max: 262144, width: -10, pos: 4.418539922, neg: 0, channelRange: 4096 },
  'flowjo-log': { kind: 'flowjo-log', offset: 1, decades: 4.5 },
};

export function TransformDialog(p: { channel: string; spec: TransformSpec; onApply: (s: TransformSpec) => void; onClose: () => void }) {
  const [spec, setSpec] = useState<TransformSpec>(p.spec.kind === 'none' ? DEFAULTS.linear : p.spec);
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
        <select value={spec.kind} onChange={(e) => setSpec(DEFAULTS[e.target.value])} data-testid="transform-kind">
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
}) {
  const [mats, setMats] = useState<SpilloverMatrix[]>(p.matrices);
  const [roles, setRoles] = useState<Record<string, string>>({}); // sampleId -> '' | 'unstained' | channel
  const [pct, setPct] = useState(10);
  const [gatePath, setGatePath] = useState('');
  const [diag, setDiag] = useState<WizardResult['diagnostics'] | null>(null);
  const [wizErr, setWizErr] = useState('');
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
      {msg && <p className="error">{msg}</p>}
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
