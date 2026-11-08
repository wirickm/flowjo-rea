// FlowJo 10.6.2 table editor (TEditor, TECommand) and the generated table
// window (CalculatedTable, FJTableCommand): docs/validation/ui-gaps/tables.md.
// The rules live in src/core/tableEditor.ts; this file is the UI.
import { useEffect, useMemo, useState } from 'react';
import { CONFIRM } from '../core/prefs';
import { newId, populationPath, uniqueName, type LayoutObject, type StatColumn, type StatKind, type Workspace } from '../core/model';
import { STAT_LABELS, STAT_NEEDS_CHANNEL, validPercentile } from '../core/stats';
import { teTableSpec, TETABLE_NOTE } from '../core/layoutTables';
import {
  acquisitionTime, boxStats, cellStyle, duplicateTable, findRows, headerFromTemplate, headerText, iterate, NAME_TOKENS, OUTPUT_FORMATS, PLOT_SAME_VALUE, plotBlocked, regression,
  statKey, summaryRows, tableCsv, tableHtml, tableOutput, tableRows, tableTab, tableText,
  type ColumnFormat, type OutputFormat, type StatSpec, type TableColumn, type TableDestination, type TableTemplate,
} from '../core/tableEditor';

type Row = { sample: string; sampleId: string; cells: (number | string)[] };
type Cell = number | string;
const show = (v: Cell) => (typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toPrecision(6)) : 'NaN') : v);
const DESTS: [TableDestination, string][] = [['DISPLAY', 'Display'], ['CLIPBOARD', 'To Clipboard'], ['FILE', 'To File'], ['LAYOUT', 'To Current Layout'], ['PRINT', 'To Printer']];
const FORMAT_KINDS = ['none', 'heat', 'stdev', 'range'] as const;
const formatKind = (f?: ColumnFormat) => (f?.heatMap ? 'heat' : f?.stdDev ? 'stdev' : f?.expectedRange ? 'range' : 'none');

export interface TablesDialogProps {
  ws: Workspace; updateWs: (f: (w: Workspace) => void) => void; stats: Record<string, (number | string)[]>;
  colLabel: (c: StatColumn) => string;
  ask: (text: string, choices: string[], key?: string) => Promise<string | null>;
  download: (name: string, data: BlobPart, type?: string) => void; onClose: () => void;
  // Live statistics of a sample for the given columns (the analysis worker).
  statsOf?: (sampleId: string, columns: StatColumn[]) => Promise<(number | string)[] | undefined>;
  loaded?: (sampleId: string) => boolean;
  channels?: string[];
  copyRich?: (html: string, text: string, what: string) => void;
  openSamples?: (sampleIds: string[], popPath: string) => void;
  note?: (level: 'info' | 'warn' | 'error', text: string) => void;
}

export function TablesDialog(p: TablesDialogProps) {
  const { ws, updateWs, colLabel, ask, download, onClose } = p;
  const tables = ws.tables ?? [];
  const [id, setId] = useState<string | null>(tables[0]?.id ?? null);
  const t = tables.find((x) => x.id === id) ?? null;
  const edit = (f: (t: TableTemplate) => void) => updateWs((w) => { const x = w.tables?.find((y) => y.id === id); if (x) f(x); });
  const [kw, setKw] = useState('');
  const [formula, setFormula] = useState('');
  const [sel, setSel] = useState<number[]>([]); // selected columns (rows of the column list)
  const [colDlg, setColDlg] = useState<null | { index: number | null }>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [hf, setHf] = useState<null | { header: string; footer: string }>(null);
  const [win, setWin] = useState(false);
  const [plot, setPlot] = useState<null | { kind: 'box' | 'corr' | 'time'; cols: number[]; transpose: boolean }>(null);
  useEffect(() => { setSel([]); setWin(false); setPlot(null); }, [id]);

  // Statistic specs per column (older columns: their Statistics-panel column).
  const specOf = (c: TableColumn): StatSpec | null => {
    if (c.kind !== 'statistic') return null;
    if (c.stat) return c.stat;
    const s = ws.statColumns.find((x) => x.id === c.statColumnId);
    if (!s) return null;
    const { id: _id, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  };
  const specs = (t?.columns ?? []).map(specOf);
  const specsKey = JSON.stringify(specs);
  const loadedKey = ws.samples.map((s) => `${s.id}:${p.loaded?.(s.id) ? 1 : 0}`).join(',');
  const [vals, setVals] = useState<Record<string, Record<string, Cell>>>({});
  useEffect(() => {
    if (!p.statsOf) return;
    const cols = specs.map((s, k) => (s ? { ...s, id: `#${k}` } : null)).filter((x): x is StatColumn => !!x);
    setVals({});
    if (!cols.length) return;
    let live = true;
    const timer = setTimeout(() => {
      for (const s of ws.samples) {
        if (p.loaded && !p.loaded(s.id)) continue;
        void p.statsOf!(s.id, cols).then((v) => { if (live && v) setVals((x) => ({ ...x, [s.id]: Object.fromEntries(cols.map((c, i) => [c.id, v[i]])) })); });
      }
    }, 100);
    return () => { live = false; clearTimeout(timer); };
  }, [specsKey, loadedKey, ws.samples, ws.matrices, ws.derivedParameters, ws.channelTransforms]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRows = (): Row[] => {
    if (!t) return [];
    const src = ws.samples.map((s) => ({
      sample: s.fileName, sampleId: s.id, keywords: s.keywordsSnapshot,
      stats: p.statsOf ? (vals[s.id] ?? {}) : Object.fromEntries(t.columns.map((c, k) => [statKey(c, k), p.stats[s.id]?.[ws.statColumns.findIndex((x) => c.kind === 'statistic' && x.id === c.statColumnId)] ?? NaN])),
    }));
    const groups = iterate(src, t.iteration, (r, k) => r.keywords[k.toUpperCase()] ?? r.keywords[k]);
    const flat = groups.flatMap((g) => g.items.map((r) => (t.iteration.type === 'SAMPLE' ? r : { ...r, sample: `${g.label}: ${r.sample}` })));
    return tableRows(t, flat).map((r, i) => ({ ...r, sampleId: flat[i].sampleId }));
  };
  const data = allRows();
  const withSummary = (rs: Row[]): Row[] => (t?.summary ? [...rs, ...summaryRows(rs, t.columns.length).map((r) => ({ ...r, sampleId: '' }))] : rs);
  const preview = withSummary(data);

  // Keyword lists (ColumnInfoTTPane: File Keywords and Parameter Keywords).
  const keywords = useMemo(() => {
    const ks = new Set<string>();
    for (const s of ws.samples) for (const k of Object.keys(s.keywordsSnapshot ?? {})) ks.add(k);
    const all = [...ks].sort();
    return { file: all.filter((k) => !/^\$P\d+[A-Z]+$/.test(k)), parm: all.filter((k) => /^\$P\d+[A-Z]+$/.test(k)) };
  }, [ws.samples]);
  const kw0 = ws.samples[0]?.keywordsSnapshot ?? {};
  const stainOf = (ch?: string) => { if (!ch) return ''; const n = Object.keys(kw0).find((k) => /^\$P\d+N$/.test(k) && kw0[k] === ch); return n ? kw0[n.replace(/N$/, 'S')] ?? '' : ''; };
  const autoHeader = (s: StatSpec, template = t?.autoColumnName) => (template ? headerFromTemplate(template, s, s.stat === 'freqOf' ? 'Freq. of' : STAT_LABELS[s.stat], stainOf(s.channel)) : colLabel({ ...s, id: '' }));

  const add = (c: TableColumn) => edit((x) => { x.columns.push(c); });
  const toggleSel = (k: number, multi: boolean) => setSel((s) => (multi ? (s.includes(k) ? s.filter((x) => x !== k) : [...s, k].sort((a, b) => a - b)) : [k]));
  const setFormat = (kind: typeof FORMAT_KINDS[number], range?: { min: number; max: number }) => edit((x) => {
    for (const k of sel) {
      const c = x.columns[k]; if (!c) continue;
      const bold = c.format?.bold;
      c.format = { ...(bold ? { bold } : {}), ...(kind === 'heat' ? { heatMap: true } : kind === 'stdev' ? { stdDev: true } : kind === 'range' ? { expectedRange: range ?? c.format?.expectedRange ?? { min: 0, max: 100 } } : {}) };
    }
  });
  const selFormat = sel.length ? formatKind(t?.columns[sel[0]]?.format) : 'none';
  const selRange = sel.length ? t?.columns[sel[0]]?.format?.expectedRange : undefined;

  const outFormat: OutputFormat = t?.outputFormat ?? 'CSV';
  const dest: TableDestination = t?.destination ?? 'DISPLAY';
  const copyTable = (rows: Row[], html = false) => {
    if (!t) return;
    const body = tableHtml(t, rows, { bodyOnly: true, data: Math.min(rows.length, data.length) });
    p.copyRich?.(body, html ? body : tableTab(t, rows), html ? 'Table (HTML)' : 'Table');
  };
  const printTable = (rows: Row[]) => {
    if (!t) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = tableHtml(t, rows, { data: data.length })
      .replace('<body>\n', `<body>\n${t.header ? `<div data-testid="print-header">${esc(t.header)}</div>` : ''}`)
      .replace('</body>', `${t.footer ? `<div data-testid="print-footer">${esc(t.footer)}</div>` : ''}</body>`);
    const w = window.open('', '_blank');
    if (!w) { p.note?.('error', 'The print window was blocked'); return; }
    w.document.write(html); w.document.close();
    w.setTimeout(() => w.print(), 300);
  };
  // Add to Layout / Batch To Current Layout (FJTableAction.addToLayout,
  // FigTableDisplay.install): a table figure with the header and the rows'
  // values and format colours, at (40, 40); not live (te.calculated.table.notifystatic).
  const toLayout = (rows: Row[]) => {
    if (!t) return;
    const nd = Math.min(rows.length, data.length);
    const styles = rows.map((r, i) => r.cells.map((v, k) => { if (i >= nd) return null; const st = cellStyle(t.columns[k]?.format, v, rows.slice(0, nd).map((x) => x.cells[k])); return st.background || st.color || st.bold || st.italic || st.arrow ? st : null; }));
    const item: LayoutObject = { id: newId('lay'), object: teTableSpec(t.name, t.columns.map((c) => headerText(c.header)), rows, styles), left: 40, top: 40 };
    updateWs((w) => { w.layout = [...(w.layout ?? []), item]; });
    p.note?.('info', TETABLE_NOTE);
  };
  // Create Table (TEBatchAction MAKEBATCH, TableFactory.makeTable).
  const createTable = () => {
    if (!t) return;
    if (dest === 'DISPLAY') setWin(true);
    else if (dest === 'CLIPBOARD') copyTable(preview);
    else if (dest === 'FILE') download(`${t.name}.${OUTPUT_FORMATS[outFormat].ext}`, tableOutput(t, preview, outFormat, data.length), OUTPUT_FORMATS[outFormat].type);
    else if (dest === 'LAYOUT') toLayout(preview);
    else printTable(preview);
  };
  const doPlot = (kind: 'box' | 'corr' | 'time') => {
    if (!t) return;
    const cols = sel.filter((k) => t.columns[k]);
    if (!cols.length || (kind === 'corr' && cols.length < 2)) { p.note?.('warn', kind === 'corr' ? 'Select two columns to plot their correlation' : 'Select the columns to plot'); return; }
    if (plotBlocked(cols.map((k) => data.map((r) => Number(r.cells[k]))))) { p.note?.('warn', PLOT_SAME_VALUE); void ask(PLOT_SAME_VALUE, ['OK']); return; }
    setPlot({ kind, cols: kind === 'corr' ? cols.slice(0, 2) : cols, transpose: false });
  };
  const describe = (c: TableColumn) => {
    const s = specOf(c);
    if (c.kind === 'statistic') return s ? [s.populationPath || 'All events', s.stat === 'freqOf' ? `Freq. of ${s.ancestor ?? ''}` : `${s.stat === 'percentile' ? `${s.percentile} ` : ''}${STAT_LABELS[s.stat]}`, s.channel ? `${s.channel}${s.correlate ? ` vs ${s.correlate}` : ''}` : ''] : ['(missing)', '', ''];
    return c.kind === 'keyword' ? ['', `Keyword ${c.keyword}`, ''] : ['', `Formula ${c.formula}`, ''];
  };

  return (
    <div className="modal-bg"><div className="modal wide" style={{ width: 'min(1200px, 96vw)' }} role="dialog" aria-label="Table editor" data-testid="tables-dialog"><div className="modal-body">
      <h3>Table editor</h3>
      <div className="row">
        <select data-testid="table-select" value={id ?? ''} onChange={(e) => setId(e.target.value || null)}>
          <option value="">(none)</option>{tables.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button data-testid="table-new" title="Create: Click to add a new table." onClick={() => { const nid = `tbl-${Date.now()}`; updateWs((w) => { w.tables = [...(w.tables ?? []), { id: nid, name: uniqueName('Table', (w.tables ?? []).map((x) => x.name)), columns: [], iteration: { type: 'SAMPLE' } }]; }); setId(nid); }}>New table</button>
        {t && <button data-testid="table-duplicate" title="Duplicate: make another report starting from this one." onClick={() => { const nid = `tbl-${Date.now()}`; updateWs((w) => { const src = w.tables?.find((x) => x.id === id); if (src) w.tables = [...(w.tables ?? []), duplicateTable(src, nid, uniqueName(src.name, (w.tables ?? []).map((x) => x.name)))]; }); setId(nid); }}>Duplicate</button>}
        {t && <button data-testid="table-delete" onClick={async () => { if ((await ask(CONFIRM.table.text, ['Delete'], CONFIRM.table.key)) !== 'Delete') return; updateWs((w) => { w.tables = (w.tables ?? []).filter((x) => x.id !== id); }); setId(null); }}>Delete table</button>}
        {t && <label>Name <input data-testid="table-name" value={t.name} onChange={(e) => edit((x) => { x.name = e.target.value; })} /></label>}
      </div>
      {t && <>
        <fieldset><legend>Columns</legend>
          <button data-testid="table-add-column" title="Add a column of information to this table template" onClick={() => setColDlg({ index: null })}>Add Column...</button>
          <select data-testid="table-add-stat" value="" title="Add a Statistics-panel column" onChange={(e) => { const c = ws.statColumns.find((x) => x.id === e.target.value); if (c) { const { id: _i, ...s } = c; add({ kind: 'statistic', header: autoHeader(s), stat: s }); } }}>
            <option value="">Add statistic column...</option>{ws.statColumns.map((c) => <option key={c.id} value={c.id}>{colLabel(c)}</option>)}
          </select>
          <input placeholder="keyword" data-testid="table-kw" value={kw} onChange={(e) => setKw(e.target.value)} list="table-kw-list" />
          <datalist id="table-kw-list">{[...keywords.file, ...keywords.parm].map((k) => <option key={k} value={k} />)}</datalist>
          <select data-testid="table-kw-popup" value="" title="Keywords: include FCS or custom keywords from the sample files into the table" onChange={(e) => { if (e.target.value) add({ kind: 'keyword', header: e.target.value, keyword: e.target.value }); }}>
            <option value="">Keywords...</option>{keywords.file.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select data-testid="table-parmkw-popup" value="" title="Add Parameter Keyword: a column based on a parameter specific keyword" onChange={(e) => { if (e.target.value) add({ kind: 'keyword', header: e.target.value, keyword: e.target.value }); }}>
            <option value="">Parameter keywords...</option>{keywords.parm.map((k) => <option key={k} value={k}>{k}{kw0[k] ? ` (${kw0[k]})` : ''}</option>)}
          </select>
          <button data-testid="table-add-kw" disabled={!kw.trim()} onClick={() => { add({ kind: 'keyword', header: kw.trim(), keyword: kw.trim() }); setKw(''); }}>Add keyword</button>
          <input placeholder="formula over column headers" data-testid="table-formula" value={formula} onChange={(e) => setFormula(e.target.value)} />
          <button data-testid="table-add-formula" disabled={!formula.trim()} onClick={() => { add({ kind: 'formula', header: formula.trim(), formula: formula.trim() }); setFormula(''); }}>Add formula</button>
          <div className="row">
            <button data-testid="table-edit-column" disabled={!sel.length} title="Edit the current column information." onClick={() => setColDlg({ index: sel[0] })}>Edit Column...</button>
            <button data-testid="table-select-all" disabled={!t.columns.length} title="Select all of the rows in the table." onClick={() => setSel(t.columns.map((_, k) => k))}>Select All</button>
            <button data-testid="table-clear" disabled={!sel.length} title="Remove the selected rows from the table." onClick={async () => {
              if ((await ask('Do you want to delete this column from resultant tables?', ['Delete'])) !== 'Delete') return;
              const drop = new Set(sel); edit((x) => { x.columns = x.columns.filter((_, k) => !drop.has(k)); }); setSel([]);
            }}>Clear</button>
            <button data-testid="table-col-names" disabled={!t.columns.length} title="Create column names automatically." onClick={() => setNaming(t.autoColumnName ?? '')}>Create Column Names</button>
          </div>
          <table className="grid" data-testid="table-columns"><thead><tr><th />{['Name', 'Population', 'Statistic / source', 'Parameter', 'Format'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{t.columns.map((c, k) => {
              const [pop, st, par] = describe(c);
              return (
                <tr key={k} className={sel.includes(k) ? 'sel' : ''} data-testid={`table-col-${k}`} onClick={(e) => toggleSel(k, e.ctrlKey || e.metaKey || e.shiftKey)} onDoubleClick={() => { setSel([k]); setColDlg({ index: k }); }}>
                  <td><input type="checkbox" aria-label="select column" checked={sel.includes(k)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(k, true)} /></td>
                  <td>{headerText(c.header)}</td><td>{pop}</td><td>{st}</td><td>{par}</td><td>{formatKind(c.format) === 'none' ? '' : formatKind(c.format)}</td>
                </tr>
              );
            })}</tbody></table>
        </fieldset>
        <fieldset><legend>Formatting (selected columns)</legend>
          {([['none', 'None'], ['heat', 'Heat Map'], ['stdev', 'Standard Deviation'], ['range', 'Expected Range']] as const).map(([k, l]) => (
            <label key={k} title={k === 'heat' ? 'Set the background color of table cells to display distribution information (blue - yellow).' : k === 'stdev' ? 'Use the values deviation from the column mean to set formatting, highlighting outliers.' : k === 'range' ? 'Compare the value to a minimum and maximum.' : ''}>
              <input type="radio" name="table-format" data-testid={`table-format-${k}`} disabled={!sel.length} checked={selFormat === k} onChange={() => setFormat(k)} /> {l}
            </label>
          ))}
          {selFormat === 'range' && <>
            {' '}min <input type="number" data-testid="table-range-min" style={{ width: 70 }} value={selRange?.min ?? 0} onChange={(e) => setFormat('range', { min: Number(e.target.value), max: selRange?.max ?? 100 })} />
            {' '}max <input type="number" data-testid="table-range-max" style={{ width: 70 }} value={selRange?.max ?? 100} onChange={(e) => setFormat('range', { min: selRange?.min ?? 0, max: Number(e.target.value) })} />
          </>}
        </fieldset>
        <fieldset><legend>Iteration</legend>
          Iterate by <select data-testid="table-iter" value={t.iteration.type} onChange={(e) => edit((x) => { x.iteration = { ...x.iteration, type: e.target.value as TableTemplate['iteration']['type'] }; })}>
            <option value="SAMPLE">Sample</option><option value="KEYWORD">Keyword</option><option value="PANEL">Panel</option>
          </select>
          {t.iteration.type === 'KEYWORD' && <input data-testid="table-iter-kw" placeholder="keyword" value={t.iteration.keyword ?? ''} onChange={(e) => edit((x) => { x.iteration.keyword = e.target.value; })} />}
          {t.iteration.type === 'PANEL' && <input type="number" min={1} data-testid="table-iter-panel" value={t.iteration.panelSize ?? 1} onChange={(e) => edit((x) => { x.iteration.panelSize = Number(e.target.value) || 1; })} />}
          <label><input type="checkbox" data-testid="table-summary" checked={!!t.summary} onChange={(e) => edit((x) => { x.summary = e.target.checked; })} /> Show Summary Stats</label>
        </fieldset>
        <fieldset><legend>Output</legend>
          Output Target <select data-testid="table-dest" value={dest} onChange={(e) => edit((x) => { x.destination = e.target.value as TableDestination; })}>{DESTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {' '}File Type: <select data-testid="table-format" value={outFormat} onChange={(e) => edit((x) => { x.outputFormat = e.target.value as OutputFormat; })}>{(Object.keys(OUTPUT_FORMATS) as OutputFormat[]).map((k) => <option key={k} value={k}>{OUTPUT_FORMATS[k].label}</option>)}</select>
          {' '}<button data-testid="table-create" className="active" title="Create Table" onClick={createTable}>Create Table</button>
          {' '}<button data-testid="table-headfoot" title="Edit the information that appears in your table print outs." onClick={() => setHf({ header: t.header ?? '', footer: t.footer ?? '' })}>Edit Header / Footer</button>
          {' '}<button data-testid="table-csv" onClick={() => download(`${t.name}.csv`, tableCsv(t, preview), 'text/csv')}>CSV</button>
          <button data-testid="table-tab" onClick={() => download(`${t.name}.txt`, tableTab(t, preview), 'text/plain')}>TAB</button>
          <button data-testid="table-html" onClick={() => download(`${t.name}.html`, tableHtml(t, preview, { data: data.length }), 'text/html')}>HTML</button>
        </fieldset>
        <fieldset><legend>Plots (selected columns)</legend>
          <button data-testid="table-plot-box" title="A plot which marks median, mean, Q1-Q3 spread and outliers." onClick={() => doPlot('box')}>Box-n-Whisker Plot</button>
          <button data-testid="table-plot-corr" title="A two dimensional correlation of two parameters." onClick={() => doPlot('corr')}>Correlation</button>
          <button data-testid="table-plot-time" title="A one dimensional tracking of a parameter over time, often for QC purposes." onClick={() => doPlot('time')}>Time Series</button>
        </fieldset>
        <TableGrid t={t} rows={preview} nData={data.length} testid="table-preview" />
        {plot && <TablePlot t={t} rows={data} ws={ws} plot={plot} setPlot={setPlot} download={download} />}
        {win && <TableWindow t={t} data={data} withSummary={withSummary} onClose={() => setWin(false)} copyTable={copyTable} printTable={printTable} toLayout={toLayout}
          download={download} ask={ask} toggleSummary={() => edit((x) => { x.summary = !x.summary; })}
          makeGroup={(name, ids) => { updateWs((w) => { w.groups.push({ id: newId('grp'), name: uniqueName(name, w.groups.map((g) => g.name)), sampleIds: ids }); }); p.note?.('info', `Created group ${name}`); }}
          openSamples={(ids) => p.openSamples?.(ids, specs.find((s) => s)?.populationPath ?? '')} />}
      </>}
      {colDlg && t && <ColumnDialog ws={ws} channels={p.channels?.length ? p.channels : Object.keys(kw0).filter((k) => /^\$P\d+N$/.test(k)).sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2))).map((k) => kw0[k])}
        keywords={keywords} column={colDlg.index === null ? null : t.columns[colDlg.index]} spec={colDlg.index === null ? null : specs[colDlg.index]} autoHeader={autoHeader}
        onCancel={() => setColDlg(null)} onOk={(c) => { const i = colDlg.index; edit((x) => { if (i === null) x.columns.push(c); else x.columns[i] = { ...c, format: x.columns[i].format }; }); setColDlg(null); }} />}
      {naming !== null && t && (
        <div className="modal-bg"><div className="modal" role="dialog" aria-label="Column Header Naming" data-testid="table-naming-dialog"><div className="modal-body">
          <h3>Column Header Naming</h3>
          <div>Template (edit text to customize the column header)</div>
          <textarea data-testid="table-naming-template" value={naming} onChange={(e) => setNaming(e.target.value)} style={{ width: '100%', minHeight: 50 }} />
          <select data-testid="table-naming-token" value="" onChange={(e) => { if (e.target.value) setNaming(`${naming}'${e.target.value}'`); }}>
            <option value="">{'< Add To Column Header >'}</option>{NAME_TOKENS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <div>Preview: <span data-testid="table-naming-preview">{(() => { const s = specs.find((x) => x); return s ? autoHeader(s, naming || undefined) : ''; })()}</span></div>
          <button data-testid="table-naming-clear" onClick={() => setNaming('')}>Clear</button>
          <button data-testid="table-naming-ok" onClick={() => { const tpl = naming; edit((x) => { x.autoColumnName = tpl || undefined; x.columns.forEach((c, k) => { const s = specs[k]; if (c.kind === 'statistic' && s) c.header = autoHeader(s, tpl || undefined); }); }); setNaming(null); }}>OK</button>
          <button data-testid="table-naming-cancel" onClick={() => setNaming(null)}>Cancel</button>
        </div></div></div>
      )}
      {hf && t && (
        <div className="modal-bg"><div className="modal" role="dialog" aria-label="Header / Footer" data-testid="table-hf-dialog"><div className="modal-body">
          <h3>Header / Footer</h3>
          <label>Header <input data-testid="table-hf-header" value={hf.header} onChange={(e) => setHf({ ...hf, header: e.target.value })} style={{ width: '80%' }} /></label><br />
          <label>Footer <input data-testid="table-hf-footer" value={hf.footer} onChange={(e) => setHf({ ...hf, footer: e.target.value })} style={{ width: '80%' }} /></label><br />
          <button data-testid="table-hf-ok" onClick={() => { const v = hf; edit((x) => { x.header = v.header || undefined; x.footer = v.footer || undefined; }); setHf(null); }}>OK</button>
          <button onClick={() => setHf(null)}>Cancel</button>
        </div></div></div>
      )}
      <div><button data-testid="tables-close" onClick={onClose}>Close</button></div>
    </div></div></div>
  );
}

// A table with the column formats applied (heat map, SD, expected range).
function TableGrid({ t, rows, nData, testid, selected, onRow }: { t: TableTemplate; rows: Row[]; nData: number; testid: string; selected?: Set<number>; onRow?: (i: number, e: React.MouseEvent) => void }) {
  return (
    <table className="grid" data-testid={testid}><thead><tr><th />{t.columns.map((c, k) => <th key={k}>{headerText(c.header)}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => (
        <tr key={i} className={selected?.has(i) ? 'sel' : ''} data-testid={`${testid}-row-${i}`} onClick={onRow && i < nData ? (e) => onRow(i, e) : undefined}>
          <td>{row.sample}</td>
          {row.cells.map((v, k) => {
            const st = i < nData ? cellStyle(t.columns[k]?.format, v, rows.slice(0, nData).map((x) => x.cells[k])) : {};
            return <td key={k} data-arrow={st.arrow} style={{ textAlign: 'right', background: st.background, color: st.color, fontWeight: st.bold ? 'bold' : undefined, fontStyle: st.italic ? 'italic' : undefined }}>{st.arrow === 'up' ? '▲ ' : st.arrow === 'down' ? '▼ ' : ''}{show(v)}</td>;
          })}
        </tr>
      ))}</tbody></table>
  );
}

// The generated table window (CalculatedTable / FJTableActionManager): live
// values, row selection, Find, Delete Selected Rows, groups, samples, copy.
function TableWindow({ t, data, withSummary, onClose, copyTable, printTable, toLayout, download, ask, toggleSummary, makeGroup, openSamples }: {
  t: TableTemplate; data: Row[]; withSummary: (r: Row[]) => Row[]; onClose: () => void;
  copyTable: (rows: Row[], html?: boolean) => void; printTable: (rows: Row[]) => void; toLayout: (rows: Row[]) => void;
  download: (name: string, data: BlobPart, type?: string) => void; ask: (text: string, choices: string[], key?: string) => Promise<string | null>;
  toggleSummary: () => void; makeGroup: (name: string, sampleIds: string[]) => void; openSamples: (sampleIds: string[]) => void;
}) {
  const [omitted, setOmitted] = useState<string[]>([]); // TableData.omit: by row name
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [find, setFind] = useState<string | null>(null);
  const [lastFind, setLastFind] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const rows = data.filter((r) => !omitted.includes(r.sample));
  const shown = withSummary(rows);
  const onRow = (i: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor !== null) { const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; setSel(new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k))); return; }
    if (e.ctrlKey || e.metaKey) { const s = new Set(sel); if (s.has(i)) s.delete(i); else s.add(i); setSel(s); setAnchor(i); return; }
    setSel(new Set([i])); setAnchor(i);
  };
  const selIds = [...new Set([...sel].sort((a, b) => a - b).map((i) => rows[i]?.sampleId).filter(Boolean))];
  return (
    <div className="panel" data-testid="table-window" style={{ border: '1px solid #c9d0dc', marginTop: 8, padding: 6 }}>
      <div className="row"><b>{t.name}</b> <span className="muted">{rows.length} rows, live</span></div>
      <div className="row">
        <button data-testid="tw-copy" title="Place this table onto the system clipboard for export to other programs." onClick={() => copyTable(shown)}>Copy Table to Clipboard</button>
        <button data-testid="tw-copy-html" title="Make an HTML (web browser friendly) table on the system clipboard." onClick={() => copyTable(shown, true)}>Copy As HTML</button>
        <button data-testid="tw-select-all" title="Select all rows in the table." onClick={() => setSel(new Set(rows.map((_, i) => i)))}>Select All</button>
        <button data-testid="tw-select-none" title="Deselect all rows in the table." onClick={() => setSel(new Set())}>Select None</button>
        <button data-testid="tw-delete" disabled={!sel.size} title="Remove the currently selected rows from the table, and recalculate summary statistics based on their absence." onClick={async () => {
          if ((await ask(sel.size > 1 ? 'Remove the selected rows from the tables?' : 'Remove the selected row from the tables?', ['Remove'])) !== 'Remove') return;
          setOmitted([...omitted, ...[...sel].map((i) => rows[i].sample)]); setSel(new Set());
        }}>Delete Selected Rows</button>
        <button data-testid="tw-find" title="Enter text and select all rows in the table that contain that text in any column." onClick={() => setFind(lastFind)}>Find</button>
        <button data-testid="tw-group" disabled={!selIds.length} title="Make a new group in the workspace that contains all selected rows in this table" onClick={() => setGroup('My group')}>Create Group from Selection</button>
        <button data-testid="tw-open" disabled={!selIds.length} onClick={() => openSamples(selIds)}>Open Selected Samples</button>
        <button data-testid="tw-summary" className={t.summary ? 'active' : ''} title="Select to show summary statistics appended to the end of this table" onClick={toggleSummary}>Show Summary Stats</button>
        <button data-testid="tw-layout" title="Copy this table into the current layout in the layout editor." onClick={() => toLayout(shown)}>Add to Layout</button>
        <button data-testid="tw-save" onClick={() => download(`${t.name}.${OUTPUT_FORMATS[t.outputFormat ?? 'CSV'].ext}`, tableOutput(t, shown, t.outputFormat ?? 'CSV', rows.length), OUTPUT_FORMATS[t.outputFormat ?? 'CSV'].type)}>Save As...</button>
        <button data-testid="tw-print" title="Prepare a hard copy output of this generated table." onClick={() => printTable(shown)}>Print...</button>
        <button data-testid="tw-close" title="Close this generated table." onClick={onClose}>Close</button>
      </div>
      {find !== null && (
        <div className="row" data-testid="tw-find-prompt">Please enter the text to find in the table:
          <input data-testid="tw-find-text" autoFocus value={find} onChange={(e) => setFind(e.target.value)} />
          <button data-testid="tw-find-ok" onClick={() => { const r = findRows(rows, find); setLastFind(find); setFind(null); if (r) setSel(new Set(r)); }}>OK</button>
          <button onClick={() => setFind(null)}>Cancel</button>
        </div>
      )}
      {group !== null && (
        <div className="row" data-testid="tw-group-prompt">What is the group named?
          <input data-testid="tw-group-name" autoFocus value={group} onChange={(e) => setGroup(e.target.value)} />
          <button data-testid="tw-group-ok" disabled={!group.trim()} onClick={() => { makeGroup(group.trim(), selIds); setGroup(null); }}>OK</button>
          <button onClick={() => setGroup(null)}>Cancel</button>
        </div>
      )}
      <TableGrid t={t} rows={shown} nData={rows.length} testid="tw-table" selected={sel} onRow={onRow} />
    </div>
  );
}

// Table plots (TEPlotAction): Box-n-Whisker, Correlation (with Transpose
// Axes and Save as...), Time Series. Drawn as SVG.
function TablePlot({ t, rows, ws, plot, setPlot, download }: { t: TableTemplate; rows: Row[]; ws: Workspace; plot: { kind: 'box' | 'corr' | 'time'; cols: number[]; transpose: boolean }; setPlot: (p: null | { kind: 'box' | 'corr' | 'time'; cols: number[]; transpose: boolean }) => void; download: (name: string, data: BlobPart, type?: string) => void }) {
  const W = 520, H = 320, L = 60, R = 16, T = 24, B = 48;
  const col = (k: number) => rows.map((r) => Number(r.cells[k]));
  const hdr = (k: number) => headerText(t.columns[k].header);
  const scale = (lo: number, hi: number, a: number, b: number) => { if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; } const d = hi > lo ? hi - lo : 1; return (v: number) => a + ((v - lo) / d) * (b - a); };
  const ticks = (lo: number, hi: number) => (Number.isFinite(lo) && Number.isFinite(hi) ? [lo, (lo + hi) / 2, hi] : []);
  let body: React.ReactNode = null, info = '';
  if (plot.kind === 'box') {
    const bs = plot.cols.map((k) => boxStats(col(k)));
    const all = bs.flatMap((b) => (b ? [b.lo, b.hi, ...b.outliers, ...b.farOut] : []));
    const lo = Math.min(...all), hi = Math.max(...all);
    const y = scale(lo, hi, H - B, T);
    const bw = (W - L - R) / plot.cols.length;
    body = <>{bs.map((b, i) => { if (!b) return null; const cx = L + bw * (i + 0.5), w = Math.min(40, bw * 0.5); return (
      <g key={i} data-testid={`box-${i}`}>
        <line x1={cx} x2={cx} y1={y(b.lo)} y2={y(b.q1)} stroke="#333" /><line x1={cx} x2={cx} y1={y(b.q3)} y2={y(b.hi)} stroke="#333" />
        <line x1={cx - w / 4} x2={cx + w / 4} y1={y(b.lo)} y2={y(b.lo)} stroke="#333" /><line x1={cx - w / 4} x2={cx + w / 4} y1={y(b.hi)} y2={y(b.hi)} stroke="#333" />
        <rect x={cx - w / 2} y={y(b.q3)} width={w} height={Math.max(1, y(b.q1) - y(b.q3))} fill="#8fb0e8" stroke="#333" />
        <line x1={cx - w / 2} x2={cx + w / 2} y1={y(b.median)} y2={y(b.median)} stroke="#000" strokeWidth={2} />
        <circle cx={cx} cy={y(b.mean)} r={3} fill="none" stroke="#000" />
        {b.outliers.map((v, j) => <circle key={j} cx={cx} cy={y(v)} r={2.5} fill="none" stroke="#c00" />)}
        {b.farOut.map((v, j) => <path key={j} d={`M${cx - 3},${y(v) + 3}l3,-6l3,6z`} fill="none" stroke="#c00" />)}
        <text x={cx} y={H - B + 14} fontSize={10} textAnchor="middle">{hdr(plot.cols[i]).slice(0, 30)}</text>
      </g>); })}
      {ticks(lo, hi).map((v, i) => <text key={i} x={L - 4} y={y(v) + 3} fontSize={9} textAnchor="end">{+v.toPrecision(4)}</text>)}</>;
    info = bs.map((b, i) => (b ? `${hdr(plot.cols[i])}: median ${+b.median.toPrecision(5)}, mean ${+b.mean.toPrecision(5)}, Q1 ${+b.q1.toPrecision(5)}, Q3 ${+b.q3.toPrecision(5)}` : '')).join('; ');
  } else {
    let xs: number[], ys: number[], xl: string, yl: string;
    if (plot.kind === 'corr') {
      const [a, b] = plot.transpose ? [plot.cols[1], plot.cols[0]] : plot.cols;
      xs = col(a); ys = col(b); xl = hdr(a); yl = hdr(b);
      const r = regression(xs, ys);
      info = `R: ${+r.r.toPrecision(4)}  Slope: ${+r.slope.toPrecision(4)}  Intercept: ${+r.intercept.toPrecision(4)}`;
    } else {
      const times = rows.map((r) => acquisitionTime(ws.samples.find((s) => s.id === r.sampleId)?.keywordsSnapshot ?? {}));
      const useTime = times.every((x) => x !== null);
      xs = useTime ? times.map((x) => x as number) : rows.map((_, i) => i + 1);
      ys = []; xl = useTime ? 'Acquisition time ($DATE $BTIM)' : 'Row'; yl = plot.cols.map(hdr).join(', ');
      const ok = xs.filter(Number.isFinite);
      info = useTime && ok.length ? `Start Time: ${new Date(Math.min(...ok)).toLocaleString()}  End Time: ${new Date(Math.max(...ok)).toLocaleString()}` : '';
    }
    const series = plot.kind === 'corr' ? [ys] : plot.cols.map(col);
    const fin = (a: number[]) => a.filter(Number.isFinite);
    const xlo = Math.min(...fin(xs)), xhi = Math.max(...fin(xs));
    const allY = series.flatMap(fin); const ylo = Math.min(...allY), yhi = Math.max(...allY);
    const x = scale(xlo, xhi, L, W - R), y = scale(ylo, yhi, H - B, T);
    const colors = ['#2a4f9c', '#c0392b', '#27ae60', '#8e44ad', '#d35400'];
    const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    body = <>
      {series.map((s, si) => <g key={si} data-testid={`series-${si}`}>
        {plot.kind === 'time' && <polyline fill="none" stroke={colors[si % 5]} points={order.filter((i) => Number.isFinite(s[i])).map((i) => `${x(xs[i])},${y(s[i])}`).join(' ')} />}
        {xs.map((xv, i) => (Number.isFinite(xv) && Number.isFinite(s[i]) ? <circle key={i} cx={x(xv)} cy={y(s[i])} r={3} fill={colors[si % 5]} /> : null))}
      </g>)}
      {plot.kind === 'corr' && (() => { const r = regression(xs, ys); return <line data-testid="regression-line" x1={x(xlo)} y1={y(r.intercept + r.slope * xlo)} x2={x(xhi)} y2={y(r.intercept + r.slope * xhi)} stroke="#000" strokeDasharray="4 3" />; })()}
      {ticks(ylo, yhi).map((v, i) => <text key={i} x={L - 4} y={y(v) + 3} fontSize={9} textAnchor="end">{+v.toPrecision(4)}</text>)}
      {plot.kind === 'corr' && ticks(xlo, xhi).map((v, i) => <text key={i} x={x(v)} y={H - B + 12} fontSize={9} textAnchor="middle">{+v.toPrecision(4)}</text>)}
      <text x={(L + W - R) / 2} y={H - 8} fontSize={10} textAnchor="middle">{xl}</text>
      <text x={12} y={(T + H - B) / 2} fontSize={10} textAnchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>{yl.slice(0, 50)}</text>
    </>;
  }
  const title = plot.kind === 'box' ? 'Box-n-Whisker Plot' : plot.kind === 'corr' ? 'Correlation' : 'Time Series';
  const svgId = `table-plot-svg-${t.id}`;
  return (
    <div className="panel" data-testid="table-plot" data-kind={plot.kind} style={{ border: '1px solid #c9d0dc', marginTop: 8, padding: 6 }}>
      <div className="row"><b>{title}</b>
        {plot.kind === 'corr' && <button data-testid="table-plot-transpose" title="Swap the X and Y axes." onClick={() => setPlot({ ...plot, transpose: !plot.transpose })}>Transpose Axes</button>}
        <button data-testid="table-plot-save" title="Open a dialog to save the current plot to an output format." onClick={() => { const el = document.getElementById(svgId); if (el) download(`${t.name} ${title}.svg`, new XMLSerializer().serializeToString(el), 'image/svg+xml'); }}>Save as...</button>
        <button data-testid="table-plot-close" onClick={() => setPlot(null)}>Close</button>
      </div>
      <svg id={svgId} xmlns="http://www.w3.org/2000/svg" width={W} height={H} style={{ background: '#fff' }}>
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="none" stroke="#999" />
        {body}
      </svg>
      <div data-testid="table-plot-info" className="muted">{info}</div>
    </div>
  );
}

// Column definition (ColumnInfoDialog / StatisticSelectionPanel /
// ColumnInfoTTPane): statistic with population, parameter, percentile
// (default 90) and ancestor; keyword; formula; and the header name.
function ColumnDialog({ ws, channels, keywords, column, spec, autoHeader, onOk, onCancel }: {
  ws: Workspace; channels: string[]; keywords: { file: string[]; parm: string[] }; column: TableColumn | null; spec: StatSpec | null;
  autoHeader: (s: StatSpec) => string; onOk: (c: TableColumn) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<TableColumn['kind']>(column?.kind ?? 'statistic');
  const [s, setS] = useState<StatSpec>(spec ?? { populationPath: '', stat: 'median', channel: channels[0] ?? '', percentile: 90 });
  const [kwv, setKwv] = useState(column?.kind === 'keyword' ? column.keyword : '');
  const [fx, setFx] = useState(column?.kind === 'formula' ? column.formula : '');
  const initialAuto = spec ? autoHeader(spec) : '';
  const [name, setName] = useState(column && !(column.kind === 'statistic' && column.header === initialAuto) ? column.header : '');
  const paths = useMemo(() => {
    const set = new Set<string>();
    for (const smp of ws.samples) for (const pop of smp.populations) set.add(populationPath(smp.populations, pop.id));
    return [...set].sort();
  }, [ws.samples]);
  const ancestors = s.populationPath ? s.populationPath.split('/').slice(0, -1) : [];
  const needCh = STAT_NEEDS_CHANNEL(s.stat);
  const err = kind === 'statistic' ? (needCh && !s.channel ? 'Choose a parameter' : s.stat === 'percentile' && !validPercentile(s.percentile ?? NaN) ? 'Percentile: integer 0 to 100' : s.stat === 'freqOf' && !s.ancestor ? 'Choose an ancestor' : s.stat === 'correlation' && !s.correlate ? 'Choose the second parameter' : '')
    : kind === 'keyword' ? (kwv.trim() ? '' : 'Choose a keyword') : fx.trim() ? '' : 'Enter a formula';
  const clean = (): StatSpec => ({ populationPath: s.populationPath, stat: s.stat, ...(needCh ? { channel: s.channel } : {}), ...(s.stat === 'percentile' ? { percentile: s.percentile } : {}), ...(s.stat === 'freqOf' ? { ancestor: s.ancestor } : {}), ...(s.stat === 'correlation' ? { correlate: s.correlate } : {}) });
  return (
    <div className="modal-bg"><div className="modal" role="dialog" aria-label="Column" data-testid="table-column-dialog"><div className="modal-body">
      <h3>{column ? 'Edit Column' : 'Add Column'}</h3>
      <div className="row">
        {(['statistic', 'keyword', 'formula'] as const).map((k) => <label key={k}><input type="radio" name="col-kind" data-testid={`col-kind-${k}`} checked={kind === k} onChange={() => setKind(k)} /> {k === 'statistic' ? 'Statistic' : k === 'keyword' ? 'Keyword' : 'Formula'}</label>)}
      </div>
      {kind === 'statistic' && <div>
        <div>Population: <select data-testid="col-pop" value={s.populationPath} onChange={(e) => setS({ ...s, populationPath: e.target.value, ancestor: undefined })}>
          <option value="">All events</option>{paths.map((x) => <option key={x} value={x}>{x}</option>)}
        </select></div>
        <div>Statistic: <select data-testid="col-stat" value={s.stat} onChange={(e) => setS({ ...s, stat: e.target.value as StatKind })}>
          {Object.entries(STAT_LABELS).filter(([k]) => k !== 'kinetic').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
        {needCh && <div>Parameter: <select data-testid="col-channel" value={s.channel ?? ''} onChange={(e) => setS({ ...s, channel: e.target.value })}><option value="">(none)</option>{channels.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>}
        {s.stat === 'percentile' && <div>Percentile: <input type="number" min={0} max={100} data-testid="col-percentile" value={Number.isNaN(s.percentile) ? '' : s.percentile ?? 90} onChange={(e) => setS({ ...s, percentile: e.target.value === '' ? NaN : Number(e.target.value) })} /></div>}
        {s.stat === 'correlation' && <div>with: <select data-testid="col-correlate" value={s.correlate ?? ''} onChange={(e) => setS({ ...s, correlate: e.target.value })}><option value="">(none)</option>{channels.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>}
        {s.stat === 'freqOf' && <div>Ancestor: <select data-testid="col-ancestor" title="Select the ancestor population to add Freq. of to...." value={s.ancestor ?? ''} onChange={(e) => setS({ ...s, ancestor: e.target.value })}>
          <option value="">{'<Ancestor>'}</option>{ancestors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select></div>}
      </div>}
      {kind === 'keyword' && <div>
        File Keywords: <select data-testid="col-kw-file" value={keywords.file.includes(kwv) ? kwv : ''} onChange={(e) => setKwv(e.target.value)}><option value="">...</option>{keywords.file.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        {' '}Parameter Keywords: <select data-testid="col-kw-parm" value={keywords.parm.includes(kwv) ? kwv : ''} onChange={(e) => setKwv(e.target.value)}><option value="">...</option>{keywords.parm.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <div>Selected Keyword: <input data-testid="col-kw" value={kwv} onChange={(e) => setKwv(e.target.value)} /></div>
      </div>}
      {kind === 'formula' && <div>Formula: <input data-testid="col-formula" value={fx} onChange={(e) => setFx(e.target.value)} style={{ width: '80%' }} /></div>}
      <div>Name: <input data-testid="col-name" placeholder={kind === 'statistic' ? autoHeader(clean()) : kind === 'keyword' ? kwv : fx} value={name} onChange={(e) => setName(e.target.value)} style={{ width: '70%' }} /> <span className="muted">(empty: automatic)</span></div>
      {err && <div className="error" data-testid="col-error">{err}</div>}
      <button data-testid="col-ok" disabled={!!err} onClick={() => {
        if (kind === 'statistic') { const st = clean(); onOk({ kind, header: name.trim() || autoHeader(st), stat: st }); }
        else if (kind === 'keyword') onOk({ kind, header: name.trim() || kwv.trim(), keyword: kwv.trim() });
        else onOk({ kind, header: name.trim() || fx.trim(), formula: fx.trim() });
      }}>OK</button>
      <button data-testid="col-cancel" onClick={onCancel}>Cancel</button>
    </div></div></div>
  );
}
