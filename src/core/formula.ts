// FlowJo 10.6.2 derived-parameter formulas (specs section 12), as the native
// engine evaluates them: Sample::ComputeAlgebraic upper-cases the formula and
// DP_ReplaceParameterNames swaps parameter names for variables (longest name
// first, every occurrence); Parser splits at the rightmost lowest-priority
// operator (so every operator, ^ included, is left-associative) and builds
// functions from a fixed table. Read with REA's Ghidra provider; implemented
// independently. This module is the one owner of these rules.

export class FormulaError extends Error {}
const ERR = {
  math: 'Illegal math parameter.',
  numeric: 'Numeric value required for function.',
  args: 'Wrong number of arguments for function.',
  empty: 'Empty expression.',
  missingOp: 'Missing operator in expression.',
  syntax: 'Bad syntax in expression.',
  parens: 'Unbalanced open and close parentheses.',
  fn: 'Unknown function.',
  quotes: 'Unbalanced quotes for string value.',
  extra: 'Extra characters following string value.',
};
const fail = (m: string): never => { throw new FormulaError(m); };

type Node = (vars: Float64Array) => number;
export const MAX_FORMULA_VARIABLES = 8;
export const EVENT_NUMBER = 'Event #';

// Operator priorities (lower binds looser); '!' and unary signs are prefix.
const PRIO: Record<string, number> = { '&': 1, '|': 1, '=': 2, '<>': 2, '<': 3, '>': 3, '<=': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '%': 5, '^': 6, '!': 8 };
const UNARY = 9;

interface Ctx { vars: Map<string, number> }

// Tokens at depth 0 outside quotes: operators with their position.
function operators(s: string): { op: string; at: number; prio: number }[] {
  const out: { op: string; at: number; prio: number }[] = [];
  let depth = 0, inStr = false;
  const prevSignificant = (i: number) => { let j = i - 1; while (j >= 0 && /\s/.test(s[j])) j--; return j; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; if (depth < 0) fail(ERR.parens); continue; }
    if (depth) continue;
    const two = s.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ op: two, at: i, prio: PRIO[two] }); i++; continue; }
    if (!(c in PRIO)) continue;
    if (c === '+' || c === '-') {
      // A sign right after a mantissa's e / E is part of the number.
      if ((s[i - 1] === 'E' || s[i - 1] === 'e') && /[0-9.]/.test(s[i - 2] ?? '') && /[0-9]/.test(s[i + 1] ?? '')) continue;
      const j = prevSignificant(i);
      const unary = j < 0 || s[j] === '(' || s[j] === ',' || s[j] in PRIO || s[j] === '>' || s[j] === '<';
      out.push({ op: c, at: i, prio: unary ? UNARY : PRIO[c] });
      continue;
    }
    out.push({ op: c, at: i, prio: PRIO[c] });
  }
  if (depth !== 0) fail(ERR.parens);
  if (inStr) fail(ERR.quotes);
  return out;
}

function stripParens(s: string): string {
  for (;;) {
    s = s.trim();
    if (!(s.startsWith('(') && s.endsWith(')'))) return s;
    let depth = 0, enclosing = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') { depth--; if (depth === 0 && i < s.length - 1) { enclosing = false; break; } }
    }
    if (!enclosing) return s;
    s = s.slice(1, -1);
  }
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, inStr = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim());
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const ssd = (a: number[]) => { const m = mean(a); return a.reduce((x, y) => x + (y - m) * (y - m), 0); };
const FUNCS: Record<string, { n?: number; min?: number; f: (a: number[]) => number }> = {
  SIN: { n: 1, f: ([x]) => Math.sin(x) }, COS: { n: 1, f: ([x]) => Math.cos(x) }, TAN: { n: 1, f: ([x]) => Math.tan(x) },
  SINH: { n: 1, f: ([x]) => Math.sinh(x) }, COSH: { n: 1, f: ([x]) => Math.cosh(x) }, TANH: { n: 1, f: ([x]) => Math.tanh(x) },
  EXP: { n: 1, f: ([x]) => Math.exp(x) }, ATAN: { n: 1, f: ([x]) => Math.atan(x) },
  ASIN: { n: 1, f: ([x]) => (x < -1 || x > 1 ? fail(ERR.math) : Math.asin(x)) },
  ACOS: { n: 1, f: ([x]) => (x < -1 || x > 1 ? fail(ERR.math) : Math.acos(x)) },
  LN: { n: 1, f: ([x]) => (x <= 0 ? fail(ERR.math) : Math.log(x)) },
  LOG: { n: 1, f: ([x]) => (x <= 0 ? fail(ERR.math) : Math.log10(x)) },
  ABS: { n: 1, f: ([x]) => Math.abs(x) },
  SQRT: { n: 1, f: ([x]) => (x < 0 ? fail(ERR.math) : Math.sqrt(x)) },
  NEG: { n: 1, f: ([x]) => -x },
  RAND: { n: 1, f: ([x]) => x * Math.random() },
  IF: { n: 3, f: ([c, a, b]) => (c !== 0 ? a : b) },
  MAX: { min: 1, f: (a) => a.reduce((m, v) => (v > m ? v : m)) },
  MIN: { min: 1, f: (a) => a.reduce((m, v) => (v < m ? v : m)) },
  AVG: { min: 1, f: mean },
  // FlowJo's SD and CV divide the root of the squared deviations by n - 1.
  SD: { min: 2, f: (a) => Math.sqrt(ssd(a)) / (a.length - 1) },
  CV: { min: 2, f: (a) => Math.sqrt(ssd(a)) / ((a.length - 1) * mean(a)) },
  NORM: { n: 2, f: ([m, sd]) => { let u = 0, v = 0, r = 0; do { u = 2 * Math.random() - 1; v = 2 * Math.random() - 1; r = u * u + v * v; } while (r >= 1 || r === 0); return m + sd * u * Math.sqrt((-2 * Math.log(r)) / r); } },
};
// String functions exist in FlowJo's table but return strings; a derived
// parameter needs numbers, so they are refused here (own rule).
const STRING_FUNCS = new Set(['SUB', 'FIND', 'CHAR', 'NUM', 'WORD', 'REPL', 'REP1', 'LEN', 'DEL', 'INS', 'FOR', 'VAR', 'STRT', 'END', 'CONT', 'UPPR', 'LOWR', 'TRUN']);

const trunc = Math.trunc;
function binary(op: string, a: number, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? fail(ERR.math) : a / b;
    case '%': { const d = trunc(b); return d === 0 ? 0 : trunc(a) % d; }
    case '^': return a > 0 ? Math.pow(a, b) : a === 0 ? 0 : Math.pow(a, trunc(b));
    case '=': return a === b ? 1 : 0;
    case '<>': return a !== b && !Number.isNaN(a) && !Number.isNaN(b) ? 1 : 0;
    case '<': return a < b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '&': return a !== 0 && b !== 0 ? 1 : 0;
    case '|': return a === 0 && b === 0 ? 0 : 1;
  }
  return fail('Unknown operator.');
}

function parse(src: string, ctx: Ctx): Node {
  const s = stripParens(src);
  if (!s) fail(ERR.empty);
  const ops = operators(s);
  if (ops.length) {
    // The rightmost operator with the lowest priority splits the expression.
    let k = 0;
    for (let i = 0; i < ops.length; i++) if (ops[i].prio <= ops[k].prio) k = i;
    const { op, at, prio } = ops[k];
    const right = s.slice(at + op.length);
    if (prio === UNARY || op === '!') {
      const r = parse(right, ctx);
      // '!' uses its right side only; anything to its left is ignored.
      if (op === '!') return (v) => (r(v) === 0 ? 1 : 0);
      if (s.slice(0, at).trim()) fail(ERR.syntax);
      return op === '-' ? (v) => -r(v) : r;
    }
    const l = parse(s.slice(0, at), ctx), r = parse(right, ctx);
    return (v) => binary(op, l(v), r(v));
  }
  const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/.exec(s);
  if (call) {
    const name = call[1].toUpperCase();
    if (STRING_FUNCS.has(name)) fail(ERR.numeric);
    const fn = FUNCS[name];
    if (!fn) fail(ERR.fn);
    const args = splitArgs(call[2]).map((a) => parse(a, ctx));
    if ((fn.n !== undefined && args.length !== fn.n) || (fn.min !== undefined && args.length < fn.min)) fail(ERR.args);
    return (v) => fn.f(args.map((a) => a(v)));
  }
  if (s.startsWith('"')) fail(s.endsWith('"') && s.length > 1 ? ERR.numeric : ERR.quotes);
  if (/\s/.test(s)) fail(ERR.missingOp);
  // C strtod over the whole token (hex and INF / NAN included).
  const num = /^0X[0-9A-F]+$/i.test(s) ? parseInt(s, 16) : /^[+-]?(INF(INITY)?)$/i.test(s) ? (s.startsWith('-') ? -Infinity : Infinity) : /^NAN$/i.test(s) ? NaN : Number(s);
  if (!Number.isNaN(num) || /^NAN$/i.test(s)) return () => num;
  if (/[()]/.test(s)) fail(ERR.syntax);
  // Anything else is a variable. FlowJo keeps at most 8; a 9th overwrites
  // slot 0.
  const key = s.toUpperCase();
  if (!ctx.vars.has(key)) ctx.vars.set(key, ctx.vars.size < MAX_FORMULA_VARIABLES ? ctx.vars.size : 0);
  const slot = ctx.vars.get(key)!;
  return (v) => v[slot];
}

export interface CompiledFormula {
  // Variable placeholder -> parameter name (or EVENT_NUMBER); unknown names
  // map to null.
  variables: (string | null)[];
  evaluate: (vars: Float64Array) => number;
}
// Compile a formula against the sample's parameter names: upper-case it,
// replace "EVENT #" and every parameter name (longest first, every
// occurrence) with placeholders, then parse.
export function compileFormula(formula: string, parameters: string[]): CompiledFormula {
  let text = formula.toUpperCase().split(EVENT_NUMBER.toUpperCase()).join('FJ_P_E');
  const order = parameters.map((p, i) => ({ p, i })).sort((a, b) => b.p.length - a.p.length || a.i - b.i);
  for (const { p, i } of order) if (p) text = text.split(p.toUpperCase()).join(`FJ_P_${i}`);
  const ctx: Ctx = { vars: new Map() };
  const evaluate = parse(text, ctx);
  const variables: (string | null)[] = [];
  for (const [k, slot] of ctx.vars) {
    const m = /^FJ_P_(\d+|E)$/.exec(k);
    variables[slot] = m ? (m[1] === 'E' ? EVENT_NUMBER : parameters[Number(m[1])]) : null;
  }
  return { variables, evaluate };
}

// FlowJo's name rule for a derived parameter (DerivedParameter.isNameOK):
// letters, digits and underscore, not empty, and not a number.
export function derivedNameError(name: string, taken: string[]): string | null {
  if (!name || !/^[A-Za-z0-9_]+$/.test(name) || !Number.isNaN(Number(name))) return 'Name must use letters, digits and underscore only, and not be a number';
  if (taken.includes(name)) return 'Paramter with this name already exists';
  return null;
}
// Default name of a new derived parameter (uniqueChildName("Derived")).
export function defaultDerivedName(taken: string[]): string {
  if (!taken.includes('Derived')) return 'Derived';
  for (let k = 1; ; k++) if (!taken.includes(`Derived-${k}`)) return `Derived-${k}`;
}

// The numeric function list as FlowJo's Insert Function menu shows it.
export const FORMULA_FUNCTIONS = ['abs(x)', 'acos(x)', 'asin(x)', 'atan(x)', 'avg(x0, ..., xn)', 'cos(x)', 'cosh(x)', 'cv(x0, ..., xn)', 'exp(x)', 'if(c, a, b)', 'ln(x)', 'log(x)', 'max(x0, ..., xn)', 'min(x0, ..., xn)', 'neg(x)', 'norm(mean, sd)', 'rand(x)', 'sd(x0, ..., xn)', 'sin(x)', 'sinh(x)', 'sqrt(x)', 'tan(x)', 'tanh(x)'];
