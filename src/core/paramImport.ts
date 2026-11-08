// FlowJo 10.6.2 "Import Parameters from CSV/CLR..." (WSCommand.IMPORT_CSV_CLR).
// Java side: WSDialogAction.importCsvClr -> FlowCAPUtil.importExternalParameter
// names the parameter and sends an "importCsv" / "importClr" derived parameter
// request; the native engine (Sample::CreateImportCsvParameter,
// Sample::CreateImportClrParameter) reads the file. Rules decoded from both and
// written up in docs/validation/ui-gaps/workspace.md (section O, IMPORT_CSV_CLR);
// implemented independently.
import { fail } from './errors';

export type ImportKind = 'csv' | 'clr';

export interface ImportedColumns {
  kind: ImportKind;
  names: string[];
  columns: Float32Array[];
  // Data range FlowJo gives the parameter: the largest value (truncated to an
  // integer) for CSV, 10000 for CLR.
  range: number;
  // CLR only: every value was 0 or 1 (a hard cluster assignment).
  binary?: boolean;
}

// File kind from the extension (FlowCAPUtil: ".csv" -> importCsv, ".clr" ->
// importClr; anything else is not imported).
export function importKind(fileName: string): ImportKind | null {
  const f = fileName.toLowerCase();
  return f.endsWith('.csv') ? 'csv' : f.endsWith('.clr') ? 'clr' : null;
}

// Parameter base name (FlowCAPUtil.importExternalParameter): the file name
// without its 4-character extension; when it starts with the sample's file
// name (without ".fcs"), that prefix and the one separator character after it
// are removed ("Tube1_CD4.csv" on sample "Tube1.fcs" -> "CD4").
export function importBaseName(fileName: string, sampleFileName: string): string {
  let base = /\.(csv|clr)$/i.test(fileName) ? fileName.slice(0, -4) : fileName;
  const stem = sampleFileName.endsWith('.fcs') ? sampleFileName.slice(0, -4) : sampleFileName;
  if (stem && base.startsWith(stem)) base = base.slice(stem.length + 1);
  return base;
}

// A header field is any first-line field with a character other than a digit,
// '.' or '\r' (so a minus sign or exponent also marks a header).
const isHeaderField = (f: string) => [...f].some((c) => !(c >= '0' && c <= '9') && c !== '.' && c !== '\r');

// Parse the file. eventCount: the sample's $TOT. Throws when the number of data
// rows differs from the event count (FlowJo then adds no parameter).
export function parseParameterFile(text: string, kind: ImportKind, baseName: string, eventCount: number): ImportedColumns {
  const lines = text.split('\n');
  const first = lines[0] ?? '';
  // Delimiter: tab when the first line has one, else comma.
  const delim = first.includes('\t') ? '\t' : ',';
  const fields = first.split(delim);
  const header = fields.some(isHeaderField);
  const clean = (f: string) => {
    const t = f.replace(/^[ \t\r]+|[ \t\r]+$/g, '');
    return kind === 'csv' ? t.replace(/"/g, '') : t;
  };
  const n = fields.length;
  // Unnamed columns take the base name; with several columns FlowJo appends the
  // column index as a raw character (own rule: its 1-based number instead).
  const fallback = (i: number) => (n > 1 ? `${baseName}${i + 1}` : baseName);
  const names = fields.map((f, i) => {
    const t = header ? clean(f) : '';
    return t || fallback(i);
  });
  const columns = names.map(() => new Float32Array(eventCount));
  let row = 0;
  let binary = true;
  let max = -Infinity;
  for (let li = header ? 1 : 0; li < lines.length && row < eventCount; li++) {
    const line = lines[li];
    // The engine stops at the end of the file; a trailing empty line is not a row.
    if (li === lines.length - 1 && line.trim() === '') break;
    const parts = line.split(delim);
    if (parts.length > n) fail('IMPORT_INVALID', `Row ${row + 1} has ${parts.length} values; the file has ${n} columns`);
    for (let c = 0; c < parts.length; c++) {
      // istream >> double: leading blanks skipped, a non-number reads as 0.
      const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(parts[c]);
      let v = m ? Number(m[0]) : 0;
      if (kind === 'clr') {
        if (v !== 0 && v !== 1) binary = false;
        if (v === 0) v = 0.001;
        v *= 9800;
      }
      columns[c][row] = v;
      if (Math.fround(v) > max) max = Math.fround(v);
    }
    row++;
  }
  if (row !== eventCount) fail('IMPORT_INVALID', `The file has ${row} data rows but the sample has ${eventCount} events`);
  return { kind, names, columns, range: kind === 'clr' ? 10000 : Math.max(1, Math.trunc(max)), ...(kind === 'clr' ? { binary } : {}) };
}

// Values are stored in the workspace as base64 little-endian float32.
export function encodeColumn(v: Float32Array): string {
  const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodeColumn(s: string): Float32Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new Float32Array(b.buffer, 0, b.length >> 2);
}
