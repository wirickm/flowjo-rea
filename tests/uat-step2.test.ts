// UAT step 2 (medium defects): FlowJo 10 behaviors from specs section 6.7.
// One describe block per UAT item; reasons in docs/validation/uat-2026-11-02.md.
import { describe, expect, it } from 'vitest';
import type { FcsChannel } from '../src/core/fcs';
import { channelRange, defaultTransform, specForKind } from '../src/ui/axes';
import { histogramScale } from '../src/ui/renderPlot';

const ch = (name: string, range: number): FcsChannel => ({ index: 1, name, label: '', bits: 32, range, logDecades: 0, logOffset: 0, gain: 1 });

describe('a2-04 linear range is 0..$PnR', () => {
  it('uses $PnR, or 1024 when it is missing', () => {
    expect(channelRange(ch('FL1-A', 1024))).toBe(1024);
    expect(channelRange(ch('FL1-A', 0))).toBe(1024);
    expect(defaultTransform(ch('FSC-A', 4096), {})).toEqual({ kind: 'linear', T: 4096, A: 0 });
    expect(defaultTransform(ch('FSC-A', 0), {})).toEqual({ kind: 'linear', T: 1024, A: 0 });
  });
  it('changing the scale type keeps the range', () => {
    const lin = specForKind('linear', { kind: 'logicle', T: 1024, W: 0.5, M: 4.5, A: 0 }, 262144);
    expect(lin).toEqual({ kind: 'linear', T: 1024, A: 0 });
    expect(specForKind('flowjo-biex', lin, 262144)).toMatchObject({ max: 1024 });
    // A spec without a top of scale falls back to the channel's range.
    expect(specForKind('linear', { kind: 'flowjo-log', offset: 1, decades: 4.5 }, 4096)).toEqual({ kind: 'linear', T: 4096, A: 0 });
  });
});

describe('a2-02 histogram overlays use raw counts by default', () => {
  const base = [0, 10, 40, 10];
  const ov = [0, 80, 5, 0];
  it('raw counts share one axis over the base and overlays', () => {
    const s = histogramScale(base, [ov], false);
    expect(s.label).toBe('Count');
    expect(s.max).toBe(80);
    expect(s.factor(base)).toBe(1);
    expect(s.factor(ov)).toBe(1);
  });
  it('"Normalized To Mode" scales each curve to a mode of 100 and relabels the axis', () => {
    const s = histogramScale(base, [ov], true);
    expect(s.label).toBe('Normalized To Mode');
    expect(s.max).toBe(100);
    expect(40 * s.factor(base)).toBe(100);
    expect(80 * s.factor(ov)).toBe(100);
  });
});
