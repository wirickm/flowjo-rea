// Plate Editor rules (spec docs/validation/ui-gaps/platforms.md, Plate Editor).
import { describe, expect, it } from 'vitest';
import { addPairs, allWells, applyToSamples, clearWells, copyText, dilutionSeries, fillDown, fillRight, heatColor, importCsv, invert, javaDouble, keywordFilePairs, newEditorState, newPlate, parsePlateXml, parseSampleWell, parseWellDesignation, pasteText, PLATE_SIZES, plateCsv, plateXml, readAttributesFromGroup, rectangle, sampleWell, setDimensions, valueRange, wellId, wellText, wellsOfSamples } from '../src/core/plate';
import type { SampleState } from '../src/core/model';

const sample = (id: string, kw: Record<string, string>): SampleState => ({ id, fileName: `${id}.fcs`, fileSize: 0, fingerprint: id, datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: kw, channelNames: [], eventCount: 0 });

describe('plate geometry', () => {
  it('sizes and notation', () => {
    expect(PLATE_SIZES[384]).toEqual({ cols: 24, rows: 16 });
    expect(PLATE_SIZES[1536]).toEqual({ cols: 48, rows: 32 });
    expect(wellId(0, 0)).toBe('A1');
    expect(wellId(26, 47)).toBe('a48');
    expect(allWells(newPlate('P')).length).toBe(96);
  });
  it('well designations (PlateWell.nameToPoint)', () => {
    expect(parseWellDesignation('H12')).toEqual({ row: 7, col: 11 });
    expect(parseWellDesignation('A01')).toEqual({ row: 0, col: 0 });
    expect(parseWellDesignation('A49')).toBeNull();
    expect(parseWellDesignation('A100')).toBeNull();
  });
  it('sample well keyword (WellID.fromString)', () => {
    expect(parseSampleWell('b03')).toEqual({ row: 1, col: 2 });
    expect(parseSampleWell('3B')).toEqual({ row: 1, col: 2 });
    expect(sampleWell(sample('s', { '$WELLID': 'C07' }))).toBe('C7');
    expect(sampleWell(sample('s', {}))).toBeNull();
  });
  it('set dimensions drops outside wells', () => {
    const p = newPlate('P');
    p.wells.H12 = { a: '1' };
    p.wells.A1 = { a: '2' };
    setDimensions(p, 6, 4);
    expect(Object.keys(p.wells)).toEqual(['A1']);
  });
  it('selection helpers', () => {
    const p = newPlate('P');
    expect(rectangle('B2', 'A1').sort()).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(invert(p, allWells(p).slice(1))).toEqual(['A1']);
  });
});

describe('editing', () => {
  it('fill down copies the top selected well into the selected run below', () => {
    const p = newPlate('P');
    p.wells.A1 = { Stim: 'PMA' };
    fillDown(p, ['A1', 'B1', 'C1', 'E1']);
    expect(p.wells.B1).toEqual({ Stim: 'PMA' });
    expect(p.wells.C1).toEqual({ Stim: 'PMA' });
    expect(p.wells.E1).toBeUndefined(); // D1 not selected: the run stops
  });
  it('fill down skips a column whose top selected well is in the last two rows (FlowJo quirk)', () => {
    const p = newPlate('P');
    p.wells.G1 = { k: 'v' };
    fillDown(p, ['G1', 'H1']);
    expect(p.wells.H1).toBeUndefined();
  });
  it('fill right', () => {
    const p = newPlate('P');
    p.wells.A1 = { k: 'v' };
    fillRight(p, ['A1', 'A2', 'A3']);
    expect(p.wells.A3).toEqual({ k: 'v' });
  });
  it('clear with and without keyword filter', () => {
    const p = newPlate('P');
    p.wells.A1 = { a: '1', b: '2' };
    p.wells.A2 = { a: '1' };
    clearWells(p, ['A1', 'A2'], 'a');
    expect(p.wells).toEqual({ A1: { b: '2' } });
    clearWells(p, ['A1']);
    expect(p.wells).toEqual({});
  });
  it('dilution series down with replicates, multiplier and increment', () => {
    const p = newPlate('P');
    dilutionSeries(p, ['A1', 'D1'], { attribute: 'Conc', start: 10, repeats: 2, multiplier: 0.5, increment: 1 }, true);
    // A1, B1 = 10; C1, D1 = 10*0.5+1 = 6 (B1 lies between selected wells and is filled)
    expect(['A1', 'B1', 'C1', 'D1'].map((w) => p.wells[w].Conc)).toEqual(['10.0', '10.0', '6.0', '6.0']);
  });
  it('dilution series right ignores the increment (FlowJo quirk)', () => {
    const p = newPlate('P');
    dilutionSeries(p, ['A1', 'A2', 'A3'], { attribute: 'Conc', start: 1, repeats: 1, multiplier: 0.1, increment: 5 }, false);
    expect(['A1', 'A2', 'A3'].map((w) => p.wells[w].Conc)).toEqual(['1.0', '0.1', javaDouble(0.1 * 0.1)]);
  });
  it('java double formatting', () => {
    expect(javaDouble(1)).toBe('1.0');
    expect(javaDouble(0.25)).toBe('0.25');
    expect(javaDouble(0.0001)).toBe('1.0E-4');
    expect(javaDouble(12345678)).toBe('1.2345678E7');
  });
  it('keyword file and table', () => {
    const st = newEditorState();
    expect(st.staging.map((s) => s.name)).toEqual(['Staging Well 1', 'Staging Well 2', 'Staging Well 3', 'Staging Well 4']);
    addPairs(st, keywordFilePairs('Stim,PMA\nStim,PMA\nDonor,1\nbad'));
    expect(st.keywordTable).toEqual([{ attribute: 'Donor', value: '1' }, { attribute: 'Stim', value: 'PMA' }]);
  });
});

describe('CSV, paste, XML', () => {
  it('export table and import back', () => {
    const p = newPlate('P', { cols: 2, rows: 1 });
    p.wells.A1 = { Stim: 'PMA, iono', Dose: '1' };
    const csv = plateCsv(p);
    expect(csv).toBe('WELL ID,Dose,Stim\nA1,1,"PMA, iono"\nA2,,\n');
    const q = newPlate('Q', { cols: 2, rows: 1 });
    expect(importCsv(q, csv)).toEqual({ applied: 2, ignored: 0 });
    expect(q.wells).toEqual({ A1: { Dose: '1', Stim: 'PMA, iono' } });
  });
  it('import requires a well id column and skips bad rows', () => {
    const p = newPlate('P');
    expect(() => importCsv(p, 'a,b\n1,2')).toThrow(/well id/);
    expect(importCsv(p, 'x,well_id\n5,Z9\n6,B2\n7,H13')).toEqual({ applied: 1, ignored: 2 });
    expect(p.wells.B2).toEqual({ x: '6' });
  });
  it('copy and paste tab text', () => {
    const p = newPlate('P');
    p.wells.A1 = { k: 'v' };
    const t = copyText(p, ['A1']);
    expect(t).toBe('WELL ID\tk\nA1\tv');
    const q = newPlate('Q');
    expect(pasteText(q, t.replace('A1', 'C3'))).toBe(1);
    expect(q.wells.C3).toEqual({ k: 'v' });
  });
  it('xml round trip', () => {
    const st = newEditorState();
    st.plates[0].wells.B2 = { 'a&b': '<1>' };
    st.staging[0].attrs = { s: '1' };
    const back = parsePlateXml(plateXml(st));
    expect(back.plates[0].wells).toEqual({ B2: { 'a&b': '<1>' } });
    expect(back.staging[0].attrs).toEqual({ s: '1' });
    expect(() => parsePlateXml('<nope')).toThrow(/could not be parsed/);
  });
});

describe('display and workspace', () => {
  it('well text follows the keyword filter', () => {
    const p = newPlate('P');
    p.wells.A1 = { Dose: '5' };
    expect(wellText(p, 'A1')).toBe('A1');
    p.keywordFilter = 'Dose';
    expect(wellText(p, 'A1')).toBe('5');
    p.keywordFilter = 'Well';
    expect(wellText(p, 'A1')).toBe('A1');
  });
  it('heat map: range from 0, blue at minimum, yellow at maximum', () => {
    const p = newPlate('P');
    p.wells.A1 = { d: '10' };
    p.wells.A2 = { d: '5' };
    p.wells.A3 = { d: 'x' };
    expect(valueRange(p, 'd')).toEqual([0, 10]);
    expect(heatColor(10, [0, 10])).toEqual([255, 255, 0]);
    expect(heatColor(0, [0, 10])).toEqual([0, 0, 255]);
    expect(heatColor(5, [0, 10])).toEqual([128, 128, 127]);
    expect(heatColor(0, [0, 0])).toEqual([255, 255, 0]);
  });
  it('read attributes from group, apply to group, select group', () => {
    const a = sample('a', { 'WELL ID': 'A1', $CYT: 'LSR', Stim: 'PMA', $P1N: 'FSC', $P1R: '1024', 'PLATE ID': 'P7' });
    const b = sample('b', { 'WELL ID': 'B2', $CYT: 'LSR', Stim: 'none', $P1N: 'FSC', $P1R: '1024', 'PLATE ID': 'P7' });
    const p = newPlate('P');
    expect(readAttributesFromGroup(p, [a, b])).toEqual({ filled: 2, missing: 0 });
    expect(p.wells.A1).toEqual({ 'WELL ID': 'A1', Stim: 'PMA' }); // common $CYT, $P1N, $P1R and PLATE ID left out
    expect(p.plateID).toBe('P7');
    p.wells.B2 = { Dose: '3' };
    expect(applyToSamples(p, [a, b])).toBe(2);
    expect(b.annotations).toEqual({ Dose: '3' });
    expect(wellsOfSamples(p, [b])).toEqual(['B2']);
  });
});
