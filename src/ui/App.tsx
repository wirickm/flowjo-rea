import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PopulationResult } from '../core/analysis';
import { exportGatingMl, gatingMlNames, parseGatingMl } from '../core/gatingml';
import { emptyWorkspace, newId, populationPath, uniqueName, type Gate, type Group, type KeywordRule, type PlotSettings, type Population, type StatColumn, type StatKind, type Workspace } from '../core/model';
import { addKeywordToAll, duplicatePopulation, replaceKeywords, pasteAnnotations, copyAnalysisToGroup, deleteGroupAnalysis, propagateOwnedEdits, renameGroupAnalysis, criteriaLabel, deletionRoots, fingerprint, subtreeIds, mergeImported, relinkTarget, removeSample, derivedParameterUsers, deserializeWorkspace, groupByKey, copyPopulations, pastePopulations, removePopulation, sampleValue, serializeWorkspace, syncLiveGroups } from '../core/project';
import type { PlotResult, SampleMeta } from '../core/service';
import { STAT_LABELS, STAT_NEEDS_CHANNEL, validPercentile } from '../core/stats';
import { statScales } from '../core/flowjoStats';
import { formatStat, statsCsv } from '../core/statsTable';
import { makeTransform, type TransformSpec } from '../core/transforms';
import { parseWsp } from '../core/wsp';
import { writeWsp } from '../core/wspWriter';
import { channelRange, defaultTransform, isScatterOrTime, makeAxis, sampleChannels, withStains } from './axes';
import { channelDisplayName } from '../core/fcs';
import { readMtx } from '../core/compFlowjo';
import { AddKeywordDialog, CompensationDialog, DerivedDialog, FindDialog, GateNamerDialog, KeywordsDialog, TransformDialog } from './Dialogs';
import { GroupDialog } from './GroupDialog';
import { ContextMenu, GateActions, ManualGateDialog, type MenuItem } from './GateActions';
import { everyNth, FLOWJO_FUNCTIONS, removeFromGroup, stainSet } from '../core/groupCriteria';
import { concatGroups, type ConcatMode, type HeaderFormat } from '../core/exportRules';
import { GRAPH_H, GRAPH_W, LayoutView } from './Layout';
import { COPY_TO_LAYOUT_POINT, placeRow } from '../core/layoutArrange';
import { PlatformsDialog } from './Platforms';
import { KineticsPanel } from './Kinetics';
import { defaultKinetics, KIN_KEYS, KIN_LABELS } from '../core/kinetics';
import type { Axis } from './gateGeometry';
import { Plot, TOOL_HINTS, TOOL_KEYS, TOOL_LABELS, TOOLS_1D, TOOLS_2D, type PlotKind, type Tool } from './Plot';
import { AUTO_GATE_BINS, bisectorNames, convertGate, gateLabel } from '../core/gateTools';
import { formatFreq, PLOT, renderPlot } from './renderPlot';
import { asCanvas, SvgContext } from './svgContext';
import { drawableGates } from './gateGeometry';
import { initHistory, pushHistory, redo, undo, type History } from './history';
import { createAnalysisClient } from './workerClient';
import { autoSaveMessage, CONFIRM, edgeWarning, loadPrefs, rememberDontAsk, savePrefs, shouldAutoSave, skipConfirm, type Prefs } from '../core/prefs';
import { PrefsDialog, TablesDialog } from './Editors';

const client = createAnalysisClient();

type Analysis = { results: PopulationResult[]; total: number; compError?: string };
type Dialog = null | { kind: 'addKeyword' } | { kind: 'find' } | { kind: 'group'; id: string | null } | { kind: 'comp' } | { kind: 'keywords' } | { kind: 'transform'; channel: string } | { kind: 'export' } | { kind: 'layout' } | { kind: 'derived' } | { kind: 'platforms' } | { kind: 'manual' } | { kind: 'prefs' } | { kind: 'tables' };

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

const fmtStat = formatStat;

export function App() {
  // Workspace with undo/redo history; every edit goes through setWs.
  const [hist, setHist] = useState<History<Workspace>>(() => initHistory(emptyWorkspace()));
  // "Disable Undo" is read when a workspace is created or opened (Workspace.undoEnabled;
  // specs 19.3): a later change applies to the next workspace, and history is never wiped.
  const undoOffRef = useRef<boolean>(loadPrefs().noUndo);
  const ws = hist.present;
  // FlowJo preferences (specs 16), kept in this browser.
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs());
  const setPrefs = (p: Prefs) => { setPrefsState(p); savePrefs(p); };
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  // Live groups are re-synchronised after every edit.
  const setWs = (next: Workspace | ((w: Workspace) => Workspace)) =>
    setHist((h) => {
      let w = typeof next === 'function' ? next(h.present) : next;
      const copy = structuredClone(w);
      if (syncLiveGroups(copy)) w = copy;
      // Preference "Disable Undo": edits replace the present state.
      return undoOffRef.current ? { ...h, present: w } : pushHistory(h, w);
    });
  const [meta, setMeta] = useState<Record<string, SampleMeta>>({});
  const [analysis, setAnalysis] = useState<Record<string, Analysis>>({});
  const [sel, setSel] = useState<{ sampleId: string | null; popId: string | null }>({ sampleId: null, popId: null });
  const [multi, setMulti] = useState<string[]>([]);
  const [groupId, setGroupId] = useState('all');
  const [tool, setTool] = useState<Tool>('select');
  const [plotData, setPlotData] = useState<PlotResult | null>(null);
  // Edge-event warning (GateWinController.updateEventsOnAxis): events in the
  // first or last display bin of each axis stand for events on the bound.
  const edge = (() => {
    const d = plotData;
    if (!d || !d.count) return null;
    const B = d.bins, c = { n: d.count, xLow: 0, xHigh: 0, yLow: 0, yHigh: 0 };
    if (d.density.length === B) { c.xLow = d.density[0]; c.xHigh = d.density[B - 1]; }
    else for (let i = 0; i < B; i++) { c.xLow += d.density[i * B]; c.xHigh += d.density[i * B + B - 1]; c.yLow += d.density[i]; c.yHigh += d.density[(B - 1) * B + i]; }
    return edgeWarning(prefs, c);
  })();
  const [overlayData, setOverlayData] = useState<{ label: string; data: PlotResult }[]>([]);
  const [log, setLog] = useState<{ level: 'info' | 'warn' | 'error'; text: string }[]>([]);
  const [busy, setBusy] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [stats, setStats] = useState<Record<string, (number | string)[]>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  // A drawn gate waiting for its name (Subpopulation Identification, specs 18.2).
  const [naming, setNaming] = useState<{ name: string; gate: Gate } | null>(null);
  const [gateSel, setGateSel] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [annKey, setAnnKey] = useState('');
  const [annVal, setAnnVal] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [nth, setNth] = useState(2);
  const [rule, setRule] = useState<{ keyword: string; op: KeywordRule['op']; value: string }>({ keyword: '', op: 'contains', value: '' });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const navRef = useRef<(d: number) => void>(() => {});
  const plotActions = useRef<{ scaleGate: (f: number) => boolean } | null>(null);
  const keyRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  const escRef = useRef<() => boolean>(() => false);
  const pasteTextRef = useRef<(text: string) => boolean>(() => false);
  // Anchored gating: the statistic column armed for the next histogram click.
  const [anchorCol, setAnchorCol] = useState<string | null>(null);
  // Workspace gate clipboard (FlowJo WSClipboard).
  const [clip, setClip] = useState<Population[] | null>(null);
  // In-app question with labelled answers; resolves to the chosen label or null (cancel).
  const [question, setQuestion] = useState<{ text: string; choices: string[]; resolve: (c: string | null) => void; dontAskKey?: string } | null>(null);
  const [dontAskTick, setDontAskTick] = useState(false);
  // dontAskKey: FlowJo's confirmations that offer "Don't ask again"; a
  // remembered key answers with the first choice without asking.
  const ask = (text: string, choices: string[], dontAskKey?: string) => {
    if (dontAskKey && skipConfirm(prefsRef.current, dontAskKey)) return Promise.resolve<string | null>(choices[0]);
    setDontAskTick(false);
    return new Promise<string | null>((resolve) => setQuestion({ text, choices, resolve, dontAskKey }));
  };

  // Auto-save (AutoSaveTask): every N minutes, a workspace already saved once
  // that has samples. Own rule: a browser cannot overwrite the saved file, so
  // the copy goes to this browser's storage for recovery.
  const [savedOnce, setSavedOnce] = useState(false);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  useEffect(() => {
    const id = setInterval(() => {
      const w = wsRef.current;
      if (!shouldAutoSave(prefsRef.current, savedOnce, w.samples.length)) return;
      try { localStorage.setItem('flowjo-rea.autosave', serializeWorkspace(w)); setLog((l) => [{ level: 'info' as const, text: autoSaveMessage(w.name, new Date()) }, ...l].slice(0, 200)); } catch { /* retried next time */ }
    }, Math.max(1, prefs.autoSaveMinutes) * 60000);
    return () => clearInterval(id);
  }, [savedOnce, prefs.autoSaveMinutes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Own rule (comparison C17): Escape closes the topmost menu or dialog.
      if (e.key === 'Escape' && escRef.current()) { e.preventDefault(); return; }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (keyRef.current(e)) { e.preventDefault(); return; }
      // Graph window Next / Previous Sample (specs 18.5): plain PageDown next,
      // PageUp previous (EditorController.doPageUpDown); with Ctrl/Cmd the menu
      // accelerators are reversed: PageUp next, PageDown previous (gw.nav).
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.altKey) {
        e.preventDefault();
        const menu = e.ctrlKey || e.metaKey;
        navRef.current((e.key === 'PageDown') !== menu ? 1 : -1);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'g') { e.preventDefault(); setDialog({ kind: 'manual' }); } // Manually Enter Gate... (FlowJo menu shortcut G)
      // FlowJo accelerators (specs 16.4): S save, Y preferences, E export,
      // L layout editor, T table editor.
      else if (k === 's' && !e.shiftKey) { e.preventDefault(); document.querySelector<HTMLButtonElement>('[data-testid=save-ws]')?.click(); }
      else if (k === 'y' && !e.shiftKey) { e.preventDefault(); setDialog({ kind: 'prefs' }); }
      else if (k === 'e') { e.preventDefault(); setDialog({ kind: 'export' }); }
      else if (k === 'l') { e.preventDefault(); setDialog({ kind: 'layout' }); }
      else if (k === 't') { e.preventDefault(); setDialog({ kind: 'tables' }); }
      else if (k === 'z' && !e.shiftKey) { e.preventDefault(); setHist(undo); }
      else if ((k === 'z' && e.shiftKey) || (k === 'y' && e.shiftKey)) { e.preventDefault(); setHist(redo); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text && pasteTextRef.current(text)) e.preventDefault();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
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

  // Like run, but the error also reaches the caller (shown in the window that asked).
  const runOrThrow = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy((b) => b + 1);
    try {
      return await fn();
    } catch (e) {
      note('error', (e as Error).message);
      throw e;
    } finally {
      setBusy((b) => b - 1);
    }
  }, [note]);

  const sample = ws.samples.find((s) => s.id === sel.sampleId) ?? null;
  const stainKey = JSON.stringify(sample?.stains ?? {});
  const sMeta = useMemo(() => (sample && meta[sample.id] ? withStains(meta[sample.id], sample.stains) : undefined), [sample?.id, meta, stainKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const group = ws.groups.find((g) => g.id === groupId) ?? ws.groups[0];
  const groupSamples = ws.samples.filter((s) => group?.sampleIds.includes(s.id));
  // Undo/redo can remove the selected population; fall back to its absence.
  const selPopValid = !!sample && !!sel.popId && sample.populations.some((p) => p.id === sel.popId);
  useEffect(() => {
    if (sel.popId && sample && !selPopValid) setSel({ sampleId: sample.id, popId: null });
  }, [sel.popId, sample, selPopValid]);
  const channels = useMemo(() => (sMeta && sample ? sampleChannels(sMeta, sample.compensation, ws.matrices, ws.derivedParameters) : []), [sMeta, sample?.compensation, ws.matrices, ws.derivedParameters]); // eslint-disable-line react-hooks/exhaustive-deps
  // FlowJo Graph Window axis title: "name :: stain" (specs 18.1).
  const axisTitle = (ch: string) => { const c = channels.find((x) => x.name === ch); return c ? channelDisplayName(c) : ch; };
  const annotationKeys = [...new Set(groupSamples.flatMap((s) => Object.keys(s.annotations ?? {})))].sort();
  const groupKeys = [...new Set([...annotationKeys, ...groupSamples.flatMap((s) => Object.keys(s.keywordsSnapshot))])].sort();
  const popPath = sample && sel.popId && selPopValid ? populationPath(sample.populations, sel.popId) : '';
  // Gating path of the selected population, root first (gw.breadcrumbbar; specs 18.5).
  const gatingPath: Population[] = [];
  for (let id = selPopValid ? sel.popId : null; sample && id; ) {
    const q = sample.populations.find((p) => p.id === id);
    if (!q) break;
    gatingPath.unshift(q);
    id = q.parentId;
  }
  // Next / Previous Sample: the nearest sample of the current group, in that
  // direction, that has the same population (GWActionManager.adjust enables the
  // commands only when one exists; specs 19.2); no wrap.
  const neighbour = (d: number): { s: typeof ws.samples[number]; popId: string | null } | null => {
    if (!sample) return null;
    const list = groupSamples.length ? groupSamples : ws.samples;
    for (let i = list.indexOf(sample) + d; i >= 0 && i < list.length && list.indexOf(sample) >= 0; i += d) {
      const t = list[i];
      if (!popPath) return { s: t, popId: null };
      const same = t.populations.find((p) => populationPath(t.populations, p.id) === popPath);
      if (same) return { s: t, popId: same.id };
    }
    return null;
  };
  const navSample = (d: number) => {
    const hit = neighbour(d);
    if (!hit) return;
    setSel({ sampleId: hit.s.id, popId: hit.popId });
    setMulti([]);
  };
  navRef.current = navSample;

  // --- file loading -------------------------------------------------------
  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      await run(async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // The same file is not added twice (FlowJo 10: same path; here: same content).
        const sha = await fingerprint(bytes);
        const dup = ws.samples.find((s) => meta[s.id] && s.fingerprint === sha);
        if (dup) return note('warn', `${file.name}: already loaded as ${dup.fileName}; not added again`);
        // Relink to a workspace sample without data when FlowJo 10's keyword test
        // matches ($TOT, $DATE, $BTIM, $BEGINDATA, $FIL; any file name); otherwise
        // the file is a new sample (specs 6.7). Keywords come from the file itself.
        const tmp = newId('s');
        let m = await client.load(tmp, file.name, bytes);
        const existing = relinkTarget(ws.samples, (sid) => !!meta[sid], m.keywords);
        const id = existing?.id ?? tmp;
        if (existing) {
          await client.rekey(tmp, id);
          m = existing.datasetIndex ? await client.selectDataset(id, existing.datasetIndex) : { ...m, sampleId: id };
          if (existing.fileName !== file.name) note('info', `${file.name}: keywords match workspace sample ${existing.fileName}; relinked`);
        }
        if (existing?.fingerprint && existing.fingerprint !== m.fingerprint) {
          note('warn', `${file.name}: content differs from the file recorded in the workspace (SHA-256 mismatch); relinked anyway`);
        }
        for (const w of m.warnings) note('warn', `${file.name}: ${w}`);
        setMeta((x) => ({ ...x, [id]: m }));
        setWs((w0) => {
          const w = structuredClone(w0);
          for (const c of m.channels) if (!w.channelTransforms[c.name]) w.channelTransforms[c.name] = defaultTransform(c, m.keywords);
          const snapshot: Record<string, string> = {};
          // Keep sample-level keywords for grouping; skip per-parameter and matrix keywords.
          for (const [k, v] of Object.entries(m.keywords)) if (!/^\$?P\d+[A-Z]$/.test(k) && !/SPILL|\$COMP/.test(k) && v.length <= 500) snapshot[k] = v;
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
    // FlowJo 10 opens a .wsp in a new window; here it replaces the open
    // workspace, so ask first when there is work to lose (specs 6.7).
    if (ws.samples.length || hist.past.length) {
      const a = await ask(`Open ${file.name}? It replaces the current workspace; unsaved changes are lost (Save workspace first to keep them).`, ['Open']);
      if (a !== 'Open') return;
    }
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
      undoOffRef.current = prefsRef.current.noUndo;
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
        parentId: p.parentId ? map(p.parentId) : null,
        gate: p.gate.type === 'boolean' ? { ...p.gate, operands: p.gate.operands.map((o) => ({ ...o, ref: map(o.ref) })) } : p.gate,
      }));
      // As in FlowJo 10 (specs 6.7): a gate whose name a sibling has replaces it,
      // silently when equivalent, after a question otherwise; never a duplicate.
      const dry = mergeImported(sample.populations, pops, sel.popId, 'keep', sample.compensation);
      let mode: 'replace' | 'keep' = 'keep';
      if (dry.conflicts.length) {
        const a = await ask(`${dry.conflicts.length} imported gate(s) have the name of an existing gate but a different shape: ${dry.conflicts.join(', ')}. Replace them?`, ['Replace', 'Keep existing']);
        if (a === null) return note('info', 'Gating-ML import cancelled');
        mode = a === 'Replace' ? 'replace' : 'keep';
      }
      const res = mergeImported(sample.populations, pops, sel.popId, mode, sample.compensation);
      updateWs((w) => {
        w.matrices.push(...doc.matrices.filter((m) => !w.matrices.some((x) => x.id === m.id)));
        w.samples.find((s) => s.id === sample.id)!.populations = res.populations;
      });
      for (const wmsg of doc.warnings) note('warn', wmsg);
      note('info', `Gating-ML import into ${sample.fileName}: ${res.added.length} added, ${res.same.length} already present${res.conflicts.length ? `, ${res.conflicts.length} ${mode === 'replace' ? 'replaced' : 'kept as they were'}` : ''}`);
    });
  };

  // Edits must not have side effects: React may run the updater twice
  // (StrictMode). Messages raised during an edit go through `say` and are
  // posted once, after the update.
  type Say = (level: 'info' | 'warn' | 'error', text: string) => void;
  const updateWs = (fn: (w: Workspace, say: Say) => void) => {
    let posted = false;
    setWs((w0) => {
      const w = structuredClone(w0);
      const msgs: [Parameters<Say>[0], string][] = [];
      fn(w, (level, text) => msgs.push([level, text]));
      if (!posted) {
        posted = true;
        queueMicrotask(() => msgs.forEach(([level, text]) => note(level, text)));
      }
      return w;
    });
  };

  // --- analysis -------------------------------------------------------------
  useEffect(() => {
    if (!sample || !meta[sample.id]) return;
    let live = true;
    const req = { sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices, derived: ws.derivedParameters };
    run(async () => {
      const a = await client.analyze(req);
      if (!live) return;
      setAnalysis((x) => ({ ...x, [sample.id]: a }));
      if (a.compError) note('error', `${sample.fileName}: compensation failed: ${a.compError}`);
      for (const r of a.results) if (r.error) note('error', `${sample.fileName} / ${r.name}: ${r.error}`);
    });
    return () => { live = false; };
  }, [sample?.id, sample?.compensation, sample?.populations, ws.matrices, meta, run, note]);

  // --- FlowJo-style window layout (specs 23) -------------------------------------
  // Default; "?layout=classic" or the Configure tab switches to the four-panel layout.
  const [uiLayout, setUiLayout] = useState<'flowjo' | 'classic'>(() => {
    try { const q = new URLSearchParams(location.search).get('layout'); if (q === 'classic' || q === 'flowjo') return q; return (localStorage.getItem('flowjo-rea.layout') as 'flowjo' | 'classic') || 'flowjo'; } catch { return 'flowjo'; }
  });
  const switchLayout = (l: 'flowjo' | 'classic') => { setUiLayout(l); try { localStorage.setItem('flowjo-rea.layout', l); } catch { /* per-viewer convenience */ } };
  const [ribbonTab, setRibbonTab] = useState('Workspace');
  const [drawer, setDrawer] = useState<'stats' | 'groups' | 'samples' | 'log' | null>('stats');
  const [collapsedSamples, setCollapsedSamples] = useState<string[]>([]);
  // The sample table shows every group sample's counts: analyse the others in the background.
  const analysedKey = useRef<Record<string, string>>({});
  useEffect(() => {
    if (uiLayout !== 'flowjo') return;
    let live = true;
    (async () => {
      for (const s of groupSamples) {
        if (!meta[s.id] || s.id === sample?.id) continue;
        const key = JSON.stringify([s.populations, s.compensation, ws.matrices.length, ws.derivedParameters?.length]);
        if (analysedKey.current[s.id] === key) continue;
        const a = await client.analyze({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters });
        if (!live) return;
        analysedKey.current[s.id] = key;
        setAnalysis((x) => ({ ...x, [s.id]: a }));
      }
    })().catch(() => { /* counts stay blank; the selected sample reports errors */ });
    return () => { live = false; };
  }, [uiLayout, groupSamples, meta, ws.matrices, ws.derivedParameters, sample?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Graph windows: one per opened node (GWFrame); the active one hosts the live
  // plot, the others keep a picture of their last view (own rule).
  type GraphWin = { id: string; sampleId: string; popId: string | null; x: number; y: number; snap?: string };
  const [wins, setWins] = useState<GraphWin[]>([]);
  const [activeWin, setActiveWin] = useState<string | null>(null);
  const winDrag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const snapActive = () => {
    const url = canvasRef.current?.toDataURL();
    if (activeWin && url) setWins((ws0) => ws0.map((w) => (w.id === activeWin ? { ...w, snap: url } : w)));
  };
  const focusWin = (w: GraphWin) => {
    if (w.id === activeWin) return;
    snapActive();
    setActiveWin(w.id);
    setSel({ sampleId: w.sampleId, popId: w.popId });
    setMulti([]);
  };
  const openWin = (sampleId: string, popId: string | null, duplicate = false) => {
    const found = !duplicate && wins.find((w) => w.sampleId === sampleId && w.popId === popId);
    if (found) return focusWin(found);
    snapActive();
    const id = newId('gw');
    const n = wins.length;
    setWins((ws0) => [...ws0, { id, sampleId, popId, x: 400 + (n % 6) * 34, y: 10 + (n % 6) * 28 }]);
    setActiveWin(id);
    setSel({ sampleId, popId });
    setMulti([]);
  };
  const closeWin = (id: string) => { setWins((ws0) => ws0.filter((w) => w.id !== id)); if (activeWin === id) setActiveWin(null); };
  // In-window navigation (gating path, double-click a gate, sample keys) moves the active window.
  useEffect(() => {
    if (!activeWin || !sel.sampleId) return;
    setWins((ws0) => ws0.map((w) => (w.id === activeWin && (w.sampleId !== sel.sampleId || w.popId !== sel.popId) ? { ...w, sampleId: sel.sampleId!, popId: sel.popId } : w)));
  }, [sel, activeWin]);
  // A single click in the sample table selects without moving a graph window.
  const selectInTable = (sampleId: string, popId: string | null, e?: React.MouseEvent) => {
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey) && popId && sampleId === sample?.id) { setMulti((m) => (m.includes(popId) ? m.filter((x) => x !== popId) : [...m, popId])); return; }
    if (activeWin) { snapActive(); setActiveWin(null); }
    setSel({ sampleId, popId });
    setMulti([]);
  };

  const plotSettings = useMemo(() => {
    const has = (ch: string | null) => !!ch && channels.some((c) => c.name === ch);
    const usable = (v: PlotSettings | undefined) => !!v && has(v.x) && (v.kind === 'histogram' || has(v.y));
    const saved = ws.plots?.[popPath];
    if (usable(saved)) return saved!;
    // A population never viewed opens with its parent's plot axes and type
    // (FlowJo 10 preferences displayOtherParams = false, child graph type
    // "Same as parent graph"; specs 18.4), else the nearest viewed ancestor's.
    let a = sample && sel.popId ? sample.populations.find((p) => p.id === sel.popId)?.parentId : undefined;
    while (sample && a !== undefined) {
      const path = a ? populationPath(sample.populations, a) : '';
      const up = ws.plots?.[path];
      if (usable(up)) return { x: up!.x, y: up!.y, kind: up!.kind };
      if (!a) break;
      a = sample.populations.find((p) => p.id === a)?.parentId ?? null;
    }
    const names = channels.map((c) => c.name);
    const x = names.find((n) => /^FSC-A$/i.test(n)) ?? names.find((n) => isScatterOrTime(n)) ?? names[0] ?? '';
    const y = names.find((n) => /^SSC-A$/i.test(n)) ?? names.find((n) => n !== x) ?? null;
    return { x, y, kind: 'pseudocolor' as PlotKind };
  }, [ws.plots, popPath, channels, sample, sel.popId]);
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
  const displayOpts = { grid: !!plotSettings.grid, largeDots: !!plotSettings.largeDots, medians: !!plotSettings.medians, gateNames: !plotSettings.hideGateNames, gateFreq: !plotSettings.hideGateFreq };
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
        derived: ws.derivedParameters,
        popId: sel.popId,
        x: { kind: 'channel', channel: xAxis.channel, transform: xAxis.spec },
        y: yAxis ? { kind: 'channel', channel: yAxis.channel, transform: yAxis.spec } : null,
        bins: yAxis ? 200 : 256,
        xRange: xAxis.range,
        yRange: yAxis ? yAxis.range : null,
        maxPoints: 20000,
      });
      if (live && d) setPlotData(d);
      // Overlays: same axes, each overlay population's own events.
      const ovs: { label: string; data: PlotResult }[] = [];
      for (const path of plotSettings.overlays ?? []) {
        const pop = sample.populations.find((p) => populationPath(sample.populations, p.id) === path);
        if (!pop) continue;
        const od = await client.plot({
          sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices, derived: ws.derivedParameters, popId: pop.id,
          x: { kind: 'channel', channel: xAxis.channel, transform: xAxis.spec },
          y: yAxis ? { kind: 'channel', channel: yAxis.channel, transform: yAxis.spec } : null,
          bins: yAxis ? 200 : 256, xRange: xAxis.range, yRange: yAxis ? yAxis.range : null, maxPoints: 5000,
        });
        ovs.push({ label: path, data: od });
      }
      if (live) setOverlayData(ovs);
    });
    return () => { live = false; };
  }, [sample?.id, sample?.compensation, sample?.populations, ws.matrices, meta, sel.popId, xAxis, yAxis, run, plotSettings.overlays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto gate: a 256 x 256 histogram of the plotted population (specs 10.5).
  const [autoCounts, setAutoCounts] = useState<{ counts: Float64Array; n: number } | null>(null);
  useEffect(() => {
    setAutoCounts(null);
    if (tool !== 'autogate' || !sample || !meta[sample.id] || !xAxis || !yAxis) return;
    let live = true;
    run(async () => {
      const B = AUTO_GATE_BINS;
      const d = await client.plot({
        sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices, derived: ws.derivedParameters, popId: sel.popId,
        x: { kind: 'channel', channel: xAxis.channel, transform: xAxis.spec }, y: { kind: 'channel', channel: yAxis.channel, transform: yAxis.spec },
        bins: B, xRange: xAxis.range, yRange: yAxis.range, maxPoints: 0,
      });
      if (!live || !d) return;
      const counts = new Float64Array(B * B);
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) counts[x * B + y] = d.density[y * B + x];
      setAutoCounts({ counts, n: d.count });
    });
    return () => { live = false; };
  }, [tool, sample?.id, sample?.compensation, sample?.populations, ws.matrices, meta, sel.popId, xAxis, yAxis, run]); // eslint-disable-line react-hooks/exhaustive-deps

  // Statistics of one sample from the current workspace (never a cached table value).
  const statsFor = (s: Workspace['samples'][number]) =>
    client.stats({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters, columns: ws.statColumns, kinetics: ws.kinetics, scales: statScales(ws.channelTransforms, s.flowjoLinearRanges, [...ws.statColumns.map((c) => c.channel), ...Object.values(ws.kinetics ?? {}).map((k) => k.yAxis)]) });

  // statistics table across the current group. Values that need recalculation
  // are cleared first, so the table shows "-" rather than old values (FlowJo 10,
  // specs 6.7).
  useEffect(() => {
    setStats({});
    if (!ws.statColumns.length) return;
    let live = true;
    const t = setTimeout(() => {
      for (const s of groupSamples) {
        if (!meta[s.id]) continue;
        run(async () => {
          const v = await statsFor(s);
          if (live && v) setStats((x) => ({ ...x, [s.id]: v }));
        });
      }
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [ws.statColumns, ws.samples, ws.matrices, ws.derivedParameters, ws.channelTransforms, groupId, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- gate editing ------------------------------------------------------------
  const counts = useMemo(() => {
    const out: Record<string, { count: number; parentCount: number }> = {};
    for (const r of (sample && analysis[sample.id]?.results) || []) if (r) out[r.id] = r;
    return out;
  }, [analysis, sample]);

  const movedGates = useMemo(() => {
    const out: Record<string, Gate> = {};
    for (const r of (sample && analysis[sample.id]?.results) || []) if (r?.moved) out[r.id] = r.moved;
    return out;
  }, [analysis, sample]);

  // Edits to group-owned gates of a synchronized group move them in every
  // member, as in FlowJo 10 (specs 7.2).
  const syncRoots = (w: Workspace, sampleId: string, popIds: string[], say: Say) => {
    for (const msg of propagateOwnedEdits(w, sampleId, popIds)) say('warn', msg);
  };

  // Names of the selected population's children, plus extra names to reserve.
  const siblingNames = (parentId: string | null, extra: string[] = []) => [...(sample?.populations.filter((p) => p.parentId === parentId).map((p) => p.name) ?? []), ...extra];

  const createGates = (gates: { name: string; gate: Gate }[]) => {
    if (!sample) return;
    const ids = gates.map(() => newId('pop'));
    // Sibling names stay unique: a taken name gets a "-N" suffix (specs 6.7).
    const names: string[] = [];
    for (const g of gates) names.push(uniqueName(g.name, siblingNames(sel.popId, names)));
    updateWs((w, say) => {
      const s = w.samples.find((x) => x.id === sample.id)!;
      gates.forEach((g, i) => s.populations.push({ id: ids[i], name: names[i], parentId: sel.popId, gate: g.gate }));
      syncRoots(w, sample.id, ids, say);
    });
    setTool('select');
    note('info', `Created ${names.join(', ')}`);
  };

  // FlowJo 10's rename dialog refuses a name a sibling already has (specs 6.7).
  const renamePop = (id: string, name: string) => {
    if (!sample) return;
    const p = sample.populations.find((q) => q.id === id);
    if (!p || !name || name === p.name) return;
    if (sample.populations.some((q) => q.id !== id && q.parentId === p.parentId && q.name === name)) {
      note('warn', `Name must be unique: "${name}" is already used by a sibling population`);
      return;
    }
    // FlowJo asks "The gate is group owned. Rename for all?" (specs 7.2).
    if (p.owningGroup) {
      void ask(`The gate is group owned. Rename "${p.name}" to "${name}" in every sample of the group?`, ['Rename for all', 'Only this sample']).then((a) => {
        if (a === 'Rename for all') updateWs((w) => renameGroupAnalysis(w, p.owningGroup!, populationPath(sample.populations, id), name));
        else if (a === 'Only this sample') updateWs((w) => { w.samples.find((s) => s.id === sample.id)!.populations.find((q) => q.id === id)!.name = name; });
      });
      return;
    }
    updateWs((w) => { w.samples.find((s) => s.id === sample.id)!.populations.find((q) => q.id === id)!.name = name; });
  };

  const updateGates = (ups: { id: string; gate: Gate }[]) => {
    if (!sample) return;
    updateWs((w, say) => {
      const s = w.samples.find((x) => x.id === sample.id)!;
      for (const u of ups) s.populations.find((p) => p.id === u.id)!.gate = u.gate;
      syncRoots(w, sample.id, ups.map((u) => u.id), say);
    });
  };

  // AND/OR take the Ctrl-click multi-selection; NOT takes the multi-selection
  // of one or, as in FlowJo 10, the normally selected population (specs 6.7).
  const notOperand = multi.length === 1 ? multi[0] : multi.length === 0 && selPopValid ? sel.popId : null;
  const makeBoolean = (op: 'and' | 'or' | 'not') => {
    const operands = op === 'not' ? (notOperand ? [notOperand] : []) : multi;
    if (!sample || !operands.length) return;
    const first = sample.populations.find((p) => p.id === operands[0])!;
    const name = uniqueName(op === 'not' ? `NOT ${first.name}` : operands.map((id) => sample.populations.find((p) => p.id === id)!.name).join(op === 'and' ? ' & ' : ' | '), siblingNames(first.parentId));
    const id = newId('pop');
    updateWs((w) => {
      w.samples.find((x) => x.id === sample.id)!.populations.push({ id, name, parentId: first.parentId, gate: { type: 'boolean', op, operands: operands.map((ref) => ({ ref })) } });
    });
    setMulti([]);
  };

  const deletePop = async (id: string) => {
    if (!sample) return;
    const pops = sample.populations;
    // As in FlowJo 10, deleting a quad also deletes its sibling quads on the same
    // parameters (specs 6.2), each with its subtree.
    const roots = deletionRoots(pops, id);
    const doomed = subtreeIds(pops, roots);
    const dependants = pops.filter((p) => !doomed.has(p.id) && p.gate.type === 'boolean' && p.gate.operands.some((o) => doomed.has(o.ref)));
    if (dependants.length) {
      note('warn', `Cannot delete: used by boolean gate(s) ${dependants.map((d) => d.name).join(', ')}`);
      return;
    }
    // Group-owned analysis (specs 7.2): a sample-owned node that contains
    // group-owned analysis cannot be deleted; a group-owned root asks how to
    // remove it from the group (this app has no group node in the tree, so
    // deleting a group-owned population is deleting it from its group).
    const owner = pops.find((p) => p.id === roots[0])?.owningGroup;
    if (!owner && [...doomed].some((d) => pops.find((p) => p.id === d)?.owningGroup)) {
      note('warn', `"${populationPath(pops, roots[0])}" could not be deleted, because it contains analysis owned by a group.`);
      return;
    }
    if (owner) {
      const gname = ws.groups.find((g) => g.id === owner)?.name ?? owner;
      const a = await ask(`The analysis that you are removing is shared by all samples of group "${gname}". Delete it from the workspace entirely, or give it to the samples of the group (all of them, or only the first)? Undo restores it.`, ['Allocate To Samples', 'Allocate To First Sample', 'Delete Entirely']);
      const choice = a === 'Allocate To Samples' ? 'allocateToSamples' : a === 'Allocate To First Sample' ? 'allocateToFirst' : a === 'Delete Entirely' ? 'deleteEntirely' : null;
      if (!choice) return;
      updateWs((w) => { for (const r of roots) deleteGroupAnalysis(w, owner, populationPath(pops, r), choice); });
      if (sel.popId && doomed.has(sel.popId) && choice !== 'allocateToSamples') setSel({ sampleId: sample.id, popId: null });
      return;
    }
    // FlowJo 10 always confirms a tree delete (specs 6.7).
    const what = roots.map((r) => `"${populationPath(pops, r)}"`).join(', ');
    const below = doomed.size - roots.length;
    const a = await ask(`Delete ${what}${roots.length > 1 ? ' (sibling quadrants are deleted together, as in FlowJo)' : ''}${below ? ` and the ${below} population(s) below` : ''}? Undo restores it.`, ['Delete'], CONFIRM.populations.key);
    if (a !== 'Delete') return;
    updateWs((w) => { const s = w.samples.find((x) => x.id === sample.id)!; for (const r of roots) removePopulation(s, r); });
    if (sel.popId && doomed.has(sel.popId)) setSel({ sampleId: sample.id, popId: null });
  };

  // --- exports --------------------------------------------------------------------
  // Export recalculates first, so it never writes a stale or missing table value.
  const exportStatsCsv = async () => {
    const rows = [];
    for (const s of groupSamples) {
      const v = meta[s.id] ? await run(() => statsFor(s)) : undefined;
      rows.push({ sample: s.fileName, annotations: annotationKeys.map((k) => s.annotations?.[k] ?? ''), values: v ?? ws.statColumns.map(() => 'data not loaded') });
    }
    download(`${group?.name ?? 'stats'}.csv`, statsCsv({ group: false, annotations: annotationKeys, columns: ws.statColumns.map(colLabel) }, rows), 'text/csv');
  };

  // Every group, one row per (group, sample); a sample in several groups appears once per group.
  const exportAllGroupsCsv = async () => {
    const allAnn = [...new Set(ws.samples.flatMap((s) => Object.keys(s.annotations ?? {})))].sort();
    const cache = new Map<string, (number | string)[]>();
    const rows = [];
    for (const g of ws.groups) {
      for (const id of g.sampleIds) {
        const s = ws.samples.find((x) => x.id === id);
        if (!s) continue;
        if (!cache.has(id)) {
          const v = meta[id] ? await run(() => statsFor(s)) : undefined;
          cache.set(id, v ?? ws.statColumns.map(() => 'data not loaded'));
        }
        rows.push({ group: g.name, sample: s.fileName, annotations: allAnn.map((k) => s.annotations?.[k] ?? ''), values: cache.get(id)! });
      }
    }
    download('all_groups.csv', statsCsv({ group: true, annotations: allAnn, columns: ws.statColumns.map(colLabel) }, rows), 'text/csv');
  };

  // Event export with FlowJo 10's options (specs 9).
  const exportEvents = async (o: EventExportOptions) => {
    if (!sample || !sMeta) return;
    const compensated = o.params !== 'uncompensated';
    const all = (compensated ? channels : sMeta.channels).map((c) => c.name);
    const names = o.params === 'custom' ? all.filter((n) => o.custom.includes(n)) : all;
    if (!names.length) { note('warn', 'Choose at least one parameter to export'); return; }
    const transforms: Record<string, TransformSpec> = {};
    for (const n of names) {
      const ch = channels.find((c) => c.name === n);
      transforms[n] = ws.channelTransforms[n] ?? (ch ? defaultTransform(ch, sMeta.keywords) : { kind: 'none' });
    }
    const base = (sid: string, popId: string | null) => {
      const s = ws.samples.find((x) => x.id === sid)!;
      return { sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters, popId, format: o.format, channels: names, compensated, maxEvents: o.maxEvents, header: o.header, writeHeader: o.writeHeader, transforms };
    };
    const ext = o.format === 'fcs' ? 'fcs' : 'csv';
    const type = o.format === 'fcs' ? 'application/octet-stream' : 'text/csv';
    const safe = (t: string) => t.replace(/[^\w.-]+/g, '_');
    if (o.mode === 'export') {
      const bytes = await run(() => client.exportEvents(base(sample.id, sel.popId)));
      if (!bytes) return;
      download(`${safe(`${sample.fileName.replace(/\.fcs$/i, '')}_${popPath || 'All events'}`)}.${ext}`, bytes as BlobPart, type);
      note('info', `Exported ${o.format} for ${popPath || 'All events'}${o.maxEvents !== undefined ? ` (no more than ${o.maxEvents} events)` : ''}`);
      return;
    }
    // Concatenate: the group's samples that have this population and data.
    const members = groupSamples.filter((s) => meta[s.id] && (!popPath || s.populations.some((p) => populationPath(s.populations, p.id) === popPath)));
    const groups = concatGroups(members, o.concat, (s, k) => sampleValue(s, k));
    let n = 0;
    for (const g of groups) {
      n++;
      const parts = g.map((s) => base(s.id, popPath ? s.populations.find((p) => populationPath(s.populations, p.id) === popPath)!.id : null));
      const bytes = await run(() => client.exportConcatenated(parts));
      if (!bytes) return;
      download(`${safe(`Concat_${n}_${popPath || 'All events'}`)}.${ext}`, bytes as BlobPart, type);
    }
    note('info', `Concatenated ${members.length} sample(s) into ${groups.length} file(s)`);
  };

  const colLabel = (c: StatColumn) => c.stat === 'kinetic' && c.kin ? `${c.populationPath || 'All events'}: ${KIN_LABELS[c.kin.key]} (${c.kin.timeslice})` : `${c.populationPath || 'All events'}: ${c.stat === 'freqOf' ? `Freq. of ${c.ancestor} (%)` : STAT_LABELS[c.stat]}${c.stat === 'percentile' ? ` ${c.percentile}` : ''}${c.channel ? ` (${c.channel}${c.correlate ? ` vs ${c.correlate}` : ''})` : ''}`;
  // Ancestors of the selected population, for "Freq. of" (specs 8.1).
  const ancestorNames = (() => {
    const out: string[] = [];
    let a = sample && sel.popId ? sample.populations.find((p) => p.id === sel.popId)?.parentId : null;
    while (a && sample) { const q = sample.populations.find((p) => p.id === a); if (!q) break; out.push(q.name); a = q.parentId; }
    return out;
  })();

  // --- clipboard (specs 19.4) ------------------------------------------------------
  // Copy takes the whole selection (WSClipboard.copy): the Ctrl-clicked
  // populations, else the selected one; sibling quadrants come along.
  const selIds = () => (multi.length ? multi : sel.popId ? [sel.popId] : []);
  const copySel = () => {
    if (!sample || !selIds().length) return;
    setClip(copyPopulations(sample.populations, selIds()));
    note('info', `Copied ${selIds().map((id) => `"${populationPath(sample.populations, id)}"`).join(', ')}`);
  };
  // Cut = Copy, then delete with the usual confirmation (WSClipboard.cut).
  // Own rule: one population at a time.
  const cutSel = () => {
    if (!sample || !sel.popId) return;
    if (multi.length > 1) return note('warn', 'Cut works on one population at a time; use Copy, then Delete');
    copySel();
    void deletePop(sel.popId);
  };
  // Paste under the same population paths in each target sample
  // (WSClipboard.internalPaste pastes under every selected node).
  const pasteTo = (sampleIds: string[]) => {
    if (!sample || !clip?.length) return;
    const paths = (multi.length ? multi : [sel.popId]).map((id) => (id ? populationPath(sample.populations, id) : ''));
    updateWs((w, say) => {
      for (const id of sampleIds) {
        const sw = w.samples.find((x) => x.id === id);
        if (!sw) continue;
        const targets: (string | null)[] = [];
        for (const path of paths) {
          if (!path) { targets.push(null); continue; }
          const t = sw.populations.find((p) => populationPath(sw.populations, p.id) === path);
          if (t) targets.push(t.id); else say('warn', `${sw.fileName}: no "${path}"; not pasted there`);
        }
        pastePopulations(sw, clip, targets).forEach((m) => say('warn', m));
      }
    });
    if (sampleIds.length > 1) note('info', `Pasted into ${sampleIds.length} samples`);
  };
  // Copy Image (GateWinController.doCopy): the plot as an image on the system clipboard.
  const copyPlotImage = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.toBlob((blob) => {
      const fail = () => note('error', 'There was an error adding the image to the system clipboard.');
      if (!blob || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return fail();
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => note('info', 'Plot image copied'), fail);
    }, 'image/png');
  };
  // Copy Table to Clipboard: HTML and plain text (tab separated).
  const copyTable = async () => {
    const head = ['Sample', ...annotationKeys, ...ws.statColumns.map(colLabel)];
    const rows = groupSamples.map((s) => [s.fileName, ...annotationKeys.map((k) => s.annotations?.[k] ?? ''), ...ws.statColumns.map((_, i) => (meta[s.id] ? String(fmtStat(stats[s.id]?.[i] ?? '-')) : 'no data'))]);
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`;
    const text = [head, ...rows].map((r) => r.join('\t')).join('\n');
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      else await navigator.clipboard.writeText(text);
      note('info', 'Table copied');
    } catch { note('error', 'Could not copy the table to the clipboard'); }
  };

  // Text paste into the sample table (KTreeTable.pasteFromSystemClipboard; specs
  // 20.1): rows fill the group's samples from the selected one down; one undo step.
  pasteTextRef.current = (text: string) => {
    if (clip?.length || !groupSamples.length) return false;
    const ids = groupSamples.map((s) => s.id);
    const start = Math.max(0, sample ? ids.indexOf(sample.id) : 0);
    updateWs((w, say) => {
      const n = pasteAnnotations(ids.map((id) => w.samples.find((s) => s.id === id)!), start, text, annotationKeys, checked);
      say(n ? 'info' : 'warn', n ? `Pasted keyword values into ${n} sample(s)` : 'Pasted text had no values to fill (the first row names the keyword columns)');
    });
    return true;
  };

  // --- drag and drop (specs 20.2) -------------------------------------------------
  // Files dropped on the window open by type (TreeTableDropListener.processDropFile);
  // a matrix dropped on a sample or group is applied there (compDrop).
  const POP_TYPE = 'application/x-flowjo-rea-population';
  const dropFiles = async (files: FileList, target?: { sampleId?: string; groupId?: string }) => {
    const list = Array.from(files);
    const ext = (f: File) => (f.name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
    const fcsFiles = list.filter((f) => ['fcs', 'lmd'].includes(ext(f)) || !/\./.test(f.name));
    if (fcsFiles.length) await addFiles(fcsFiles);
    for (const f of list) {
      const x = ext(f);
      if (['wsp', 'frea', 'json'].includes(x)) await openWorkspace(f);
      else if (x === 'mtx') {
        try {
          const m = { ...readMtx(await f.text(), f.name.replace(/\.[^.]+$/, '')), id: newId('m') };
          const ids = target?.groupId ? (ws.groups.find((g) => g.id === target.groupId)?.sampleIds ?? []) : target?.sampleId ? [target.sampleId] : [];
          updateWs((w) => { w.matrices.push(m); for (const s of w.samples) if (ids.includes(s.id)) s.compensation = m.id; });
          note('info', `Matrix "${m.name}" added${ids.length ? ` and applied to ${ids.length} sample(s)` : ''}`);
        } catch (e) { note('error', `${f.name}: ${(e as Error).message}`); }
      } else if (x === 'xml') await importGatingMl(f);
      else if (!fcsFiles.includes(f)) note('warn', `${f.name}: this file type cannot be opened here`);
    }
  };
  // A population dragged onto a sample, a population or a group is applied there
  // as a copy (TreeTableDropListener.initiateNodeDrop, GroupTableDropListener.drop).
  const dragPop = (e: React.DragEvent, popId: string) => {
    if (!sample) return;
    e.dataTransfer.setData(POP_TYPE, JSON.stringify({ sampleId: sample.id, popId }));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(POP_TYPE) || e.dataTransfer.types.includes('Files');
  const onDropOn = (target: { sampleId?: string; popId?: string | null; groupId?: string }) => (e: React.DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length) return void dropFiles(e.dataTransfer.files, target);
    const raw = e.dataTransfer.getData(POP_TYPE);
    if (!raw) return;
    const { sampleId, popId } = JSON.parse(raw) as { sampleId: string; popId: string };
    const from = ws.samples.find((x) => x.id === sampleId);
    if (!from) return;
    if (target.groupId) {
      updateWs((w, say) => copyAnalysisToGroup(w, sampleId, popId, target.groupId!).forEach((m) => say('warn', m)));
      note('info', `Applied "${populationPath(from.populations, popId)}" to group ${ws.groups.find((g) => g.id === target.groupId)?.name}`);
      return;
    }
    const clipPops = copyPopulations(from.populations, [popId]);
    const destId = target.sampleId ?? sample?.id;
    if (!destId) return;
    if (destId === sampleId && target.popId !== undefined && target.popId !== null && subtreeIds(from.populations, [popId]).has(target.popId)) return note('warn', 'A population cannot be dropped onto itself or its children');
    updateWs((w, say) => {
      const sw = w.samples.find((x) => x.id === destId)!;
      pastePopulations(sw, clipPops, [target.popId ?? null]).forEach((m) => say('warn', m));
    });
  };

  // Text copies from the graph (GWAction.copyText / copyStatistics; specs 20.4).
  const copyText = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => note('info', `${what} copied`), () => note('error', `Could not copy the ${what.toLowerCase()} to the clipboard`));
  // Copy Histogram Function: one row per display bin, the bin centre in scale
  // units and its count (own layout; FlowJo's text form was not read).
  const copyHistogram = () => {
    if (!plotData || kind !== 'histogram' || !xAxis) return;
    const B = plotData.bins, [a, b] = xAxis.range;
    const rows = [`${axisTitle(xAxis.channel)}\tCount`];
    for (let i = 0; i < B; i++) rows.push(`${+xAxis.t.inverse(a + ((i + 0.5) / B) * (b - a)).toPrecision(6)}\t${plotData.density[i]}`);
    void copyText(rows.join('\n'), 'Histogram');
  };
  // Copy Statistics: the selected population's statistic values, one per line.
  const copyStatistics = () => {
    if (!sample) return;
    const cols = ws.statColumns.map((c, i) => [c, i] as const).filter(([c]) => c.populationPath === popPath);
    if (!cols.length) return note('warn', `No statistics for "${popPath || 'All events'}"; add one first`);
    void copyText(cols.map(([c, i]) => `${colLabel(c)}\t${fmtStat(stats[sample.id]?.[i] ?? '-')}`).join('\n'), 'Statistics');
  };
  const plotMenu = (popId: string | null, x: number, y: number) => {
    if (!sample) return;
    const pop = popId ? sample.populations.find((p) => p.id === popId) : undefined;
    const conv = (to: 'polygon' | 'rect' | 'ellipse', label: string): MenuItem => ({ label, disabled: !pop || !convertGate(pop.gate, to), onClick: () => { const g = pop && convertGate(pop.gate, to); if (g) updateGates([{ id: pop!.id, gate: g }]); } });
    const items: MenuItem[] = [
      ...(pop ? [
        { label: 'Rename...', onClick: () => setRenaming(pop.id) },
        { label: 'Clear', onClick: () => void deletePop(pop.id) },
        null,
        conv('polygon', 'Convert to Polygon'), conv('rect', 'Convert to Rectangle'), conv('ellipse', 'Convert to Ellipse'),
        null,
        { label: 'Increase Size', onClick: () => { if (!plotActions.current?.scaleGate(1.1)) note('warn', 'Only polygon, rectangle and ellipse gates change size'); } },
        { label: 'Decrease Size', onClick: () => { if (!plotActions.current?.scaleGate(1 / 1.1)) note('warn', 'Only polygon, rectangle and ellipse gates change size'); } },
        null,
      ] as MenuItem[] : []),
      { label: 'Add Statistic', onClick: () => addStatFor(pop ? populationPath(sample.populations, pop.id) : popPath) },
      { label: 'Copy Image', onClick: copyPlotImage },
      { label: 'Copy Histogram Function', disabled: kind !== 'histogram', onClick: copyHistogram },
      { label: 'Copy Statistics', onClick: copyStatistics },
      { label: 'Copy to Layout Editor', onClick: () => document.querySelector<HTMLButtonElement>('[data-testid=add-to-layout]')?.click() },
    ];
    setCtx({ x, y, items });
  };

  escRef.current = () => {
    if (ctx) { setCtx(null); return true; }
    if (naming) { setNaming(null); note('info', 'Gate discarded'); return true; }
    if (question) { question.resolve(null); setQuestion(null); return true; }
    if (dialog) { setDialog(null); return true; }
    return false;
  };

  // Expand / Collapse (specs 22.4): a node and its whole subtree; "all" covers every sample.
  const setCollapsed = (ids: string[] | 'all', collapsed: boolean, sampleId = sample?.id) => updateWs((w) => {
    for (const s of w.samples) {
      if (ids !== 'all' && s.id !== sampleId) continue;
      const scope = ids === 'all' ? new Set(s.populations.map((p) => p.id)) : subtreeIds(s.populations, ids);
      for (const p of s.populations) if (scope.has(p.id)) { if (collapsed) p.collapsed = true; else delete p.collapsed; }
    }
  });
  // Select Equivalent Nodes (specs 22.4): the same path in every sample of the
  // current group; this app checks those samples (its cross-sample selection).
  const selectEquivalent = () => {
    if (!sample) return;
    const ids = groupSamples.filter((s) => !popPath || s.populations.some((p) => populationPath(s.populations, p.id) === popPath)).map((s) => s.id);
    setChecked(ids);
    note('info', `"${popPath || 'All events'}" is in ${ids.length} sample(s) of group ${group?.name}; they are checked`);
  };
  const duplicateSel = (id: string) => sample && updateWs((w, say) => duplicatePopulation(w.samples.find((x) => x.id === sample.id)!, id).forEach((m) => say('warn', m)));

  // --- shortcuts (specs 19.1) ----------------------------------------------------
  // One page stands in for FlowJo's windows: with the plot focused the graph
  // window's accelerators apply, otherwise the workspace's (FJRibbonFrame and
  // GraphWinMenuBar keep separate maps; FJAction.lookupAccelerator adds the menu key).
  keyRef.current = (e: KeyboardEvent): boolean => {
    const inPlot = (document.activeElement as HTMLElement | null)?.dataset?.testid === 'plot-canvas';
    const menu = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (!menu) {
      // Workspace tree: Delete / Backspace deletes the selection (KTreeTable.keyPressed).
      if (!inPlot && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace') && sample && sel.popId) { void deletePop(sel.popId); return true; }
      return false;
    }
    if (!sample) return false;
    if (inPlot) {
      const names = channels.map((c) => c.name);
      // No wrap: at either end nothing changes (C2, specs 22.3).
      const step = (cur: string | null, d: number) => names[Math.min(names.length - 1, Math.max(0, names.indexOf(cur ?? '') + d))];
      if (k === 'c' && !e.shiftKey) { copyPlotImage(); return true; }
      if (k === 'f' && !e.shiftKey && kind === 'histogram') { copyHistogram(); return true; } // Copy Histogram Function (gw.copy.histogram)
      if (k === 't' && kind !== 'histogram' && plotSettings.y) { setPlotSettings({ x: plotSettings.y, y: plotSettings.x }); return true; } // Transpose
      if (k === 'k' && !e.shiftKey) { setPlotSettings({ x: step(plotSettings.x, 1) }); return true; } // Next X
      if (k === 'j' && !e.shiftKey) { setPlotSettings({ x: step(plotSettings.x, -1) }); return true; } // Previous X
      if (k === 'y' && kind !== 'histogram') { setPlotSettings({ y: step(plotSettings.y, e.shiftKey ? -1 : 1) }); return true; } // Next Y; previous Y own key (FlowJo's is F10)
      if (k === 'u' && !e.shiftKey) { if (sel.popId) setSel({ sampleId: sample.id, popId: sample.populations.find((p) => p.id === sel.popId)?.parentId ?? null }); return true; } // Up to Parent
      if (k === 'o' && !e.shiftKey) { if (gateSel) setSel({ sampleId: sample.id, popId: gateSel }); return true; } // Open Child
      return false; // Ctrl+G manual gate etc. fall through
    }
    if (k === 'c' && !e.shiftKey) { copySel(); return true; }
    if (k === 'x' && !e.shiftKey) { cutSel(); return true; }
    // Nodes first; with no copied populations the browser's paste event brings
    // the system clipboard's text (WSClipboard.paste, WSViewMgr.pasteText).
    if (k === 'v' && !e.shiftKey && clip?.length) { pasteTo(checked.length ? [...new Set([sample.id, ...checked])] : [sample.id]); return true; }
    if (k === 'b' && !e.shiftKey) { document.querySelector<HTMLButtonElement>('[data-testid=add-stat]')?.click(); return true; } // Add Statistic
    if (k === 'i' && !e.shiftKey) { setDialog({ kind: 'keywords' }); return true; } // Inspect
    if (k === 'g' && !e.shiftKey) { setDialog({ kind: 'group', id: null }); return true; } // Create Group (workspace)
    if (k === 'g' && e.shiftKey) { document.querySelector<HTMLButtonElement>('[data-testid=apply-group]')?.click(); return true; } // Copy analysis to group
    if (e.shiftKey && (k === 'a' || k === 'o') && multi.length >= 2) { makeBoolean(k === 'a' ? 'and' : 'or'); return true; }
    if (e.shiftKey && k === 'n' && notOperand) { makeBoolean('not'); return true; }
    if (k === 'u') { setCollapsed('all', e.shiftKey); setCollapsedSamples(e.shiftKey ? groupSamples.map((x) => x.id) : []); return true; } // Expand All / Collapse All
    if (k === 'e' && e.shiftKey) { selectEquivalent(); return true; } // Select Equivalent Nodes
    if (k === 'i' && e.shiftKey) { setDialog({ kind: 'addKeyword' }); return true; } // Add Keyword
    if (k === 'f' && !e.shiftKey) { setDialog({ kind: 'find' }); return true; } // Find
    return false;
  };

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
              onContextMenu={(e) => { e.preventDefault(); popMenu(sample, p.id, e.clientX, e.clientY); }}
              draggable={renaming !== p.id}
              onDragStart={(e) => dragPop(e, p.id)}
              onDragOver={(e) => accepts(e) && e.preventDefault()}
              onDrop={onDropOn({ sampleId: sample.id, popId: p.id })}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) setMulti((m) => (m.includes(p.id) ? m.filter((x) => x !== p.id) : [...m, p.id]));
                else { setSel({ sampleId: sample.id, popId: p.id }); setMulti([]); }
              }}
              onDoubleClick={() => setRenaming(p.id)}
            >
              {sample.populations.some((q) => q.parentId === p.id) ? (
                <span className="twisty" data-testid={`twisty-${p.name}`} title={p.collapsed ? 'Expand' : 'Collapse'} onClick={(e) => { e.stopPropagation(); setCollapsed([p.id], !p.collapsed); }}>{p.collapsed ? '+' : '-'}</span>
              ) : <span className="twisty" />}
              {renaming === p.id ? (
                <input
                  autoFocus
                  defaultValue={p.name}
                  aria-label="Population name"
                  onBlur={(e) => { renamePop(p.id, e.target.value.trim()); setRenaming(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <span className="pname">{p.gate.type === 'boolean' ? `[${p.gate.op}] ` : ''}{p.exclude ? '[excl] ' : ''}{p.name}{p.owningGroup && <span className="muted" title={`Owned by group "${ws.groups.find((g) => g.id === p.owningGroup)?.name ?? p.owningGroup}"`}> (G)</span>}</span>
              )}
              <span className="pcount" data-testid={`count-${p.name}`}>{r2?.error ? 'error' : r ? r.count.toLocaleString() : '-'}</span>
              <span className="ppct">{pct && `${pct}%`}</span>
            </div>
            {!p.collapsed && tree(p.id, depth + 1)}
          </div>
        );
      });

  const [newStat, setNewStat] = useState<{ stat: StatKind; channel: string; percentile: number; ancestor: string; correlate: string }>({ stat: 'count', channel: '', percentile: 50, ancestor: '', correlate: '' });
  const statReady = !((STAT_NEEDS_CHANNEL(newStat.stat) && !newStat.channel) || (newStat.stat === 'percentile' && !validPercentile(newStat.percentile)) || (newStat.stat === 'correlation' && !newStat.correlate) || (newStat.stat === 'freqOf' && !newStat.ancestor));
  const addStatFor = (path: string) => {
    if (!statReady) return note('warn', 'Choose the statistic (and its parameter) in the Statistics panel first');
    updateWs((w) => { w.statColumns.push({ id: newId('col'), populationPath: path, stat: newStat.stat, channel: STAT_NEEDS_CHANNEL(newStat.stat) ? newStat.channel : undefined, percentile: newStat.percentile, ...(newStat.stat === 'freqOf' ? { ancestor: newStat.ancestor } : {}), ...(newStat.stat === 'correlation' ? { correlate: newStat.correlate } : {}) }); });
  };
  // Right-click menus (SampleTreeTable.buildPopup, GatePanel.makeGatePopupMenu; specs 20.3).
  const [ctx, setCtx] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const popMenu = (s: typeof ws.samples[number], popId: string | null, x: number, y: number) => {
    const path = popId ? populationPath(s.populations, popId) : '';
    const pop = popId ? s.populations.find((p) => p.id === popId) : undefined;
    setSel({ sampleId: s.id, popId });
    setMulti([]);
    const items: MenuItem[] = popId ? [
      { label: 'Copy', onClick: () => { setClip(copyPopulations(s.populations, [popId])); note('info', `Copied "${path}"`); } },
      { label: 'Paste', disabled: !clip?.length, onClick: () => updateWs((w, say) => pastePopulations(w.samples.find((x) => x.id === s.id)!, clip!, [popId]).forEach((m) => say('warn', m))) },
      { label: 'Rename', onClick: () => setRenaming(popId) },
      { label: 'Delete', onClick: () => void deletePop(popId) },
      { label: 'Duplicate', onClick: () => duplicateSel(popId) },
      null,
      { label: 'Add Keyword...', onClick: () => setDialog({ kind: 'addKeyword' }) },
      { label: 'Add Statistic', onClick: () => addStatFor(path) },
      null,
      { label: 'Inspect...', onClick: () => setDialog({ kind: 'keywords' }) },
      null,
      { label: 'Copy analysis to group', disabled: pop?.owningGroup === groupId, onClick: () => { updateWs((w, say) => copyAnalysisToGroup(w, s.id, popId, groupId).forEach((m) => say('warn', m))); note('info', `Applied "${path}" and its children to group ${group?.name}`); } },
      null,
      { label: 'Select Equivalent Nodes', onClick: selectEquivalent },
      { label: pop?.collapsed ? 'Expand' : 'Collapse', disabled: !s.populations.some((q) => q.parentId === popId), onClick: () => setCollapsed([popId], !pop?.collapsed, s.id) },
      null,
      { label: 'Export / Concatenate...', onClick: () => setDialog({ kind: 'export' }) },
    ] : [
      { label: 'Paste', disabled: !clip?.length, onClick: () => updateWs((w, say) => pastePopulations(w.samples.find((x) => x.id === s.id)!, clip!, [null]).forEach((m) => say('warn', m))) },
      { label: 'Add Statistic', onClick: () => addStatFor('') },
      null,
      { label: 'Inspect...', onClick: () => setDialog({ kind: 'keywords' }) },
      null,
      { label: 'Export / Concatenate...', onClick: () => setDialog({ kind: 'export' }) },
    ];
    setCtx({ x, y, items });
  };

  // Sample tree-table rows (SampleTreeTable): samples, their populations and
  // statistic nodes; Statistic = frequency of parent, #Cells = count.
  const sampleTableRows = (): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    for (const s of groupSamples) {
      const isSel = sel.sampleId === s.id;
      const open = !collapsedSamples.includes(s.id);
      const res = analysis[s.id]?.results ?? [];
      const hasPops = s.populations.length > 0;
      rows.push(
        <tr key={s.id} className={`fj-row sample ${isSel && !sel.popId ? 'sel' : ''}`} data-testid={`row-${s.fileName}`}
          onClick={(e) => selectInTable(s.id, null, e)} onDoubleClick={() => openWin(s.id, null)}
          onContextMenu={(e) => { e.preventDefault(); popMenu(s, null, e.clientX, e.clientY); }}
          onDragOver={(e) => accepts(e) && e.preventDefault()} onDrop={onDropOn({ sampleId: s.id, popId: null })}>
          <td><span className="twisty" onClick={(e) => { e.stopPropagation(); setCollapsedSamples((c) => (c.includes(s.id) ? c.filter((x) => x !== s.id) : [...c, s.id])); }}>{hasPops ? (open ? '-' : '+') : ''}</span>{meta[s.id] ? s.fileName : <i className="missing">{s.fileName} (data missing)</i>}</td>
          <td />
          <td className="num">{meta[s.id] ? s.eventCount.toLocaleString() : ''}</td>
        </tr>,
      );
      if (!open) continue;
      const walk = (parentId: string | null, depth: number) => {
        for (const p of s.populations.filter((q) => q.parentId === parentId)) {
          const r = res.find((x) => x?.id === p.id);
          const path = populationPath(s.populations, p.id);
          const kids = s.populations.some((q) => q.parentId === p.id);
          const statCols = ws.statColumns.map((c, i) => [c, i] as const).filter(([c]) => c.populationPath === path);
          rows.push(
            <tr key={`${s.id}:${p.id}`} className={`fj-row ${isSel && sel.popId === p.id ? 'sel' : ''} ${isSel && multi.includes(p.id) ? 'multi' : ''}`} data-testid={`row-${s.fileName}/${path}`}
              onClick={(e) => selectInTable(s.id, p.id, e)} onDoubleClick={() => openWin(s.id, p.id)}
              onContextMenu={(e) => { e.preventDefault(); popMenu(s, p.id, e.clientX, e.clientY); }}
              onDragOver={(e) => accepts(e) && e.preventDefault()} onDrop={onDropOn({ sampleId: s.id, popId: p.id })}>
              <td style={{ paddingLeft: 6 + depth * 16 }}>
                <span className="twisty" onClick={(e) => { e.stopPropagation(); if (kids || statCols.length) setCollapsed([p.id], !p.collapsed, s.id); }}>{kids || statCols.length ? (p.collapsed ? '+' : '-') : ''}</span>
                {renaming === p.id && isSel ? (
                  <input autoFocus defaultValue={p.name} aria-label="Population name" onBlur={(e) => { renamePop(p.id, e.target.value.trim()); setRenaming(null); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                ) : <span onDoubleClick={(e) => { if (isSel && sel.popId === p.id && e.altKey) { e.stopPropagation(); setRenaming(p.id); } }}>{p.gate.type === 'boolean' ? `[${p.gate.op}] ` : ''}{p.exclude ? '[excl] ' : ''}{p.name}{p.owningGroup ? ' (G)' : ''}</span>}
              </td>
              <td className="num">{r && r.parentCount > 0 ? formatFreq((100 * r.count) / r.parentCount) : ''}</td>
              <td className="num">{r?.error ? 'error' : r ? r.count.toLocaleString() : ''}</td>
            </tr>,
          );
          if (p.collapsed) continue;
          for (const [c, i] of statCols) rows.push(
            <tr key={`${s.id}:${p.id}:${c.id}`} className="fj-row stat" data-testid={`row-${s.fileName}/${path}#${colLabel(c)}`}>
              <td style={{ paddingLeft: 22 + (depth + 1) * 16 }}>{colLabel(c).replace(`${path}: `, '')}</td>
              <td className="num">{meta[s.id] ? fmtStat(stats[s.id]?.[i] ?? '') : ''}</td>
              <td />
            </tr>,
          );
          walk(p.id, depth + 1);
        }
      };
      walk(null, 1);
    }
    return rows;
  };

  // Panel contents, shared by the classic layout and the FlowJo-style layout.
  const groupsBlock = (<>
          <h3>Groups</h3>
          <div className="groups">
            {ws.groups.map((g) => (
              <div key={g.id} className={`node ${g.id === groupId ? 'sel' : ''}`} onDragOver={(e) => accepts(e) && e.preventDefault()} onDrop={onDropOn({ groupId: g.id })} onClick={() => setGroupId(g.id)} onDoubleClick={() => g.id !== 'all' && setRenaming(`group:${g.id}`)} data-testid={`group-${g.name}`}>
                {renaming === `group:${g.id}` ? (
                  <input
                    autoFocus
                    defaultValue={g.name}
                    aria-label="Group name"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== g.name && ws.groups.some((x) => x.id !== g.id && x.name === v)) note('warn', `Name must be unique: a group "${v}" already exists`);
                      else if (v && v !== g.name) updateWs((w) => { w.groups.find((x) => x.id === g.id)!.name = v; });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="pname" style={{ color: g.color, fontWeight: g.fontStyle === 'bold' ? 'bold' : undefined, fontStyle: g.fontStyle === 'italic' ? 'italic' : undefined }}>{g.name}</span>
                )}
                {g.criteria && <span className="muted" title={`live: ${criteriaLabel(g.criteria)}`}>live</span>}
                <span className="pcount">{g.sampleIds.length}</span>
              </div>
            ))}
          </div>
          <div className="row">
            <button disabled={!checked.length} data-testid="new-group" onClick={() => {
              const name = uniqueName(`Group ${ws.groups.length}`, ws.groups.map((g) => g.name));
              updateWs((w) => { w.groups.push({ id: newId('grp'), name, sampleIds: [...checked] }); });
              setChecked([]);
            }}>New group from checked</button>
            <button disabled={groupId === 'all'} data-testid="delete-group" onClick={async () => {
              // FlowJo asks before deleting a group (ws.groupmgr.deleteprompt).
              const g = ws.groups.find((x) => x.id === groupId);
              if (!g || (await ask(`Delete group "${g.name}"? Its samples stay in the workspace. Undo restores it.`, ['Delete'])) !== 'Delete') return;
              updateWs((w) => { w.groups = w.groups.filter((x) => x.id !== groupId); });
              setGroupId('all');
            }}>Delete group</button>
          </div>
          <div className="row">
            <button data-testid="create-group" onClick={() => setDialog({ kind: 'group', id: null })}>Create group...</button>
            <button disabled={groupId === 'all'} data-testid="edit-group" onClick={() => setDialog({ kind: 'group', id: groupId })}>Modify group...</button>
          </div>
          <div className="row">
            <select value={groupKey} onChange={(e) => setGroupKey(e.target.value)} data-testid="group-key" style={{ maxWidth: 140 }}>
              <option value="">group by...</option>
              {groupKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button disabled={!groupKey} data-testid="group-by" onClick={() => {
              updateWs((w) => { groupByKey(w, groupKey); });
              note('info', `Groups by ${groupKey} created; their membership updates as samples and annotations change (a new value does not create a new group)`);
            }}>Make groups</button>
          </div>
          <div className="row">
            <select value={rule.keyword} onChange={(e) => setRule({ ...rule, keyword: e.target.value })} data-testid="rule-key" style={{ maxWidth: 100 }}>
              <option value="">keyword...</option>
              {groupKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={rule.op} onChange={(e) => setRule({ ...rule, op: e.target.value as KeywordRule['op'] })} data-testid="rule-op">
              {FLOWJO_FUNCTIONS.map((f) => <option key={f.op} value={f.op}>{f.text}</option>)}
              <option value="startsWith">starts with (not in FlowJo)</option>
              <option value="endsWith">ends with (not in FlowJo)</option>
            </select>
            <input placeholder="value" value={rule.value} onChange={(e) => setRule({ ...rule, value: e.target.value })} style={{ width: 70 }} data-testid="rule-value" />
            <button disabled={!rule.keyword} data-testid="rule-group" onClick={() => {
              const r: KeywordRule = { connector: 'and', ...rule };
              const name = uniqueName(`${rule.keyword} ${rule.op} ${rule.value}`, ws.groups.map((g) => g.name));
              updateWs((w) => { w.groups.push({ id: newId('grp'), name, sampleIds: [], criteria: { rules: [r] } }); });
              note('info', `Live keyword group "${rule.keyword} ${rule.op} ${rule.value}" created`);
            }}>Rule group</button>
          </div>
          <div className="row">
            <button disabled={!groupSamples.length} data-testid="check-every-nth" onClick={() => {
              // FlowJo "Select every Nth sample" (Group.getEveryNthSample).
              setChecked(everyNth(groupSamples.map((s) => s.id), nth));
            }}>Check every</button>
            <input type="number" min={1} value={nth} onChange={(e) => setNth(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 48 }} aria-label="n" />
            <span className="muted">th sample</span>
          </div>
  </>);
  const sampleListBlock = (<>
          <h3>Samples ({groupSamples.length})</h3>
          {groupSamples.map((s) => (
            <div key={s.id} className={`node ${s.id === sel.sampleId ? 'sel' : ''}`} data-testid={`sample-${s.fileName}`} onDragOver={(e) => accepts(e) && e.preventDefault()} onDrop={onDropOn({ sampleId: s.id, popId: null })} onContextMenu={(e) => { e.preventDefault(); popMenu(s, null, e.clientX, e.clientY); }} onClick={() => setSel({ sampleId: s.id, popId: s.id === sel.sampleId ? sel.popId : null })}>
              <input type="checkbox" checked={checked.includes(s.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((c) => (c.includes(s.id) ? c.filter((x) => x !== s.id) : [...c, s.id]))} aria-label={`check ${s.fileName}`} />
              <span className="pname" title={s.fileName}>{s.fileName}</span>
              <span className="pcount">{meta[s.id] ? s.eventCount.toLocaleString() : <i className="missing">data missing</i>}</span>
            </div>
          ))}
          {!ws.samples.length && <p className="muted">Add FCS files to begin. Data stays on this computer.</p>}
          {sample && (
            <div className="row">
              <button data-testid="remove-sample" onClick={async () => {
                // FlowJo asks: from the workspace or only from the current group.
                const g = ws.groups.find((x) => x.id === groupId);
                const fromGroup = g && g.id !== 'all' && !g.criteria;
                const a = await ask(
                  fromGroup ? `Remove sample ${sample.fileName} from the workspace (with its gates), or only from group "${g.name}"? Undo restores it.` : `Remove sample ${sample.fileName} and its gates from the workspace? Undo restores it.`,
                  fromGroup ? ['Remove from workspace', 'Remove from group'] : ['Remove'],
                );
                if (a === 'Remove from group') {
                  updateWs((w) => { removeFromGroup(w, groupId, [sample.id]); });
                  note('info', `Removed ${sample.fileName} from group "${g!.name}"`);
                  return;
                }
                if (a !== 'Remove' && a !== 'Remove from workspace') return;
                updateWs((w) => removeSample(w, sample.id));
                setChecked((c) => c.filter((x) => x !== sample.id));
                setSel({ sampleId: ws.samples.find((s) => s.id !== sample.id)?.id ?? null, popId: null });
                note('info', `Removed ${sample.fileName}`);
              }}>Remove sample</button>
            </div>
          )}
          {sample && sMeta && sMeta.datasetCount > 1 && (
            <div className="row">
              Data set <select value={sMeta.datasetIndex} data-testid="dataset-select" onChange={(e) => {
                const idx = Number(e.target.value);
                run(async () => {
                  const m = await client.selectDataset(sample.id, idx);
                  setMeta((x) => ({ ...x, [sample.id]: m }));
                  updateWs((w) => {
                    const t = w.samples.find((x) => x.id === sample.id)!;
                    Object.assign(t, { datasetIndex: idx, eventCount: m.eventCount, channelNames: m.channels.map((c) => c.name) });
                    for (const c of m.channels) if (!w.channelTransforms[c.name]) w.channelTransforms[c.name] = defaultTransform(c, m.keywords);
                  });
                  note('info', `${sample.fileName}: data set ${idx + 1} of ${m.datasetCount} (${m.eventCount.toLocaleString()} events)`);
                });
              }}>
                {Array.from({ length: sMeta.datasetCount }, (_, i) => <option key={i} value={i}>{i + 1} of {sMeta.datasetCount}</option>)}
              </select>
            </div>
          )}
          {sample && (
            <>
              <h3>Annotations - {sample.fileName}</h3>
              {Object.entries(sample.annotations ?? {}).map(([k, v]) => (
                <div key={k} className="row">
                  <span className="pname">{k} = {v}</span>
                  <button className="x" aria-label={`remove ${k}`} onClick={() => updateWs((w) => { delete w.samples.find((x) => x.id === sample.id)!.annotations![k]; })}>x</button>
                </div>
              ))}
              <div className="row">
                <input placeholder="key" value={annKey} onChange={(e) => setAnnKey(e.target.value)} style={{ width: 80 }} data-testid="ann-key" />
                <input placeholder="value" value={annVal} onChange={(e) => setAnnVal(e.target.value)} style={{ width: 80 }} data-testid="ann-value" />
                <button disabled={!annKey.trim()} data-testid="ann-add" onClick={() => {
                  updateWs((w) => { const t = w.samples.find((x) => x.id === sample.id)!; t.annotations = { ...(t.annotations ?? {}), [annKey.trim()]: annVal }; });
                  setAnnKey(''); setAnnVal('');
                }}>Add</button>
              </div>
            </>
          )}
  </>);
  const popTreeBlock = (<>
          <h3>Populations {sample && <span className="muted">- {sample.fileName}</span>}</h3>
          {sample && (
            <>
              <div className={`node ${sel.popId === null ? 'sel' : ''}`} onClick={() => setSel({ sampleId: sample.id, popId: null })} onDragOver={(e) => accepts(e) && e.preventDefault()} onDrop={onDropOn({ sampleId: sample.id, popId: null })} onContextMenu={(e) => { e.preventDefault(); popMenu(sample, null, e.clientX, e.clientY); }} data-testid="pop-root">
                <span className="pname">All events</span>
                <span className="pcount">{meta[sample.id] ? sample.eventCount.toLocaleString() : '-'}</span>
              </div>
              {tree(null, 1)}
            </>
          )}
  </>);
  const popActionsBlock = sample ? (<>
              <div className="row">
                <button disabled={multi.length < 2} onClick={() => makeBoolean('and')} title="Ctrl-click populations to multi-select">AND</button>
                <button disabled={multi.length < 2} onClick={() => makeBoolean('or')}>OR</button>
                <button disabled={!notOperand} onClick={() => makeBoolean('not')} data-testid="bool-not" title="NOT of the selected population">NOT</button>
                <button disabled={!sel.popId} onClick={() => deletePop(sel.popId!)} data-testid="delete-pop">Delete</button>
                <button
                  disabled={!sel.popId || sample.populations.find((p) => p.id === sel.popId)?.gate.type === 'boolean'}
                  data-testid="toggle-exclude"
                  title="Population = parent events outside the gate (FlowJo exclusion gate)"
                  onClick={() => updateWs((w) => { const q = w.samples.find((x) => x.id === sample.id)!.populations.find((x) => x.id === sel.popId)!; if (q.exclude) delete q.exclude; else q.exclude = true; })}
                >Exclude</button>
              </div>
              <GateActions
                pop={sample.populations.find((p) => p.id === sel.popId) ?? null}
                populations={sample.populations}
                canPaste={!!clip?.length}
                onMagnetic={(on) => updateWs((w, say) => {
                  // A synchronized group's copy changes in every member;
                  // otherwise the population leaves its group (Group.updateMagnetism).
                  const sw = w.samples.find((x) => x.id === sample.id)!;
                  const q = sw.populations.find((x) => x.id === sel.popId)!;
                  if (on) q.magnetic = true; else delete q.magnetic;
                  const owner = q.owningGroup ? w.groups.find((g) => g.id === q.owningGroup) : undefined;
                  if (owner?.synchronized) syncRoots(w, sample.id, [q.id], say);
                  else if (q.owningGroup) delete q.owningGroup;
                })}
                onConvert={(gate) => updateGates([{ id: sel.popId!, gate }])}
                onCopy={copySel}
                onCut={cutSel}
                onPasteGroup={() => pasteTo(groupSamples.map((s) => s.id))}
                onBifurcate={() => run(async () => {
                  // ws.autoquad: fluorescent parameters not on the gating path,
                  // skipping -H / -W when the -A parameter exists.
                  const names = channels.map((c) => c.name);
                  const onPath = new Set<string>();
                  for (let q = sample.populations.find((x) => x.id === sel.popId); q; q = q.parentId ? sample.populations.find((x) => x.id === q!.parentId) : undefined) {
                    if (q.gate.type !== 'boolean') for (const d of q.gate.dims) if (d.kind === 'channel') onPath.add(d.channel);
                  }
                  const fl = names.filter((n) => !isScatterOrTime(n) && !onPath.has(n) && !(/-[HW]$/.test(n) && names.includes(n.replace(/-[HW]$/, '-A'))));
                  const res = await client.bifurcate({ sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices, derived: ws.derivedParameters, popId: sel.popId, channels: fl, scales: statScales(ws.channelTransforms, sample.flowjoLinearRanges, fl) });
                  const made: { name: string; gate: Gate }[] = [];
                  const taken = sample.populations.filter((x) => x.parentId === sel.popId).map((x) => x.name);
                  for (const r of res) {
                    if (r.split === null) { note('info', `BifurGate: ${r.channel} is unimodal; no gate`); continue; }
                    const ch = channels.find((c) => c.name === r.channel)!;
                    const spec = ws.channelTransforms[r.channel] ?? defaultTransform(ch, sMeta!.keywords);
                    const at = makeTransform(spec).apply(r.split);
                    const X = { kind: 'channel' as const, channel: r.channel, transform: spec };
                    const [lo, hi] = bisectorNames(gateLabel(r.channel, ch.label), r.channel, [...taken, ...made.map((m) => m.name)]);
                    made.push({ name: lo, gate: { type: 'rect', dims: [X], min: [null], max: [at] } }, { name: hi, gate: { type: 'rect', dims: [X], min: [at], max: [null] } });
                  }
                  if (made.length) createGates(made);
                })}
                onPaste={() => pasteTo(checked.length ? [...new Set([sample.id, ...checked])] : [sample.id])}
              />
              <div className="row">
                <button disabled={!sel.popId || sample.populations.find((p) => p.id === sel.popId)?.owningGroup === groupId} title="Disabled when the analysis already belongs to this group (WSActionManager)" data-testid="apply-group" onClick={() => {
                  updateWs((w, say) => {
                    const msgs = copyAnalysisToGroup(w, sample.id, sel.popId!, groupId);
                    msgs.forEach((m) => say('warn', m));
                  });
                  note('info', `Applied "${popPath}" and its children to group ${group?.name}`);
                }}>Copy analysis to group</button>
                <label title="FlowJo synchronized group: moving a group-owned gate moves it in every sample of the group"><input type="checkbox" data-testid="group-sync" checked={!!group?.synchronized} onChange={(e) => updateWs((w) => { const g = w.groups.find((x) => x.id === groupId)!; if (e.target.checked) g.synchronized = true; else delete g.synchronized; })} /> Synchronized</label>
              </div>
              {analysis[sample.id]?.compError && <p className="error">Compensation: {analysis[sample.id]!.compError}</p>}
  </>) : null;
  const plotBlock = (<>
          {sample && sMeta && xAxis ? (
            <>
              <div className="row breadcrumb" data-testid="gating-path">
                <button disabled={!neighbour(-1)} onClick={() => navSample(-1)} title="Previous Sample (PageUp, or Ctrl/Cmd+PageDown): view the previous population at this level" data-testid="prev-sample">&lt;</button>
                <button disabled={!neighbour(1)} onClick={() => navSample(1)} title="Next Sample (PageDown, or Ctrl/Cmd+PageUp): view the next population at this level" data-testid="next-sample">&gt;</button>
                <span className="muted">Gating Path:</span>
                <a href="#" onClick={(e) => { e.preventDefault(); setSel({ sampleId: sample.id, popId: null }); }} data-testid="crumb-root">{sample.fileName}</a>
                {gatingPath.map((q) => (
                  <span key={q.id}> &gt; <a href="#" onClick={(e) => { e.preventDefault(); setSel({ sampleId: sample.id, popId: q.id }); }} data-testid={`crumb-${q.name}`}>{q.name}</a></span>
                ))}
                {!gatingPath.length && <span className="muted"> (Ungated)</span>}
              </div>
              <div className="row plot-controls">
                <select value={kind} onChange={(e) => setPlotSettings({ kind: e.target.value as PlotKind })} data-testid="plot-kind">
                  <option value="pseudocolor">Pseudocolor</option>
                  <option value="dot">Dot plot</option>
                  <option value="histogram">Histogram</option>
                  <option value="contour">Contour</option>
                  <option value="density">Density (smoothed)</option>
                  <option value="zebra">Zebra (probability bands)</option>
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
              {(kind === 'contour' || kind === 'zebra') && (
                <div className="row">
                  Level <select value={plotSettings.contourLevel ?? (kind === 'zebra' ? 10 : 5)} onChange={(e) => setPlotSettings({ contourLevel: Number(e.target.value) })} data-testid="contour-level">
                    {[2, 5, 10, 20].map((v) => <option key={v} value={v}>{v}%</option>)}
                  </select>
                  {kind === 'contour' && <label><input type="checkbox" checked={!!plotSettings.showOutliers} onChange={(e) => setPlotSettings({ showOutliers: e.target.checked })} data-testid="contour-outliers" /> show outliers</label>}
                  <span className="muted">equal-probability contours; not compared with FlowJo's placement</span>
                </div>
              )}
              {kind === 'histogram' && (
                <div className="row">
                  <label title="FlowJo 10: each curve scaled so its mode is 100; default is raw counts on one axis"><input type="checkbox" checked={!!plotSettings.normalize} onChange={(e) => setPlotSettings({ normalize: e.target.checked })} data-testid="hist-normalize" /> Normalized To Mode</label>
                </div>
              )}
              <details className="display-menu" data-testid="display-menu">
                <summary>Display</summary>
                <label title="Light grey lines at the labelled ticks"><input type="checkbox" checked={!!plotSettings.grid} onChange={(e) => setPlotSettings({ grid: e.target.checked || undefined })} data-testid="display-grid" /> Show Grid</label>
                <label title="Dot plots only (own size)"><input type="checkbox" disabled={kind !== 'dot'} checked={!!plotSettings.largeDots} onChange={(e) => setPlotSettings({ largeDots: e.target.checked || undefined })} data-testid="display-large-dots" /> Draw Large Dots</label>
                <label><input type="checkbox" checked={!plotSettings.hideGateFreq} onChange={(e) => setPlotSettings({ hideGateFreq: e.target.checked ? undefined : true })} data-testid="display-freq" /> Show Gate Frequencies</label>
                <label><input type="checkbox" checked={!plotSettings.hideGateNames} onChange={(e) => setPlotSettings({ hideGateNames: e.target.checked ? undefined : true })} data-testid="display-names" /> Show Gate Names</label>
                <label title="A + at the medians (more than 10 events); a dotted line on a histogram"><input type="checkbox" checked={!!plotSettings.medians} onChange={(e) => setPlotSettings({ medians: e.target.checked || undefined })} data-testid="display-medians" /> Show Medians</label>
              </details>
              <div className="row tools">
                {(kind === 'histogram' ? TOOLS_1D : TOOLS_2D).map((t) => {
                  const key = Object.keys(TOOL_KEYS).find((k) => TOOL_KEYS[k] === t);
                  return <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(t)} data-testid={`tool-${t}`} title={key ? `${TOOL_LABELS[t]} (${key.toUpperCase()} on the plot)` : TOOL_LABELS[t]}>{TOOL_LABELS[t]}</button>;
                })}
                <button data-testid="manual-gate" title="Manually Enter Gate... (Ctrl/Cmd+G)" onClick={() => setDialog({ kind: 'manual' })}>Manual...</button>
                <span className="muted">{TOOL_HINTS[tool]}</span>
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
                onCreate={(g) => (g.length === 1 ? setNaming({ ...g[0], name: uniqueName(g[0].name, siblingNames(sel.popId)) }) : createGates(g))}
                onDelete={(id) => void deletePop(id)}
                onNav={navSample}
                onContext={plotMenu}
                display={displayOpts}
                actionsRef={plotActions}
                onOpen={(id) => { setSel({ sampleId: sample.id, popId: id }); setMulti([]); setGateSel(null); }}
                onUpdate={updateGates}
                onSelect={setGateSel}
                onRefuse={(m) => note('warn', m)}
                canvasRef={canvasRef}
                overlays={overlayData}
                contourLevel={plotSettings.contourLevel ?? (kind === 'zebra' ? 10 : 5)}
                showOutliers={!!plotSettings.showOutliers}
                normalize={!!plotSettings.normalize}
                onTool={setTool}
                xLabel={gateLabel(xAxis.channel, channels.find((c) => c.name === xAxis.channel)?.label)}
                yLabel={yAxis ? gateLabel(yAxis.channel, channels.find((c) => c.name === yAxis.channel)?.label) : undefined}
                xTitle={axisTitle(xAxis.channel)}
                yTitle={yAxis ? axisTitle(yAxis.channel) : undefined}
                autoCounts={autoCounts}
                moved={movedGates}
                onAnchor={anchorCol && kind === 'histogram' ? (v, alt, shift) => {
                  // TetheredRangeGate creation: multiplier = scale value at the
                  // click / statistic value, 2 decimals (1 when the statistic is
                  // 0); Shift snaps to a whole number within 0.05; Alt makes
                  // the upper bound.
                  const c = ws.statColumns.find((x) => x.id === anchorCol);
                  const val = c && stats[sample.id]?.[ws.statColumns.indexOf(c)];
                  if (!c || typeof val !== 'number' || !Number.isFinite(val)) return note('warn', 'Anchored gating needs the statistic value for this sample');
                  let mult = val === 0 ? 1 : Math.round((xAxis.t.inverse(v) / val) * 100) / 100;
                  if (shift && Math.abs(mult - Math.round(mult)) <= 0.05) mult = Math.round(mult);
                  const bound = { populationPath: c.populationPath, stat: c.stat, channel: c.channel, percentile: c.percentile, multiplier: mult, scale: statScales(ws.channelTransforms, sample.flowjoLinearRanges, [c.channel!])[c.channel!] };
                  const X = { kind: 'channel' as const, channel: xAxis.channel, transform: xAxis.spec };
                  createGates([{ name: uniqueName(`${STAT_LABELS[c.stat]} x ${mult}`, sample.populations.filter((p) => p.parentId === sel.popId).map((p) => p.name)), gate: { type: 'anchored', dims: [X], min: alt ? null : bound, max: alt ? bound : null } }]);
                  setAnchorCol(null);
                } : undefined}
              />
              <div className="row">
                <button data-testid="add-to-layout" title="Copy to Layout Editor: placed centred on (200, 200) pt (GWAction.copyToLayout)" onClick={() => { const [at] = placeRow([{ w: GRAPH_W, h: GRAPH_H }], COPY_TO_LAYOUT_POINT); updateWs((w) => { w.layout = [...(w.layout ?? []), { id: newId('lay'), populationPath: popPath, ...plotSettings, sampleId: sample.id, left: at.x, top: at.y, width: GRAPH_W, height: GRAPH_H }]; }); note('info', `Added ${popPath || 'All events'} (${plotSettings.x}${kind === 'histogram' ? '' : ` vs ${plotSettings.y}`}) to the layout`); }}>Add to layout</button>
              </div>
              <div className="muted" data-testid="plot-caption">
                {popPath || 'All events'}: {plotData ? plotData.count.toLocaleString() : '-'} events shown
                {plotData && (kind === 'dot' || (kind === 'contour' && plotSettings.showOutliers)) && plotData.points.length / 2 < plotData.count && ` (dot plot draws ${(plotData.points.length / 2).toLocaleString()} sampled events)`}
              </div>
              <details className="overlay-picker">
                <summary data-testid="overlay-toggle">Overlay populations ({plotSettings.overlays?.length ?? 0})</summary>
                {sample.populations.map((p) => populationPath(sample.populations, p.id)).filter((path) => path !== popPath).map((path) => (
                  <label key={path} className="node">
                    <input
                      type="checkbox"
                      data-testid={`overlay-${path}`}
                      checked={plotSettings.overlays?.includes(path) ?? false}
                      onChange={(e) => setPlotSettings({ overlays: e.target.checked ? [...(plotSettings.overlays ?? []), path] : (plotSettings.overlays ?? []).filter((x) => x !== path) })}
                    />
                    <span className="pname">{path}</span>
                  </label>
                ))}
              </details>
              {edge?.text && <p className="warn" data-testid="edge-warning">{edge.text}</p>}
            </>
          ) : (
            <p className="muted">{sample ? 'Sample data not loaded: add the FCS file to relink it.' : 'Select a sample.'}</p>
          )}
  </>);
  const statsBlock = (<>
          <h3>Statistics - {group?.name}</h3>
          <div className="row">
            <select value={newStat.stat} onChange={(e) => setNewStat({ ...newStat, stat: e.target.value as StatKind })} data-testid="stat-kind">
              {Object.entries(STAT_LABELS).filter(([k]) => k !== 'kinetic').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {STAT_NEEDS_CHANNEL(newStat.stat) && (
              <select value={newStat.channel} onChange={(e) => setNewStat({ ...newStat, channel: e.target.value })} data-testid="stat-channel">
                <option value="">channel...</option>
                {channels.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            )}
            {newStat.stat === 'percentile' && <input type="number" min={0} max={100} step={1} value={Number.isNaN(newStat.percentile) ? '' : newStat.percentile} onChange={(e) => setNewStat({ ...newStat, percentile: e.target.value === '' ? NaN : Number(e.target.value) })} style={{ width: 60 }} data-testid="stat-percentile" title="Integer from 0 to 100" />}
            {newStat.stat === 'percentile' && !validPercentile(newStat.percentile) && <span className="error" data-testid="percentile-error">integer 0 to 100</span>}
            {newStat.stat === 'correlation' && (
              <select value={newStat.correlate} onChange={(e) => setNewStat({ ...newStat, correlate: e.target.value })} data-testid="stat-correlate" title="Second parameter">
                <option value="">with...</option>
                {channels.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            )}
            {newStat.stat === 'freqOf' && (
              <select value={newStat.ancestor} onChange={(e) => setNewStat({ ...newStat, ancestor: e.target.value })} data-testid="stat-ancestor" title="Ancestor population">
                <option value="">of...</option>
                {ancestorNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            <button
              data-testid="add-stat"
              disabled={!sample || !statReady}
              onClick={() => addStatFor(popPath)}
            >
              Add for "{popPath || 'All events'}"
            </button>
            <button disabled={!ws.statColumns.length} onClick={exportStatsCsv} data-testid="export-stats">Export CSV</button>
            <button disabled={!ws.statColumns.length} onClick={() => void copyTable()} data-testid="copy-table" title="Copy Table to Clipboard: HTML and plain text (FormattedTextTransferable)">Copy table</button>
            <button disabled={!ws.statColumns.length} onClick={exportAllGroupsCsv} data-testid="export-stats-all">Export all groups</button>
          </div>
          <div className="row">
            <input placeholder="template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} style={{ width: 110 }} data-testid="template-name" />
            <button disabled={!ws.statColumns.length || !templateName.trim()} data-testid="template-save" title="Named templates are saved in the workspace file" onClick={() => {
              const name = uniqueName(templateName.trim(), (ws.statTemplates ?? []).map((t) => t.name));
              updateWs((w) => { w.statTemplates = [...(w.statTemplates ?? []), { id: newId('tpl'), name, columns: structuredClone(w.statColumns) }]; });
              setTemplateName('');
              note('info', `Saved ${ws.statColumns.length} statistic columns as template "${name}" (kept when the workspace is saved)`);
            }}>Save columns as template</button>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-testid="template-select">
              <option value="">template...</option>
              {(ws.statTemplates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.columns.length})</option>)}
            </select>
            <button disabled={!templateId} data-testid="template-apply" onClick={() => {
              const t = ws.statTemplates?.find((x) => x.id === templateId);
              if (t) updateWs((w) => { w.statColumns = t.columns.map((c) => ({ ...c, id: newId('col') })); });
            }}>Apply</button>
            <button disabled={!templateId} onClick={() => { updateWs((w) => { w.statTemplates = (w.statTemplates ?? []).filter((x) => x.id !== templateId); }); setTemplateId(''); }}>Delete</button>
          </div>
          {ws.statColumns.length > 0 && (
            <div className="table-wrap">
              <table className="grid" data-testid="stats-table">
                <thead>
                  <tr>
                    <th>Sample</th>
                    {annotationKeys.map((k) => <th key={`ann-${k}`}>{k}</th>)}
                    {ws.statColumns.map((c) => (
                      <th key={c.id}>{colLabel(c)} {c.channel && <button className={anchorCol === c.id ? 'x active' : 'x'} data-testid={`anchor-${c.id}`} title="Anchored Gating: then click a histogram of the sample to make a range whose bound is this statistic times a multiplier (Alt: upper bound, Shift: whole multiplier)" onClick={() => setAnchorCol(anchorCol === c.id ? null : c.id)}>anchor</button>} <button className="x" onClick={() => updateWs((w) => { w.statColumns = w.statColumns.filter((x) => x.id !== c.id); })} aria-label="remove column">x</button></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupSamples.map((s) => (
                    <tr key={s.id}>
                      <td>{s.fileName}</td>
                      {annotationKeys.map((k) => <td key={`ann-${k}`}>{s.annotations?.[k] ?? ''}</td>)}
                      {ws.statColumns.map((c, i) => <td key={c.id}>{meta[s.id] ? fmtStat(stats[s.id]?.[i] ?? '-') : 'no data'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
  </>);
  const logBlock = (<>
          <h3>Log</h3>
          <div className="log" data-testid="log">
            {log.map((l, i) => <div key={i} className={l.level}>{l.text}</div>)}
          </div>
  </>);

  return (
    <div className={`app ${uiLayout}`} onMouseMove={(e) => { const d = winDrag.current; if (d) setWins((ws0) => ws0.map((w) => (w.id === d.id ? { ...w, x: Math.max(0, e.clientX - d.dx), y: Math.max(0, e.clientY - d.dy) } : w))); }} onMouseUp={() => { winDrag.current = null; }} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void dropFiles(e.dataTransfer.files); } }}>
      {uiLayout === 'classic' ? (<>
      {/* Toolbar grouped like FlowJo 10's workspace ribbon (WSRibbonStructure.loadDefaults,
          WSRibbonFrame.addTaskbarComponents; specs 22.5): the quick row first, then bands. */}
      <header className="toolbar">
        <b className="brand">flowjo-rea</b>
        <span className="band" aria-label="Quick access">
          <button disabled={!hist.past.length} onClick={() => setHist(undo)} data-testid="undo" title="Undo (Ctrl/Cmd+Z)">Undo</button>
          <button disabled={!hist.future.length} onClick={() => setHist(redo)} data-testid="redo" title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
          <label className="file-btn" title="Add Samples (or drop FCS files on the window)">Add FCS files<input type="file" multiple accept=".fcs,.lmd,*" data-testid="add-fcs" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} /></label>
          <button onClick={() => setDialog({ kind: 'group', id: null })} data-testid="quick-create-group" title="Create Group... (Ctrl/Cmd+G outside the plot)">Create Group</button>
          <button disabled={!sample} onClick={() => setDialog({ kind: 'comp' })} data-testid="open-comp">Compensation</button>
          <button data-testid="open-tables" onClick={() => setDialog({ kind: 'tables' })} title="Table Editor (Ctrl/Cmd+T)">Tables ({ws.tables?.length ?? 0})</button>
          <button onClick={() => setDialog({ kind: 'layout' })} data-testid="open-layout" title="Layout Editor (Ctrl/Cmd+L)">Layout ({ws.layout?.length ?? 0})</button>
        </span>
        <span className="band" aria-label="Document"><span className="band-label">Document</span>
          <label className="file-btn">Open workspace / FlowJo .wsp<input type="file" accept=".json,.wsp,.frea" data-testid="open-ws" onChange={(e) => { const f = e.target.files?.[0]; if (f) openWorkspace(f); e.target.value = ''; }} /></label>
          <button data-testid="save-ws" title="Save (Ctrl/Cmd+S)" onClick={() => { setSavedOnce(true); download(`${ws.name.replace(/\.(wsp|json)$/i, '') || 'workspace'}.frea.json`, serializeWorkspace(ws), 'application/json'); }}>Save workspace</button>
          <label className="file-btn">Import Gating-ML<input type="file" accept=".xml" data-testid="import-gml" onChange={(e) => { const f = e.target.files?.[0]; if (f) importGatingMl(f); e.target.value = ''; }} /></label>
          <button disabled={!sample} onClick={() => setDialog({ kind: 'export' })} data-testid="open-export" title="Export / Concatenate (Ctrl/Cmd+E)">Export</button>
        </span>
        <span className="band" aria-label="Find"><span className="band-label">Find</span>
          <button disabled={!ws.samples.length} onClick={() => setDialog({ kind: 'find' })} data-testid="open-find" title="Find keyword values (Ctrl/Cmd+F outside the plot)">Find</button>
        </span>
        <span className="band" aria-label="Keywords"><span className="band-label">Keywords</span>
          <button disabled={!sMeta} onClick={() => setDialog({ kind: 'keywords' })} data-testid="open-keywords" title="Inspect (Ctrl/Cmd+I)">Keywords</button>
          <button disabled={!ws.samples.length} onClick={() => setDialog({ kind: 'addKeyword' })} data-testid="open-add-keyword" title="Add Keyword (Ctrl/Cmd+Shift+I)">Add Keyword</button>
        </span>
        <span className="band" aria-label="Expand"><span className="band-label">Expand</span>
          <button disabled={!ws.samples.length} onClick={() => setCollapsed('all', false)} data-testid="expand-all" title="Expand All (Ctrl/Cmd+U)">Expand All</button>
          <button disabled={!ws.samples.length} onClick={() => setCollapsed('all', true)} data-testid="collapse-all" title="Collapse All (Ctrl/Cmd+Shift+U)">Collapse All</button>
        </span>
        <span className="band" aria-label="Cytometry"><span className="band-label">Cytometry</span>
          <button disabled={!sMeta} onClick={() => setDialog({ kind: 'derived' })} data-testid="open-derived">Derived ({ws.derivedParameters?.length ?? 0})</button>
          <button disabled={!sMeta} onClick={() => setDialog({ kind: 'platforms' })} data-testid="open-platforms">Platforms</button>
        </span>
        <span className="band" aria-label="Settings"><span className="band-label">Settings</span>
          <button data-testid="open-prefs" onClick={() => setDialog({ kind: 'prefs' })} title="Preferences (Ctrl/Cmd+Y)">Preferences</button>
          <button data-testid="layout-flowjo" onClick={() => switchLayout('flowjo')} title="FlowJo-style workspace window">FlowJo layout</button>
        </span>
        <span className="sep" />
        <span className="status" data-testid="busy">{busy > 0 ? 'Working...' : 'Ready'}</span>
      </header>
      <main className="layout">
        <section className="panel samples">
          {groupsBlock}
          {sampleListBlock}
        </section>

        <section className="panel tree">
          {popTreeBlock}
          {popActionsBlock}
        </section>

        <section className="panel plot">
          {plotBlock}
        </section>

        <section className="panel stats">
          {statsBlock}
          {logBlock}
        </section>
      </main>
      </>) : (<>
      {/* FlowJo 10 workspace window (specs 23): taskbar, ribbon tabs and bands
          (WSRibbonFrame, WSRibbonStructure.loadDefaults), group table above the
          sample tree-table (GroupTreeTable, SampleTreeTable: Name, Statistic,
          #Cells), graph windows per node (GWFrame). */}
      <header className="toolbar fj-taskbar">
        <b className="brand">flowjo-rea</b>
        <button disabled={!hist.past.length} onClick={() => setHist(undo)} data-testid="undo" title="Undo (Ctrl/Cmd+Z)">Undo</button>
        <button disabled={!hist.future.length} onClick={() => setHist(redo)} data-testid="redo" title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
        <span className="sep" />
        <label className="file-btn" title="Add Samples (or drop FCS files on the window)">Add Samples<input type="file" multiple accept=".fcs,.lmd,*" data-testid="add-fcs" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} /></label>
        <button onClick={() => setDialog({ kind: 'group', id: null })} data-testid="quick-create-group">Create Group</button>
        <button disabled={!sample} onClick={() => setDialog({ kind: 'comp' })} data-testid="open-comp">Compensation</button>
        <button data-testid="open-tables" onClick={() => setDialog({ kind: 'tables' })} title="Table Editor (Ctrl/Cmd+T)">Table Editor ({ws.tables?.length ?? 0})</button>
        <button onClick={() => setDialog({ kind: 'layout' })} data-testid="open-layout" title="Layout Editor (Ctrl/Cmd+L)">Layout Editor ({ws.layout?.length ?? 0})</button>
        <span className="sep" />
        <span className="status" data-testid="busy">{busy > 0 ? 'Working...' : 'Ready'}</span>
      </header>
      <nav className="fj-ribbon" aria-label="Ribbon">
        <div className="fj-tabs" role="tablist">
          {['FlowJo', 'File', 'Edit', 'Workspace', 'Tools', 'Configure'].map((t) => <button key={t} role="tab" aria-selected={ribbonTab === t} className={ribbonTab === t ? 'active' : ''} onClick={() => setRibbonTab(t)} data-testid={`ribbon-tab-${t}`}>{t}</button>)}
        </div>
        <div className="fj-bands" role="tabpanel" data-testid="ribbon-panel">
          {ribbonTab === 'FlowJo' && <>
            <div className="fj-band"><div className="fj-band-body">
              <button onClick={() => setDialog({ kind: 'platforms' })} disabled={!sMeta} data-testid="open-platforms">Biology (Cell Cycle, Proliferation)</button>
              <button onClick={() => setDialog({ kind: 'addKeyword' })} disabled={!ws.samples.length} data-testid="open-add-keyword">Add Keyword</button>
              <button data-testid="open-prefs" onClick={() => setDialog({ kind: 'prefs' })} title="Preferences (Ctrl/Cmd+Y)">Preferences</button>
            </div><div className="fj-band-title">Navigate / Experiment</div></div>
          </>}
          {ribbonTab === 'File' && <>
            <div className="fj-band"><div className="fj-band-body">
              <label className="file-btn">Open...<input type="file" accept=".json,.wsp,.frea" data-testid="open-ws" onChange={(e) => { const f = e.target.files?.[0]; if (f) openWorkspace(f); e.target.value = ''; }} /></label>
              <button data-testid="save-ws" title="Save (Ctrl/Cmd+S)" onClick={() => { setSavedOnce(true); download(`${ws.name.replace(/\.(wsp|json)$/i, '') || 'workspace'}.frea.json`, serializeWorkspace(ws), 'application/json'); }}>Save</button>
              <label className="file-btn">Import Gating-ML<input type="file" accept=".xml" data-testid="import-gml" onChange={(e) => { const f = e.target.files?.[0]; if (f) importGatingMl(f); e.target.value = ''; }} /></label>
              <button disabled={!sample} onClick={() => setDialog({ kind: 'export' })} data-testid="open-export">Export / Concatenate</button>
            </div><div className="fj-band-title">Document</div></div>
            <div className="fj-band"><div className="fj-band-body">
              <button disabled={!ws.samples.length} onClick={() => setDialog({ kind: 'find' })} data-testid="open-find">Find</button>
            </div><div className="fj-band-title">Find</div></div>
          </>}
          {ribbonTab === 'Edit' && <>
            <div className="fj-band"><div className="fj-band-body">
              <button disabled={!sample || !(multi.length || sel.popId)} onClick={copySel} data-testid="ribbon-copy">Copy</button>
              <button disabled={!sel.popId} onClick={cutSel} data-testid="ribbon-cut">Cut</button>
              <button disabled={!clip?.length || !sample} onClick={() => pasteTo(checked.length ? [...new Set([sample!.id, ...checked])] : [sample!.id])} data-testid="ribbon-paste">Paste</button>
            </div><div className="fj-band-title">Clipboard</div></div>
            <div className="fj-band"><div className="fj-band-body">
              <button disabled={!sample} onClick={selectEquivalent} data-testid="ribbon-select-equivalent">Select Equivalent Nodes</button>
            </div><div className="fj-band-title">Select</div></div>
            <div className="fj-band"><div className="fj-band-body">
              <button disabled={!ws.samples.length} onClick={() => { setCollapsed('all', false); setCollapsedSamples([]); }} data-testid="expand-all">Expand All</button>
              <button disabled={!ws.samples.length} onClick={() => { setCollapsed('all', true); setCollapsedSamples(groupSamples.map((x) => x.id)); }} data-testid="collapse-all">Collapse All</button>
            </div><div className="fj-band-title">Expand</div></div>
          </>}
          {ribbonTab === 'Workspace' && <div className="fj-band wide"><div className="fj-band-body column">{popActionsBlock ?? <span className="muted">Select a sample or population in the table.</span>}</div><div className="fj-band-title">Populations / Groups / Boolean</div></div>}
          {ribbonTab === 'Tools' && <>
            <div className="fj-band"><div className="fj-band-body">
              <button disabled={!sMeta} onClick={() => setDialog({ kind: 'derived' })} data-testid="open-derived">Derive Parameters ({ws.derivedParameters?.length ?? 0})</button>
              <button disabled={!sMeta} onClick={() => setDialog({ kind: 'keywords' })} data-testid="open-keywords" title="Inspect (Ctrl/Cmd+I)">Inspect (Keywords)</button>
            </div><div className="fj-band-title">Cytometry</div></div>
          </>}
          {ribbonTab === 'Configure' && <>
            <div className="fj-band"><div className="fj-band-body">
              <button onClick={() => switchLayout('classic')} data-testid="layout-classic" title="The earlier four-panel screen">Switch to classic layout</button>
            </div><div className="fj-band-title">Settings</div></div>
          </>}
        </div>
      </nav>
      <main className={`fj-main ${drawer ? 'with-drawer' : ''}`}>
        <section className="panel fj-workspace">
          {/* Group pane (GroupTreeTable): Name, Role, Size; double-click edits the group. */}
          <div className="fj-groups">
            <table className="fj-table" data-testid="group-table">
              <thead><tr><th>Group</th><th>Role</th><th>Size</th></tr></thead>
              <tbody>
                {ws.groups.map((g) => (
                  <tr key={g.id} className={`fj-row ${g.id === groupId ? 'sel' : ''}`} data-testid={`grow-${g.name}`}
                    onClick={() => setGroupId(g.id)} onDoubleClick={() => g.id !== 'all' && setDialog({ kind: 'group', id: g.id })}
                    onDragOver={(e) => accepts(e) && e.preventDefault()} onDrop={onDropOn({ groupId: g.id })}>
                    <td>{g.name}</td><td>{g.role && g.role !== 'undefined' ? g.role : ''}</td><td className="num">{g.sampleIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="fj-table-wrap">
            <table className="fj-table" data-testid="sample-table">
              <thead><tr><th>Name</th><th>Statistic</th><th>#Cells</th></tr></thead>
              <tbody>{sampleTableRows()}</tbody>
            </table>
            {!groupSamples.length && <p className="muted">Add samples (or drop FCS files here), then double-click a sample to open its graph window.</p>}
          </div>
        </section>
        {drawer && (
          <aside className="panel fj-drawer">
            <div className="fj-drawer-tabs">
              {([['stats', 'Statistics'], ['groups', 'Groups'], ['samples', 'Samples'], ['log', 'Log']] as const).map(([k, l]) => <button key={k} className={drawer === k ? 'active' : ''} onClick={() => setDrawer(k)} data-testid={`drawer-${k}`}>{l}</button>)}
              <button className="x" onClick={() => setDrawer(null)} aria-label="Hide side panel">x</button>
            </div>
            {drawer === 'stats' && statsBlock}
            {drawer === 'groups' && groupsBlock}
            {drawer === 'samples' && sampleListBlock}
            {drawer === 'log' && logBlock}
          </aside>
        )}
        {!drawer && <button className="fj-drawer-open" onClick={() => setDrawer('stats')} data-testid="drawer-open">Statistics / Samples / Log</button>}
        {wins.map((w) => {
          const ws1 = ws.samples.find((x) => x.id === w.sampleId);
          const active = w.id === activeWin;
          const title = `${ws1?.fileName ?? '?'}: ${w.popId && ws1 ? populationPath(ws1.populations, w.popId) : 'Ungated'}`;
          return (
            <div key={w.id} className={`fj-gw ${active ? 'active' : ''}`} style={{ left: w.x, top: w.y, zIndex: active ? 40 : 30 }} data-testid="graph-window" data-active={active ? '1' : '0'} onMouseDown={() => focusWin(w)}>
              <div className="fj-gw-title" onMouseDown={(e) => { winDrag.current = { id: w.id, dx: e.clientX - w.x, dy: e.clientY - w.y }; }}>
                <span>{title}</span>
                <span>
                  <button title="Duplicate View" onMouseDown={(e) => e.stopPropagation()} onClick={() => openWin(w.sampleId, w.popId, true)} data-testid="gw-duplicate">Duplicate View</button>
                  <button aria-label="Close" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeWin(w.id)} data-testid="gw-close">x</button>
                </span>
              </div>
              <div className="fj-gw-body">{active ? (sample && sMeta && xAxis ? plotBlock : <p className="muted">Loading...</p>) : w.snap ? <img src={w.snap} alt={title} data-testid="gw-snapshot" /> : <p className="muted">Click to show</p>}</div>
            </div>
          );
        })}
      </main>
      <footer className="fj-status" data-testid="status-line">{log[0]?.text ?? 'Ready'}</footer>
      </>)}

      {question && (
        <div className="modal-bg" style={{ zIndex: 1000 }}>
          <div className="modal" role="alertdialog" aria-label="Question" data-testid="question">
            <div className="modal-body">
              <p>{question.text}</p>
              <div className="row">
                {question.choices.map((c) => <button key={c} data-testid={`answer-${c}`} onClick={() => { if (question.dontAskKey && dontAskTick) setPrefs(rememberDontAsk(prefsRef.current, question.dontAskKey)); question.resolve(c); setQuestion(null); }}>{c}</button>)}
                <button data-testid="answer-cancel" onClick={() => { question.resolve(null); setQuestion(null); }}>Cancel</button>
              </div>
              {question.dontAskKey && <label><input type="checkbox" data-testid="dont-ask" checked={dontAskTick} onChange={(e) => setDontAskTick(e.target.checked)} /> Don't ask again</label>}
            </div>
          </div>
        </div>
      )}
      {dialog?.kind === 'layout' && (
        <LayoutView
          ws={ws}
          meta={meta}
          samples={groupSamples}
          client={client}
          onChange={(items) => updateWs((w) => { w.layout = items; })}
          onSettings={(patch) => updateWs((w) => { Object.assign(w, patch); })}
          onDownload={(name, blob) => download(name, blob, 'image/png')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'platforms' && sample && sMeta && (() => {
        const base = { sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices, derived: ws.derivedParameters, popId: selPopValid ? sel.popId : null };
        return (
          <PlatformsDialog
            popLabel={popPath || 'All events'}
            channels={channels.map((c) => c.name)}
            timeChannel={channels.find((c) => /^time$/i.test(c.name))?.name ?? null}
            onClose={() => setDialog(null)}
            runCellCycle={(channel, model) => runOrThrow(() => client.cellCycle({ ...base, channel, model }))}
            runProliferation={(channel, maxGenerations) => runOrThrow(() => client.proliferation({ ...base, channel, maxGenerations }))}
            kinetics={(() => {
              // FlowJo's default Y: the first parameter with "/" in its name,
              // else Ratio; this app falls back to the first non-time channel.
              const names = channels.map((c) => c.name);
              const timeCh = channels.find((c) => /^time$/i.test(c.name))?.name ?? null;
              const yDefault = names.find((n) => n.indexOf('/') > 0) ?? names.find((n) => /^ratio$/i.test(n)) ?? names.find((n) => n !== timeCh) ?? '';
              const settings = ws.kinetics?.[popPath] ?? defaultKinetics(yDefault);
              const kw = sMeta.keywords;
              const secs = (t?: string) => { const m = /^(\d+):(\d+):(\d+)/.exec((t ?? '').trim()); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined; };
              const b = secs(kw['$BTIM']), e = secs(kw['$ETIM']);
              const timeRange = timeCh ? (sample.flowjoLinearRanges?.[timeCh] ?? [0, channels.find((c) => c.name === timeCh)!.range]) : undefined;
              return (
                <KineticsPanel
                  channels={names.filter((n) => n !== timeCh)}
                  settings={settings}
                  onSettings={(st) => updateWs((w) => { w.kinetics = { ...(w.kinetics ?? {}), [popPath]: st }; })}
                  onAddToTable={(names) => updateWs((w) => {
                    // A column per timeslice for every key but RANGE.
                    for (const t of names) for (const key of KIN_KEYS) if (!w.statColumns.some((c) => c.stat === 'kinetic' && c.populationPath === popPath && c.kin?.key === key && c.kin.timeslice === t)) w.statColumns.push({ id: newId('col'), populationPath: popPath, stat: 'kinetic', kin: { key, timeslice: t } });
                  })}
                  run={(st) => client.kinetics({
                    ...base, channel: st.yAxis, timeChannel: timeCh, settings: st,
                    scale: statScales(ws.channelTransforms, sample.flowjoLinearRanges, [st.yAxis])[st.yAxis] ?? { kind: 'linear', min: 0, max: channels.find((c) => c.name === st.yAxis)?.range ?? 1024 },
                    durationSeconds: b !== undefined && e !== undefined && e - b > 0 ? e - b : undefined,
                    timeRange: timeRange as [number, number] | undefined,
                  })}
                />
              );
            })()}
          />
        );
      })()}
      {dialog?.kind === 'group' && (() => {
        const g = dialog.id ? ws.groups.find((x) => x.id === dialog.id) : undefined;
        const crit = g?.criteria && 'rules' in g.criteria ? g.criteria : undefined;
        return (
          <GroupDialog
            initial={g ? { name: g.name, role: g.role ?? 'undefined', live: !!crit, synchronized: !!g.synchronized, color: g.color, fontStyle: g.fontStyle, criteria: crit ?? { rules: [] } } : null}
            keywords={groupKeys}
            stainSets={[...new Set(ws.samples.map(stainSet).filter(Boolean))].sort()}
            groupNames={ws.groups.filter((x) => x.id !== g?.id).map((x) => x.name)}
            takenNames={ws.groups.filter((x) => x.id !== g?.id).map((x) => x.name)}
            onClose={() => setDialog(null)}
            onSave={(d) => {
              updateWs((w) => {
                const target = g ? w.groups.find((x) => x.id === g.id)! : (() => { const n: Group = { id: newId('grp'), name: d.name, sampleIds: [...checked] }; w.groups.push(n); return n; })();
                target.name = d.name;
                target.role = d.role === 'undefined' ? undefined : d.role;
                if (d.synchronized) target.synchronized = true;
                else delete target.synchronized;
                if (d.color && d.color !== '#000000') target.color = d.color;
                else delete target.color;
                if (d.fontStyle && d.fontStyle !== 'plain') target.fontStyle = d.fontStyle;
                else delete target.fontStyle;
                if (d.live) target.criteria = d.criteria;
                else delete target.criteria;
              });
              setDialog(null);
              note('info', `Group "${d.name}" ${g ? 'updated' : 'created'}${d.live ? ' (live)' : ''}`);
            }}
          />
        );
      })()}
      {dialog?.kind === 'keywords' && sMeta && sample && (
        <KeywordsDialog
          meta={sMeta}
          onClose={() => setDialog(null)}
          onStain={(ch, stain, all) => {
            updateWs((w) => {
              for (const s of w.samples) {
                if (s.id !== sample.id && !(all && s.channelNames.includes(ch))) continue;
                s.stains = { ...(s.stains ?? {}), [ch]: stain };
              }
            });
            note('info', `Stain of ${ch} set to "${stain}"${all ? ' in every sample with this parameter' : ''}`);
          }}
        />
      )}
      {dialog?.kind === 'addKeyword' && <AddKeywordDialog onClose={() => setDialog(null)} onOk={(raw) => { updateWs((w, say) => { const n = addKeywordToAll(w.samples, raw); if (n) say('info', `Keyword "${n}" added to every sample`); }); setDialog(null); }} />}
      {dialog?.kind === 'find' && (
        <FindDialog
          samples={ws.samples}
          keywords={[...new Set(ws.samples.flatMap((s) => [...Object.keys(s.keywordsSnapshot), ...Object.keys(s.annotations ?? {})]))].sort()}
          onShow={(id) => setSel({ sampleId: id, popId: null })}
          onReplace={(hits, what, withText, opts) => updateWs((w, say) => { const n = replaceKeywords(w.samples, hits, what, withText, opts); say('info', `Replaced ${n} keyword value(s)`); })}
          onClose={() => setDialog(null)}
        />
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
      {naming && sample && (
        <GateNamerDialog
          initial={naming.name}
          siblings={siblingNames(sel.popId)}
          favorites={prefs.gateNames}
          onFavorites={(names) => setPrefs({ ...prefsRef.current, gateNames: names })}
          onOk={(name) => { createGates([{ name, gate: naming.gate }]); setNaming(null); }}
          onCancel={() => { setNaming(null); note('info', 'Gate discarded'); }}
        />
      )}
      {dialog?.kind === 'derived' && sMeta && (
        <DerivedDialog
          params={ws.derivedParameters ?? []}
          channels={sMeta.channels.map((c) => c.name)}
          usersOf={(n) => derivedParameterUsers(ws, n)}
          onClose={() => setDialog(null)}
          onChange={(dp) => updateWs((w) => { w.derivedParameters = dp; })}
        />
      )}
      {dialog?.kind === 'transform' && sMeta && (
        <TransformDialog
          channel={dialog.channel}
          spec={ws.channelTransforms[dialog.channel] ?? defaultTransform(channels.find((c) => c.name === dialog.channel)!, sMeta.keywords)}
          channelTop={channelRange(channels.find((c) => c.name === dialog.channel)!)}
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
          controls={groupSamples.map((s) => ({ id: s.id, fileName: s.fileName, loaded: !!meta[s.id] }))}
          channels={(sMeta?.channels ?? []).filter((c) => !isScatterOrTime(c.name)).map((c) => c.name)}
          gatePaths={sample.populations.map((p) => populationPath(sample.populations, p.id))}
          onWizard={async (roles, positivePct, gatePath) => {
            const controls = roles.map((r) => {
              const s = ws.samples.find((x) => x.id === r.sampleId)!;
              return { sampleId: s.id, primary: r.primary, compensation: s.compensation, populations: s.populations };
            });
            const res = await client.compWizard({ controls, channels: (sMeta?.channels ?? []).map((c) => c.name), positivePct, gatePath, matrices: ws.matrices });
            note('info', `Compensation wizard: ${res.diagnostics.length} controls -> ${res.matrix.name}`);
            for (const d of res.diagnostics) for (const w of d.warnings) note('warn', `${d.label}: ${w}`);
            return res;
          }}
          pathsBySample={Object.fromEntries(groupSamples.map((s) => [s.id, s.populations.map((q) => populationPath(s.populations, q.id))]))}
          onFlowjoWizard={async (entries) => {
            const sm = (id: string) => ws.samples.find((x) => x.id === id)!;
            const controls = entries.map((e) => { const s = sm(e.sampleId), n = sm(e.negSampleId || e.sampleId); return { sampleId: s.id, compensation: s.compensation, populations: s.populations, primary: e.primary, posPath: e.posPath, negPath: e.negPath, neg: { sampleId: n.id, compensation: n.compensation, populations: n.populations } }; });
            const detectors = (sMeta?.channels ?? []).filter((c) => !isScatterOrTime(c.name)).map((c) => c.name);
            const res = await client.flowjoWizard({ controls, matrices: ws.matrices, detectors, scales: statScales(ws.channelTransforms, sample.flowjoLinearRanges, detectors) });
            note('info', `FlowJo compensation wizard: ${res.status}`);
            return res;
          }}
          onEstimateAf={async (sampleId, detectors, gatePath) => {
            const s = ws.samples.find((x) => x.id === sampleId)!;
            const spectrum = await client.estimateAf({ sampleId, detectors, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, gatePath });
            note('info', `Autofluorescence spectrum estimated from ${s.fileName}`);
            return spectrum;
          }}
          onAssign={(ref, scope) => {
            updateWs((w) => {
              const ids = scope === 'sample' ? [sample.id] : w.groups.find((g) => g.id === groupId)!.sampleIds;
              for (const s of w.samples) if (ids.includes(s.id)) s.compensation = ref;
            });
            note('info', `Compensation set to ${ref} for ${scope === 'sample' ? sample.fileName : `group ${group?.name}`}`);
          }}
        />
      )}
      {dialog?.kind === 'manual' && sample && xAxis && (
        <ManualGateDialog
          x={xAxis}
          y={kind === 'histogram' ? null : yAxis}
          xRange={[xAxis.t.inverse(xAxis.range[0]), xAxis.t.inverse(xAxis.range[1])]}
          yRange={kind !== 'histogram' && yAxis ? [yAxis.t.inverse(yAxis.range[0]), yAxis.t.inverse(yAxis.range[1])] : null}
          xLabel={gateLabel(xAxis.channel, channels.find((c) => c.name === xAxis.channel)?.label)}
          yLabel={yAxis ? gateLabel(yAxis.channel, channels.find((c) => c.name === yAxis.channel)?.label) : ''}
          children={sample.populations.filter((p) => p.parentId === sel.popId).map((p) => p.name)}
          scales={[xAxis.channel, kind === 'histogram' ? undefined : yAxis?.channel].map((ch) => (ch ? statScales(ws.channelTransforms, sample.flowjoLinearRanges, [ch])[ch] : undefined))}
          onCreate={createGates}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'prefs' && <PrefsDialog prefs={prefs} onChange={setPrefs} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'tables' && <TablesDialog ws={ws} updateWs={updateWs} stats={stats} colLabel={colLabel} ask={ask} download={download} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'export' && sample && (
        <ExportDialog
          popLabel={popPath || 'All events'}
          hasData={!!sMeta}
          onClose={() => setDialog(null)}
          params={channels.map((c) => c.name)}
          keywords={groupKeys}
          onEvents={exportEvents}
          onSvg={() => {
            if (!xAxis || !plotData) return;
            const svg = new SvgContext(PLOT.w, PLOT.h);
            renderPlot(asCanvas(svg), { kind, x: xAxis, y: yAxis, data: plotData, gates: drawableGates(sample.populations, sel.popId, xAxis, yAxis), counts, contourLevel: plotSettings.contourLevel, showOutliers: plotSettings.showOutliers, overlays: overlayData, normalize: plotSettings.normalize, xTitle: axisTitle(xAxis.channel), yTitle: yAxis ? axisTitle(yAxis.channel) : undefined, ...displayOpts });
            download(`${sample.fileName}_${(popPath || 'all').replace(/[^\w.-]+/g, '_')}.svg`, svg.toString(), 'image/svg+xml');
          }}
          onPng={() => canvasRef.current?.toBlob((b) => b && download(`${sample.fileName}_${(popPath || 'all').replace(/[^\w.-]+/g, '_')}.png`, b, 'image/png'))}
          onWsp={() => {
            try {
              const { xml, warnings } = writeWsp({
                ws,
                sampleMatrix: (id) => {
                  const s = ws.samples.find((x) => x.id === id)!;
                  if (s.compensation === 'file') return meta[id]?.spillover ?? null;
                  return ws.matrices.find((m) => m.id === s.compensation) ?? null;
                },
                counts: (id) => {
                  const a = analysis[id];
                  return a ? Object.fromEntries(a.results.filter(Boolean).map((r) => [r.id, r.count])) : undefined;
                },
              });
              for (const w of warnings) note('warn', `.wsp export: ${w}`);
              download(`${ws.name.replace(/\.(wsp|json)$/i, '') || 'workspace'}.wsp`, xml, 'application/xml');
              note('info', 'Exported FlowJo-style .wsp (round-trip tested with this app only; not validated in FlowJo)');
            } catch (e) {
              note('error', `.wsp export: ${(e as Error).message}`);
            }
          }}
          onGatingMl={() => {
            try {
              const { xml, warnings } = exportGatingMl(sample.populations, ws.matrices, sample.compensation);
              for (const w of warnings) note('warn', `Gating-ML export: ${w}`);
              download(`${sample.fileName.replace(/\.fcs$/i, '')}_gates.xml`, xml, 'application/xml');
            } catch (e) {
              note('error', `Gating-ML export: ${(e as Error).message}`);
            }
          }}
        />
      )}
    </div>
  );
}

export interface EventExportOptions {
  format: 'fcs' | 'csv' | 'csv-channel';
  params: 'compensated' | 'uncompensated' | 'custom';
  custom: string[];
  maxEvents?: number;
  header: HeaderFormat;
  writeHeader: boolean;
  mode: 'export' | 'concatenate';
  concat: ConcatMode;
}

function ExportDialog(p: { popLabel: string; hasData: boolean; params: string[]; keywords: string[]; onClose: () => void; onEvents: (o: EventExportOptions) => void; onPng: () => void; onSvg: () => void; onGatingMl: () => void; onWsp: () => void }) {
  // FlowJo 10's "Export or Concatenate" options (specs 9).
  const [params, setParams] = useState<EventExportOptions['params']>('compensated');
  const [custom, setCustom] = useState<string[]>(p.params);
  const [capOn, setCapOn] = useState(false);
  const [cap, setCap] = useState(10000);
  const [header, setHeader] = useState<HeaderFormat>('p');
  const [writeHeader, setWriteHeader] = useState(true);
  const [mode, setMode] = useState<EventExportOptions['mode']>('export');
  const [concatKind, setConcatKind] = useState<'all' | 'everyN' | 'equalKeyword'>('all');
  const [everyN, setEveryN] = useState(2);
  const [concatKey, setConcatKey] = useState('');
  const opts = (format: EventExportOptions['format']): EventExportOptions => ({
    format, params, custom, header, writeHeader, mode,
    maxEvents: capOn ? Math.max(0, Math.floor(cap)) : undefined,
    concat: concatKind === 'all' ? { kind: 'all' } : concatKind === 'everyN' ? { kind: 'everyN', n: everyN } : { kind: 'equalKeyword', keyword: concatKey },
  });
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal" role="dialog" aria-label="Export">
        <div className="modal-head"><b>Export or Concatenate</b><button onClick={p.onClose}>x</button></div>
        <div className="modal-body">
          <h4>Events: {p.popLabel}</h4>
          <div className="row">
            <label><input type="radio" checked={mode === 'export'} onChange={() => setMode('export')} data-testid="exp-mode-export" /> Export this population</label>
            <label><input type="radio" checked={mode === 'concatenate'} onChange={() => setMode('concatenate')} data-testid="exp-mode-concat" /> Concatenate the group</label>
          </div>
          {mode === 'concatenate' && (
            <div className="row">
              <select value={concatKind} onChange={(e) => setConcatKind(e.target.value as typeof concatKind)} data-testid="exp-concat-kind">
                <option value="all">all files together</option>
                <option value="everyN">every n files</option>
                <option value="equalKeyword">files with equal keyword values</option>
              </select>
              {concatKind === 'everyN' && <input type="number" min={1} value={everyN} onChange={(e) => setEveryN(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 50 }} aria-label="n" />}
              {concatKind === 'equalKeyword' && <select value={concatKey} onChange={(e) => setConcatKey(e.target.value)} aria-label="keyword"><option value="">keyword...</option>{p.keywords.map((k) => <option key={k} value={k}>{k}</option>)}</select>}
              <span className="muted">adds a SampleID parameter</span>
            </div>
          )}
          <div className="row">
            Parameters <select value={params} onChange={(e) => setParams(e.target.value as EventExportOptions['params'])} data-testid="exp-params">
              <option value="compensated">all compensated</option>
              <option value="uncompensated">all uncompensated</option>
              <option value="custom">custom</option>
            </select>
          </div>
          {params === 'custom' && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {p.params.map((n) => <label key={n}><input type="checkbox" checked={custom.includes(n)} onChange={() => setCustom((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]))} /> {n}</label>)}
            </div>
          )}
          <div className="row">
            <label title="FlowJo takes every k-th event (k = count / N), not a random sample"><input type="checkbox" checked={capOn} onChange={(e) => setCapOn(e.target.checked)} data-testid="exp-cap-on" /> no more than</label>
            <input type="number" min={0} value={cap} onChange={(e) => setCap(Number(e.target.value))} disabled={!capOn} style={{ width: 80 }} data-testid="exp-cap" /> events
          </div>
          <div className="row">
            CSV header <select value={header} onChange={(e) => setHeader(e.target.value as HeaderFormat)} data-testid="exp-header">
              <option value="p">parameter name</option>
              <option value="s">stain</option>
              <option value="ps">both</option>
            </select>
            <label><input type="checkbox" checked={writeHeader} onChange={(e) => setWriteHeader(e.target.checked)} /> include header</label>
          </div>
          <div className="row">
            <button disabled={!p.hasData} onClick={() => p.onEvents(opts('csv'))} data-testid="export-csv">CSV - scale values</button>
            <button disabled={!p.hasData} onClick={() => p.onEvents(opts('csv-channel'))} data-testid="export-csv-channel">CSV - channel values</button>
            <button disabled={!p.hasData} onClick={() => p.onEvents(opts('fcs'))} data-testid="export-fcs">FCS 3.1</button>
          </div>
          <h4>Plot and gates</h4>
          <div className="row">
            <button disabled={!p.hasData} onClick={p.onPng} data-testid="export-png">Plot PNG</button>
            <button disabled={!p.hasData} onClick={p.onSvg} data-testid="export-svg" title="Vector axes, text, gates, contours and histograms; pseudocolor density embedded as an image">Plot SVG</button>
            <button onClick={p.onGatingMl} data-testid="export-gml">Gates as Gating-ML 2.0</button>
            <button onClick={p.onWsp} data-testid="export-wsp" title="Round-trip tested with this app; not validated by opening in FlowJo">FlowJo-style .wsp (unvalidated in FlowJo)</button>
          </div>
          <p className="muted">Statistics CSV export is in the Statistics panel. Workspace save is in the toolbar.</p>
        </div>
      </div>
    </div>
  );
}

