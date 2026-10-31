import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, initHistory, pushHistory, redo, undo } from '../src/ui/history';

describe('undo/redo history', () => {
  it('undoes and redoes in order', () => {
    let h = initHistory('a');
    h = pushHistory(h, 'b');
    h = pushHistory(h, 'c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
    expect(redo(h)).toBe(h);
  });
  it('a new edit after undo discards the redo branch', () => {
    let h = pushHistory(pushHistory(initHistory(1), 2), 3);
    h = pushHistory(undo(h), 9);
    expect(h.future).toEqual([]);
    expect(undo(h).present).toBe(2);
  });
  it('caps history length', () => {
    let h = initHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
    expect(h.past[0]).toBe(20);
  });
});
