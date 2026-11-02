// FlowJo 10 quadrants: four rectangles with one open bound per axis that share
// a centre (docs/validation/flowjo-engine-specs.md section 6.2). Imported as
// quadrant gates so the UI moves the four together (UAT a2-01: moving the
// centre of an imported quadrant moved only one of the four).
import { describe, expect, it } from 'vitest';
import { haveFixtures, readText } from './fixtures';
import { parseWsp } from '../src/core/wsp';
import { quadrantSiblings } from '../src/ui/gateGeometry';

describe.skipIf(!haveFixtures)('wsp quadrant import', () => {
  it('imports the four one-sided rectangles as one quadrant split', () => {
    const { workspace } = parseWsp(readText('8_color_data_set/reused_quad_gate_with_child.wsp'));
    const pops = workspace.samples[0].populations;
    const quads = pops.filter((p) => p.gate.type === 'quadrant');
    expect(quads.length).toBeGreaterThanOrEqual(4);
    const sibs = quadrantSiblings(pops, quads[0]);
    expect(sibs.length).toBe(4);
    // The four sides cover each combination once, so they partition the parent.
    const sides = sibs.map((p) => (p.gate.type === 'quadrant' ? p.gate.side.join('') : '')).sort();
    expect(sides).toEqual(['00', '01', '10', '11']);
  });

  it('keeps a rectangle with both bounds on an axis as a rectangle', () => {
    const { workspace } = parseWsp(readText('8_color_data_set/8_color_ICS.wsp'));
    const types = new Set(workspace.samples.flatMap((s) => s.populations.map((p) => p.gate.type)));
    expect(types.has('rect')).toBe(true);
  });
});
