import { describe, expect, it } from 'vitest';
import { ConsoleHistory, newScript, parseScriptElements, presentation, scriptFileName, scriptFromFile, scriptsXml } from '../src/core/fjScript';
import { newCtx, runConsole, runScript, statKey, MATH, type ScriptSnapshot } from '../src/core/scriptApi';
import { maskCount, maskFromBits, maskToBits, parseFileMask } from '../src/core/fileMask';
import { movieHtml, chartItem } from '../src/ui/scriptCharts';
import { emptyWorkspace } from '../src/core/model';
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
  it('math (MathUtil)', () => {
    expect(run('math.mean([1, 2, 3]) + math.median([5, 1, 3]) + math.sqr(3)').text).toBe('14\n');
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

// The full API over a snapshot with gates, statistics and an attached file.
const snap2: ScriptSnapshot = {
  ...structuredClone(snap),
  stats: [{ id: 'c1', path: 'Lymph', stat: 'median', channel: 'FSC-A' }],
  files: [{ name: 'mask.csv', text: 'keep\n1\n0\n2\n0.5\n' }],
};
snap2.samples[0].events = 6;
snap2.samples[0].pops[0].gate = { kind: 'rect', params: ['FSC-A', 'FL1-A'], min: [10, 20], max: [100, Infinity] };
snap2.samples[0].pops[1].gate = { kind: 'range', params: ['FL1-A'], min: [5], max: [50], not: true };
snap2.samples[0].pops[2].gate = { kind: 'other', params: [], min: [], max: [] };
const run2 = (code: string) => {
  const ctx = newCtx(snap2, {}, 'test');
  runScript(code, ctx);
  return { ctx, text: ctx.out.map((o) => o.text).join(''), colors: ctx.out.map((o) => o.color) };
};

describe('Script API follow-up (charts, movies, display, add/remove, fileMask, annotation, not/magnetic)', () => {
  it('gate nodes get their FlowJo API type (GatePopAPIFactory)', () => {
    expect(run2('var p = workspace.samples[0].populations("**"); p[0].typeName + " " + p[1].typeName + " " + p[2].typeName').text).toBe('RectangleGate RangeGate PopulationNode\n');
    expect(run2('var l = workspace.samples[0].populations("Lymph")[0]; l.minX + "," + l.maxY + "," + l.getMinY()').text).toBe('10,Infinity,20\n');
  });
  it('RectGateAPI / RangeGateAPI setters edit an existing gate (gateEdit)', () => {
    const r = run2('var l = workspace.samples[0].populations("Lymph")[0]; l.maxX = 200; l.setMinY(1); workspace.samples[0].populations("Lymph/CD3+")[0].max = 60; l.maxX');
    expect(r.text).toBe('200\n');
    expect(r.ctx.ops).toEqual([
      { op: 'gateEdit', sampleId: 's1', popId: 'p1', max: [200, Infinity], min: [10, 1] },
      { op: 'gateEdit', sampleId: 's1', popId: 'p2', max: [60] },
    ]);
  });
  it('not / magnetic flags (GatedPopulationAPI) on existing and new gates; update() is accepted', () => {
    const r = run2('var c = workspace.samples[0].populations("Lymph/CD3+")[0]; var a = c.not; c.not = false; var o = workspace.samples[0].populations("Lymph/CD3-")[0]; o.setMagnetic(true); o.update(); var g = workspace.samples[0].gating.range("R", "FL1-A", 1, 2); g.not = true; a + " " + c.isNot() + " " + o.magnetic');
    expect(r.text).toBe('true false true\n');
    expect(r.ctx.ops).toEqual([
      { op: 'gateEdit', sampleId: 's1', popId: 'p2', not: false },
      { op: 'gateEdit', sampleId: 's1', popId: 'p3', magnetic: true },
      { op: 'gate', sampleId: 's1', parentId: null, id: 'new:1', name: 'R', params: ['FL1-A'], min: [1], max: [2], not: true },
    ]);
  });
  it('annotation get / set on populations and samples (AppNodeAPI)', () => {
    const r = run2('var l = workspace.samples[0].populations("Lymph")[0]; var a = l.annotation; l.annotation = "checked"; l.setAnnotation("ok"); workspace.samples[1].setAnnotation("s"); a + " " + l.getAnnotation()');
    expect(r.text).toBe('null ok\n');
    expect(r.ctx.ops).toEqual([{ op: 'annotation', sampleId: 's1', popId: 'p1', text: 'ok' }, { op: 'annotation', sampleId: 's2', popId: null, text: 's' }]);
  });
  it('statistic nodes are children typed "Node"; add / remove them', () => {
    expect(run2('var k = workspace.samples[0].populations("Lymph")[0].children; k.length + " " + k[2].typeName + " " + k[2].name + " " + k[2].path').text).toBe('3 Node Median : FSC-A Lymph/Median : FSC-A\n');
    const r = run2('var l = workspace.samples[0].populations("Lymph")[0]; var st = l.children[2]; workspace.samples[0].add(st); l.remove(st); l.children.length');
    expect(r.text).toBe('2\n');
    expect(r.ctx.ops).toEqual([{ op: 'statAdd', id: 'new:1', path: '', stat: 'median', channel: 'FSC-A' }, { op: 'statRemove', id: 'c1' }]);
  });
  it('add copies a population subtree (replacing a same-named child); remove drops children only', () => {
    const r = run2('var src = workspace.samples[0].populations("Lymph")[0]; var t = workspace.samples[1]; t.add(src); String(t.populations("Lymph/*").map(function (p) { return p.name; })) + " " + t.populations("Lymph")[0].typeName');
    expect(r.text).toBe('CD3+,CD3- RectangleGate\n');
    expect(r.ctx.ops).toEqual([{ op: 'copy', fromSampleId: 's1', fromPopId: 'p1', sampleId: 's2', parentId: null, ids: { p1: 'new:1', p2: 'new:2', p3: 'new:3' } }]);
    const d = run2('var s = workspace.samples[0]; s.remove(s.populations("Lymph/CD3+")[0]); s.populations("Lymph")[0].remove(s.populations("Lymph/CD3+")[0]); String(s.populations("**").map(function (p) { return p.name; }))');
    expect(d.text).toBe('Lymph,CD3-\n');
    expect(d.ctx.ops).toEqual([{ op: 'remove', sampleId: 's1', popId: 'p2' }]);
    expect(run2('var l = workspace.samples[0].populations("Lymph")[0]; l.populations("CD3+")[0].add(l)').colors).toEqual(['red']);
  });
  it('fileMask reads an attached file (FileMaskToBoolsMask rules); FileMaskGateAPI.file', () => {
    const r = run2('var g = workspace.samples[0].gating.fileMask("M", "file:///data/mask.csv"); g.typeName + " " + g.file');
    expect(r.text).toBe('FileMaskGate file:///data/mask.csv\n');
    const op = r.ctx.ops[0];
    expect(op.op === 'gate' && op.kind).toBe('mask');
    expect(op.op === 'gate' && Array.from(maskFromBits(op.bits!, 6))).toEqual([1, 0, 1, 1, 0, 0]);
    expect(run2('workspace.samples[0].gating.fileMask("M", "/x/none.csv")').text).toMatch(/Cannot read the mask file "none.csv"/);
  });
  it('parseFileMask: tab or comma, header rows skipped, first column > 0, extra rows ignored', () => {
    expect(Array.from(parseFileMask('a\tb\n1\t0\n0\t1\n3.5\t0\n', 4))).toEqual([1, 0, 1, 0]);
    expect(Array.from(parseFileMask('0,1\r\n1,0\r\n1,1\r\n', 2))).toEqual([0, 1]);
    expect(Array.from(parseFileMask('-1\n1\n', 2))).toEqual([1, 0]);
    const m = new Uint8Array(20); m[3] = 1; m[19] = 1;
    expect(maskCount(maskToBits(m), 20)).toBe(2);
  });
  it('display(), display(x), display(x, y) open graph windows (ChartWindowAPI)', () => {
    const r = run2('var w = workspace.samples[0].populations("Lymph")[0].display("FL1-A"); w.location(30, 40); var w2 = workspace.samples[1].display(); w2.close(); w.name + " " + w.x + " " + w.typeName');
    expect(r.text).toBe('a.fcs: Lymph 30 ChartWindow\n');
    expect(r.ctx.ops).toEqual([{ op: 'plot', path: 'Lymph', kind: 'histogram', x: 'FL1-A', y: null }]);
    expect(r.ctx.effects).toEqual([{ kind: 'open', sampleId: 's1', popId: 'p1', win: 1 }, { kind: 'move', win: 1, x: 30, y: 40 }, { kind: 'open', sampleId: 's2', popId: null, win: 2 }, { kind: 'close', win: 2 }]);
    expect(run2('workspace.samples[0].display("FSC-A", "FL1-A")').ctx.ops[0]).toEqual({ op: 'plot', path: '', kind: 'pseudocolor', x: 'FSC-A', y: 'FL1-A' });
  });
  it('workspace.chart(): type, parameters, layers, display, export (ChartAPI)', () => {
    expect(run2('var c = workspace.chart(); c.type + " " + c.parameters.length + " " + c').text).toBe('Pseudocolor 0 Chart(ws)\n');
    expect(run2('var c = workspace.chart(); c.type = "dot plot"; c.type').text).toBe('DotPlot\n');
    expect(run2('workspace.chart().type = "pie"').text).toMatch(/Unrecognized type 'pie'\nAllowed values:\n Contour\nDensity/);
    expect(run2('workspace.chart().display()').text).toMatch(/Chart has no layers/);
    const r = run2('var c = workspace.chart(); c.type = "Histogram"; c.parameters = ["FL1-A", "FSC-A"]; var s = workspace.samples[0]; var st = c.layer(s.populations("Lymph")[0]); st.color = 0xff0000; c.layer(s.populations("Lymph/CD3+")[0], 255); c.display(); c.export("/tmp/out/chart.svg"); c.export("x", "jpeg"); c.parameters + " " + st.name');
    expect(r.text).toBe('[FL1-A] #ff0000\n');
    expect(r.ctx.ops).toEqual([{ op: 'plot', path: 'Lymph', kind: 'Histogram', x: 'FL1-A', y: 'FSC-A', foreColor: '#ff0000' }]);
    const chart = { type: 'Histogram', params: ['FL1-A', 'FSC-A'], layers: [{ sampleId: 's1', popId: 'p1', color: 0xff0000 }, { sampleId: 's1', popId: 'p2', color: 255 }] };
    expect(r.ctx.effects.slice(1)).toEqual([{ kind: 'export', chart, file: 'chart.svg', type: 'SVG' }, { kind: 'export', chart, file: 'x', type: 'JPG' }]);
    expect(run2('var c = workspace.chart(); c.layer(workspace.samples[0]); c.export("a.png", "bmp")').text).toMatch(/Unrecognized file type 'bmp'/);
  });
  it('movie.create(): append charts, frame delay, auto play, export, show (MovieAPI)', () => {
    const r = run2('var m = movie.create(); var a = m.frameDelay + " " + m.autoPlay; var c = workspace.chart(); c.layer(workspace.samples[0]); m.append(c); m.append(c); m.setFrameDelay(250); m.autoPlay = false; var res = m.export("/tmp/m/run"); res.show(); a + " " + m + " " + res');
    expect(r.text).toBe('500 true Movie(2 frames) UserResource(HTML Movie: /tmp/m/run)\n');
    expect(r.ctx.effects).toEqual([{ kind: 'movie', file: 'run.html', frames: [{ type: 'Pseudocolor', params: [], layers: [{ sampleId: 's1', popId: null, color: -1 }] }, { type: 'Pseudocolor', params: [], layers: [{ sampleId: 's1', popId: null, color: -1 }] }], delay: 250, autoPlay: false, show: true }]);
    expect(run2('movie.create().append(workspace.chart())').text).toMatch(/Error creating chart/);
  });
  it('the movie HTML and the layout chart of a script chart', () => {
    const h = movieHtml('m', ['data:image/png;base64,AA', 'data:image/png;base64,BB'], 250, false);
    expect(h).toContain('d=250');
    expect(h).toContain('play(false)');
    expect((h.match(/class="f"/g) ?? []).length).toBe(2);
    const ws = emptyWorkspace();
    ws.samples.push({ id: 's1', fileName: 'a.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', keywordsSnapshot: {}, channelNames: ['FSC-A', 'SSC-A', 'FL1-A'], eventCount: 10,
      populations: [{ id: 'p1', name: 'L', parentId: null, gate: { type: 'rect', dims: [], min: [], max: [] } }, { id: 'p2', name: 'T', parentId: 'p1', gate: { type: 'rect', dims: [], min: [], max: [] } }] });
    const it = chartItem(ws, { type: 'CDF', params: ['FL1-A'], layers: [{ sampleId: 's1', popId: 'p1', color: 0x00ff00 }, { sampleId: 's1', popId: 'p2', color: -1 }] })!;
    expect([it.populationPath, it.kind, it.x, it.y, it.overlays, it.foreColor]).toEqual(['L', 'histogram', 'FL1-A', 'SSC-A', ['L/T'], '#00ff00']);
  });
  it('MathUtil helpers decoded from com.treestar.lib.numeric.MathUtil', () => {
    expect(MATH.round(1.23456, 2)).toBe(1.23);
    expect(MATH.roundToNearest(17, 5)).toBe(15);
    expect(MATH.roundToCommonFactorOf2(5)).toBe(6);
    expect(MATH.roundToCommonFactorOf2(0.3)).toBeCloseTo(1 / 3);
    expect(MATH.normalizeDegrees(-30)).toBe(330);
    expect(MATH.normalizeDegrees(0)).toBe(360);
    expect(MATH.getLineAngle(0, 0, 1, 0)).toBe(90);
    expect(MATH.positiveAngularDifference(1, 0)).toBeCloseTo(2 * Math.PI - 1);
    expect(MATH.completion(5, 0, 10)).toBe(0.5);
    expect(MATH.slopeIntercept([1, 3, 5, 7], 0, 4)).toEqual([2, 1]);
    expect(MATH.invert([2, 0, 0, 4], 2)).toEqual([0.5, 0, 0, 0.25]);
    expect(MATH.distributionStatistics([4, 1, 3, 2, 5, 6], 6)).toEqual([3.5, Math.sqrt(3.5), 3.5, 1, 6, 2, 5]);
    expect(MATH.distributionStatistics([7], 1)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect([MATH.ceil(1.2), MATH.floor(-1.2), MATH.logx(8, 2), MATH.isInteger(3), MATH.bitSet(6, 2), MATH.different(1, 1.5, 0.4), MATH.minMagnitude(-2, 3), MATH.pin0(-4), MATH.PHI]).toEqual([2, -2, 3, true, true, true, -2, 0, 1.618]);
  });
});

describe('model support for the script API (mask gates, node annotations)', () => {
  it('a file mask gate keeps the marked events; not (exclude) inverts it', async () => {
    const { SampleEngine } = await import('../src/core/analysis');
    const fcs = { channels: [{ index: 1, name: 'A', label: '', bits: 32, range: 262144, logDecades: 0, logOffset: 0, gain: 1 }], data: [Float64Array.from([1, 2, 3, 4, 5])], eventCount: 5, keywords: {}, version: 'FCS3.1', warnings: [], datasetIndex: 0, datasetOffsets: [0] } as unknown as import('../src/core/fcs').FcsFile;
    const bits = maskToBits(parseFileMask('1\n0\n1\n1\n', 5));
    const eng = new SampleEngine(fcs, { compensation: 'none', populations: [
      { id: 'm', name: 'M', parentId: null, gate: { type: 'mask', dims: [], file: 'm.csv', bits } },
      { id: 'n', name: 'N', parentId: null, exclude: true, gate: { type: 'mask', dims: [], file: 'm.csv', bits } },
    ] }, []).run();
    expect(eng.results.get('m')!.count).toBe(3);
    expect(eng.results.get('n')!.count).toBe(2);
  });
  it('annotations and mask gates are written to .wsp; annotations read back; the Annotation column', async () => {
    const f = 'fixtures/flowkit/data/8_color_data_set/8_color_ICS_simple.wsp';
    if (!existsSync(f)) return;
    const { populationCell, sampleCell, ANNOTATION } = await import('../src/core/workspaceTable');
    const ws = parseWsp(readFileSync(f, 'utf8')).workspace;
    const s = ws.samples[0];
    s.nodeAnnotation = 'sample note';
    s.populations[0].annotation = 'gate <note>';
    s.populations.push({ id: 'mk', name: 'Masked', parentId: null, gate: { type: 'mask', dims: [], file: 'mask.csv', bits: '' } });
    const { xml } = writeWsp({ ws, sampleMatrix: () => null });
    expect(xml).toContain('annotation="gate &lt;note&gt;"');
    expect(xml).toMatch(/<MaskGate eventsInside="1" nEvents="\d+"><maskfile importFile="mask.csv" \/><\/MaskGate>/);
    const back = parseWsp(xml).workspace.samples[0];
    expect(back.nodeAnnotation).toBe('sample note');
    expect(back.populations[0].annotation).toBe('gate <note>');
    expect(sampleCell(ws, s, ANNOTATION)).toBe('sample note');
    expect(populationCell(ws, s, s.populations[0].id, ANNOTATION)).toBe('gate <note>');
  });
});
