import { describe, expect, it } from 'vitest';
import { statsCsv } from '../src/core/statsTable';

describe('statistics CSV', () => {
  it('quotes commas, quotes and newlines; formats numbers; keeps NaN explicit', () => {
    const csv = statsCsv({ group: true, annotations: ['Condition'], columns: ['Cells: Count', 'Cells: Median (CD3, comp)'] }, [
      { group: 'A, B', sample: 's1.fcs', annotations: ['say "hi"'], values: [100, 2273.456789] },
      { group: 'A, B', sample: 's2.fcs', annotations: [''], values: [0, NaN] },
    ]);
    expect(csv).toBe('Group,Sample,Condition,Cells: Count,"Cells: Median (CD3, comp)"\n"A, B",s1.fcs,"say ""hi""",100,2273.46\n"A, B",s2.fcs,,0,NaN\n');
  });
});
