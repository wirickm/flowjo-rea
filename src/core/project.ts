// Native workspace persistence (.frea.json) and cross-sample operations.
import { fail } from './errors';
import { newId, populationPath, uniqueName, type KeywordRule, type Population, type SampleState, type Workspace } from './model';

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify(ws, null, 1);
}

export function deserializeWorkspace(text: string): Workspace {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    fail('WORKSPACE_INVALID', `Workspace file is not valid JSON: ${(e as Error).message}`);
  }
  const ws = raw as Partial<Workspace>;
  if (!ws || ws.format !== 'flowjo-rea-workspace') fail('WORKSPACE_INVALID', 'Not a flowjo-rea workspace file');
  if (ws.version !== 1) fail('WORKSPACE_INVALID', `Unsupported workspace version ${String(ws.version)}`);
  for (const key of ['samples', 'groups', 'matrices', 'statColumns'] as const) {
    if (!Array.isArray(ws[key])) fail('WORKSPACE_INVALID', `Workspace field "${key}" is missing or not a list`);
  }
  const ids = new Set<string>();
  for (const s of ws.samples!) {
    if (typeof s.id !== 'string' || typeof s.fileName !== 'string' || !Array.isArray(s.populations)) {
      fail('WORKSPACE_INVALID', 'Workspace contains a malformed sample entry');
    }
    if (ids.has(s.id)) fail('WORKSPACE_INVALID', `Duplicate sample id ${s.id}`);
    ids.add(s.id);
    const pids = new Set(s.populations.map((p) => p.id));
    for (const p of s.populations) {
      if (p.parentId && !pids.has(p.parentId)) fail('WORKSPACE_INVALID', `Population ${p.name} in ${s.fileName} has a missing parent`);
    }
  }
  for (const g of ws.groups!) {
    const missing = g.sampleIds.filter((id) => !ids.has(id));
    if (missing.length) fail('WORKSPACE_INVALID', `Group ${g.name} references unknown samples`);
  }
  return {
    channelTransforms: {},
    notes: '',
    provenance: { warnings: [] },
    ...ws,
  } as Workspace;
}

export async function fingerprint(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Copy a population subtree (root `popId` and descendants) from one sample to
// others, replacing populations with the same path. Boolean operands are
// remapped. Returns warnings for targets missing a gate channel.
export function applySubtree(ws: Workspace, fromSampleId: string, popId: string, targetIds: string[]): string[] {
  const src = ws.samples.find((s) => s.id === fromSampleId);
  if (!src) fail('WORKSPACE_INVALID', 'Source sample not found');
  const root = src.populations.find((p) => p.id === popId);
  if (!root) fail('WORKSPACE_INVALID', 'Population not found');
  const subtree: Population[] = [];
  const collect = (id: string) => {
    for (const p of src.populations) if (p.parentId === id) { subtree.push(p); collect(p.id); }
  };
  subtree.push(root);
  collect(root.id);
  const parentPath = root.parentId ? populationPath(src.populations, root.parentId) : '';
  const warnings: string[] = [];
  for (const tid of targetIds) {
    if (tid === fromSampleId) continue;
    const t = ws.samples.find((s) => s.id === tid);
    if (!t) continue;
    let parentId: string | null = null;
    if (parentPath) {
      const parent = t.populations.find((p) => populationPath(t.populations, p.id) === parentPath);
      if (!parent) {
        warnings.push(`${t.fileName}: parent population "${parentPath}" missing; skipped`);
        continue;
      }
      parentId = parent.id;
    }
    // Remove existing populations at the same path (and their descendants).
    const rootPath = populationPath(src.populations, root.id);
    const existing = t.populations.find((p) => populationPath(t.populations, p.id) === rootPath);
    if (existing) removePopulation(t, existing.id);
    const idMap = new Map<string, string>();
    for (const p of subtree) idMap.set(p.id, newId('pop'));
    for (const p of subtree) {
      const gate = structuredClone(p.gate);
      if (gate.type === 'boolean') {
        gate.operands = gate.operands.map((o) => {
          if (idMap.has(o.ref)) return { ...o, ref: idMap.get(o.ref)! };
          const path = populationPath(src.populations, o.ref);
          const match = t.populations.find((x) => populationPath(t.populations, x.id) === path);
          if (!match) warnings.push(`${t.fileName}: boolean operand "${path}" missing`);
          return { ...o, ref: match?.id ?? o.ref };
        });
      } else {
        const missing = gate.dims.flatMap((d) => (d.kind === 'channel' ? [d.channel] : [d.num, d.den])).filter((c) => t.channelNames.length && !t.channelNames.includes(c));
        if (missing.length) warnings.push(`${t.fileName}: "${p.name}" uses channels not in this sample: ${missing.join(', ')}`);
      }
      t.populations.push({ id: idMap.get(p.id)!, name: p.name, parentId: p.id === root.id ? parentId : idMap.get(p.parentId!)!, gate });
    }
  }
  return warnings;
}

export function removePopulation(s: SampleState, id: string): void {
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of s.populations) {
      if (p.parentId && doomed.has(p.parentId) && !doomed.has(p.id)) { doomed.add(p.id); grew = true; }
    }
  }
  s.populations = s.populations.filter((p) => !doomed.has(p.id));
}

// Value of a sample attribute for grouping: annotation first, then keyword.
export function sampleValue(s: SampleState, key: string): string | undefined {
  return s.annotations?.[key] ?? s.keywordsSnapshot[key] ?? s.keywordsSnapshot[key.toUpperCase()];
}

// One live group per distinct value of `key` over all samples, named
// "key = value"; samples without the key go to "key = (missing)". Existing
// groups with the same rule are updated rather than duplicated (renaming a
// live group keeps its rule).
export function groupByKey(ws: Workspace, key: string): string[] {
  const values = new Set<string | null>();
  for (const s of ws.samples) {
    const v = sampleValue(s, key);
    values.add(v === undefined || v === '' ? null : v);
  }
  const names: string[] = [];
  for (const value of [...values].sort((a, b) => (a ?? '').localeCompare(b ?? ''))) {
    const existing = ws.groups.find((g) => g.criteria && 'key' in g.criteria && g.criteria.key === key && g.criteria.value === value);
    const name = uniqueName(`${key} = ${value ?? '(missing)'}`, ws.groups.map((g) => g.name));
    if (!existing) ws.groups.push({ id: newId('grp'), name, sampleIds: [], criteria: { key, value } });
    names.push(existing?.name ?? name);
  }
  syncLiveGroups(ws);
  return names;
}

// Recompute live-group membership in place; returns true if anything changed.
export function syncLiveGroups(ws: Workspace): boolean {
  let changed = false;
  for (const g of ws.groups) {
    const c = g.criteria;
    if (!c) continue;
    const ids = ws.samples
      .filter((s) => {
        if ('rules' in c) return matchRules(s, c.rules);
        const v = sampleValue(s, c.key);
        return c.value === null ? v === undefined || v === '' : v === c.value;
      })
      .map((s) => s.id);
    if (ids.join() !== g.sampleIds.join()) {
      g.sampleIds = ids;
      changed = true;
    }
  }
  return changed;
}

// FlowJo keyword criteria, combined strictly left to right (no precedence).
// Matching is case-insensitive; FlowJo's case handling is unverified.
export function matchRules(s: SampleState, rules: KeywordRule[]): boolean {
  let acc = false;
  rules.forEach((r, i) => {
    const v = (sampleValue(s, r.keyword) ?? '').toLowerCase();
    const q = r.value.toLowerCase();
    const hit =
      r.op === 'contains' ? v.includes(q)
      : r.op === 'notContains' ? !v.includes(q)
      : r.op === 'equals' ? v === q
      : r.op === 'notEquals' ? v !== q
      : r.op === 'startsWith' ? v.startsWith(q)
      : v.endsWith(q);
    acc = i === 0 ? hit : r.connector === 'and' ? acc && hit : acc || hit;
  });
  return acc;
}

export function criteriaLabel(c: NonNullable<Workspace['groups'][number]['criteria']>): string {
  if ('rules' in c) return c.rules.map((r, i) => `${i ? `${r.connector} ` : ''}${r.keyword} ${r.op} "${r.value}"`).join(' ');
  return `${c.key} = ${c.value ?? '(missing)'}`;
}

// What uses a derived parameter: gates (by population path), statistic
// columns and other derived parameters. Shown before deleting it (UAT a3-03).
// FlowJo 10 only asks a generic "are you sure"; listing users is our own
// improvement (specs section 6.6). Nothing is deleted in cascade.
export function derivedParameterUsers(ws: Workspace, name: string): string[] {
  const gates = new Set<string>();
  for (const s of ws.samples) {
    for (const p of s.populations) {
      if (p.gate.type !== 'boolean' && p.gate.dims.some((d) => d.kind === 'channel' && d.channel === name)) gates.add(populationPath(s.populations, p.id));
    }
  }
  const out = [...gates].map((g) => `gate "${g}"`);
  for (const c of ws.statColumns) if (c.channel === name) out.push(`statistic "${c.stat} (${name})" on "${c.populationPath || 'All events'}"`);
  for (const d of ws.derivedParameters ?? []) if (d.name !== name && (d.num === name || d.den === name)) out.push(`derived parameter "${d.name}"`);
  return out;
}

// Merge imported populations (e.g. Gating-ML) into a sample's tree, as FlowJo
// 10 imports gates (specs 6.7): an imported population whose name a sibling
// already has is never added again. An equivalent gate is kept as is; a
// different gate is a conflict, replaced or kept as `conflicts` says. Roots of
// the import attach under `rootParent`. Imported ids are remapped; boolean
// operands follow the mapping.
export interface MergeResult {
  populations: Population[];
  added: string[];
  same: string[];
  conflicts: string[]; // names of populations whose gate differs
}
export function mergeImported(existing: Population[], imported: Population[], rootParent: string | null, conflicts: 'replace' | 'keep'): MergeResult {
  const pops = structuredClone(existing);
  const byId = new Map(imported.map((p) => [p.id, p]));
  // Parents first.
  const order: Population[] = [];
  const seen = new Set<string>();
  const visit = (p: Population) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    const parent = p.parentId ? byId.get(p.parentId) : undefined;
    if (parent) visit(parent);
    order.push(p);
  };
  imported.forEach(visit);
  // Pass 1: final id of every imported population (existing sibling by name, or new).
  const idMap = new Map<string, string>();
  const match = new Map<string, Population>();
  const parentOf = new Map<string, string | null>(); // imported id -> final parent id
  const fresh = new Map<string, string>(); // imported id -> name of a new population
  const newNames = new Map<string | null, string[]>(); // final parent id -> names added here
  for (const p of order) {
    const parentId = p.parentId && byId.has(p.parentId) ? idMap.get(p.parentId)! : rootParent;
    parentOf.set(p.id, parentId);
    const used = new Set(match.values());
    const hit = pops.find((q) => q.parentId === parentId && q.name === p.name && !used.has(q));
    if (hit) {
      idMap.set(p.id, hit.id);
      match.set(p.id, hit);
    } else {
      const added = newNames.get(parentId) ?? [];
      const name = uniqueName(p.name, [...pops.filter((q) => q.parentId === parentId).map((q) => q.name), ...added]);
      newNames.set(parentId, [...added, name]);
      fresh.set(p.id, name);
      idMap.set(p.id, newId('pop'));
    }
  }
  // Pass 2: gates with remapped operands; add, keep or replace.
  const out: MergeResult = { populations: pops, added: [], same: [], conflicts: [] };
  for (const p of order) {
    const gate = structuredClone(p.gate);
    if (gate.type === 'boolean') gate.operands = gate.operands.map((o) => ({ ...o, ref: idMap.get(o.ref) ?? o.ref }));
    const hit = match.get(p.id);
    if (!hit) {
      pops.push({ id: idMap.get(p.id)!, name: fresh.get(p.id)!, parentId: parentOf.get(p.id)!, gate, ...(p.exclude ? { exclude: true } : {}) });
      out.added.push(p.name);
    } else if (JSON.stringify(hit.gate) === JSON.stringify(gate) && !!hit.exclude === !!p.exclude) {
      out.same.push(p.name);
    } else {
      out.conflicts.push(p.name);
      if (conflicts === 'replace') {
        hit.gate = gate;
        if (p.exclude) hit.exclude = true;
        else delete hit.exclude;
      }
    }
  }
  return out;
}

// FlowJo 10 relinks a data file to a sample only when identifying keywords
// match (specs 6.7). Returns the keywords that differ; keys missing on either
// side are not compared.
export const RELINK_KEYWORDS = ['$TOT', '$PAR', '$BTIM', '$ETIM', '$DATE'];
export function relinkMismatch(recorded: Record<string, string>, file: Record<string, string>): string[] {
  return RELINK_KEYWORDS.filter((k) => recorded[k] !== undefined && file[k] !== undefined && recorded[k].trim() !== file[k].trim());
}

// Remove a sample and its group memberships.
export function removeSample(ws: Workspace, sampleId: string): void {
  ws.samples = ws.samples.filter((s) => s.id !== sampleId);
  for (const g of ws.groups) g.sampleIds = g.sampleIds.filter((id) => id !== sampleId);
}
