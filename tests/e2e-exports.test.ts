// Verifies files exported by the E2E run (e2e/workflow.mjs) with the
// independent readers: exported FCS parses to the gated event count, and the
// Gating-ML export re-imports. Skipped when no E2E run output exists.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFcs } from '../src/core/fcs';
import { parseGatingMl } from '../src/core/gatingml';

const manifest = 'test-results/e2e/exports.json';
describe.skipIf(!existsSync(manifest))('E2E export files', () => {
  const m = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : {};
  it('gated FCS export has the population count and matches the CSV values', () => {
    const f = parseFcs(new Uint8Array(readFileSync(m.fcsOut)));
    expect(f.eventCount).toBe(m.polyFinal);
    const csv = readFileSync(m.csvOut, 'utf8').trim().split('\n');
    const first = csv[1].split(',').map(Number);
    // float32 storage in FCS: relative 1e-6
    first.forEach((v: number, c: number) => expect(Math.abs(f.data[c][0] - v)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(v))));
    expect(f.keywords['FLOWJO_REA_POPULATION']).toBe('Cells/Polygon 1');
  });
  it('Gating-ML export re-imports', () => {
    const doc = parseGatingMl(readFileSync(m.gmlOut, 'utf8'));
    expect(doc.populations.length).toBeGreaterThanOrEqual(7);
  });
  it('PNG export is a PNG', () => {
    const b = readFileSync(m.pngOut);
    expect([...b.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  });
});
