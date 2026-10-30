// FCS 3.1 writer: float32 little-endian list mode. Used for gated-event export.
export interface WriteChannel {
  name: string;
  label?: string;
  range: number;
  values: Float64Array;
}

export function writeFcs(channels: WriteChannel[], extraKeywords: Record<string, string> = {}): Uint8Array {
  const tot = channels[0]?.values.length ?? 0;
  const par = channels.length;
  const dataLen = tot * par * 4;
  const delim = '|';
  const escape = (s: string) => s.replace(/\|/g, '||');
  const build = (beginData: number, endData: number) => {
    const kw: [string, string][] = [
      ['$BEGINANALYSIS', '0'], ['$ENDANALYSIS', '0'], ['$BEGINSTEXT', '0'], ['$ENDSTEXT', '0'],
      ['$BEGINDATA', String(beginData)], ['$ENDDATA', String(endData)],
      ['$BYTEORD', '1,2,3,4'], ['$DATATYPE', 'F'], ['$MODE', 'L'], ['$NEXTDATA', '0'],
      ['$PAR', String(par)], ['$TOT', String(tot)],
    ];
    channels.forEach((c, i) => {
      const n = i + 1;
      kw.push([`$P${n}N`, c.name], [`$P${n}B`, '32'], [`$P${n}E`, '0,0'], [`$P${n}R`, String(Math.max(1, Math.ceil(c.range)))]);
      if (c.label) kw.push([`$P${n}S`, c.label]);
    });
    for (const [k, v] of Object.entries(extraKeywords)) if (v !== '') kw.push([k, v]);
    return delim + kw.map(([k, v]) => `${escape(k)}${delim}${escape(v)}`).join(delim) + delim;
  };
  const textStart = 58;
  // Offsets change TEXT length; iterate until stable.
  let text = build(0, 0);
  for (let i = 0; i < 5; i++) {
    const bytes = new TextEncoder().encode(text).length;
    const begin = textStart + bytes;
    const next = build(begin, begin + dataLen - 1);
    if (next === text) break;
    text = next;
  }
  const textBytes = new TextEncoder().encode(text);
  const beginData = textStart + textBytes.length;
  const pad = (n: number) => {
    const s = String(n);
    return s.length > 8 ? '       0' : s.padStart(8, ' ');
  };
  const header = `FCS3.1    ${pad(textStart)}${pad(beginData - 1)}${pad(beginData)}${pad(beginData + dataLen - 1)}${pad(0)}${pad(0)}`;
  const out = new Uint8Array(beginData + dataLen);
  out.set(new TextEncoder().encode(header), 0);
  out.set(textBytes, textStart);
  const dv = new DataView(out.buffer, beginData, dataLen);
  for (let e = 0; e < tot; e++) for (let c = 0; c < par; c++) dv.setFloat32((e * par + c) * 4, channels[c].values[e], true);
  return out;
}
