// FlowJo 10.6.2 group-owned analysis (specs section 7.2): WSGroupMgr,
// GroupDelConfirmationDlog and the group texts, read with Ghidra.
import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Gate, type SampleState, type Workspace } from '../src/core/model';
import { copyAnalysisToGroup, deleteGroupAnalysis, propagateOwnedEdits, renameGroupAnalysis, syncLiveGroups } from '../src/core/project';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';
import { haveFixtures, readText } from './fixtures';

const rect = (lo: number): Gate => ({ type: 'rect', dims: [{ kind: 'channel', channel: 'A', transform: { kind: 'linear', T: 1024, A: 0 } }], min: [lo], max: [100] });
const sample = (id: string, tube = '1'): SampleState => ({ id, fileName: `${id}.fcs`, fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: { TUBE: tube }, channelNames: ['A'], eventCount: 0 });

function setup(): Workspace {
  const ws = emptyWorkspace();
  ws.samples.push(sample('a'), sample('b'), sample('c'));
  ws.groups[0].sampleIds = ['a', 'b', 'c'];
  ws.groups.push({ id: 'g', name: 'G', sampleIds: ['a', 'b'] });
  ws.samples[0].populations.push({ id: 'p1', name: 'Lymph', parentId: null, gate: rect(10) }, { id: 'p2', name: 'CD3', parentId: 'p1', gate: rect(20), exclude: true });
  copyAnalysisToGroup(ws, 'a', 'p1', 'g');
  return ws;
}

describe('copy analysis to group', () => {
  it('copies the subtree to every member and makes it group-owned, in the source too', () => {
    const ws = setup();
    for (const id of ['a', 'b']) {
      const s = ws.samples.find((x) => x.id === id)!;
      expect(s.populations.map((p) => [p.name, p.owningGroup])).toEqual([['Lymph', 'g'], ['CD3', 'g']]);
    }
    expect(ws.samples.find((x) => x.id === 'c')!.populations).toEqual([]);
  });
  it('keeps the exclusion flag on copied populations', () => {
    expect(setup().samples[1].populations.find((p) => p.name === 'CD3')!.exclude).toBe(true);
  });
});

describe('synchronized groups', () => {
  it('an edit to a group-owned gate moves it in every member only when the group is synchronized', () => {
    const ws = setup();
    ws.samples[0].populations.find((p) => p.name === 'Lymph')!.gate = rect(30);
    propagateOwnedEdits(ws, 'a', [ws.samples[0].populations[0].id]);
    expect((ws.samples[1].populations.find((p) => p.name === 'Lymph')!.gate as unknown as { min: number[] }).min).toEqual([10]);
    ws.groups.find((g) => g.id === 'g')!.synchronized = true;
    propagateOwnedEdits(ws, 'a', [ws.samples[0].populations[0].id]);
    const b = ws.samples[1].populations.find((p) => p.name === 'Lymph')!;
    expect((b.gate as unknown as { min: number[] }).min).toEqual([30]);
    expect(b.owningGroup).toBe('g');
  });
});

describe('deleting group-owned analysis (Allocate To Samples / To First Sample / Delete Entirely)', () => {
  it('Allocate To Samples keeps the populations in every member, now sample-owned', () => {
    const ws = setup();
    deleteGroupAnalysis(ws, 'g', 'Lymph', 'allocateToSamples');
    for (const id of ['a', 'b']) expect(ws.samples.find((x) => x.id === id)!.populations.map((p) => p.owningGroup)).toEqual([undefined, undefined]);
  });
  it('Allocate To First Sample keeps them only in the first member', () => {
    const ws = setup();
    deleteGroupAnalysis(ws, 'g', 'Lymph', 'allocateToFirst');
    expect(ws.samples[0].populations).toHaveLength(2);
    expect(ws.samples[1].populations).toHaveLength(0);
  });
  it('Delete Entirely removes them from every member', () => {
    const ws = setup();
    deleteGroupAnalysis(ws, 'g', 'Lymph', 'deleteEntirely');
    expect(ws.samples[0].populations).toHaveLength(0);
    expect(ws.samples[1].populations).toHaveLength(0);
  });
});

describe('rename for all and new members', () => {
  it('renames a group-owned population in every member', () => {
    const ws = setup();
    renameGroupAnalysis(ws, 'g', 'Lymph', 'Lymphocytes');
    expect(ws.samples.slice(0, 2).map((s) => s.populations[0].name)).toEqual(['Lymphocytes', 'Lymphocytes']);
  });
  it('a sample joining a live group receives the group-owned analysis', () => {
    const ws = setup();
    const g = ws.groups.find((x) => x.id === 'g')!;
    g.criteria = { rules: [{ connector: 'and', keyword: 'TUBE', op: 'equals', value: '1' }] };
    syncLiveGroups(ws);
    expect(g.sampleIds).toEqual(['a', 'b', 'c']);
    expect(ws.samples[2].populations.map((p) => [p.name, p.owningGroup])).toEqual([['Lymph', 'g'], ['CD3', 'g']]);
  });
});

describe('.wsp group ownership', () => {
  it.skipIf(!haveFixtures)('imports FlowJo-saved owningGroup on populations', () => {
    const imp = parseWsp(readText('8_color_data_set/8_color_ICS.wsp'));
    const den = imp.workspace.groups.find((g) => g.name === 'DEN');
    const owned = imp.workspace.samples.flatMap((s) => s.populations).filter((p) => p.owningGroup);
    expect(den).toBeDefined();
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.every((p) => imp.workspace.groups.some((g) => g.id === p.owningGroup))).toBe(true);
    // FlowJo-saved display attributes and role of the Compensation group.
    const comp = imp.workspace.groups.find((g) => g.name === 'Compensation')!;
    expect([comp.role, comp.color, comp.fontStyle]).toEqual(['compensation', '#bc1900', 'bold']);
  });
  it('writes owningGroup, synchronized and role, and reads them back', () => {
    const ws = setup();
    const g = ws.groups.find((x) => x.id === 'g')!;
    g.synchronized = true;
    g.role = 'compensation';
    g.color = '#bc1900';
    g.fontStyle = 'bold';
    const back = parseWsp(writeWsp({ ws, sampleMatrix: () => null }).xml).workspace;
    const bg = back.groups.find((x) => x.name === 'G')!;
    expect(bg.synchronized).toBe(true);
    expect(bg.role).toBe('compensation');
    expect([bg.color, bg.fontStyle]).toEqual(['#bc1900', 'bold']);
    expect(back.samples[1].populations.every((p) => p.owningGroup === bg.id)).toBe(true);
  });
});
