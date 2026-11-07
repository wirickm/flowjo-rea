import { describe, expect, it } from 'vitest';
import { addKeywordToAll, duplicatePopulation, findKeywords, replaceKeywords } from '../src/core/project';
import type { SampleState } from '../src/core/model';

const sample = (id: string, kw: Record<string, string>, ann?: Record<string, string>): SampleState => ({ id, fileName: `${id}.fcs`, fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: kw, annotations: ann, channelNames: [], eventCount: 0 });

describe('workspace tree commands (specs 22.4)', () => {
  it('Add Keyword trims, appends "_" to reserved names and adds an empty value to every sample', () => {
    const s = [sample('a', {}, { Day: '7' }), sample('b', {})];
    expect(addKeywordToAll(s, '  Day ')).toBe('Day');
    expect(s[0].annotations).toEqual({ Day: '7' });
    expect(s[1].annotations).toEqual({ Day: '' });
    expect(addKeywordToAll(s, 'Panel')).toBe('Panel_');
    expect(addKeywordToAll(s, '   ')).toBeNull();
  });
  it('Find searches keyword values: substring, case-insensitive by default, whole word and context options', () => {
    const s = [sample('a', { $FIL: 'Donor12_CD4.fcs', TUBE: 'cd4' }), sample('b', { $FIL: 'x.fcs' }, { Group: 'CD4 stim' })];
    expect(findKeywords(s, 'cd4', {}).map((h) => `${h.sampleId}:${h.keyword}`)).toEqual(['a:$FIL', 'a:TUBE', 'b:Group']);
    expect(findKeywords(s, 'cd4', { matchCase: true }).map((h) => h.keyword)).toEqual(['TUBE']);
    expect(findKeywords(s, 'CD4', { wholeWord: true }).map((h) => h.keyword)).toEqual(['TUBE', 'Group']);
    expect(findKeywords(s, 'CD4', { keyword: 'Group' }).map((h) => h.sampleId)).toEqual(['b']);
  });
  it('Replace changes editable values only, whole value or the matched part', () => {
    const s = [sample('a', { TUBE: 'CD4' }, { Group: 'CD4 stim' })];
    const hits = findKeywords(s, 'cd4', {});
    expect(replaceKeywords(s, hits, 'cd4', 'CD8', { partial: true })).toBe(1);
    expect(s[0].annotations).toEqual({ Group: 'CD8 stim' });
    expect(s[0].keywordsSnapshot.TUBE).toBe('CD4');
  });
  it('Duplicate makes a sibling deep copy named by the unique-name rule', () => {
    const s = sample('a', {});
    const g = { type: 'rect', dims: [{ kind: 'channel', channel: 'FSC-A', transform: { kind: 'none' } }], min: [0], max: [10] } as unknown as import('../src/core/model').Gate;
    s.populations = [{ id: 'p', name: 'CD4', parentId: null, gate: g }, { id: 'c', name: 'Child', parentId: 'p', gate: g }];
    duplicatePopulation(s, 'p');
    const roots = s.populations.filter((p) => p.parentId === null).map((p) => p.name);
    expect(roots).toEqual(['CD4', 'CD4-1']);
    const copy = s.populations.find((p) => p.name === 'CD4-1')!;
    expect(s.populations.filter((p) => p.parentId === copy.id).map((p) => p.name)).toEqual(['Child']);
  });
});
