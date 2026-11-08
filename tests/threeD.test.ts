import { describe, expect, it } from 'vitest';
import { bubbleRadius, bubbleStep, defaultAxes, GRADIENTS, gradientColor, pointPixels, populationAxis, SPECTRUM, spinStep, tableAxes, terrainHeights, wiggleHtml } from '../src/core/threeD';

describe('3D Viewer rules (ThreeD*)', () => {
  it('Spectrum gradient: ends pinned, linear between control points', () => {
    expect(gradientColor(SPECTRUM, 0)).toEqual([127, 0, 255, 255]);
    expect(gradientColor(SPECTRUM, 1)).toEqual([255, 0, 0, 255]);
    const c = gradientColor(SPECTRUM, 0.3); // between blue (0.25) and cyan (0.35)
    expect(c[0]).toBe(0); expect(c[1]).toBeCloseTo(127.5, 0); expect(c[2]).toBe(255);
    expect(gradientColor(GRADIENTS[0], 0.7)).toEqual([0, 0, 0, 255]);
    expect(GRADIENTS.map((g) => g.name)).toEqual(['Black', 'Red', 'Green', 'Blue', 'Spectrum', 'Black -> Transparent', 'Transparent -> Black', 'Black -> White', 'Black -> Red']);
  });
  it('population axis subtracts the minimum and multiplies by the range', () => {
    expect(Array.from(populationAxis([0, 0.5, 1]))).toEqual([0, 0.5, 1]);
    const a = populationAxis([0.2, 0.4, 0.6]);
    expect(a[2]).toBeCloseTo(0.4 * 0.4, 6);
  });
  it('table axes: widening, tiny range, frequency, empty cells', () => {
    const r = tableAxes([{ name: 'A', values: [0, 10] }, { name: 'B', values: [5, 5] }, { name: 'F', values: [20, 40], frequency: true }]);
    if ('error' in r) throw new Error(r.error);
    expect(r.axes[0].range).toEqual([-1, 11]);
    expect(r.axes[0].values[0]).toBeCloseTo(1 / 12, 6);
    expect(r.axes[1].range[0]).toBeCloseTo(4.9, 5);
    expect(r.axes[2].values[1]).toBeCloseTo(0.4, 6);
    const bad = tableAxes([{ name: 'X', values: [1, NaN] }]);
    expect('error' in bad && bad.error).toContain("column 'X' can not be plotted");
  });
  it('point and bubble sizes', () => {
    expect(pointPixels(0.01)).toBe(1);
    expect(pointPixels(0.8)).toBe(15);
    expect(pointPixels(1)).toBe(19);
    expect(bubbleRadius(0.5, null)).toBeCloseTo(0.06, 9);
    expect(bubbleRadius(0.5, 0.5)).toBeCloseTo(0.25 * 0.05 + 0.01, 9);
    expect(bubbleStep(2500)).toBe(2);
    expect(bubbleStep(300)).toBe(1);
  });
  it('terrain heights are the product of the X and Z marginals', () => {
    const h = terrainHeights([0.01, 0.01, 0.99], [0.01, 0.99, 0.99], 2);
    // binsX = [2, 1], binsZ = [1, 2]; products 2,4,1,2 / 4
    expect(Array.from(h)).toEqual([0.5, 1, 0.25, 0.5]);
  });
  it('spin step and default axes', () => {
    expect(spinStep(1)).toBe(0);
    expect(spinStep(4)).toBeCloseTo(0.02, 9);
    expect(spinStep(-100)).toBe(-0.08);
    expect(defaultAxes(['FSC-A', 'SSC-A', 'Time', 'CD3', 'CD4'], 'FSC-A', 'SSC-A')).toEqual({ x: 'FSC-A', y: 'SSC-A', z: 'CD3', color: 'CD4' });
  });
  it('wiggle movie has two frames', () => {
    expect(wiggleHtml('t', ['a', 'b']).match(/<img/g)!.length).toBe(2);
  });
});
