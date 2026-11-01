// FlowJo workspace interoperability: counts computed by this app vs the
// population counts FlowJo itself recorded in FlowJo-saved .wsp files.
// Report: WRITE_REPORT=1 npx vitest run tests/wsp-report.test.ts
import { describe, expect, it } from 'vitest';
import { haveFixtures } from './fixtures';
import { compareWsp, WSP_CASES } from './wspCompare';

// Every FlowJo-recorded count is reproduced exactly, except these, where a
// save by another FlowJo version of the same gate records this app's count
// (docs/compatibility-matrix.md, "FlowJo reference counts are not stable").
// Value = ours - FlowJo, pinned exactly.
const VERSION_DIFFERENCES: Record<string, number> = {
  // FlowJo 10.6.2 save; the 10.8.1 and 10.10.0 saves record 81,992.
  '8_color_data_set/8_color_ICS.wsp|E03_009|Time/Singlets/aAmine-/CD3+/CD4+': 2,
  // FlowJo 10.10.0 save; the 10.6.2 and 10.8.1 saves record Time = 284,933.
  '8_color_data_set/8_color_ICS_dot_gate_name.wsp|E05_010|Time': 88,
  '8_color_data_set/8_color_ICS_dot_gate_name.wsp|E05_010|Time/Singlets': 75,
  '8_color_data_set/8_color_ICS_dot_gate_name.wsp|E05_010|Time/Singlets/aAmine-': 51,
  '8_color_data_set/8_color_ICS_dot_gate_name.wsp|E05_010|Time/Singlets/aAmine-/CD3+': 44,
  '8_color_data_set/8_color_ICS_dot_gate_name.wsp|E05_010|Time/Singlets/aAmine-/CD3+/CD4+': 23,
  '8_color_data_set/8_color_ICS_dot_gate_name.wsp|E05_010|Time/Singlets/aAmine-/CD3+/CD8+': 17,
};

describe.skipIf(!haveFixtures)('FlowJo .wsp import reproduces FlowJo-recorded counts', () => {
  for (const c of WSP_CASES) {
    it(c, () => {
      const { rows } = compareWsp(c);
      for (const r of rows) {
        const key = `${c}|${r.sample.slice(16, 23)}|${r.path}`;
        expect(r.ours - r.flowjo, key).toBe(VERSION_DIFFERENCES[key] ?? 0);
      }
    });
  }
  it('lists only version differences that still occur', () => {
    const seen = new Set<string>();
    for (const c of WSP_CASES) for (const r of compareWsp(c).rows) seen.add(`${c}|${r.sample.slice(16, 23)}|${r.path}`);
    for (const k of Object.keys(VERSION_DIFFERENCES)) expect(seen.has(k), k).toBe(true);
  });
});
