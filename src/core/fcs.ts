// FCS 2.0 / 3.0 / 3.1 reader, written from the ISAC FCS 3.1 specification
// (Spidlen et al., Cytometry A 2010). List mode only.
import { fail } from './errors';

export interface FcsChannel {
  index: number; // 1-based $Pn index
  name: string; // $PnN (detector / short name)
  label: string; // $PnS or '' when absent
  bits: number;
  range: number; // $PnR
  logDecades: number; // $PnE f1
  logOffset: number; // $PnE f2
  gain: number; // $PnG, 1 when absent
}

export interface FcsFile {
  version: string;
  keywords: Record<string, string>; // keyword names upper-cased
  channels: FcsChannel[];
  eventCount: number;
  // Column-major event data in "scale" units: $PnE log amplification is
  // converted to linear values and linear parameters are divided by $PnG.
  data: Float64Array[];
  warnings: string[];
  datasetIndex: number;
  datasetOffsets: number[]; // byte offsets of every data set found via $NEXTDATA
}

const td = (bytes: Uint8Array, latin1 = false) =>
  new TextDecoder(latin1 ? 'latin1' : 'utf-8', { fatal: !latin1 }).decode(bytes);

function readHeaderInt(buf: Uint8Array, start: number): number {
  const s = td(buf.subarray(start, start + 8), true).trim();
  if (s === '') return 0;
  if (!/^-?\d+$/.test(s)) fail('FCS_BAD_HEADER', `Header offset field "${s}" is not an integer`);
  return parseInt(s, 10);
}

// Parse a TEXT segment. The first byte is the delimiter; a doubled delimiter
// inside a keyword or value is a literal delimiter character.
export function parseText(seg: Uint8Array, warnings: string[]): Record<string, string> {
  if (seg.length < 2) fail('FCS_BAD_TEXT', 'TEXT segment is empty');
  let str: string;
  try {
    str = td(seg);
  } catch {
    warnings.push('TEXT segment is not valid UTF-8; decoded as Latin-1');
    str = td(seg, true);
  }
  const delim = str[0];
  const tokens: string[] = [];
  let cur = '';
  let i = 1;
  while (i < str.length) {
    const ch = str[i];
    if (ch === delim) {
      if (str[i + 1] === delim && i + 1 < str.length - 1) {
        // Escaped delimiter; FCS 3.1 forbids empty keywords/values so this is unambiguous.
        cur += delim;
        i += 2;
        continue;
      }
      tokens.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.trim() !== '') tokens.push(cur); // tolerate a missing final delimiter
  if (tokens.length % 2 !== 0) {
    warnings.push(`TEXT segment has an odd number of fields (${tokens.length}); last field ignored`);
    tokens.pop();
  }
  const kw: Record<string, string> = {};
  for (let k = 0; k < tokens.length; k += 2) {
    const key = tokens[k].trim().toUpperCase();
    if (key in kw) warnings.push(`Duplicate keyword ${key}; last value kept`);
    kw[key] = tokens[k + 1];
  }
  return kw;
}

function req(kw: Record<string, string>, key: string): string {
  const v = kw[key];
  if (v === undefined) fail('FCS_MISSING_KEYWORD', `Required keyword ${key} is missing`);
  return v;
}

function reqInt(kw: Record<string, string>, key: string): number {
  const v = req(kw, key).trim();
  if (!/^\d+$/.test(v)) fail('FCS_BAD_TEXT', `Keyword ${key}="${v}" is not a non-negative integer`);
  return parseInt(v, 10);
}

export interface ParseOptions {
  datasetIndex?: number;
  raw?: boolean; // skip $PnR masking, $PnE and $PnG scaling (stored channel values)
}

export function parseFcs(input: ArrayBuffer | Uint8Array, opts: ParseOptions = {}): FcsFile {
  const datasetIndex = opts.datasetIndex ?? 0;
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const offsets: number[] = [0];
  // Walk $NEXTDATA to enumerate data sets, then parse the requested one.
  let base = 0;
  let parsed: FcsFile | null = null;
  for (let idx = 0; ; idx++) {
    const ds = parseDataset(buf, base, idx === datasetIndex, opts.raw ?? false);
    if (idx === datasetIndex) parsed = ds.file;
    const next = ds.nextData;
    if (!next || base + next >= buf.length || offsets.includes(base + next)) break;
    base += next;
    offsets.push(base);
    if (offsets.length > 1000) break;
  }
  if (!parsed) fail('FCS_BAD_OFFSETS', `Data set ${datasetIndex} not found (file has ${offsets.length})`);
  parsed.datasetIndex = datasetIndex;
  parsed.datasetOffsets = offsets;
  return parsed;
}

function parseDataset(buf: Uint8Array, base: number, decodeData: boolean, raw: boolean): { file: FcsFile | null; nextData: number } {
  if (buf.length < base + 58) fail('FCS_TRUNCATED', 'File is shorter than an FCS header');
  const version = td(buf.subarray(base, base + 6), true);
  if (!/^FCS[23]\.\d$/.test(version)) fail('FCS_BAD_HEADER', `Not an FCS file (header starts "${version}")`);
  if (!['FCS2.0', 'FCS3.0', 'FCS3.1'].includes(version)) {
    fail('FCS_UNSUPPORTED', `${version} is not supported (supported: 2.0, 3.0, 3.1)`);
  }
  const warnings: string[] = [];
  const h = [10, 18, 26, 34, 42, 50].map((p) => readHeaderInt(buf, base + p));
  const [textStart, textEnd] = h;
  if (textEnd < textStart || base + textEnd >= buf.length) fail('FCS_TRUNCATED', 'TEXT segment extends past end of file');
  const kw = parseText(buf.subarray(base + textStart, base + textEnd + 1), warnings);
  // Supplemental TEXT (FCS 3.x)
  const sts = parseInt(kw['$BEGINSTEXT'] ?? '0', 10);
  const ste = parseInt(kw['$ENDSTEXT'] ?? '0', 10);
  if (sts > 0 && ste > sts && base + ste < buf.length) {
    const sup = parseText(buf.subarray(base + sts, base + ste + 1), warnings);
    for (const [k, v] of Object.entries(sup)) if (!(k in kw)) kw[k] = v;
  }
  const nextData = parseInt(kw['$NEXTDATA'] ?? '0', 10) || 0;
  if (!decodeData) return { file: null, nextData };

  const mode = (kw['$MODE'] ?? 'L').toUpperCase();
  if (mode !== 'L') fail('FCS_UNSUPPORTED', `$MODE=${mode} (histogram modes) is not supported; only list mode`);
  const datatype = req(kw, '$DATATYPE').toUpperCase();
  if (!['I', 'F', 'D'].includes(datatype)) fail('FCS_UNSUPPORTED', `$DATATYPE=${datatype} is not supported (I, F, D)`);
  const par = reqInt(kw, '$PAR');
  const tot = reqInt(kw, '$TOT');
  if (par === 0) fail('FCS_BAD_TEXT', '$PAR is 0');

  const byteord = req(kw, '$BYTEORD').replace(/\s/g, '');
  let little: boolean;
  if (byteord === '1,2,3,4' || byteord === '1,2') little = true;
  else if (byteord === '4,3,2,1' || byteord === '2,1') little = false;
  else fail('FCS_UNSUPPORTED', `$BYTEORD=${byteord} (mixed endianness) is not supported`);

  const channels: FcsChannel[] = [];
  for (let n = 1; n <= par; n++) {
    const bitsStr = req(kw, `$P${n}B`).trim();
    const bits = bitsStr === '*' ? 0 : parseInt(bitsStr, 10);
    const range = parseFloat(req(kw, `$P${n}R`));
    const e = (kw[`$P${n}E`] ?? '0,0').split(',').map((s) => parseFloat(s));
    const g = parseFloat(kw[`$P${n}G`] ?? '1');
    channels.push({
      index: n,
      name: req(kw, `$P${n}N`).trim(),
      label: (kw[`$P${n}S`] ?? '').trim(),
      bits,
      range: Number.isFinite(range) ? range : 0,
      logDecades: e[0] || 0,
      logOffset: e[1] || 0,
      gain: Number.isFinite(g) && g > 0 ? g : 1,
    });
  }
  const names = new Set<string>();
  for (const c of channels) {
    if (names.has(c.name)) warnings.push(`Duplicate channel name ${c.name}`);
    names.add(c.name);
  }

  let rowBytes = 0;
  for (const c of channels) {
    if (datatype === 'F' && c.bits !== 32) fail('FCS_UNSUPPORTED', `$P${c.index}B=${c.bits} with $DATATYPE=F (expected 32)`);
    if (datatype === 'D' && c.bits !== 64) fail('FCS_UNSUPPORTED', `$P${c.index}B=${c.bits} with $DATATYPE=D (expected 64)`);
    if (datatype === 'I' && ![8, 16, 32, 64].includes(c.bits)) {
      fail('FCS_UNSUPPORTED', `$P${c.index}B=${c.bits}: integer widths other than 8/16/32/64 are not supported`);
    }
    rowBytes += c.bits / 8;
  }
  const expected = rowBytes * tot;

  // Resolve DATA offsets: header vs TEXT. Some instruments write inconsistent
  // values; pick the candidate whose length matches $TOT x row size.
  const candidates: { src: string; start: number; end: number }[] = [];
  if (h[2] > 0 || h[3] > 0) candidates.push({ src: 'HEADER', start: h[2], end: h[3] });
  if (kw['$BEGINDATA'] !== undefined && kw['$ENDDATA'] !== undefined) {
    candidates.push({ src: 'TEXT', start: parseInt(kw['$BEGINDATA'], 10), end: parseInt(kw['$ENDDATA'], 10) });
  }
  if (candidates.length === 0) fail('FCS_BAD_OFFSETS', 'No DATA segment offsets in HEADER or TEXT');
  const fits = (c: { start: number; end: number }) => base + c.start + expected <= buf.length && c.start > 0;
  let chosen = candidates.find((c) => fits(c) && c.end - c.start + 1 === expected);
  if (!chosen) {
    chosen = candidates.find((c) => fits(c));
    if (!chosen) fail('FCS_TRUNCATED', `DATA segment needs ${expected} bytes but the file is too short`);
    warnings.push(
      `DATA offsets inconsistent with $TOT x row size (${expected} bytes): ` +
        candidates.map((c) => `${c.src} ${c.start}-${c.end}`).join(', ') +
        `; using ${chosen.src} start offset`,
    );
  }
  if (candidates.length === 2 && (candidates[0].start !== candidates[1].start || candidates[0].end !== candidates[1].end)) {
    if (!warnings.some((w) => w.startsWith('DATA offsets'))) {
      warnings.push(`HEADER and TEXT DATA offsets differ; using ${chosen.src}`);
    }
  }

  const start = base + chosen.start;
  const dv = new DataView(buf.buffer, buf.byteOffset + start, expected);
  const data = channels.map(() => new Float64Array(tot));
  const colOffsets: number[] = [];
  let o = 0;
  for (const c of channels) {
    colOffsets.push(o);
    o += c.bits / 8;
  }
  for (let ci = 0; ci < par; ci++) {
    const c = channels[ci];
    const col = data[ci];
    let off = colOffsets[ci];
    if (datatype === 'F') {
      for (let e = 0; e < tot; e++, off += rowBytes) col[e] = dv.getFloat32(off, little);
    } else if (datatype === 'D') {
      for (let e = 0; e < tot; e++, off += rowBytes) col[e] = dv.getFloat64(off, little);
    } else {
      // Integer: mask bits above the range (FCS 3.1 section 3.2.20, $PnR).
      let mask = 0;
      if (!raw && c.range > 0 && c.bits <= 32) {
        const pow = Math.ceil(Math.log2(c.range));
        if (pow < c.bits) mask = 2 ** pow - 1;
      }
      for (let e = 0; e < tot; e++, off += rowBytes) {
        let v: number;
        if (c.bits === 8) v = dv.getUint8(off);
        else if (c.bits === 16) v = dv.getUint16(off, little);
        else if (c.bits === 32) v = dv.getUint32(off, little);
        else v = Number(dv.getBigUint64(off, little));
        if (mask) v = v & mask;
        col[e] = v;
      }
      if (!raw && c.logDecades > 0) {
        // Log amplification: value = 10^(f1 * x / range) * f2 (f2=0 treated as 1).
        const f2 = c.logOffset > 0 ? c.logOffset : 1;
        if (c.logOffset <= 0) warnings.push(`$P${c.index}E has f2=0; using 1 as offset`);
        for (let e = 0; e < tot; e++) col[e] = f2 * 10 ** ((c.logDecades * col[e]) / c.range);
      }
    }
  }
  channels.forEach((c, ci) => {
    if (datatype !== 'I' && c.logDecades > 0) warnings.push(`$P${c.index}E log amplification ignored for floating-point data`);
    // Channel-to-scale for linear parameters divides by $PnG (FCS 3.1; Gating-ML 2.0 section 4).
    if (!raw && c.gain !== 1 && !(datatype === 'I' && c.logDecades > 0)) {
      const col = data[ci];
      for (let e = 0; e < tot; e++) col[e] /= c.gain;
    }
  });
  return { file: { version, keywords: kw, channels, eventCount: tot, data, warnings, datasetIndex: 0, datasetOffsets: [] }, nextData };
}

export function channelDisplayName(c: FcsChannel): string {
  return c.label && c.label !== c.name ? `${c.name} :: ${c.label}` : c.name;
}
