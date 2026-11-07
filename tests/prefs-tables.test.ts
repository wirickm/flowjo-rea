// FlowJo 10.6.2 preferences, Don't Ask Again, auto-save, edge warning
// (specs 16) and the table editor / layout iteration (specs 17).
import { describe, expect, it } from 'vitest';
import { autoSaveMessage, CONFIRM, DEFAULT_PREFS, edgeWarning, rememberDontAsk, resetDontAsk, shouldAutoSave, skipConfirm } from '../src/core/prefs';
import { cellStyle, headerText, iterate, summaryRows, tableCsv, tableRows, tableTab, tilePositions, type TableTemplate } from '../src/core/tableEditor';

describe('preferences (FJPrefsFJML defaults)', () => {
  it('defaults: undo on, auto-save off every 10 minutes, edge warning on at 5%', () => {
    expect(DEFAULT_PREFS).toMatchObject({ noUndo: false, autoSave: false, autoSaveMinutes: 10, eventsOnAxis: true, warningThreshold: 5 });
  });
  it('Don\'t Ask Again: a remembered key answers Yes without asking; reset empties the memory', () => {
    const p = rememberDontAsk(DEFAULT_PREFS, CONFIRM.populations.key);
    expect(skipConfirm(p, CONFIRM.populations.key)).toBe(true);
    expect(skipConfirm(p, CONFIRM.statistics.key)).toBe(false);
    expect(skipConfirm(resetDontAsk(p), CONFIRM.populations.key)).toBe(false);
  });
  it('auto-save only for a saved workspace with samples, with FlowJo\'s status text', () => {
    const on = { ...DEFAULT_PREFS, autoSave: true };
    expect(shouldAutoSave(on, true, 3)).toBe(true);
    expect(shouldAutoSave(on, false, 3)).toBe(false);
    expect(shouldAutoSave(on, true, 0)).toBe(false);
    expect(shouldAutoSave(DEFAULT_PREFS, true, 3)).toBe(false);
    expect(autoSaveMessage('W', new Date(2026, 10, 7, 9, 5, 3))).toBe('Auto-Saved W on Sat, 7 Nov 2026 09:05:03');
  });
});

describe('edge-event warning (GateWinController.updateEventsOnAxis)', () => {
  it('flags an axis above the threshold (strict) and reports int(100 x (sum + 0.005))', () => {
    const w = edgeWarning(DEFAULT_PREFS, { n: 1000, xLow: 0, xHigh: 60, yLow: 10, yHigh: 0 });
    expect(w).toEqual({ x: true, y: false, text: 'Warning: 7% of events are on the chart edges!' });
    expect(edgeWarning(DEFAULT_PREFS, { n: 1000, xLow: 50, xHigh: 0, yLow: 0, yHigh: 0 }).text).toBeNull();
    expect(edgeWarning(DEFAULT_PREFS, { n: 100, xLow: 99, xHigh: 0, yLow: 0, yHigh: 0 }).text).toBe('Warning: Nearly all events are on the chart edges!');
    expect(edgeWarning({ ...DEFAULT_PREFS, eventsOnAxis: false }, { n: 100, xLow: 99, xHigh: 0, yLow: 0, yHigh: 0 }).text).toBeNull();
  });
});

describe('table editor (TableTemplate)', () => {
  const t: TableTemplate = { id: 't', name: 'T', iteration: { type: 'SAMPLE' }, columns: [
    { kind: 'statistic', header: 'Lymph Freq. of Parent', statColumnId: 'c1' },
    { kind: 'keyword', header: 'Tube', keyword: '$SRC' },
    { kind: 'formula', header: 'Double', formula: 'Lymph Freq. of Parent * 2' },
  ] };
  const rows = tableRows(t, [{ sample: 'a.fcs', keywords: { $SRC: 'T1, left' }, stats: { c1: 12.5 } }, { sample: 'b.fcs', keywords: { $SRC: 'T2' }, stats: { c1: 20 } }]);
  it('statistic, keyword and formula columns (formula over the same row)', () => {
    expect(rows[0].cells).toEqual([12.5, 'T1, left', 25]);
  });
  it('CSV: " (%)" after Freq. headers, commas quoted; TAB starts with "Sample:"', () => {
    expect(headerText('Freq. of Parent')).toBe('Freq. of Parent (%)');
    const csv = tableCsv(t, rows).split('\n');
    expect(csv[0]).toBe(',Lymph Freq. of Parent (%),Tube,Double');
    expect(csv[1]).toBe('a.fcs,12.5,"T1, left",25');
    expect(tableTab(t, rows).split('\n')[0].startsWith('Sample:\t')).toBe(true);
  });
  it('summary rows Mean and Std. Deviation; heat map blue to yellow', () => {
    const s = summaryRows(rows, 3);
    expect(s[0].sample).toBe('Mean');
    expect(s[0].cells[0]).toBe(16.25);
    expect(cellStyle({ heatMap: true }, 20, [12.5, 20]).background).toBe('rgb(255,255,0)');
    expect(cellStyle({ heatMap: true }, 12.5, [12.5, 20]).background).toBe('rgb(0,0,255)');
  });
});

describe('iteration and batch tiles (SIteration, BatchSettings)', () => {
  const items = [{ k: 'A' }, { k: 'B' }, { k: 'A' }, { k: '' }, { k: 'C' }];
  it('by keyword value (empty left out), by panel of N tubes, by sample', () => {
    expect(iterate(items, { type: 'KEYWORD', keyword: 'K' }, (t) => t.k).map((g) => [g.label, g.items.length])).toEqual([['A', 2], ['B', 1], ['C', 1]]);
    expect(iterate(items, { type: 'PANEL', panelSize: 2 }, () => undefined).map((g) => g.items.length)).toEqual([2, 2, 1]);
    expect(iterate(items, { type: 'SAMPLE' }, () => undefined)).toHaveLength(5);
  });
  it('tiles across in a fixed number of columns, or one per page', () => {
    expect(tilePositions(5, { direction: 'COLUMNS', length: 2, order: 'ACROSS', separatePages: false }).map((p) => [p.row, p.col])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]]);
    expect(tilePositions(3, { direction: 'COLUMNS', length: 2, order: 'ACROSS', separatePages: true }).map((p) => p.page)).toEqual([0, 1, 2]);
  });
});
