// FlowJo per-population plot settings imported from .wsp <Graph> elements.
import { describe, expect, it } from 'vitest';
import { populationPath } from '../src/core/model';
import { parseWsp } from '../src/core/wsp';
import { haveFixtures, readText } from './fixtures';
import { WSP_CASES } from './wspCompare';

describe.skipIf(!haveFixtures)('FlowJo graph settings import', () => {
  it('reads axes and plot type (8_color_ICS_simple.wsp)', () => {
    const { workspace } = parseWsp(readText('8_color_data_set/8_color_ICS_simple.wsp'));
    expect(workspace.plots!['Time']).toEqual({ x: 'FSC-W', y: 'FSC-H', kind: 'pseudocolor' });
    expect(workspace.plots!['']).toEqual({ x: 'CD107a PE FLR-A', y: null, kind: 'histogram' }); // Comp- prefix resolved
  });
  // Observed: FlowJo saves each node's last-viewed plot, which shows only some
  // of its child gates (121 of 219 2-D gates in the fixtures). Reported, not asserted.
  it('reports how often the saved plot matches a child gate (all fixtures)', () => {
    let checked = 0;
    const mismatches: string[] = [];
    for (const c of WSP_CASES) {
      const { workspace } = parseWsp(readText(c));
      for (const s of workspace.samples) {
        for (const p of s.populations) {
          if (p.gate.type === 'boolean' || p.gate.dims.length !== 2) continue;
          const parentPath = p.parentId ? populationPath(s.populations, p.parentId) : '';
          const plot = workspace.plots![parentPath];
          if (!plot) continue;
          const dims = p.gate.dims.map((d) => (d.kind === 'channel' ? d.channel : '')).sort();
          checked++;
          if (JSON.stringify([plot.x, plot.y].sort()) !== JSON.stringify(dims)) mismatches.push(`${c} ${s.fileName} ${parentPath} plot ${plot.x}/${plot.y} gate ${dims}`);
        }
      }
    }
    console.log(`graph/gate consistency: ${checked} gates checked, ${mismatches.length} mismatches`);
    if (mismatches.length) console.log(mismatches.slice(0, 10).join('\n'));
    expect(checked).toBeGreaterThan(50);
  });
});
