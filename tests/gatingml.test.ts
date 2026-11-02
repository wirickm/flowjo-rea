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

describe.skipIf(!haveFixtures)('Gating-ML export round trip', () => {
  it('re-imported export of gml_all_gates gives identical memberships', async () => {
    const { exportGatingMl } = await import('../src/core/gatingml');
    const fcs = parseFcs(readBytes('gate_ref/data1.fcs'));
    const doc = parseGatingMl(readText('gate_ref/gml/gml_all_gates.xml'));
    // ratio dimensions have no export path; drop them and dependants
    const pops = doc.populations.filter((p) => p.gate.type === 'boolean' || !p.gate.dims.some((d) => d.kind === 'ratio'));
    const keep = new Set(pops.map((p) => p.id));
    const exportable = pops.filter((p) => p.gate.type !== 'boolean' || p.gate.operands.every((o) => keep.has(o.ref)));
    const { xml } = exportGatingMl(exportable, doc.matrices, 'uncompensated');
    const back = parseGatingMl(xml);
    const a = new SampleEngine(fcs, { compensation: 'uncompensated', populations: exportable }, doc.matrices).run();
    const b = new SampleEngine(fcs, { compensation: 'uncompensated', populations: back.populations }, back.matrices).run();
    expect(back.populations.length).toBe(exportable.length);
    for (const p of exportable) expect(b.results.get(p.id)?.count, p.id).toBe(a.results.get(p.id)!.count);
  });
});

// UAT a5-01: one unrepresentable gate used to abort the whole export, so a
// FlowJo workspace with a Time gate could never be exported. Now: skip and
// warn per population (plus dependants); linear-gain ('scale') gates such as
// Time are written in raw units (specs section 6.5).
describe.skipIf(!haveFixtures)('Gating-ML export skips what it cannot write', () => {
  it('skips ratio gates and their dependants with warnings and writes the rest', async () => {
    const { exportGatingMl } = await import('../src/core/gatingml');
    const doc = parseGatingMl(readText('gate_ref/gml/gml_all_gates.xml'));
    const { xml, warnings } = exportGatingMl(doc.populations, doc.matrices, 'uncompensated');
    const back = parseGatingMl(xml);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => /Ratio/.test(w))).toBe(true);
    expect(back.populations.length).toBeGreaterThan(0);
    expect(back.populations.length + warnings.length).toBe(doc.populations.length);
  });

  it('exports a FlowJo workspace with a Time gate; re-import gives identical counts', async () => {
    const { exportGatingMl } = await import('../src/core/gatingml');
    const { parseWsp } = await import('../src/core/wsp');
    const { workspace: ws } = parseWsp(readText('8_color_data_set/8_color_ICS.wsp'));
    const s = ws.samples.find((x) => x.fileName === '101_DEN084Y5_15_E01_008_clean.fcs')!;
    expect(s.populations.some((p) => p.gate.type !== 'boolean' && p.gate.dims.some((d) => d.kind === 'channel' && d.transform.kind === 'scale'))).toBe(true);
    const { xml, warnings } = exportGatingMl(s.populations, ws.matrices, s.compensation);
    expect(warnings).toEqual([]);
    const back = parseGatingMl(xml);
    const fcs = parseFcs(readBytes(`8_color_data_set/fcs_files/${s.fileName}`));
    const a = new SampleEngine(fcs, s, ws.matrices).run();
    const b = new SampleEngine(fcs, { compensation: s.compensation, populations: back.populations }, back.matrices).run();
    expect(back.populations.length).toBe(s.populations.length);
    // Linear-gain (Time) gates round-trip exactly. Polygons imported from .wsp
    // use FlowJo's gate grid, which Gating-ML cannot express (written as exact
    // polygons), so only the Time gates are compared here.
    const timeGates = s.populations.filter((p) => p.gate.type === 'rect' && p.gate.dims.some((d) => d.kind === 'channel' && d.transform.kind === 'scale'));
    expect(timeGates.length).toBeGreaterThan(0);
    for (const p of timeGates) expect(b.results.get(p.id)?.count, p.name).toBe(a.results.get(p.id)!.count);
  });
});
