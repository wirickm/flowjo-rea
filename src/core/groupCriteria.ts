// FlowJo 10.6.2 group criteria (specs section 7.1): keyword criteria, stain
// sets, reference groups and group roles. Behavior read from FlowJo's
// KeywordCriterion, GroupCriteria, CriteriaTest, Group$Role, ParameterList
// and ParseUtil classes (Ghidra 12.1.4, checked with javap); implemented
// independently here. This module is the one owner of these rules.
import type { Group, GroupCriteria, GroupRole, KeywordRule, SampleState, Workspace } from './model';

// FlowJo's 9 criterion functions, in FlowJo's index order, with the text it
// writes in .wsp files (CriteriaTest.functionNames, English dictionary).
export const FLOWJO_FUNCTIONS: readonly { op: KeywordRule['op']; text: string }[] = [
  { op: 'equals', text: '=' },
  { op: 'notEquals', text: '≠' },
  { op: 'gt', text: '>' },
  { op: 'gte', text: '>=' },
  { op: 'lt', text: '<' },
  { op: 'lte', text: '<=' },
  { op: 'contains', text: 'Contains' },
  { op: 'notContains', text: 'Lacks' },
  { op: 'exists', text: 'Exists' },
];
// FlowJo's three connectors and the text it writes (dictionary values).
export const FLOWJO_CONNECTORS: readonly { connector: KeywordRule['connector']; text: string }[] = [
  { connector: 'and', text: 'And' },
  { connector: 'or', text: 'Or' },
  { connector: 'andNot', text: '& Not' },
];
// FlowJo holds at most 4 keyword criteria per group (GroupCriteria slots).
export const MAX_KEYWORD_CRITERIA = 4;

// FlowJo looks names up trimmed and lower-cased (StringUtil.indexOfArray).
const lookup = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
// An unknown function or connector text becomes index 0 ("=" / "And").
export function functionFromText(text: string | null | undefined): KeywordRule['op'] {
  return FLOWJO_FUNCTIONS.find((f) => lookup(f.text) === lookup(text))?.op ?? 'equals';
}
export function connectorFromText(text: string | null | undefined): KeywordRule['connector'] {
  return FLOWJO_CONNECTORS.find((c) => lookup(c.text) === lookup(text))?.connector ?? 'and';
}
// This app's own operators (not in FlowJo) have no FlowJo text.
export function functionText(op: KeywordRule['op']): string | undefined {
  return FLOWJO_FUNCTIONS.find((f) => f.op === op)?.text;
}
export function connectorText(c: KeywordRule['connector']): string {
  return FLOWJO_CONNECTORS.find((x) => x.connector === c)!.text;
}

// Java String.trim: removes characters <= U+0020 at both ends.
export function javaTrim(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && s.charCodeAt(a) <= 0x20) a++;
  while (b > a && s.charCodeAt(b - 1) <= 0x20) b--;
  return s.slice(a, b);
}

// Java Double.parseDouble for decimal input (hexadecimal floats are not
// handled; they are not expected in FCS keywords). Returns undefined when
// Java would throw.
const JAVA_DOUBLE = /^[+-]?(NaN|Infinity|((\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?))$/;
export function javaParseDouble(s: string): number | undefined {
  const t = javaTrim(s);
  if (!JAVA_DOUBLE.test(t)) return undefined;
  return Number(t.replace(/[fFdD]$/, ''));
}

// FlowJo's ParseUtil.isNumber: "0" yes; empty or "null" no; one trailing "%"
// is ignored and "%" alone counts as a number; otherwise Java's parser, then
// the locale number format (here: digits with "," thousands separators).
export function flowjoIsNumber(s: string | undefined): boolean {
  if (s === '0') return true;
  if (s === undefined || s === 'null' || s === '') return false;
  let t = javaTrim(s);
  if (t.endsWith('%')) t = t.slice(0, -1);
  if (t.length === 0) return true;
  if (javaParseDouble(t) !== undefined) return true;
  return /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t);
}

// Java String.compareToIgnoreCase (per UTF-16 unit: upper-case, then lower-case).
export function compareToIgnoreCase(a: string, b: string): number {
  const one = (c: string, f: 'toUpperCase' | 'toLowerCase') => {
    const x = c[f]();
    return x.length === 1 ? x : c;
  };
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let c1 = a[i];
    let c2 = b[i];
    if (c1 === c2) continue;
    c1 = one(c1, 'toUpperCase');
    c2 = one(c2, 'toUpperCase');
    if (c1 === c2) continue;
    c1 = one(c1, 'toLowerCase');
    c2 = one(c2, 'toLowerCase');
    if (c1 !== c2) return c1.charCodeAt(0) - c2.charCodeAt(0);
  }
  return a.length - b.length;
}

// FlowJo's keyword lookup on a sample (KeywordedParameterList.get): a
// parameter name gives that parameter's stain ($PnS); "a + b" joins the
// values of a and b with a space (a missing one counts as a space);
// FILENAME is the file name; otherwise annotations, then keywords.
export function flowjoKeywordValue(s: SampleState, key: string): string | undefined {
  if (key === '') return '';
  const kw = s.keywordsSnapshot;
  const n = Number(kw.$PAR ?? 0);
  for (let i = 1; i <= n; i++) if (kw[`$P${i}N`] === key) return kw[`$P${i}S`] ?? '';
  if (key.indexOf(' + ') > 0) {
    let out = '';
    let rest = key;
    while (rest.length > 0) {
      const at = rest.indexOf(' + ');
      const part = at < 0 ? rest : rest.slice(0, at);
      rest = at < 0 ? '' : rest.slice(at + 3);
      const v = flowjoKeywordValue(s, part) ?? ' ';
      out = out.length > 0 ? `${out} ${v}` : out + v;
    }
    return out;
  }
  if (key === 'FILENAME') return s.fileName;
  return s.annotations?.[key] ?? kw[key] ?? kw[key.toUpperCase()];
}

// A criterion takes part only with a keyword and a non-empty value
// (KeywordCriterion.isActive), also for "Exists".
export const isActiveRule = (r: KeywordRule) => !!r.keyword && r.value.length > 0;

// One criterion's test (KeywordCriterion.evalFunction). A missing keyword is
// false. The six comparisons are numeric when the sample's value is a
// number, otherwise case-insensitive string order. Contains / Lacks are
// case-insensitive substring tests. FlowJo throws when the sample's value is
// numeric but the criterion's is not; here that criterion is false.
export function evalRule(s: SampleState, r: KeywordRule): boolean {
  const raw = flowjoKeywordValue(s, r.keyword);
  if (raw === undefined) return false;
  const v = javaTrim(raw);
  const q = javaTrim(r.value);
  const numericOp = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte'].includes(r.op);
  if (numericOp && flowjoIsNumber(v)) {
    const a = javaParseDouble(v);
    const b = javaParseDouble(q);
    if (a === undefined || b === undefined) return false;
    switch (r.op) {
      case 'equals': return a === b;
      case 'notEquals': return a !== b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      default: return a <= b;
    }
  }
  const c = compareToIgnoreCase(v, q);
  const lv = v.toLowerCase();
  const lq = r.value.toLowerCase(); // FlowJo lower-cases the untrimmed value here
  switch (r.op) {
    case 'equals': return c === 0;
    case 'notEquals': return c !== 0;
    case 'gt': return c > 0;
    case 'gte': return c >= 0;
    case 'lt': return c < 0;
    case 'lte': return c <= 0;
    case 'contains': return lv.includes(lq);
    case 'notContains': return !lv.includes(lq);
    case 'exists': return true;
    // This app's own operators (not in FlowJo).
    case 'startsWith': return lv.startsWith(lq);
    case 'endsWith': return lv.endsWith(lq);
  }
}

// Connector applied to the running result (KeywordCriterion.evalConnector).
function connect(acc: boolean, hit: boolean, c: KeywordRule['connector']): boolean {
  return c === 'and' ? acc && hit : c === 'or' ? acc || hit : acc && !hit;
}

// Keyword criteria combined as FlowJo does: the running result starts true
// and every active criterion, the first one included, applies its connector
// (so a first criterion with "Or" makes the keyword part true). Inactive
// criteria are skipped.
export function evalRules(s: SampleState, rules: KeywordRule[]): boolean {
  let acc = true;
  for (const r of rules.slice(0, MAX_KEYWORD_CRITERIA)) if (isActiveRule(r)) acc = connect(acc, evalRule(s, r), r.connector);
  return acc;
}

// FlowJo's scatter and time detection (ParameterUtil): a name starting with
// FS / Forward is forward scatter; BSC / SS / SSC / OrthSc / ObtSc / 90D /
// Side is side scatter (case-insensitive); a name containing "time" is time.
const FS_NAMES = ['FS', 'FORWARD'];
const SS_NAMES = ['BSC', 'SS', 'SSC', 'ORTHSC', 'OBTSC', '90D', 'SIDE'];
export const isScatterOrTime = (name: string) => {
  const u = name.toUpperCase();
  return FS_NAMES.some((p) => u.startsWith(p)) || SS_NAMES.some((p) => u.startsWith(p)) || name.toLowerCase().includes('time');
};

// A sample's stain set (ParameterList.getStainSet): the trimmed non-empty
// $PnS of every measured parameter that is not scatter or time, in parameter
// order, joined with ", ".
export function stainSet(s: SampleState): string {
  const kw = s.keywordsSnapshot;
  const n = Number(kw.$PAR ?? 0);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const name = kw[`$P${i}N`] ?? '';
    if (isScatterOrTime(name)) continue;
    const stain = javaTrim(kw[`$P${i}S`] ?? '');
    if (stain) out.push(stain);
  }
  return out.join(', ');
}

// Whether a sample belongs to a live group with FlowJo criteria
// (GroupCriteria.acceptSolo and accept). With neither stain sets nor an
// active first criterion nothing is accepted. Stain sets must contain the
// sample's stain set exactly. A reference group then combines: "also" =
// either, "only" = both; an unknown function accepts nothing.
export function acceptCriteria(ws: Workspace, s: SampleState, c: GroupCriteria): boolean {
  const stains = c.stains ?? [];
  const first = c.rules[0];
  let solo: boolean;
  if (stains.length === 0 && !(first && isActiveRule(first))) solo = false;
  else if (stains.length > 0 && !stains.includes(stainSet(s))) solo = false;
  else solo = evalRules(s, c.rules);
  if (!c.refGroup) return solo;
  const ref = ws.groups.find((g) => g.name === c.refGroup!.name);
  const inRef = !!ref && ref.sampleIds.includes(s.id);
  if (c.refGroup.fn === 'also') return solo || inRef;
  if (c.refGroup.fn === 'only') return solo && inRef;
  return false;
}

// Group roles and FlowJo's .wsp text for them.
export const GROUP_ROLES: readonly { role: GroupRole; text: string; label: string }[] = [
  { role: 'undefined', text: 'ws.group.dlog.undefined', label: 'Undefined' },
  { role: 'test', text: 'ws.group.dlog.test', label: 'Test' },
  { role: 'controls', text: 'ws.group.dlog.controls', label: 'Controls' },
  { role: 'replicate', text: 'ws.group.dlog.replicate', label: 'Replicate' },
  { role: 'compensation', text: 'ws.group.dlog.compensation', label: 'Compensation' },
  { role: 'instrumentation', text: 'ws.group.dlog.instrumentation', label: 'Instrumentation' },
  { role: 'baseline', text: 'ws.group.dlog.baseline', label: 'Baseline' },
  { role: 'gatingLevel', text: 'ws.group.dlog.gatinglevel', label: 'Gating level' },
];
export const roleText = (r: GroupRole) => GROUP_ROLES.find((x) => x.role === r)!.text;

// FlowJo's reading of a role attribute (Group$Role.fromString): by substring
// of the upper-cased text, in this order; anything else is undefined. As in
// FlowJo, the replicate, baseline and gating-level texts it writes read back
// as undefined.
export function roleFromText(text: string | null | undefined): GroupRole {
  const u = (text ?? '').toUpperCase();
  if (u.includes('TEST')) return 'test';
  if (u.includes('CONTROLS')) return 'controls';
  if (u.includes('COMPENSATION')) return 'compensation';
  if (u.includes('INSTRUMENTATION')) return 'instrumentation';
  if (u.includes('MFO')) return 'gatingLevel';
  if (u.includes('COPY')) return 'replicate';
  return 'undefined';
}

// Every n-th member of a group, from the first (Group.getEveryNthSample);
// n below 1 counts as 1.
export function everyNth<T>(items: T[], n: number): T[] {
  const k = Math.max(1, Math.floor(n));
  return items.filter((_, i) => i % k === 0);
}

// Remove samples from one group only (FlowJo asks whether to remove from the
// workspace or the current group). "All Samples" and live groups cannot lose
// members this way: their membership is computed.
export function removeFromGroup(ws: Workspace, groupId: string, sampleIds: string[]): boolean {
  const g: Group | undefined = ws.groups.find((x) => x.id === groupId);
  if (!g || g.id === 'all' || g.criteria) return false;
  const drop = new Set(sampleIds);
  const before = g.sampleIds.length;
  g.sampleIds = g.sampleIds.filter((id) => !drop.has(id));
  return g.sampleIds.length !== before;
}
