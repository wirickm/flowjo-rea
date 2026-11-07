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
import { channelRange, defaultTransform, isScatterOrTime, makeAxis, sampleChannels, withStains, withUncompTwins } from './axes';
import { channelDisplayName } from '../core/fcs';
import { readMtx } from '../core/compFlowjo';
import { EVENT_NUMBER } from '../core/formula';
import { AddKeywordDialog, CompensationDialog, DerivedDialog, FindDialog, GateNamerDialog, KeywordsDialog, TransformDialog } from './Dialogs';
import { MATRIX_DRAG_TYPE } from './CompEditor';
import { ClusterParamButtons, FormatFileButtons } from './FormatTools';
import { GroupDialog } from './GroupDialog';
import { ContextMenu, GateActions, ManualGateDialog, type MenuItem } from './GateActions';
import { everyNth, FLOWJO_FUNCTIONS, removeFromGroup, stainSet } from '../core/groupCriteria';
import { concatGroups, type ConcatMode, type HeaderFormat } from '../core/exportRules';
import { GRAPH_H, GRAPH_W, LayoutView } from './Layout';
import { COPY_TO_LAYOUT_POINT, placeRow } from '../core/layoutArrange';
import { PlatformsDialog } from './Platforms';
import { useRibbon } from './RibbonConfig';
import { QualityReport } from './QualityReport';
import { QUALITY_LOOK, checkSampleQuality, elapsedSeconds, qualityChannels, qualityParameters, type SampleQualityResult } from '../core/sampleQuality';
import { WS_RIBBON } from './ribbons';
import { PlatformToolHost, type PlatformTool } from './PlatformTools';
import { KineticsPanel } from './Kinetics';
import { defaultKinetics, KIN_KEYS, KIN_LABELS } from '../core/kinetics';
import type { Axis } from './gateGeometry';
import { Plot, TOOL_HINTS, TOOL_KEYS, TOOL_LABELS, TOOLS_1D, TOOLS_2D, type PlotKind, type Tool } from './Plot';
import { AUTO_GATE_BINS, bisectorNames, convertGate, gateLabel } from '../core/gateTools';
import { formatFreq, PLOT, renderPlot } from './renderPlot';
import { Popout } from './Popout';
import { asCanvas, SvgContext } from './svgContext';
import { drawableGates } from './gateGeometry';
import { initHistory, pushHistory, redo, undo, type History } from './history';
import { createAnalysisClient } from './workerClient';
import { autoSaveMessage, CONFIRM, edgeWarning, loadPrefs, rememberDontAsk, savePrefs, shouldAutoSave, skipConfirm, type Prefs } from '../core/prefs';
import { PrefsDialog, TablesDialog } from './Editors';
import { AddStatDialog, BooleanExprDialog, EditColumnsDialog, NamingDialog, ValueSeriesDialog } from './WorkspaceTools';
import { ScriptEditorDialog } from './ScriptEditor';
import type { ScriptOp, ScriptSnapshot } from '../core/scriptApi';
import { compileBoolExpr, exprOfGate, makeAndOr, makeCombination, makeIdentities, makeNots, MAX_COMBINATION, parseBoolExpr, BoolExprError } from '../core/booleanExpr';
import { columnLabel, excelRows, isKeywordColumn, keywordEditable, keywordName, NAME, NCELLS, populationCell, sampleCell, setKeyword, sortSamples, STATISTIC, tableColumns, type TableRow } from '../core/workspaceTable';
import { applyGroupTemplates, buildArchive, makeTemplate, readArchive } from '../core/template';
import { xlsxBytes } from '../core/xlsx';
import { writeZip } from '../core/zip';
import { ColorTableDialog, GraphOptionsPanel, RangeDialog } from './GraphOptions';
import { arcsinhAutoM, autoWidthBasis, canShowOutliers, canSetForeground, clusterRanges, colorRowsFromString, colorTable, derivedFor, likeParameters, linLogSpec, peakRanges, resolutionOf, smoothingOf, specWithRange } from '../core/graphDisplay';

const client = createAnalysisClient();

type Analysis = { results: PopulationResult[]; total: number; compError?: string };
type Dialog = null | { kind: 'addKeyword' } | { kind: 'find' } | { kind: 'group'; id: string | null } | { kind: 'comp' } | { kind: 'keywords' } | { kind: 'transform'; channel: string } | { kind: 'export'; mode?: 'group' } | { kind: 'layout' } | { kind: 'derived' } | { kind: 'platforms' } | { kind: 'manual' } | { kind: 'prefs' } | { kind: 'tables' } | { kind: 'tool'; tool: PlatformTool } | { kind: 'boolExpr'; editId?: string } | { kind: 'naming'; op: 'and' | 'or' | 'combo'; ids: string[] } | { kind: 'columns' } | { kind: 'addStat' } | { kind: 'series' } | { kind: 'addKeywordGroup' } | { kind: 'scripts' };

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
      const synced = syncLiveGroups(copy);
      if (applyGroupTemplates(copy) || synced) w = copy;
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
  const globalKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
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
    globalKeyRef.current = onKey;
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
  const channels = useMemo(() => {
    if (!sMeta || !sample) return [];
    let cs = sampleChannels(sMeta, sample.compensation, ws.matrices, ws.derivedParameters);
    if (ws.showUncompensated && sample.compensation !== 'none') {
      const m = sample.compensation === 'file' ? sMeta.spillover : ws.matrices.find((x) => x.id === sample.compensation);
      cs = withUncompTwins(cs, m?.channels ?? []);
    }
    // Show Event # Parameter: an "Event #" axis at the end of the list (specs 24.2).
    return ws.showEventNumber ? [...cs, { index: cs.length + 1, name: EVENT_NUMBER, label: '', bits: 32, range: Math.max(1, sample.eventCount), logDecades: 0, logOffset: 0, gain: 1 }] : cs;
  }, [sMeta, sample?.compensation, sample?.eventCount, ws.matrices, ws.derivedParameters, ws.showEventNumber, ws.showUncompensated]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // Revert (WSDocument.revert): back to the workspace as last opened or saved.
  const baselineRef = useRef<Workspace>(hist.present);
  // Files of an opened archive, added once the opened workspace is current.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  useEffect(() => {
    if (!pendingFiles) return;
    setPendingFiles(null);
    void addFiles(pendingFiles);
  }, [pendingFiles]); // eslint-disable-line react-hooks/exhaustive-deps
  const resetTo = (w: Workspace) => {
    void (async () => {
      for (const id of Object.keys(meta)) await client.unload(id);
      setMeta({}); setAnalysis({}); setStats({});
      undoOffRef.current = prefsRef.current.noUndo;
      setHist(initHistory(w));
      baselineRef.current = w;
      setGroupId('all'); setRowSel([]); setChecked([]); setMulti([]);
      setSel({ sampleId: w.samples[0]?.id ?? null, popId: null });
    })();
  };
  const revertWs = async () => {
    if (!hist.past.length && ws === baselineRef.current) return note('info', 'Nothing to revert');
    const a = await ask('Are you sure you want to discard changes made to this workspace?', ['Revert']);
    if (a !== 'Revert') return;
    const back = baselineRef.current;
    const keep = Object.keys(meta).filter((id) => back.samples.some((s) => s.id === id));
    for (const id of Object.keys(meta)) if (!keep.includes(id)) await client.unload(id);
    setMeta((m) => Object.fromEntries(Object.entries(m).filter(([id]) => keep.includes(id))));
    setHist(initHistory(back));
    setRowSel([]); setMulti([]);
    if (!back.samples.some((s) => s.id === sel.sampleId)) setSel({ sampleId: back.samples[0]?.id ?? null, popId: null });
    note('info', 'Reverted to the workspace as last opened or saved');
  };
  // Close (WSCloseAction -> SWorkspace.close): the workspace closes; here an
  // empty workspace takes its place (a browser page cannot close itself).
  const closeWs = async () => {
    if (ws.samples.length || hist.past.length) {
      const a = await ask('Close this workspace? Unsaved changes are lost.', ['Close']);
      if (a !== 'Close') return;
    }
    resetTo(emptyWorkspace());
    note('info', 'Workspace closed');
  };
  // Export as Template (WSDocument.saveTemplate): no samples; groups keep their analysis.
  const exportTemplate = () => {
    const t = makeTemplate(ws);
    download(`${(ws.name || 'workspace').replace(/\.(wsp|json|wspt)$/i, '').replace(/\.frea$/i, '')}.wspt`, serializeWorkspace(t), 'application/json');
    note('info', `Saved template: ${t.groups.length} group(s), ${t.groups.filter((g) => g.analysis?.length).length} with group analysis`);
  };
  // Save as Archive (own rule for WSDocument.doSaveACS): workspace + FCS files in one ZIP.
  const saveArchive = async () => {
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const s of ws.samples) {
      const b = meta[s.id] ? await run(() => client.rawBytes(s.id)) : null;
      if (b) files.push({ name: s.fileName, bytes: b });
    }
    const missing = ws.samples.length - files.length;
    download(`${(ws.name || 'workspace').replace(/\.(wsp|json|wspt)$/i, '').replace(/\.frea$/i, '')}.zip`, buildArchive(serializeWorkspace(ws), files) as BlobPart, 'application/zip');
    setSavedOnce(true); baselineRef.current = ws;
    note(missing ? 'warn' : 'info', `Saved archive with ${files.length} FCS file(s)${missing ? `; ${missing} sample(s) without data not included` : ''}`);
  };
  // Recalculate Statistics (WSRecalcAction -> WSSampleMgr.touchAll).
  const [recalc, setRecalc] = useState(0);
  const recalcStats = () => { analysedKey.current = {}; setRecalc((r) => r + 1); note('info', 'Recalculating all statistics'); };

  const openWorkspace = async (file: File) => {
    // FlowJo 10 opens a .wsp in a new window; here it replaces the open
    // workspace, so ask first when there is work to lose (specs 6.7).
    if (ws.samples.length || hist.past.length) {
      const a = await ask(`Open ${file.name}? It replaces the current workspace; unsaved changes are lost (Save workspace first to keep them).`, ['Open']);
      if (a !== 'Open') return;
    }
    await run(async () => {
      const lower = file.name.toLowerCase();
      let archived: File[] = [];
      let text: string;
      if (lower.endsWith('.zip') || lower.endsWith('.acs')) {
        // Save as Archive (own rule): the workspace plus its FCS files.
        const arc = readArchive(new Uint8Array(await file.arrayBuffer()));
        text = arc.workspace;
        archived = arc.files.map((f) => new File([f.bytes as BlobPart], f.name));
      } else text = await file.text();
      let next: Workspace;
      if (lower.endsWith('.wsp') || (lower.endsWith('.wspt') && text.trimStart().startsWith('<'))) {
        const imp = parseWsp(text);
        next = imp.workspace;
        next.name = file.name;
        for (const w of imp.warnings) note('warn', w);
        note('info', `Imported FlowJo workspace (${imp.flowjoVersion}): ${next.samples.length} samples. Add the FCS files to relink data.`);
      } else {
        next = deserializeWorkspace(text);
        if (lower.endsWith('.wspt')) next.name = file.name.replace(/\.wspt$/i, '.wsp'); // a template opens as a new workspace (WSDocument.convertTemplateToWorkspace)
        note('info', lower.endsWith('.wspt') ? `Opened template ${file.name}: add samples; they join its groups and receive the group analysis.` : `Opened workspace ${next.name}: ${next.samples.length} samples.${archived.length ? '' : ' Add the FCS files to relink data.'}`);
      }
      for (const id of Object.keys(meta)) await client.unload(id);
      setMeta({});
      setAnalysis({});
      setStats({});
      undoOffRef.current = prefsRef.current.noUndo;
      setHist(initHistory(next)); // opening a workspace resets history
      baselineRef.current = next;
      if (archived.length) setPendingFiles(archived);
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
  }, [sample?.id, sample?.compensation, sample?.populations, ws.matrices, meta, run, note, recalc]);

  // --- FlowJo-style window layout (specs 23) -------------------------------------
  // Default; "?layout=classic" or the Configure tab switches to the four-panel layout.
  const [uiLayout, setUiLayout] = useState<'flowjo' | 'classic'>(() => {
    try { const q = new URLSearchParams(location.search).get('layout'); if (q === 'classic' || q === 'flowjo') return q; return (localStorage.getItem('flowjo-rea.layout') as 'flowjo' | 'classic') || 'flowjo'; } catch { return 'flowjo'; }
  });
  const switchLayout = (l: 'flowjo' | 'classic') => { setUiLayout(l); try { localStorage.setItem('flowjo-rea.layout', l); } catch { /* per-viewer convenience */ } };
  const [ribbonTab, setRibbonTab] = useState('Workspace');
  // Ribbon customisation (WSRibbonStructure; docs/validation/ui-gaps/workspace.md).
  const wsRib = useRibbon(WS_RIBBON);
  const rb = (band: string) => wsRib.has(ribbonTab, band);
  const rs = (band: string) => wsRib.style(ribbonTab, band);
  // Follow-up formats (FACSDiva, CSV/CLR, consensus / cluster frequency): src/ui/FormatTools.tsx.
  const formatProps = { ws, updateWs: (f: (w: Workspace) => void) => updateWs((w) => f(w)), sample, counts: sample ? Object.fromEntries((analysis[sample.id]?.results ?? []).filter(Boolean).map((r) => [r.id, r.count])) : undefined, download, note };
  const [drawer, setDrawer] = useState<'stats' | 'groups' | 'samples' | 'log' | null>('stats');
  const [collapsedSamples, setCollapsedSamples] = useState<string[]>([]);
  // Workspace table: multi-row selection ("<sampleId>|<popId>"), view toggles
  // (not saved, as in FlowJo: PopTreeTableModel defaults) and the keyword cell being edited.
  const [rowSel, setRowSel] = useState<string[]>([]);
  const [viewOpts, setViewOpts] = useState({ stats: true, comp: false, platforms: true, dp: true });
  const [editCell, setEditCell] = useState<{ sid: string; key: string } | null>(null);
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
  }, [uiLayout, groupSamples, meta, ws.matrices, ws.derivedParameters, sample?.id, recalc]); // eslint-disable-line react-hooks/exhaustive-deps
  // Graph windows: one per opened node (GWFrame); the active one hosts the live
  // plot, the others keep a picture of their last view (own rule).
  type GraphWin = { id: string; sampleId: string; popId: string | null; x: number; y: number; snap?: string; inPage?: boolean };
  // FlowJo opens each graph in its own OS window; this app does too (browser or
  // Electron child windows), with in-page windows as the fallback / option.
  const [separateWins, setSeparateWins] = useState<boolean>(() => { try { return localStorage.getItem('flowjo-rea.separateWindows') !== '0'; } catch { return true; } });
  const toggleSeparate = (on: boolean) => { setSeparateWins(on); try { localStorage.setItem('flowjo-rea.separateWindows', on ? '1' : '0'); } catch { /* per-viewer */ } };
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
  // Dialogs live in the workspace window: bring it forward when one opens from a separate graph window.
  useEffect(() => { if ((naming || dialog || question) && separateWins && activeWin) window.focus(); }, [naming, dialog, question]); // eslint-disable-line react-hooks/exhaustive-deps
  // In-window navigation (gating path, double-click a gate, sample keys) moves the active window.
  useEffect(() => {
    if (!activeWin || !sel.sampleId) return;
    setWins((ws0) => ws0.map((w) => (w.id === activeWin && (w.sampleId !== sel.sampleId || w.popId !== sel.popId) ? { ...w, sampleId: sel.sampleId!, popId: sel.popId } : w)));
  }, [sel, activeWin]);
  // A single click in the sample table selects without moving a graph window.
  const selectInTable = (sampleId: string, popId: string | null, e?: React.MouseEvent) => {
    const key = `${sampleId}|${popId ?? ''}`;
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) setRowSel((r) => { const base = r.length ? r : sel.sampleId ? [`${sel.sampleId}|${sel.popId ?? ''}`] : []; return base.includes(key) ? base.filter((x) => x !== key) : [...base, key]; });
    else setRowSel([key]);
    // The table's multi-selection starts from the selected row, as in FlowJo's tree table.
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey) && popId && sampleId === sample?.id) { setMulti((m0) => { const m = m0.length || !sel.popId || sel.popId === popId ? m0 : [sel.popId]; return m.includes(popId) ? m.filter((x) => x !== popId) : [...m, popId]; }); return; }
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey) && sel.sampleId) return; // other rows join the table selection
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
  const displayOpts: { grid: boolean; largeDots: boolean; medians: boolean; gateNames: boolean; gateFreq: boolean; colorBy?: { values: ArrayLike<number>; range: [number, number]; label: string } } = { grid: !!plotSettings.grid, largeDots: !!plotSettings.largeDots, medians: !!plotSettings.medians, gateNames: !plotSettings.hideGateNames, gateFreq: !plotSettings.hideGateFreq };
  const xAxis = useMemo(() => axisFor(plotSettings.x), [axisFor, plotSettings.x]);
  const yAxis = useMemo(() => (kind === 'histogram' ? null : axisFor(plotSettings.y ?? '')), [axisFor, plotSettings.y, kind]);
  const colorAxis = useMemo(() => (kind === 'pseudocolor' && plotSettings.colorBy ? axisFor(plotSettings.colorBy) : null), [axisFor, plotSettings.colorBy, kind]);
  if (colorAxis && plotData?.colorMean) displayOpts.colorBy = { values: plotData.colorMean, range: colorAxis.range, label: colorAxis.channel };
  // Graph window options (src/core/graphDisplay.ts; docs/validation/ui-gaps/graph.md).
  const smoothing = smoothingOf(kind, plotSettings, prefs.smoothing1D);
  const showOutliers = !!plotSettings.showOutliers && canShowOutliers(kind, smoothing > 0);
  const ctable = useMemo(() => (prefs.colorTable ? colorTable(colorRowsFromString(prefs.colorTable)) : undefined), [prefs.colorTable]);
  const graphOpts = { smoothing, foreColor: canSetForeground(kind, smoothing > 0) ? plotSettings.foreColor : undefined, backColor: plotSettings.backColor, yMax: kind === 'histogram' ? plotSettings.yMax : undefined, scientific: prefs.scientificNotation, colorTable: ctable };
  Object.assign(displayOpts, graphOpts);

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
        bins: resolutionOf(plotSettings),
        xRange: xAxis.range,
        yRange: yAxis ? yAxis.range : null,
        // Dot plots draw "# Dots" events (preference dotsToDraw, 8000).
        maxPoints: kind === 'dot' ? (plotSettings.nDots ?? prefs.dotsToDraw) : 20000,
        ...(colorAxis && yAxis ? { color: { kind: 'channel' as const, channel: colorAxis.channel, transform: colorAxis.spec } } : {}),
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
          bins: resolutionOf(plotSettings), xRange: xAxis.range, yRange: yAxis ? yAxis.range : null, maxPoints: 5000,
        });
        ovs.push({ label: path, data: od });
      }
      if (live) setOverlayData(ovs);
    });
    return () => { live = false; };
  }, [sample?.id, sample?.compensation, sample?.populations, ws.matrices, meta, sel.popId, xAxis, yAxis, colorAxis, run, plotSettings.overlays, plotSettings.resolution, plotSettings.nDots, kind === 'dot', prefs.dotsToDraw]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [ws.statColumns, ws.samples, ws.matrices, ws.derivedParameters, ws.channelTransforms, groupId, meta, recalc]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Script Editor (docs/validation/ui-gaps/workspace.md, SCRIPTEDITOR): the
  // workspace as the scripting API sees it, and the changes a script made.
  const scriptSnapshot = (): ScriptSnapshot => ({
    name: ws.name,
    groups: ws.groups.map((g) => ({ name: g.name, sampleIds: g.id === 'all' ? ws.samples.map((s) => s.id) : [...g.sampleIds] })),
    samples: ws.samples.map((s) => {
      const a = analysis[s.id];
      const chans = meta[s.id]?.channels ?? s.channelNames.map((n, i) => ({ name: n, label: '', index: i + 1 }));
      return {
        id: s.id, name: s.fileName, keywords: { ...s.keywordsSnapshot, ...(s.annotations ?? {}) }, total: a ? a.total : null,
        params: chans.map((c) => ({ name: c.name, stain: s.stains?.[c.name] ?? c.label, longName: c.label, index: c.index })),
        pops: s.populations.map((q) => ({ id: q.id, name: q.name, parentId: q.parentId, count: a?.results.find((r) => r.id === q.id)?.count ?? null })),
      };
    }),
  });
  const applyScriptOps = (ops: ScriptOp[]) => updateWs((w) => {
    const ids = new Map<string, string>();
    for (const o of ops) {
      const s = 'sampleId' in o ? w.samples.find((x) => x.id === o.sampleId) : undefined;
      if (o.op === 'rename') { const q = s?.populations.find((x) => x.id === o.popId); if (q) q.name = o.name; }
      else if (o.op === 'keyword' && s) { if (o.value === null) { if (s.annotations) delete s.annotations[o.key]; } else setKeyword([s], o.key, o.value); }
      else if (o.op === 'groupCreate') { if (!w.groups.some((g) => g.name === o.name)) w.groups.push({ id: newId('grp'), name: o.name, sampleIds: [] }); }
      else if (o.op === 'groupRemove') w.groups = w.groups.filter((g) => g.id === 'all' || g.name !== o.name);
      else if (o.op === 'groupAdd') { const g = w.groups.find((x) => x.name === o.name); if (g && g.id !== 'all' && !g.sampleIds.includes(o.sampleId)) g.sampleIds.push(o.sampleId); }
      else if (o.op === 'groupRemoveSample') { const g = w.groups.find((x) => x.name === o.name); if (g && g.id !== 'all') g.sampleIds = g.sampleIds.filter((x) => x !== o.sampleId); }
      else if (o.op === 'gate' && s) {
        const parentId = o.parentId ? ids.get(o.parentId) ?? o.parentId : null;
        const m = meta[s.id];
        const dims = o.params.map((ch) => ({ kind: 'channel' as const, channel: ch, transform: (m ? makeAxis(m.channels, m.keywords, w.channelTransforms, ch)?.spec : undefined) ?? w.channelTransforms[ch] ?? { kind: 'none' as const } }));
        const tf = dims.map((d) => makeTransform(d.transform));
        const id = newId('pop');
        ids.set(o.id, id);
        const name = uniqueName(o.name, s.populations.filter((x) => x.parentId === parentId).map((x) => x.name));
        s.populations.push({ id, name, parentId, gate: { type: 'rect', dims, min: o.min.map((v, i) => tf[i].apply(v)), max: o.max.map((v, i) => tf[i].apply(v)) } });
      }
    }
  });

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
  // AND / OR / Combination first ask for abbreviations (Boolean Gate Naming
  // Dialog); NOT names "<name>-", AND "A+ & B+", OR "A+ or B+" (WSBoolGateAction;
  // docs/validation/ui-gaps/workspace.md, section B).
  const makeBoolean = (op: 'and' | 'or' | 'not') => {
    if (!sample) return;
    if (op === 'not') {
      if (!notOperand) return;
      const made = makeNots(sample, multi.length ? multi : [notOperand]);
      updateWs((w) => { w.samples.find((x) => x.id === sample.id)!.populations.push(...made); });
      setMulti([]);
      return;
    }
    if (multi.length < 2) return;
    setDialog({ kind: 'naming', op, ids: [...multi] });
  };
  const finishNaming = (op: 'and' | 'or' | 'combo', ids: string[], abbr: Record<string, string>) => {
    if (!sample) return;
    const made = op === 'combo' ? makeCombination(sample, ids, abbr) : (() => { const p = makeAndOr(sample, op, ids, abbr); return p ? [p] : null; })();
    if (!made) return note('warn', `Create Combination Gates takes 2 to ${MAX_COMBINATION} populations`);
    updateWs((w) => { w.samples.find((x) => x.id === sample.id)!.populations.push(...made); });
    note('info', `Created ${made.map((m) => m.name).join(', ')}`);
    setMulti([]);
  };
  const boolTargets = () => (multi.length ? multi : sel.popId ? [sel.popId] : []);
  const makeCombo = () => {
    const ids = boolTargets();
    if (ids.length < 2 || ids.length > MAX_COMBINATION) return note('warn', `Create Combination Gates takes 2 to ${MAX_COMBINATION} selected populations (Ctrl-click to select)`);
    setDialog({ kind: 'naming', op: 'combo', ids });
  };
  const makeIdentity = () => {
    if (!sample) return;
    const made = makeIdentities(sample, boolTargets());
    if (!made.length) return;
    updateWs((w) => { w.samples.find((x) => x.id === sample.id)!.populations.push(...made); });
    setMulti([]);
  };
  // Boolean Expression / edit (own rule): compiled into AND / OR / NOT nodes.
  const applyBoolExpr = (text: string, editId?: string): string | null => {
    if (!sample) return 'No sample';
    try {
      const target = editId ? sample.populations.find((p) => p.id === editId) : undefined;
      const anchor = target ?? (sel.popId ? sample.populations.find((p) => p.id === sel.popId) : undefined);
      const parentId = anchor ? anchor.parentId : null;
      const r = compileBoolExpr(sample, parentId, parseBoolExpr(text), editId);
      if (editId && subtreeIds(sample.populations, [editId]).size > 1 && r.gate.operands.some((o) => subtreeIds(sample.populations, [editId]).has(o.ref))) return 'An operand cannot be the gate itself or one of its children';
      const name = uniqueName(r.name, sample.populations.filter((p) => p.parentId === parentId && p.id !== editId).map((p) => p.name));
      updateWs((w) => {
        const sw = w.samples.find((x) => x.id === sample.id)!;
        sw.populations.push(...r.added);
        if (editId) sw.populations.find((p) => p.id === editId)!.gate = r.gate;
        else sw.populations.push({ id: newId('pop'), name, parentId, gate: r.gate });
      });
      setDialog(null);
      note('info', editId ? `Changed "${target?.name}" to ${text}` : `Created ${name}`);
      return null;
    } catch (e) {
      return e instanceof BoolExprError ? e.message : String((e as Error).message ?? e);
    }
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
    // Several populations, or each group sample's equivalent population: one
    // file each (ExportNodesPopsModel / ExportNodesGroupModel), downloaded in
    // one ZIP when there is more than one (own rule: a browser writes no folder).
    if (o.mode === 'populations' || o.mode === 'group') {
      const targets = exportTargets(o.mode);
      if (!targets.length) { note('warn', 'No population with loaded data to export'); return; }
      const files: { name: string; data: Uint8Array }[] = [];
      for (const t of targets) {
        const s = ws.samples.find((x) => x.id === t.sid)!;
        const bytes = await run(() => client.exportEvents(base(t.sid, t.popId)));
        if (!bytes) return;
        let name = `${safe(`${s.fileName.replace(/\.fcs$/i, '')}_${t.popId ? populationPath(s.populations, t.popId) : 'All events'}`)}.${ext}`;
        for (let k = 1; files.some((f) => f.name === name); k++) name = name.replace(/(\.\w+)$/, `-${k}$1`);
        files.push({ name, data: bytes as Uint8Array });
      }
      if (files.length === 1) download(files[0].name, files[0].data as BlobPart, type);
      else download(`${safe(o.mode === 'group' ? `${group?.name ?? 'group'}_${popPath || 'All events'}` : 'populations')}.zip`, writeZip(files) as BlobPart, 'application/zip');
      note('info', `Exported ${files.length} file(s)`);
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
  // Copy Image (GateWinController.doCopy): the plot as an image on the system
  // clipboard; Copy Image keeps a transparent background, Copy Image Without
  // Transparency (COPYPICTURENOTRANS) a white one.
  const plotImage = (transparent: boolean): HTMLCanvasElement | null => {
    if (!transparent) return canvasRef.current;
    if (!sample || !xAxis) return null;
    const cv = document.createElement('canvas');
    cv.width = PLOT.w; cv.height = PLOT.h;
    renderPlot(cv.getContext('2d')!, { kind, x: xAxis, y: yAxis, data: plotData, gates: drawableGates(sample.populations, sel.popId, xAxis, yAxis), counts, contourLevel: plotSettings.contourLevel, showOutliers, overlays: overlayData, normalize: plotSettings.normalize, xTitle: axisTitle(xAxis.channel), yTitle: yAxis ? axisTitle(yAxis.channel) : undefined, ...displayOpts, transparent: true });
    return cv;
  };
  const copyPlotImage = (transparent = true) => {
    const cv = plotImage(transparent);
    if (!cv) return;
    cv.toBlob((blob) => {
      const fail = () => note('error', 'There was an error adding the image to the system clipboard.');
      if (!blob || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return fail();
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => note('info', 'Plot image copied'), fail);
    }, 'image/png');
  };
  // --- Graph window commands (docs/validation/ui-gaps/graph.md) ----------------
  const [colorTableOpen, setColorTableOpen] = useState(false);
  const [rangeDlg, setRangeDlg] = useState<{ channel: string; min: number; max: number } | null>(null);
  // Gate colour (SETGATECOLOR: every quad of a quad set) and Tint (TINTGATE).
  const setGateLook = (id: string, patch: { tint?: string; tinted?: boolean }) => sample && updateWs((w) => {
    const pops = w.samples.find((x) => x.id === sample.id)!.populations;
    const p = pops.find((q) => q.id === id);
    if (!p) return;
    const quadKinds = ['quadrant', 'splineQuadrant', 'spider', 'curlyQuad'];
    const targets = patch.tint !== undefined && quadKinds.includes(p.gate.type) ? pops.filter((q) => q.parentId === p.parentId && q.gate.type === p.gate.type) : [p];
    for (const q of targets) {
      if (patch.tint !== undefined) q.tint = patch.tint;
      if (patch.tinted !== undefined) { if (patch.tinted) q.tinted = true; else delete q.tinted; }
    }
  });
  // Ranges on the X dimension of the shown population, in scale units.
  const makeRanges = (ranges: { name: string; min: number; max: number }[], axis: Axis) => {
    if (!sample || !ranges.length) return;
    const X = { kind: 'channel' as const, channel: axis.channel, transform: axis.spec };
    const kids = sample.populations.filter((p) => p.parentId === sel.popId);
    const same = (p: Population, r: { name: string; min: number; max: number }) => p.name === r.name && p.gate.type === 'rect' && p.gate.dims.length === 1 && p.gate.min[0] === r.min && p.gate.max[0] === r.max;
    // A child with the same name and range is replaced (FlowCAPUtil.createSubPopGate).
    const fresh = ranges.filter((r) => !kids.some((p) => same(p, r)));
    if (fresh.length) createGates(fresh.map((r) => ({ name: r.name, gate: { type: 'rect', dims: [X], min: [r.min], max: [r.max] } })));
    note('info', `${ranges.length} range gate(s)${fresh.length < ranges.length ? ` (${ranges.length - fresh.length} already present)` : ''}`);
  };
  // Create Gates On Peaks: the shown population's unsmoothed 256-bucket histogram.
  const gatesOnPeaks = async () => {
    if (!sample || !xAxis || kind !== 'histogram') return;
    const d = await client.plot({ sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices, derived: ws.derivedParameters, popId: sel.popId, x: { kind: 'channel', channel: xAxis.channel, transform: xAxis.spec }, y: null, bins: 256, xRange: xAxis.range, yRange: null, maxPoints: 1 });
    const [a, b] = xAxis.range;
    const ranges = peakRanges(Float64Array.from(d.density), xAxis.channel).map((r) => ({ name: r.name, min: a + (r.lo / 256) * (b - a), max: a + (r.hi / 256) * (b - a) }));
    if (!ranges.length) return note('warn', 'No peaks found');
    makeRanges(ranges, xAxis);
  };
  // Create Cluster Gates: a range per integer value of the axis named "cluster".
  const clusterGates = () => {
    const axis = xAxis?.channel === 'cluster' ? xAxis : yAxis?.channel === 'cluster' ? yAxis : null;
    if (!axis || !sMeta) return;
    const c = channels.find((x) => x.name === 'cluster');
    const pnr = c && c.index <= sMeta.channels.length ? sMeta.keywords[`$P${c.index}R`] : undefined;
    makeRanges(clusterRanges(axis.t.inverse(axis.range[1]), pnr).map((r) => ({ name: r.name, min: axis.t.apply(r.min), max: axis.t.apply(r.max) })), axis);
  };
  // Transform menu of an axis (TransformChangeAction.makePopup, own additions).
  const specOf = (ch: string): TransformSpec | null => { const c = channels.find((x) => x.name === ch); return c && sMeta ? ws.channelTransforms[ch] ?? defaultTransform(c, sMeta.keywords) : null; };
  const setSpecs = (specs: Record<string, TransformSpec | null>) => updateWs((w) => { for (const [k, v] of Object.entries(specs)) { if (v) w.channelTransforms[k] = v; else delete w.channelTransforms[k]; } });
  const fluor = (n: string) => !isScatterOrTime(n) && channels.find((c) => c.name === n)?.label !== 'derived';
  const isTime = (n: string) => /^time$/i.test(n);
  const calcWidth = async (ch: string) => {
    const spec = specOf(ch);
    if (spec?.kind === 'asinh') { const M = arcsinhAutoM(spec.T); setSpecs({ [ch]: { ...spec, M } }); return note('info', `${ch}: width basis ${+(-(10 ** M)).toPrecision(4)}`); }
    if (!sample || !spec || (spec.kind !== 'flowjo-biex' && spec.kind !== 'logicle')) return note('warn', 'Calculate Width Basis applies to biexponential (logicle) scales');
    const values = await client.dimensionValues({ sampleId: sample.id, compensation: sample.compensation, populations: sample.populations, matrices: ws.matrices, derived: ws.derivedParameters }, { kind: 'channel', channel: ch, transform: { kind: 'none' } });
    const t = makeTransform(spec);
    const pos = (v: number) => (t.apply(v) - t.displayMin) / (t.displayMax - t.displayMin);
    const M = spec.kind === 'flowjo-biex' ? spec.pos : spec.M, T = spec.kind === 'flowjo-biex' ? spec.max : spec.T;
    const w = autoWidthBasis(values, pos, M, T);
    let next: TransformSpec;
    if (spec.kind === 'flowjo-biex') next = { ...spec, width: w };
    else { const W = Math.min(spec.M / 2, Math.log10(-w) / 2); next = { ...spec, W, A: Math.min(Math.max(spec.A, -W), spec.M - 2 * W) }; }
    setSpecs({ [ch]: next });
    note('info', `${ch}: width basis ${+w.toPrecision(4)}`);
  };
  // Check Sample Quality (WSSampleQualityAction: every sample of the current
  // group; SampleQualityControl / engine SampleValidity rules in
  // src/core/sampleQuality.ts). Results live with the window, not the file.
  const [quality, setQuality] = useState<Record<string, SampleQualityResult>>({});
  const [qualityReport, setQualityReport] = useState<string | null>(null);
  const checkQuality = async () => {
    const out: Record<string, SampleQualityResult> = {};
    for (const s of groupSamples) {
      const m = meta[s.id];
      if (!m) continue;
      const req = { sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters };
      const raw = (ch: string) => client.dimensionValues(req, { kind: 'channel', channel: ch, transform: { kind: 'none' } });
      const params = [];
      for (const n of qualityParameters(m.channels.map((c) => c.name))) {
        const c = m.channels.find((x) => x.name === n)!;
        const t = makeTransform(ws.channelTransforms[n] ?? defaultTransform(c, m.keywords));
        const nb = qualityChannels(m.keywords['$DATATYPE'], c.range);
        params.push({ name: n, values: await raw(n), channels: nb, toChannel: (v: number) => ((t.apply(v) - t.displayMin) / (t.displayMax - t.displayMin)) * nb });
      }
      const tc = m.channels.find((c) => /^time$/i.test(c.name));
      out[s.id] = checkSampleQuality({ events: params[0]?.values.length ?? m.eventCount, params, time: tc ? await raw(tc.name) : undefined, sampleTime: elapsedSeconds(m.keywords['$BTIM'], m.keywords['$ETIM']) });
    }
    setQuality((q) => ({ ...q, ...out }));
    note('info', `Sample quality checked for ${Object.keys(out).length} sample(s)`);
  };
  const deriveParm = (ch: string, log: boolean) => {
    const top = channelRange(channels.find((c) => c.name === ch)!);
    const d = derivedFor(ch, log, channels.map((c) => c.name));
    updateWs((w) => { w.derivedParameters = [...(w.derivedParameters ?? []), d]; w.channelTransforms[d.name] = { kind: 'linear', T: log ? Math.max(1, Math.ceil(Math.log10(top))) : top, A: 0 }; });
    note('info', `Derived parameter ${d.name} = ${d.formula}`);
  };
  const transformMenu = (ch: string, x: number, y: number) => {
    const spec = specOf(ch);
    const c = channels.find((q) => q.name === ch);
    if (!spec || !c) return;
    const t = makeTransform(spec);
    const lo = t.inverse(t.displayMin), hi = t.inverse(t.displayMax);
    const top = channelRange(c);
    const like = likeParameters(channels.map((q) => q.name), ch, fluor, isTime);
    const items: MenuItem[] = [
      { label: `${spec.kind === 'linear' ? '* ' : ''}Linear Axis`, testId: 'tm-linear', onClick: () => setSpecs({ [ch]: linLogSpec(false, lo, hi) }) },
      { label: `${spec.kind === 'log' ? '* ' : ''}Log Axis`, testId: 'tm-log', onClick: () => setSpecs({ [ch]: linLogSpec(true, lo, hi) }) },
      { label: 'Transform Off', testId: 'tm-off', onClick: () => setSpecs({ [ch]: { kind: 'linear', T: top, A: 0 } }) },
      null,
      { label: 'Reset', testId: 'tm-reset', onClick: () => setSpecs({ [ch]: null }) },
      { label: 'Customize Axis...', testId: 'tm-custom', onClick: () => setDialog({ kind: 'transform', channel: ch }) },
      { label: 'Change Displayed Parameter Range...', testId: 'tm-range', onClick: () => setRangeDlg({ channel: ch, min: lo, max: hi }) },
      { label: 'Calculate Width Basis', testId: 'tm-autowidth', disabled: spec.kind !== 'flowjo-biex' && spec.kind !== 'logicle' && spec.kind !== 'asinh', onClick: () => void run(() => calcWidth(ch)) },
      null,
      { label: 'Apply To All Compensated Parameters', testId: 'tm-applycomp', onClick: () => { setSpecs(Object.fromEntries(like.filter((n) => n !== ch).map((n) => [n, { ...spec }]))); note('info', `Scale of ${ch} applied to ${like.length - 1} parameter(s)`); } },
      { label: 'Remove Transforms', testId: 'tm-remove', onClick: () => setSpecs(Object.fromEntries(like.map((n) => [n, null]))) },
      null,
      { label: 'Derive Linear Parameter', testId: 'tm-derive-lin', onClick: () => deriveParm(ch, false) },
      { label: 'Derive Log Parameter', testId: 'tm-derive-log', onClick: () => deriveParm(ch, true) },
    ];
    setCtx({ x, y, items });
  };
  const applyRange = (ch: string, min: number, max: number): string | null => {
    const spec = specOf(ch);
    if (!spec || !Number.isFinite(min) || !Number.isFinite(max)) return 'Enter numbers';
    const next = specWithRange(spec, min, max);
    if (!next) return `This scale cannot show ${min} to ${max}`;
    setSpecs({ [ch]: next });
    return null;
  };
  // Print (GWPrintAction): the plot image in the browser's print dialog (own).
  const printPlot = () => {
    const url = canvasRef.current?.toDataURL('image/png');
    const w = url && window.open('', '_blank');
    if (!w) return note('warn', 'Allow pop-ups to print the graph');
    w.document.write(`<!doctype html><title>${popPath || sample?.fileName || 'Graph'}</title><img src="${url}" style="max-width:100%" onload="window.print()">`);
    w.document.close();
  };
  // Make Movie (MovieAction, own form): the graph of each sample of the group
  // at this population, one per second, recorded as a WebM video.
  const makeMovie = async () => {
    const cv = canvasRef.current;
    if (!cv || !sample || typeof MediaRecorder === 'undefined' || !cv.captureStream) return note('warn', 'This browser cannot record a video of the canvas');
    const list = groupSamples.filter((s) => meta[s.id]);
    const stream = cv.captureStream(5);
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '' });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    const start = sample.id;
    rec.start();
    for (const s of list) {
      const same = popPath ? s.populations.find((p) => populationPath(s.populations, p.id) === popPath) : null;
      if (popPath && !same) continue;
      setSel({ sampleId: s.id, popId: same?.id ?? null });
      await new Promise((r) => setTimeout(r, 1000));
    }
    rec.stop();
    await done;
    setSel({ sampleId: start, popId: sel.popId });
    download(`${(popPath || 'all').replace(/[^\w.-]+/g, '_')}_movie.webm`, new Blob(parts, { type: 'video/webm' }), 'video/webm');
    note('info', `Movie of ${list.length} sample(s) saved`);
  };
  // First / Last Sample (own: GWCommand.FIRSTSIBLING / LASTSIBLING have no
  // action in 10.6.2): the first / last sample of the group with this population.
  const edgeSample = (last: boolean) => {
    if (!sample) return null;
    const list = groupSamples.length ? groupSamples : ws.samples;
    const order = last ? [...list].reverse() : list;
    for (const t of order) {
      if (t === sample) return null;
      if (!popPath) return { s: t, popId: null };
      const same = t.populations.find((p) => populationPath(t.populations, p.id) === popPath);
      if (same) return { s: t, popId: same.id };
    }
    return null;
  };
  const jumpSample = (last: boolean) => { const h = edgeSample(last); if (h) { setSel({ sampleId: h.s.id, popId: h.popId }); setMulti([]); } };
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
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(POP_TYPE) || e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(MATRIX_DRAG_TYPE);
  const onDropOn = (target: { sampleId?: string; popId?: string | null; groupId?: string }) => (e: React.DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // The compensation editor's Matrix Icon applies its matrix to the sample
    // or group it is dropped on (plat.comp.apply.drag).
    const matrixId = e.dataTransfer.getData(MATRIX_DRAG_TYPE);
    if (matrixId) {
      const ids = target.groupId ? ws.groups.find((g) => g.id === target.groupId)?.sampleIds ?? [] : [target.sampleId ?? sample?.id ?? ''];
      updateWs((w) => { for (const s of w.samples) if (ids.includes(s.id)) s.compensation = matrixId; });
      return note('info', `Compensation set to ${matrixId} for ${ids.length} sample(s)`);
    }
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
      ...(pop ? [{ label: `${pop.tinted ? '* ' : ''}Tint`, testId: 'ctx-Tint', onClick: () => setGateLook(pop.id, { tinted: !pop.tinted }) }] as MenuItem[] : []),
      { label: 'Add Statistic', onClick: () => addStatFor(pop ? populationPath(sample.populations, pop.id) : popPath) },
      { label: 'Copy Image', onClick: () => copyPlotImage(true) },
      { label: 'Copy Image Without Transparency', onClick: () => copyPlotImage(false) },
      { label: 'Copy Histogram Function', disabled: kind !== 'histogram', onClick: copyHistogram },
      { label: 'Copy Statistics', onClick: copyStatistics },
      { label: 'Copy to Layout Editor', onClick: () => document.querySelector<HTMLButtonElement>('[data-testid=add-to-layout]')?.click() },
      // GatePanel popup: Smooth when the type can smooth, Adjust color table with
      // the preference, Create Cluster Gates on a "cluster" axis, Create Gates On
      // Peaks on histograms.
      ...(kind !== 'dot' && kind !== 'contour' ? [{ label: `${smoothing > 0 ? '* ' : ''}Smooth`, testId: 'ctx-Smooth', onClick: () => setPlotSettings({ smoothing: smoothing > 0 ? 0 : 13 }) }] : []),
      ...(prefs.adjustColor && (smoothing > 0 || kind === 'contour') ? [{ label: 'Adjust color table', onClick: () => setColorTableOpen(true) }] : []),
      ...(xAxis?.channel === 'cluster' || yAxis?.channel === 'cluster' ? [{ label: 'Create Cluster Gates', onClick: clusterGates }] : []),
      ...(kind === 'histogram' ? [{ label: 'Create Gates On Peaks', onClick: () => void run(gatesOnPeaks) }] : []),
      null,
      { label: 'Print...', onClick: printPlot },
      { label: 'Make Movie...', disabled: groupSamples.length < 2, onClick: () => void makeMovie() },
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
    // The plot may be in a separate graph window, so look at the key's own target too.
    const inPlot = (e.target as HTMLElement | null)?.dataset?.testid === 'plot-canvas' || (document.activeElement as HTMLElement | null)?.dataset?.testid === 'plot-canvas';
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
      if ((e.key === ']' || e.key === '[') && kind === 'pseudocolor') { setPlotSettings({ colorBy: plotSettings.colorBy ? step(plotSettings.colorBy, e.key === ']' ? 1 : -1) : names[0] }); return true; } // Next / Previous Color (no wrap)
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
    if (k === 'a' && !e.shiftKey) { selectAllNodes(); return true; } // Select All (ws.select.allnodes)
    if (k === 'x' && e.shiftKey) { setDialog({ kind: 'export', mode: 'group' }); return true; } // Export / Concatenate Group (ws.dlog.export.group)
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
  // Add Statistic dialog targets: the selected populations' paths (table selection, else the selection).
  const statTargets = (): string[] => {
    const fromRows = rowSel.map((k) => k.split('|')).map(([sid, pid]) => { const s = ws.samples.find((x) => x.id === sid); return s ? (pid ? populationPath(s.populations, pid) : '') : null; }).filter((x): x is string => x !== null);
    const fromMulti = sample ? multi.map((id) => populationPath(sample.populations, id)) : [];
    const all = [...new Set([...fromRows, ...fromMulti])];
    return all.length ? all : [popPath];
  };
  const addStats = (choices: import('./WorkspaceTools').StatChoice[]) => {
    const targets = statTargets();
    let n = 0;
    updateWs((w) => {
      for (const path of targets) for (const c of choices) {
        if (w.statColumns.some((x) => x.populationPath === path && x.stat === c.stat && x.channel === c.channel && (c.stat !== 'percentile' || x.percentile === c.percentile))) continue;
        w.statColumns.push({ id: newId('col'), populationPath: path, stat: c.stat, channel: c.channel, percentile: c.percentile ?? 50 });
        n++;
      }
    });
    setDialog(null);
    note('info', `Added ${n} statistic(s)`);
  };
  // Keywords for the current group (Add Keyword to Group, Paste keyword to
  // group, Create keyword value series; docs/validation/ui-gaps/workspace.md, K).
  const tableKeywords = tableColumns(ws).filter((c) => isKeywordColumn(c.key)).map((c) => c.key.slice(3));
  const pasteKeywordToGroup = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return note('warn', 'The browser did not allow reading the clipboard; paste with Ctrl/Cmd+V in the table instead'); }
    const ordered = sortSamples(ws, groupSamples);
    const start = Math.max(0, ordered.findIndex((s) => s.id === sel.sampleId));
    let n = 0;
    updateWs((w) => { n = pasteAnnotations(ordered.map((s) => w.samples.find((x) => x.id === s.id)!), start, text, tableKeywords.length ? tableKeywords : annotationKeys, ordered.map((s) => s.id)); });
    note(n ? 'info' : 'warn', n ? `Pasted keyword values into ${n} sample(s) of group ${group?.name}` : 'Nothing pasted: copy keyword values (one value, or rows) first');
  };
  const applySeries = (spec: import('./WorkspaceTools').SeriesSpec) => {
    const name = keywordName(spec.keyword);
    if (!name) return;
    const ordered = sortSamples(ws, groupSamples);
    const start = Math.max(0, ordered.findIndex((s) => s.id === sel.sampleId));
    const targets = ordered.slice(start, start + spec.values.length);
    updateWs((w) => {
      setKeyword(targets.map((s) => w.samples.find((x) => x.id === s.id)!), name, spec.values);
      if (!tableColumns(w).some((c) => c.key === `kw:${name}`)) w.tableColumns = [...tableColumns(w), { key: `kw:${name}` }];
    });
    setDialog(null);
    note('info', `${name}: ${spec.values.slice(0, targets.length).join(', ')} in ${targets.length} sample(s)`);
  };
  // Search for FCS files (own rule for SampleFindingThread): a folder chosen in
  // the browser; every .fcs / .lmd file under it is added.
  const addFolder = (files: FileList) => {
    const fcs = Array.from(files).filter((f) => /\.(fcs|lmd)$/i.test(f.name));
    note('info', `Found ${fcs.length} FCS file(s) in ${files.length} file(s)`);
    if (fcs.length) void addFiles(fcs);
  };
  // Export / Concatenate Populations (several) and Group: (sample, population) pairs.
  const exportTargets = (mode: 'populations' | 'group'): { sid: string; popId: string | null }[] => {
    if (mode === 'group') return groupSamples.filter((s) => meta[s.id]).map((s) => ({ sid: s.id, popId: popPath ? s.populations.find((p) => populationPath(s.populations, p.id) === popPath)?.id ?? 'missing' : null })).filter((t) => t.popId !== 'missing');
    const keys = selectedRowKeys();
    const out = keys.map((k) => k.split('|')).filter(([sid, pid]) => meta[sid] && (pid === '' || ws.samples.find((s) => s.id === sid)?.populations.some((p) => p.id === pid))).map(([sid, pid]) => ({ sid, popId: pid || null }));
    if (sample && multi.length) for (const id of multi) if (!out.some((t) => t.sid === sample.id && t.popId === id)) out.push({ sid: sample.id, popId: id });
    return out;
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
      { label: 'Add Statistic...', onClick: () => setDialog({ kind: 'addStat' }) },
      null,
      { label: 'Inspect...', onClick: () => setDialog({ kind: 'keywords' }) },
      { label: 'Edit Boolean Gate...', disabled: pop?.gate.type !== 'boolean', onClick: () => setDialog({ kind: 'boolExpr', editId: popId }) },
      { label: 'Identical Gate', onClick: () => updateWs((w) => { const sw = w.samples.find((x) => x.id === s.id)!; sw.populations.push(...makeIdentities(sw, [popId])); }) },
      null,
      { label: 'Remove Group Analysis', disabled: !pop?.owningGroup, onClick: () => void deletePop(popId) },
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
  // statistic nodes; Statistic = frequency of parent, #Cells = count. Columns
  // from Edit Columns, samples sorted by the sort keys, and the view toggles
  // Hide Stats / Show Compensation Nodes / Hide Platforms / Hide Derived
  // Parameters (PopTreeTableModel.shouldShowNode; docs/validation/ui-gaps/workspace.md, T).
  type TRow = TableRow & { key: string; kind: 'sample' | 'pop' | 'stat' | 'comp' | 'dp' | 'platform'; label?: string; kids?: boolean; open?: boolean };
  const tableModel = (): TRow[] => {
    const cols = tableColumns(ws);
    const rows: TRow[] = [];
    for (const s of sortSamples(ws, groupSamples)) {
      const open = !collapsedSamples.includes(s.id);
      const res = analysis[s.id]?.results ?? [];
      const sampleCells = cols.map((c) => c.key === NAME ? s.fileName : c.key === STATISTIC ? '' : c.key === NCELLS ? (meta[s.id] ? s.eventCount.toLocaleString() : '') : sampleCell(ws, s, c.key) ?? '');
      rows.push({ key: `${s.id}|`, kind: 'sample', depth: 1, sample: s, popId: null, cells: sampleCells, kids: s.populations.length > 0, open });
      if (!open) continue;
      if (viewOpts.comp && s.compensation !== 'none') rows.push({ key: `${s.id}|comp`, kind: 'comp', depth: 2, sample: s, popId: null, statLabel: `Compensation: ${sampleCell(ws, s, 'fj.appnode.prop.matrix')}`, cells: cols.map(() => '') });
      if (viewOpts.dp) for (const d of ws.derivedParameters ?? []) rows.push({ key: `${s.id}|dp:${d.name}`, kind: 'dp', depth: 2, sample: s, popId: null, statLabel: `Derived: ${d.name}`, cells: cols.map(() => '') });
      const walk = (parentId: string | null, depth: number) => {
        for (const p of s.populations.filter((q) => q.parentId === parentId)) {
          const r = res.find((x) => x?.id === p.id);
          const path = populationPath(s.populations, p.id);
          const statCols = viewOpts.stats ? ws.statColumns.map((c, i) => [c, i] as const).filter(([c]) => c.populationPath === path) : [];
          const platform = viewOpts.platforms && ws.kinetics?.[path];
          const kids = s.populations.some((q) => q.parentId === p.id) || statCols.length > 0 || !!platform;
          const cells = cols.map((c) => c.key === NAME ? p.name : c.key === STATISTIC ? (r && r.parentCount > 0 ? formatFreq((100 * r.count) / r.parentCount) : '') : c.key === NCELLS ? (r?.error ? 'error' : r ? r.count.toLocaleString() : '') : populationCell(ws, s, p.id, c.key) ?? '');
          rows.push({ key: `${s.id}|${p.id}`, kind: 'pop', depth, sample: s, popId: p.id, cells, kids, open: !p.collapsed });
          if (p.collapsed) continue;
          if (platform) rows.push({ key: `${s.id}|${p.id}|kin`, kind: 'platform', depth: depth + 1, sample: s, popId: p.id, statLabel: 'Kinetics', cells: cols.map(() => '') });
          for (const [c, i] of statCols) {
            const label = colLabel(c).replace(`${path}: `, '');
            rows.push({ key: `${s.id}|${p.id}#${c.id}`, kind: 'stat', depth: depth + 1, sample: s, popId: p.id, statLabel: label, label: `${s.fileName}/${path}#${colLabel(c)}`, cells: cols.map((k) => k.key === NAME ? label : k.key === STATISTIC ? (meta[s.id] ? fmtStat(stats[s.id]?.[i] ?? '') : '') : '') });
          }
          walk(p.id, depth + 1);
        }
      };
      walk(null, 2);
    }
    return rows;
  };
  const rowKey = (sid: string, popId: string | null) => `${sid}|${popId ?? ''}`;
  const sampleTableRows = (): React.ReactNode[] => {
    const cols = tableColumns(ws);
    return tableModel().map((row) => {
      const s = row.sample;
      const isSel = sel.sampleId === s.id;
      if (row.kind !== 'sample' && row.kind !== 'pop') {
        return (
          <tr key={row.key} className={`fj-row ${row.kind}`} data-testid={row.kind === 'stat' ? `row-${row.label}` : `row-${s.fileName}/${row.statLabel}`}>
            <td style={{ paddingLeft: 22 + row.depth * 16 - 16 }}>{row.statLabel}</td>
            {cols.slice(1).map((c, i) => <td key={c.key} className="num">{row.kind === 'stat' ? row.cells[i + 1] : ''}</td>)}
          </tr>
        );
      }
      const p = row.popId ? s.populations.find((q) => q.id === row.popId) : undefined;
      const path = p ? populationPath(s.populations, p.id) : '';
      const selected = isSel && (sel.popId ?? null) === (row.popId ?? null);
      const marked = rowSel.includes(row.key) || (isSel && !!row.popId && multi.includes(row.popId));
      return (
        <tr key={row.key} className={`fj-row ${row.kind === 'sample' ? 'sample' : ''} ${selected ? 'sel' : ''} ${marked && !selected ? 'multi' : ''}`} data-testid={row.kind === 'sample' ? `row-${s.fileName}` : `row-${s.fileName}/${path}`}
          onClick={(e) => selectInTable(s.id, row.popId, e)} onDoubleClick={() => openWin(s.id, row.popId)}
          onContextMenu={(e) => { e.preventDefault(); popMenu(s, row.popId, e.clientX, e.clientY); }}
          onDragOver={(e) => accepts(e) && e.preventDefault()} onDrop={onDropOn({ sampleId: s.id, popId: row.popId })}>
          {cols.map((c, ci) => {
            if (c.key === NAME) return (
              <td key={c.key} style={{ paddingLeft: row.kind === 'sample' ? undefined : 6 + (row.depth - 1) * 16 }}>
                <span className="twisty" onClick={(e) => { e.stopPropagation(); if (!row.kids) return; if (row.kind === 'sample') setCollapsedSamples((cs) => (cs.includes(s.id) ? cs.filter((x) => x !== s.id) : [...cs, s.id])); else setCollapsed([p!.id], !p!.collapsed, s.id); }}>{row.kids ? (row.open ? '-' : '+') : ''}</span>
                {row.kind === 'sample' && quality[s.id] && <span className="qc-dot" role="button" data-testid={`quality-${s.fileName}`} data-status={quality[s.id].status} title={`Sample quality: ${QUALITY_LOOK[quality[s.id].status].label}`} onClick={(e) => { e.stopPropagation(); setQualityReport(s.id); }} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', marginRight: 4, border: '1px solid #555', background: QUALITY_LOOK[quality[s.id].status].color, cursor: 'pointer' }} />}
                {row.kind === 'sample' ? (meta[s.id] ? s.fileName : <i className="missing">{s.fileName} (data missing)</i>)
                  : renaming === p!.id && isSel ? <input autoFocus defaultValue={p!.name} aria-label="Population name" onBlur={(e) => { renamePop(p!.id, e.target.value.trim()); setRenaming(null); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  : <span onDoubleClick={(e) => { if (isSel && sel.popId === p!.id && e.altKey) { e.stopPropagation(); setRenaming(p!.id); } }}>{p!.gate.type === 'boolean' ? `[${p!.gate.op}] ` : ''}{p!.exclude ? '[excl] ' : ''}{p!.name}{p!.owningGroup ? ' (G)' : ''}</span>}
              </td>
            );
            const kw = isKeywordColumn(c.key) ? c.key.slice(3) : null;
            if (kw && row.kind === 'sample') {
              const editing = editCell?.sid === s.id && editCell.key === c.key;
              return (
                <td key={c.key} data-testid={`cell-${s.fileName}-${kw}`} title={keywordEditable(kw) ? 'Double-click to edit; right-click: Copy value to group' : undefined}
                  onDoubleClick={(e) => { if (!keywordEditable(kw)) return; e.stopPropagation(); setEditCell({ sid: s.id, key: c.key }); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); keywordMenu(s.id, kw, e.clientX, e.clientY); }}>
                  {editing ? <input autoFocus defaultValue={row.cells[ci]} aria-label={`${kw} value`} data-testid="cell-editor"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditCell(null); }}
                    onBlur={(e) => { const v = e.target.value; setEditCell(null); if (v !== row.cells[ci]) updateWs((w) => { setKeyword([w.samples.find((x) => x.id === s.id)!], kw, v); }); }} /> : row.cells[ci]}
                </td>
              );
            }
            return <td key={c.key} className={c.key === STATISTIC || c.key === NCELLS ? 'num' : undefined}>{row.cells[ci]}</td>;
          })}
        </tr>
      );
    });
  };
  // Keyword cell menu: Copy value to group (WSGroupAction COPYTOGROUP while a
  // keyword cell is edited: Group.setKeyValue for every member).
  const keywordMenu = (sid: string, kw: string, x: number, y: number) => {
    const s = ws.samples.find((q) => q.id === sid);
    const v = s ? sampleValue(s, kw) ?? '' : '';
    setCtx({ x, y, items: [
      { label: 'Edit value', disabled: !keywordEditable(kw), onClick: () => setEditCell({ sid, key: `kw:${kw}` }) },
      { label: `Copy value to group ("${v}" to ${groupSamples.length} samples)`, disabled: !keywordEditable(kw), onClick: () => { updateWs((w) => { setKeyword(w.samples.filter((q) => groupSamples.some((g) => g.id === q.id)), kw, v); }); note('info', `${kw} = "${v}" in every sample of group ${group?.name}`); } },
    ] });
  };
  // Header: double-click sorts (again: reverse; Shift: descending), a
  // double-click on the right edge resets the widths, right-click opens Sort
  // Ascending / Sort Descending / Remove Column / Edit Columns
  // (STreeMgr.handleColumnHeadClick, WSActionManager.getTableHeaderActions).
  const sortBy = (key: string, ascending: boolean) => {
    if (key === STATISTIC) return note('warn', 'The Statistic column cannot be sorted');
    updateWs((w) => { w.tableSort = [{ key, ascending }, ...(w.tableSort ?? []).filter((k) => k.key !== key)].slice(0, 3); });
  };
  const headerMenu = (key: string, x: number, y: number) => setCtx({ x, y, items: [
    { label: 'Sort Ascending', disabled: key === STATISTIC, onClick: () => sortBy(key, true) },
    { label: 'Sort Descending', disabled: key === STATISTIC, onClick: () => sortBy(key, false) },
    null,
    { label: 'Remove Column', disabled: key === NAME, onClick: () => updateWs((w) => { w.tableColumns = tableColumns(w).filter((c) => c.key !== key); w.tableSort = w.tableSort?.filter((k) => k.key !== key); }) },
    { label: 'Edit Columns...', onClick: () => setDialog({ kind: 'columns' }) },
  ] });
  const resetWidths = () => updateWs((w) => { w.tableColumns = tableColumns(w).map((c) => ({ key: c.key })); });
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement!;
    const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => { th.style.width = `${Math.max(40, w0 + ev.clientX - x0)}px`; };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      const width = Math.round(Math.max(40, w0 + ev.clientX - x0));
      if (Math.abs(ev.clientX - x0) > 2) updateWs((w) => { w.tableColumns = tableColumns(w).map((c) => (c.key === key ? { ...c, width } : c)); });
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const tableHead = () => (
    <thead><tr>{tableColumns(ws).map((c) => {
      const sk = ws.tableSort?.[0]?.key === c.key ? ws.tableSort[0] : undefined;
      return (
        <th key={c.key} style={c.width ? { width: c.width } : undefined} data-testid={`col-${columnLabel(c.key)}`}
          onDoubleClick={(e) => sortBy(c.key, sk ? !sk.ascending : !e.shiftKey)}
          onContextMenu={(e) => { e.preventDefault(); headerMenu(c.key, e.clientX, e.clientY); }} title="Double-click to sort; right-click for column commands">
          {columnLabel(c.key)}{sk ? (sk.ascending ? ' ▲' : ' ▼') : ''}
          <span className="col-resize" onMouseDown={(e) => startResize(c.key, e)} onDoubleClick={(e) => { e.stopPropagation(); resetWidths(); }} />
        </th>
      );
    })}</tr></thead>
  );
  // Expand / Collapse Selection (WSTreeTableAction TREEEXPANDLEVEL /
  // TREECOLLAPSELEVEL -> STreeTable.collapseLevel): every selected row and its subtree.
  const selectedRowKeys = () => (rowSel.length ? rowSel : sel.sampleId ? [rowKey(sel.sampleId, sel.popId)] : []);
  const expandSelection = (collapse: boolean) => {
    const keys = selectedRowKeys();
    const sampleRows = keys.filter((k) => k.endsWith('|')).map((k) => k.slice(0, -1));
    if (sampleRows.length) setCollapsedSamples((cs) => (collapse ? [...new Set([...cs, ...sampleRows])] : cs.filter((x) => !sampleRows.includes(x))));
    updateWs((w) => {
      for (const k of keys) {
        const [sid, pid] = k.split('|');
        const sw = w.samples.find((x) => x.id === sid);
        if (!sw) continue;
        const roots = pid ? [pid] : sw.populations.filter((p) => p.parentId === null).map((p) => p.id);
        for (const id of subtreeIds(sw.populations, roots)) { const p = sw.populations.find((q) => q.id === id)!; if (collapse) p.collapsed = true; else delete p.collapsed; }
      }
    });
  };
  // Select All (Ctrl/Cmd+A, NodeSelectionAction SELECTALLNODES -> selectAll):
  // every row of the table; the samples are also checked (cross-sample selection).
  const selectAllNodes = () => {
    const rows = tableModel().filter((r) => r.kind === 'sample' || r.kind === 'pop');
    setRowSel(rows.map((r) => r.key));
    setChecked(groupSamples.map((s) => s.id));
    if (sample) setMulti(sample.populations.map((p) => p.id));
    note('info', `Selected ${rows.length} node(s)`);
  };
  // Export to Excel (SampleTreeTable.writeExcel): the visible table with a Depth column.
  const exportExcel = () => {
    const cols = tableColumns(ws);
    const rows = excelRows(cols.map((c) => columnLabel(c.key)), tableModel());
    download(`${(ws.name || 'workspace').replace(/\.(wsp|json|wspt)$/i, '')}.xlsx`, xlsxBytes(ws.name || 'Workspace', rows) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    note('info', `Exported ${rows.length - 1} table row(s) to Excel`);
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
                <button disabled={boolTargets().length < 2 || boolTargets().length > MAX_COMBINATION} onClick={makeCombo} data-testid="bool-combo" title="Create Combination Gates: mix the positive and negative gates of all selected populations (2 to 12)">Combination</button>
                <button disabled={!boolTargets().length} onClick={makeIdentity} data-testid="bool-identity" title="Identical Gate: a reference to each selected gate, to place elsewhere in the tree">Identical</button>
                <button onClick={() => setDialog({ kind: 'boolExpr' })} data-testid="bool-expr-open" title="Boolean Expression... (mixed and / or / not; own rule)">Expression...</button>
                <button disabled={sample.populations.find((p) => p.id === sel.popId)?.gate.type !== 'boolean'} onClick={() => setDialog({ kind: 'boolExpr', editId: sel.popId! })} data-testid="bool-edit" title="Edit the selected boolean gate's expression">Edit boolean...</button>
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
                <button disabled={!edgeSample(false)} onClick={() => jumpSample(false)} title="First Sample: the first sample of the group with this population" data-testid="first-sample">|&lt;</button>
                <button disabled={!neighbour(-1)} onClick={() => navSample(-1)} title="Previous Sample (PageUp, or Ctrl/Cmd+PageDown): view the previous population at this level" data-testid="prev-sample">&lt;</button>
                <button disabled={!neighbour(1)} onClick={() => navSample(1)} title="Next Sample (PageDown, or Ctrl/Cmd+PageUp): view the next population at this level" data-testid="next-sample">&gt;</button>
                <button disabled={!edgeSample(true)} onClick={() => jumpSample(true)} title="Last Sample: the last sample of the group with this population" data-testid="last-sample">&gt;|</button>
                <span className="muted">Gating Path:</span>
                <a href="#" onClick={(e) => { e.preventDefault(); setSel({ sampleId: sample.id, popId: null }); }} data-testid="crumb-root">{sample.fileName}</a>
                {gatingPath.map((q) => (
                  <span key={q.id}> &gt; <a href="#" onClick={(e) => { e.preventDefault(); setSel({ sampleId: sample.id, popId: q.id }); }} data-testid={`crumb-${q.name}`}>{q.name}</a></span>
                ))}
                {!gatingPath.length && <span className="muted"> (Ungated)</span>}
              </div>
              <div className="row plot-controls">
                <select value={kind} onChange={(e) => setPlotSettings({ kind: e.target.value as PlotKind, smoothing: undefined })} data-testid="plot-kind" title="Changing the type resets smoothing to the type's default (GraphSpec.changeDisplayType)">
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
                <button onClick={(e) => transformMenu(plotSettings.x, e.clientX, e.clientY)} title="Transform menu of the X axis" data-testid="x-transform">T</button>
                {kind !== 'histogram' && (
                  <>
                    Y <select value={plotSettings.y ?? ''} onChange={(e) => setPlotSettings({ y: e.target.value })} data-testid="y-channel">
                      {channels.map((c) => <option key={c.name} value={c.name}>{c.label ? `${c.name} :: ${c.label}` : c.name}</option>)}
                    </select>
                    <button onClick={() => setDialog({ kind: 'transform', channel: plotSettings.y ?? '' })} title="Axis scale" data-testid="y-scale">scale</button>
                    <button onClick={(e) => plotSettings.y && transformMenu(plotSettings.y, e.clientX, e.clientY)} title="Transform menu of the Y axis" data-testid="y-transform">T</button>
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
                <label title="Adds the raw twin of each compensated parameter to the axis lists (workspace-wide)"><input type="checkbox" checked={!!ws.showUncompensated} onChange={(e) => updateWs((w) => { if (e.target.checked) w.showUncompensated = true; else delete w.showUncompensated; })} data-testid="display-uncomp" /> Show Uncompensated Parameters</label>
                <label title="Adds an Event # parameter to the axis lists (workspace-wide)"><input type="checkbox" checked={!!ws.showEventNumber} onChange={(e) => updateWs((w) => { if (e.target.checked) w.showEventNumber = true; else delete w.showEventNumber; })} data-testid="display-event-number" /> Show Event # Parameter</label>
                <label title="Colour the pseudocolor plot by the mean of a third parameter (Ctrl/Cmd+] / [ step it)">Color axis <select disabled={kind !== 'pseudocolor'} value={plotSettings.colorBy ?? ''} onChange={(e) => setPlotSettings({ colorBy: e.target.value || undefined })} data-testid="display-color">
                  <option value="">off</option>
                  {channels.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select></label>
                {colorAxis && plotData?.colorMean && <span className="color-legend" data-testid="color-legend" title={`${colorAxis.channel}: low (blue) to high (red)`}><span className="ramp" /> {colorAxis.channel}</span>}
                <GraphOptionsPanel settings={plotSettings} set={setPlotSettings} prefs={prefs} setPrefs={setPrefs} gate={sample.populations.find((q) => q.id === gateSel) ?? null} onGate={(patch) => gateSel && setGateLook(gateSel, patch)} onAdjustColor={() => setColorTableOpen(true)} />
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
                showOutliers={showOutliers}
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
                {plotData && (kind === 'dot' || showOutliers) && plotData.points.length / 2 < plotData.count && ` (dot plot draws ${(plotData.points.length / 2).toLocaleString()} sampled events)`}
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

  // Experiment platforms (ui-gaps/platforms.md): Plate Editor, Compare Populations, 3D Viewer, Calibration, FCS Scan.
  const platformButtons = (<>{([['plate', 'Plate Editor', false], ['compare', 'Compare Populations...', true], ['threeD', '3D Viewer', true], ['calibration', 'Create Calibration Parameter...', true], ['fcsScan', 'FCS Scan', false]] as const).map(([t, l, needs]) => <button key={t} disabled={needs && !sMeta} onClick={() => setDialog({ kind: 'tool', tool: t })} data-testid={`open-${t}`}>{l}</button>)}</>);
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
          <button onClick={() => setDialog({ kind: 'scripts' })} data-testid="open-scripts" title="Edit and manage FlowJo Scripts and query this workspace with the FlowJo Scripting Console">Scripts</button>
        </span>
        <span className="band" aria-label="Document"><span className="band-label">Document</span>
          <label className="file-btn">Open workspace / FlowJo .wsp<input type="file" accept=".json,.wsp,.frea,.wspt,.zip,.acs" data-testid="open-ws" onChange={(e) => { const f = e.target.files?.[0]; if (f) openWorkspace(f); e.target.value = ''; }} /></label>
          <button data-testid="save-ws" title="Save (Ctrl/Cmd+S)" onClick={() => { setSavedOnce(true); baselineRef.current = ws; download(`${ws.name.replace(/\.(wsp|json)$/i, '') || 'workspace'}.frea.json`, serializeWorkspace(ws), 'application/json'); }}>Save workspace</button>
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
          {platformButtons}
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
        <button onClick={() => setDialog({ kind: 'scripts' })} data-testid="open-scripts" title="Edit and manage FlowJo Scripts and query this workspace with the FlowJo Scripting Console">Script Editor</button>
        <button onClick={() => wsRib.openConfig(ribbonTab)} data-testid="ribbon-config" title="Open the ribbon customization dialog">Customize Ribbon</button>
        <span className="sep" />
        <span className="status" data-testid="busy">{busy > 0 ? 'Working...' : 'Ready'}</span>
      </header>
      {wsRib.dialog}
      {qualityReport && quality[qualityReport] && <QualityReport name={ws.samples.find((x) => x.id === qualityReport)?.fileName ?? ''} result={quality[qualityReport]} onClose={() => setQualityReport(null)} />}
      <nav className="fj-ribbon" aria-label="Ribbon">
        <div className="fj-tabs" role="tablist">
          {['FlowJo', 'File', 'Edit', 'Workspace', 'Tools', 'Configure'].map((t) => <button key={t} role="tab" aria-selected={ribbonTab === t} className={ribbonTab === t ? 'active' : ''} onClick={() => setRibbonTab(t)} data-testid={`ribbon-tab-${t}`}>{t}</button>)}
        </div>
        <div className="fj-bands" role="tabpanel" data-testid="ribbon-panel">
          <>
            {rb('navigate') && <div style={rs('navigate')} className="fj-band"><div className="fj-band-body">
              <button onClick={() => setDialog({ kind: 'platforms' })} disabled={!sMeta} data-testid="open-platforms">Biology (Cell Cycle, Proliferation)</button>
              <button onClick={() => setDialog({ kind: 'addKeyword' })} disabled={!ws.samples.length} data-testid="open-add-keyword">Add Keyword</button>
              <button data-testid="open-prefs" onClick={() => setDialog({ kind: 'prefs' })} title="Preferences (Ctrl/Cmd+Y)">Preferences</button>
            </div><div className="fj-band-title">Navigate / Experiment</div></div>}
          </>
          <>
            {rb('document') && <div style={rs('document')} className="fj-band"><div className="fj-band-body">
              <label className="file-btn">Open...<input type="file" accept=".json,.wsp,.frea,.wspt,.zip,.acs" data-testid="open-ws" onChange={(e) => { const f = e.target.files?.[0]; if (f) openWorkspace(f); e.target.value = ''; }} /></label>
              <button data-testid="save-ws" title="Save (Ctrl/Cmd+S)" onClick={() => { setSavedOnce(true); baselineRef.current = ws; download(`${ws.name.replace(/\.(wsp|json)$/i, '') || 'workspace'}.frea.json`, serializeWorkspace(ws), 'application/json'); }}>Save</button>
              <label className="file-btn">Import Gating-ML<input type="file" accept=".xml" data-testid="import-gml" onChange={(e) => { const f = e.target.files?.[0]; if (f) importGatingMl(f); e.target.value = ''; }} /></label>
              <button disabled={!sample} onClick={() => setDialog({ kind: 'export' })} data-testid="open-export">Export / Concatenate</button>
              <label className="file-btn" title="Search for FCS files: choose a folder; every FCS file under it is added">Search for FCS files...<input type="file" multiple {...{ webkitdirectory: '', directory: '' }} data-testid="add-folder" onChange={(e) => { if (e.target.files) addFolder(e.target.files); e.target.value = ''; }} /></label>
              <FormatFileButtons {...formatProps} />
              <button disabled={!ws.samples.length} onClick={exportExcel} data-testid="export-excel" title="Export to Excel: the workspace table as shown (.xlsx)">Export to Excel</button>
              <button onClick={exportTemplate} data-testid="export-template" title="Export as Template (WSPT): groups and their analysis, no samples">Export as Template</button>
              <button disabled={!ws.samples.length} onClick={() => void saveArchive()} data-testid="save-archive" title="Save as Archive: workspace and FCS files in one ZIP">Save as Archive</button>
              <button onClick={() => void revertWs()} data-testid="revert-ws" title="Revert workspace to original state">Revert</button>
              <button onClick={() => void closeWs()} data-testid="close-ws" title="Closes this current workspace">Close</button>
            </div><div className="fj-band-title">Document</div></div>}
            {rb('find') && <div style={rs('find')} className="fj-band"><div className="fj-band-body">
              <button disabled={!ws.samples.length} onClick={() => setDialog({ kind: 'find' })} data-testid="open-find">Find</button>
            </div><div className="fj-band-title">Find</div></div>}
          </>
          <>
            {rb('clipboard') && <div style={rs('clipboard')} className="fj-band"><div className="fj-band-body">
              <button disabled={!sample || !(multi.length || sel.popId)} onClick={copySel} data-testid="ribbon-copy">Copy</button>
              <button disabled={!sel.popId} onClick={cutSel} data-testid="ribbon-cut">Cut</button>
              <button disabled={!clip?.length || !sample} onClick={() => pasteTo(checked.length ? [...new Set([sample!.id, ...checked])] : [sample!.id])} data-testid="ribbon-paste">Paste</button>
            </div><div className="fj-band-title">Clipboard</div></div>}
            {rb('select') && <div style={rs('select')} className="fj-band"><div className="fj-band-body">
              <button disabled={!sample} onClick={selectEquivalent} data-testid="ribbon-select-equivalent">Select Equivalent Nodes</button>
              <button disabled={!groupSamples.length} onClick={selectAllNodes} data-testid="ribbon-select-all" title="Select All (Ctrl/Cmd+A): all nodes in the workspace">Select All</button>
            </div><div className="fj-band-title">Select</div></div>}
            {rb('expand') && <div style={rs('expand')} className="fj-band"><div className="fj-band-body">
              <button disabled={!ws.samples.length} onClick={() => { setCollapsed('all', false); setCollapsedSamples([]); }} data-testid="expand-all">Expand All</button>
              <button disabled={!ws.samples.length} onClick={() => { setCollapsed('all', true); setCollapsedSamples(groupSamples.map((x) => x.id)); }} data-testid="collapse-all">Collapse All</button>
              <button disabled={!sel.sampleId} onClick={() => expandSelection(false)} data-testid="expand-selection" title="Expand all selected tree nodes">Expand Selection</button>
              <button disabled={!sel.sampleId} onClick={() => expandSelection(true)} data-testid="collapse-selection" title="Collapse all selected tree nodes">Collapse Selection</button>
            </div><div className="fj-band-title">Expand</div></div>}
          </>
          <>
            {rb('populations') && <div style={rs('populations')} className="fj-band wide"><div className="fj-band-body column">{popActionsBlock ?? <span className="muted">Select a sample or population in the table.</span>}</div><div className="fj-band-title">Populations / Groups / Boolean</div></div>}
            {rb('derived') && <div style={rs('derived')} className="fj-band"><div className="fj-band-body column">
              <ClusterParamButtons {...formatProps} focused={selPopValid ? sel.popId : null} selected={multi} />
            </div><div className="fj-band-title">Derived Parameters</div></div>}
            {rb('statistics') && <div style={rs('statistics')} className="fj-band"><div className="fj-band-body column">
              <button disabled={!sample} onClick={() => setDialog({ kind: 'addStat' })} data-testid="open-add-stat" title="Add Statistic... (several statistics and parameters for the selected populations)">Add Statistic...</button>
              <button onClick={recalcStats} data-testid="recalc-stats" title="Recalculate Statistics: refresh all statistics in this workspace">Recalculate</button>
            </div><div className="fj-band-title">Statistics</div></div>}
            {rb('keywords') && <div style={rs('keywords')} className="fj-band"><div className="fj-band-body column">
              <button disabled={!groupSamples.length} onClick={() => setDialog({ kind: 'addKeywordGroup' })} data-testid="add-key-group" title="Add Keyword to Group: a new keyword for the samples of the current group">Add Keyword to Group</button>
              <button disabled={!groupSamples.length} onClick={() => void pasteKeywordToGroup()} data-testid="paste-key-group" title="Paste keyword to group: the clipboard's keyword value(s) into the current group">Paste keyword to group</button>
              <button disabled={!sel.sampleId} onClick={() => setDialog({ kind: 'series' })} data-testid="open-series" title="Create keyword value series...">Keyword value series...</button>
            </div><div className="fj-band-title">Keywords</div></div>}
            {rb('columns') && <div style={rs('columns')} className="fj-band"><div className="fj-band-body column">
              <button onClick={() => setDialog({ kind: 'columns' })} data-testid="edit-columns" title="Edit Columns...: the keyword columns shown in the workspace window">Edit Columns...</button>
              <button onClick={resetWidths} data-testid="reset-widths" title="Reset Column Widths">Reset Column Widths</button>
              {[0, 1, 2].map((i) => (
                <label key={i} title="Sort 1 / 2 / 3: samples sorted by these columns in turn">Sort {i + 1} <select value={ws.tableSort?.[i]?.key ?? ''} data-testid={`sort-${i + 1}`} disabled={i > (ws.tableSort?.length ?? 0)}
                  onChange={(e) => updateWs((w) => { const ks = [...(w.tableSort ?? [])]; if (e.target.value) ks[i] = { key: e.target.value, ascending: ks[i]?.ascending ?? true }; else ks.splice(i); w.tableSort = ks.filter(Boolean); })}>
                  <option value="">(none)</option>
                  {[NAME, ...groupKeys.map((k) => `kw:${k}`)].map((k) => <option key={k} value={k}>{columnLabel(k)}</option>)}
                </select>{ws.tableSort?.[i] && <button className="link" data-testid={`sort-dir-${i + 1}`} onClick={() => updateWs((w) => { w.tableSort![i].ascending = !w.tableSort![i].ascending; })}>{ws.tableSort[i].ascending ? 'asc' : 'desc'}</button>}</label>
              ))}
            </div><div className="fj-band-title">Columns / Sort</div></div>}
            {rb('view') && <div style={rs('view')} className="fj-band"><div className="fj-band-body column">
              <button onClick={() => setViewOpts((v) => ({ ...v, stats: !v.stats }))} data-testid="toggle-stats" title="Show/hide the display of statistics in the workspace">{viewOpts.stats ? 'Hide Stats' : 'Show Stats'}</button>
              <button onClick={() => setViewOpts((v) => ({ ...v, comp: !v.comp }))} data-testid="toggle-comp" title="Show/hide the display of compensation nodes in the workspace">{viewOpts.comp ? 'Hide Compensation Nodes' : 'Show Compensation Nodes'}</button>
              <button onClick={() => setViewOpts((v) => ({ ...v, platforms: !v.platforms }))} data-testid="toggle-platforms" title="Show/hide the display of platform analyses in the workspace">{viewOpts.platforms ? 'Hide Platforms' : 'Show Platforms'}</button>
              <button onClick={() => setViewOpts((v) => ({ ...v, dp: !v.dp }))} data-testid="toggle-dp" title="Show/hide the display of derived parameters in the workspace">{viewOpts.dp ? 'Hide Derived Parameters' : 'Show Derived Parameters'}</button>
            </div><div className="fj-band-title">View</div></div>}
          </>
          <>
            {rb('cytometry') && <div style={rs('cytometry')} className="fj-band"><div className="fj-band-body">
              <button disabled={!sMeta} onClick={() => setDialog({ kind: 'derived' })} data-testid="open-derived">Derive Parameters ({ws.derivedParameters?.length ?? 0})</button>
              <button disabled={!sMeta} onClick={() => setDialog({ kind: 'keywords' })} data-testid="open-keywords" title="Inspect (Ctrl/Cmd+I)">Inspect (Keywords)</button>
              <button disabled={!groupSamples.length} onClick={() => void run(checkQuality)} data-testid="check-quality" title="A metric for determining fluidic or illumination problems in the cytometer.">Check Sample Quality</button>
            </div><div className="fj-band-title">Cytometry</div></div>}
            {rb('biology') && <div style={rs('biology')} className="fj-band"><div className="fj-band-body">{platformButtons}</div><div className="fj-band-title">Experiment / Biology</div></div>}
          </>
          <>
            {rb('settings') && <div style={rs('settings')} className="fj-band"><div className="fj-band-body">
              <button onClick={() => switchLayout('classic')} data-testid="layout-classic" title="The earlier four-panel screen">Switch to classic layout</button>
              <label title="Each graph window opens as its own window, as in FlowJo; off: windows inside the page"><input type="checkbox" checked={separateWins} onChange={(e) => toggleSeparate(e.target.checked)} data-testid="separate-windows" /> Graph windows as separate windows</label>
            </div><div className="fj-band-title">Settings</div></div>}
          </>
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
              {tableHead()}
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
          const buttons = (
            <span>
              <button title="Duplicate View" onMouseDown={(e) => e.stopPropagation()} onClick={() => openWin(w.sampleId, w.popId, true)} data-testid="gw-duplicate">Duplicate View</button>
              <button title="Close All Graph Windows" onMouseDown={(e) => e.stopPropagation()} onClick={() => { setWins([]); setActiveWin(null); }} data-testid="gw-close-all">Close All</button>
              <button aria-label="Close" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeWin(w.id)} data-testid="gw-close">x</button>
            </span>
          );
          const body = <div className="fj-gw-body">{active ? (sample && sMeta && xAxis ? plotBlock : <p className="muted">Loading...</p>) : w.snap ? <img src={w.snap} alt={title} data-testid="gw-snapshot" /> : <p className="muted">Click to show</p>}</div>;
          if (separateWins && !w.inPage) return (
            <Popout key={w.id} id={w.id} title={title} x={w.x} y={w.y} onClose={() => closeWin(w.id)} onFocus={() => focusWin(w)} onKey={(e) => globalKeyRef.current(e)} onBlocked={() => { setWins((ws0) => ws0.map((x) => (x.id === w.id ? { ...x, inPage: true } : x))); note('warn', 'The browser blocked the graph window; it opens inside the page (allow pop-ups for separate windows)'); }}>
              <div className={`fj-gw popped ${active ? 'active' : ''}`} data-testid="graph-window" data-active={active ? '1' : '0'} onMouseDown={() => focusWin(w)}>
                <div className="fj-gw-title"><span>{title}</span>{buttons}</div>
                {body}
              </div>
            </Popout>
          );
          return (
            <div key={w.id} className={`fj-gw ${active ? 'active' : ''}`} style={{ left: w.x, top: w.y, zIndex: active ? 40 : 30 }} data-testid="graph-window" data-active={active ? '1' : '0'} onMouseDown={() => focusWin(w)}>
              <div className="fj-gw-title" onMouseDown={(e) => { winDrag.current = { id: w.id, dx: e.clientX - w.x, dy: e.clientY - w.y }; }}>
                <span>{title}</span>
                {buttons}
              </div>
              {body}
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
          onOpenGraph={(sampleId, path) => { const s0 = ws.samples.find((x) => x.id === sampleId); const pop = path && s0 ? s0.populations.find((q) => populationPath(s0.populations, q.id) === path) : null; if (!s0 || (path && !pop)) return; setDialog(null); openWin(sampleId, pop?.id ?? null); }}
        />
      )}
      {dialog?.kind === 'tool' && <PlatformToolHost tool={dialog.tool} ws={ws} meta={meta} client={client} sample={sample} popId={selPopValid ? sel.popId : null} groupId={group?.id ?? ''} updateWs={updateWs} download={(n, d, t) => download(n, d, t)} downloadBlob={(n, b) => download(n, b, b.type)} addFiles={(f) => void addFiles(f)} onClose={() => setDialog(null)} />}
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
            onCcGates={(ch, ranges, on) => {
              const spec = specOf(ch);
              if (!spec) return;
              const t = makeTransform(spec);
              const kids = sample.populations.filter((q) => q.parentId === (selPopValid ? sel.popId : null));
              if (!on) {
                const gone = kids.filter((q) => ranges.some((r) => r.name === q.name)).map((q) => q.id);
                if (gone.length) updateWs((w) => { const s2 = w.samples.find((x) => x.id === sample.id)!; s2.populations = s2.populations.filter((q) => !gone.includes(q.id) && !gone.includes(q.parentId ?? '')); });
                return;
              }
              const X = { kind: 'channel' as const, channel: ch, transform: spec };
              createGates(ranges.filter((r) => !kids.some((q) => q.name === r.name)).map((r) => ({ name: r.name, gate: { type: 'rect' as const, dims: [X], min: [t.apply(r.min)], max: [t.apply(r.max)] } })));
            }}
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
            onMultiple={(d) => {
              // GroupDlog.createMultipleGroups: the criteria plus one stain set each, named by the stain set.
              const made: string[] = [];
              updateWs((w) => {
                for (const st of d.criteria.stains ?? []) {
                  const name = uniqueName(st, w.groups.map((x) => x.name));
                  const n: Group = { id: newId('grp'), name, sampleIds: [], criteria: { ...d.criteria, stains: [st] } };
                  if (d.role !== 'undefined') n.role = d.role;
                  if (d.synchronized) n.synchronized = true;
                  if (d.fontStyle && d.fontStyle !== 'plain') n.fontStyle = d.fontStyle;
                  w.groups.push(n);
                  made.push(name);
                }
              });
              setDialog(null);
              note('info', `Created ${made.length} group(s): ${made.join(', ')}`);
            }}
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
      {dialog?.kind === 'naming' && sample && (
        <NamingDialog names={dialog.ids.map((id) => sample.populations.find((p) => p.id === id)?.name ?? id)} onClose={() => setDialog(null)} onOk={(abbr) => { const d = dialog; setDialog(null); finishNaming(d.op, d.ids, abbr); }} />
      )}
      {dialog?.kind === 'boolExpr' && sample && (() => {
        const target = dialog.editId ? sample.populations.find((p) => p.id === dialog.editId) : undefined;
        const parentId = target ? target.parentId : sel.popId ? sample.populations.find((p) => p.id === sel.popId)?.parentId ?? null : null;
        return <BooleanExprDialog title={target ? `Edit Boolean Gate: ${target.name}` : 'Boolean Expression'} initial={target ? exprOfGate(sample, target.id) : ''}
          names={sample.populations.filter((p) => p.parentId === parentId && p.id !== target?.id).map((p) => p.name)}
          onOk={(text) => applyBoolExpr(text, target?.id)} onClose={() => setDialog(null)} />;
      })()}
      {dialog?.kind === 'columns' && <EditColumnsDialog columns={tableColumns(ws)} keywords={groupKeys} onClose={() => setDialog(null)} onOk={(c) => { updateWs((w) => { w.tableColumns = c; w.tableSort = w.tableSort?.filter((k) => c.some((x) => x.key === k.key)); }); setDialog(null); }} />}
      {dialog?.kind === 'addStat' && <AddStatDialog targets={statTargets()} channels={channels.map((c) => c.name)} onOk={addStats} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'series' && (() => {
        const ordered = sortSamples(ws, groupSamples);
        const start = Math.max(0, ordered.findIndex((s) => s.id === sel.sampleId));
        return <ValueSeriesDialog keywords={[...new Set([...tableKeywords, ...annotationKeys])]} startName={ordered[start]?.fileName ?? ''} available={ordered.length - start} onOk={applySeries} onClose={() => setDialog(null)} />;
      })()}
      {dialog?.kind === 'addKeywordGroup' && <AddKeywordDialog onClose={() => setDialog(null)} onOk={(raw) => {
        const name = keywordName(raw);
        if (!name) return;
        updateWs((w) => { setKeyword(w.samples.filter((s) => groupSamples.some((g) => g.id === s.id)), name, '', true); if (!tableColumns(w).some((c) => c.key === `kw:${name}`)) w.tableColumns = [...tableColumns(w), { key: `kw:${name}` }]; });
        note('info', `Keyword "${name}" added to the ${groupSamples.length} sample(s) of group ${group?.name}`);
        setDialog(null);
      }} />}
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
          samples={ws.samples.map((s) => ({ id: s.id, fileName: s.fileName, loaded: !!meta[s.id], paths: s.populations.map((q) => populationPath(s.populations, q.id)) }))}
          preview={{ sampleId: sample.id, path: popPath }}
          groups={ws.groups.map((g) => ({ id: g.id, name: g.name }))}
          transformFor={(ch) => { const c = sMeta?.channels.find((x) => x.name === ch); return ws.channelTransforms[ch] ?? (c && sMeta ? defaultTransform(c, sMeta.keywords) : undefined); }}
          onPreview={(sampleId, path, chans) => {
            const s = ws.samples.find((x) => x.id === sampleId)!;
            const pop = path ? s.populations.find((q) => populationPath(s.populations, q.id) === path) : null;
            return client.compPreview({ sampleId, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters, popId: pop?.id ?? null, channels: chans, maxEvents: 3000 });
          }}
          onFlowjoWizard={async (entries) => {
            const sm = (id: string) => ws.samples.find((x) => x.id === id)!;
            const controls = entries.map((e) => { const s = sm(e.sampleId), n = sm(e.negSampleId || e.sampleId); return { sampleId: s.id, compensation: s.compensation, populations: s.populations, primary: e.primary, posPath: e.posPath, negPath: e.negPath, neg: { sampleId: n.id, compensation: n.compensation, populations: n.populations } }; });
            const detectors = (sMeta?.channels ?? []).filter((c) => !isScatterOrTime(c.name)).map((c) => c.name);
            const res = await client.flowjoWizard({ controls, matrices: ws.matrices, detectors, scales: statScales(ws.channelTransforms, sample.flowjoLinearRanges, detectors) });
            note('info', `FlowJo compensation wizard: ${res.status}`);
            return res;
          }}
          onOptimizeWeights={async (matrix, picks, onProgress, cancelled) => {
            // FlowJo statistics of an unmixed fluorochrome use its scale; a
            // fluorochrome without one gets the default logicle display scale.
            const fluors = matrix.outputNames ?? [];
            const sc = statScales(ws.channelTransforms, sample.flowjoLinearRanges, fluors);
            const scales = fluors.map((f) => sc[f] ?? ({ kind: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 } as const));
            const ref = (q: { sampleId: string; path: string }) => { const s = ws.samples.find((x) => x.id === q.sampleId)!; return { sampleId: s.id, compensation: s.compensation, populations: s.populations, path: q.path }; };
            const start = await client.weightOptStart({ matrix, controls: picks.map((c) => ({ pos: ref(c.pos), neg: ref(c.neg) })), scales, matrices: ws.matrices });
            onProgress(start);
            for (;;) {
              if (cancelled()) { await client.weightOptCancel(start.id); note('info', 'Weight optimization canceled'); return null; }
              const r = await client.weightOptStep(start.id);
              onProgress(r);
              if (r.done) { note('info', `Optimized weights for ${matrix.name} in ${r.iterations} iterations`); return { weights: r.weights!, ssm: r.ssm!, iterations: r.iterations! }; }
            }
          }}
          onEstimateAf={async (sampleId, detectors, gatePath) => {
            const s = ws.samples.find((x) => x.id === sampleId)!;
            const spectrum = await client.estimateAf({ sampleId, detectors, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, gatePath });
            note('info', `Autofluorescence spectrum estimated from ${s.fileName}`);
            return spectrum;
          }}
          onAssign={(ref, scope) => {
            updateWs((w) => {
              const gid = scope.startsWith('group:') ? scope.slice(6) : groupId;
              const ids = scope === 'sample' ? [sample.id] : scope === 'workspace' ? w.samples.map((s) => s.id) : w.groups.find((g) => g.id === gid)?.sampleIds ?? [];
              for (const s of w.samples) if (ids.includes(s.id)) s.compensation = ref;
            });
            note('info', `Compensation set to ${ref} for ${scope === 'sample' ? sample.fileName : scope === 'workspace' ? 'all samples' : `group ${ws.groups.find((g) => g.id === (scope.startsWith('group:') ? scope.slice(6) : groupId))?.name}`}`);
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
      {dialog?.kind === 'scripts' && <ScriptEditorDialog ws={ws} updateWs={updateWs} snapshot={scriptSnapshot} applyOps={applyScriptOps} download={download} onClose={() => setDialog(null)}
        statsOf={(sid, cols) => { const s = ws.samples.find((x) => x.id === sid); return s && meta[sid] ? client.stats({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters, columns: cols, kinetics: ws.kinetics, scales: statScales(ws.channelTransforms, s.flowjoLinearRanges, cols.map((c) => c.channel)) }) : Promise.resolve(undefined); }} />}
      {dialog?.kind === 'prefs' && <PrefsDialog prefs={prefs} onChange={setPrefs} onClose={() => setDialog(null)} />}
      {colorTableOpen && <ColorTableDialog value={prefs.colorTable} onApply={(v) => setPrefs({ ...prefsRef.current, colorTable: v })} onClose={() => setColorTableOpen(false)} />}
      {rangeDlg && <RangeDialog channel={rangeDlg.channel} min={rangeDlg.min} max={rangeDlg.max} onApply={(a, b) => applyRange(rangeDlg.channel, a, b)} onClose={() => setRangeDlg(null)} />}
      {dialog?.kind === 'tables' && <TablesDialog ws={ws} updateWs={updateWs} stats={stats} colLabel={colLabel} ask={ask} download={download} onClose={() => setDialog(null)}
        statsOf={(sid, cols) => { const s = ws.samples.find((x) => x.id === sid); return s ? client.stats({ sampleId: s.id, compensation: s.compensation, populations: s.populations, matrices: ws.matrices, derived: ws.derivedParameters, columns: cols, kinetics: ws.kinetics, scales: statScales(ws.channelTransforms, s.flowjoLinearRanges, cols.map((c) => c.channel)) }) : Promise.resolve(undefined); }}
        loaded={(sid) => !!meta[sid]} channels={channels.map((c) => c.name)} note={note}
        copyRich={(html, text, what) => { void (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write ? navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]) : navigator.clipboard.writeText(text)).then(() => note('info', `${what} copied`), () => note('error', `Could not copy the ${what.toLowerCase()} to the clipboard`)); }}
        openSamples={(ids, path) => { setDialog(null); for (const sid of ids) { const s = ws.samples.find((x) => x.id === sid); const pop = path ? s?.populations.find((q) => populationPath(s.populations, q.id) === path) : null; if (s && (!path || pop)) openWin(s.id, pop?.id ?? null); } }} />}
      {dialog?.kind === 'export' && sample && (
        <ExportDialog
          popLabel={popPath || 'All events'}
          hasData={!!sMeta}
          initialMode={dialog.mode}
          selectedCount={exportTargets('populations').length}
          groupCount={exportTargets('group').length}
          onClose={() => setDialog(null)}
          params={channels.map((c) => c.name)}
          keywords={groupKeys}
          onEvents={exportEvents}
          onSvg={() => {
            if (!xAxis || !plotData) return;
            const svg = new SvgContext(PLOT.w, PLOT.h);
            renderPlot(asCanvas(svg), { kind, x: xAxis, y: yAxis, data: plotData, gates: drawableGates(sample.populations, sel.popId, xAxis, yAxis), counts, contourLevel: plotSettings.contourLevel, showOutliers, overlays: overlayData, normalize: plotSettings.normalize, xTitle: axisTitle(xAxis.channel), yTitle: yAxis ? axisTitle(yAxis.channel) : undefined, ...displayOpts });
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
  mode: 'export' | 'concatenate' | 'populations' | 'group';
  concat: ConcatMode;
}

function ExportDialog(p: { popLabel: string; hasData: boolean; initialMode?: 'group'; selectedCount: number; groupCount: number; params: string[]; keywords: string[]; onClose: () => void; onEvents: (o: EventExportOptions) => void; onPng: () => void; onSvg: () => void; onGatingMl: () => void; onWsp: () => void }) {
  // FlowJo 10's "Export or Concatenate" options (specs 9).
  const [params, setParams] = useState<EventExportOptions['params']>('compensated');
  const [custom, setCustom] = useState<string[]>(p.params);
  const [capOn, setCapOn] = useState(false);
  const [cap, setCap] = useState(10000);
  const [header, setHeader] = useState<HeaderFormat>('p');
  const [writeHeader, setWriteHeader] = useState(true);
  const [mode, setMode] = useState<EventExportOptions['mode']>(p.initialMode ?? 'export');
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
            <label title="Export / Concatenate Populations: every selected population (Ctrl-click rows in the table), one file each"><input type="radio" checked={mode === 'populations'} onChange={() => setMode('populations')} data-testid="exp-mode-pops" /> Selected populations ({p.selectedCount}), one file each</label>
            <label title="Export / Concatenate Group: this population in each sample of the group, one file each"><input type="radio" checked={mode === 'group'} onChange={() => setMode('group')} data-testid="exp-mode-group" /> Each sample of the group ({p.groupCount}), one file each</label>
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

