// Autofluorescence (AF) handling for spectral unmixing. An AF spectrum is
// estimated from an unstained control as the per-detector median signal, and
// added as an extra row to a spectral matrix so ordinary-least-squares
// unmixing separates AF from the real fluorochromes. Validated on synthetic
// mixtures only; not compared with FlowJo or an instrument vendor.
import type { SpilloverMatrix } from './compensation';
import { isSpectral } from './compensation';
import { fail } from './errors';
import { quantileSorted } from './stats';

export const AF_NAME = 'Autofluorescence';

// Per-detector median of the unstained control over the given detector
// channels, normalised so the largest detector is 1 (a relative spectrum).
export function estimateAfSpectrum(columns: Map<string, Float64Array>, detectors: string[], mask?: Uint8Array): number[] {
  if (detectors.length === 0) fail('COMP_INVALID', 'No detectors given for autofluorescence');
  const idx: number[] = [];
  const first = columns.get(detectors[0]);
  if (!first) fail('COMP_CHANNEL_MISMATCH', `Unstained control lacks detector ${detectors[0]}`);
  for (let i = 0; i < first.length; i++) if (!mask || mask[i]) idx.push(i);
  if (idx.length < 100) fail('COMP_INVALID', `Unstained control has only ${idx.length} gated events (need 100)`);
  const med = detectors.map((d) => {
    const col = columns.get(d);
    if (!col) fail('COMP_CHANNEL_MISMATCH', `Unstained control lacks detector ${d}`);
    return quantileSorted(Float64Array.from(idx, (i) => col[i]).sort(), 0.5);
  });
  const max = Math.max(...med.map(Math.abs));
  if (!(max > 0)) fail('COMP_INVALID', 'Autofluorescence spectrum is all zero');
  return med.map((v) => v / max);
}

// Append the AF spectrum as an extra output row of a spectral matrix. The AF
// spectrum must be index-aligned with the matrix detectors (columns).
export function withAutofluorescence(m: SpilloverMatrix, afSpectrum: number[], name = AF_NAME): SpilloverMatrix {
  if (!isSpectral(m)) fail('COMP_INVALID', 'Autofluorescence can only be added to a spectral (unmixing) matrix');
  if (afSpectrum.length !== m.channels.length) fail('COMP_INVALID', `AF spectrum has ${afSpectrum.length} detectors; matrix has ${m.channels.length}`);
  const outputs = m.outputNames ?? m.values.map((_, i) => `F${i}`);
  if (outputs.includes(name)) fail('COMP_INVALID', `Matrix already has an output named "${name}"`);
  return {
    ...m,
    id: `${m.id}+af`,
    name: `${m.name} + AF`,
    outputNames: [...outputs, name],
    values: [...m.values.map((r) => [...r]), [...afSpectrum]],
    source: `${m.source} with autofluorescence`,
  };
}
