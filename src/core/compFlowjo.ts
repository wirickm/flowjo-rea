// FlowJo 10.6.2 compensation (specs section 14): matrix files (.mtx and
// CSV), the compensation wizard on positive / negative populations
// (WizardMatrix.calculate) and the spillover spreading matrix
// (WeightOptimizer::CalculateSSM / CalculateSSMCoefficient). Read with REA's
// Ghidra provider (native) and headless Ghidra / javap (Java); implemented
// independently. This module is the one owner of these rules.
import type { SpilloverMatrix } from './compensation';
import { fail } from './errors';
import { flowjoPercentile, type ChannelScale } from './flowjoStats';
import { attr, descendants, esc, kids, local, parseXml } from './xml';

export const COMP_PREFIX = 'Comp-';

// .mtx (MatrixController.saveMatrixToFJComp): a Gating-ML root holding one
// transforms:spilloverMatrix; values are spillover (row = stained channel,
// column = detector), coefficients positional in the parameters order.
export function writeMtx(m: SpilloverMatrix, version = 'FlowJo-10.6.2'): string {
  const names = m.outputNames ?? m.channels.map((c) => `${COMP_PREFIX}${c}`);
  const params = m.channels.map((c, i) => `<data-type:parameter data-type:name="${esc(c)}" userProvidedCompInfix="${esc(names[i] ?? `${COMP_PREFIX}${c}`)}" />`).join('');
  const rows = m.values.map((row, i) => `<transforms:spillover data-type:parameter="${esc(m.channels[i] ?? names[i])}" userProvidedCompInfix="${esc(names[i] ?? '')}">${row.map((v) => `<transforms:coefficient transforms:value="${v}" />`).join('')}</transforms:spillover>`).join('');
  const spectral = m.kind ? m.kind === 'spectral' : m.values.length !== m.channels.length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gating:gatingML xmlns:gating="http://www.isac-net.org/std/Gating-ML/v2.0/gating" xmlns:transforms="http://www.isac-net.org/std/Gating-ML/v2.0/transformations" xmlns:data-type="http://www.isac-net.org/std/Gating-ML/v2.0/datatypes">` +
    `<transforms:spilloverMatrix spectral="${spectral}" prefix="${COMP_PREFIX}" name="${esc(m.name)}" editable="true" version="${version}" status="FINALIZED" transforms:id="${esc(m.id)}"><data-type:parameters>${params}</data-type:parameters>${rows}</transforms:spilloverMatrix></gating:gatingML>\n`;
}
// Load (Compensation.getCompensationMatrixFromFile): the transforms:
// spilloverMatrix child; legacy comp:* names accepted; a missing value is 0.
export function readMtx(text: string, fallbackName: string): SpilloverMatrix {
  const mx = descendants(parseXml(text).documentElement, 'spilloverMatrix')[0];
  if (!mx) fail('COMP_INVALID', 'No spilloverMatrix element in the matrix file');
  const paramsEl = kids(mx).find((e) => local(e) === 'parameters');
  const channels = paramsEl ? kids(paramsEl).filter((e) => local(e) === 'parameter').map((e) => attr(e, 'name') ?? '') : [];
  const rowsEl = kids(mx).filter((e) => local(e) === 'spillover');
  const outputNames = rowsEl.map((r) => attr(r, 'userProvidedCompInfix') ?? '');
  const values = rowsEl.map((r) => kids(r).filter((e) => local(e) === 'coefficient').map((c) => Number(attr(c, 'value') ?? 0)));
  if (!channels.length) channels.push(...rowsEl.map((r) => attr(r, 'parameter') ?? ''));
  if (!values.length || values.some((r) => r.length !== channels.length)) fail('COMP_INVALID', 'Matrix file rows do not match its parameters');
  const name = attr(mx, 'name') || fallbackName;
  const spectral = (attr(mx, 'spectral') ?? 'false') === 'true';
  const defaultNames = outputNames.every((n, i) => !n || n === `${COMP_PREFIX}${channels[i]}`);
  return { id: `mtx-${name}`, name, channels, values, source: 'FlowJo .mtx', kind: spectral ? 'spectral' : 'spillover', ...(defaultNames ? {} : { outputNames }) };
}
// CSV save (CompensationMatrix.toCSV): an empty cell then the detectors; each
// row the channel then its spillover values; comma separated, "\n" endings.
export function writeMatrixCsv(m: SpilloverMatrix): string {
  if (!m.values.length) return '';
  const head = ['', ...m.channels].join(',');
  return [head, ...m.values.map((r, i) => [m.outputNames?.[i] ?? m.channels[i], ...r.map(String)].join(','))].join('\n') + '\n';
}

// --- wizard (WizardMatrix.calculate) ----------------------------------------
export const MIN_POP_COUNT = 100;
export const MIN_POP_PERCENT = 0.02;
export const BADGES = {
  missingPos: 'Missing positive population',
  missingNeg: 'Missing negative population',
  negMedian: 'Could not calculate median of negative population',
  posMedian: 'Could not calculate median of positive population',
  posSmall: 'Median of positive population is too small. Please review the positive and negative gates',
  cleanup: (pop: string) => `We recommend applying a scatter gate to cleanup ${pop}`,
  tooFew: (pop: string) => `Population ${pop} does not contain enough events`,
};
export interface WizardPopulation {
  name: string;
  values: Map<string, Float64Array>; // uncompensated scale values per detector
  parentCount: number;
  // false when the population's parent is the sample (no cleanup gate).
  cleaned: boolean;
}
export interface WizardEntry { primary: string; pos: WizardPopulation | null; neg: WizardPopulation | null }
export interface WizardBadge { primary: string; level: 'error' | 'warning'; text: string }
export interface FlowjoWizardResult { matrix: SpilloverMatrix | null; status: 'FINALIZED' | 'ERRONEOUS' | 'EMPTY'; badges: WizardBadge[]; medians: Record<string, { pos: number[]; neg: number[] }> }
// Spillover(i, j) = (median P on j - median N on j) / (median P on i - median
// N on i), a difference of 0 taken as 1; medians are FlowJo's histogram
// medians of the uncompensated values. Populations need 100 events and 2% of
// their parent.
export function flowjoWizard(entries: WizardEntry[], detectors: string[], scales: Record<string, ChannelScale>, name = 'Compensation'): FlowjoWizardResult {
  const badges: WizardBadge[] = [];
  const med = (p: WizardPopulation, ch: string) => {
    const v = p.values.get(ch);
    return v && v.length ? flowjoPercentile(v, scales[ch] ?? { kind: 'linear', min: 0, max: 262144 }, 50) : NaN;
  };
  const ok: WizardEntry[] = [];
  for (const e of entries) {
    const before = badges.filter((b) => b.level === 'error').length;
    if (!e.pos) badges.push({ primary: e.primary, level: 'error', text: BADGES.missingPos });
    if (!e.neg) badges.push({ primary: e.primary, level: 'error', text: BADGES.missingNeg });
    for (const p of [e.pos, e.neg]) {
      if (!p) continue;
      const n = p.values.get(e.primary)?.length ?? 0;
      if (n < MIN_POP_COUNT || n < MIN_POP_PERCENT * p.parentCount) badges.push({ primary: e.primary, level: 'error', text: BADGES.tooFew(p.name) });
      if (!p.cleaned) badges.push({ primary: e.primary, level: 'warning', text: BADGES.cleanup(p.name) });
    }
    if (badges.filter((b) => b.level === 'error').length === before) ok.push(e);
  }
  const medians: FlowjoWizardResult['medians'] = {};
  const rows: number[][] = [];
  for (const e of ok) {
    const mp = detectors.map((d) => med(e.pos!, d)), mn = detectors.map((d) => med(e.neg!, d));
    medians[e.primary] = { pos: mp, neg: mn };
    const i = detectors.indexOf(e.primary);
    if (Number.isNaN(mn[i])) badges.push({ primary: e.primary, level: 'error', text: BADGES.negMedian });
    if (Number.isNaN(mp[i])) badges.push({ primary: e.primary, level: 'error', text: BADGES.posMedian });
    let d = mp[i] - mn[i];
    if (d < 1) badges.push({ primary: e.primary, level: 'warning', text: BADGES.posSmall });
    if (d === 0) d = 1;
    rows.push(detectors.map((_, j) => (mp[j] - mn[j]) / d));
  }
  const errors = badges.some((b) => b.level === 'error');
  if (errors) return { matrix: null, status: 'ERRONEOUS', badges, medians };
  if (!ok.length) return { matrix: null, status: 'EMPTY', badges, medians };
  // Square over the controlled detectors (rows and columns in detector order).
  const chans = detectors.filter((d) => ok.some((e) => e.primary === d));
  const values = chans.map((ci) => { const r = rows[ok.findIndex((e) => e.primary === ci)]; return chans.map((cj) => r[detectors.indexOf(cj)]); });
  return { matrix: { id: `wiz-${Date.now()}`, name, channels: chans, values, source: 'FlowJo wizard', kind: 'spillover' }, status: 'FINALIZED', badges, medians };
}

// --- spillover spreading matrix (WeightOptimizer::CalculateSSMCoefficient) ---
// SSM(i, j) = sqrt((P84_P,j - med_P,j)^2 - (P84_N,j - med_N,j)^2) /
// sqrt(med_P,i - med_N,i), 4096-channel percentiles; 0 when the denominator is
// not positive or the result is NaN.
export function ssmCoefficient(p84P: number, medP: number, p84N: number, medN: number, medPi: number, medNi: number): number {
  const den = medPi - medNi;
  if (!(den > 0) || !(Math.sqrt(den) > 0)) return 0;
  const v = Math.sqrt((p84P - medP) ** 2 - (p84N - medN) ** 2) / Math.sqrt(den);
  return Number.isNaN(v) ? 0 : v;
}
export function spilloverSpreading(entries: WizardEntry[], detectors: string[], scales: Record<string, ChannelScale>): { channels: string[]; values: number[][] } {
  const pct = (p: WizardPopulation, ch: string, q: number) => {
    const v = p.values.get(ch);
    return v && v.length ? flowjoPercentile(v, scales[ch] ?? { kind: 'linear', min: 0, max: 262144 }, q) : NaN;
  };
  const ok = entries.filter((e) => e.pos && e.neg && detectors.includes(e.primary));
  const channels = detectors.filter((d) => ok.some((e) => e.primary === d));
  const values = channels.map((ci) => {
    const e = ok.find((x) => x.primary === ci)!;
    const mPi = pct(e.pos!, ci, 50), mNi = pct(e.neg!, ci, 50);
    return channels.map((cj) => ssmCoefficient(pct(e.pos!, cj, 84), pct(e.pos!, cj, 50), pct(e.neg!, cj, 84), pct(e.neg!, cj, 50), mPi, mNi));
  });
  return { channels, values };
}
// Save SSM (saveSSMMatrixDialog): "SSM" then the parameter names; each row
// the parameter name without the comp prefix, then the values.
export function ssmCsv(s: { channels: string[]; values: number[][] }): string {
  const strip = (n: string) => (n.startsWith(COMP_PREFIX) ? n.slice(COMP_PREFIX.length) : n);
  return [['SSM', ...s.channels].join(','), ...s.values.map((r, i) => [strip(s.channels[i]), ...r.map(String)].join(','))].join('\n') + '\n';
}
