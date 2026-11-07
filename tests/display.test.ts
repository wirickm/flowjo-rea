import { describe, expect, it } from 'vitest';
import { formatFreq } from '../src/ui/renderPlot';

describe('gate frequency text (specs 22.1)', () => {
  it('3 significant figures, trailing zeros kept, at most 2 decimals, no % sign', () => {
    expect([formatFreq(45.678), formatFreq(0.5), formatFreq(100), formatFreq(5.0), formatFreq(99.996)]).toEqual(['45.7', '0.50', '100', '5.00', '100']);
  });
  it('between 0 and 0.01 switches to scientific notation', () => {
    expect(formatFreq(0.004)).toBe('4.00E-3');
    expect(formatFreq(0)).toBe('0.00');
  });
});
