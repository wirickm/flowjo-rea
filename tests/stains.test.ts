import { describe, expect, it } from 'vitest';
import { withStains } from '../src/ui/axes';
import { channelDisplayName } from '../src/core/fcs';

const ch = (index: number, name: string, label: string) => ({ index, name, label, bits: 32, range: 262144, logDecades: 0, logOffset: 0, gain: 1 });
const meta = { channels: [ch(1, 'FSC-A', ''), ch(2, 'FL1-A', 'CD3 FITC')], keywords: { $P1N: 'FSC-A', $P2N: 'FL1-A', $P2S: 'CD3 FITC' } as Record<string, string> };

describe('edited stains (specs 18.1)', () => {
  it('returns the same metadata when nothing is edited', () => {
    expect(withStains(meta, undefined)).toBe(meta);
    expect(withStains(meta, {})).toBe(meta);
  });
  it('replaces the label and the $PnS keyword of the edited parameter only', () => {
    const m = withStains(meta, { 'FL1-A': 'CD3' });
    expect(m.channels[1].label).toBe('CD3');
    expect(m.keywords.$P2S).toBe('CD3');
    expect(m.channels[0]).toBe(meta.channels[0]);
    expect(meta.channels[1].label).toBe('CD3 FITC');
  });
  it('adds a stain to a parameter without one and shows "name :: stain"', () => {
    const m = withStains(meta, { 'FSC-A': 'Size' });
    expect(m.keywords.$P1S).toBe('Size');
    expect(channelDisplayName(m.channels[0])).toBe('FSC-A :: Size');
  });
  it('an empty stain clears it: the axis shows the name alone', () => {
    const m = withStains(meta, { 'FL1-A': '' });
    expect(channelDisplayName(m.channels[1])).toBe('FL1-A');
  });
});
