// Create / Modify Group, as in FlowJo 10's group dialog (GroupDlog): name,
// role, up to 4 keyword criteria with connectors, stain sets and a
// reference group. Rules: src/core/groupCriteria.ts (specs 7.1).
import { useState } from 'react';
import { FLOWJO_CONNECTORS, FLOWJO_FUNCTIONS, GROUP_ROLES, MAX_KEYWORD_CRITERIA } from '../core/groupCriteria';
import type { GroupCriteria, GroupRole, KeywordRule } from '../core/model';
import { Modal } from './Dialogs';

export interface GroupDraft {
  name: string;
  role: GroupRole;
  live: boolean;
  synchronized: boolean;
  color?: string;
  fontStyle?: 'plain' | 'bold' | 'italic';
  criteria: GroupCriteria;
}

const OWN_OPS: { op: KeywordRule['op']; text: string }[] = [
  { op: 'startsWith', text: 'starts with (not in FlowJo)' },
  { op: 'endsWith', text: 'ends with (not in FlowJo)' },
];
const blank = (): KeywordRule => ({ connector: 'and', keyword: '', op: 'contains', value: '' });

export function GroupDialog(p: {
  initial: GroupDraft | null;
  keywords: string[];
  stainSets: string[];
  groupNames: string[];
  takenNames: string[];
  onSave: (d: GroupDraft) => void;
  // Multiple (GroupDlog.createMultipleGroups): one group per selected stain set.
  onMultiple?: (d: GroupDraft) => void;
  onClose: () => void;
}) {
  const init = p.initial;
  const [name, setName] = useState(init?.name ?? '');
  const [role, setRole] = useState<GroupRole>(init?.role ?? 'undefined');
  const [live, setLive] = useState(init?.live ?? true);
  const [sync, setSync] = useState(init?.synchronized ?? false);
  const [color, setColor] = useState(init?.color ?? '#000000');
  const [fontStyle, setFontStyle] = useState<'plain' | 'bold' | 'italic'>(init?.fontStyle ?? 'plain');
  const [rules, setRules] = useState<KeywordRule[]>(() => {
    const r = [...(init?.criteria.rules ?? [])];
    while (r.length < MAX_KEYWORD_CRITERIA) r.push(blank());
    return r.slice(0, MAX_KEYWORD_CRITERIA);
  });
  const [stains, setStains] = useState<string[]>(init?.criteria.stains ?? []);
  const [refName, setRefName] = useState(init?.criteria.refGroup?.name ?? '');
  const [refFn, setRefFn] = useState(init?.criteria.refGroup?.fn ?? 'also');
  const setRule = (i: number, patch: Partial<KeywordRule>) => setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const trimmed = name.trim();
  const saveError = !trimmed ? 'Enter a name' : p.takenNames.includes(trimmed) ? 'Name must be unique.' : '';
  return (
    <Modal title={init ? 'Modify Group' : 'Create Group'} onClose={p.onClose} wide>
      <div className="row">
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} data-testid="gd-name" /></label>
        <label>Role <select value={role} onChange={(e) => setRole(e.target.value as GroupRole)} data-testid="gd-role">
          {GROUP_ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
        </select></label>
        <label title="Membership is recomputed from the criteria"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} data-testid="gd-live" /> Live</label>
        <label>Colour <input type="color" value={color} onChange={(e) => setColor(e.target.value)} data-testid="gd-color" /></label>
        <label>Style <select value={fontStyle} onChange={(e) => setFontStyle(e.target.value as 'plain' | 'bold' | 'italic')} data-testid="gd-font">
          <option value="plain">plain</option><option value="bold">bold</option><option value="italic">italic</option>
        </select></label>
        <label title="Moving a group-owned gate moves it in every sample of the group"><input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} data-testid="gd-sync" /> Synchronized</label>
      </div>
      <h4>Keyword criteria (up to {MAX_KEYWORD_CRITERIA})</h4>
      <p className="muted">As in FlowJo, the result starts true and each criterion with a value applies its connector, the first included; the six comparisons are numeric when the sample's value is a number.</p>
      {rules.map((r, i) => (
        <div className="row" key={i}>
          <select value={r.connector} onChange={(e) => setRule(i, { connector: e.target.value as KeywordRule['connector'] })} data-testid={`gd-conn-${i}`}>
            {FLOWJO_CONNECTORS.map((c) => <option key={c.connector} value={c.connector}>{c.text}</option>)}
          </select>
          <input list="gd-keywords" placeholder="keyword" value={r.keyword} onChange={(e) => setRule(i, { keyword: e.target.value })} data-testid={`gd-key-${i}`} style={{ width: 110 }} />
          <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value as KeywordRule['op'] })} data-testid={`gd-op-${i}`}>
            {[...FLOWJO_FUNCTIONS, ...OWN_OPS].map((f) => <option key={f.op} value={f.op}>{f.text}</option>)}
          </select>
          <input placeholder={r.op === 'exists' ? 'any text (FlowJo needs a value)' : 'value'} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} data-testid={`gd-val-${i}`} style={{ width: 110 }} />
        </div>
      ))}
      <datalist id="gd-keywords">{p.keywords.map((k) => <option key={k} value={k} />)}</datalist>
      <h4>Stain sets</h4>
      {p.stainSets.length === 0 && <p className="muted">No sample has stains ($PnS) outside scatter and time.</p>}
      {p.stainSets.map((st) => (
        <label key={st} className="row"><input type="checkbox" checked={stains.includes(st)} onChange={() => setStains((s) => (s.includes(st) ? s.filter((x) => x !== st) : [...s, st]))} /> {st}</label>
      ))}
      <h4>Reference group</h4>
      <div className="row">
        <select value={refName} onChange={(e) => setRefName(e.target.value)} data-testid="gd-ref">
          <option value="">none</option>
          {p.groupNames.filter((g) => g !== trimmed).map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={refFn} onChange={(e) => setRefFn(e.target.value)} disabled={!refName}>
          <option value="also">also (either)</option>
          <option value="only">only (both)</option>
        </select>
      </div>
      {saveError && !(!trimmed && stains.length >= 2 && p.onMultiple) && <p className="error">{saveError}</p>}
      <div className="row">
        <button disabled={!!saveError} data-testid="gd-save" onClick={() => {
          const criteria: GroupCriteria = { rules: rules.filter((r) => r.keyword || r.value) };
          if (stains.length) criteria.stains = stains;
          if (refName) criteria.refGroup = { name: refName, fn: refFn };
          p.onSave({ name: trimmed, role, live, synchronized: sync, color, fontStyle, criteria });
        }}>Save</button>
        {p.onMultiple && !init && <button disabled={stains.length < 2} data-testid="gd-multiple" title="Make a new group for each of the selected stain combinations." onClick={() => {
          const criteria: GroupCriteria = { rules: rules.filter((r) => r.keyword || r.value), stains };
          p.onMultiple!({ name: trimmed, role, live, synchronized: sync, color, fontStyle, criteria });
        }}>Multiple</button>}
        <button onClick={p.onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
