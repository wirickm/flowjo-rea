// Multiple data sets ($NEXTDATA): enumerate and switch from stored bytes.
import { describe, expect, it } from 'vitest';
import { writeFcs } from '../src/core/fcsWriter';
import { AnalysisService } from '../src/core/service';

// Two FCS data sets in one file. The first data set's $NEXTDATA is patched in
// place; a padding keyword keeps the TEXT length (and so every offset) unchanged.
function twoDatasets(): Uint8Array {
  const pad = 'x'.repeat(12);
  const a = writeFcs([{ name: 'FSC-A', range: 1024, values: Float64Array.from([1, 2, 3]) }], { PAD: pad });
  const b = writeFcs([{ name: 'FSC-A', range: 1024, values: Float64Array.from([4, 5, 6, 7, 8]) }, { name: 'SSC-A', range: 1024, values: Float64Array.from([9, 9, 9, 9, 9]) }]);
  const n = String(a.length);
  const text = new TextDecoder('latin1').decode(a);
  const patched = text.replace('|$NEXTDATA|0|', `|$NEXTDATA|${n}|`).replace(`|PAD|${pad}`, `|PAD|${pad.slice(n.length - 1)}`);
  expect(patched.length).toBe(text.length);
  const out = new Uint8Array(a.length + b.length);
  out.set(Uint8Array.from(patched, (c) => c.charCodeAt(0)));
  out.set(b, a.length);
  return out;
}

describe('multiple data sets', () => {
  it('loads data set 1, reports the count, and switches to data set 2 and back', async () => {
    const svc = new AnalysisService();
    const m1 = await svc.load('s', 'multi.fcs', twoDatasets());
    expect(m1.datasetCount).toBe(2);
    expect(m1.datasetIndex).toBe(0);
    expect(m1.eventCount).toBe(3);
    const m2 = await svc.selectDataset('s', 1);
    expect(m2.datasetIndex).toBe(1);
    expect(m2.eventCount).toBe(5);
    expect(m2.channels.map((c) => c.name)).toEqual(['FSC-A', 'SSC-A']);
    const counts = svc.analyze({ sampleId: 's', compensation: 'none', populations: [], matrices: [] });
    expect(counts.total).toBe(5);
    expect((await svc.selectDataset('s', 0)).eventCount).toBe(3);
    await expect(svc.selectDataset('s', 5)).rejects.toThrow(/not found/);
    svc.unload('s');
    await expect(svc.selectDataset('s', 0)).rejects.toThrow(/not loaded/);
  });
});
