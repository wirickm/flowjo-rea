import { describe, expect, it } from 'vitest';
import { RIBBON_MESSAGES, addBand, dropBand, parseStructure, removeBand } from '../src/core/ribbon';
import { arcsinhAutoM } from '../src/core/graphDisplay';
import { cellCycleGateRanges } from '../src/core/cellcycle';
import { PE_RIBBON, TE_RIBBON, WS_RIBBON } from '../src/ui/ribbons';

const S = { A: ['x', 'y', 'z'], B: ['w'] };

describe('ribbon customisation (AbstractRibbonStructure, FJRibbonDropTargetListener)', () => {
  it('removes a band; refuses the last band of a task', () => {
    expect(removeBand(S, 'A', 'y').structure).toEqual({ A: ['x', 'z'], B: ['w'] });
    const r = removeBand(S, 'B', 'w');
    expect(r.error).toBe(RIBBON_MESSAGES.lastBand);
    expect(r.structure).toBe(S);
  });

  it('adds at the end or before / after a band; refuses a duplicate in the task', () => {
    expect(addBand(S, 'B', 'x').structure.B).toEqual(['w', 'x']);
    expect(addBand(S, 'A', 'w', { target: 'y', after: false }).structure.A).toEqual(['x', 'w', 'y', 'z']);
    expect(addBand(S, 'A', 'w', { target: 'y', after: true }).structure.A).toEqual(['x', 'y', 'w', 'z']);
    expect(addBand(S, 'A', 'x').error).toBe(RIBBON_MESSAGES.duplicate);
    expect(S.A).toEqual(['x', 'y', 'z']); // inputs untouched
  });

  it('drop moves a band of the task, adds a new one, ignores a drop on itself', () => {
    expect(dropBand(S, 'A', 'x', 'z', true).structure.A).toEqual(['y', 'z', 'x']);
    expect(dropBand(S, 'A', 'z', 'x', false).structure.A).toEqual(['z', 'x', 'y']);
    expect(dropBand(S, 'A', 'w', 'x', true).structure.A).toEqual(['x', 'w', 'y', 'z']);
    expect(dropBand(S, 'A', 'y', 'y', true).structure).toBe(S);
  });

  it('saved form: unknown tasks / bands skipped, missing tasks keep defaults', () => {
    expect(parseStructure({ A: ['z', 'nope', 'z'], C: ['x'] }, S, ['x', 'y', 'z', 'w'])).toEqual({ A: ['z'], B: ['w'] });
    expect(parseStructure('junk', S, [])).toEqual(S);
  });

  it('editor defaults only use known bands', () => {
    for (const spec of [WS_RIBBON, TE_RIBBON, PE_RIBBON]) for (const bands of Object.values(spec.defaults)) for (const b of bands) expect(spec.bands[b]).toBeTruthy();
    expect(Object.keys(WS_RIBBON.defaults)).toEqual(['FlowJo', 'File', 'Edit', 'Workspace', 'Tools', 'Configure']);
  });
});

describe('graph and cell cycle follow-ups', () => {
  it('Calculate Width Basis on arcsinh: M = log10(T), width basis -T', () => {
    expect(arcsinhAutoM(262144)).toBeCloseTo(Math.log10(262144));
    expect(-(10 ** arcsinhAutoM(20000))).toBeCloseTo(-20000);
  });

  it('CC Gates in Workspace: G1 / G2 mean +/- 2 SD, S between them', () => {
    const r = cellCycleGateRanges({ model: 'dean-jett-fox', g1: { mean: 99.5, sd: 5, area: 0 }, g2: { mean: 199.5, sd: 8, area: 0 } }, 2, 'PI-A');
    expect(r.map((x) => x.name)).toEqual(['DeanJettFox-PI-A-G1', 'DeanJettFox-PI-A-G2', 'DeanJettFox-PI-A-S']);
    expect(r[0].min).toBeCloseTo(200 - 20); expect(r[0].max).toBeCloseTo(220);
    expect(r[1].min).toBeCloseTo(400 - 32); expect(r[1].max).toBeCloseTo(432);
    expect(r[2]).toMatchObject({ min: r[0].max, max: r[1].min });
    expect(cellCycleGateRanges({ model: 'watson', g1: { mean: 9.5, sd: 1, area: 0 }, g2: { mean: 19.5, sd: 1, area: 0 } }, 1, 'DNA')[0].name).toBe('Watson-DNA-G1');
  });
});
