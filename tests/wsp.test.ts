// FlowJo workspace interoperability: counts computed by this app vs the
// population counts FlowJo itself recorded in FlowJo-saved .wsp files.
// Report: WRITE_REPORT=1 npx vitest run tests/wsp-report.test.ts
import { describe, expect, it } from 'vitest';
import { haveFixtures } from './fixtures';
import { compareWsp, WSP_CASES } from './wspCompare';

// Workspaces where every FlowJo-computed count is reproduced exactly.
const EXACT = new Set([
  'simple_diamond_example/simple_diamond_example_quad_gate.wsp',
  'simple_diamond_example/test_data_diamond_asinh_rect.wsp',
  'simple_diamond_example/test_data_diamond_asinh_rect2.wsp',
  'simple_diamond_example/test_data_diamond_biex_rect.wsp',
  'simple_line_example/single_ellipse_51_events.wsp',
  '8_color_data_set/reused_quad_gate_with_child.wsp',
]);

describe.skipIf(!haveFixtures)('FlowJo .wsp import reproduces FlowJo-recorded counts', () => {
  for (const c of WSP_CASES) {
    it(c, () => {
      const { rows } = compareWsp(c);
      if (EXACT.has(c)) {
        for (const r of rows) expect(r.ours, `${r.sample} ${r.path}`).toBe(r.flowjo);
      } else {
        // Known gaps, see docs/validation/wsp-counts.md for every population.
        // Regression bound measured on the current implementation, not a
        // compatibility claim: |diff| <= 1% of FlowJo count + 10 events.
        // The ellipse on logicle axes in 8_color_ICS_with_ellipse differs by
        // 2-3.2%; bounded separately at 4%.
        for (const r of rows) {
          const rel = r.path.endsWith('ellipse1') ? 0.04 : 0.01;
          expect(Math.abs(r.ours - r.flowjo), `${r.sample} ${r.path}`).toBeLessThanOrEqual(rel * r.flowjo + 10);
        }
      }
    });
  }
});
