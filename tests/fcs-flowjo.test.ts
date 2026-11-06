// FlowJo 10.6.2 FCS reading (specs section 13): FCSUtil::ReadFCSHeader,
// InitReadingFields / CreateDataReader, FCSPackedDataReader, Cytek 3-byte
// reader, $PnR mask.
import { describe, expect, it } from 'vitest';
import { parseFcs } from '../src/core/fcs';

// Minimal FCS writer for integer layouts (TEXT at 58, DATA right after).
function fcs(version: string, kw: Record<string, string>, data: number[]): Uint8Array {
  const body = Uint8Array.from(data);
  const textFor = (b: number, e: number) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
  let text = textFor(0, 0);
  for (let i = 0; i < 3; i++) { const b = 58 + text.length; text = textFor(b, b + body.length - 1); }
  const b = 58 + text.length;
  const pad = (v: number) => String(v).padStart(8, ' ');
  const head = `${version}    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + body.length - 1)}${pad(0)}${pad(0)}`;
  const out = new Uint8Array(b + body.length);
  out.set(new TextEncoder().encode(head + text), 0);
  out.set(body, b);
  return out;
}
const base = (par: number, bits: number[], extra: Record<string, string> = {}) => {
  const kw: Record<string, string> = { $BYTEORD: '1,2,3,4', $DATATYPE: 'I', $MODE: 'L', $PAR: String(par), $NEXTDATA: '0', ...extra };
  bits.forEach((b, i) => Object.assign(kw, { [`$P${i + 1}N`]: `P${i + 1}`, [`$P${i + 1}B`]: String(b), [`$P${i + 1}R`]: String(2 ** b), [`$P${i + 1}E`]: '0,0' }));
  return kw;
};

describe('FlowJo 10.6.2 FCS reading', () => {
  it('accepts FCS 3.2 (per-parameter $PnDATATYPE ignored)', () => {
    const f = parseFcs(fcs('FCS3.2', { ...base(1, [16]), $TOT: '2', $P1DATATYPE: 'F' }, [1, 0, 2, 0]));
    expect(f.version).toBe('FCS3.2');
    expect(Array.from(f.data[0])).toEqual([1, 2]);
  });
  it('packed 10-bit values: one bit stream, bytes least significant bit first', () => {
    // Two 10-bit values 0x155 and 0x2AA packed into 20 bits (3 bytes).
    const v = 0x155 | (0x2aa << 10);
    const f = parseFcs(fcs('FCS3.0', { ...base(2, [10, 10]), $TOT: '1' }, [v & 255, (v >> 8) & 255, (v >> 16) & 255]));
    expect([f.data[0][0], f.data[1][0]]).toEqual([0x155, 0x2aa]);
  });
  it('24-bit values (3 bytes), little-endian', () => {
    const f = parseFcs(fcs('FCS3.1', { ...base(1, [24]), $TOT: '1' }, [0x01, 0x02, 0x03]));
    expect(f.data[0][0]).toBe(0x030201);
  });
  it('mixed 8 / 16 / 32-bit widths read byte-aligned', () => {
    const f = parseFcs(fcs('FCS3.1', { ...base(3, [8, 16, 32]), $TOT: '1' }, [7, 0x34, 0x12, 1, 0, 0, 0]));
    expect([f.data[0][0], f.data[1][0], f.data[2][0]]).toEqual([7, 0x1234, 1]);
  });
  it('unhandled widths are refused with FlowJo\'s message; $TOT missing is computed from the DATA length', () => {
    expect(() => parseFcs(fcs('FCS3.1', { ...base(1, [20]), $TOT: '1' }, [0, 0, 0]))).toThrow(/unhandled data width/);
    const kw = base(1, [16]);
    expect(parseFcs(fcs('FCS3.1', kw, [1, 0, 2, 0, 3, 0])).eventCount).toBe(3);
  });
  it('encrypted data is refused', () => {
    expect(() => parseFcs(fcs('FCS3.1', { ...base(1, [16]), $TOT: '1', $ENCRYPT: 'AES' }, [1, 0]))).toThrow(/Encrypted/);
  });
});
