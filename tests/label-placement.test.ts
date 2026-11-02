import { describe, expect, it } from 'vitest';
import { placeLabel, type LabelBox } from '../src/ui/renderPlot';

const area = { x0: 10, y0: 20, x1: 400, y1: 300 };
const overlaps = (a: LabelBox, b: LabelBox) => Math.abs(a.y - b.y) < 13 && a.x < b.x + b.w && b.x < a.x + a.w;

describe('gate label placement', () => {
  it('keeps a label where requested when there is room', () => {
    expect(placeLabel([], 50, 100, 100, area)).toEqual({ x: 100, y: 100, w: 50 });
  });

  it('keeps long labels inside the plot area', () => {
    const b = placeLabel([], 200, 350, 5, area);
    expect(b.x + b.w).toBeLessThanOrEqual(area.x1);
    expect(b.y).toBe(area.y0);
  });

  it('moves labels that would collide so none overlap', () => {
    const placed: LabelBox[] = [];
    for (let i = 0; i < 6; i++) placeLabel(placed, 120, 20 + i * 10, 20, area);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i], placed[j])).toBe(false);
    for (const b of placed) expect(b.y >= area.y0 && b.y <= area.y1).toBe(true);
  });

  it('leaves labels that do not overlap horizontally on the same line', () => {
    const placed: LabelBox[] = [];
    placeLabel(placed, 50, 20, 50, area);
    expect(placeLabel(placed, 50, 200, 50, area).y).toBe(50);
  });
});
