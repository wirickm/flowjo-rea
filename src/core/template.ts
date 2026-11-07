// Export as Template (.wspt) and Save as Archive (docs/validation/ui-gaps/
// workspace.md, section E). A FlowJo template is the workspace saved without
// its sample list (Workspace.getElement(true) skips WSSampleMgr): groups,
// their analyses, matrices, columns, layouts and tables stay; samples added
// later join the groups and receive the group analysis.
import { newId, populationPath, type Population, type Workspace } from './model';
import { subtreeIds } from './project';
import { readZip, writeZip } from './zip';

// The workspace as a template: no samples; each group keeps its group-owned
// analysis (with the ancestor populations it hangs from) in group.analysis.
export function makeTemplate(ws: Workspace): Workspace {
  const t = structuredClone(ws);
  for (const g of t.groups) {
    const src = t.samples.find((s) => g.sampleIds.includes(s.id) && s.populations.some((p) => p.owningGroup === g.id));
    if (src) {
      const owned = subtreeIds(src.populations, src.populations.filter((p) => p.owningGroup === g.id).map((p) => p.id));
      const keep = new Set(owned);
      for (const id of owned) {
        let p = src.populations.find((q) => q.id === id);
        while (p?.parentId) { keep.add(p.parentId); p = src.populations.find((q) => q.id === p!.parentId); }
      }
      g.analysis = src.populations.filter((p) => keep.has(p.id)).map((p) => {
        const c = structuredClone(p);
        delete c.collapsed;
        return c;
      });
    }
    g.sampleIds = [];
  }
  t.samples = [];
  t.provenance = { ...t.provenance, warnings: [] };
  return t;
}

// Gives each member of a group with a template analysis the populations it
// does not have yet (matched by path); the group's populations become owned by
// the group. The template analysis is dropped once a member has it (later
// members receive it from that member, as for any group-owned analysis).
// Returns true when something changed.
export function applyGroupTemplates(ws: Workspace): boolean {
  let changed = false;
  for (const g of ws.groups) {
    if (!g.analysis?.length) continue;
    const members = ws.samples.filter((s) => g.sampleIds.includes(s.id));
    if (!members.length) continue;
    const order = [...g.analysis].sort((a, b) => populationPath(g.analysis!, a.id).split('/').length - populationPath(g.analysis!, b.id).split('/').length);
    for (const s of members) {
      const idMap = new Map<string, string>();
      for (const p of order) {
        const path = populationPath(g.analysis, p.id);
        const have = s.populations.find((q) => populationPath(s.populations, q.id) === path);
        if (have) { idMap.set(p.id, have.id); continue; }
        const parentId = p.parentId ? idMap.get(p.parentId) ?? null : null;
        if (p.parentId && !parentId) continue;
        const id = newId('pop');
        idMap.set(p.id, id);
        const gate = structuredClone(p.gate);
        const pop: Population = { ...structuredClone(p), id, parentId, gate };
        if (p.owningGroup) pop.owningGroup = g.id;
        s.populations.push(pop);
        changed = true;
      }
      for (const p of s.populations) if (p.gate.type === 'boolean') p.gate.operands = p.gate.operands.map((o) => ({ ...o, ref: idMap.get(o.ref) ?? o.ref }));
    }
    delete g.analysis;
    changed = true;
  }
  return changed;
}

// Save as Archive (own rule): FlowJo's ACS is the ISAC Archival Cytometry
// Standard container; this app writes a ZIP holding the workspace file and
// the FCS files (FCS/<name>), which it opens again in one step.
export const ARCHIVE_WORKSPACE = 'workspace.frea.json';
export function buildArchive(workspaceJson: string, files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const used = new Set<string>();
  return writeZip([{ name: ARCHIVE_WORKSPACE, data: workspaceJson }, ...files.map((f) => {
    let n = f.name, k = 1;
    while (used.has(n)) n = `${k++}_${f.name}`;
    used.add(n);
    return { name: `FCS/${n}`, data: f.bytes };
  })]);
}
export function readArchive(bytes: Uint8Array): { workspace: string; files: { name: string; bytes: Uint8Array }[] } {
  const entries = readZip(bytes);
  const wsEntry = entries.find((e) => e.name === ARCHIVE_WORKSPACE);
  if (!wsEntry) throw new Error(`Not a flowjo-rea archive: ${ARCHIVE_WORKSPACE} is missing`);
  return { workspace: new TextDecoder().decode(wsEntry.data), files: entries.filter((e) => e.name.startsWith('FCS/') && e.data.length).map((e) => ({ name: e.name.slice(4), bytes: e.data })) };
}
