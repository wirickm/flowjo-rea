import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PopulationResult } from '../core/analysis';
import { exportGatingMl, gatingMlNames, parseGatingMl } from '../core/gatingml';
import { emptyWorkspace, newId, populationPath, type Gate, type PlotSettings, type Population, type StatColumn, type StatKind, type Workspace } from '../core/model';
import { applySubtree, deserializeWorkspace, removePopulation, serializeWorkspace } from '../core/project';
import type { PlotResult, SampleMeta } from '../core/service';
import { STAT_LABELS, STAT_NEEDS_CHANNEL } from '../core/stats';
import { makeTransform, type TransformSpec } from '../core/transforms';
import { parseWsp } from '../core/wsp';
import { defaultTransform, isScatterOrTime, makeAxis, sampleChannels } from './axes';
import { CompensationDialog, KeywordsDialog, TransformDialog } from './Dialogs';
import { LayoutView } from './Layout';
import type { Axis } from './gateGeometry';
import { Plot, type PlotKind, type Tool } from './Plot';
import { initHistory, pushHistory, redo, undo, type History } from './history';
import { createAnalysisClient } from './workerClient';

const client = createAnalysisClient();

type Analysis = { results: PopulationResult[]; total: number; compError?: string };
type Dialog = null | { kind: 'comp' } | { kind: 'keywords' } | { kind: 'transform'; channel: string } | { kind: 'export' } | { kind: 'layout' };

function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fmtStat = (v: number | string) => (typeof v === 'string' ? v : Number.isNaN(v) ? 'NaN' : Number.isInteger(v) ? String(v) : v.toPrecision(5));
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function App() {
  // Workspace with undo/redo history; every edit goes through setWs.
  const [hist, setHist] = useState<History<Workspace>>(() => initHistory(emptyWorkspace()));
  const ws = hist.present;
  const setWs = (next: Workspace | ((w: Workspace) => Workspace)) =>
    setHist((h) => pushHistory(h, typeof next === 'function' ? next(h.present) : next));
  const [meta, setMeta] = useState<Record<string, SampleMeta>>({});
  const [analysis, setAnalysis] = useState<Record<string, Analysis>>({});
  const [sel, setSel] = useState<{ sampleId: string | null; popId: string | null }>({ sampleId: null, popId: null });
  const [multi, setMulti] = useState<string[]>([]);
  const [groupId, setGroupId] = useState('all');
  const [tool, setTool] = useState<Tool>('select');
  const [plotData, setPlotData] = useState<PlotResult | null>(null);
  const [log, setLog] = useState<{ level: 'info' | 'warn' | 'error'; text: string }[]>([]);
  const [busy, setBusy] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [stats, setStats] = useState<Record<string, (number | string)[]>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [gateSel, setGateSel] = useState<string | null>(null);
  const [syncGroup, setSyncGroup] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); setHist(undo); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); setHist(redo); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const note = useCallback((level: 'info' | 'warn' | 'error', text: string) => setLog((l) => [{ level, text }, ...l].slice(0, 200)), []);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy((b) => b + 1);
    try {
      return await fn();
    } catch (e) {
      note('error', (e as Error).message);
      return undefined;
    } finally {
      setBusy((b) => b - 1);
    }
  }, [note]);

  const sample = ws.samples.find((s) => s.id === sel.sampleId) ?? null;
  const sMeta = sample ? meta[sample.id] : undefined;
  const group = ws.groups.find((g) => g.id === groupId) ?? ws.groups[0];
  const groupSamples = ws.samples.filter((s) => group?.sampleIds.includes(s.id));
  // Undo/redo can remove the selected population; fall back to its absence.
  const selPopValid = !!sample && !!sel.popId && sample.populations.some((p) => p.id === sel.popId);
  useEffect(() => {
    if (sel.popId && sample && !selPopValid) setSel({ sampleId: sample.id, popId: null });
  }, [sel.popId, sample, selPopValid]);
  const channels = useMemo(() => (sMeta && sample ? sampleChannels(sMeta, sample.compensation, ws.matrices) : []), [sMeta, sample?.compensation, ws.matrices]); // eslint-disable-line react-hooks/exhaustive-deps
  const popPath = sample && sel.popId && selPopValid ? populationPath(sample.populations, sel.popId) : '';

  // --- file loading -------------------------------------------------------
  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      await run(async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // Relink an existing workspace sample with the same file name and no data.
        const existing = ws.samples.find((s) => s.fileName === file.name && !meta[s.id]);
        const id = existing?.id ?? newId('s');
        const m = await client.load(id, file.name, bytes, existing?.datasetIndex ?? 0);
        if (existing?.fingerprint && existing.fingerprint !== m.fingerprint) {
          note('warn', `${file.name}: content differs from the file recorded in the workspace (SHA-256 mismatch); relinked anyway`);
        }
        for (const w of m.warnings) note('warn', `${file.name}: ${w}`);
        setMeta((x) => ({ ...x, [id]: m }));
        setWs((w0) => {
          const w = structuredClone(w0);
          for (const c of m.channels) if (!w.channelTransforms[c.name]) w.channelTransforms[c.name] = defaultTransform(c, m.keywords);
          const snapshot: Record<string, string> = {};
          for (const k of ['$FIL', '$DATE', '$CYT', '$TOT', '$PAR', '$BTIM', '$ETIM', '$SRC', 'TUBE NAME', '$TIMESTEP']) if (m.keywords[k]) snapshot[k] = m.keywords[k];
          const fields = { fileSize: m.fileSize, fingerprint: m.fingerprint, channelNames: m.channels.map((c) => c.name), eventCount: m.eventCount, keywordsSnapshot: snapshot };
          if (existing) {
            Object.assign(w.samples.find((s) => s.id === id)!, fields);
          } else {
            w.samples.push({ id, fileName: file.name, datasetIndex: 0, compensation: m.hasSpillover ? 'file' : 'none', populations: [], ...fields });
            w.groups.find((g) => g.id === 'all')?.sampleIds.push(id);
          }
          return w;
        });
        note('info', `Loaded ${file.name}: ${m.eventCount.toLocaleString()} events, ${m.channels.length} parameters${m.hasSpillover ? ', spillover keyword found' : ''}`);
        setSel((s) => (s.sampleId ? s : { sampleId: id, popId: null }));
      });
    }
  };

  const openWorkspace = async (file: File) => {
    await run(async () => {
      const text = await file.text();
      let next: Workspace;
      if (file.name.toLowerCase().endsWith('.wsp')) {
        const imp = parseWsp(text);
        next = imp.workspace;
        next.name = file.name;
        for (const w of imp.warnings) note('warn', w);
        note('info', `Imported FlowJo workspace (${imp.flowjoVersion}): ${next.samples.length} samples. Add the FCS files to relink data.`);
      } else {
        next = deserializeWorkspace(text);
        note('info', `Opened workspace ${next.name}: ${next.samples.length} samples. Add the FCS files to relink data.`);
      }
      for (const id of Object.keys(meta)) await client.unload(id);
      setMeta({});
      setAnalysis({});
      setStats({});
      setHist(initHistory(next)); // opening a workspace resets history
      setGroupId('all');
      setSel({ sampleId: next.samples[0]?.id ?? null, popId: null });
    });
  };

  const importGatingMl = async (file: File) => {
    if (!sample) return note('warn', 'Select a sample before importing Gating-ML');
    await run(async () => {
      const text = await file.text();
      const doc = parseGatingMl(text);
      const names = gatingMlNames(text);
      const prefix = newId('g');
      const map = (id: string) => `${prefix}_${id}`;
      const pops: Population[] = doc.populations.map((p) => ({
        id: map(p.id),
        name: names.get(p.id) ?? p.name,
        parentId: p.parentId ? map(p.parentId) : sel.popId,
        gate: p.gate.type === 'boolean' ? { ...p.gate, operands: p.gate.operands.map((o) => ({ ...o, ref: map(o.ref) })) } : p.gate,
      }));
      updateWs((w) => {
        w.matrices.push(...doc.matrices.filter((m) => !w.matrices.some((x) => x.id === m.id)));
        w.samples.find((s) => s.id === sample.id)!.populations.push(...pops);
      });
      for (const wmsg of doc.warnings) note('warn', wmsg);
      note('info', `Imported ${pops.length} Gating-ML gates into ${sample.fileName}`);
    });
  };

  const updateWs = (fn: (w: Workspace) => void) =>
    setWs((w0) => {
      const w = structuredClone(w0);
      fn(w);
      return w;
    });

  // --- analysis -------------------------------------------------------------
  useEffect(() => {
    if (!sample || !meta[sample.id]) return;
    let live = true;
    const req = { sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices };
    run(async () => {
      const a = await client.analyze(req);
      if (!live) return;
      setAnalysis((x) => ({ ...x, [sample.id]: a }));
      if (a.compError) note('error', `${sample.fileName}: compensation failed: ${a.compError}`);
      for (const r of a.results) if (r.error) note('error', `${sample.fileName} / ${r.name}: ${r.error}`);
    });
    return () => { live = false; };
  }, [sample?.id, sample?.compensation, sample?.populations, ws.matrices, meta, run, note]);

  const plotSettings = useMemo(() => {
    const saved = ws.plots?.[popPath];
    if (saved && channels.some((c) => c.name === saved.x)) return saved;
    const names = channels.map((c) => c.name);
    const x = names.find((n) => /^FSC-A$/i.test(n)) ?? names.find((n) => isScatterOrTime(n)) ?? names[0] ?? '';
    const y = names.find((n) => /^SSC-A$/i.test(n)) ?? names.find((n) => n !== x) ?? null;
    return { x, y, kind: 'pseudocolor' as PlotKind };
  }, [ws.plots, popPath, channels]);
  const setPlotSettings = (patch: Partial<PlotSettings>) =>
    updateWs((w) => {
      w.plots = { ...(w.plots ?? {}), [popPath]: { ...plotSettings, ...patch } };
    });

  const axisFor = useCallback(
    (ch: string): Axis | null => {
      if (!ch || !sMeta) return null;
      return makeAxis(channels, sMeta.keywords, ws.channelTransforms, ch);
    },
    [sMeta, channels, ws.channelTransforms],
  );
  const kind: PlotKind = plotSettings.kind;
  const xAxis = useMemo(() => axisFor(plotSettings.x), [axisFor, plotSettings.x]);
  const yAxis = useMemo(() => (kind === 'histogram' ? null : axisFor(plotSettings.y ?? '')), [axisFor, plotSettings.y, kind]);

  useEffect(() => {
    if (!sample || !meta[sample.id] || !xAxis) return setPlotData(null);
    let live = true;
    run(async () => {
      const d = await client.plot({
        sampleId: sample.id,
        compensation: sample.compensation,
        populations: sample.populations,
        matrices: ws.matrices,
        popId: sel.popId,
        x: { kind: 'channel', channel: xAxis.channel, transform: xAxis.spec },
        y: yAxis ? { kind: 'channel', channel: yAxis.channel, transform: yAxis.spec } : null,
        bins: yAxis ? 200 : 256,
        xRange: xAxis.range,
        yRange: yAxis ? yAxis.range : null,
        maxPoints: 20000,
      });
      if (live && d) setPlotData(d);
    });
    return () => { live = false; };
  }, [sample?.id, sample?.compensation, sample?.populations, ws.matrices, meta, sel.popId, xAxis, yAxis, run]);

  // statistics table across the current group
  useEffect(() => {
    if (!ws.statColumns.length) return setStats({});
    let live = true;
    const t = setTimeout(() => {
      for (const s of groupSamples) {
        if (!meta[s.id]) continue;
        run(async () => {
          const v = await client.stats({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, columns: ws.statColumns });
          if (live && v) setStats((x) => ({ ...x, [s.id]: v }));
        });
      }
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [ws.statColumns, ws.samples, ws.matrices, groupId, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- gate editing ------------------------------------------------------------
  const counts = useMemo(() => {
    const out: Record<string, { count: number; parentCount: number }> = {};
    for (const r of (sample && analysis[sample.id]?.results) || []) if (r) out[r.id] = r;
    return out;
  }, [analysis, sample]);

  const syncRoots = (w: Workspace, sampleId: string, popIds: string[]) => {
    if (!syncGroup) return;
    const targets = (w.groups.find((g) => g.id === groupId)?.sampleIds ?? []).filter((x) => x !== sampleId);
    for (const id of popIds) for (const msg of applySubtree(w, sampleId, id, targets)) note('warn', msg);
  };

  const createGates = (gates: { name: string; gate: Gate }[]) => {
    if (!sample) return;
    const ids = gates.map(() => newId('pop'));
    updateWs((w) => {
      const s = w.samples.find((x) => x.id === sample.id)!;
      gates.forEach((g, i) => s.populations.push({ id: ids[i], name: g.name, parentId: sel.popId, gate: g.gate }));
      syncRoots(w, sample.id, ids);
    });
    setTool('select');
    note('info', `Created ${gates.map((g) => g.name).join(', ')}`);
  };

  const updateGates = (ups: { id: string; gate: Gate }[]) => {
    if (!sample) return;
    updateWs((w) => {
      const s = w.samples.find((x) => x.id === sample.id)!;
      for (const u of ups) s.populations.find((p) => p.id === u.id)!.gate = u.gate;
      syncRoots(w, sample.id, ups.map((u) => u.id));
    });
  };

  const makeBoolean = (op: 'and' | 'or' | 'not') => {
    if (!sample || !multi.length) return;
    const first = sample.populations.find((p) => p.id === multi[0])!;
    const name = op === 'not' ? `NOT ${first.name}` : multi.map((id) => sample.populations.find((p) => p.id === id)!.name).join(op === 'and' ? ' & ' : ' | ');
    const id = newId('pop');
    updateWs((w) => {
      w.samples.find((x) => x.id === sample.id)!.populations.push({ id, name, parentId: first.parentId, gate: { type: 'boolean', op, operands: multi.map((ref) => ({ ref })) } });
    });
    setMulti([]);
  };

  const deletePop = (id: string) =>
    updateWs((w) => {
      const s = w.samples.find((x) => x.id === sample!.id)!;
      const dependants = s.populations.filter((p) => p.gate.type === 'boolean' && p.gate.operands.some((o) => o.ref === id));
      if (dependants.length) {
        note('warn', `Cannot delete: used by boolean gate(s) ${dependants.map((d) => d.name).join(', ')}`);
        return;
      }
      removePopulation(s, id);
      if (sel.popId === id) setSel({ sampleId: sample!.id, popId: null });
    });

  // --- exports --------------------------------------------------------------------
  const exportStatsCsv = () => {
    const head = ['Sample', ...ws.statColumns.map(colLabel)];
    const rows = groupSamples.map((s) => [s.fileName, ...(stats[s.id] ?? ws.statColumns.map(() => 'data not loaded')).map(fmtStat)]);
    download(`${group?.name ?? 'stats'}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n', 'text/csv');
  };

  const exportEvents = async (format: 'csv' | 'fcs', compensated: boolean) => {
    if (!sample || !sMeta) return;
    const bytes = await run(() =>
      client.exportEvents({
        sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices,
        // Unmixed fluorochromes exist only in compensated output.
        popId: sel.popId, format, channels: (compensated ? channels : sMeta.channels).map((c) => c.name), compensated,
      }),
    );
    if (!bytes) return;
    const base = `${sample.fileName.replace(/\.fcs$/i, '')}_${(popPath || 'All events').replace(/[^\w.-]+/g, '_')}`;
    download(`${base}.${format}`, bytes as BlobPart, format === 'csv' ? 'text/csv' : 'application/octet-stream');
    note('info', `Exported ${format.toUpperCase()} for ${popPath || 'All events'} (${compensated ? 'compensated' : 'uncompensated'})`);
  };

  const colLabel = (c: StatColumn) => `${c.populationPath || 'All events'}: ${STAT_LABELS[c.stat]}${c.stat === 'percentile' ? ` ${c.percentile}` : ''}${c.channel ? ` (${c.channel})` : ''}`;

  // --- render helpers -----------------------------------------------------------------
  const tree = (parentId: string | null, depth: number): React.ReactNode =>
    sample?.populations
      .filter((p) => p.parentId === parentId)
      .map((p) => {
        const r = counts[p.id];
        const pct = r && r.parentCount > 0 ? ((100 * r.count) / r.parentCount).toFixed(2) : '';
        const isSel = sel.popId === p.id;
        const r2 = analysis[sample.id]?.results.find((x) => x?.id === p.id);
        return (
          <div key={p.id}>
            <div
              className={`node ${isSel ? 'sel' : ''} ${multi.includes(p.id) ? 'multi' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              data-testid={`pop-${p.name}`}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) setMulti((m) => (m.includes(p.id) ? m.filter((x) => x !== p.id) : [...m, p.id]));
                else { setSel({ sampleId: sample.id, popId: p.id }); setMulti([]); }
              }}
              onDoubleClick={() => setRenaming(p.id)}
            >
              {renaming === p.id ? (
                <input
                  autoFocus
                  defaultValue={p.name}
                  aria-label="Population name"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v) updateWs((w) => { w.samples.find((s) => s.id === sample.id)!.populations.find((q) => q.id === p.id)!.name = v; }); setRenaming(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <span className="pname">{p.gate.type === 'boolean' ? `[${p.gate.op}] ` : ''}{p.name}</span>
              )}
              <span className="pcount" data-testid={`count-${p.name}`}>{r2?.error ? 'error' : r ? r.count.toLocaleString() : '-'}</span>
              <span className="ppct">{pct && `${pct}%`}</span>
            </div>
            {tree(p.id, depth + 1)}
          </div>
        );
      });

  const [newStat, setNewStat] = useState<{ stat: StatKind; channel: string; percentile: number }>({ stat: 'count', channel: '', percentile: 50 });

  return (
    <div className="app">
      <header className="toolbar">
        <b className="brand">flowjo-rea</b>
        <label className="file-btn">Add FCS files<input type="file" multiple accept=".fcs,.lmd,*" data-testid="add-fcs" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} /></label>
        <label className="file-btn">Open workspace / FlowJo .wsp<input type="file" accept=".json,.wsp,.frea" data-testid="open-ws" onChange={(e) => { const f = e.target.files?.[0]; if (f) openWorkspace(f); e.target.value = ''; }} /></label>
        <label className="file-btn">Import Gating-ML<input type="file" accept=".xml" data-testid="import-gml" onChange={(e) => { const f = e.target.files?.[0]; if (f) importGatingMl(f); e.target.value = ''; }} /></label>
        <button data-testid="save-ws" onClick={() => download(`${ws.name.replace(/\.(wsp|json)$/i, '') || 'workspace'}.frea.json`, serializeWorkspace(ws), 'application/json')}>Save workspace</button>
        <button disabled={!hist.past.length} onClick={() => setHist(undo)} data-testid="undo" title="Undo (Ctrl+Z)">Undo</button>
        <button disabled={!hist.future.length} onClick={() => setHist(redo)} data-testid="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
        <span className="sep" />
        <button disabled={!sample} onClick={() => setDialog({ kind: 'comp' })} data-testid="open-comp">Compensation</button>
        <button disabled={!sMeta} onClick={() => setDialog({ kind: 'keywords' })} data-testid="open-keywords">Keywords</button>
        <button disabled={!sample} onClick={() => setDialog({ kind: 'export' })} data-testid="open-export">Export</button>
        <button onClick={() => setDialog({ kind: 'layout' })} data-testid="open-layout">Layout ({ws.layout?.length ?? 0})</button>
        <span className="sep" />
        <span className="status" data-testid="busy">{busy > 0 ? 'Working...' : 'Ready'}</span>
      </header>
      <main className="layout">
        <section className="panel samples">
          <h3>Groups</h3>
          <div className="groups">
            {ws.groups.map((g) => (
              <div key={g.id} className={`node ${g.id === groupId ? 'sel' : ''}`} onClick={() => setGroupId(g.id)} data-testid={`group-${g.name}`}>
                <span className="pname">{g.name}</span><span className="pcount">{g.sampleIds.length}</span>
              </div>
            ))}
          </div>
          <div className="row">
            <button disabled={!checked.length} data-testid="new-group" onClick={() => {
              const name = `Group ${ws.groups.length}`;
              updateWs((w) => { w.groups.push({ id: newId('grp'), name, sampleIds: [...checked] }); });
              setChecked([]);
            }}>New group from checked</button>
            <button disabled={groupId === 'all'} onClick={() => { updateWs((w) => { w.groups = w.groups.filter((g) => g.id !== groupId); }); setGroupId('all'); }}>Delete group</button>
          </div>
          <h3>Samples ({groupSamples.length})</h3>
          {groupSamples.map((s) => (
            <div key={s.id} className={`node ${s.id === sel.sampleId ? 'sel' : ''}`} data-testid={`sample-${s.fileName}`} onClick={() => setSel({ sampleId: s.id, popId: s.id === sel.sampleId ? sel.popId : null })}>
              <input type="checkbox" checked={checked.includes(s.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((c) => (c.includes(s.id) ? c.filter((x) => x !== s.id) : [...c, s.id]))} aria-label={`check ${s.fileName}`} />
              <span className="pname" title={s.fileName}>{s.fileName}</span>
              <span className="pcount">{meta[s.id] ? s.eventCount.toLocaleString() : <i className="missing">data missing</i>}</span>
            </div>
          ))}
          {!ws.samples.length && <p className="muted">Add FCS files to begin. Data stays on this computer.</p>}
        </section>

        <section className="panel tree">
          <h3>Populations {sample && <span className="muted">- {sample.fileName}</span>}</h3>
          {sample && (
            <>
              <div className={`node ${sel.popId === null ? 'sel' : ''}`} onClick={() => setSel({ sampleId: sample.id, popId: null })} data-testid="pop-root">
                <span className="pname">All events</span>
                <span className="pcount">{meta[sample.id] ? sample.eventCount.toLocaleString() : '-'}</span>
              </div>
              {tree(null, 1)}
              <div className="row">
                <button disabled={multi.length < 2} onClick={() => makeBoolean('and')} title="Ctrl-click populations to multi-select">AND</button>
                <button disabled={multi.length < 2} onClick={() => makeBoolean('or')}>OR</button>
                <button disabled={multi.length !== 1} onClick={() => makeBoolean('not')}>NOT</button>
                <button disabled={!sel.popId} onClick={() => deletePop(sel.popId!)} data-testid="delete-pop">Delete</button>
              </div>
              <div className="row">
                <button disabled={!sel.popId} data-testid="apply-group" onClick={() => {
                  updateWs((w) => {
                    const msgs = applySubtree(w, sample.id, sel.popId!, w.groups.find((g) => g.id === groupId)!.sampleIds);
                    msgs.forEach((m) => note('warn', m));
                  });
                  note('info', `Applied "${popPath}" and its children to group ${group?.name}`);
                }}>Copy gate tree to group</button>
                <label title="Gate edits propagate to all samples in the current group"><input type="checkbox" checked={syncGroup} onChange={(e) => setSyncGroup(e.target.checked)} /> sync edits to group</label>
              </div>
              {analysis[sample.id]?.compError && <p className="error">Compensation: {analysis[sample.id]!.compError}</p>}
            </>
          )}
        </section>

        <section className="panel plot">
          {sample && sMeta && xAxis ? (
            <>
              <div className="row plot-controls">
                <select value={kind} onChange={(e) => setPlotSettings({ kind: e.target.value as PlotKind })} data-testid="plot-kind">
                  <option value="pseudocolor">Pseudocolor</option>
                  <option value="dot">Dot plot</option>
                  <option value="histogram">Histogram</option>
                  <option value="contour">Contour</option>
                </select>
                X <select value={plotSettings.x} onChange={(e) => setPlotSettings({ x: e.target.value })} data-testid="x-channel">
                  {channels.map((c) => <option key={c.name} value={c.name}>{c.label ? `${c.name} :: ${c.label}` : c.name}</option>)}
                </select>
                <button onClick={() => setDialog({ kind: 'transform', channel: plotSettings.x })} title="Axis scale" data-testid="x-scale">scale</button>
                {kind !== 'histogram' && (
                  <>
                    Y <select value={plotSettings.y ?? ''} onChange={(e) => setPlotSettings({ y: e.target.value })} data-testid="y-channel">
                      {channels.map((c) => <option key={c.name} value={c.name}>{c.label ? `${c.name} :: ${c.label}` : c.name}</option>)}
                    </select>
                    <button onClick={() => setDialog({ kind: 'transform', channel: plotSettings.y ?? '' })} title="Axis scale" data-testid="y-scale">scale</button>
                  </>
                )}
              </div>
              {kind === 'contour' && (
                <div className="row">
                  Level <select value={plotSettings.contourLevel ?? 5} onChange={(e) => setPlotSettings({ contourLevel: Number(e.target.value) })} data-testid="contour-level">
                    {[2, 5, 10, 20].map((v) => <option key={v} value={v}>{v}%</option>)}
                  </select>
                  <label><input type="checkbox" checked={!!plotSettings.showOutliers} onChange={(e) => setPlotSettings({ showOutliers: e.target.checked })} data-testid="contour-outliers" /> show outliers</label>
                  <span className="muted">equal-probability contours; not compared with FlowJo's placement</span>
                </div>
              )}
              <div className="row tools">
                {(kind === 'histogram' ? (['select', 'range'] as Tool[]) : (['select', 'rect', 'polygon', 'ellipse', 'quadrant'] as Tool[])).map((t) => (
                  <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(t)} data-testid={`tool-${t}`}>{t}</button>
                ))}
                <span className="muted">
                  {tool === 'polygon' ? 'click vertices; click first vertex or double-click to close' : tool === 'select' ? 'drag gates or vertices to edit' : tool === 'quadrant' ? 'click the quadrant centre' : 'drag to draw'}
                </span>
              </div>
              <Plot
                kind={kind}
                x={xAxis}
                y={yAxis}
                data={plotData}
                populations={sample.populations}
                parentId={sel.popId}
                counts={counts}
                tool={tool}
                selectedId={gateSel}
                onCreate={createGates}
                onUpdate={updateGates}
                onSelect={setGateSel}
                onRefuse={(m) => note('warn', m)}
                canvasRef={canvasRef}
                contourLevel={plotSettings.contourLevel ?? 5}
                showOutliers={!!plotSettings.showOutliers}
              />
              <div className="row">
                <button data-testid="add-to-layout" onClick={() => { updateWs((w) => { w.layout = [...(w.layout ?? []), { id: newId('lay'), populationPath: popPath, ...plotSettings }]; }); note('info', `Added ${popPath || 'All events'} (${plotSettings.x}${kind === 'histogram' ? '' : ` vs ${plotSettings.y}`}) to the layout`); }}>Add to layout</button>
              </div>
              <div className="muted" data-testid="plot-caption">
                {popPath || 'All events'}: {plotData ? plotData.count.toLocaleString() : '-'} events shown
                {plotData && (kind === 'dot' || (kind === 'contour' && plotSettings.showOutliers)) && plotData.points.length / 2 < plotData.count && ` (dot plot draws ${(plotData.points.length / 2).toLocaleString()} sampled events)`}
              </div>
            </>
          ) : (
            <p className="muted">{sample ? 'Sample data not loaded: add the FCS file to relink it.' : 'Select a sample.'}</p>
          )}
        </section>

        <section className="panel stats">
          <h3>Statistics - {group?.name}</h3>
          <div className="row">
            <select value={newStat.stat} onChange={(e) => setNewStat({ ...newStat, stat: e.target.value as StatKind })} data-testid="stat-kind">
              {Object.entries(STAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {STAT_NEEDS_CHANNEL(newStat.stat) && (
              <select value={newStat.channel} onChange={(e) => setNewStat({ ...newStat, channel: e.target.value })} data-testid="stat-channel">
                <option value="">channel...</option>
                {channels.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            )}
            {newStat.stat === 'percentile' && <input type="number" min={0} max={100} value={newStat.percentile} onChange={(e) => setNewStat({ ...newStat, percentile: Number(e.target.value) })} style={{ width: 60 }} />}
            <button
              data-testid="add-stat"
              disabled={!sample || (STAT_NEEDS_CHANNEL(newStat.stat) && !newStat.channel)}
              onClick={() => updateWs((w) => { w.statColumns.push({ id: newId('col'), populationPath: popPath, stat: newStat.stat, channel: STAT_NEEDS_CHANNEL(newStat.stat) ? newStat.channel : undefined, percentile: newStat.percentile }); })}
            >
              Add for "{popPath || 'All events'}"
            </button>
            <button disabled={!ws.statColumns.length} onClick={exportStatsCsv} data-testid="export-stats">Export CSV</button>
          </div>
          {ws.statColumns.length > 0 && (
            <div className="table-wrap">
              <table className="grid" data-testid="stats-table">
                <thead>
                  <tr>
                    <th>Sample</th>
                    {ws.statColumns.map((c) => (
                      <th key={c.id}>{colLabel(c)} <button className="x" onClick={() => updateWs((w) => { w.statColumns = w.statColumns.filter((x) => x.id !== c.id); })} aria-label="remove column">x</button></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupSamples.map((s) => (
                    <tr key={s.id}>
                      <td>{s.fileName}</td>
                      {ws.statColumns.map((c, i) => <td key={c.id}>{meta[s.id] ? fmtStat(stats[s.id]?.[i] ?? '...') : 'no data'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Log</h3>
          <div className="log" data-testid="log">
            {log.map((l, i) => <div key={i} className={l.level}>{l.text}</div>)}
          </div>
        </section>
      </main>

      {dialog?.kind === 'layout' && (
        <LayoutView
          ws={ws}
          meta={meta}
          samples={groupSamples}
          client={client}
          onChange={(items) => updateWs((w) => { w.layout = items; })}
          onDownload={(name, blob) => download(name, blob, 'image/png')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'keywords' && sMeta && <KeywordsDialog meta={sMeta} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'transform' && sMeta && (
        <TransformDialog
          channel={dialog.channel}
          spec={ws.channelTransforms[dialog.channel] ?? defaultTransform(channels.find((c) => c.name === dialog.channel)!, sMeta.keywords)}
          onClose={() => setDialog(null)}
          onApply={(spec) => { updateWs((w) => { w.channelTransforms[dialog.channel] = spec; }); setDialog(null); }}
        />
      )}
      {dialog?.kind === 'comp' && sample && (
        <CompensationDialog
          matrices={ws.matrices}
          meta={sMeta ?? null}
          current={sample.compensation}
          onClose={() => setDialog(null)}
          onSave={(m) => updateWs((w) => { w.matrices = m; })}
          onAssign={(ref, scope) => {
            updateWs((w) => {
              const ids = scope === 'sample' ? [sample.id] : w.groups.find((g) => g.id === groupId)!.sampleIds;
              for (const s of w.samples) if (ids.includes(s.id)) s.compensation = ref;
            });
            note('info', `Compensation set to ${ref} for ${scope === 'sample' ? sample.fileName : `group ${group?.name}`}`);
          }}
        />
      )}
      {dialog?.kind === 'export' && sample && (
        <ExportDialog
          popLabel={popPath || 'All events'}
          hasData={!!sMeta}
          onClose={() => setDialog(null)}
          onEvents={exportEvents}
          onPng={() => canvasRef.current?.toBlob((b) => b && download(`${sample.fileName}_${(popPath || 'all').replace(/[^\w.-]+/g, '_')}.png`, b, 'image/png'))}
          onGatingMl={() => {
            try {
              download(`${sample.fileName.replace(/\.fcs$/i, '')}_gates.xml`, exportGatingMl(sample.populations, ws.matrices, sample.compensation), 'application/xml');
            } catch (e) {
              note('error', `Gating-ML export: ${(e as Error).message}`);
            }
          }}
        />
      )}
    </div>
  );
}

function ExportDialog(p: { popLabel: string; hasData: boolean; onClose: () => void; onEvents: (f: 'csv' | 'fcs', comp: boolean) => void; onPng: () => void; onGatingMl: () => void }) {
  const [comp, setComp] = useState(true);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal" role="dialog" aria-label="Export">
        <div className="modal-head"><b>Export</b><button onClick={p.onClose}>x</button></div>
        <div className="modal-body">
          <h4>Gated events: {p.popLabel}</h4>
          <label><input type="checkbox" checked={comp} onChange={(e) => setComp(e.target.checked)} /> compensated values</label>
          <div className="row">
            <button disabled={!p.hasData} onClick={() => p.onEvents('csv', comp)} data-testid="export-csv">Events CSV</button>
            <button disabled={!p.hasData} onClick={() => p.onEvents('fcs', comp)} data-testid="export-fcs">Events FCS 3.1</button>
          </div>
          <h4>Plot and gates</h4>
          <div className="row">
            <button disabled={!p.hasData} onClick={p.onPng} data-testid="export-png">Plot PNG</button>
            <button onClick={p.onGatingMl} data-testid="export-gml">Gates as Gating-ML 2.0</button>
            <button disabled title="Not implemented: FlowJo .wsp writing has no validation path without FlowJo">FlowJo .wsp (not implemented)</button>
          </div>
          <p className="muted">Statistics CSV export is in the Statistics panel. Workspace save is in the toolbar.</p>
        </div>
      </div>
    </div>
  );
}

