// Script Editor (WSCommand.SCRIPTEDITOR, WSScriptAction; ScriptEditorController,
// ScriptEditorPerspective, ScriptView; docs/validation/ui-gaps/workspace.md).
// Left: the workspace's script list (New, Open, Duplicate, Delete, Save
// Options). Right: the script text with Run, the output console with Clear,
// and the ">>>" prompt of the interactive console (Up / Down history, Ctrl+C
// interrupts). Scripts are JavaScript and run in a Web Worker against the
// FlowJo scripting API (src/core/scriptApi.ts).
import { useEffect, useRef, useState } from 'react';
import ScriptWorker from '../worker/script.worker.ts?worker&inline';
import { CONSOLE_NAME, ConsoleHistory, isEmptyScript, MAX_CONSOLE, newScript, presentation, scriptFileName, scriptFromFile, WELCOME_MSG, type FJScript } from '../core/fjScript';
import { MAX_ROUNDS, statKey, type OutLine, type ScriptOp, type ScriptSnapshot, type StatReq } from '../core/scriptApi';
import type { StatColumn, Workspace } from '../core/model';

type Reply = { out: OutLine[]; ops: ScriptOp[]; missing: StatReq[] };
interface Seg { text: string; color: OutLine['color'] }

export function ScriptEditorDialog(p: {
  ws: Workspace;
  updateWs: (fn: (w: Workspace) => void) => void;
  snapshot: () => ScriptSnapshot;
  statsOf: (sampleId: string, cols: StatColumn[]) => Promise<(number | string)[] | undefined>;
  applyOps: (ops: ScriptOp[]) => void;
  download: (name: string, data: BlobPart, type?: string) => void;
  onClose: () => void;
}) {
  const stored = p.ws.scripts ?? [];
  // ScriptEditorController's constructor always starts with one New Script.
  const list: FJScript[] = stored.length ? stored : [newScript([])];
  const [sel, setSel] = useState(0);
  const cur = list[Math.min(sel, list.length - 1)];
  const [draft, setDraft] = useState<{ name: string; script: string }>({ name: cur.name, script: cur.script });
  const [segs, setSegs] = useState<Seg[]>([]);
  const [running, setRunning] = useState(false);
  const [cmd, setCmd] = useState('');
  const [saveMenu, setSaveMenu] = useState(false);
  const lastWriter = useRef('');
  const history = useRef(new ConsoleHistory());
  const worker = useRef<Worker | null>(null);
  const pending = useRef<((r: Reply | null) => void) | null>(null);
  const consoleEl = useRef<HTMLPreElement>(null);
  const selIdx = Math.min(sel, list.length - 1);

  useEffect(() => { setDraft({ name: cur.name, script: cur.script }); }, [selIdx, cur.name, cur.script]);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => { if (consoleEl.current) consoleEl.current.scrollTop = consoleEl.current.scrollHeight; }, [segs]);

  // ScriptView.ScriptOutputHandler: a "--- writer ---" header when the writer changes.
  const write = (lines: OutLine[]) => {
    const add: Seg[] = [];
    for (const l of lines) {
      if (l.writer !== lastWriter.current) { add.push({ text: `\n --- ${l.writer} ---\n`, color: 'black' }); lastWriter.current = l.writer; }
      add.push({ text: l.text, color: l.color });
    }
    setSegs((s) => [...s, ...add].slice(-MAX_CONSOLE));
  };
  const welcomed = useRef(false);
  useEffect(() => { if (!welcomed.current) { welcomed.current = true; write([{ writer: CONSOLE_NAME, text: `${WELCOME_MSG}\n\n`, color: 'black' }]); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Edits go to the workspace (undoable) when the field is left, before a run
  // and before another script is shown.
  const commit = () => {
    if (draft.name === cur.name && draft.script === cur.script && stored.length) return;
    p.updateWs((w) => {
      const l = w.scripts?.length ? [...w.scripts] : [newScript([])];
      l[selIdx] = { ...l[selIdx], name: draft.name, script: draft.script };
      w.scripts = l;
    });
  };
  // List edits work on the workspace's current list (not this render's copy),
  // so quick repeated clicks build on each other. select: index or 'last'.
  const setList = (fn: (l: FJScript[]) => FJScript[], select: number | 'last') => {
    const d = draft, at = selIdx;
    p.updateWs((w) => {
      const base = w.scripts?.length ? [...w.scripts] : [newScript([])];
      if (base[at]) base[at] = { ...base[at], name: d.name, script: d.script };
      w.scripts = fn(base);
    });
    setSel(select === 'last' ? Number.MAX_SAFE_INTEGER : select);
  };

  const getWorker = () => {
    if (!worker.current) {
      const w = new ScriptWorker();
      w.onmessage = (ev) => { const f = pending.current; pending.current = null; f?.(ev.data as Reply); };
      w.onerror = (ev) => { ev.preventDefault(); const f = pending.current; pending.current = null; f?.(null); };
      worker.current = w;
    }
    return worker.current;
  };
  // Ctrl+C (ScriptView.Handler.handleKey -> interruptInteractiveShell).
  const interrupt = (writer: string) => {
    worker.current?.terminate();
    worker.current = null;
    const f = pending.current; pending.current = null;
    if (f) { f(null); write([{ writer, text: 'User interrupt\n', color: 'red' }]); }
  };
  const writerRef = useRef(CONSOLE_NAME);

  const execute = async (mode: 'run' | 'console', code: string, writer: string) => {
    writerRef.current = writer;
    setRunning(true);
    const cache: Record<string, number> = {};
    try {
      for (let round = 0; ; round++) {
        const snapshot = p.snapshot();
        const reply = await new Promise<Reply | null>((resolve) => { pending.current = resolve; getWorker().postMessage({ id: round, mode, code, writer, snapshot, cache }); });
        if (!reply) return;
        if (reply.missing.length && round < MAX_ROUNDS) {
          const bySample = new Map<string, StatReq[]>();
          for (const r of reply.missing) bySample.set(r.sampleId, [...(bySample.get(r.sampleId) ?? []), r]);
          for (const [sid, reqs] of bySample) {
            const cols: StatColumn[] = reqs.map((r, i) => ({ id: `script${i}`, populationPath: r.path, stat: r.stat, ...(r.channel ? { channel: r.channel } : {}), ...(r.percentile !== undefined ? { percentile: r.percentile } : {}), ...(r.correlate ? { correlate: r.correlate } : {}) }));
            const vals = await p.statsOf(sid, cols).catch(() => undefined);
            reqs.forEach((r, i) => { const v = vals?.[i]; cache[statKey(r)] = typeof v === 'number' ? v : NaN; });
          }
          continue;
        }
        write(reply.out);
        if (reply.ops.length) p.applyOps(reply.ops);
        return;
      }
    } finally {
      setRunning(false);
    }
  };

  const run = () => {
    commit();
    const s = { ...cur, ...draft };
    if (isEmptyScript(s)) return;
    void execute('run', s.script, s.name.trim() || 'Script');
  };
  const submit = () => {
    history.current.add(cmd);
    const c = cmd;
    setCmd('');
    if (c.trim()) void execute('console', c, CONSOLE_NAME);
  };
  const openFiles = async (files: FileList) => {
    const loaded = await Promise.all(Array.from(files).map(async (f) => scriptFromFile(f.name, await f.text())));
    if (loaded.length) setList((l) => [...l, ...loaded], 'last');
  };
  const saveFiles = (ss: FJScript[]) => { for (const s of ss) p.download(scriptFileName(s.name), s.script, 'text/plain'); };
  const close = () => { commit(); p.onClose(); };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-label="FlowJo Script Editor" data-testid="script-editor" style={{ width: 'min(1100px, 96vw)' }}>
        <div className="modal-head"><b>FlowJo Script Editor</b><button onClick={close} aria-label="Close" data-testid="script-close">x</button></div>
        <div className="modal-body" style={{ display: 'flex', gap: 12 }}>
          <div style={{ width: 230, flex: 'none' }}>
            <b>FlowJo Scripts</b>
            <ul className="plain-list" data-testid="script-list" style={{ listStyle: 'none', padding: 0, margin: '6px 0', maxHeight: 360, overflow: 'auto', border: '1px solid #ccc' }}>
              {list.map((s, i) => (
                <li key={i} data-testid={`script-item-${i}`} className={i === selIdx ? 'selected' : ''} style={{ padding: '2px 6px', cursor: 'pointer', background: i === selIdx ? '#cfe3ff' : undefined }}
                  onClick={() => { if (i !== selIdx) { commit(); setSel(i); } }}>{presentation(i === selIdx ? { ...s, ...draft } : s)}</li>
              ))}
            </ul>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              <button data-testid="script-new" title="Start a new FlowJo Script" onClick={() => setList((l) => [...l, newScript(l)], 'last')}>New Script</button>
              <label className="file-btn" title="Load previously saved scripts">Open Script<input type="file" multiple accept=".fjs,.js,.txt" data-testid="script-open" onChange={(e) => { if (e.target.files) void openFiles(e.target.files); e.target.value = ''; }} /></label>
              <button data-testid="script-dup" title="Duplicate the selected script" onClick={() => setList((l) => [...l, { ...l[selIdx] }], 'last')}>Duplicate Script</button>
              <button data-testid="script-delete" title="Delete this FlowJo Script from the current workspace" disabled={!stored.length} onClick={() => setList((l) => l.filter((_, i) => i !== selIdx), Math.max(0, selIdx - 1))}>Delete Script</button>
              <span style={{ position: 'relative' }}>
                <button data-testid="script-save-options" title="Save scripts to file" onClick={() => setSaveMenu((x) => !x)}>Save Options</button>
                {saveMenu && (
                  <span className="menu" style={{ position: 'absolute', left: 0, top: '100%', background: 'var(--bg, #fff)', border: '1px solid #999', zIndex: 5, display: 'flex', flexDirection: 'column' }}>
                    <button data-testid="script-save" title="Save the selected script to file" onClick={() => { setSaveMenu(false); saveFiles([{ ...cur, ...draft }]); }}>Save Selected Script</button>
                    <button data-testid="script-save-all" title="Save all scripts in this workspace to a folder" onClick={() => { setSaveMenu(false); saveFiles(list.map((s, i) => (i === selIdx ? { ...s, ...draft } : s))); }}>Save All</button>
                  </span>
                )}
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row">
              <b>Script Editor</b>
              <input data-testid="script-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={commit} style={{ flex: 1 }} aria-label="Script name" />
              <button data-testid="script-run" title="Run this script in the workspace context" disabled={running} onClick={run}>Run</button>
            </div>
            <textarea data-testid="script-text" spellCheck={false} rows={14} value={draft.script} onChange={(e) => setDraft({ ...draft, script: e.target.value })} onBlur={commit}
              style={{ fontFamily: 'monospace', fontSize: 11, width: '100%', padding: 8 }} placeholder={'// JavaScript, e.g.\nworkspace.samples.populations("**").names'} />
            <div className="row"><b>Output Console</b><span className="muted">{running ? 'Running... (Ctrl+C in the prompt stops)' : ''}</span><span className="sep" /><button data-testid="script-clear" title="Clear the console output buffer" onClick={() => { setSegs([]); lastWriter.current = ''; }}>Clear</button></div>
            <pre ref={consoleEl} data-testid="script-console" style={{ fontFamily: 'monospace', fontSize: 11, height: 200, overflow: 'auto', border: '1px solid #ccc', padding: 8, margin: 0, whiteSpace: 'pre-wrap', background: 'var(--panel, #fafafa)' }}>
              {segs.map((s, i) => <span key={i} style={{ color: s.color === 'black' ? undefined : s.color === 'blue' ? '#1f4fd1' : '#c62828' }}>{s.text}</span>)}
            </pre>
            <div className="row">
              <span style={{ fontFamily: 'monospace' }}>&gt;&gt;&gt;</span>
              <input data-testid="script-prompt" title="Type in your commands here" value={cmd} style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }} onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submit(); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setCmd(history.current.move(-1)); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); setCmd(history.current.move(1)); }
                  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && running) { e.preventDefault(); interrupt(writerRef.current); }
                }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
