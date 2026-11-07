import { describe, expect, it } from 'vitest';
import { AnalysisService } from '../src/core/service';
import { writeFcs } from '../src/core/fcsWriter';
import type { SpilloverMatrix } from '../src/core/compensation';

describe('uncompensated parameters (specs 25.1)', () => {
  it('"<name> (uncompensated)" reads the raw values while the parameter itself is compensated', async () => {
    const svc = new AnalysisService();
    const a = Float64Array.from([100, 100]), b = Float64Array.from([10, 60]);
    await svc.load('s', 's.fcs', writeFcs([{ name: 'A', range: 1000, values: a }, { name: 'B', range: 1000, values: b }]));
    const m: SpilloverMatrix = { id: 'm', name: 'm', source: 'test', channels: ['A', 'B'], values: [[1, 0.5], [0, 1]] };
    const req = (ch: string) => svc.plot({ sampleId: 's', compensation: 'm', populations: [], matrices: [m], derived: [], popId: null, x: { kind: 'channel', channel: ch, transform: { kind: 'none' } }, y: null, bins: 100, xRange: [0, 100], yRange: null, maxPoints: 0 });
    const raw = req('B (uncompensated)'), comp = req('B');
    // raw B: bins 10 and 60; compensated B = B - 0.5 * A = -40 and 10 (clamped to bins 0 and 10)
    expect(raw.density[10]).toBe(1);
    expect(raw.density[60]).toBe(1);
    expect(comp.density[60]).toBe(0);
    expect(comp.density[10]).toBe(1);
  });
});
