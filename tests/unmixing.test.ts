// Spectral unmixing (OLS): exact recovery on synthetic mixtures, error
// handling, and a cross-implementation comparison with FlowKit/flowutils
// output (not an instrument-vendor reference).
import { describe, expect, it } from 'vitest';
import { SampleEngine } from '../src/core/analysis';
import { parseSpilloverCsv, unmix, unmixingOperator, type SpilloverMatrix } from '../src/core/compensation';
import type { FcsFile } from '../src/core/fcs';
import { haveFixtures, readBytes } from './fixtures';

function readNpy(path: string): { shape: number[]; data: Float64Array | BigInt64Array } {
  const b = readBytes(path);
  const hlen = b[8] | (b[9] << 8);
  const header = new TextDecoder().decode(b.subarray(10, 10 + hlen));
  const shape = /'shape': \(([^)]*)\)/.exec(header)![1].split(',').filter((x) => x.trim()).map(Number);
  const descr = /'descr': '([^']+)'/.exec(header)![1];
  if (/'fortran_order': True/.test(header)) throw new Error('fortran order unsupported');
  const body = b.slice(10 + hlen).buffer;
  if (descr === '<f8') return { shape, data: new Float64Array(body) };
  if (descr === '<i8') return { shape, data: new BigInt64Array(body) };
  throw new Error(`dtype ${descr}`);
}

const spectral = (values: number[][], detectors: string[], fluors: string[]): SpilloverMatrix => ({ id: 'spec', name: 'spec', channels: detectors, outputNames: fluors, values, source: 'test' });

describe('OLS spectral unmixing', () => {
  const det = ['D1', 'D2', 'D3', 'D4'];
  const S = [
    [1, 0.5, 0.2, 0.05],
    [0.1, 0.3, 1, 0.6],
  ];
  it('recovers exact abundances from noise-free mixtures', () => {
    const truth = [[1000, 50], [0, 2000], [-30, 400]];
    const raw = det.map((_, d) => Float64Array.from(truth, (t) => t[0] * S[0][d] + t[1] * S[1][d]));
    const out = unmix(raw, det, spectral(S, det, ['FITC', 'PE']));
    truth.forEach((t, e) => {
      expect(out.get('FITC')![e]).toBeCloseTo(t[0], 9);
      expect(out.get('PE')![e]).toBeCloseTo(t[1], 9);
    });
  });
  it('is the least-squares solution: residual orthogonal to each spectrum', () => {
    const raw = det.map((_, d) => Float64Array.from([d * 7 + 3]));
    const out = unmix(raw, det, spectral(S, det, ['FITC', 'PE']));
    const a = [out.get('FITC')![0], out.get('PE')![0]];
    const resid = det.map((_, d) => raw[d][0] - a[0] * S[0][d] - a[1] * S[1][d]);
    for (const row of S) expect(row.reduce((s, v, d) => s + v * resid[d], 0)).toBeCloseTo(0, 10);
  });
  it('rejects dependent spectra, size mismatches and name collisions', () => {
    expect(() => unmixingOperator(spectral([[1, 2, 3, 4], [2, 4, 6, 8]], det, ['A', 'B']))).toThrow(/linearly dependent/);
    expect(() => unmix(det.map(() => new Float64Array(1)), det, spectral([[1, 2, 3]], det, ['A']))).toThrow(/one finite value per detector/);
    expect(() => unmix(det.map(() => new Float64Array(1)), det, spectral(S, det, ['D1', 'PE']))).toThrow(/collide/);
    expect(() => unmix(det.map(() => new Float64Array(1)), ['D1', 'D2', 'D3', 'X'], spectral(S, det, ['A', 'B']))).toThrow(/not in sample/);
  });
  it('reads a spectral CSV (rows = fluorochromes, columns = detectors)', () => {
    const m = parseSpilloverCsv(',D1,D2,D3\nFITC,1,0.5,0.1\nPE,0.1,1,0.4');
    expect(m.outputNames).toEqual(['FITC', 'PE']);
    expect(m.channels).toEqual(['D1', 'D2', 'D3']);
  });
  it('unmixed channels are gateable through the engine', () => {
    const raw = det.map((_, d) => Float64Array.from([1000 * S[0][d], 2000 * S[1][d]]));
    const fcs = { channels: det.map((name, i) => ({ index: i + 1, name, label: '', bits: 32, range: 262144, logDecades: 0, logOffset: 0, gain: 1 })), data: raw, eventCount: 2, keywords: {} } as unknown as FcsFile;
    const eng = new SampleEngine(fcs, { compensation: 'spec', populations: [{ id: 'p', name: 'FITC+', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'FITC', transform: { kind: 'none' } }], min: [500], max: [null] } }] }, [spectral(S, det, ['FITC', 'PE'])]).run();
    expect(eng.results.get('p')!.count).toBe(1);
  });
});

describe.skipIf(!haveFixtures)('cross-check with FlowKit spectral fixture (flowutils OLS output)', () => {
  it('matches FlowKit truth for all 33 fluorochrome channels within 1e-6 relative', () => {
    const raw = readNpy('spectral_data/spectral_raw_events.npy');
    const M = readNpy('spectral_data/spectral_comp_matrix.npy');
    const truth = readNpy('spectral_data/truth/spectral_comp_events.npy');
    // Labels from FlowKit tests/test_config.py (spectral_sample_labels, spectral_all_detectors).
    const labels = ['Time', 'FSC-A', 'FSC-W', 'FSC-H', 'SSC-A', 'SSC-W', 'SSC-H', 'UV379-A', 'UV446-A', 'UV515-A', 'UV540-A', 'UV585-A', 'UV610-A', 'UV660-A', 'UV695-A', 'UV736-A', 'UV809-A', 'V427-A', 'V450-A', 'V470-A', 'V510-A', 'V540-A', 'V576-A', 'V595-A', 'V615-A', 'V660-A', 'V680-A', 'V710-A', 'V750-A', 'V785-A', 'V845-A', 'B510-A', 'B537-A', 'B576-A', 'B602-A', 'B660-A', 'B675-A', 'B710-A', 'B750-A', 'B810-A', 'YG585-A', 'YG602-A', 'YG660-A', 'YG670-A', 'YG695-A', 'YG730-A', 'YG750-A', 'YG780-A', 'YG825-A', 'R660-A', 'R675-A', 'R680-A', 'R710-A', 'R730-A', 'R780-A'];
    const detectors = ['B510-A', 'B537-A', 'B602-A', 'B660-A', 'B675-A', 'B710-A', 'B750-A', 'B810-A', 'R675-A', 'R710-A', 'R780-A', 'UV379-A', 'UV446-A', 'UV515-A', 'UV585-A', 'UV610-A', 'UV660-A', 'UV736-A', 'UV809-A', 'V427-A', 'V450-A', 'V510-A', 'V540-A', 'V576-A', 'V595-A', 'V660-A', 'V710-A', 'V750-A', 'V785-A', 'YG585-A', 'YG602-A', 'YG730-A', 'YG780-A', 'B576-A', 'R660-A', 'R680-A', 'R730-A', 'UV540-A', 'UV695-A', 'V470-A', 'V615-A', 'V680-A', 'V845-A', 'YG660-A', 'YG670-A', 'YG695-A', 'YG750-A', 'YG825-A'];
    const trueDet = detectors.slice(0, 33);
    expect(labels.length).toBe(raw.shape[1]);
    expect(M.shape).toEqual([33, 48]);
    const [n, c] = raw.shape;
    const r = raw.data as Float64Array;
    const t = truth.data as Float64Array;
    // FlowKit's truth came from data that went through FCS float32 storage.
    const cols = labels.map((_, j) => Float64Array.from({ length: n }, (_, e) => Math.fround(r[e * c + j])));
    const values = Array.from({ length: 33 }, (_, i) => Array.from((M.data as Float64Array).subarray(i * 48, i * 48 + 48)));
    const out = unmix(cols, labels, spectral(values, detectors, trueDet.map((d) => `${d} unmixed`)));
    let worst = 0;
    trueDet.forEach((d, k) => {
      const j = labels.indexOf(d);
      const col = out.get(`${d} unmixed`)!;
      for (let e = 0; e < n; e++) worst = Math.max(worst, Math.abs(col[e] - t[e * c + j]) / Math.max(1, Math.abs(t[e * c + j])));
      void k;
    });
    console.log(`spectral cross-check worst relative error ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(1e-6);
  });
});
