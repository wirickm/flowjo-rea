// Native workspace persistence (.frea.json) and cross-sample operations.
import { fail } from './errors';
import { acceptCriteria, connectorText, functionText } from './groupCriteria';
import { dimLabel, newId, populationPath, uniqueName, type Gate, type Population, type SampleState, type Workspace } from './model';

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
      t.populations.push({ id: idMap.get(p.id)!, name: p.name, parentId: p.id === root.id ? parentId : idMap.get(p.parentId!)!, gate, ...(p.exclude ? { exclude: true } : {}) });
    }
  }
  return warnings;
}

// --- group-owned analysis (FlowJo 10.6.2, specs 7.2) ---------------------------

const pathOf = (s: SampleState, id: string) => populationPath(s.populations, id);
const atPath = (s: SampleState, path: string) => s.populations.find((p) => pathOf(s, p.id) === path);
function markOwned(s: SampleState, rootId: string, groupId: string | undefined): void {
  for (const id of subtreeIds(s.populations, [rootId])) {
    const p = s.populations.find((q) => q.id === id)!;
    if (groupId) p.owningGroup = groupId;
    else delete p.owningGroup;
  }
}

// "Copy analysis to group": the subtree is copied to every member by
// population path and becomes owned by the group, in the source sample too.
export function copyAnalysisToGroup(ws: Workspace, fromSampleId: string, popId: string, groupId: string): string[] {
  const g = ws.groups.find((x) => x.id === groupId);
  if (!g) fail('WORKSPACE_INVALID', 'Group not found');
  const src = ws.samples.find((s) => s.id === fromSampleId)!;
  const path = pathOf(src, popId);
  const warnings = applySubtree(ws, fromSampleId, popId, g.sampleIds);
  for (const s of ws.samples) {
    if (s.id !== fromSampleId && !g.sampleIds.includes(s.id)) continue;
    const root = atPath(s, path);
    if (root) markOwned(s, root.id, groupId);
  }
  return warnings;
}

// The group that owns a population, if any.
export const owningGroupOf = (s: SampleState, popId: string) => s.populations.find((p) => p.id === popId)?.owningGroup;

// An edit to a group-owned gate in a synchronized group moves it in every
// member (FlowJo: "all other samples in the same group have their gates
// moved too"); in other groups only the edited sample changes.
export function propagateOwnedEdits(ws: Workspace, sampleId: string, popIds: string[]): string[] {
  const s = ws.samples.find((x) => x.id === sampleId)!;
  const warnings: string[] = [];
  for (const id of popIds) {
    const gid = owningGroupOf(s, id);
    const g = gid ? ws.groups.find((x) => x.id === gid) : undefined;
    if (!g?.synchronized) continue;
    warnings.push(...copyAnalysisToGroup(ws, sampleId, id, g.id));
  }
  return warnings;
}

// Deleting group-owned analysis (WSGroupMgr.deleteGroupAnalyses with
// GroupDelConfirmationDlog): "allocateToSamples" keeps the populations in
// every member, now owned by each sample; "allocateToFirst" keeps them only
// in the group's first member; "deleteEntirely" removes them from every member.
export type GroupDeleteChoice = 'allocateToSamples' | 'allocateToFirst' | 'deleteEntirely';
export function deleteGroupAnalysis(ws: Workspace, groupId: string, path: string, choice: GroupDeleteChoice): void {
  const g = ws.groups.find((x) => x.id === groupId);
  if (!g) return;
  g.sampleIds.forEach((sid, i) => {
    const s = ws.samples.find((x) => x.id === sid);
    const root = s && atPath(s, path);
    if (!s || !root || root.owningGroup !== groupId) return;
    const keep = choice === 'allocateToSamples' || (choice === 'allocateToFirst' && i === 0);
    if (keep) markOwned(s, root.id, undefined);
    else removePopulation(s, root.id);
  });
}

// Renaming a group-owned population, "for all" (FlowJo asks "The gate is
// group owned. Rename for all?").
export function renameGroupAnalysis(ws: Workspace, groupId: string, path: string, name: string): void {
  const g = ws.groups.find((x) => x.id === groupId);
  for (const sid of g?.sampleIds ?? []) {
    const s = ws.samples.find((x) => x.id === sid);
    const p = s && atPath(s, path);
    if (p && p.owningGroup === groupId) p.name = name;
  }
}

// Members that join a group receive its group-owned analysis (FlowJo
// re-adds group analyses to group members), copied from a member that has it.
function addGroupAnalysisTo(ws: Workspace, g: Workspace['groups'][number], newIds: string[]): void {
  if (!newIds.length) return;
  const template = ws.samples.find((s) => g.sampleIds.includes(s.id) && !newIds.includes(s.id) && s.populations.some((p) => p.owningGroup === g.id));
  if (!template) return;
  const roots = template.populations.filter((p) => p.owningGroup === g.id && !(p.parentId && template.populations.find((q) => q.id === p.parentId)?.owningGroup === g.id));
  for (const r of roots) {
    const path = pathOf(template, r.id);
    applySubtree(ws, template.id, r.id, newIds);
    for (const sid of newIds) {
      const s = ws.samples.find((x) => x.id === sid);
      const root = s && atPath(s, path);
      if (s && root) markOwned(s, root.id, g.id);
    }
  }
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
        if ('rules' in c) return acceptCriteria(ws, s, c);
        const v = sampleValue(s, c.key);
        return c.value === null ? v === undefined || v === '' : v === c.value;
      })
      .map((s) => s.id);
    if (ids.join() !== g.sampleIds.join()) {
      const added = ids.filter((id) => !g.sampleIds.includes(id));
      g.sampleIds = ids;
      addGroupAnalysisTo(ws, g, added);
      changed = true;
    }
  }
  return changed;
}

export function criteriaLabel(c: NonNullable<Workspace['groups'][number]['criteria']>): string {
  if ('rules' in c) {
    const parts = c.rules.map((r, i) => `${i || r.connector !== 'and' ? `${connectorText(r.connector)} ` : ''}${r.keyword} ${functionText(r.op) ?? r.op} "${r.value}"`);
    if (c.stains?.length) parts.push(`stains: ${c.stains.join(' | ')}`);
    if (c.refGroup) parts.push(`${c.refGroup.fn} group "${c.refGroup.name}"`);
    return parts.join(' ');
  }
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
// operands follow the mapping. Equivalence resolves each dimension's
// compensation against the sample's (`sampleComp`), so a drawn gate equals its
// own Gating-ML export.
export interface MergeResult {
  populations: Population[];
  added: string[];
  same: string[];
  conflicts: string[]; // names of populations whose gate differs
}
function canonicalGate(g: Gate, sampleComp: string): string {
  if (g.type === 'boolean') return JSON.stringify({ ...g, operands: g.operands.map((o) => ({ ref: o.ref, complement: !!o.complement })) });
  const comp = (c: string | undefined) => {
    const r = c ?? sampleComp;
    return r === 'none' || r === 'uncompensated' ? 'uncompensated' : r === 'file' || r === 'FCS' ? 'FCS' : r;
  };
  return JSON.stringify({ ...g, dims: g.dims.map((d) => ({ ...d, compensation: comp(d.compensation) })) });
}

export function mergeImported(existing: Population[], imported: Population[], rootParent: string | null, conflicts: 'replace' | 'keep', sampleComp = 'none'): MergeResult {
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
    } else if (canonicalGate(hit.gate, sampleComp) === canonicalGate(gate, sampleComp) && !!hit.exclude === !!p.exclude) {
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

// FlowJo 10's relink test (specs 6.7): does a newly added file belong to a
// workspace sample whose data is missing? `recorded` = the sample's saved
// keywords, `file` = the new file's. $TOT must be recorded and equal. Then
// $DATE, $BTIM and $BEGINDATA in that order: each recorded one must be equal;
// the first one not recorded ends these checks. Last, $FIL: not recorded, or
// equal, matches. (FlowJo also accepts a different $FIL when the sample's file
// exists in the workspace's folder; a browser cannot see folders, so that case
// does not match here.) Values are compared trimmed.
export function relinkMatches(recorded: Record<string, string>, file: Record<string, string>): boolean {
  const rec = (k: string) => (recorded[k] ?? '').trim();
  const fil = (k: string) => (file[k] ?? '').trim();
  if (!rec('$TOT') || rec('$TOT') !== fil('$TOT')) return false;
  for (const k of ['$DATE', '$BTIM', '$BEGINDATA']) {
    if (!rec(k)) break;
    if (rec(k) !== fil(k)) return false;
  }
  return !rec('$FIL') || rec('$FIL') === fil('$FIL');
}

// The first sample without data that a new file relinks to (FlowJo 10 tests
// every such sample in workspace order, whatever its file name), or undefined:
// the file is then added as a new sample.
export function relinkTarget(samples: SampleState[], hasData: (id: string) => boolean, fileKeywords: Record<string, string>): SampleState | undefined {
  return samples.find((s) => !hasData(s.id) && relinkMatches(s.keywordsSnapshot, fileKeywords));
}

// Remove a sample and its group memberships.
export function removeSample(ws: Workspace, sampleId: string): void {
  ws.samples = ws.samples.filter((s) => s.id !== sampleId);
  for (const g of ws.groups) g.sampleIds = g.sampleIds.filter((id) => id !== sampleId);
}


// FlowJo 10's quad test (specs 6.2): a 2-D rectangle with exactly one open
// bound on each axis (RectGate.getQuadID), a 1-D range with an open end
// (RangeGate.isQuad), and a curly quad (always). A quadrant gate here is the
// rectangle (or range) of its interval, open where the interval is an end one.
export function isQuadGate(g: Gate): boolean {
  if (g.type === 'splineQuadrant') return true;
  if (g.type === 'rect') {
    const open = g.min.map((lo, k) => (lo === null) !== (g.max[k] === null));
    if (g.dims.length === 1) return g.min[0] === null || g.max[0] === null;
    return g.dims.length === 2 && open[0] && open[1];
  }
  if (g.type === 'quadrant') {
    if (g.dims.length > 2) return false;
    return g.dividers.every((d, k) => d.length > 0 && (g.side[k] === 0 || g.side[k] === d.length));
  }
  return false;
}

// Populations FlowJo 10 deletes with `id` (STreeMgr.deleteSelection calls
// NodeList.addSiblingQuads): when `id` is a quad, every sibling quad on the
// same x and y parameters, wherever its centre is. Returns `id` first.
export function deletionRoots(pops: Population[], id: string): string[] {
  const p = pops.find((q) => q.id === id);
  if (!p || p.gate.type === 'boolean' || !isQuadGate(p.gate)) return [id];
  const params = (g: Gate) => gateDimNames(g).join('\u0000');
  const key = params(p.gate);
  return [id, ...pops.filter((q) => q.id !== id && q.parentId === p.parentId && q.gate.type !== 'boolean' && isQuadGate(q.gate) && params(q.gate) === key).map((q) => q.id)];
}

function gateDimNames(g: Gate): string[] {
  return g.type === 'boolean' ? [] : g.dims.slice(0, 2).map(dimLabel);
}

// Every population removed with these roots: the roots and their descendants.
export function subtreeIds(pops: Population[], roots: string[]): Set<string> {
  const out = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pops) if (p.parentId && out.has(p.parentId) && !out.has(p.id)) { out.add(p.id); grew = true; }
  }
  return out;
}
