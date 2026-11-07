import { describe, expect, it } from 'vitest';
import { ConsoleHistory, newScript, parseScriptElements, presentation, scriptFileName, scriptFromFile, scriptsXml } from '../src/core/fjScript';
import { newCtx, runConsole, runScript, statKey, type ScriptSnapshot } from '../src/core/scriptApi';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';
import { readFileSync, existsSync } from 'node:fs';

const snap: ScriptSnapshot = {
  name: 'ws',
  groups: [{ name: 'All Samples', sampleIds: ['s1', 's2'] }],
  samples: [
    { id: 's1', name: 'a.fcs', keywords: { $FIL: 'a.fcs', TUBE: '1' }, params: [{ name: 'FSC-A', stain: '', longName: '', index: 1 }, { name: 'FL1-A', stain: 'CD3', longName: 'CD3 FITC', index: 2 }], total: 1000,
      pops: [{ id: 'p1', name: 'Lymph', parentId: null, count: 600 }, { id: 'p2', name: 'CD3+', parentId: 'p1', count: 300 }, { id: 'p3', name: 'CD3-', parentId: 'p1', count: 250 }] },
    { id: 's2', name: 'b.fcs', keywords: { $FIL: 'b.fcs' }, params: [], total: 2000,
      pops: [{ id: 'q1', name: 'Lymph', parentId: null, count: 1500 }, { id: 'q2', name: 'CD3+', parentId: 'q1', count: 900 }] },
  ],
};

const run = (code: string, cache: Record<string, number> = {}) => {
  const ctx = newCtx(snap, cache, 'test');
  runScript(code, ctx);
  return { ctx, text: ctx.out.map((o) => o.text).join(''), colors: ctx.out.map((o) => o.color) };
};

describe('Script Editor scripts (FJScript, ScriptEditorController)', () => {
  it('new script names are unique with -N suffixes (NameUtil.uniqueName)', () => {
    const a = newScript([]);
    expect(a.name).toBe('New Script');
    expect(newScript([a]).name).toBe('New Script-1');
    expect(newScript([a, { ...a, name: 'New Script-1' }]).name).toBe('New Script-2');
  });
  it('presentation string, file names and loading', () => {
    expect(presentation({ name: 'x', lang: 'text/javascript', script: 'a\nb\nc' })).toBe('x (3 lines)');
    expect(scriptFileName('my/sc\\ript')).toBe('my_sc_ript.fjs');
    expect(scriptFileName('done.fjs')).toBe('done.fjs');
    expect(scriptFromFile('count.fjs', 'a\r\nb')).toEqual({ name: 'count', lang: 'text/javascript', script: 'a\nb' });
  });
  it('round-trips the .wsp <Scripts> element', () => {
    const xml = scriptsXml([{ name: 'S <1>', lang: 'text/javascript', script: 'if (a < b) x = "q";' }, { name: 'Empty', lang: 'text/javascript', script: '' }]);
    expect(xml).toContain('<Script lang="text/javascript" name="S &lt;1&gt;">if (a &lt; b) x = &quot;q&quot;;</Script>');
    expect(xml).toContain('<Script lang="text/javascript" name="Empty" />');
    expect(scriptsXml([])).toBe('');
    expect(parseScriptElements([{ name: 'n', text: 't' }])).toEqual([{ name: 'n', lang: 'text/javascript', script: 't' }]);
  });
  it('imports <Scripts> from a FlowJo 10 workspace', () => {
    const f = 'fixtures/flowkit/data/8_color_data_set/8_color_ICS_simple.wsp';
    if (!existsSync(f)) return;
    const w = parseWsp(readFileSync(f, 'utf8')).workspace;
    expect(w.scripts?.length).toBe(1);
    expect(w.scripts![0].name.trim()).toBe('New Script');
    expect(w.scripts![0].script).toBe('');
  });
  it('writes scripts into an exported .wsp and reads them back', () => {
    const f = 'fixtures/flowkit/data/8_color_data_set/8_color_ICS_simple.wsp';
    if (!existsSync(f)) return;
    const ws = parseWsp(readFileSync(f, 'utf8')).workspace;
    ws.scripts = [{ name: 'Counts', lang: 'text/javascript', script: 'workspace.samples.counts\n// a < b' }];
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    expect(xml).toContain('<Scripts><Script lang="text/javascript" name="Counts">');
    expect(parseWsp(xml).workspace.scripts).toEqual(ws.scripts);
  });
  it('console history skips repeats, keeps 150 and pins at the ends', () => {
    const h = new ConsoleHistory();
    h.add('a'); h.add('a'); h.add(''); h.add('b');
    expect(h.items).toEqual(['a', 'b']);
    expect(h.move(-1)).toBe('b');
    expect(h.move(-1)).toBe('a');
    expect(h.move(-1)).toBe('a');
    expect(h.move(1)).toBe('b');
    for (let i = 0; i < 200; i++) h.add(`c${i}`);
    expect(h.items.length).toBe(150);
  });
});

describe('Script API (fj-scripting-api, WSScriptEvaluator scope)', () => {
  it('workspace, samples, names, paths, counts', () => {
    expect(run('workspace.name').text).toBe('ws\n');
    expect(run('workspace.samples.length').text).toBe('2\n');
    expect(run('workspace.samples.names').text).toBe('[a.fcs, b.fcs]\n');
    expect(run('workspace.getSamples().get(1).name').text).toBe('b.fcs\n');
    expect(run('workspace.samples["a.fcs"].count').text).toBe('1000\n');
    expect(run('workspace.samples[0].populations("Lymph/CD3+")[0].fullPath').text).toBe('a.fcs/Lymph/CD3+\n');
    expect(run('workspace.samples.populations("Lymph/*").counts').text).toBe('[300, 250, 900]\n');
    expect(run('workspace.samples.populations("**").paths').text).toBe('[Lymph, Lymph/CD3+, Lymph/CD3-, Lymph, Lymph/CD3+]\n');
    expect(run('workspace.samples.slice(-1).names').text).toBe('[b.fcs]\n');
    expect(run('String(workspace.samples)').text).toBe('PopulationList(2 nodes)\n');
  });
  it('filter with a function; console.log and errors', () => {
    expect(run('workspace.samples.populations("**").filter(function (p) { return p.count > 500; }).names').text).toBe('[Lymph, Lymph, CD3+]\n');
    const r = run('console.log("hi"); console.error("bad"); undefined');
    expect(r.text).toBe('hi\nbad\n');
    expect(r.colors).toEqual(['black', 'red']);
    const e = run('nosuch.x');
    expect(e.colors).toEqual(['red']);
    expect(e.text).toMatch(/nosuch/);
  });
  it('a fresh scope per run; sloppy-mode globals stay inside the run', () => {
    expect(run('var k = 5; k * 2').text).toBe('10\n');
    expect(run('typeof k').text).toBe('undefined\n');
    expect(run('typeof fetch + typeof self + typeof postMessage').text).toBe('undefinedundefinedundefined\n');
  });
  it('statistics come from the cache; missing ones read NaN and are requested', () => {
    const r = run('workspace.samples[0].populations("Lymph")[0].stat(stats.median("FSC-A"))');
    expect(r.text).toBe('NaN\n');
    const req = [...r.ctx.missing.values()];
    expect(req).toEqual([{ sampleId: 's1', path: 'Lymph', stat: 'median', channel: 'FSC-A' }]);
    const r2 = run('workspace.samples[0].populations("Lymph")[0].stat(stats.median("FSC-A"))', { [statKey(req[0])]: 123.5 });
    expect(r2.text).toBe('123.5\n');
    expect(r2.ctx.missing.size).toBe(0);
    expect(run('workspace.samples[0].populations("Lymph")[0].stat(stats.count())').text).toBe('600\n');
    expect([...run('workspace.samples.stats(stats.percentile("FL1-A", 95))').ctx.missing.values()].map((x) => x.percentile)).toEqual([95, 95]);
  });
  it('keywords, parameters and stains of a sample', () => {
    expect(run('workspace.samples[0].keywords["TUBE"]').text).toBe('1\n');
    expect(run('workspace.samples[0].parameters.names').text).toBe('[FSC-A, FL1-A]\n');
    expect(run('workspace.samples[0].parameters.withStain("CD3").name').text).toBe('FL1-A\n');
    expect(run('workspace.samples[0].stains').text).toBe('[CD3]\n');
    const r = run('var k = workspace.samples[1].keywords; k.set("TUBE", 7); k["DAY"] = "mon"; k.get("TUBE")');
    expect(r.text).toBe('7\n');
    expect(r.ctx.ops).toEqual([{ op: 'keyword', sampleId: 's2', key: 'TUBE', value: '7' }, { op: 'keyword', sampleId: 's2', key: 'DAY', value: 'mon' }]);
  });
  it('groups: create, add, remove (GroupMgrAPI, GroupAPI)', () => {
    const r = run('var g = workspace.groups.create("Big"); g.add(workspace.samples.filter(function (s) { return s.count > 1500; })); workspace.groups.names + " " + workspace.groups["Big"].samples.names');
    expect(r.text).toBe('[All Samples, Big] [b.fcs]\n');
    expect(r.ctx.ops).toEqual([{ op: 'groupCreate', name: 'Big' }, { op: 'groupAdd', name: 'Big', sampleId: 's2' }]);
    expect(run('workspace.groups.create("")').text).toBe('');
  });
  it('gating: rectangle and range add pending gates; setName renames', () => {
    const r = run('var s = workspace.samples[0]; var g = s.gating.range("Hi", "FL1-A", 10, 20); g.max = 30; var l = s.populations("Lymph")[0]; l.gating.rectangle("Box", "FSC-A", "FL1-A", 1, 2, 3, 4); l.setName("Lymphocytes"); s.children.length');
    expect(r.text).toBe('2\n');
    expect(r.ctx.ops).toEqual([
      { op: 'gate', sampleId: 's1', parentId: null, id: 'new:1', name: 'Hi', params: ['FL1-A'], min: [10], max: [30] },
      { op: 'gate', sampleId: 's1', parentId: 'p1', id: 'new:2', name: 'Box', params: ['FSC-A', 'FL1-A'], min: [1, 3], max: [2, 4] },
      { op: 'rename', sampleId: 's1', popId: 'p1', name: 'Lymphocytes' },
    ]);
    expect(run('workspace.samples[0].gating.range("Lymph", "FL1-A").name').text).toBe('Lymph-1\n');
  });
  it('math (MathUtil) and unsupported APIs report an error', () => {
    expect(run('math.mean([1, 2, 3]) + math.median([5, 1, 3]) + math.sqr(3)').text).toBe('14\n');
    expect(run('workspace.chart()').colors).toEqual(['red']);
    expect(run('movie.create()').text).toMatch(/not available/);
  });
  it('console keeps variables between commands and stores the last result in _', () => {
    const g: Record<string, unknown> = {};
    const saved = globalThis.console;
    try {
      const ctx = newCtx(snap, {}, 'FlowJo Scripting Console');
      runConsole('var n0 = workspace.samples.length', ctx, globalThis as unknown as Record<string, unknown>);
      runConsole('n0 + 1', ctx, globalThis as unknown as Record<string, unknown>);
      const text = ctx.out.map((o) => o.text).join('');
      expect(text).toBe('\n>>> var n0 = workspace.samples.length\n\n>>> n0 + 1\n      = 3\n');
      expect((globalThis as unknown as Record<string, unknown>)._).toBe(3);
      void g;
    } finally {
      globalThis.console = saved;
      for (const k of ['workspace', 'stats', 'math', 'movie', '_', 'n0']) delete (globalThis as unknown as Record<string, unknown>)[k];
    }
  });
});
