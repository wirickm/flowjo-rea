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

export interface SnapPop { id: string; name: string; parentId: string | null; count: number | null }
export interface SnapParam { name: string; stain: string; longName: string; index: number }
export interface SnapSample { id: string; name: string; keywords: Record<string, string>; params: SnapParam[]; total: number | null; pops: SnapPop[] }
export interface ScriptSnapshot { name: string; samples: SnapSample[]; groups: { name: string; sampleIds: string[] }[] }

export interface StatReq { sampleId: string; path: string; stat: StatKind; channel?: string; percentile?: number; correlate?: string }
export const statKey = (r: StatReq) => JSON.stringify([r.sampleId, r.path, r.stat, r.channel ?? '', r.percentile ?? '', r.correlate ?? '']);

export type ScriptOp =
  | { op: 'rename'; sampleId: string; popId: string; name: string }
  | { op: 'keyword'; sampleId: string; key: string; value: string | null }
  | { op: 'groupCreate'; name: string }
  | { op: 'groupRemove'; name: string }
  | { op: 'groupAdd'; name: string; sampleId: string }
  | { op: 'groupRemoveSample'; name: string; sampleId: string }
  // Rectangle (2 params) or range (1 param) gate, bounds in data units;
  // id is a temporary id ("new:N") other operations may name as parent.
  | { op: 'gate'; sampleId: string; parentId: string | null; id: string; name: string; params: string[]; min: number[]; max: number[] };

export interface OutLine { writer: string; text: string; color: 'black' | 'blue' | 'red' }

export const MAX_ROUNDS = 6;

// The mutable state a run works on. API objects hold ids and read ctx.snap on
// each access, so objects kept in console variables stay valid.
export interface ScriptCtx {
  snap: ScriptSnapshot;
  cache: Record<string, number>;
  missing: Map<string, StatReq>;
  ops: ScriptOp[];
  out: OutLine[];
  writer: string;
  tmp: number;
}

export function newCtx(snap: ScriptSnapshot, cache: Record<string, number> = {}, writer = ''): ScriptCtx {
  return { snap: structuredClone(snap), cache, missing: new Map(), ops: [], out: [], writer, tmp: 0 };
}

class ScriptError extends Error {}

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

// StatAPICreator: the statistics a script can ask for.
export class StatisticAPI extends Base {
  constructor(readonly stat: StatKind, readonly channel?: string, readonly percentile?: number, readonly correlate?: string) { super(); }
  get typeName() { return 'Statistic'; }
  get name() { return `${STAT_LABELS[this.stat]}${this.stat === 'percentile' ? ` ${this.percentile}` : ''}${this.channel ? ` : ${this.channel}` : ''}${this.correlate ? ` : ${this.correlate}` : ''}`; }
}
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
  get children() { return jlist(this.s.pops.filter((x) => x.parentId === this.popId).map((x) => node(this.ctx, this.sampleId, x.id))); }
  get annotation(): string { throw new ScriptError('Node annotations are not available in flowjo-rea'); }
  // AppNodeAPI.findAll: path parts split on "/"; "*" any child, "**" any
  // descendant, otherwise the child with that name.
  findAll(pattern: string | string[]): PopulationAPI[] {
    const parts = Array.isArray(pattern) ? pattern.map(String) : String(pattern).split('/').filter((x) => x !== '');
    const walk = (popId: string | null, rest: string[]): PopulationAPI[] => {
      if (!rest.length) return [node(this.ctx, this.sampleId, popId)];
      const [first, ...tail] = rest;
      let cand: SnapPop[];
      if (first === '**') {
        cand = [];
        const add = (id: string | null) => { for (const c of this.s.pops.filter((x) => x.parentId === id)) { cand.push(c); add(c.id); } };
        add(popId);
      } else cand = this.s.pops.filter((x) => x.parentId === popId && (first === '*' || x.name === first));
      return cand.flatMap((c) => walk(c.id, tail));
    };
    return jlist(walk(this.popId, parts));
  }
  populations(pattern: string) { return jlist(this.findAll(pattern)); }
  get count(): number {
    if (this.popId?.startsWith('new:')) return NaN;
    const c = this.p ? this.p.count : this.s.total;
    return c ?? this.stat(new StatisticAPI('count'));
  }
  stat(st: StatisticAPI): number {
    if (!(st instanceof StatisticAPI)) throw new ScriptError('stat() needs a statistic, e.g. stats.median("FSC-A")');
    if (this.popId?.startsWith('new:')) return NaN;
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
    if (!this.popId!.startsWith('new:')) this.ctx.ops.push({ op: 'rename', sampleId: this.sampleId, popId: this.popId!, name: p.name });
    else { const g = this.ctx.ops.find((o) => o.op === 'gate' && o.id === this.popId); if (g && g.op === 'gate') g.name = p.name; }
  }
  get gating() { return new GateAPICreator(this.ctx, this); }
  display(): never { throw new ScriptError('display() (chart windows) is not available in flowjo-rea scripts'); }
  add(): never { throw new ScriptError('add() of analysis nodes is not available in flowjo-rea scripts'); }
  remove(): never { throw new ScriptError('remove() of analysis nodes is not available in flowjo-rea scripts'); }
}

export class SampleAPI extends PopulationAPI {
  constructor(ctx: ScriptCtx, sampleId: string) { super(ctx, sampleId, null); }
  get keywords() { return keywordSet(this.ctx, this.sampleId); }
  get parameters() { return parameterList(this.ctx, this.sampleId); }
  get stains() { return jlist([...new Set(this.s.params.map((p) => p.stain).filter(Boolean))]); }
}

// Gate API nodes: what GateAPICreator returns (RectGateAPI / RangeGateAPI).
export class GateNodeAPI extends PopulationAPI {
  private get op() {
    const o = this.ctx.ops.find((x) => x.op === 'gate' && x.id === this.popId);
    if (!o || o.op !== 'gate') throw new ScriptError('Gate is no longer pending');
    return o;
  }
  get typeName() { return this.op.params.length === 2 ? 'RectangleGate' : 'RangeGate'; }
  get parameter() { return this.op.params[0]; }
  get minX() { return this.op.min[0]; } set minX(v: number) { this.op.min[0] = Number(v); }
  get maxX() { return this.op.max[0]; } set maxX(v: number) { this.op.max[0] = Number(v); }
  get minY() { return this.op.min[1]; } set minY(v: number) { this.op.min[1] = Number(v); }
  get maxY() { return this.op.max[1]; } set maxY(v: number) { this.op.max[1] = Number(v); }
  get min() { return this.op.min[0]; } set min(v: number) { this.op.min[0] = Number(v); }
  get max() { return this.op.max[0]; } set max(v: number) { this.op.max[0] = Number(v); }
}

function node(ctx: ScriptCtx, sid: string, popId: string | null): PopulationAPI {
  if (!popId) return new SampleAPI(ctx, sid);
  return popId.startsWith('new:') ? new GateNodeAPI(ctx, sid, popId) : new PopulationAPI(ctx, sid, popId);
}

// GateAPICreator: rectangle(name, x, y[, xmin, xmax, ymin, ymax]) and
// range(name, p[, min, max]) add a child gate; bounds default to 0 (the gate
// fields' Java default) and are in data units.
export class GateAPICreator {
  constructor(private ctx: ScriptCtx, private parent: PopulationAPI) {}
  private make(name: string, params: string[], min: number[], max: number[]) {
    const s = sampleOf(this.ctx, this.parent.sampleId);
    const pid = this.parent.popId;
    const nm = uniqueName(String(name), s.pops.filter((x) => x.parentId === pid).map((x) => x.name));
    const id = `new:${++this.ctx.tmp}`;
    s.pops.push({ id, name: nm, parentId: pid, count: null });
    this.ctx.ops.push({ op: 'gate', sampleId: s.id, parentId: pid, id, name: nm, params, min, max });
    return new GateNodeAPI(this.ctx, s.id, id);
  }
  rectangle(name: string, x: string, y: string, xmin = 0, xmax = 0, ymin = 0, ymax = 0) { return this.make(name, [String(x), String(y)], [Number(xmin), Number(ymin)], [Number(xmax), Number(ymax)]); }
  range(name: string, p: string, min = 0, max = 0) { return this.make(name, [String(p)], [Number(min)], [Number(max)]); }
  fileMask(): never { throw new ScriptError('fileMask() gates are not available in flowjo-rea scripts'); }
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

export class WorkspaceAPI extends Base {
  constructor(private ctx: ScriptCtx) { super(); }
  get typeName() { return 'Workspace'; }
  get name() { return this.ctx.snap.name; }
  get samples() { return popList(this.ctx.snap.samples.map((s) => new SampleAPI(this.ctx, s.id))); }
  get groups() { const g = new GroupMgrAPI(this.ctx); return indexed(g, null, (s) => g.get(s)); }
  chart(): never { throw new ScriptError('workspace.chart() (ChartAPI) is not available in flowjo-rea scripts'); }
}

for (const c of [StatisticAPI, PopulationAPI, SampleAPI, GateNodeAPI, PopulationListAPI, KeywordSetAPI, ParameterAPI, ParameterListAPI, GroupAPI, GroupMgrAPI, WorkspaceAPI]) beanify(c);

// com.treestar.lib.numeric.MathUtil, the "math" object (FlowJo removes the
// standard Math object from the scope; here Math stays available).
const nums = (a: unknown): number[] => Array.from(a as ArrayLike<unknown>, Number);
export const MATH = {
  abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan, atan2: Math.atan2, ceil: Math.ceil, cos: Math.cos, exp: Math.exp,
  floor: Math.floor, log: Math.log, log10: Math.log10, log2: Math.log2, pow: Math.pow, random: Math.random, round: Math.round,
  sin: Math.sin, sqrt: Math.sqrt, tan: Math.tan, sqr: (x: number) => x * x,
  max: (...a: unknown[]) => Math.max(...(a.length === 1 && Array.isArray(a[0]) ? (a[0] as number[]) : (a as number[]))),
  min: (...a: unknown[]) => Math.min(...(a.length === 1 && Array.isArray(a[0]) ? (a[0] as number[]) : (a as number[]))),
  sum: (a: number[]) => nums(a).reduce((s, x) => s + x, 0),
  mean: (a: number[]) => { const v = nums(a); return v.reduce((s, x) => s + x, 0) / v.length; },
  median: (a: number[]) => { const v = nums(a).sort((x, y) => x - y); const n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : NaN; },
  stddev: (a: number[]) => { const v = nums(a); const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); },
  pin: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)),
  inRange: (v: number, lo: number, hi: number) => v >= lo && v <= hi,
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
    movie: { create() { throw new ScriptError('movie.create() (MovieAPI) is not available in flowjo-rea scripts'); }, toString: () => 'MovieAPICreator' },
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
