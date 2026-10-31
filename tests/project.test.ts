import { describe, expect, it } from 'vitest';
import { emptyWorkspace, populationPath, type SampleState } from '../src/core/model';
import { applySubtree, deserializeWorkspace, fingerprint, removePopulation, serializeWorkspace } from '../src/core/project';

const sample = (id: string, chans = ['FSC-A', 'SSC-A']): SampleState => ({
  id, fileName: `${id}.fcs`, fileSize: 1, fingerprint: '', datasetIndex: 0, compensation: 'none',
  populations: [], keywordsSnapshot: {}, channelNames: chans, eventCount: 10,
});
const dim = (c: string) => ({ kind: 'channel' as const, channel: c, transform: { kind: 'none' as const } });

function build() {
  const ws = emptyWorkspace('t');
  const a = sample('a');
  a.populations = [
    { id: 'p1', name: 'Cells', parentId: null, gate: { type: 'rect', dims: [dim('FSC-A')], min: [10], max: [null] } },
    { id: 'p2', name: 'Big', parentId: 'p1', gate: { type: 'rect', dims: [dim('SSC-A')], min: [5], max: [null] } },
    { id: 'p3', name: 'NotBig', parentId: 'p1', gate: { type: 'boolean', op: 'not', operands: [{ ref: 'p2' }] } },
  ];
  ws.samples.push(a, sample('b'), sample('c', ['FSC-A']));
  ws.groups[0].sampleIds = ['a', 'b', 'c'];
  return ws;
}

describe('workspace persistence', () => {
  it('round-trips exactly', () => {
    const ws = build();
    expect(deserializeWorkspace(serializeWorkspace(ws))).toEqual(ws);
  });
  it('rejects malformed files with specific errors', () => {
    expect(() => deserializeWorkspace('{')).toThrow(/not valid JSON/);
    expect(() => deserializeWorkspace('{"format":"x"}')).toThrow(/Not a flowjo-rea/);
    const ws = build();
    ws.samples[0].populations[1].parentId = 'nope';
    expect(() => deserializeWorkspace(serializeWorkspace(ws))).toThrow(/missing parent/);
    const ws2 = build();
    ws2.groups[0].sampleIds.push('zzz');
    expect(() => deserializeWorkspace(serializeWorkspace(ws2))).toThrow(/unknown samples/);
  });
  it('fingerprints with SHA-256', async () => {
    expect(await fingerprint(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('apply gates across samples', () => {
  it('copies a subtree with remapped boolean operands and warns on missing channels', () => {
    const ws = build();
    const warnings = applySubtree(ws, 'a', 'p1', ['b', 'c']);
    const b = ws.samples[1];
    expect(b.populations.map((p) => populationPath(b.populations, p.id))).toEqual(['Cells', 'Cells/Big', 'Cells/NotBig']);
    const not = b.populations.find((p) => p.name === 'NotBig')!;
    const big = b.populations.find((p) => p.name === 'Big')!;
    expect(not.gate.type === 'boolean' && not.gate.operands[0].ref).toBe(big.id);
    expect(warnings.join(' ')).toMatch(/c.fcs: "Big" uses channels not in this sample: SSC-A/);
  });
  it('re-applying replaces rather than duplicates', () => {
    const ws = build();
    applySubtree(ws, 'a', 'p1', ['b']);
    applySubtree(ws, 'a', 'p1', ['b']);
    expect(ws.samples[1].populations).toHaveLength(3);
  });
  it('removePopulation removes descendants', () => {
    const ws = build();
    removePopulation(ws.samples[0], 'p1');
    expect(ws.samples[0].populations).toEqual([]);
  });
});

describe('live groups by keyword or annotation', () => {
  it('one group per value with a missing bucket; annotation overrides keyword', async () => {
    const { groupByKey } = await import('../src/core/project');
    const ws = build();
    ws.samples[0].keywordsSnapshot = { 'TUBE NAME': 'A' };
    ws.samples[1].keywordsSnapshot = { 'TUBE NAME': 'B' };
    ws.samples[1].annotations = { 'TUBE NAME': 'A' };
    expect(groupByKey(ws, 'TUBE NAME')).toEqual(['TUBE NAME = (missing)', 'TUBE NAME = A']);
    expect(ws.groups.find((g) => g.name === 'TUBE NAME = A')!.sampleIds).toEqual(['a', 'b']);
  });
  it('membership follows later edits and new samples; renamed groups keep their rule', async () => {
    const { groupByKey, syncLiveGroups } = await import('../src/core/project');
    const ws = build();
    ws.samples[0].annotations = { Condition: 'stim' };
    groupByKey(ws, 'Condition');
    const stim = ws.groups.find((g) => g.name === 'Condition = stim')!;
    stim.name = 'Stimulated';
    ws.samples[1].annotations = { Condition: 'stim' };
    ws.samples.push({ ...ws.samples[2], id: 'd', fileName: 'd.fcs', annotations: { Condition: 'stim' } });
    expect(syncLiveGroups(ws)).toBe(true);
    expect(stim.sampleIds).toEqual(['a', 'b', 'd']);
    expect(ws.groups.find((g) => g.name === 'Condition = (missing)')!.sampleIds).toEqual(['c']);
    expect(syncLiveGroups(ws)).toBe(false);
    groupByKey(ws, 'Condition'); // re-running does not duplicate the renamed group
    expect(ws.groups.filter((g) => g.criteria && 'value' in g.criteria && g.criteria.value === 'stim')).toHaveLength(1);
  });
});
