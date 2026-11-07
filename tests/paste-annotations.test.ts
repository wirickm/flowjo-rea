import { describe, expect, it } from 'vitest';
import { parseTabOrCsv, pasteAnnotations } from '../src/core/project';
import type { SampleState } from '../src/core/model';

const sample = (id: string): SampleState => ({ id, fileName: `${id}.fcs`, fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: {}, channelNames: [], eventCount: 0 });

describe('text paste into the workspace table (specs 20.1)', () => {
  it('splits on tabs when present, else CSV with quotes', () => {
    expect(parseTabOrCsv('a\tb\n1\t2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseTabOrCsv('a,"b, c"\r\n1,"say ""hi"""')).toEqual([['a', 'b, c'], ['1', 'say "hi"']]);
  });
  it('with no keyword columns yet, the first row names them and rows fill down from the start sample', () => {
    const s = [sample('a'), sample('b'), sample('c')];
    expect(pasteAnnotations(s, 1, 'Donor\tDay\nD1\t0\nD2\t7\nD3\t14', [])).toBe(2);
    expect(s[0].annotations).toBeUndefined();
    expect(s[1].annotations).toEqual({ Donor: 'D1', Day: '0' });
    expect(s[2].annotations).toEqual({ Donor: 'D2', Day: '7' });
  });
  it('with existing columns, a data row maps onto them in order', () => {
    const s = [sample('a')];
    pasteAnnotations(s, 0, 'D9,21', ['Donor', 'Day']);
    expect(s[0].annotations).toEqual({ Donor: 'D9', Day: '21' });
  });
  it('a single value fills the first column of every selected sample', () => {
    const s = [sample('a'), sample('b'), sample('c')];
    expect(pasteAnnotations(s, 0, 'ctrl', ['Group'], ['a', 'c'])).toBe(2);
    expect([s[0].annotations, s[1].annotations, s[2].annotations]).toEqual([{ Group: 'ctrl' }, undefined, { Group: 'ctrl' }]);
  });
  it('a header alone changes nothing', () => {
    expect(pasteAnnotations([sample('a')], 0, 'Donor\tDay', [])).toBe(0);
  });
});
