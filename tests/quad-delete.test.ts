// Deleting a quad deletes its sibling quads, as FlowJo 10.6.2 does
// (STreeMgr.deleteSelection -> NodeList.addSiblingQuads; quad tests
// RectGate.getQuadID, RangeGate.isQuad, CurlyQuadGate.isQuad; read with
// Ghidra). Spec: docs/validation/flowjo-engine-specs.md section 6.2.
import { describe, expect, it } from 'vitest';
import { haveFixtures, readText } from './fixtures';
import { parseWsp } from '../src/core/wsp';
import type { Dimension, Gate, Population } from '../src/core/model';
import { deletionRoots, isQuadGate, removePopulation, subtreeIds } from '../src/core/project';

const d = (channel: string): Dimension => ({ kind: 'channel', channel, transform: { kind: 'linear', T: 1024, A: 0 } });
const X = d('CD3'), Y = d('CD4'), Z = d('CD8');
const quad = (side: [number, number], dims = [X, Y], at = 500): Gate => ({ type: 'quadrant', dims, dividers: [[at], [at]], side });
const pop = (id: string, gate: Gate, parentId: string | null = 'p'): Population => ({ id, name: id, parentId, gate });

describe('FlowJo quad test', () => {
  it('rectangles: exactly one open bound on each axis', () => {
    expect(isQuadGate({ type: 'rect', dims: [X, Y], min: [null, 200], max: [500, null] })).toBe(true);
    expect(isQuadGate({ type: 'rect', dims: [X, Y], min: [100, 200], max: [500, null] })).toBe(false);
    expect(isQuadGate({ type: 'rect', dims: [X, Y], min: [null, null], max: [null, 300] })).toBe(false);
  });
  it('ranges with an open end, curly quads and end-interval quadrants are quads', () => {
    expect(isQuadGate({ type: 'rect', dims: [X], min: [null], max: [500] })).toBe(true);
    expect(isQuadGate({ type: 'rect', dims: [X], min: [100], max: [500] })).toBe(false);
    expect(isQuadGate({ type: 'splineQuadrant', dims: [X, Y], xDivider: [[1, 1]], yDivider: [[1, 1]], side: [0, 1] })).toBe(true);
    expect(isQuadGate(quad([0, 1]))).toBe(true);
    // Middle interval of a two-divider split: closed on both sides.
    expect(isQuadGate({ type: 'quadrant', dims: [X, Y], dividers: [[100, 500], [500]], side: [1, 0] })).toBe(false);
    expect(isQuadGate({ type: 'ellipsoid', dims: [X, Y], mean: [0, 0], cov: [[1, 0], [0, 1]], distanceSquare: 1 })).toBe(false);
  });
});

describe('deleting a quad', () => {
  const pops: Population[] = [
    pop('p', { type: 'rect', dims: [X], min: [0], max: [900] }, null),
    pop('q1', quad([0, 1])), pop('q2', quad([1, 1])), pop('q3', quad([1, 0])), pop('q4', quad([0, 0])),
    pop('moved', quad([0, 0], [X, Y], 700)), // other centre, same parameters: deleted too
    pop('otherParams', quad([0, 0], [X, Z])), // other parameters: kept
    pop('rect', { type: 'rect', dims: [X, Y], min: [100, 100], max: [200, 200] }), // not a quad: kept
    pop('child', { type: 'rect', dims: [Z], min: [0], max: [10] }, 'q2'),
    pop('elsewhere', quad([0, 1]), 'rect'), // a quad under another parent: kept
  ];
  it('takes every sibling quad on the same x and y parameters, wherever its centre', () => {
    expect(deletionRoots(pops, 'q3')).toEqual(['q3', 'q1', 'q2', 'q4', 'moved']);
    expect([...subtreeIds(pops, deletionRoots(pops, 'q3'))].sort()).toEqual(['child', 'moved', 'q1', 'q2', 'q3', 'q4']);
  });
  it('a gate that is not a quad is deleted alone', () => {
    expect(deletionRoots(pops, 'rect')).toEqual(['rect']);
    expect(deletionRoots(pops, 'p')).toEqual(['p']);
  });
});

describe.skipIf(!haveFixtures)('deleting a FlowJo-imported quad', () => {
  it('removes all four quadrants of reused_quad_gate_with_child.wsp and their children', () => {
    const { workspace } = parseWsp(readText('8_color_data_set/reused_quad_gate_with_child.wsp'));
    const s = workspace.samples[0];
    const first = s.populations.find((p) => p.gate.type === 'quadrant')!;
    const roots = deletionRoots(s.populations, first.id);
    expect(roots.length).toBe(4);
    const doomed = subtreeIds(s.populations, roots);
    const before = s.populations.length;
    for (const r of roots) removePopulation(s, r);
    expect(s.populations.length).toBe(before - doomed.size);
    expect(s.populations.some((p) => p.parentId === first.parentId && p.gate.type === 'quadrant')).toBe(false);
  });
});
