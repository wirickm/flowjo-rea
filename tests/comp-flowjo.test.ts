// FlowJo 10.6.2 compensation (specs section 14): .mtx / CSV files
// (CompensationMatrix), WizardMatrix.calculate, WeightOptimizer::CalculateSSM
// / CalculateSSMCoefficient.
import { describe, expect, it } from 'vitest';
import { BADGES, flowjoWizard, readMtx, spilloverSpreading, ssmCoefficient, ssmCsv, writeMatrixCsv, writeMtx, type WizardEntry } from '../src/core/compFlowjo';
import type { SpilloverMatrix } from '../src/core/compensation';

const mat: SpilloverMatrix = { id: 'm', name: 'Tube comp', channels: ['FL1-A', 'FL2-A'], values: [[1, 0.2], [0.05, 1]], source: 'test' };
const lin = { kind: 'linear' as const, min: 0, max: 4096 };

describe('matrix files', () => {
  it('.mtx: Gating-ML root, transforms:spilloverMatrix with parameters and spillover rows; reads back', () => {
    const x = writeMtx(mat);
    expect(x).toContain('<transforms:spilloverMatrix spectral="false" prefix="Comp-" name="Tube comp"');
    expect(x).toContain('<data-type:parameter data-type:name="FL1-A" userProvidedCompInfix="Comp-FL1-A" />');
    expect(x).toContain('<transforms:coefficient transforms:value="0.2" />');
    const back = readMtx(x, 'f');
    expect(back.channels).toEqual(mat.channels);
    expect(back.values).toEqual(mat.values);
    expect(back.name).toBe('Tube comp');
  });
  it('legacy comp:* names are accepted', () => {
    const x = writeMtx(mat).replace(/transforms:value/g, 'comp:value');
    expect(readMtx(x, 'f').values[0][1]).toBe(0.2);
  });
  it('CSV: an empty corner cell, detectors across, channels down', () => {
    expect(writeMatrixCsv(mat)).toBe(',FL1-A,FL2-A\nFL1-A,1,0.2\nFL2-A,0.05,1\n');
  });
});

// A control population: constant values per detector.
const pop = (name: string, vals: Record<string, number>, n = 200, parent = 1000, cleaned = true) => ({ name, values: new Map(Object.entries(vals).map(([k, v]) => [k, new Float64Array(n).fill(v)])), parentCount: parent, cleaned });

describe('wizard (WizardMatrix.calculate)', () => {
  it('spillover = (med P - med N) on j / the same on the stained channel; diagonal 1', () => {
    const entries: WizardEntry[] = [
      { primary: 'FL1-A', pos: pop('P1', { 'FL1-A': 1010, 'FL2-A': 210 }), neg: pop('N', { 'FL1-A': 10, 'FL2-A': 10 }) },
      { primary: 'FL2-A', pos: pop('P2', { 'FL1-A': 60, 'FL2-A': 1010 }), neg: pop('N', { 'FL1-A': 10, 'FL2-A': 10 }) },
    ];
    const r = flowjoWizard(entries, ['FL1-A', 'FL2-A'], { 'FL1-A': lin, 'FL2-A': lin });
    expect(r.status).toBe('FINALIZED');
    expect(r.matrix!.values[0][0]).toBe(1);
    expect(r.matrix!.values[0][1]).toBeCloseTo(0.2, 3);
    expect(r.matrix!.values[1][0]).toBeCloseTo(0.05, 3);
  });
  it('too few events (100, 2% of parent) and missing populations are errors; no cleanup gate warns', () => {
    const r = flowjoWizard([
      { primary: 'FL1-A', pos: pop('P1', { 'FL1-A': 1000 }, 50), neg: null },
      { primary: 'FL2-A', pos: pop('P2', { 'FL2-A': 1000 }, 200, 100000, false), neg: pop('N', { 'FL2-A': 10 }) },
    ], ['FL1-A', 'FL2-A'], {});
    expect(r.status).toBe('ERRONEOUS');
    const texts = r.badges.map((b) => b.text);
    expect(texts).toContain(BADGES.missingNeg);
    expect(texts).toContain(BADGES.tooFew('P1'));
    expect(texts).toContain(BADGES.tooFew('P2'));
    expect(texts).toContain(BADGES.cleanup('P2'));
  });
});

describe('spillover spreading matrix (CalculateSSMCoefficient)', () => {
  it('sqrt((P84_P - med_P)^2 - (P84_N - med_N)^2) / sqrt(med_P,i - med_N,i); 0 when not defined', () => {
    expect(ssmCoefficient(150, 100, 20, 10, 1010, 10)).toBeCloseTo(Math.sqrt(2500 - 100) / Math.sqrt(1000), 12);
    expect(ssmCoefficient(150, 100, 20, 10, 10, 10)).toBe(0);
    expect(ssmCoefficient(101, 100, 200, 10, 1010, 10)).toBe(0); // negative under the root
  });
  it('matrix over the controlled detectors, and its CSV ("SSM" header, comp prefix stripped)', () => {
    const spread = (centre: number, sd: number) => Float64Array.from({ length: 1000 }, (_, k) => centre + sd * (k / 999 - 0.5) * 3.4);
    const p = { name: 'P', values: new Map([['FL1-A', spread(1000, 100)], ['FL2-A', spread(200, 60)]]), parentCount: 2000, cleaned: true };
    const n = { name: 'N', values: new Map([['FL1-A', spread(10, 5)], ['FL2-A', spread(10, 5)]]), parentCount: 2000, cleaned: true };
    const s = spilloverSpreading([{ primary: 'FL1-A', pos: p, neg: n }, { primary: 'FL2-A', pos: p, neg: n }], ['FL1-A', 'FL2-A'], { 'FL1-A': lin, 'FL2-A': lin });
    expect(s.channels).toEqual(['FL1-A', 'FL2-A']);
    expect(s.values[0][1]).toBeGreaterThan(0);
    expect(ssmCsv({ channels: ['Comp-FL1-A'], values: [[0.5]] })).toBe('SSM,Comp-FL1-A\nFL1-A,0.5\n');
  });
});

describe('service: FlowJo wizard on control samples', () => {
  it('uses each control\'s positive and negative populations (here gates on the stained channel)', async () => {
    const { AnalysisService } = await import('../src/core/service');
    const { writeFcs } = await import('../src/core/fcsWriter');
    const svc = new AnalysisService();
    // Control for FL1-A: 300 negatives (10, 10) and 300 positives (1010, 210).
    const n = 600;
    const fl1 = Float64Array.from({ length: n }, (_, i) => (i < 300 ? 10 : 1010));
    const fl2 = Float64Array.from({ length: n }, (_, i) => (i < 300 ? 10 : 210));
    await svc.load('c1', 'c1.fcs', writeFcs([{ name: 'FL1-A', range: 4096, values: fl1 }, { name: 'FL2-A', range: 4096, values: fl2 }], {}));
    const lin = { kind: 'none' as const };
    const gate = (lo: number | null, hi: number | null) => ({ type: 'rect' as const, dims: [{ kind: 'channel' as const, channel: 'FL1-A', transform: lin, compensation: 'uncompensated' }], min: [lo], max: [hi] });
    const pops = [{ id: 'cells', name: 'Cells', parentId: null, gate: { ...gate(null, null), min: [-1e9], max: [1e9] } }, { id: 'p', name: 'Pos', parentId: 'cells', gate: gate(500, null) }, { id: 'n', name: 'Neg', parentId: 'cells', gate: gate(null, 500) }];
    const r = svc.flowjoWizard({ controls: [{ sampleId: 'c1', compensation: 'none', populations: pops, primary: 'FL1-A', posPath: 'Cells/Pos', negPath: 'Cells/Neg' }], matrices: [], detectors: ['FL1-A', 'FL2-A'], scales: { 'FL1-A': { kind: 'linear', min: 0, max: 4096 }, 'FL2-A': { kind: 'linear', min: 0, max: 4096 } } });
    expect(r.status).toBe('FINALIZED');
    expect(r.medians['FL1-A'].pos[1]).toBe(210);
    expect(r.matrix!.channels).toEqual(['FL1-A']);
  });
});
