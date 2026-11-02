// Autofluorescence: estimating an AF spectrum and showing that including it as
// an extra unmixing row recovers true fluorochrome abundances despite AF,
// where omitting it does not. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { isSpectral, unmix, validateMatrix } from '../src/core/compensation';
import { AF_NAME, estimateAfSpectrum, withAutofluorescence } from '../src/core/autofluorescence';

const DET = ['D1', 'D2', 'D3', 'D4'];
// Two fluorochromes and an autofluorescence signature across 4 detectors.
const FITC = [1, 0.4, 0.1, 0.02];
const PE = [0.1, 1, 0.5, 0.05];
const AF = [0.6, 0.5, 0.4, 0.3];

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (1664525 * s + 1013904223) >>> 0) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

// n events with given fluor amounts plus an AF amount per event (all + noise).
function mix(n: number, fitc: () => number, pe: () => number, af: () => number, seed: number) {
  const r = rng(seed);
  const cols = DET.map(() => new Float64Array(n));
  for (let e = 0; e < n; e++) {
    const a = fitc(), b = pe(), g = af();
    DET.forEach((_, j) => (cols[j][e] = a * FITC[j] + b * PE[j] + g * AF[j] + 20 * r()));
  }
  return new Map(DET.map((d, j) => [d, cols[j]]));
}

const baseMatrix = { id: 'm', name: 'spec', channels: DET, outputNames: ['FITC', 'PE'], values: [FITC, PE], source: 't' };

describe('autofluorescence', () => {
  it('estimates the AF spectrum from an unstained control (normalised to max 1)', () => {
    const unstained = mix(20000, () => 0, () => 0, () => 1000 * (1 + 0.1 * rng(9)()), 1);
    const spec = estimateAfSpectrum(unstained, DET);
    const norm = AF.map((v) => v / Math.max(...AF));
    spec.forEach((v, j) => expect(Math.abs(v - norm[j]), `detector ${j}`).toBeLessThan(0.02));
  });

  it('including AF as an unmixing row recovers true abundances; omitting it biases them', () => {
    // every event: FITC=1000, PE=0, AF=800
    const data = mix(20000, () => 1000, () => 0, () => 800, 2);
    const cols = DET.map((d) => data.get(d)!);
    const withoutAf = unmix(cols, DET, baseMatrix);
    const unstained = mix(20000, () => 0, () => 0, () => 800, 3);
    const m2 = withAutofluorescence(baseMatrix, estimateAfSpectrum(unstained, DET));
    const withAf = unmix(cols, DET, m2);
    const mean = (c: Float64Array) => c.reduce((a, b) => a + b, 0) / c.length;
    // With AF modelled, FITC ~ 1000 and PE ~ 0; AF abundance is recovered too.
    expect(Math.abs(mean(withAf.get('FITC')!) - 1000)).toBeLessThan(40);
    expect(Math.abs(mean(withAf.get('PE')!))).toBeLessThan(40);
    expect(withAf.has(AF_NAME)).toBe(true);
    expect(mean(withAf.get(AF_NAME)!)).toBeGreaterThan(400); // ~800 * max(AF)=0.6 = 480 in the max-normalised basis
    // Without AF, the spillover-free fit pushes error into FITC/PE.
    const errWithout = Math.abs(mean(withoutAf.get('FITC')!) - 1000) + Math.abs(mean(withoutAf.get('PE')!));
    const errWith = Math.abs(mean(withAf.get('FITC')!) - 1000) + Math.abs(mean(withAf.get('PE')!));
    expect(errWithout).toBeGreaterThan(errWith * 3);
  });

  it('rejects bad input', () => {
    expect(() => estimateAfSpectrum(new Map(DET.map((d) => [d, new Float64Array(50)])), DET)).toThrow(/100/);
    expect(() => withAutofluorescence({ ...baseMatrix, values: [[1, 0], [0, 1]], channels: ['A', 'B'], outputNames: ['A', 'B'] }, [1, 1])).toThrow(/spectral/);
    expect(() => withAutofluorescence(baseMatrix, [1, 2])).toThrow(/detectors/);
    expect(() => withAutofluorescence(withAutofluorescence(baseMatrix, AF), AF)).toThrow(/already has an output/);
  });
});

// UAT a3-02: 2 dyes + AF on 3 detectors is a square matrix. Decided by shape it
// was applied as spillover (detector columns overwritten, no Dye/AF channels).
// FlowJo 10 marks spectral matrices with an explicit flag (specs section 6.3).
describe('square spectral matrix (2 dyes + AF on 3 detectors)', () => {
  it('stays spectral: unmixed outputs are new channels, detectors stay raw', () => {
    const det = ['FITC-A', 'PE-A', 'APC-A'];
    const m = { id: 's', name: 'spec', channels: det, outputNames: ['Dye1', 'Dye2'], values: [[1, 0.3, 0.1], [0.2, 1, 0.5]], source: 'csv (spectral)', kind: 'spectral' as const };
    const m2 = withAutofluorescence(m, [0.6, 0.5, 0.4]);
    expect(m2.values.length).toBe(m2.channels.length);
    expect(isSpectral(m2)).toBe(true);
    expect(validateMatrix(m2, det)).toEqual([]);
    const cols = det.map((_, j) => Float64Array.from([1000 * [1, 0.3, 0.1][j] + 500 * [0.6, 0.5, 0.4][j]]));
    const out = unmix(cols, det, m2);
    expect([...out.keys()]).toEqual(['Dye1', 'Dye2', 'Autofluorescence']);
    expect(out.get('Dye1')![0]).toBeCloseTo(1000, 6);
    expect(out.get('Dye2')![0]).toBeCloseTo(0, 6);
    expect(out.get('Autofluorescence')![0]).toBeCloseTo(500, 6);
  });
  it('a square matrix without a kind is still spillover (shape fallback)', () => {
    expect(isSpectral({ id: 'f', name: 'f', channels: ['A', 'B'], values: [[1, 0.1], [0, 1]], source: 'keyword' })).toBe(false);
  });
});
