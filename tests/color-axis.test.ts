import { describe, expect, it } from 'vitest';
import { AnalysisService } from '../src/core/service';
import { writeFcs } from '../src/core/fcsWriter';

describe('colour axis and Event # parameter (specs 24)', () => {
  it('returns the mean of the colour parameter per 2-D bin', async () => {
    const svc = new AnalysisService();
    // Two clusters: low x / low colour, high x / high colour.
    const x = [10, 12, 11, 90, 91, 92], y = [50, 50, 50, 50, 50, 50], c = [1, 3, 2, 100, 200, 300];
    await svc.load('s', 's.fcs', writeFcs([{ name: 'X', range: 100, values: Float64Array.from(x) }, { name: 'Y', range: 100, values: Float64Array.from(y) }, { name: 'C', range: 1000, values: Float64Array.from(c) }]));

    const r = svc.plot({ sampleId: 's', compensation: 'none', populations: [], matrices: [], derived: [], popId: null, x: { kind: 'channel', channel: 'X', transform: { kind: 'none' } }, y: { kind: 'channel', channel: 'Y', transform: { kind: 'none' } }, bins: 10, xRange: [0, 100], yRange: [0, 100], maxPoints: 10, color: { kind: 'channel', channel: 'C', transform: { kind: 'none' } } });

    expect(r.colorMean).toBeDefined();
    expect(r.colorMean![5 * 10 + 1]).toBeCloseTo(2);
    expect(r.colorMean![5 * 10 + 9]).toBeCloseTo(200);
    expect(Number.isNaN(r.colorMean![0])).toBe(true);
    expect(r.colorExtent).toEqual([1, 300]);
  });
  it('Event # is the event index', async () => {
    const svc = new AnalysisService();
    await svc.load('s', 's.fcs', writeFcs([{ name: 'X', range: 100, values: Float64Array.from([5, 6, 7, 8]) }]));
    const r = svc.plot({ sampleId: 's', compensation: 'none', populations: [], matrices: [], derived: [], popId: null, x: { kind: 'channel', channel: 'Event #', transform: { kind: 'none' } }, y: null, bins: 4, xRange: [0, 4], yRange: null, maxPoints: 0 });
    expect(Array.from(r.density)).toEqual([1, 1, 1, 1]);
  });
});
