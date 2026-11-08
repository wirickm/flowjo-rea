import { describe, expect, it } from 'vitest';
import { currentDate, experimentXml, isEmptyExperiment, newExperiment, readExperiment } from '../src/core/miflowcyt';
import { parseXml } from '../src/core/xml';

describe('MIFlowCyt experiment annotation (MIFlowCytElement)', () => {
  it('writes overview fields directly under <experiment> and sections after them', () => {
    const e = newExperiment(new Date(2026, 10, 7));
    e.fields.name = 'T cell <panel>';
    e.specimen.organism = 'Human';
    e.instrument.model = 'LSRII';
    e.analysis.groups = 'All Samples\nControls';
    e.figures.push({ id: 'Layout', mimetype: 'image/png', description: 'Fig 1' });
    const xml = experimentXml(e);
    expect(xml.startsWith('<experiment><id></id><name>T cell &lt;panel&gt;</name>')).toBe(true);
    expect(xml).toContain('<created>07-NOV-2026</created>');
    expect(xml).toMatch(/<\/comments><specimen>.*<organism>Human<\/organism>.*<\/specimen><instrument><model>LSRII<\/model>/);
    const back = readExperiment(parseXml(xml).documentElement);
    expect(back).toEqual({ ...e, fields: { ...Object.fromEntries(Object.keys(back.fields).map((k) => [k, ''])), ...e.fields }, specimen: { ...Object.fromEntries(Object.keys(back.specimen).map((k) => [k, ''])), ...e.specimen }, instrument: { ...Object.fromEntries(Object.keys(back.instrument).map((k) => [k, ''])), ...e.instrument }, analysis: { ...Object.fromEntries(Object.keys(back.analysis).map((k) => [k, ''])), ...e.analysis } });
  });
  it('date format and empty detection', () => {
    expect(currentDate(new Date(2020, 0, 5))).toBe('05-JAN-2020');
    expect(isEmptyExperiment({ fields: {}, specimen: {}, instrument: {}, analysis: {}, figures: [] })).toBe(true);
    expect(isEmptyExperiment(newExperiment())).toBe(false);
  });
});

import { emptyWorkspace } from '../src/core/model';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';
describe('MIFlowCyt in .wsp (Workspace <experiment>)', () => {
  it('round-trips through wsp export and import', () => {
    const ws = emptyWorkspace();
    ws.samples.push({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', keywordsSnapshot: {}, channelNames: ['FSC-A'], eventCount: 1, populations: [] });
    ws.groups[0].sampleIds = ['s'];
    ws.experiment = newExperiment(new Date(2026, 0, 1));
    ws.experiment.fields.purpose = 'Check';
    ws.experiment.specimen.organism = 'Mouse';
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    expect(xml).toContain('<experiment><id></id>');
    const back = parseWsp(xml).workspace.experiment!;
    expect(back.fields.purpose).toBe('Check');
    expect(back.specimen.organism).toBe('Mouse');
    expect(back.fields.created).toBe('01-JAN-2026');
  });
});
