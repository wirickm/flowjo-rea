// FlowJo 10.6.2 group criteria (specs section 7.1), read with Ghidra from
// KeywordCriterion, GroupCriteria, CriteriaTest, Group$Role, ParameterList and
// ParseUtil. Each test states the FlowJo rule it checks.
import { describe, expect, it } from 'vitest';
import {
  acceptCriteria, compareToIgnoreCase, connectorFromText, evalRule, evalRules, everyNth, flowjoIsNumber,
  flowjoKeywordValue, functionFromText, removeFromGroup, roleFromText, stainSet,
} from '../src/core/groupCriteria';
import { emptyWorkspace, type KeywordRule, type SampleState } from '../src/core/model';
import { syncLiveGroups } from '../src/core/project';

const sample = (id: string, kw: Record<string, string>, fileName = `${id}.fcs`): SampleState => ({
  id, fileName, fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: kw, channelNames: [], eventCount: 0,
});
const rule = (keyword: string, op: KeywordRule['op'], value: string, connector: KeywordRule['connector'] = 'and'): KeywordRule => ({ connector, keyword, op, value });

describe('criterion functions (KeywordCriterion.evalFunction)', () => {
  it('compares numerically when the sample value is a number', () => {
    const s = sample('a', { DOSE: ' 10 ' });
    expect(evalRule(s, rule('DOSE', 'gt', '9'))).toBe(true); // 10 > 9, not "10" < "9" as text
    expect(evalRule(s, rule('DOSE', 'lte', '10.0'))).toBe(true);
    expect(evalRule(s, rule('DOSE', 'equals', '1e1'))).toBe(true);
    expect(evalRule(s, rule('DOSE', 'lt', '10'))).toBe(false);
  });
  it('compares text case-insensitively otherwise', () => {
    const s = sample('a', { TUBE: 'beta' });
    expect(evalRule(s, rule('TUBE', 'equals', 'BETA'))).toBe(true);
    expect(evalRule(s, rule('TUBE', 'gt', 'alpha'))).toBe(true);
    expect(evalRule(s, rule('TUBE', 'lt', 'Alpha'))).toBe(false);
    expect(evalRule(s, rule('TUBE', 'notEquals', 'beta'))).toBe(false);
  });
  it('Contains and Lacks are case-insensitive substring tests; Exists is true when the keyword is present', () => {
    const s = sample('a', { $FIL: 'Comp_FITC.fcs' });
    expect(evalRule(s, rule('$FIL', 'contains', 'comp'))).toBe(true);
    expect(evalRule(s, rule('$FIL', 'notContains', 'COMP'))).toBe(false);
    expect(evalRule(s, rule('$FIL', 'exists', 'x'))).toBe(true);
  });
  it('a missing keyword is false for every function, Lacks and Exists included', () => {
    const s = sample('a', {});
    for (const op of ['equals', 'notEquals', 'contains', 'notContains', 'exists'] as const) expect(evalRule(s, rule('NOPE', op, 'x'))).toBe(false);
  });
  it('a numeric sample value with a non-numeric criterion value does not match (FlowJo raises an error)', () => {
    expect(evalRule(sample('a', { DOSE: '5' }), rule('DOSE', 'gt', 'abc'))).toBe(false);
  });
});

describe('combination (KeywordCriterion.eval / evalConnector)', () => {
  it('starts true and applies every connector, the first one included', () => {
    const s = sample('a', { $FIL: 'sample.fcs' });
    // First criterion with "Or": true Or anything = true.
    expect(evalRules(s, [rule('$FIL', 'contains', 'nomatch', 'or')])).toBe(true);
    // First criterion with "& Not": true and not(hit).
    expect(evalRules(s, [rule('$FIL', 'contains', 'sample', 'andNot')])).toBe(false);
    expect(evalRules(s, [rule('$FIL', 'contains', 'x', 'and'), rule('$FIL', 'contains', 'sample', 'or')])).toBe(true);
  });
  it('skips inactive criteria (empty value), even Exists', () => {
    const s = sample('a', { $FIL: 'sample.fcs' });
    expect(evalRules(s, [rule('$FIL', 'contains', 'sample'), rule('$FIL', 'contains', '', 'andNot')])).toBe(true);
  });
  it('reads at most 4 criteria', () => {
    const s = sample('a', { K: 'v' });
    const four = [rule('K', 'contains', 'v'), rule('K', 'contains', 'v'), rule('K', 'contains', 'v'), rule('K', 'contains', 'v')];
    expect(evalRules(s, [...four, rule('K', 'contains', 'v', 'andNot')])).toBe(true);
  });
});

describe('group acceptance (GroupCriteria.acceptSolo / accept)', () => {
  const ws = emptyWorkspace();
  const kw = { $PAR: '4', $P1N: 'FSC-A', $P2N: 'SSC-A', $P3N: 'FL1-A', $P3S: ' CD3 ', $P4N: 'Time', $P4S: 'x' };
  const a = sample('a', { ...kw, TUBE: '1' });
  ws.samples.push(a);
  it('accepts nothing without stain sets or an active first criterion', () => {
    expect(acceptCriteria(ws, a, { rules: [] })).toBe(false);
    expect(acceptCriteria(ws, a, { rules: [rule('TUBE', 'equals', ''), rule('TUBE', 'equals', '1')] })).toBe(false);
  });
  it('stain set is the trimmed $PnS of non-scatter, non-time parameters', () => {
    expect(stainSet(a)).toBe('CD3');
    expect(acceptCriteria(ws, a, { rules: [], stains: ['CD3'] })).toBe(true);
    expect(acceptCriteria(ws, a, { rules: [], stains: ['CD4'] })).toBe(false);
  });
  it('a reference group combines with "also" (either) and "only" (both); other functions accept nothing', () => {
    ws.groups.push({ id: 'r', name: 'Ref', sampleIds: ['a'] });
    const no = rule('TUBE', 'equals', '2');
    expect(acceptCriteria(ws, a, { rules: [no], refGroup: { name: 'Ref', fn: 'also' } })).toBe(true);
    expect(acceptCriteria(ws, a, { rules: [no], refGroup: { name: 'Ref', fn: 'only' } })).toBe(false);
    expect(acceptCriteria(ws, a, { rules: [rule('TUBE', 'equals', '1')], refGroup: { name: 'Ref', fn: 'other' } })).toBe(false);
  });
  it('live groups recompute membership with these rules', () => {
    ws.groups.push({ id: 'l', name: 'Tube 1', sampleIds: [], criteria: { rules: [rule('TUBE', 'gte', '1')] } });
    syncLiveGroups(ws);
    expect(ws.groups.find((g) => g.id === 'l')!.sampleIds).toEqual(['a']);
  });
});

describe('keyword lookup and number test', () => {
  it('a parameter name gives its stain; FILENAME the file name; "a + b" joins values', () => {
    const s = sample('a', { $PAR: '1', $P1N: 'FL1-A', $P1S: 'CD3', TUBE: '7', DAY: '2' }, 'x.fcs');
    expect(flowjoKeywordValue(s, 'FL1-A')).toBe('CD3');
    expect(flowjoKeywordValue(s, 'FILENAME')).toBe('x.fcs');
    expect(flowjoKeywordValue(s, 'TUBE + DAY')).toBe('7 2');
  });
  it('ParseUtil.isNumber: "0" yes, "null" and empty no, one trailing % ignored, "%" alone yes', () => {
    expect(['0', '12.5%', '%', ' 3 ', '1e3', '1,000'].every(flowjoIsNumber)).toBe(true);
    expect(['', 'null', 'abc', undefined].some(flowjoIsNumber)).toBe(false);
  });
  it('compareToIgnoreCase follows Java (shorter prefix is smaller)', () => {
    expect(compareToIgnoreCase('ab', 'AB')).toBe(0);
    expect(compareToIgnoreCase('ab', 'abc')).toBeLessThan(0);
  });
});

describe('.wsp texts, roles, every n-th, remove from group', () => {
  it('reads FlowJo function and connector texts trimmed and case-insensitively; unknown -> "=" / "And"', () => {
    expect(functionFromText(' contains ')).toBe('contains');
    expect(functionFromText('≠')).toBe('notEquals');
    expect(functionFromText('Whatever')).toBe('equals');
    expect(connectorFromText('& not')).toBe('andNot');
    expect(connectorFromText('???')).toBe('and');
  });
  it('reads roles by substring; replicate, baseline and gating level read back as undefined, as in FlowJo', () => {
    expect(roleFromText('ws.group.dlog.compensation')).toBe('compensation');
    expect(roleFromText('ws.group.dlog.test')).toBe('test');
    expect(roleFromText('ws.group.dlog.replicate')).toBe('undefined');
    expect(roleFromText('ws.group.dlog.baseline')).toBe('undefined');
  });
  it('every n-th sample from the first; n below 1 is 1', () => {
    expect(everyNth(['a', 'b', 'c', 'd', 'e'], 2)).toEqual(['a', 'c', 'e']);
    expect(everyNth(['a', 'b'], 0)).toEqual(['a', 'b']);
  });
  it('removes samples from a manual group only; All Samples and live groups keep computed membership', () => {
    const ws = emptyWorkspace();
    ws.groups.push({ id: 'm', name: 'M', sampleIds: ['a', 'b'] }, { id: 'l', name: 'L', sampleIds: ['a'], criteria: { rules: [] } });
    expect(removeFromGroup(ws, 'm', ['a'])).toBe(true);
    expect(ws.groups.find((g) => g.id === 'm')!.sampleIds).toEqual(['b']);
    expect(removeFromGroup(ws, 'all', ['a'])).toBe(false);
    expect(removeFromGroup(ws, 'l', ['a'])).toBe(false);
  });
});
