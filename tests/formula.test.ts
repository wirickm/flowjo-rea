// FlowJo 10.6.2 derived-parameter formulas (specs section 12): native Parser,
// FunctionInterpreter, Sample::DP_ReplaceParameterNames / ComputeAlgebraic,
// Java DerivedParameter naming.
import { describe, expect, it } from 'vitest';
import { compileFormula, defaultDerivedName, derivedNameError, MAX_FORMULA_VARIABLES } from '../src/core/formula';

const ev = (f: string, params: string[] = [], vals: number[] = []) => {
  const c = compileFormula(f, params);
  const v = Float64Array.from(c.variables.map((name) => (name === null ? NaN : vals[params.indexOf(name)])));
  return c.evaluate(v);
};

describe('precedence and operators (Parser)', () => {
  it('every operator is left-associative, ^ included; unary minus binds tighter than ^', () => {
    expect(ev('2^3^2')).toBe(64);
    expect(ev('-2^2')).toBe(4);
    expect(ev('10-4-3')).toBe(3);
    expect(ev('2+3*4')).toBe(14);
    expect(ev('((2+3))*4')).toBe(20);
  });
  it('comparisons and logic give 1 / 0; & and | share a priority; <> is not-equal', () => {
    expect(ev('3>2 & 2>1')).toBe(1);
    expect(ev('1 = 2 | 3 <> 3')).toBe(0);
    expect(ev('!0')).toBe(1);
    expect(ev('2<=2')).toBe(1);
  });
  it('% truncates both sides (remainder takes the dividend sign; divisor 0 gives 0); ^ of a negative base truncates the exponent; 0^x is 0', () => {
    expect(ev('7.9 % 2.5')).toBe(1);
    expect(ev('-7 % 2')).toBe(-1);
    expect(ev('5 % 0.5')).toBe(0);
    expect(ev('(-2)^2.7')).toBe(4);
    expect(ev('0^-1')).toBe(0);
  });
  it('numbers: exponents and signs inside the mantissa', () => {
    expect(ev('1e-2 * 100')).toBeCloseTo(1, 12);
    expect(ev('2.5E+1')).toBe(25);
  });
});

describe('functions (CreateNewFunction)', () => {
  it('log is base 10, ln natural; if needs 3 arguments; min / max / avg any count', () => {
    expect(ev('log(1000)')).toBeCloseTo(3, 12);
    expect(ev('LN(EXP(2))')).toBeCloseTo(2, 12);
    expect(ev('if(0, 1, 2)')).toBe(2);
    expect(ev('max(1, 5, 3)')).toBe(5);
    expect(ev('avg(1, 2, 3, 6)')).toBe(3);
  });
  it('SD and CV divide the root of the squared deviations by n - 1 (FlowJo quirk)', () => {
    expect(ev('sd(1, 3)')).toBeCloseTo(Math.sqrt(2), 12);
    expect(ev('cv(1, 3)')).toBeCloseTo(Math.sqrt(2) / 2, 12);
  });
});

describe('errors (Parser::ConvertErrorToString)', () => {
  const err = (f: string) => { try { ev(f); return ''; } catch (e) { return (e as Error).message; } };
  it('math, syntax and argument errors carry FlowJo\'s messages', () => {
    expect(err('1/0')).toBe('Illegal math parameter.');
    expect(err('sqrt(-1)')).toBe('Illegal math parameter.');
    expect(err('log(0)')).toBe('Illegal math parameter.');
    expect(err('')).toBe('Empty expression.');
    expect(err('(1+2')).toBe('Unbalanced open and close parentheses.');
    expect(err('foo(1)')).toBe('Unknown function.');
    expect(err('if(1, 2)')).toBe('Wrong number of arguments for function.');
    expect(err('1 2')).toBe('Missing operator in expression.');
  });
});

describe('parameter names (DP_ReplaceParameterNames)', () => {
  it('names with "-" or "/" are replaced before parsing, longest first, case-insensitive', () => {
    expect(ev('fl1-a / FL2-A', ['FL1-A', 'FL2-A'], [10, 4])).toBe(2.5);
    // "FL1-A-H" is longer than "FL1-A" and is replaced first.
    expect(ev('FL1-A-H - FL1-A', ['FL1-A', 'FL1-A-H'], [3, 10])).toBe(7);
    expect(ev('CD4/CD8 * 2', ['CD4/CD8'], [1.5])).toBe(3);
  });
  it('at most 8 variables: a 9th overwrites slot 0', () => {
    const names = Array.from({ length: 9 }, (_, i) => `P${i}`);
    const c = compileFormula(names.join(' + '), names);
    expect(c.variables.length).toBe(MAX_FORMULA_VARIABLES);
    expect(c.variables[0]).toBe('P8');
  });
  it('"Event #" is the event number', () => {
    expect(compileFormula('Event # * 2', []).variables).toEqual(['Event #']);
  });
});

describe('names (DerivedParameter.isNameOK, uniqueChildName)', () => {
  it('letters, digits and underscore only, not a number; duplicates refused', () => {
    expect(derivedNameError('Ratio_1', [])).toBeNull();
    expect(derivedNameError('New Parameter', [])).not.toBeNull();
    expect(derivedNameError('12', [])).not.toBeNull();
    expect(derivedNameError('A', ['A'])).toBe('Paramter with this name already exists');
    expect(defaultDerivedName([])).toBe('Derived');
    expect(defaultDerivedName(['Derived', 'Derived-1'])).toBe('Derived-2');
  });
});

describe('derived parameters in the engine and the workspace', () => {
  it('a formula parameter is computed per event (float32) and gates on it work', async () => {
    const { AnalysisService } = await import('../src/core/service');
    const { writeFcs } = await import('../src/core/fcsWriter');
    const svc = new AnalysisService();
    await svc.load('s', 's.fcs', writeFcs([{ name: 'FL1-A', range: 1024, values: Float64Array.from([1, 2, 3, 4]) }, { name: 'FL2-A', range: 1024, values: Float64Array.from([2, 2, 2, 2]) }], {}));
    const derived = [{ name: 'R', formula: 'FL1-A / FL2-A' }, { name: 'EVT', formula: 'Event #' }];
    const r = svc.analyze({ sampleId: 's', compensation: 'none', matrices: [], derived, populations: [{ id: 'g', name: 'g', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'R', transform: { kind: 'none' } }], min: [1], max: [null] } }] });
    expect(r.results[0].count).toBe(3);
    expect(Array.from(svc.dimensionValues({ sampleId: 's', compensation: 'none', matrices: [], derived, populations: [] }, { kind: 'channel', channel: 'EVT', transform: { kind: 'none' } }))).toEqual([0, 1, 2, 3]);
  });
  it('a math error in the formula makes gates on it fail with FlowJo\'s message', async () => {
    const { AnalysisService } = await import('../src/core/service');
    const { writeFcs } = await import('../src/core/fcsWriter');
    const svc = new AnalysisService();
    await svc.load('s', 's.fcs', writeFcs([{ name: 'A', range: 1024, values: Float64Array.from([1, 0]) }], {}));
    const r = svc.analyze({ sampleId: 's', compensation: 'none', matrices: [], derived: [{ name: 'Inv', formula: '1 / A' }], populations: [{ id: 'g', name: 'g', parentId: null, gate: { type: 'rect', dims: [{ kind: 'channel', channel: 'Inv', transform: { kind: 'none' } }], min: [0], max: [null] } }] });
    expect(r.results[0].error).toMatch(/Illegal math parameter/);
  });
  it('DerivedParameter nodes survive .wsp export and import', async () => {
    const { emptyWorkspace } = await import('../src/core/model');
    const { writeWsp } = await import('../src/core/wspWriter');
    const { parseWsp } = await import('../src/core/wsp');
    const ws = emptyWorkspace();
    ws.samples.push({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', keywordsSnapshot: {}, channelNames: ['FL1-A', 'FL2-A'], eventCount: 1, populations: [] });
    ws.groups[0].sampleIds = ['s'];
    ws.derivedParameters = [{ name: 'Ratio', formula: 'FL1-A / FL2-A' }, { name: 'Evt', formula: 'Event #' }];
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    expect(xml).toContain('<DerivedParameter name="Ratio" type="algebraic" formula="FL1-A / FL2-A">');
    expect(xml).toContain('type="eventNumber"');
    expect(parseWsp(xml).workspace.derivedParameters).toEqual(ws.derivedParameters);
  });
});
