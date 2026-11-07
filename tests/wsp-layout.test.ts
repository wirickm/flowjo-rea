import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseWsp } from '../src/core/wsp';

const f = 'fixtures/flowkit/data/simple_line_example/simple_poly_and_rect.wsp';

describe.skipIf(!existsSync(f))('.wsp layout editor settings (specs 25.4)', () => {
  it('imports the current layout page (Letter, portrait) and iteration', () => {
    const r = parseWsp(readFileSync(f, 'utf8'));
    expect(r.workspace.layoutPage).toEqual({ paper: 'letter', orientation: 'portrait' });
    expect(r.workspace.layoutIteration?.type).toMatch(/OFF|SAMPLE/);
    expect(r.warnings.some((w) => w.includes('figures not imported'))).toBe(false);
  });
});
