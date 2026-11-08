// FlowJo 10.6.2 file mask gates (FileMaskGate, made by the script API's
// gating.fileMask; docs/validation/ui-gaps/workspace.md O2). The native engine
// (MaskGate::FileMaskToBoolsMask) reads the file as text: the delimiter is a
// tab when the first line has one, else a comma; cells are trimmed of blanks,
// tabs and CR. A cell made only of digits and "." is a value, any other cell a
// column name (a header row). Each row with a value is the next event, in file
// order; a value above 0 marks that event. The gate uses the first column;
// events after the last row are outside.

export function parseFileMask(text: string, nEvents: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, nEvents));
  const lines = text.split('\n');
  const delim = lines[0]?.includes('\t') ? '\t' : ',';
  let row = 0;
  for (const line of lines) {
    if (row >= out.length) break;
    const cells = line.split(delim).map((c) => c.replace(/^[ \t\r]+|[ \t\r]+$/g, ''));
    const isValue = (c: string) => /^[0-9.]*$/.test(c);
    if (!line.replace(/\r$/, '').length || !cells.some((c) => c.length && isValue(c))) continue;
    const first = cells[0];
    if (isValue(first) && parseFloat(first) > 0) out[row] = 1;
    row++;
  }
  return out;
}

// Base64 of the mask, bit i (least significant first) = event i.
export function maskToBits(mask: ArrayLike<number>): string {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function maskFromBits(bits: string, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = '';
  try { s = atob(bits); } catch { return out; }
  for (let i = 0; i < n; i++) {
    const b = i >> 3;
    if (b < s.length && (s.charCodeAt(b) >> (i & 7)) & 1) out[i] = 1;
  }
  return out;
}

export const maskCount = (bits: string, n: number) => maskFromBits(bits, n).reduce((a, b) => a + b, 0);
