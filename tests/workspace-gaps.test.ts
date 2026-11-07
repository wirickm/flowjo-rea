import { describe, expect, it } from 'vitest';
import { booleanGateName, combinationPatterns, compileBoolExpr, exprOfGate, makeAndOr, makeCombination, makeIdentities, makeNots, parseBoolExpr, formatBoolExpr } from '../src/core/booleanExpr';
import { compareSamples, excelRows, naturalCompare, parseFcsDate, sortSamples, valueSeries, keywordColumn, setKeyword, formatSeriesValue } from '../src/core/workspaceTable';
import { crc32, readZip, writeZip } from '../src/core/zip';
import { xlsxBytes } from '../src/core/xlsx';
import { applyGroupTemplates, buildArchive, makeTemplate, readArchive } from '../src/core/template';
import { emptyWorkspace, populationPath, type Population, type SampleState } from '../src/core/model';

const lin = { kind: 'linear' as const, T: 1024, A: 0 };
const rect = (id: string, name: string, parentId: string | null = null): Population => ({ id, name, parentId, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'FL1-A', transform: lin }], min: [0], max: [10] } });
const sample = (id: string, pops: Population[] = [], kw: Record<string, string> = {}): SampleState => ({ id, fileName: `${id}.fcs`, fileSize: 1, fingerprint: id, datasetIndex: 0, compensation: 'none', populations: pops, keywordsSnapshot: kw, channelNames: ['FL1-A'], eventCount: 100 });

describe('boolean gate names (AndOrNode.generateName, NotGateNode, IdentityNode)', () => {
  it('AND / OR join with " & " / " or " and add + unless the name already ends in it', () => {
    expect(booleanGateName('and', [{ name: 'CD107a+', isNot: false }, { name: 'IFNg+', isNot: false }])).toBe('CD107a+ & IFNg+');
    expect(booleanGateName('or', [{ name: 'CD107a+', isNot: false }, { name: 'IFNg+', isNot: false }])).toBe('CD107a+ or IFNg+');
    expect(booleanGateName('and', [{ name: 'CD4', isNot: false }, { name: 'CD8-', isNot: true }])).toBe('CD4+ & CD8-');
  });
  it('an operand named with " or " is bracketed; combination names have no connector', () => {
    expect(booleanGateName('and', [{ name: 'A+ or B+', isNot: false }, { name: 'C', isNot: false }])).toBe('(A+ or B+)+ & C+');
    expect(booleanGateName('and', [{ name: 'CD4', isNot: false }, { name: 'CD8-', isNot: true }], true)).toBe('CD4+CD8-');
    expect(booleanGateName('and', [{ name: 'Lymphocytes', isNot: false }], true, { Lymphocytes: 'L' })).toBe('L+');
  });
  it('makeAndOr / makeNots / makeIdentities place siblings with FlowJo names', () => {
    const s = sample('s', [rect('a', 'CD4'), rect('b', 'CD8')]);
    expect(makeAndOr(s, 'and', ['a', 'b'])!.name).toBe('CD4+ & CD8+');
    expect(makeAndOr(s, 'or', ['a'])).toBeNull();
    expect(makeNots(s, ['a', 'b']).map((p) => p.name)).toEqual(['CD4-', 'CD8-']);
    const id = makeIdentities(s, ['a'])[0];
    expect(id.name).toBe('CD4=');
    expect(id.gate).toEqual({ type: 'boolean', op: 'or', operands: [{ ref: 'a' }] });
  });
});

describe('Create Combination Gates (makeCombinationGates)', () => {
  it('patterns: positive first, first operand slowest', () => {
    expect(combinationPatterns(2)).toEqual([[true, true], [true, false], [false, true], [false, false]]);
    expect(combinationPatterns(3)).toHaveLength(8);
  });
  it('2 populations: two NOT nodes and four AND nodes in the parent', () => {
    const s = sample('s', [rect('p', 'Lymph'), rect('a', 'CD4', 'p'), rect('b', 'CD8', 'p')]);
    const out = makeCombination(s, ['a', 'b'])!;
    expect(out.map((p) => p.name)).toEqual(['CD4-', 'CD8-', 'CD4+CD8+', 'CD4+CD8-', 'CD4-CD8+', 'CD4-CD8-']);
    expect(out.every((p) => p.parentId === 'p')).toBe(true);
    const last = out[5].gate as Extract<Population['gate'], { type: 'boolean' }>;
    expect(last.op).toBe('and');
    expect(last.operands.map((o) => o.ref)).toEqual([out[0].id, out[1].id]);
  });
  it('abbreviations rename the subsets in the generated names; 1 or 13 populations are refused', () => {
    const s = sample('s', [rect('a', 'CD4 T'), rect('b', 'CD8 T')]);
    expect(makeCombination(s, ['a', 'b'], { 'CD4 T': '4', 'CD8 T': '8' })!.map((p) => p.name)).toEqual(['4-', '8-', '4+8+', '4+8-', '4-8+', '4-8-']);
    expect(makeCombination(s, ['a'])).toBeNull();
    const many = Array.from({ length: 13 }, (_, i) => rect(`p${i}`, `P${i}`));
    expect(makeCombination(sample('m', many), many.map((p) => p.id))).toBeNull();
  });
});

describe('Boolean Expression (own rule)', () => {
  it('parses mixed and / or / not with brackets and multi-word names', () => {
    const e = parseBoolExpr('(CD4 T cells and not CD8) or B');
    expect(formatBoolExpr(e)).toBe('("CD4 T cells" and not CD8) or B');
    expect(formatBoolExpr(parseBoolExpr('A & B | !C'))).toBe('(A and B) or not C');
    expect(() => parseBoolExpr('A and')).toThrow();
    expect(() => parseBoolExpr('(A or B')).toThrow();
  });
  it('compiles into FlowJo nodes, reusing an equivalent sibling', () => {
    const s = sample('s', [rect('a', 'A'), rect('b', 'B'), rect('c', 'C')]);
    const r = compileBoolExpr(s, null, parseBoolExpr('(A and B) or not C'));
    expect(r.gate.op).toBe('or');
    expect(r.added.map((p) => p.name)).toEqual(['A+ & B+', 'C-']);
    expect(r.name).toBe('A+ & B+ or C-');
    s.populations.push(...r.added);
    const again = compileBoolExpr(s, null, parseBoolExpr('not C and A'));
    expect(again.added).toEqual([]);
    expect(again.gate.operands[0].ref).toBe(r.added[1].id);
    expect(() => compileBoolExpr(s, null, parseBoolExpr('A and Z'))).toThrow(/Z/);
  });
  it('exprOfGate writes an existing gate back for editing', () => {
    const s = sample('s', [rect('a', 'A'), rect('b', 'B c'), { id: 'n', name: 'x', parentId: null, gate: { type: 'boolean', op: 'and', operands: [{ ref: 'a' }, { ref: 'b', complement: true }] } }]);
    expect(exprOfGate(s, 'n')).toBe('A and not "B c"');
  });
});

describe('workspace table', () => {
  it('natural order and FCS dates (SampleComparator)', () => {
    expect(naturalCompare('Tube 2', 'tube 10')).toBeLessThan(0);
    expect(parseFcsDate('05-JAN-2020')).toBe(Date.UTC(2020, 0, 5));
    expect(parseFcsDate('2020-03-01')).toBe(Date.UTC(2020, 2, 1));
    expect(parseFcsDate('nonsense')).toBeNull();
  });
  it('missing values sort first in both directions; multi-key sort', () => {
    const ws = emptyWorkspace();
    const a = sample('a', [], { T: '2', G: 'x' }), b = sample('b', [], { T: '10', G: 'x' }), c = sample('c', [], { G: 'a' });
    expect(compareSamples(ws, c, a, keywordColumn('T'), false)).toBe(-1);
    expect(sortSamples({ ...ws, tableSort: [{ key: keywordColumn('T'), ascending: false }] }, [a, b, c]).map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(sortSamples({ ...ws, tableSort: [{ key: keywordColumn('G'), ascending: true }, { key: keywordColumn('T'), ascending: false }] }, [a, b, c]).map((s) => s.id)).toEqual(['c', 'b', 'a']);
    const d1 = sample('d1', [], { $DATE: '01-FEB-2020' }), d2 = sample('d2', [], { $DATE: '15-JAN-2020' });
    expect(sortSamples({ ...ws, tableSort: [{ key: keywordColumn('$DATE'), ascending: true }] }, [d1, d2]).map((s) => s.id)).toEqual(['d2', 'd1']);
  });
  it('keyword value series (getValueSeries)', () => {
    expect(valueSeries(5, 1, 1, 1, 1, 0)).toEqual([1, 2, 3, 4, 5]);
    expect(valueSeries(6, 1, 1, 1, 2, 0)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(valueSeries(6, 10, 0, 2, 1, 3)).toEqual([10, 20, 40, 10, 20, 40]);
    expect(valueSeries(1, 5, 1, 1, 1, 0)).toEqual([5, 6]);
    expect(formatSeriesValue(2)).toBe('2');
    expect(formatSeriesValue(0.1 + 0.2)).toBe('0.3');
  });
  it('setKeyword and Excel rows', () => {
    const s = [sample('a'), sample('b', [rect('p', 'P')])];
    expect(setKeyword(s, 'Dose', ['1', '2'])).toBe(2);
    expect(s[1].annotations).toEqual({ Dose: '2' });
    const rows = excelRows(['Name', '#Cells'], [{ depth: 1, sample: s[1], popId: null, cells: ['b.fcs', '100'] }, { depth: 2, sample: s[1], popId: 'p', cells: ['P', '7'] }]);
    expect(rows).toEqual([['Depth', 'Name', '#Cells'], ['>', 'b.fcs', '100'], ['>>', 'b.fcs/P', '7']]);
  });
});

describe('zip, xlsx, template, archive', () => {
  it('crc32 and a zip round trip', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const z = writeZip([{ name: 'a.txt', data: 'hello' }, { name: 'b/c.bin', data: new Uint8Array([1, 2, 3]) }]);
    const back = readZip(z);
    expect(back.map((e) => e.name)).toEqual(['a.txt', 'b/c.bin']);
    expect(new TextDecoder().decode(back[0].data)).toBe('hello');
  });
  it('xlsx: numbers as numbers, text inline', () => {
    const parts = readZip(xlsxBytes('Workspace', [['Name', 'n'], ['a<b', '12.5']]));
    const sheet = new TextDecoder().decode(parts.find((p) => p.name === 'xl/worksheets/sheet1.xml')!.data);
    expect(sheet).toContain('<c r="B2"><v>12.5</v></c>');
    expect(sheet).toContain('a&lt;b');
    expect(parts.map((p) => p.name)).toContain('[Content_Types].xml');
  });
  it('template keeps group analysis without samples; new members receive it', () => {
    const ws = emptyWorkspace('W');
    const s1 = sample('s1', [{ ...rect('l', 'Lymph'), owningGroup: 'g' }, { ...rect('c', 'CD4', 'l'), owningGroup: 'g' }, rect('own', 'Mine')]);
    ws.samples.push(s1);
    ws.groups.push({ id: 'g', name: 'G', sampleIds: ['s1'] });
    const t = makeTemplate(ws);
    expect(t.samples).toEqual([]);
    expect(t.groups.find((g) => g.id === 'g')!.analysis!.map((p) => p.name)).toEqual(['Lymph', 'CD4']);
    const s2 = sample('s2');
    t.samples.push(s2);
    t.groups.find((g) => g.id === 'g')!.sampleIds.push('s2');
    expect(applyGroupTemplates(t)).toBe(true);
    expect(s2.populations.map((p) => populationPath(s2.populations, p.id))).toEqual(['Lymph', 'Lymph/CD4']);
    expect(s2.populations.every((p) => p.owningGroup === 'g')).toBe(true);
    expect(t.groups.find((g) => g.id === 'g')!.analysis).toBeUndefined();
  });
  it('archive round trip', () => {
    const a = buildArchive('{"x":1}', [{ name: 'a.fcs', bytes: new Uint8Array([9]) }, { name: 'a.fcs', bytes: new Uint8Array([8]) }]);
    const r = readArchive(a);
    expect(r.workspace).toBe('{"x":1}');
    expect(r.files.map((f) => f.name)).toEqual(['a.fcs', '1_a.fcs']);
  });
});

describe('.wsp workspace table columns', () => {
  it('imports FlowJo <Columns> and writes them back', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseWsp } = await import('../src/core/wsp');
    const { writeWsp } = await import('../src/core/wspWriter');
    const imp = parseWsp(readFileSync('fixtures/flowkit/data/8_color_data_set/8_color_ICS_simple.wsp', 'utf8'));
    expect(imp.workspace.tableColumns?.map((c) => c.key)).toEqual(['fj.appnode.prop.name', 'fj.appnode.prop.statistic', 'fj.appnode.prop.ncells', 'fj.appnode.prop.matrix']);
    const ws = imp.workspace;
    ws.tableColumns = [...ws.tableColumns!, { key: keywordColumn('$DATE'), width: 120 }];
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    expect(xml).toContain('<TColumn width="120" ><Keyword name="$DATE" /></TColumn>');
    expect(parseWsp(xml).workspace.tableColumns?.at(-1)).toEqual({ key: 'kw:$DATE', width: 120 });
  });
});
