// Native workspace persistence (.frea.json) and cross-sample operations.
import { fail } from './errors';
import { newId, populationPath, type Population, type SampleState, type Workspace } from './model';

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
    const existing = ws.groups.find((g) => g.criteria?.key === key && g.criteria.value === value);
    const name = `${key} = ${value ?? '(missing)'}`;
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
    if (!g.criteria) continue;
    const { key, value } = g.criteria;
    const ids = ws.samples
      .filter((s) => {
        const v = sampleValue(s, key);
        return value === null ? v === undefined || v === '' : v === value;
      })
      .map((s) => s.id);
    if (ids.join() !== g.sampleIds.join()) {
      g.sampleIds = ids;
      changed = true;
    }
  }
  return changed;
}
