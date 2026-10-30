// Gating-ML 2.0 compliance: per-event membership truth published by ISAC
// with the specification (fetched via FlowKit). Expectation: exact match.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SampleEngine } from '../src/core/analysis';
import { parseFcs } from '../src/core/fcs';
import { parseGatingMl } from '../src/core/gatingml';
import { fk, haveFixtures, readBytes, readText } from './fixtures';

describe.skipIf(!haveFixtures)('Gating-ML 2.0 compliance suite (data1.fcs)', () => {
  const fcs = haveFixtures ? parseFcs(readBytes('gate_ref/data1.fcs')) : null!;
  const truthFiles = haveFixtures ? readdirSync(fk('gate_ref/truth')) : [];
  const gmlFiles = haveFixtures ? readdirSync(fk('gate_ref/gml')).filter((f) => f.endsWith('.xml')) : [];
  const checked = new Set<string>();
  // FlowKit-authored variants with no ISAC truth file.
  const noTruth = ['gml_ellipse2_gate.xml', 'gml_range_gate_attr_testing.xml'];
  // Truth file named differently from the gate id in the fixture.
  const alias: Record<string, string> = { ParRectangle1: 'ParQuadRect' };
  for (const g of gmlFiles.filter((f) => !noTruth.includes(f))) {
    it(g, () => {
      const doc = parseGatingMl(readText(`gate_ref/gml/${g}`));
      const eng = new SampleEngine(fcs, { compensation: 'uncompensated', populations: doc.populations }, doc.matrices).run();
      let compared = 0;
      for (const p of doc.populations) {
        const tid = alias[p.id] ?? p.id;
        const tf = `Results_${tid}.txt`;
        if (!truthFiles.includes(tf)) continue;
        const truth = readText(`gate_ref/truth/${tf}`).trim().split(/\s+/).map(Number);
        const r = eng.results.get(p.id)!;
        expect(r.error, `${p.id} error`).toBeUndefined();
        const mask = eng.masks.get(p.id)!;
        expect(mask.length).toBe(truth.length);
        let mismatches = 0;
        for (let i = 0; i < truth.length; i++) if (mask[i] !== truth[i]) mismatches++;
        expect(mismatches, `${g} ${p.id} mismatched events`).toBe(0);
        compared++;
        checked.add(tid);
      }
      expect(compared).toBeGreaterThan(0);
    });
  }
  it('covers every truth file', () => {
    const missing = truthFiles.map((t) => t.replace(/^Results_|\.txt$/g, '')).filter((id) => !checked.has(id));
    expect(missing).toEqual([]);
  });
});
