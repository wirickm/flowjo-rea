// FlowJo 10.6.2 Plate Editor window (PlatformNavCommand.PLATE, PECommand;
// spec docs/validation/ui-gaps/platforms.md). Plate definitions live in the
// workspace (ws.plateEditor) and every edit goes through updateWs (undoable);
// the well selection is window state, as in FlowJo.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SampleState, StatColumn, Workspace } from '../core/model';
import { newId, populationPath } from '../core/model';
import { ExperimentDialog } from './Experiment';
import {
  addAttrs, addPairs, allWells, applyToSamples, clearWells, colWells, copyText, DEFAULT_SERIES, dilutionSeries, fillDown, fillRight, heatColor,
  importCsv, invert, keywordFilePairs, MAX_COLS, MAX_ROWS, newEditorState, newPlate, nextStagingName, parsePlateXml, pasteText, PLATE_SIZES,
  plateCsv, plateKeywords, plateXml, readAttributesFromGroup, rectangle, removeAttr, rowWells, samplesByWell, setDimensions, uniqueName,
  valueRange, wellId, wellsOfSamples, wellText, ROW_LETTERS, type PlateDef, type PlateEditorState, type Series,
} from '../core/plate';
import { statScales } from '../core/flowjoStats';
import { formatStat } from '../core/statsTable';
import { useRibbon } from './RibbonConfig';
import { PE_RIBBON } from './ribbons';

type Say = (level: 'info' | 'warn' | 'error', text: string) => void;
export interface PlateEditorProps {
  ws: Workspace;
  groups: { id: string; name: string; sampleIds: string[] }[];
  currentGroupId: string;
  loaded: (sampleId: string) => boolean;
  stats: (s: SampleState, col: StatColumn, scales: ReturnType<typeof statScales>) => Promise<number | string | undefined>;
  updateWs: (fn: (w: Workspace, say: Say) => void) => void;
  download: (name: string, data: string, type: string) => void;
  onClose: () => void;
}

const INSTRUCTIONS = [
  'Add keywords to the list at the right, select one and add it to the selected wells or staging wells.',
  'The small number at the bottom right of a well is its number of attributes. Click a single well to see its attributes.',
  'Click row or column headers to select whole rows or columns; Shift-click selects a rectangle, Ctrl/Cmd-click toggles.',
  'Right-click a well for its own actions.',
];
// Plate$StringColorMap stand-in: one border colour per category value.
const ENUM_COLORS = ['#d0021b', '#2a7de1', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#17becf'];

export function PlateEditor(p: PlateEditorProps) {
  const st: PlateEditorState = p.ws.plateEditor ?? newEditorState();
  const plate = st.plates[Math.min(st.current, st.plates.length - 1)];
  const [sel, setSel] = useState<string[]>([]);
  const peRib = useRibbon(PE_RIBBON); // PECommand.RIBBONCONFIG / RIBBONSETDEFAULT
  const [anchor, setAnchor] = useState<string | null>(null);
  const [kwRow, setKwRow] = useState<number | null>(null);
  const [attr, setAttr] = useState('');
  const [val, setVal] = useState('');
  const [stagingSel, setStagingSel] = useState<number[]>([]);
  const [custom, setCustom] = useState<{ cols: number; rows: number } | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [menu, setMenu] = useState<{ well: string; x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState<Record<string, string>>({}); // well -> sample file name (Read Samples from Group)
  const [statCol, setStatCol] = useState('');
  const [statVals, setStatVals] = useState<Record<string, number | string>>({});
  const clip = useRef<string>('');
  const group = p.groups.find((g) => g.id === p.currentGroupId) ?? p.groups[0];
  const groupSamples = useMemo(() => p.ws.samples.filter((s) => group?.sampleIds.includes(s.id)), [p.ws.samples, group]);
  // PECommand.MIFLOWCYT: the plate editor's Annotate Experiment opens the same
  // MIFlowCyt dialog as the workspace (WSController.openMIFlowCytDialog).
  const [annotate, setAnnotate] = useState(false);

  const edit = (fn: (s: PlateEditorState, pl: PlateDef, say: Say) => void) => p.updateWs((w, say) => {
    w.plateEditor ??= newEditorState();
    const s = w.plateEditor;
    s.current = Math.min(s.current, s.plates.length - 1);
    fn(s, s.plates[s.current], say);
  });
  const toSel = (fn: (pl: PlateDef) => void) => edit((_, pl) => fn(pl));

  // Statistic heat map (le.plate display): a statistics-table column per well's sample.
  useEffect(() => {
    const col = p.ws.statColumns.find((c) => c.id === statCol);
    if (!col) { setStatVals({}); return; }
    let live = true;
    (async () => {
      const out: Record<string, number | string> = {};
      for (const [w, list] of Object.entries(samplesByWell(plate, p.ws.samples))) {
        const s = list[0];
        if (!p.loaded(s.id)) continue;
        const v = await p.stats(s, col, statScales(p.ws.channelTransforms, s.flowjoLinearRanges, [col.channel]));
        if (v !== undefined) out[w] = v;
      }
      if (live) setStatVals(out);
    })().catch((e) => setError((e as Error).message));
    return () => { live = false; };
  }, [statCol, plate, p.ws.samples, p.ws.statColumns]); // eslint-disable-line react-hooks/exhaustive-deps

  const clickWell = (w: string, e: React.MouseEvent) => {
    if (e.shiftKey && anchor) setSel(rectangle(anchor, w));
    else if (e.ctrlKey || e.metaKey) setSel((s) => (s.includes(w) ? s.filter((x) => x !== w) : [...s, w]));
    else { setSel([w]); setAnchor(w); }
  };
  const clickHeader = (wells: string[], e: React.MouseEvent) => setSel((s) => (e.ctrlKey || e.metaKey || e.shiftKey ? [...new Set([...s, ...wells])] : wells));
  const pair = kwRow !== null ? st.keywordTable[kwRow] : undefined;
  const filter = plate.keywordFilter ?? '';
  const filterIsKey = !!filter && !filter.toLowerCase().includes('well') && filter.toLowerCase() !== 'all';
  const range = filterIsKey ? valueRange(plate, filter) : null;
  const categories = filterIsKey ? [...new Set(Object.values(plate.wells).map((a) => a[filter]).filter((v) => v !== undefined && !Number.isFinite(Number(v))))].sort() : [];
  const statNums = Object.values(statVals).map(Number).filter(Number.isFinite);
  const statRange: [number, number] = [Math.min(0, ...statNums), Math.max(0, ...statNums)];
  const single = sel.length === 1 ? sel[0] : null;
  const keys = plateKeywords(plate);

  const readFile = (accept: string, fn: (text: string, name: string) => void) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => { const f = inp.files?.[0]; if (f) void f.text().then((t) => fn(t, f.name)); };
    inp.click();
  };
  const guard = (fn: () => void) => { try { setError(null); fn(); } catch (e) { setError((e as Error).message); } };

  const wellStyle = (w: string): React.CSSProperties => {
    const a = plate.wells[w];
    const s: React.CSSProperties = { width: plate.cols > 24 ? 20 : plate.cols > 12 ? 30 : 46, height: plate.cols > 24 ? 16 : plate.cols > 12 ? 24 : 34, fontSize: plate.cols > 24 ? 7 : 10, position: 'relative', padding: 0, border: '1px solid #bbb', background: sel.includes(w) ? '#cfe0ff' : a ? '#f4f7ec' : '#fff', overflow: 'hidden', cursor: 'pointer' };
    const bw = plate.thickBorders ? 3 : 2;
    if (pair && a?.[pair.attribute] !== undefined) s.border = `${bw}px solid ${a[pair.attribute] === pair.value ? '#1a7f1a' : '#7d8fb3'}`;
    if (range && plate.heatmap && a?.[filter] !== undefined && a[filter].trim() !== '' && Number.isFinite(Number(a[filter]))) { const [r, g, b] = heatColor(Number(a[filter]), range); s.background = `rgb(${r},${g},${b})`; }
    if (statCol && statVals[w] !== undefined && Number.isFinite(Number(statVals[w]))) { const [r, g, b] = heatColor(Number(statVals[w]), statRange); s.background = `rgb(${r},${g},${b})`; }
    if (plate.enumBorders && filterIsKey && a?.[filter] !== undefined) { const k = categories.indexOf(a[filter]); if (k >= 0) s.border = `${bw}px solid ${ENUM_COLORS[k % ENUM_COLORS.length]}`; }
    return s;
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); setMenu(null); }}>
      <div className="modal layout" role="dialog" aria-label="Plate Editor" data-testid="plate-editor">
        <div className="modal-head"><b>Plate Editor - {plate.name}</b><button onClick={p.onClose} aria-label="Close" data-testid="pe-close">x</button></div>
        <div className="modal-body">
          {/* Ribbon bands as PERibbonStructure: Plates, Document, Clipboard, Add, Select, Experiment, Keywords, Settings */}
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {peRib.has('Plate Editor', 'plates') && <fieldset style={peRib.style('Plate Editor', 'plates')}><legend>Plates</legend>
              <select value={st.current} onChange={(e) => edit((s) => { s.current = Number(e.target.value); })} data-testid="pe-plate-select">{st.plates.map((x, i) => <option key={i} value={i}>{x.name}</option>)}</select>
              <button data-testid="pe-add-plate" title="Add another plate to the list of definitions" onClick={() => edit((s) => { s.plates.push(newPlate(uniqueName('Plate', s.plates.map((x) => x.name)))); s.current = s.plates.length - 1; })}>Add New Plate</button>
              <button data-testid="pe-dup-plate" title="Make a copy of the current plate with all the keywords" onClick={() => edit((s, pl) => { const c = structuredClone(pl); c.name = uniqueName(`${pl.name} copy`, s.plates.map((x) => x.name)); s.plates.push(c); s.current = s.plates.length - 1; })}>Duplicate Plate</button>
              <button data-testid="pe-del-plate" title="Remove the current plate" onClick={() => { if (window.confirm('Are you sure you want to delete this plate?')) edit((s) => { s.plates.splice(s.current, 1); if (!s.plates.length) s.plates.push(newPlate('Plate')); s.current = Math.max(0, s.current - 1); }); }}>Delete Plate</button>
              <input value={plate.name} onChange={(e) => toSel((pl) => { pl.name = e.target.value; })} style={{ width: 110 }} title="Plate Name" data-testid="pe-plate-name" />
            </fieldset>}
            {peRib.has('Plate Editor', 'document') && <fieldset style={peRib.style('Plate Editor', 'document')}><legend>Document</legend>
              <button data-testid="pe-open" title="Load a saved plate setup (XML) file" onClick={() => readFile('.xml', (t) => guard(() => { const s2 = parsePlateXml(t); p.updateWs((w) => { w.plateEditor = s2; }); }))}>Open...</button>
              <button data-testid="pe-save" title="Save the current plate definition to a XML file." onClick={() => p.download('untitled plate.xml', plateXml(st), 'application/xml')}>Save</button>
              <button data-testid="pe-export" title="Spreadsheet table with a column for every keyword found in any well" onClick={() => p.download(`${plate.name}.csv`, plateCsv(plate), 'text/csv')}>Save As CSV Table</button>
              <button data-testid="pe-import" title='Import a CSV file with annotation which includes a mandatory "well_id" column.' onClick={() => readFile('.csv,.txt', (t) => guard(() => { const pl2 = structuredClone(plate); const r = importCsv(pl2, t); edit((_, pl) => { Object.assign(pl, pl2); }); setError(r.ignored ? `${r.ignored} line(s) ignored: well id not in the plate` : null); }))}>Import</button>
            </fieldset>}
            {peRib.has('Plate Editor', 'clipboard') && <fieldset style={peRib.style('Plate Editor', 'clipboard')}><legend>Clipboard</legend>
              <button data-testid="pe-cut" disabled={!sel.length} onClick={() => { clip.current = copyText(plate, sel); void navigator.clipboard?.writeText(clip.current).catch(() => {}); toSel((pl) => clearWells(pl, sel)); }}>Cut</button>
              <button data-testid="pe-copy" disabled={!sel.length} onClick={() => { clip.current = copyText(plate, sel); void navigator.clipboard?.writeText(clip.current).catch(() => {}); }}>Copy</button>
              <button data-testid="pe-paste" title="Tab/newline text with attributes in the first row and well ids in the first column" onClick={async () => { let t = clip.current; try { t = (await navigator.clipboard.readText()) || t; } catch { /* clipboard permission denied: internal clipboard */ } toSel((pl) => { pasteText(pl, t); }); }}>Paste</button>
              <button data-testid="pe-fill-down" disabled={!sel.length} title="Copy the top well's keyword values down to all other selected wells below it" onClick={() => toSel((pl) => fillDown(pl, sel))}>Fill Down</button>
              <button data-testid="pe-fill-right" disabled={!sel.length} title="Copy the leftmost well's keyword values across to all other wells to its right" onClick={() => toSel((pl) => fillRight(pl, sel))}>Fill Right</button>
              <button data-testid="pe-titrate" disabled={!sel.length} title="Set up a keyword value series for multiple wells" onClick={() => setSeries({ ...DEFAULT_SERIES })}>Dilution Series...</button>
            </fieldset>}
            {peRib.has('Plate Editor', 'select') && <fieldset style={peRib.style('Plate Editor', 'select')}><legend>Select</legend>
              <button data-testid="pe-select-all" onClick={() => setSel(allWells(plate))}>Select All</button>
              <button data-testid="pe-invert" onClick={() => setSel(invert(plate, sel))}>Invert Selection</button>
              <button data-testid="pe-deselect" onClick={() => setSel([])}>Deselect All</button>
              <select value="" onChange={(e) => { const g = p.groups.find((x) => x.id === e.target.value); if (g) setSel(wellsOfSamples(plate, p.ws.samples.filter((s) => g.sampleIds.includes(s.id)))); }} data-testid="pe-select-group" title="Select all wells based on the associated samples in a chosen workspace group"><option value="">Select Group...</option>{p.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
              <button data-testid="pe-save-selection" disabled={!sel.length} title="Create a new button in the footer to be able to recall this selection" onClick={() => { const n = window.prompt('Enter a name to describe the selection:', `Selection ${st.selections.length + 1}`); if (n) edit((s) => { s.selections.push({ name: n, wells: [...sel] }); }); }}>Save Well Selection</button>
            </fieldset>}
            {peRib.has('Plate Editor', 'experiment') && <fieldset style={peRib.style('Plate Editor', 'experiment')}><legend>Experiment</legend>
              <button data-testid="pe-miflow" title="Edit the experimental description, as per the MIFlowCyt standard for cytometry annotation." onClick={() => setAnnotate(true)}>Annotate Experiment...</button>
              <button data-testid="pe-read-attrs" title="Assign attributes from the data files in the currently selected group to the wells" onClick={() => edit((_, pl, say) => { const r = readAttributesFromGroup(pl, groupSamples.map((s) => structuredClone(s))); if (r.missing) say('warn', `Unable to read attributes from all samples in group: ${r.missing} missing Well ID(s)`); })}>Read Attributes from Group</button>
              <button data-testid="pe-read-samples" title="Attempt to match the samples in the current group to the wells in the current plate" onClick={() => { const m: Record<string, string> = {}; for (const [w, l] of Object.entries(samplesByWell(plate, groupSamples))) m[w] = l.map((s) => s.fileName).join(', '); setAttached(m); }}>Read Samples from Group</button>
              <button data-testid="pe-apply" title="Copy the Keywords in the wells to the current group" onClick={() => p.updateWs((w, say) => { const ids = new Set(group?.sampleIds ?? []); const n = applyToSamples(plate, w.samples.filter((s) => ids.has(s.id))); say('info', `Plate keywords applied to ${n} sample(s)`); })}>Apply Plate Keywords to Group</button>
              <button data-testid="pe-make-group" disabled={!sel.length} title="Create a group in the workspace corresponding to the selected wells in the plate" onClick={() => { const n = window.prompt('Group name', `${plate.name} selection`); if (!n) return; const by = samplesByWell(plate, p.ws.samples); const ids = [...new Set(sel.flatMap((w) => (by[w] ?? []).map((s) => s.id)))]; p.updateWs((w, say) => { w.groups.push({ id: newId('grp'), name: n, sampleIds: ids }); say('info', `Group "${n}" created with ${ids.length} sample(s)`); }); }}>Make Group...</button>
            </fieldset>}
            {peRib.has('Plate Editor', 'size') && <fieldset style={peRib.style('Plate Editor', 'size')}><legend>Plate size</legend>
              {([96, 384, 1536] as const).map((n) => <button key={n} data-testid={`pe-size-${n}`} onClick={() => toSel((pl) => setDimensions(pl, PLATE_SIZES[n].cols, PLATE_SIZES[n].rows))}>{n} well plate</button>)}
              <button data-testid="pe-size-custom" onClick={() => setCustom({ cols: plate.cols, rows: plate.rows })}>Custom</button>
            </fieldset>}
            {peRib.has('Plate Editor', 'settings') && <fieldset style={peRib.style('Plate Editor', 'settings')}><legend>Settings</legend>
              <label><input type="checkbox" checked={plate.showNEntries !== false} onChange={(e) => toSel((pl) => { pl.showNEntries = e.target.checked; })} data-testid="pe-show-n" />Show number of attributes</label>
              <label><input type="checkbox" checked={!!plate.thickBorders} onChange={(e) => toSel((pl) => { pl.thickBorders = e.target.checked; })} data-testid="pe-thick" />Use thicker borders</label>
              <label><input type="checkbox" checked={!!plate.heatmap} onChange={(e) => toSel((pl) => { pl.heatmap = e.target.checked; })} data-testid="pe-heatmap" />Show heatmaps of numerical keys</label>
              <label><input type="checkbox" checked={!!plate.enumBorders} onChange={(e) => toSel((pl) => { pl.enumBorders = e.target.checked; })} data-testid="pe-enum" />Color borders of categorical keys</label>
              <select value={filter} onChange={(e) => toSel((pl) => { pl.keywordFilter = e.target.value; })} data-testid="pe-filter" title="Select a keyword to show corresponding well values and hide display of all others"><option value="">All Keywords</option>{keys.map((k) => <option key={k} value={k}>{k}</option>)}</select>
              <select value={statCol} onChange={(e) => setStatCol(e.target.value)} data-testid="pe-stat" title="Heat map of a statistics table column for each well's sample"><option value="">No Statistics</option>{p.ws.statColumns.map((c) => <option key={c.id} value={c.id}>{c.populationPath || 'All'} {c.stat}{c.channel ? ` ${c.channel}` : ''}</option>)}</select>
              <button data-testid="pe-toggle-notation" onClick={() => edit((s) => { s.hideInstructions = !s.hideInstructions; })}>{st.hideInstructions ? 'Show Instructions' : 'Hide Instructions'}</button>
            </fieldset>}
            <button style={{ order: 99, alignSelf: 'center' }} data-testid="pe-ribbon-config" title="Configure Ribbon" onClick={() => peRib.openConfig('Plate Editor')}>Configure Ribbon</button>
          </div>
          {peRib.dialog}
          {error && <p className="error" data-testid="pe-error">{error}</p>}
          {!st.hideInstructions && <ul className="muted" data-testid="pe-instructions" style={{ margin: '4px 0' }}>{INSTRUCTIONS.map((t) => <li key={t}>{t}</li>)}</ul>}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <table style={{ borderCollapse: 'collapse' }} data-testid="pe-plate" data-rows={plate.rows} data-cols={plate.cols}>
                <thead><tr><th><button data-testid="pe-corner" onClick={() => setSel(allWells(plate))} title="Select All" style={{ fontSize: 9 }}>*</button></th>
                  {Array.from({ length: plate.cols }, (_, c) => <th key={c}><button style={{ fontSize: 9, padding: 0, minWidth: 14 }} onClick={(e) => clickHeader(colWells(plate, c), e)} data-testid={`pe-col-${c + 1}`}>{c + 1}</button></th>)}</tr></thead>
                <tbody>{Array.from({ length: plate.rows }, (_, r) => <tr key={r}>
                  <th><button style={{ fontSize: 9, padding: 0, minWidth: 14 }} onClick={(e) => clickHeader(rowWells(plate, r), e)} data-testid={`pe-row-${ROW_LETTERS[r]}`}>{ROW_LETTERS[r]}</button></th>
                  {Array.from({ length: plate.cols }, (_, c) => {
                    const w = wellId(r, c), n = Object.keys(plate.wells[w] ?? {}).length;
                    return <td key={c} style={{ padding: 1 }}><button data-testid={`well-${w}`} title={attached[w] ? `${w}: ${attached[w]}` : w} style={wellStyle(w)} onClick={(e) => clickWell(w, e)} onContextMenu={(e) => { e.preventDefault(); setMenu({ well: w, x: e.clientX, y: e.clientY }); }}>
                      {attached[w] && <span style={{ position: 'absolute', inset: 2, border: '1px solid #000', borderRadius: '50%' }} data-testid={`well-sample-${w}`} />}
                      <span>{statCol && statVals[w] !== undefined ? formatStat(statVals[w]) : wellText(plate, w)}</span>
                      {plate.showNEntries !== false && n > 0 && <span style={{ position: 'absolute', right: 1, bottom: 0, fontSize: 7 }}>{n}</span>}
                    </button></td>;
                  })}
                </tr>)}</tbody>
              </table>
              {/* Selection Area (PESelectionArea): saved well selections. */}
              <div className="row" data-testid="pe-selections">{st.selections.map((s, i) => <button key={i} onClick={() => setSel(s.wells.filter((w) => allWells(plate).includes(w)))} data-testid={`pe-selection-${i}`}>{s.name}</button>)}</div>
              {/* Staging Area (PEditorStagingArea) */}
              <fieldset data-testid="pe-staging"><legend>Staging Area</legend>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {st.staging.map((s, i) => <div key={i} onClick={(e) => setStagingSel((x) => (e.ctrlKey || e.metaKey ? (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]) : [i]))} style={{ border: `2px solid ${stagingSel.includes(i) ? '#2a7de1' : '#bbb'}`, padding: 4, minWidth: 110, fontSize: 11 }} data-testid={`pe-staging-${i}`}>
                    <b>{s.name}</b><div>{Object.entries(s.attrs).map(([k, v]) => `${k}=${v}`).join('; ') || <span className="muted">&lt;no contents&gt;</span>}</div>
                    <button onClick={(e) => { e.stopPropagation(); const n = window.prompt('Rename', s.name); if (n) edit((x) => { x.staging[i].name = n; }); }}>Rename</button>
                    <button onClick={(e) => { e.stopPropagation(); edit((x) => { x.staging.push({ name: nextStagingName(x.staging), attrs: { ...x.staging[i].attrs } }); }); }} data-testid={`pe-staging-dup-${i}`}>Duplicate</button>
                    <button disabled={!pair} onClick={(e) => { e.stopPropagation(); if (pair) edit((x) => { x.staging[i].attrs[pair.attribute] = pair.value; }); }} data-testid={`pe-staging-addkw-${i}`}>Add keyword</button>
                    <button disabled={!sel.length || !Object.keys(s.attrs).length} onClick={(e) => { e.stopPropagation(); toSel((pl) => sel.forEach((w) => addAttrs(pl, w, s.attrs))); }} data-testid={`pe-staging-apply-${i}`}>Add contents to plate selection</button>
                  </div>)}
                </div>
                <button data-testid="pe-add-staging" onClick={() => edit((x) => { x.staging.push({ name: nextStagingName(x.staging), attrs: {} }); })}>Add Staging Well</button>
                <button data-testid="pe-remove-staging" disabled={!stagingSel.length} onClick={() => { edit((x) => { x.staging = x.staging.filter((_, i) => !stagingSel.includes(i)); }); setStagingSel([]); }}>Remove Staging Well</button>
              </fieldset>
            </div>
            <div style={{ minWidth: 260 }}>
              {/* Keyword table "Keyword/Values - Drag to Wells" (PEditorKeywordTable) */}
              <b>Keyword/Values</b>
              <div className="row"><input placeholder="Attribute" value={attr} onChange={(e) => setAttr(e.target.value)} data-testid="pe-kw-attr" style={{ width: 90 }} /><input placeholder="Value" value={val} onChange={(e) => setVal(e.target.value)} data-testid="pe-kw-value" style={{ width: 70 }} />
                <button data-testid="pe-kw-add" title="Click to add the keyword/value pair." onClick={() => { if (!attr || !val) { setError('Error: keyword/value must not be empty.'); return; } setError(null); edit((s) => addPairs(s, [{ attribute: attr, value: val }])); setKwRow(0); }}>Add</button></div>
              <table className="grid" data-testid="pe-kw-table"><tbody>{st.keywordTable.map((k, i) => <tr key={i} onClick={() => setKwRow(i === kwRow ? null : i)} style={{ background: i === kwRow ? '#cfe0ff' : undefined, cursor: 'pointer' }} data-testid={`pe-kw-row-${i}`}><td>{k.attribute}</td><td>{k.value}</td></tr>)}</tbody></table>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button data-testid="pe-kw-apply" disabled={!pair || !sel.length} title="Add the selected pair to every selected well (FlowJo: drag the pair onto a selected well)" onClick={() => pair && toSel((pl) => sel.forEach((w) => addAttrs(pl, w, { [pair.attribute]: pair.value })))}>Add to selected wells</button>
                <button data-testid="pe-kw-remove" disabled={kwRow === null} title="Clear keyword-value pairs from the table" onClick={() => { edit((s) => { if (kwRow !== null) s.keywordTable.splice(kwRow, 1); }); setKwRow(null); }}>Clear Selected Keywords From Table</button>
                <button data-testid="pe-kw-file" title="Add keyword-value pairs from a CSV file" onClick={() => readFile('.csv,.txt', (t) => edit((s) => addPairs(s, keywordFilePairs(t))))}>Add Keywords From File...</button>
                <button data-testid="pe-clear" disabled={!sel.length} title="Remove the keywords from the selected wells (only the filtered keyword when a keyword filter is set)" onClick={() => toSel((pl) => clearWells(pl, sel, filterIsKey ? filter : undefined))}>Clear Selected Wells</button>
              </div>
              {/* Selected well (PEditorWellDisplayTable) */}
              <b>Keyword/Values - Selected Well</b>
              <div data-testid="pe-well-display">{!single ? <span className="muted">Select a single well</span> : !plate.wells[single] ? <span className="muted">No attributes</span> :
                <table className="grid"><thead><tr><th>Attribute</th><th>Value</th><th>Remove</th></tr></thead><tbody>{Object.entries(plate.wells[single]).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td><td><button title="Remove this keyword from the selected well" onClick={() => toSel((pl) => removeAttr(pl, single, k))} data-testid={`pe-remove-key-${k}`}>x</button></td></tr>)}</tbody></table>}</div>
              <p className="muted" data-testid="pe-plate-ids">Plate ID {plate.plateID} - Experiment ID {plate.experimentID} - {plate.cols * plate.rows} wells - group: {group?.name ?? '-'}</p>
            </div>
          </div>
        </div>
      </div>
      {menu && <div className="ctx-menu" style={{ position: 'fixed', left: menu.x, top: menu.y, background: '#fff', border: '1px solid #999', zIndex: 400, display: 'flex', flexDirection: 'column' }} data-testid="pe-well-menu" onMouseDown={(e) => e.stopPropagation()}>
        <button data-testid="pe-well-add-to-table" onClick={() => { const a = plate.wells[menu.well] ?? {}; edit((s) => addPairs(s, Object.entries(a).map(([attribute, value]) => ({ attribute, value })))); setMenu(null); }}>Add attributes to table</button>
        <button data-testid="pe-well-clear" onClick={() => { toSel((pl) => clearWells(pl, [menu.well])); setMenu(null); }}>Clear attributes</button>
        <button data-testid="pe-well-staging" onClick={() => { const a = { ...(plate.wells[menu.well] ?? {}) }; edit((s) => { s.staging.push({ name: nextStagingName(s.staging), attrs: a }); }); setMenu(null); }}>Create Staging Well from attributes</button>
      </div>}
      {custom && <div className="modal-bg" style={{ zIndex: 300 }}><div className="modal" role="dialog" aria-label="Plate Size Selection" data-testid="pe-dims-dialog">
        <div className="modal-head"><b>Plate Size Selection</b><button onClick={() => setCustom(null)}>x</button></div>
        <div className="modal-body"><p>Select the standard microtitre plate size, or customize the grid to use a partial (or virtual) plate:</p>
          <label># of Columns <input type="number" min={1} max={MAX_COLS} value={custom.cols} onChange={(e) => setCustom({ ...custom, cols: Number(e.target.value) })} data-testid="pe-dims-cols" /></label>{' '}
          <label># of Rows <input type="number" min={1} max={MAX_ROWS} value={custom.rows} onChange={(e) => setCustom({ ...custom, rows: Number(e.target.value) })} data-testid="pe-dims-rows" /></label>
          <div className="row"><button data-testid="pe-dims-ok" disabled={!(custom.cols >= 1 && custom.cols <= MAX_COLS && custom.rows >= 1 && custom.rows <= MAX_ROWS)} onClick={() => { toSel((pl) => setDimensions(pl, custom.cols, custom.rows)); setCustom(null); setSel([]); }}>OK</button><button onClick={() => setCustom(null)}>Cancel</button></div></div></div></div>}
      {series && <div className="modal-bg" style={{ zIndex: 300 }}><div className="modal" role="dialog" aria-label="Fold Dilution Keyword Generator" data-testid="pe-series-dialog">
        <div className="modal-head"><b>Fold Dilution Keyword Generator</b><button onClick={() => setSeries(null)}>x</button></div>
        <div className="modal-body"><p className="muted">Enter the starting concentration, the number of repetitions, and the dilution (as a multiplier) between steps.</p>
          <label>Keyword: <input value={series.attribute} onChange={(e) => setSeries({ ...series, attribute: e.target.value })} data-testid="pe-series-attr" /></label><br />
          <label title="Initial Dilution value for first set of replicates.">Starting Value: <input type="number" value={series.start} onChange={(e) => setSeries({ ...series, start: Number(e.target.value) })} data-testid="pe-series-start" /></label><br />
          <label title="How many samples to repeat before incrementing the value.">Number of Replicates: <input type="number" min={1} value={series.repeats} onChange={(e) => setSeries({ ...series, repeats: Number(e.target.value) })} data-testid="pe-series-repeats" /></label><br />
          <label title="Multiplier to determine value of next set of replicates.">Dilution Multiplier: <input type="number" value={series.multiplier} onChange={(e) => setSeries({ ...series, multiplier: Number(e.target.value) })} data-testid="pe-series-mult" /></label><br />
          <label title="Value which will be added to the next set of replicates in a series.">Sequence Incrementer: <input type="number" value={series.increment} onChange={(e) => setSeries({ ...series, increment: Number(e.target.value) })} data-testid="pe-series-inc" /></label>
          <div className="row"><button data-testid="pe-series-down" onClick={() => { toSel((pl) => dilutionSeries(pl, sel, series, true)); setSeries(null); }}>Fill Down</button><button data-testid="pe-series-right" onClick={() => { toSel((pl) => dilutionSeries(pl, sel, series, false)); setSeries(null); }}>Fill Right</button><button onClick={() => setSeries(null)}>Cancel</button></div></div></div></div>}
      {annotate && <ExperimentDialog initial={p.ws.experiment} docName={p.ws.name} groupNames={p.ws.groups.map((g) => g.name)} figureNames={[...(p.ws.layout?.length ? ['Layout'] : []), ...(p.ws.tables ?? []).map((t) => t.name)]}
        gatingText={() => { const s0 = groupSamples[0]; return s0 ? [s0.fileName, ...s0.populations.map((q) => `  ${populationPath(s0.populations, q.id)}`)].join('\n') : ''; }}
        compText={() => { const s0 = groupSamples[0]; const m = s0 ? p.ws.matrices.find((x) => x.id === s0.compensation) : undefined; return m ? [m.name, `\t${m.channels.join('\t')}`, ...m.values.map((r, i) => `${m.channels[i]}\t${r.join('\t')}`)].join('\n') : ''; }}
        download={p.download} onOk={(e) => { p.updateWs((w, say) => { w.experiment = e; say('info', 'Experiment annotation saved'); }); setAnnotate(false); }} onClose={() => setAnnotate(false)} />}
    </div>
  );
}

