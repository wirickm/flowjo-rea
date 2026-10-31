// Spillover / compensation. Compensated = raw x inverse(spillover), applied to
// the detector columns named by the matrix (FCS 3.1 $SPILLOVER semantics).
import { AppError, fail } from './errors';
import type { FcsFile } from './fcs';

export interface SpilloverMatrix {
  id: string;
  name: string;
  channels: string[]; // detector names ($PnN), row/column order
  // Optional names for the compensated outputs (Gating-ML fluorochromes).
  // Square: index-aligned with channels. Spectral: one per row of values,
  // with fewer rows (fluorochromes) than columns (detectors).
  outputNames?: string[];
  values: number[][]; // spill[i][j]: fraction of channel i signal seen in detector j
  source: string;
}

export function parseSpilloverKeyword(text: string): { channels: string[]; values: number[][] } {
  const parts = text.split(',').map((s) => s.trim());
  const n = parseInt(parts[0], 10);
  if (!Number.isInteger(n) || n <= 0) fail('COMP_INVALID', `Spillover keyword has invalid size "${parts[0]}"`);
  if (parts.length !== 1 + n + n * n) {
    fail('COMP_INVALID', `Spillover keyword has ${parts.length - 1} fields; expected ${n + n * n} for n=${n}`);
  }
  const channels = parts.slice(1, 1 + n);
  const nums = parts.slice(1 + n).map(Number);
  if (nums.some((v) => !Number.isFinite(v))) fail('COMP_INVALID', 'Spillover keyword contains non-numeric values');
  const values: number[][] = [];
  for (let i = 0; i < n; i++) values.push(nums.slice(i * n, i * n + n));
  return { channels, values };
}

export function spilloverFromFcs(f: FcsFile): SpilloverMatrix | null {
  for (const key of ['$SPILLOVER', 'SPILL', '$SPILL', 'SPILLOVER', '$COMP']) {
    const v = f.keywords[key];
    if (v && v.trim() !== '' && v.trim() !== '0') {
      const { channels, values } = parseSpilloverKeyword(v);
      return { id: 'fcs', name: `File (${key})`, channels, values, source: `keyword ${key}` };
    }
  }
  return null;
}

// CSV with a header row of channel names followed by an n x n numeric block.
// An optional leading label column is accepted (FlowJo / FlowKit exports).
export function parseSpilloverCsv(text: string, name = 'CSV matrix'): SpilloverMatrix {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => l.split(/[,\t]/).map((s) => s.trim().replace(/^"|"$/g, '')));
  if (rows.length < 2) fail('COMP_INVALID', 'Matrix CSV needs a header row and at least one data row');
  let header = rows[0];
  const body = rows.slice(1);
  const labelCol = body.every((r) => r.length === header.length && !Number.isFinite(Number(r[0])) && r[0] !== '');
  if (labelCol || header[0] === '') header = header.slice(1);
  const n = header.length;
  const values = body.map((r) => (labelCol || r.length === n + 1 ? r.slice(1) : r).map(Number));
  if (labelCol && values.length !== n) {
    // Spectral: rows are fluorochromes (labels), columns detectors (header).
    if (values.some((r) => r.length !== n || r.some((v) => !Number.isFinite(v)))) fail('COMP_INVALID', 'Spectral matrix CSV rows must have one numeric value per detector');
    return { id: `csv-${Date.now().toString(36)}`, name, channels: header, outputNames: body.map((r) => r[0]), values, source: 'csv (spectral)' };
  }
  if (values.length !== n || values.some((r) => r.length !== n)) {
    fail('COMP_INVALID', `Matrix CSV is not square: ${n} channel names, ${values.length} rows`);
  }
  if (values.some((r) => r.some((v) => !Number.isFinite(v)))) fail('COMP_INVALID', 'Matrix CSV contains non-numeric values');
  return { id: `csv-${Date.now().toString(36)}`, name, channels: header, values, source: 'csv' };
}

// Gauss-Jordan inverse with partial pivoting; rejects singular / ill-conditioned input.
export function invert(m: number[][]): number[][] {
  const n = m.length;
  if (n === 0 || m.some((r) => r.length !== n)) fail('COMP_INVALID', 'Matrix must be square and non-empty');
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) fail('COMP_SINGULAR', 'Spillover matrix is singular and cannot be inverted');
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  const inv = a.map((r) => r.slice(n));
  if (inv.some((r) => r.some((v) => !Number.isFinite(v)))) fail('COMP_SINGULAR', 'Matrix inverse is not finite');
  return inv;
}

// Spectral (unmixing) matrix: fluorochrome rows x detector columns, rows < columns.
export function isSpectral(m: SpilloverMatrix): boolean {
  return m.values.length !== m.channels.length;
}

function transpose(a: number[][]): number[][] {
  return a[0].map((_, j) => a.map((r) => r[j]));
}

function matmul(a: number[][], b: number[][]): number[][] {
  return a.map((r) => b[0].map((_, j) => r.reduce((s, v, k) => s + v * b[k][j], 0)));
}

// Ordinary least squares unmixing operator M = S^T (S S^T)^-1 (detectors x
// fluorochromes): fluor = raw x M minimises ||raw - fluor x S||.
export function unmixingOperator(m: SpilloverMatrix): number[][] {
  const S = m.values;
  let inv: number[][];
  try {
    inv = invert(matmul(S, transpose(S)));
  } catch {
    fail('COMP_SINGULAR', 'Spectral matrix rows are linearly dependent; unmixing is undefined');
  }
  return matmul(transpose(S), inv);
}

function validateSpectral(m: SpilloverMatrix, available: string[]): string[] {
  const nf = m.values.length;
  const nd = m.channels.length;
  if (!m.outputNames || m.outputNames.length !== nf) fail('COMP_INVALID', 'Spectral matrix needs one fluorochrome name per row');
  if (nf > nd) fail('COMP_INVALID', `Spectral matrix has more fluorochromes (${nf}) than detectors (${nd})`);
  if (m.values.some((r) => r.length !== nd || r.some((v) => !Number.isFinite(v)))) fail('COMP_INVALID', 'Spectral matrix rows must have one finite value per detector');
  if (new Set(m.channels).size !== nd || new Set(m.outputNames).size !== nf) fail('COMP_INVALID', 'Spectral matrix repeats a detector or fluorochrome name');
  const missing = m.channels.filter((c) => !available.includes(c));
  if (missing.length) fail('COMP_CHANNEL_MISMATCH', `Matrix detectors not in sample: ${missing.join(', ')}`);
  const clash = m.outputNames.filter((c) => available.includes(c));
  if (clash.length) fail('COMP_INVALID', `Fluorochrome names collide with sample channels: ${clash.join(', ')}`);
  unmixingOperator(m);
  return [];
}

// Unmixed fluorochrome columns keyed by fluorochrome name.
export function unmix(data: Float64Array[], channelNames: string[], m: SpilloverMatrix): Map<string, Float64Array> {
  validateSpectral(m, channelNames);
  const M = unmixingOperator(m);
  const idx = m.channels.map((c) => channelNames.indexOf(c));
  const nf = m.values.length;
  const ev = data[0]?.length ?? 0;
  const cols = Array.from({ length: nf }, () => new Float64Array(ev));
  for (let e = 0; e < ev; e++) {
    for (let k = 0; k < nf; k++) {
      let s = 0;
      for (let d = 0; d < idx.length; d++) s += data[idx[d]][e] * M[d][k];
      cols[k][e] = s;
    }
  }
  return new Map(m.outputNames!.map((n, k) => [n, cols[k]]));
}

export function validateMatrix(m: SpilloverMatrix, available: string[]): string[] {
  if (isSpectral(m)) return validateSpectral(m, available);
  const warnings: string[] = [];
  const n = m.channels.length;
  if (m.values.length !== n || m.values.some((r) => r.length !== n)) fail('COMP_INVALID', 'Matrix dimensions do not match channel list');
  if (new Set(m.channels).size !== n) fail('COMP_INVALID', 'Matrix lists a channel more than once');
  const missing = m.channels.filter((c) => !available.includes(c));
  if (missing.length) fail('COMP_CHANNEL_MISMATCH', `Matrix channels not in sample: ${missing.join(', ')}`);
  for (let i = 0; i < n; i++) {
    if (Math.abs(m.values[i][i] - 1) > 1e-6) warnings.push(`Diagonal for ${m.channels[i]} is ${m.values[i][i]} (expected 1)`);
  }
  return warnings;
}

// Returns new column arrays; columns not in the matrix are shared, not copied.
export function compensate(data: Float64Array[], channelNames: string[], m: SpilloverMatrix): Float64Array[] {
  validateMatrix(m, channelNames);
  const inv = invert(m.values);
  const idx = m.channels.map((c) => channelNames.indexOf(c));
  const n = idx.length;
  const ev = data[0]?.length ?? 0;
  const out = data.slice();
  const cols = idx.map(() => new Float64Array(ev));
  const row = new Float64Array(n);
  for (let e = 0; e < ev; e++) {
    for (let i = 0; i < n; i++) row[i] = data[idx[i]][e];
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += row[i] * inv[i][j];
      cols[j][e] = s;
    }
  }
  idx.forEach((ci, j) => (out[ci] = cols[j]));
  return out;
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
