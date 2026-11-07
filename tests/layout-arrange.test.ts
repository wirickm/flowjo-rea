import { describe, expect, it } from 'vitest';
import { align, alignToGrid, avoidPageBreaks, bindSample, bringToFront, gridPositions, iterationValues, nudge, nudgeStep, pageOf, placeRow, sendToBack, snapToGrid, spacing, stepOrder, tilePitch, usablePage, type Box } from '../src/core/layoutArrange';

const b = (id: string, x: number, y: number, w = 100, h = 50): Box => ({ id, x, y, w, h });

describe('FlowJo 10 layout page (specs 21.1)', () => {
  it('Letter portrait minus 1 inch margins is 468 x 648 pt; landscape swaps', () => {
    expect(usablePage()).toEqual({ w: 468, h: 648 });
    expect(usablePage({ paper: 'letter', orientation: 'landscape' })).toEqual({ w: 648, h: 468 });
    expect(usablePage({ paper: 'a4', orientation: 'portrait' })).toEqual({ w: 451, h: 698 });
  });
  it('a point lies on page floor(coord / page) + 1', () => {
    expect([pageOf(0, 468), pageOf(467, 468), pageOf(468, 468)]).toEqual([1, 1, 2]);
  });
  it('dropped graphs: one row, 30 pt apart, the first centred on the drop point and kept at >= 0', () => {
    expect(placeRow([{ w: 100, h: 80 }, { w: 60, h: 80 }], { x: 200, y: 200 })).toEqual([{ x: 150, y: 160 }, { x: 280, y: 160 }]);
    expect(placeRow([{ w: 100, h: 80 }], { x: 10, y: 10 })).toEqual([{ x: 0, y: 0 }]);
    expect(placeRow([{ w: 100, h: 80 }, { w: 60, h: 40 }], { x: 200, y: 200 }, false)[1]).toEqual({ x: 150, y: 270 });
  });
});

describe('FlowJo 10 arrange commands (specs 21.2)', () => {
  const sel = [b('a', 10, 5, 100), b('b', 40, 30, 60), b('c', 25, 70, 80)];
  it('left / right / top / bottom use the selection extent', () => {
    expect(align(sel, 'left').map((x) => x.x)).toEqual([10, 10, 10]);
    expect(align(sel, 'right').map((x) => x.x + x.w)).toEqual([110, 110, 110]);
    expect(align(sel, 'top').map((x) => x.y)).toEqual([5, 5, 5]);
    expect(align(sel, 'bottom').map((x) => x.y + x.h)).toEqual([120, 120, 120]);
  });
  it('centres use the integer mean of the centres, not the middle of the extent', () => {
    // centres 60, 70, 65 -> mean 65
    expect(align(sel, 'hcenter').map((x) => x.x + Math.floor(x.w / 2))).toEqual([65, 65, 65]);
  });
  it('spacing: first and last stay, middle left edges step by floor((last centre - first centre) / (n - 1))', () => {
    const r = spacing([b('a', 0, 0, 100), b('m', 20, 0, 40), b('z', 300, 0, 100)], 'h');
    // centres 50 and 350 -> step 150; middle left edge = 0 + 150
    expect(r.map((x) => x.x)).toEqual([0, 150, 300]);
    expect(r.map((x) => x.y)).toEqual([0, 0, 0]);
  });
  it('align to grid snaps the top-left to the nearest 36 pt', () => {
    expect([snapToGrid(17), snapToGrid(18), snapToGrid(53), snapToGrid(54)]).toEqual([0, 36, 36, 72]);
    expect(alignToGrid([b('a', 20, 50)])[0]).toMatchObject({ x: 36, y: 36 });
  });
  it('bring to front keeps the selection order; send to back reverses it', () => {
    expect(bringToFront(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['b', 'd', 'c', 'a']);
    expect(sendToBack(['a', 'b', 'c', 'd'], ['b', 'd'])).toEqual(['d', 'b', 'a', 'c']);
    expect(stepOrder(['a', 'b', 'c'], ['a'], 1)).toEqual(['b', 'a', 'c']);
    expect(stepOrder(['a', 'b', 'c'], ['c'], -1)).toEqual(['a', 'c', 'b']);
  });
  it('nudge steps multiply (Alt 2, Ctrl 2, Shift 3) and skip locked figures', () => {
    expect([nudgeStep(false, false, false), nudgeStep(true, false, false), nudgeStep(false, true, true), nudgeStep(true, true, true)]).toEqual([1, 2, 6, 12]);
    expect(nudge([b('a', 0, 0), { ...b('l', 0, 0), locked: true }], 3, 0).map((x) => x.x)).toEqual([3, 0]);
  });
  it('avoid page breaks pushes a crossing figure to the next page and later figures with it', () => {
    const r = avoidPageBreaks([b('a', 400, 0, 100, 50), b('b', 520, 0, 100, 50)], { w: 468, h: 648 });
    expect(r.map((x) => x.x)).toEqual([468, 588]);
    const big = avoidPageBreaks([b('big', 400, 0, 500, 50)], { w: 468, h: 648 });
    expect(big[0].x).toBe(400);
  });
  it('grid layout: 3 x 4 cells with 4 pt padding, row by row; extra items are left out', () => {
    const items = Array.from({ length: 13 }, (_, i) => b(`i${i}`, 0, 0, 100, 50));
    const { placed, left } = gridPositions(items, { x: 0, y: 0 });
    expect(placed[0]).toMatchObject({ x: 4, y: 4 });
    expect(placed[4]).toMatchObject({ x: 4, y: 62 });
    expect(placed[3]).toMatchObject({ x: 328, y: 4 });
    expect(left).toEqual(['i12']);
  });
});

describe('FlowJo 10 layout iteration (specs 21.3)', () => {
  const S = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, i) => ({ id, kw: { DONOR: i < 3 ? 'A' : 'B', TUBE: String(i % 3) } as Record<string, string> }));
  const kw = (s: (typeof S)[number], k: string) => s.kw[k];
  it('off keeps the original sample; sample iteration shows the value', () => {
    expect(bindSample('t2', { type: 'OFF' }, 't5', S, kw)?.id).toBe('t2');
    expect(bindSample('t2', { type: 'SAMPLE' }, 't5', S, kw)?.id).toBe('t5');
  });
  it('panel iteration keeps the graph position within its panel', () => {
    expect(bindSample('t2', { type: 'PANEL', size: 3 }, 't4', S, kw)?.id).toBe('t5');
    expect(iterationValues({ type: 'PANEL', size: 3 }, S, kw)).toEqual(['t1', 't4']);
  });
  it('keyword iteration maps the k-th sample of one value to the k-th of the next, or matches a discriminator', () => {
    expect(bindSample('t3', { type: 'KEYWORD', keyword: 'DONOR' }, 'B', S, kw)?.id).toBe('t6');
    expect(bindSample('t2', { type: 'KEYWORD', keyword: 'DONOR', discriminator: 'TUBE' }, 'B', S, kw)?.id).toBe('t5');
    expect(iterationValues({ type: 'KEYWORD', keyword: 'DONOR' }, S, kw)).toEqual(['A', 'B']);
  });
  it('batch tiles step by whole pages', () => {
    expect([tilePitch(400, 468), tilePitch(468, 468), tilePitch(900, 468)]).toEqual([468, 936, 936]);
  });
});

describe('FlowJo 10 layout guides (specs 21.2)', () => {
  it('a moved rectangle snaps its nearest edge to a guide within 30 pt', async () => {
    const { snapToGuides, DEFAULT_GUIDES } = await import('../src/core/layoutArrange');
    // left edge 0 + 230 = 230 is 20 pt from the 250 guide -> snaps to 250
    expect(snapToGuides(b('a', 0, 0, 100, 50), 230, 0, DEFAULT_GUIDES)).toEqual({ dx: 250, dy: 0 });
    // right edge 100 + 120 = 220 is 30 pt away -> snaps; 40 pt away does not
    expect(snapToGuides(b('a', 0, 0, 100, 50), 120, 0, DEFAULT_GUIDES).dx).toBe(150);
    expect(snapToGuides(b('a', 0, 0, 100, 50), 110, 0, DEFAULT_GUIDES).dx).toBe(110);
    expect(snapToGuides(b('a', 0, 0, 100, 50), 0, 190, DEFAULT_GUIDES).dy).toBe(200);
  });
});
