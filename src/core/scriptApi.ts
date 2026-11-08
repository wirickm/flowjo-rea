// FlowJo 10.6.2 scripting API (fj-scripting-api-2.0.0.jar, decoded in
// docs/validation/ui-gaps/workspace.md, SCRIPTEDITOR) over a snapshot of the
// workspace. Scripts are JavaScript (FlowJo runs them in Mozilla Rhino); here
// they run in a Web Worker (src/worker/script.worker.ts) against this API.
// The scope holds workspace, stats, math, movie and console (WSScriptEvaluator
// and ScriptEvaluator.prepareScope). Reads come from the snapshot; changes
// are recorded as operations the app applies afterwards in one undoable step.
// Statistics the snapshot lacks read NaN and are listed as missing: the app
// computes them and runs the script again (at most MAX_ROUNDS times).
import type { StatKind } from './model';
import { STAT_LABELS } from './stats';
import { uniqueName } from './model';
import { maskToBits, parseFileMask } from './fileMask';

// A node's gate as scripts see it (GatePopAPIFactory): RectGate -> rect,
// RangeGate -> range (bounds in data units; an open bound reads +-Infinity),
// FileMaskGate -> mask, any other gate -> other. not = eventsInside="0".
export interface SnapGate { kind: 'rect' | 'range' | 'mask' | 'other'; params: string[]; min: number[]; max: number[]; file?: string; bits?: string; not?: boolean; magnetic?: boolean }
export interface SnapPop { id: string; name: string; parentId: string | null; count: number | null; gate?: SnapGate; annotation?: string }
export interface SnapParam { name: string; stain: string; longName: string; index: number }
export interface SnapSample { id: string; name: string; keywords: Record<string, string>; params: SnapParam[]; total: number | null; pops: SnapPop[]; events?: number; annotation?: string }
// A statistic node: the app's statistics are workspace columns per population path.
export interface SnapStat { id: string; path: string; stat: StatKind; channel?: string; percentile?: number; correlate?: string }
export interface ScriptSnapshot { name: string; samples: SnapSample[]; groups: { name: string; sampleIds: string[] }[]; stats?: SnapStat[]; files?: { name: string; text: string }[] }

export interface StatReq { sampleId: string; path: string; stat: StatKind; channel?: string; percentile?: number; correlate?: string }
export const statKey = (r: StatReq) => JSON.stringify([r.sampleId, r.path, r.stat, r.channel ?? '', r.percentile ?? '', r.correlate ?? '']);

// Ids starting with "new:" name nodes made during the run; the app maps them
// to the ids it gives the new nodes.
export type ScriptOp =
  | { op: 'rename'; sampleId: string; popId: string; name: string }
  | { op: 'keyword'; sampleId: string; key: string; value: string | null }
  | { op: 'groupCreate'; name: string }
  | { op: 'groupRemove'; name: string }
  | { op: 'groupAdd'; name: string; sampleId: string }
  | { op: 'groupRemoveSample'; name: string; sampleId: string }
  // Rectangle (2 params) or range (1 param) gate, bounds in data units; or a
  // file mask gate (kind 'mask', no params).
  | { op: 'gate'; sampleId: string; parentId: string | null; id: string; name: string; params: string[]; min: number[]; max: number[]; kind?: 'mask'; file?: string; bits?: string; not?: boolean; magnetic?: boolean }
  // Changes to an existing gate (RectGateAPI / RangeGateAPI setters,
  // GatedPopulationAPI not / magnetic, FileMaskGateAPI.setFile).
  | { op: 'gateEdit'; sampleId: string; popId: string; min?: number[]; max?: number[]; not?: boolean; magnetic?: boolean; file?: string; bits?: string }
  | { op: 'annotation'; sampleId: string; popId: string | null; text: string }
  // PopulationAPI.add of a population: a copy of its subtree under the parent
  // (a same-named child is replaced); ids maps each copied id to its "new:" id.
  | { op: 'copy'; fromSampleId: string; fromPopId: string; sampleId: string; parentId: string | null; ids: Record<string, string> }
  | { op: 'remove'; sampleId: string; popId: string }
  | { op: 'statAdd'; id: string; path: string; stat: StatKind; channel?: string; percentile?: number; correlate?: string }
  | { op: 'statRemove'; id: string }
  // The graph a population opens with (display / chart.display).
  | { op: 'plot'; path: string; kind: string; x?: string; y?: string | null; foreColor?: string };

// What a chart shows: the DisplayType name, its parameters and its layers
// (populations, each with a colour; -1 = none).
export interface ChartSpec { type: string; params: string[]; layers: { sampleId: string; popId: string | null; color: number }[] }
// Effects the page carries out after the run (it owns the windows and the
// renderer). win: the script's number for a graph window it opened.
export type ScriptEffect =
  | { kind: 'open'; sampleId: string; popId: string | null; win: number }
  | { kind: 'close'; win: number }
  | { kind: 'move'; win: number; x: number; y: number }
  | { kind: 'export'; chart: ChartSpec; file: string; type: string }
  | { kind: 'movie'; file: string; frames: ChartSpec[]; delay: number; autoPlay: boolean; show: boolean };

export interface OutLine { writer: string; text: string; color: 'black' | 'blue' | 'red' }

export const MAX_ROUNDS = 6;

// The mutable state a run works on. API objects hold ids and read ctx.snap on
// each access, so objects kept in console variables stay valid.
export interface ScriptCtx {
  snap: ScriptSnapshot;
  cache: Record<string, number>;
  missing: Map<string, StatReq>;
  ops: ScriptOp[];
  effects: ScriptEffect[];
  out: OutLine[];
  writer: string;
  tmp: number;
  wins: number;
}

export function newCtx(snap: ScriptSnapshot, cache: Record<string, number> = {}, writer = ''): ScriptCtx {
  return { snap: structuredClone(snap), cache, missing: new Map(), ops: [], effects: [], out: [], writer, tmp: 0, wins: 0 };
}

export class ScriptError extends Error {}

// Java lists print as "[a, b]" (Rhino wraps java.util.List).
function jlist<T>(a: T[]): T[] {
  Object.defineProperty(a, 'toString', { value: () => `[${a.map((x) => String(x)).join(', ')}]`, enumerable: false, configurable: true });
  return a;
}

// BaseAPI.toString: Type(name).
abstract class Base {
  abstract get typeName(): string;
  abstract get name(): string;
  toString() { return `${this.typeName}(${this.name})`; }
}

// Rhino exposes getX() and the bean property x; give every getter a getX().
function beanify(cls: { prototype: object }) {
  for (let p: object | null = cls.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(p))) {
      if (!d.get) continue;
      const m = `get${k[0].toUpperCase()}${k.slice(1)}`;
      if (!(m in cls.prototype)) Object.defineProperty(cls.prototype, m, { value(this: Record<string, unknown>) { return this[k]; } });
      if (d.set) {
        const s = `set${k[0].toUpperCase()}${k.slice(1)}`;
        if (!(s in cls.prototype)) Object.defineProperty(cls.prototype, s, { value(this: Record<string, unknown>, v: unknown) { this[k] = v; } });
      }
    }
  }
}

// ScriptIndexed / ScriptStringIndexed: obj[0], obj["name"].
function indexed<T extends object>(target: T, byIndex: ((i: number) => unknown) | null, byName: ((s: string) => unknown) | null, setName?: (s: string, v: unknown) => boolean): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      if (typeof prop === 'symbol' || prop in t) return Reflect.get(t, prop, recv);
      if (byIndex && /^\d+$/.test(prop)) return byIndex(Number(prop));
      if (byName) return byName(prop);
      return undefined;
    },
    set(t, prop, v, recv) {
      if (typeof prop === 'string' && !(prop in t) && setName) return setName(prop, v);
      return Reflect.set(t, prop, v, recv);
    },
  });
}

const sampleOf = (ctx: ScriptCtx, sid: string) => {
  const s = ctx.snap.samples.find((x) => x.id === sid);
  if (!s) throw new ScriptError('Sample is no longer in the workspace');
  return s;
};
const pathOf = (s: SnapSample, popId: string | null): string => {
  const names: string[] = [];
  let cur = popId ? s.pops.find((p) => p.id === popId) : undefined;
  while (cur) {
    names.unshift(cur.name);
    cur = cur.parentId ? s.pops.find((p) => p.id === cur!.parentId) : undefined;
  }
  return names.join('/');
};
const subtree = (s: SnapSample, root: string): Set<string> => {
  const out = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of s.pops) if (p.parentId && out.has(p.parentId) && !out.has(p.id)) { out.add(p.id); grew = true; }
  }
  return out;
};
const isNew = (id: string | null) => !!id && id.startsWith('new:');
const baseName = (path: string) => { const p = String(path).replace(/\\/g, '/'); let b = p.slice(p.lastIndexOf('/') + 1); try { b = decodeURIComponent(b); } catch { /* keep */ } return b; };

// StatAPICreator: the statistics a script can ask for.
export class StatisticAPI extends Base {
  constructor(readonly stat: StatKind, readonly channel?: string, readonly percentile?: number, readonly correlate?: string) { super(); }
  get typeName() { return 'Statistic'; }
  get name() { return statName(this); }
}
const statName = (s: { stat: StatKind; channel?: string; percentile?: number; correlate?: string }) =>
  `${STAT_LABELS[s.stat]}${s.stat === 'percentile' ? ` ${s.percentile}` : ''}${s.channel ? ` : ${s.channel}` : ''}${s.correlate ? ` : ${s.correlate}` : ''}`;
export class StatAPICreator {
  count() { return new StatisticAPI('count'); }
  freqOfTotal() { return new StatisticAPI('freqTotal'); }
  freqOfParent() { return new StatisticAPI('freqParent'); }
  median(p: string) { return new StatisticAPI('median', String(p)); }
  mean(p: string) { return new StatisticAPI('mean', String(p)); }
  mode(p: string) { return new StatisticAPI('mode', String(p)); }
  geometricMean(p: string) { return new StatisticAPI('geomean', String(p)); }
  robustCV(p: string) { return new StatisticAPI('robustCv', String(p)); }
  cv(p: string) { return new StatisticAPI('cv', String(p)); }
  stddev(p: string) { return new StatisticAPI('sd', String(p)); }
  robustSD(p: string) { return new StatisticAPI('robustSd', String(p)); }
  percentile(p: string, v: number) { return new StatisticAPI('percentile', String(p), Number(v)); }
  correlation(a: string, b: string) { return new StatisticAPI('correlation', String(a), undefined, String(b)); }
  get name() { return 'FlowJo'; }
  toString() { return 'FlowJo'; }
}

// AppNodeAPI: any node. A statistic node (BasicNodeAPIFactory's fallback) is
// typed "Node"; it has a name, a parent and no children.
export class StatNodeAPI extends Base {
  constructor(protected ctx: ScriptCtx, readonly sampleId: string, readonly statId: string) { super(); }
  get st() {
    const st = (this.ctx.snap.stats ?? []).find((x) => x.id === this.statId);
    if (!st) throw new ScriptError('Statistic is no longer in the workspace');
    return st;
  }
  get typeName() { return 'Node'; }
  get name() { return statName(this.st); }
  get identifier() { return this.name; }
  get workspace() { return new WorkspaceAPI(this.ctx); }
  get sample() { return new SampleAPI(this.ctx, this.sampleId); }
  get parent(): PopulationAPI {
    const s = sampleOf(this.ctx, this.sampleId);
    const p = this.st.path ? s.pops.find((q) => pathOf(s, q.id) === this.st.path) : null;
    return node(this.ctx, this.sampleId, p ? p.id : null);
  }
  get path() { return this.st.path ? `${this.st.path}/${this.name}` : this.name; }
  get fullPath() { return `${sampleOf(this.ctx, this.sampleId).name}/${this.path}`; }
  get children() { return jlist([]); }
  findAll(pattern: string | string[]) { const parts = Array.isArray(pattern) ? pattern : String(pattern).split('/').filter(Boolean); return jlist(parts.length ? [] : [this]); }
  // Annotations of statistic nodes are kept by FlowJo too, but this app's
  // statistics are workspace columns without one.
  get annotation(): string | null { return null; }
  set annotation(_t: string | null) { throw new ScriptError('Statistic nodes have no annotation in flowjo-rea'); }
  setAnnotation(t: string) { this.annotation = t; }
}

type AnyNode = PopulationAPI | StatNodeAPI;

// AppNodeAPI / PopulationAPI / SampleAPI: a node of a sample's tree
// (popId null = the sample node).
export class PopulationAPI extends Base {
  constructor(protected ctx: ScriptCtx, readonly sampleId: string, readonly popId: string | null) { super(); }
  protected get s() { return sampleOf(this.ctx, this.sampleId); }
  protected get p() {
    if (!this.popId) return null;
    const p = this.s.pops.find((x) => x.id === this.popId);
    if (!p) throw new ScriptError('Population is no longer in the workspace');
    return p;
  }
  get typeName(): string { return this.popId ? 'PopulationNode' : 'SampleNode'; }
  get name() { return this.p ? this.p.name : this.s.name; }
  set name(n: string) { this.setName(n); }
  get identifier() { return this.name; }
  get workspace() { return new WorkspaceAPI(this.ctx); }
  get sample() { return new SampleAPI(this.ctx, this.sampleId); }
  get parent(): PopulationAPI | null {
    if (!this.p) return null;
    return this.p.parentId ? node(this.ctx, this.sampleId, this.p.parentId) : new SampleAPI(this.ctx, this.sampleId);
  }
  // getPath: the analysis path below the sample; getFullPath: with the sample name.
  get path() { return pathOf(this.s, this.popId); }
  get fullPath() { return this.popId ? `${this.s.name}/${this.path}` : this.s.name; }
  // AppNode.getChildren: populations, then the statistic nodes of this path.
  private statKids(): StatNodeAPI[] {
    const path = this.path;
    return (this.ctx.snap.stats ?? []).filter((x) => x.path === path).map((x) => new StatNodeAPI(this.ctx, this.sampleId, x.id));
  }
  get children(): AnyNode[] { return jlist([...this.s.pops.filter((x) => x.parentId === this.popId).map((x) => node(this.ctx, this.sampleId, x.id)), ...this.statKids()]); }
  // AppNodeAPI.setAnnotation / getAnnotation (AppNode.fAnnotation).
  get annotation(): string | null { return (this.p ? this.p.annotation : this.s.annotation) ?? null; }
  set annotation(t: string | null) {
    const text = t == null ? '' : String(t);
    if (this.p) this.p.annotation = text; else this.s.annotation = text;
    const o = this.ctx.ops.find((x) => x.op === 'annotation' && x.sampleId === this.sampleId && x.popId === this.popId);
    if (o && o.op === 'annotation') o.text = text;
    else this.ctx.ops.push({ op: 'annotation', sampleId: this.sampleId, popId: this.popId, text });
  }
  setAnnotation(t: string) { this.annotation = t; }
  // AppNodeAPI.findAll: path parts split on "/"; "*" any child, "**" any
  // descendant, otherwise the child with that name. Statistic nodes match too
  // (they have no children).
  findAll(pattern: string | string[]): AnyNode[] {
    const parts = Array.isArray(pattern) ? pattern.map(String) : String(pattern).split('/').filter((x) => x !== '');
    const walk = (n: AnyNode, rest: string[]): AnyNode[] => {
      if (!rest.length) return [n];
      if (!(n instanceof PopulationAPI)) return [];
      const [first, ...tail] = rest;
      let cand: AnyNode[];
      if (first === '**') {
        cand = [];
        const add = (x: AnyNode) => { if (x instanceof PopulationAPI) for (const c of x.children) { cand.push(c); add(c); } };
        add(n);
      } else cand = n.children.filter((c) => first === '*' || c.name === first);
      return cand.flatMap((c) => walk(c, tail));
    };
    return jlist(walk(this, parts));
  }
  populations(pattern: string) { return jlist(this.findAll(pattern).filter((x): x is PopulationAPI => x instanceof PopulationAPI)); }
  get count(): number {
    if (isNew(this.popId)) return NaN;
    const c = this.p ? this.p.count : this.s.total;
    return c ?? this.stat(new StatisticAPI('count'));
  }
  stat(st: StatisticAPI): number {
    if (!(st instanceof StatisticAPI)) throw new ScriptError('stat() needs a statistic, e.g. stats.median("FSC-A")');
    if (isNew(this.popId)) return NaN;
    if (st.stat === 'count' && (this.p ? this.p.count : this.s.total) != null) return (this.p ? this.p.count : this.s.total)!;
    const req: StatReq = { sampleId: this.sampleId, path: this.path, stat: st.stat, ...(st.channel ? { channel: st.channel } : {}), ...(st.percentile !== undefined ? { percentile: st.percentile } : {}), ...(st.correlate ? { correlate: st.correlate } : {}) };
    const k = statKey(req);
    if (k in this.ctx.cache) return this.ctx.cache[k];
    this.ctx.missing.set(k, req);
    return NaN;
  }
  // PopulationAPI.stats: a map from statistic to value (here an object keyed
  // by statistic name).
  stats(list: StatisticAPI[]) {
    const o: Record<string, number> = {};
    for (const st of Array.from(list)) o[st.name] = this.stat(st);
    return o;
  }
  setName(n: string) {
    const p = this.p;
    if (!p) throw new ScriptError('A sample node cannot be renamed from a script');
    p.name = String(n);
    const g = this.ctx.ops.find((o) => o.op === 'gate' && o.id === this.popId);
    if (g && g.op === 'gate') g.name = p.name;
    else this.ctx.ops.push({ op: 'rename', sampleId: this.sampleId, popId: this.popId!, name: p.name });
  }
  get gating() { return new GateAPICreator(this.ctx, this); }
  // PopulationAPI.add (PopNode.addAnalysisNode): each node joins this node's
  // children. A population is added as a copy of its subtree; a child with the
  // same name is replaced (ParentNode.replaceChild). A statistic node adds
  // that statistic for this population. A sample node cannot be added
  // (AppNode.isAllowedParentNode).
  add(...nodes: unknown[]) {
    for (const n of nodes.flatMap((x) => (Array.isArray(x) ? x : x instanceof PopulationListAPI ? Array.from({ length: x.length }, (_, i) => x.get(i)!) : [x]))) {
      if (n instanceof StatNodeAPI) {
        const st = n.st;
        const path = this.path;
        const stats = (this.ctx.snap.stats ??= []);
        if (stats.some((x) => x.path === path && statName(x) === statName(st))) continue;
        const id = `new:${++this.ctx.tmp}`;
        const { id: _i, path: _p, ...rest } = st;
        stats.push({ ...rest, id, path });
        this.ctx.ops.push({ op: 'statAdd', ...rest, id, path });
      } else if (n instanceof PopulationAPI) {
        if (!n.popId) continue;
        const from = sampleOf(this.ctx, n.sampleId);
        const src = from.pops.find((x) => x.id === n.popId);
        if (!src) continue;
        if (n.sampleId === this.sampleId && this.popId && subtree(from, n.popId).has(this.popId)) throw new ScriptError('A node cannot be added below itself');
        const s = this.s;
        const same = s.pops.find((x) => x.parentId === this.popId && x.name === src.name);
        if (same) { const doomed = subtree(s, same.id); s.pops = s.pops.filter((x) => !doomed.has(x.id)); }
        const ids: Record<string, string> = {};
        const keep = subtree(from, n.popId);
        const copies = from.pops.filter((x) => keep.has(x.id)).map((x) => structuredClone(x));
        for (const c of copies) ids[c.id] = `new:${++this.ctx.tmp}`;
        for (const c of copies) s.pops.push({ ...c, id: ids[c.id], parentId: c.id === n.popId ? this.popId : ids[c.parentId!], count: null });
        this.ctx.ops.push({ op: 'copy', fromSampleId: n.sampleId, fromPopId: n.popId, sampleId: this.sampleId, parentId: this.popId, ids });
      } else throw new ScriptError('add() needs workspace nodes');
    }
  }
  // PopulationAPI.remove (PopNode.removeAnalysisNode): removes each node that
  // is a child of this node, with its subtree; other nodes are left alone.
  remove(...nodes: unknown[]) {
    for (const n of nodes.flatMap((x) => (Array.isArray(x) ? x : x instanceof PopulationListAPI ? Array.from({ length: x.length }, (_, i) => x.get(i)!) : [x]))) {
      if (n instanceof StatNodeAPI) {
        const stats = this.ctx.snap.stats ?? [];
        const st = stats.find((x) => x.id === n.statId);
        if (!st || st.path !== this.path) continue;
        this.ctx.snap.stats = stats.filter((x) => x !== st);
        this.ctx.ops.push({ op: 'statRemove', id: st.id });
      } else if (n instanceof PopulationAPI) {
        if (n.sampleId !== this.sampleId || !n.popId) continue;
        const s = this.s;
        const p = s.pops.find((x) => x.id === n.popId);
        if (!p || p.parentId !== this.popId) continue;
        const doomed = subtree(s, p.id);
        s.pops = s.pops.filter((x) => !doomed.has(x.id));
        this.ctx.ops.push({ op: 'remove', sampleId: this.sampleId, popId: p.id });
      } else throw new ScriptError('remove() needs workspace nodes');
    }
  }
  // PopulationAPI.display: open this node's graph window (openOriginalGraph);
  // display(x): a histogram of x; display(x, y): a bivariate plot of x and y
  // with the default 2-D type (GraphSpec.defaultGraphSpec: Pseudocolor).
  display(x?: string, y?: string): ChartWindowAPI {
    if (x !== undefined) this.ctx.ops.push({ op: 'plot', path: this.path, kind: y !== undefined ? 'pseudocolor' : 'histogram', x: String(x), y: y !== undefined ? String(y) : null });
    return openWindow(this.ctx, this.sampleId, this.popId);
  }
}

function openWindow(ctx: ScriptCtx, sampleId: string, popId: string | null): ChartWindowAPI {
  const win = ++ctx.wins;
  ctx.effects.push({ kind: 'open', sampleId, popId, win });
  const s = sampleOf(ctx, sampleId);
  return new ChartWindowAPI(ctx, win, `${s.name}: ${popId ? pathOf(s, popId) : 'Ungated'}`);
}

export class SampleAPI extends PopulationAPI {
  constructor(ctx: ScriptCtx, sampleId: string) { super(ctx, sampleId, null); }
  get keywords() { return keywordSet(this.ctx, this.sampleId); }
  get parameters() { return parameterList(this.ctx, this.sampleId); }
  get stains() { return jlist([...new Set(this.s.params.map((p) => p.stain).filter(Boolean))]); }
}

// GatedPopulationAPI (any gated population) and the gate types
// GatePopAPIFactory picks: RectGateAPI, RangeGateAPI, FileMaskGateAPI.
export class GatedPopulationAPI extends PopulationAPI {
  protected get g(): SnapGate {
    const g = this.p?.gate;
    if (!g) throw new ScriptError('Population must have gate');
    return g;
  }
  // Sends the gate's current state to the change list: into the pending gate
  // of a node made in this run, else as a gateEdit.
  protected sync(fields: ('min' | 'max' | 'not' | 'magnetic' | 'file')[]) {
    const g = this.g;
    const pending = this.ctx.ops.find((o) => o.op === 'gate' && o.id === this.popId);
    let o: Record<string, unknown>;
    if (pending) o = pending as unknown as Record<string, unknown>;
    else {
      const e = this.ctx.ops.find((x) => x.op === 'gateEdit' && x.popId === this.popId && x.sampleId === this.sampleId);
      if (e) o = e as unknown as Record<string, unknown>;
      else { const n = { op: 'gateEdit' as const, sampleId: this.sampleId, popId: this.popId! }; this.ctx.ops.push(n); o = n as unknown as Record<string, unknown>; }
    }
    for (const f of fields) {
      if (f === 'min') o.min = [...g.min];
      else if (f === 'max') o.max = [...g.max];
      else if (f === 'not') o.not = !!g.not;
      else if (f === 'magnetic') o.magnetic = !!g.magnetic;
      else { o.file = g.file; o.bits = g.bits; }
    }
  }
  get not() { return !!this.g.not; }
  set not(v: boolean) { this.g.not = !!v; this.sync(['not']); }
  isNot() { return this.not; }
  get magnetic() { return !!this.g.magnetic; }
  set magnetic(v: boolean) { this.g.magnetic = !!v; this.sync(['magnetic']); }
  isMagnetic() { return this.magnetic; }
  // update (PopNode.gateModified): here every change applies when the run ends.
  update() {}
}

export class RectGateAPI extends GatedPopulationAPI {
  get typeName() { return 'RectangleGate'; }
  private set1(k: 'min' | 'max', i: number, v: number) { this.g[k][i] = Number(v); this.sync([k]); }
  get minX() { return this.g.min[0]; } set minX(v: number) { this.set1('min', 0, v); }
  get maxX() { return this.g.max[0]; } set maxX(v: number) { this.set1('max', 0, v); }
  get minY() { return this.g.min[1]; } set minY(v: number) { this.set1('min', 1, v); }
  get maxY() { return this.g.max[1]; } set maxY(v: number) { this.set1('max', 1, v); }
}

export class RangeGateAPI extends GatedPopulationAPI {
  get typeName() { return 'RangeGate'; }
  get parameter() { return this.g.params[0]; }
  get min() { return this.g.min[0]; } set min(v: number) { this.g.min[0] = Number(v); this.sync(['min']); }
  get max() { return this.g.max[0]; } set max(v: number) { this.g.max[0] = Number(v); this.sync(['max']); }
}

export class FileMaskGateAPI extends GatedPopulationAPI {
  get typeName() { return 'FileMaskGate'; }
  get file() { return this.g.file ?? ''; }
  set file(f: string) { this.g.bits = readMask(this.ctx, this.s, String(f)); this.g.file = String(f); this.sync(['file']); }
}

// GateAPICreator.fileMask: the mask file's events (src/core/fileMask.ts). A
// browser script cannot open files by path, so the file is one attached in
// the Script Editor, matched by its name (the last part of the path or URI).
function readMask(ctx: ScriptCtx, s: SnapSample, fileUri: string): string {
  const want = baseName(fileUri);
  const f = (ctx.snap.files ?? []).find((x) => x.name === want);
  if (!f) throw new ScriptError(`Cannot read the mask file "${want}": attach it with Attach Files in the Script Editor`);
  return maskToBits(parseFileMask(f.text, s.events ?? s.total ?? 0));
}

function node(ctx: ScriptCtx, sid: string, popId: string | null): PopulationAPI {
  if (!popId) return new SampleAPI(ctx, sid);
  const g = sampleOf(ctx, sid).pops.find((p) => p.id === popId)?.gate;
  if (!g) return new PopulationAPI(ctx, sid, popId);
  return g.kind === 'rect' ? new RectGateAPI(ctx, sid, popId) : g.kind === 'range' ? new RangeGateAPI(ctx, sid, popId) : g.kind === 'mask' ? new FileMaskGateAPI(ctx, sid, popId) : new GatedPopulationAPI(ctx, sid, popId);
}

// GateAPICreator: rectangle(name, x, y[, xmin, xmax, ymin, ymax]) and
// range(name, p[, min, max]) add a child gate; bounds default to 0 (the gate
// fields' Java default) and are in data units. fileMask(name, file) adds a
// file mask gate.
export class GateAPICreator {
  constructor(private ctx: ScriptCtx, private parent: PopulationAPI) {}
  private make(name: string, gate: SnapGate) {
    const s = sampleOf(this.ctx, this.parent.sampleId);
    const pid = this.parent.popId;
    const nm = uniqueName(String(name), s.pops.filter((x) => x.parentId === pid).map((x) => x.name));
    const id = `new:${++this.ctx.tmp}`;
    s.pops.push({ id, name: nm, parentId: pid, count: null, gate });
    const mask = gate.kind === 'mask' ? { kind: 'mask' as const, file: gate.file, bits: gate.bits } : {};
    this.ctx.ops.push({ op: 'gate', sampleId: s.id, parentId: pid, id, name: nm, params: gate.params, min: gate.min, max: gate.max, ...mask });
    return node(this.ctx, s.id, id);
  }
  rectangle(name: string, x: string, y: string, xmin = 0, xmax = 0, ymin = 0, ymax = 0) { return this.make(name, { kind: 'rect', params: [String(x), String(y)], min: [Number(xmin), Number(ymin)], max: [Number(xmax), Number(ymax)] }); }
  range(name: string, p: string, min = 0, max = 0) { return this.make(name, { kind: 'range', params: [String(p)], min: [Number(min)], max: [Number(max)] }); }
  fileMask(name: string, fileUri: string) {
    const s = sampleOf(this.ctx, this.parent.sampleId);
    return this.make(name, { kind: 'mask', params: [], min: [], max: [], file: String(fileUri), bits: readMask(this.ctx, s, String(fileUri)) });
  }
  get name() { return this.parent.name; }
  toString() { return `GateCreator(${this.parent.name})`; }
}

// PopulationListAPI.
export class PopulationListAPI extends Base {
  constructor(protected list: PopulationAPI[]) { super(); }
  get typeName() { return 'PopulationList'; }
  get name() { return `${this.list.length} nodes`; }
  get length() { return this.list.length; }
  get(k: number | string): PopulationAPI | undefined {
    if (typeof k === 'number') return this.list[k];
    return this.list.find((p) => p.name === k || p.fullPath === k);
  }
  remove() { return false; }
  // Slice(start, end, step): Python-style, negative indices count from the end.
  slice(start?: number | null, end?: number | null, step = 1) {
    const n = this.list.length;
    const norm = (v: number | null | undefined, d: number) => (v == null ? d : v < 0 ? Math.max(0, n + v) : Math.min(n, v));
    const out: PopulationAPI[] = [];
    for (let i = norm(start, 0); i < norm(end, n); i += Math.max(1, step)) out.push(this.list[i]);
    return popList(out);
  }
  get paths() { return jlist(this.list.map((p) => p.path)); }
  get names() { return jlist(this.list.map((p) => p.name)); }
  get indices() { return jlist(this.list.map((_, i) => i)); }
  populations(pattern: string) { return popList(this.list.flatMap((p) => p.populations(pattern))); }
  get counts() { return jlist(this.list.map((p) => p.count)); }
  stats(st: StatisticAPI) { return jlist(this.list.map((p) => p.stat(st))); }
  filter(fn: (p: PopulationAPI) => unknown) {
    if (typeof fn !== 'function') throw new ScriptError('filter() needs a function');
    return popList(this.list.filter((p) => !!fn(p)));
  }
  forEach(fn: (p: PopulationAPI, i: number) => void) { this.list.forEach(fn); }
}
function popList(list: PopulationAPI[]) {
  return indexed(new PopulationListAPI(list), (i) => list[i], (s) => list.find((p) => p.name === s || p.fullPath === s));
}

// SampleAPI.KeywordSetAPI: keywords["$FIL"], set(key, value), remove(key).
class KeywordSetAPI extends Base {
  constructor(private ctx: ScriptCtx, private sid: string) { super(); }
  get typeName() { return 'KeywordSet'; }
  get name() { return sampleOf(this.ctx, this.sid).name; }
  get(k: string) { return sampleOf(this.ctx, this.sid).keywords[String(k)]; }
  set(k: string, v: unknown) {
    if (!String(k)) return false;
    const s = sampleOf(this.ctx, this.sid);
    const value = v == null ? null : String(v);
    if (value === null) delete s.keywords[String(k)];
    else s.keywords[String(k)] = value;
    this.ctx.ops.push({ op: 'keyword', sampleId: this.sid, key: String(k), value });
    return true;
  }
  remove(k: string) { return this.set(k, null); }
  get indices() { return jlist(Object.keys(sampleOf(this.ctx, this.sid).keywords)); }
}
function keywordSet(ctx: ScriptCtx, sid: string) {
  const k = new KeywordSetAPI(ctx, sid);
  return indexed(k, null, (s) => k.get(s), (s, v) => k.set(s, v));
}

class ParameterAPI extends Base {
  constructor(private p: SnapParam) { super(); }
  get typeName() { return 'SampleParameter'; }
  get name() { return this.p.name; }
  get stain() { return this.p.stain; }
  get longName() { return this.p.longName; }
  get index() { return this.p.index; }
}
class ParameterListAPI extends Base {
  constructor(private ctx: ScriptCtx, private sid: string) { super(); }
  private get ps() { return sampleOf(this.ctx, this.sid).params; }
  get typeName() { return 'SampleParameterList'; }
  get name() { return sampleOf(this.ctx, this.sid).name; }
  get(k: number | string) {
    const p = typeof k === 'number' ? this.ps[k] : this.ps.find((x) => x.name === k);
    return p ? new ParameterAPI(p) : undefined;
  }
  withStain(st: string) { const p = this.ps.find((x) => x.stain === st); return p ? new ParameterAPI(p) : undefined; }
  get names() { return jlist(this.ps.map((p) => p.name)); }
  get longNames() { return jlist(this.ps.map((p) => p.longName)); }
  get indices() { return jlist(this.ps.map((p) => p.name)); }
  get length() { return this.ps.length; }
  set() { return false; }
  remove() { return false; }
}
function parameterList(ctx: ScriptCtx, sid: string) {
  const l = new ParameterListAPI(ctx, sid);
  return indexed(l, (i) => l.get(i), (s) => l.get(s));
}

// GroupMgrAPI / GroupAPI.
class GroupAPI extends Base {
  constructor(private ctx: ScriptCtx, private gname: string) { super(); }
  private get g() {
    const g = this.ctx.snap.groups.find((x) => x.name === this.gname);
    if (!g) throw new ScriptError(`Group ${this.gname} is no longer in the workspace`);
    return g;
  }
  get typeName() { return 'SampleGroup'; }
  get name() { return this.gname; }
  get samples() { return popList(this.g.sampleIds.filter((id) => this.ctx.snap.samples.some((s) => s.id === id)).map((id) => new SampleAPI(this.ctx, id))); }
  private ids(x: unknown): string[] {
    if (x instanceof PopulationListAPI) return Array.from({ length: x.length }, (_, i) => x.get(i)!.sampleId);
    if (x instanceof PopulationAPI) return [x.sampleId];
    throw new ScriptError('Expected a sample or a list of samples');
  }
  add(x: unknown) {
    for (const id of this.ids(x)) if (!this.g.sampleIds.includes(id)) { this.g.sampleIds.push(id); this.ctx.ops.push({ op: 'groupAdd', name: this.gname, sampleId: id }); }
  }
  remove(x: unknown) {
    for (const id of this.ids(x)) if (this.g.sampleIds.includes(id)) { this.g.sampleIds = this.g.sampleIds.filter((y) => y !== id); this.ctx.ops.push({ op: 'groupRemoveSample', name: this.gname, sampleId: id }); }
  }
}
class GroupMgrAPI extends Base {
  constructor(private ctx: ScriptCtx) { super(); }
  get typeName() { return 'GroupManager'; }
  get name() { return this.ctx.snap.name; }
  get(n: string) { return this.ctx.snap.groups.some((g) => g.name === n) ? new GroupAPI(this.ctx, n) : undefined; }
  // create: an empty name gives nothing; an existing group is returned as is.
  create(n: string) {
    const name = String(n ?? '');
    if (!name) return undefined;
    if (!this.ctx.snap.groups.some((g) => g.name === name)) {
      this.ctx.snap.groups.push({ name, sampleIds: [] });
      this.ctx.ops.push({ op: 'groupCreate', name });
    }
    return new GroupAPI(this.ctx, name);
  }
  get names() { return jlist(this.ctx.snap.groups.map((g) => g.name)); }
  get indices() { return this.names; }
  remove(n: string) {
    const i = this.ctx.snap.groups.findIndex((g) => g.name === n);
    if (i < 0 || n === 'All Samples') return false;
    this.ctx.snap.groups.splice(i, 1);
    this.ctx.ops.push({ op: 'groupRemove', name: String(n) });
    return true;
  }
  set() { return false; }
}

// com.treestar.lib.fjml.types.DisplayType: the chart types (key, dimensions,
// legacy names), matched ignoring case; gwTypes lists the graph-window ones.
export const DISPLAY_TYPES: { key: string; dims: 1 | 2; legacy?: string[] }[] = [
  { key: 'Contour', dims: 2 }, { key: 'Density', dims: 2 }, { key: 'Zebra', dims: 2 }, { key: 'Pseudocolor', dims: 2 },
  { key: 'DotPlot', dims: 2, legacy: ['Dot Plot'] }, { key: 'Histogram', dims: 1 }, { key: 'Timeseries', dims: 1 }, { key: 'CDF', dims: 1 },
  { key: 'Heatmap Statistic', dims: 2 },
];
const GW_TYPES = ['Contour', 'Density', 'Zebra', 'Pseudocolor', 'Heatmap Statistic', 'DotPlot', 'Histogram', 'CDF'];
export function displayType(s: string): string | null {
  if (!s) return 'Pseudocolor';
  const t = DISPLAY_TYPES.find((d) => d.key.toLowerCase() === s.toLowerCase() || d.legacy?.some((l) => l.toLowerCase() === s.toLowerCase()));
  return t ? t.key : null;
}
// GraphicsFileType.fromString: the type whose name or extension matches.
const FILE_TYPES: [string, string[]][] = [['PNG', ['png']], ['JPG', ['jpg', 'jpeg']], ['EMF', ['emf']], ['PDF', ['pdf']], ['PS', ['psd']], ['SVG', ['svg']], ['SWF', ['swf']], ['GIF', ['gif']], ['TIFF', ['tiff', 'tif']]];
export function fileType(s: string): string | null {
  const x = String(s).replace(/^\./, '').toLowerCase();
  return FILE_TYPES.find(([n, exts]) => n.toLowerCase() === x || exts.includes(x))?.[0] ?? null;
}

// ChartLayerSettingsAPI: a public int color (-1 = none), named by its colour.
export class ChartLayerSettingsAPI extends Base {
  color = -1;
  get typeName() { return 'ChartLayerSettings'; }
  get name() { return `#${((this.color >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`; }
}

// ChartAPI: a chart of one or more population layers; display() opens the
// first layer's graph window with the chart's type, parameters and the first
// layer's colour; export() writes the chart as an image (ImageExporter).
export class ChartAPI extends Base {
  private kind: string | null = null;
  private params: string[] = [];
  private layers: { node: PopulationAPI; settings: ChartLayerSettingsAPI }[] = [];
  constructor(private ctx: ScriptCtx) { super(); }
  get typeName() { return 'Chart'; }
  get name() { return this.ctx.snap.name; }
  get workspace() { return new WorkspaceAPI(this.ctx); }
  get type() { return this.kind ?? 'Pseudocolor'; }
  set type(s: string) {
    const t = displayType(String(s ?? ''));
    if (!t) throw new ScriptError(`Unrecognized type '${s}'\nAllowed values:\n ${GW_TYPES.join('\n')}\n`);
    this.kind = t;
  }
  get parameters() {
    const dims = DISPLAY_TYPES.find((d) => d.key === this.type)!.dims;
    return jlist(this.params.slice(0, dims).filter((x) => x !== undefined));
  }
  set parameters(list: string[]) {
    if (!list) return;
    const a = Array.from(list, String);
    if (a.length > 0) this.params[0] = a[0];
    if (a.length > 1) this.params[1] = a[1];
  }
  layer(pop: PopulationAPI, arg?: number | ChartLayerSettingsAPI): ChartLayerSettingsAPI | undefined {
    if (!(pop instanceof PopulationAPI)) throw new ScriptError('layer() needs a population');
    let l = this.layers.find((x) => x.node.sampleId === pop.sampleId && x.node.popId === pop.popId);
    if (arg instanceof ChartLayerSettingsAPI) {
      if (l) l.settings = arg; else this.layers.push({ node: pop, settings: arg });
      return arg;
    }
    if (!l) { l = { node: pop, settings: new ChartLayerSettingsAPI() }; this.layers.push(l); }
    if (arg !== undefined) { l.settings.color = Number(arg) | 0; return undefined; }
    return l.settings;
  }
  spec(): ChartSpec {
    return { type: this.type, params: [...this.params], layers: this.layers.map((l) => ({ sampleId: l.node.sampleId, popId: l.node.popId, color: l.settings.color })) };
  }
  display(): ChartWindowAPI {
    if (!this.layers.length) throw new ScriptError('Chart has no layers');
    const first = this.layers[0];
    const col = first.settings.color;
    this.ctx.ops.push({ op: 'plot', path: first.node.path, kind: this.type, ...(this.params[0] ? { x: this.params[0] } : {}), ...(this.params[1] ? { y: this.params[1] } : {}), ...(col !== -1 ? { foreColor: `#${((col >>> 0) & 0xffffff).toString(16).padStart(6, '0')}` } : {}) });
    return openWindow(this.ctx, first.node.sampleId, first.node.popId);
  }
  export(filepath: string, type?: string) {
    let t: string | null = null;
    if (type !== undefined && type !== null) {
      t = fileType(String(type));
      if (!t) throw new ScriptError(`Unrecognized file type '${type}'`);
    }
    if (!this.layers.length) throw new ScriptError('Error exporting chart');
    const file = baseName(filepath);
    const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : '';
    this.ctx.effects.push({ kind: 'export', chart: this.spec(), file, type: t ?? fileType(ext) ?? 'PNG' });
  }
}

// ChartWindowAPI: a graph window the script opened. The window opens when the
// run ends, so x / y read the location the script set (0 before), width /
// height read 0, and location / close act on the window afterwards.
export class ChartWindowAPI extends Base {
  private at = { x: 0, y: 0 };
  constructor(private ctx: ScriptCtx, private win: number, private title: string) { super(); }
  get typeName() { return 'ChartWindow'; }
  get name() { return this.title; }
  get x() { return this.at.x; }
  get y() { return this.at.y; }
  get width() { return 0; }
  get height() { return 0; }
  location(x: number, y: number) { this.at = { x: Number(x) | 0, y: Number(y) | 0 }; this.ctx.effects.push({ kind: 'move', win: this.win, ...this.at }); }
  close() { this.ctx.effects.push({ kind: 'close', win: this.win }); }
}

// MovieAPI (movie.create()): frames are charts rendered when appended;
// export writes an HTML movie (HtmlMovieCreator: frame delay 500 ms, auto
// play on) and returns its HTMLMovieResourceAPI, whose show() opens it.
export class MovieAPI extends Base {
  private frames: ChartSpec[] = [];
  frameDelay = 500;
  autoPlay = true;
  constructor(private ctx: ScriptCtx) { super(); }
  get typeName() { return 'Movie'; }
  get name() { return `${this.frames.length} frames`; }
  getFrameDelay() { return this.frameDelay; }
  setFrameDelay(v: number) { this.frameDelay = Number(v) | 0; }
  isAutoPlay() { return this.autoPlay; }
  setAutoPlay(v: boolean) { this.autoPlay = !!v; }
  append(chart: ChartAPI) {
    if (!(chart instanceof ChartAPI)) throw new ScriptError('append() needs a chart');
    const sp = chart.spec();
    if (!sp.layers.length) throw new ScriptError('Error creating chart for export');
    this.frames.push(sp);
  }
  export(path: string) {
    const b = baseName(path) || 'movie';
    const e: Extract<ScriptEffect, { kind: 'movie' }> = { kind: 'movie', file: /\.html?$/i.test(b) ? b : `${b}.html`, frames: structuredClone(this.frames), delay: this.frameDelay, autoPlay: this.autoPlay, show: false };
    this.ctx.effects.push(e);
    return new HTMLMovieResourceAPI(String(path), e);
  }
}
export class HTMLMovieResourceAPI extends Base {
  constructor(private ref: string, private e: { show: boolean }) { super(); }
  get typeName() { return 'UserResource'; }
  get name() { return `HTML Movie: ${this.ref}`; }
  show() { this.e.show = true; return true; }
}
export class MovieAPICreator {
  constructor(private ctx: ScriptCtx) {}
  create() { return new MovieAPI(this.ctx); }
  toString() { return 'MovieAPICreator'; }
}

export class WorkspaceAPI extends Base {
  constructor(private ctx: ScriptCtx) { super(); }
  get typeName() { return 'Workspace'; }
  get name() { return this.ctx.snap.name; }
  get samples() { return popList(this.ctx.snap.samples.map((s) => new SampleAPI(this.ctx, s.id))); }
  get groups() { const g = new GroupMgrAPI(this.ctx); return indexed(g, null, (s) => g.get(s)); }
  chart() { return new ChartAPI(this.ctx); }
}

for (const c of [StatisticAPI, StatNodeAPI, PopulationAPI, SampleAPI, GatedPopulationAPI, RectGateAPI, RangeGateAPI, FileMaskGateAPI, PopulationListAPI, KeywordSetAPI, ParameterAPI, ParameterListAPI, GroupAPI, GroupMgrAPI, ChartLayerSettingsAPI, ChartAPI, ChartWindowAPI, MovieAPI, HTMLMovieResourceAPI, WorkspaceAPI]) beanify(c);

// com.treestar.lib.numeric.MathUtil, the "math" object (FlowJo removes the
// standard Math object from the scope; here Math stays available).
const nums = (a: unknown): number[] => Array.from(a as ArrayLike<unknown>, Number);
const jround = (x: number) => Math.floor(x + 0.5); // java.lang.Math.round
const pin = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const MATH = {
  PI2: 2 * Math.PI, PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT1_2: Math.SQRT1_2, SQRT2: Math.SQRT2, PHI: 1.618,
  abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan, atan2: Math.atan2, cos: Math.cos, exp: Math.exp,
  log: Math.log, log10: Math.log10, log2: Math.log2, pow: Math.pow, random: Math.random,
  sin: Math.sin, sqrt: Math.sqrt, tan: Math.tan, sqr: (x: number) => x * x,
  // ceil / floor return Java ints; logx(x, base).
  ceil: (x: number) => Math.trunc(Math.ceil(x)), floor: (x: number) => Math.trunc(Math.floor(x)),
  logx: (x: number, b: number) => Math.log(x) / Math.log(b),
  // round(x, digits); one argument: Math.round (own superset).
  round: (x: number, digits?: number) => { if (digits === undefined) return Math.round(x); const f = 10 ** (digits | 0); return jround(x * f) / f; },
  roundToNearest: (x: number, step: number) => jround(x / step) * step,
  roundToCommonFactorOf2: function r2(x: number): number { return x === 0 ? 0 : x >= 1.5 ? 2 * jround(x / 2) : x >= 0.5 ? 1 : 2 / r2(2 / x); },
  isInteger: (x: number) => jround(x) === x,
  bitSet: (v: number, bit: number) => ((v | 0) & (bit | 0)) !== 0,
  different: (a: number, b: number, tol: number) => Math.abs(a - b) > tol,
  compare: (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0),
  minMagnitude: (a: number, b: number) => (Math.abs(a | 0) < Math.abs(b | 0) ? a | 0 : b | 0),
  pin, pin0: (x: number) => Math.max(x, 0),
  inRange: (v: number, lo: number, hi: number) => v >= lo && v <= hi,
  // Angles: radians for positiveAngularDifference, degrees for the others.
  positiveAngularDifference: (a: number, b: number) => { let d = (b - a) % (2 * Math.PI); if (d < 0) d += 2 * Math.PI; return d; },
  normalizeDegrees: (d: number) => { let x = d; while (x > 360) x -= 360; while (x <= 0) x += 360; return x; },
  getLineAngle: (x1: number, y1: number, x2: number, y2: number) => { if (x1 === x2 && y1 === y2) return 0; return MATH.normalizeDegrees(180 - (Math.atan2(x2 - x1, y2 - y1) * 180) / Math.PI); },
  completion: (v: number, start: number, end: number) => (start === end ? 1 : pin((v - start) / (end - start), 0, 1)),
  max: (...a: unknown[]) => Math.max(...(a.length === 1 && typeof a[0] === 'object' ? nums(a[0]) : (a as number[]))),
  min: (...a: unknown[]) => Math.min(...(a.length === 1 && typeof a[0] === 'object' ? nums(a[0]) : (a as number[]))),
  sum: (a: number[]) => nums(a).reduce((s, x) => s + x, 0),
  mean: (a: number[]) => { const v = nums(a); return v.reduce((s, x) => s + x, 0) / v.length; },
  median: (a: number[]) => { const v = nums(a).sort((x, y) => x - y); const n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : NaN; },
  stddev: (a: number[]) => { const v = nums(a); const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); },
  anyNonNumbers: (a: number[]) => nums(a).some((x) => !Number.isFinite(x)),
  // slopeIntercept(values, start, n): least squares of values[start + i] on i.
  slopeIntercept: (a: number[], start: number, n: number) => {
    const v = nums(a);
    let sxy = 0, sx = 0, sy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { const y = v[start + i]; sx += i; sxx += i * i; sy += y; sxy += i * y; }
    const den = n * sxx - sx * sx;
    const slope = den !== 0 ? (n * sxy - sx * sy) / den : 0;
    return [slope, (sy - slope * sx) / n];
  },
  // invert(matrix, n): Gauss-Jordan inverse of a row-major n x n matrix
  // without pivoting; a zero pivot is replaced by 1e-4 (float).
  invert: (a: number[], n: number) => {
    const m = nums(a), w = 2 * n, t = new Float64Array(n * w);
    for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) t[i * w + j] = m[i * n + j]; t[i * w + n + i] = 1; }
    for (let i = 0; i < n; i++) {
      let d = t[i * w + i];
      if (d === 0) d = Math.fround(1e-4);
      for (let j = 0; j < w; j++) t[i * w + j] /= d;
      for (let k = 0; k < n; k++) if (k !== i) { const f = t[k * w + i]; for (let j = 0; j < w; j++) t[k * w + j] -= f * t[i * w + j]; }
    }
    const out: number[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(t[i * w + n + j]);
    return out;
  },
  // distributionStatistics(values, n): [mean, sd, median, min, max, q1, q3];
  // n = 0 and n = 1 give seven zeros (as FlowJo's code does).
  distributionStatistics: (a: number[], n: number) => {
    if (n <= 1) return [0, 0, 0, 0, 0, 0, 0];
    const v = nums(a).slice(0, n).sort((x, y) => x - y);
    const mean = v.reduce((s, x) => s + x, 0) / n;
    const med = n % 2 === 0 ? (v[n / 2 - 1] + v[n / 2]) / 2 : v[Math.floor(n / 2)];
    let q1: number, q3: number;
    if (n < 3) { q1 = v[0]; q3 = v[n - 1]; } else if (n % 3 === 0) { q1 = v[n / 3 - 1]; q3 = v[(2 * n) / 3]; } else {
      const i = Math.floor(n / 3) - 1, j = Math.floor((2 * n) / 3);
      const p1 = (i + 1) / (n + 1), p2 = (i + 2) / (n + 1), p3 = (j + 1) / (n + 1), p4 = (j + 2) / (n + 1);
      q1 = v[i] + ((v[i + 1] - v[i]) * (0.25 - p1)) / (p2 - p1);
      q3 = v[j] + ((v[j + 1] - v[j]) * (0.75 - p3)) / (p4 - p3);
    }
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    return [mean, sd, med, v[0], v[n - 1], q1, q3];
  },
  name: 'MathUtil',
  toString: () => 'MathUtil',
};

// ConsoleWriter: log(obj[, color]) and error(obj) (red).
function consoleWriter(ctx: ScriptCtx) {
  const put = (text: string, color: OutLine['color']) => ctx.out.push({ writer: ctx.writer, text: `${text}\n`, color });
  return {
    log: (o: unknown, color?: string) => put(display(o), color === 'red' ? 'red' : color === 'blue' ? 'blue' : 'black'),
    error: (o: unknown) => put(display(o), 'red'),
    toString: () => 'ConsoleWriter',
  };
}

// Context.toString of a result.
export function display(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype) return `{${Object.entries(v as object).map(([k, x]) => `${k}=${display(x)}`).join(', ')}}`;
  return String(v);
}

// The scope names a script sees.
export function makeScope(ctx: ScriptCtx): Record<string, unknown> {
  return {
    workspace: new WorkspaceAPI(ctx),
    stats: new StatAPICreator(),
    math: MATH,
    movie: new MovieAPICreator(ctx),
    console: consoleWriter(ctx),
  };
}

// ScriptEvaluator.formatError: "message (line L, column C)".
export function formatError(e: unknown, code: string): string {
  const msg = e instanceof Error ? `${e.name === 'Error' || e instanceof ScriptError ? '' : `${e.name}: `}${e.message}` : String(e);
  const m = e instanceof Error ? /<anonymous>:(\d+):(\d+)/.exec(e.stack ?? '') : null;
  if (m) {
    // new Function adds two header lines before the body; eval keeps lines.
    const line = Number(m[1]);
    if (line >= 1 && line <= code.split('\n').length) return `${msg} (line ${line}, column ${m[2]})`;
  }
  return msg;
}

// Names a script cannot reach from its scope (defence in depth inside the worker).
const BLOCKED = ['self', 'globalThis', 'postMessage', 'fetch', 'importScripts', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'indexedDB', 'caches', 'close', 'onmessage', 'Worker'];

// ScriptEvaluator.run: a fresh scope per run; the completion value is printed
// in blue unless undefined; errors print in red.
export function runScript(code: string, ctx: ScriptCtx): void {
  const scope = makeScope(ctx);
  for (const b of BLOCKED) scope[b] = undefined;
  try {
    const f = new Function('__scope', '__code', 'with (__scope) { return eval(__code); }');
    const r = f(scope, code);
    if (r !== undefined) ctx.out.push({ writer: ctx.writer, text: `${display(r)}\n`, color: 'blue' });
  } catch (e) {
    ctx.out.push({ writer: ctx.writer, text: `${formatError(e, code)}\n`, color: 'red' });
  }
}

// ScriptConsoleThread: one scope for the whole session (the global scope of
// the script worker); the last result is kept in "_"; the shell echoes
// ">>> command" and "      = result".
export function runConsole(cmd: string, ctx: ScriptCtx, global: Record<string, unknown>): void {
  Object.assign(global, makeScope(ctx));
  ctx.out.push({ writer: ctx.writer, text: `\n>>> ${cmd}`, color: 'black' });
  try {
    const r = (0, eval)(cmd);
    global._ = r;
    ctx.out.push({ writer: ctx.writer, text: r !== undefined ? `\n      = ${display(r)}\n` : '\n', color: 'blue' });
  } catch (e) {
    ctx.out.push({ writer: ctx.writer, text: `\n${formatError(e, cmd)}\n`, color: 'red' });
  }
}
