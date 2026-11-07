// Preferences dialog (specs 16) and table editor (specs 17).
import { useState } from 'react';
import { CONFIRM, resetDontAsk, type Prefs } from '../core/prefs';
import { iterate, summaryRows, tableCsv, tableHtml, tableRows, tableTab, type TableColumn, type TableTemplate } from '../core/tableEditor';
import type { Workspace } from '../core/model';

export function PrefsDialog({ prefs, onChange, onClose }: { prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
  const set = (k: keyof Prefs, v: unknown) => onChange({ ...prefs, [k]: v });
  return (
    <div className="modal-bg"><div className="modal" role="dialog" aria-label="Preferences" data-testid="prefs-dialog"><div className="modal-body">
      <h3>Preferences</h3>
      <label><input type="checkbox" data-testid="pref-noundo" checked={prefs.noUndo} onChange={(e) => set('noUndo', e.target.checked)} /> Disable Undo</label><br />
      <label><input type="checkbox" data-testid="pref-autosave" checked={prefs.autoSave} onChange={(e) => set('autoSave', e.target.checked)} /> Auto-save every </label>
      <input type="number" min={1} style={{ width: 50 }} data-testid="pref-autosave-min" value={prefs.autoSaveMinutes} onChange={(e) => set('autoSaveMinutes', Math.max(1, Number(e.target.value) || 1))} /> minutes<br />
      <label><input type="checkbox" data-testid="pref-edge" checked={prefs.eventsOnAxis} onChange={(e) => set('eventsOnAxis', e.target.checked)} /> Warn when more than </label>
      <input type="number" min={0} max={100} style={{ width: 50 }} data-testid="pref-edge-pct" value={prefs.warningThreshold} onChange={(e) => set('warningThreshold', Number(e.target.value) || 0)} />% of events are on an axis edge<br />
      <button data-testid="pref-reset-dontask" disabled={!prefs.dontAsk.length} onClick={() => onChange(resetDontAsk(prefs))}>Reset All Don't Show Memory ({prefs.dontAsk.length})</button>
      <div><button data-testid="prefs-close" onClick={onClose}>Close</button></div>
    </div></div></div>
  );
}

type Rows = { sample: string; cells: (number | string)[] }[];
export function TablesDialog({ ws, updateWs, stats, colLabel, ask, download, onClose }: {
  ws: Workspace; updateWs: (f: (w: Workspace) => void) => void; stats: Record<string, (number | string)[]>;
  colLabel: (c: Workspace['statColumns'][number]) => string;
  ask: (text: string, choices: string[], key?: string) => Promise<string | null>;
  download: (name: string, data: BlobPart, type?: string) => void; onClose: () => void;
}) {
  const tables = ws.tables ?? [];
  const [id, setId] = useState<string | null>(tables[0]?.id ?? null);
  const t = tables.find((x) => x.id === id) ?? null;
  const edit = (f: (t: TableTemplate) => void) => updateWs((w) => { const x = w.tables?.find((y) => y.id === id); if (x) f(x); });
  const [kw, setKw] = useState('');
  const [formula, setFormula] = useState('');
  const rows = (): Rows => {
    if (!t) return [];
    const src = ws.samples.map((s) => ({ sample: s.fileName, keywords: s.keywordsSnapshot, stats: Object.fromEntries(ws.statColumns.map((c, i) => [c.id, stats[s.id]?.[i] ?? NaN])) }));
    const groups = iterate(src, t.iteration, (r, k) => r.keywords[k.toUpperCase()] ?? r.keywords[k]);
    const out: Rows = tableRows(t, groups.flatMap((g) => g.items.map((r) => (t.iteration.type === 'SAMPLE' ? r : { ...r, sample: `${g.label}: ${r.sample}` }))));
    return t.summary ? [...out, ...summaryRows(out, t.columns.length)] : out;
  };
  const r = rows();
  const add = (c: TableColumn) => edit((x) => { x.columns.push(c); });
  return (
    <div className="modal-bg"><div className="modal" role="dialog" aria-label="Table editor" data-testid="tables-dialog"><div className="modal-body">
      <h3>Table editor</h3>
      <select data-testid="table-select" value={id ?? ''} onChange={(e) => setId(e.target.value || null)}>
        <option value="">(none)</option>{tables.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <button data-testid="table-new" onClick={() => { const nid = `tbl-${Date.now()}`; updateWs((w) => { w.tables = [...(w.tables ?? []), { id: nid, name: `Table ${(w.tables?.length ?? 0) + 1}`, columns: [], iteration: { type: 'SAMPLE' } }]; }); setId(nid); }}>New table</button>
      {t && <button data-testid="table-delete" onClick={async () => { if ((await ask(CONFIRM.table.text, ['Delete'], CONFIRM.table.key)) !== 'Delete') return; updateWs((w) => { w.tables = (w.tables ?? []).filter((x) => x.id !== id); }); setId(null); }}>Delete table</button>}
      {t && <>
        <div>
          <select data-testid="table-add-stat" value="" onChange={(e) => { const c = ws.statColumns.find((x) => x.id === e.target.value); if (c) add({ kind: 'statistic', header: colLabel(c), statColumnId: c.id }); }}>
            <option value="">Add statistic column...</option>{ws.statColumns.map((c) => <option key={c.id} value={c.id}>{colLabel(c)}</option>)}
          </select>
          <input placeholder="keyword" data-testid="table-kw" value={kw} onChange={(e) => setKw(e.target.value)} />
          <button data-testid="table-add-kw" disabled={!kw.trim()} onClick={() => { add({ kind: 'keyword', header: kw.trim(), keyword: kw.trim() }); setKw(''); }}>Add keyword</button>
          <input placeholder="formula over column headers" data-testid="table-formula" value={formula} onChange={(e) => setFormula(e.target.value)} />
          <button data-testid="table-add-formula" disabled={!formula.trim()} onClick={() => { add({ kind: 'formula', header: formula.trim(), formula: formula.trim() }); setFormula(''); }}>Add formula</button>
        </div>
        <div>
          Iterate by <select data-testid="table-iter" value={t.iteration.type} onChange={(e) => edit((x) => { x.iteration = { ...x.iteration, type: e.target.value as TableTemplate['iteration']['type'] }; })}>
            <option value="SAMPLE">Sample</option><option value="KEYWORD">Keyword</option><option value="PANEL">Panel</option>
          </select>
          {t.iteration.type === 'KEYWORD' && <input data-testid="table-iter-kw" placeholder="keyword" value={t.iteration.keyword ?? ''} onChange={(e) => edit((x) => { x.iteration.keyword = e.target.value; })} />}
          {t.iteration.type === 'PANEL' && <input type="number" min={1} data-testid="table-iter-panel" value={t.iteration.panelSize ?? 1} onChange={(e) => edit((x) => { x.iteration.panelSize = Number(e.target.value) || 1; })} />}
          <label><input type="checkbox" data-testid="table-summary" checked={!!t.summary} onChange={(e) => edit((x) => { x.summary = e.target.checked; })} /> Show Summary Stats</label>
        </div>
        <table data-testid="table-preview"><thead><tr><th />{t.columns.map((c, k) => <th key={k}>{c.header} <button className="x" onClick={() => edit((x) => { x.columns.splice(k, 1); })}>x</button> <label title="Heat map"><input type="checkbox" checked={!!c.format?.heatMap} onChange={(e) => edit((x) => { x.columns[k].format = { ...x.columns[k].format, heatMap: e.target.checked }; })} />heat</label></th>)}</tr></thead>
          <tbody>{r.map((row, i) => <tr key={i}><td>{row.sample}</td>{row.cells.map((v, k) => <td key={k}>{typeof v === 'number' ? (Number.isFinite(v) ? +v.toPrecision(6) : 'NaN') : v}</td>)}</tr>)}</tbody></table>
        <button data-testid="table-csv" onClick={() => download(`${t.name}.csv`, tableCsv(t, r), 'text/csv')}>CSV</button>
        <button data-testid="table-tab" onClick={() => download(`${t.name}.txt`, tableTab(t, r), 'text/plain')}>TAB</button>
        <button data-testid="table-html" onClick={() => download(`${t.name}.html`, tableHtml(t, r), 'text/html')}>HTML</button>
      </>}
      <div><button data-testid="tables-close" onClick={onClose}>Close</button></div>
    </div></div></div>
  );
}
