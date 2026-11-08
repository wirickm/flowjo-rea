// Boolean gates as FlowJo 10.6.2 builds them (docs/validation/ui-gaps/workspace.md,
// section B): names (AndOrNode.generateName, NotGateNode, IdentityNode),
// Create Combination Gates (WSBoolGateAction.makeCombinationGates) and this
// app's own Boolean Expression dialog, which compiles a mixed expression into
// FlowJo's AND / OR / NOT nodes.
import { newId, uniqueName, type Gate, type Population, type SampleState } from './model';

export const SUPER_PLUS = '+'; // CombinationGatesDlog.superPlus (char 43)
export const SUPER_MINUS = '-'; // CombinationGatesDlog.superMinus (char 45)
export const MAX_COMBINATION = 12; // makeCombinationGates refuses more than 12 (and fewer than 2)

type BoolGate = Extract<Gate, { type: 'boolean' }>;

// NotGateNode: the operand's name plus "-".
export const notGateName = (name: string) => `${name}${SUPER_MINUS}`;
// IdentityNode: an OR node of one operand named "<name>=".
export const identityGateName = (name: string) => `${name}=`;

// AndOrNode.generateName: operand names joined by " & " (AND) or " or " (OR);
// a name containing " or ", " and " or " not " after its first character is
// put in brackets; each operand gets "+" (or "-" for a NOT node) unless its
// name already ends with that sign. combo: no connector (combination gates,
// "A+B-"). abbreviations: the naming dialog's map (subset name -> abbreviation).
export function booleanGateName(op: 'and' | 'or', operands: { name: string; isNot: boolean }[], combo = false, abbreviations: Record<string, string> = {}): string {
  const conn = combo ? '' : op === 'and' ? ' & ' : ' or ';
  let out = '';
  for (const o of operands) {
    let n = abbreviations[o.name] ?? o.name;
    if (n.indexOf(' or ') > 0 || n.indexOf(' and ') > 0 || n.indexOf(' not ') > 0) n = `(${n})`;
    out += conn + n;
    const last = n[n.length - 1];
    if (o.isNot) { if (last !== SUPER_MINUS) out += SUPER_MINUS; } else if (last !== SUPER_PLUS) out += SUPER_PLUS;
  }
  return out.length > conn.length ? out.slice(conn.length) : out;
}

const isNot = (p: Population) => p.gate.type === 'boolean' && p.gate.op === 'not';
const siblings = (s: SampleState, parentId: string | null) => s.populations.filter((p) => p.parentId === parentId).map((p) => p.name);

// The new AND or OR population of the selected populations (2 or more), as a
// sibling of the first (WSBoolGateAction.makeAndGate / makeOrGate).
export function makeAndOr(s: SampleState, op: 'and' | 'or', ids: string[], abbreviations: Record<string, string> = {}): Population | null {
  const ops = ids.map((id) => s.populations.find((p) => p.id === id)).filter((p): p is Population => !!p);
  if (ops.length < 2) return null;
  const name = uniqueName(booleanGateName(op, ops.map((p) => ({ name: p.name, isNot: isNot(p) })), false, abbreviations), siblings(s, ops[0].parentId));
  return { id: newId('pop'), name, parentId: ops[0].parentId, gate: { type: 'boolean', op, operands: ops.map((p) => ({ ref: p.id })) } };
}

// One NOT population per selected population, each a sibling of its operand
// (WSBoolGateAction.addNotGates).
export function makeNots(s: SampleState, ids: string[]): Population[] {
  const out: Population[] = [];
  for (const id of ids) {
    const p = s.populations.find((q) => q.id === id);
    if (!p) continue;
    out.push({ id: newId('pop'), name: uniqueName(notGateName(p.name), [...siblings(s, p.parentId), ...out.filter((o) => o.parentId === p.parentId).map((o) => o.name)]), parentId: p.parentId, gate: { type: 'boolean', op: 'not', operands: [{ ref: p.id }] } });
  }
  return out;
}

// Identical Gate (WSBoolGateAction.addIdentityGates): a reference to each
// selected gate, an OR node of that one population named "<name>=", placed
// beside it; it can then be moved elsewhere in the tree.
export function makeIdentities(s: SampleState, ids: string[]): Population[] {
  const out: Population[] = [];
  for (const id of ids) {
    const p = s.populations.find((q) => q.id === id);
    if (!p) continue;
    out.push({ id: newId('pop'), name: uniqueName(identityGateName(p.name), [...siblings(s, p.parentId), ...out.filter((o) => o.parentId === p.parentId).map((o) => o.name)]), parentId: p.parentId, gate: { type: 'boolean', op: 'or', operands: [{ ref: p.id }] } });
  }
  return out;
}

// The sign patterns of n operands in FlowJo's order (getCombos): positive
// before negative, the first operand varying slowest.
export function combinationPatterns(n: number): boolean[][] {
  let out: boolean[][] = [[true], [false]];
  for (let k = 1; k < n; k++) out = out.flatMap((c) => [[...c, true], [...c, false]]);
  return out;
}

// Create Combination Gates: for 2 to 12 selected populations, a NOT node of
// each (named "<abbreviation>-"), then one AND node per sign pattern (2^n),
// named by concatenation ("CD4+CD8-"); all are children of the first
// population's parent. Returns null when the count is out of range.
export function makeCombination(s: SampleState, ids: string[], abbreviations: Record<string, string> = {}): Population[] | null {
  const ops = ids.map((id) => s.populations.find((p) => p.id === id)).filter((p): p is Population => !!p);
  if (ops.length < 2 || ops.length > MAX_COMBINATION) return null;
  const parentId = ops[0].parentId;
  const out: Population[] = [];
  const taken = () => [...siblings(s, parentId), ...out.map((o) => o.name)];
  const pairs = ops.map((p) => {
    const not: Population = { id: newId('pop'), name: '', parentId, gate: { type: 'boolean', op: 'not', operands: [{ ref: p.id }] } };
    not.name = uniqueName(notGateName(abbreviations[p.name] ?? p.name), taken());
    out.push(not);
    return [p, not] as const;
  });
  for (const pattern of combinationPatterns(ops.length)) {
    const chosen = pattern.map((pos, i) => (pos ? pairs[i][0] : pairs[i][1]));
    const name = booleanGateName('and', chosen.map((p, i) => ({ name: p.name, isNot: !pattern[i] })), true, abbreviations);
    out.push({ id: newId('pop'), name: uniqueName(name, taken()), parentId, gate: { type: 'boolean', op: 'and', operands: chosen.map((p) => ({ ref: p.id })) } });
  }
  return out;
}

// --- Boolean Expression (own rule; FlowJo 10.6.2's dialog is an unfinished
// stub that creates nothing) ---------------------------------------------------
// Grammar: or := and ("or" | "|") and ...; and := not ("and" | "&") not ...;
// not := ("not" | "!") not | "(" or ")" | name. Names are population names,
// matched exactly; a name with spaces or operator words is written in double
// quotes. Keywords are case-insensitive.
export type BoolExpr = { kind: 'ref'; name: string } | { kind: 'not'; arg: BoolExpr } | { kind: 'and' | 'or'; args: BoolExpr[] };

export class BoolExprError extends Error {}

function tokenize(text: string): string[] {
  const toks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if ('()&|!'.includes(c)) { toks.push(c); i++; continue; }
    if (c === '"') {
      const j = text.indexOf('"', i + 1);
      if (j < 0) throw new BoolExprError('Missing closing quote');
      toks.push(`"${text.slice(i + 1, j)}`);
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < text.length && !/[\s()&|!"]/.test(text[j])) j++;
    toks.push(text.slice(i, j));
    i = j;
  }
  return toks;
}

// Bare words are joined back into names with single spaces, so "CD4 T cells
// and B" reads as the population "CD4 T cells" and the population "B".
export function parseBoolExpr(text: string): BoolExpr {
  const toks = tokenize(text);
  let k = 0;
  const kw = (t: string | undefined, w: string) => t !== undefined && !t.startsWith('"') && t.toLowerCase() === w;
  const isOp = (t: string | undefined) => t === undefined || ['(', ')', '&', '|', '!'].includes(t) || kw(t, 'and') || kw(t, 'or') || kw(t, 'not');
  const parseOr = (): BoolExpr => {
    const args = [parseAnd()];
    while (toks[k] === '|' || kw(toks[k], 'or')) { k++; args.push(parseAnd()); }
    return args.length === 1 ? args[0] : { kind: 'or', args };
  };
  const parseAnd = (): BoolExpr => {
    const args = [parseNot()];
    while (toks[k] === '&' || kw(toks[k], 'and')) { k++; args.push(parseNot()); }
    return args.length === 1 ? args[0] : { kind: 'and', args };
  };
  const parseNot = (): BoolExpr => {
    const t = toks[k];
    if (t === '!' || kw(t, 'not')) { k++; return { kind: 'not', arg: parseNot() }; }
    if (t === '(') {
      k++;
      const e = parseOr();
      if (toks[k] !== ')') throw new BoolExprError('Missing ")"');
      k++;
      return e;
    }
    if (t === undefined || isOp(t)) throw new BoolExprError(t === undefined ? 'Expression ends too early' : `Unexpected "${t}"`);
    if (t.startsWith('"')) { k++; return { kind: 'ref', name: t.slice(1) }; }
    const words: string[] = [];
    while (!isOp(toks[k]) && !toks[k]!.startsWith('"')) words.push(toks[k++]!);
    return { kind: 'ref', name: words.join(' ') };
  };
  if (!toks.length) throw new BoolExprError('Enter an expression');
  const e = parseOr();
  if (k < toks.length) throw new BoolExprError(`Unexpected "${toks[k]}"`);
  return e;
}

const quote = (n: string) => (/^[^\s()&|!"]+$/.test(n) && !['and', 'or', 'not'].includes(n.toLowerCase()) ? n : `"${n}"`);

export function formatBoolExpr(e: BoolExpr, top = true): string {
  if (e.kind === 'ref') return quote(e.name);
  if (e.kind === 'not') return `not ${formatBoolExpr(e.arg, false)}`;
  const s = e.args.map((a) => formatBoolExpr(a, false)).join(` ${e.kind} `);
  return top ? s : `(${s})`;
}

// The expression of an existing boolean population, written with its
// operands' names (a NOT, AND or OR node whose operand is itself a boolean
// node in the same parent is written as a nested expression only when that
// node was made for this expression, i.e. it has no other users).
export function exprOfGate(s: SampleState, id: string): string {
  const p = s.populations.find((q) => q.id === id);
  if (!p || p.gate.type !== 'boolean') return '';
  const g = p.gate;
  const ref = (o: BoolGate['operands'][number]): BoolExpr => {
    const q = s.populations.find((x) => x.id === o.ref);
    const e: BoolExpr = { kind: 'ref', name: q?.name ?? '?' };
    return o.complement ? { kind: 'not', arg: e } : e;
  };
  const e: BoolExpr = g.op === 'not' ? { kind: 'not', arg: ref(g.operands[0]) } : g.operands.length === 1 ? ref(g.operands[0]) : { kind: g.op, args: g.operands.map(ref) };
  return formatBoolExpr(e);
}

const sameGate = (a: BoolGate, b: BoolGate) => a.op === b.op && a.operands.length === b.operands.length && a.operands.every((o, i) => o.ref === b.operands[i].ref && !o.complement === !b.operands[i].complement);

// Compiles an expression over the populations under parentId into FlowJo
// nodes: the top node's gate, plus the intermediate NOT / AND / OR nodes it
// needs (siblings named by FlowJo's rules; an equivalent existing sibling is
// reused). Throws BoolExprError for an unknown name.
export function compileBoolExpr(s: SampleState, parentId: string | null, e: BoolExpr, excludeId?: string): { gate: BoolGate; added: Population[]; name: string } {
  const added: Population[] = [];
  const pool = () => [...s.populations, ...added];
  const named = (n: string) => {
    const hits = s.populations.filter((p) => p.name === n && p.id !== excludeId);
    const hit = hits.find((p) => p.parentId === parentId) ?? hits[0];
    if (!hit) throw new BoolExprError(`No population named "${n}"`);
    return hit;
  };
  const gateOf = (x: BoolExpr): { gate: BoolGate; name: string } => {
    if (x.kind === 'not') { const p = node(x.arg); return { gate: { type: 'boolean', op: 'not', operands: [{ ref: p.id }] }, name: notGateName(p.name) }; }
    if (x.kind === 'ref') { const p = named(x.name); return { gate: { type: 'boolean', op: 'or', operands: [{ ref: p.id }] }, name: identityGateName(p.name) }; }
    const ps = x.args.map(node);
    return { gate: { type: 'boolean', op: x.kind, operands: ps.map((p) => ({ ref: p.id })) }, name: booleanGateName(x.kind, ps.map((p) => ({ name: p.name, isNot: isNot(p) }))) };
  };
  const node = (x: BoolExpr): Population => {
    if (x.kind === 'ref') return named(x.name);
    const { gate, name } = gateOf(x);
    const same = pool().find((p) => p.parentId === parentId && p.id !== excludeId && p.gate.type === 'boolean' && sameGate(p.gate, gate));
    if (same) return same;
    const p: Population = { id: newId('pop'), name: uniqueName(name, pool().filter((q) => q.parentId === parentId).map((q) => q.name)), parentId, gate };
    added.push(p);
    return p;
  };
  const top = gateOf(e);
  return { ...top, added };
}
