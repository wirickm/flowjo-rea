// Minimal single-page PDF embedding one JPEG image, scaled to fit US Letter
// with a margin. No dependencies; enough for "export this layout as PDF".
// Not a general PDF writer.

function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}

// jpeg: raw JPEG bytes (DCTDecode). widthPx/heightPx are the image pixels.
export function jpegToPdf(jpeg: Uint8Array, widthPx: number, heightPx: number): Uint8Array {
  const PAGE_W = 612; // US Letter at 72 dpi
  const PAGE_H = 792;
  const margin = 24;
  const avail = { w: PAGE_W - 2 * margin, h: PAGE_H - 2 * margin };
  const scale = Math.min(avail.w / widthPx, avail.h / heightPx, 1);
  const w = widthPx * scale;
  const h = heightPx * scale;
  const x = (PAGE_W - w) / 2;
  const y = (PAGE_H - h) / 2;

  const chunks: number[][] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (bytes: number[]) => {
    offsets.push(pos);
    chunks.push(bytes);
    pos += bytes.length;
  };
  const obj = (n: number, body: string) => push(ascii(`${n} 0 obj\n${body}\nendobj\n`));

  push(ascii('%PDF-1.4\n%\xff\xff\xff\xff\n'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  // Image XObject: header + raw JPEG bytes + trailer.
  const imgHeader = ascii(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  const imgTrailer = ascii('\nendstream\nendobj\n');
  offsets.push(pos);
  const imgBytes = [...imgHeader, ...jpeg, ...imgTrailer];
  chunks.push(imgBytes);
  pos += imgBytes.length;
  const content = `q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}endstream`);

  const xrefPos = pos;
  const n = 6;
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
  // offsets[0] is the file header; object i starts at offsets[i].
  for (let i = 1; i < n; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  push(ascii(xref));

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Convert a canvas to a one-page PDF (JPEG at the given quality).
export async function canvasToPdf(canvas: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('JPEG encoding failed');
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  return jpegToPdf(jpeg, canvas.width, canvas.height);
}

// Several pages, each one JPEG drawn at (margin, margin) with the given size in
// points on a pageW x pageH page (layout export, specs 21.1: the page is the
// paper, the image fills the area inside the 1 inch margins).
export function jpegsToPdf(pages: { jpeg: Uint8Array; widthPx: number; heightPx: number }[], pageW: number, pageH: number, margin: number): Uint8Array {
  const chunks: number[][] = [];
  const offsets: number[] = [0];
  let pos = 0;
  const push = (bytes: number[], isObj = true) => { if (isObj) offsets.push(pos); chunks.push(bytes); pos += bytes.length; };
  push(ascii('%PDF-1.4\n%\xff\xff\xff\xff\n'), false);
  const n = pages.length;
  // Objects: 1 catalog, 2 pages, then per page: page, image, contents.
  push(ascii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  push(ascii(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`));
  pages.forEach((pg, i) => {
    const pn = 3 + i * 3, im = pn + 1, ct = pn + 2;
    push(ascii(`${pn} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${ct} 0 R >>\nendobj\n`));
    push([...ascii(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.widthPx} /Height ${pg.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`), ...pg.jpeg, ...ascii('\nendstream\nendobj\n')]);
    const w = pageW - 2 * margin, h = pageH - 2 * margin;
    const content = `q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${margin.toFixed(2)} ${margin.toFixed(2)} cm\n/Im${i} Do\nQ\n`;
    push(ascii(`${ct} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`));
  });
  const size = 3 + n * 3;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  const xrefPos = pos;
  xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  push(ascii(xref), false);
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function canvasesToPdf(canvases: HTMLCanvasElement[], pageW: number, pageH: number, margin: number, quality = 0.92): Promise<Uint8Array> {
  const pages = [];
  for (const cv of canvases) {
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('JPEG encoding failed');
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), widthPx: cv.width, heightPx: cv.height });
  }
  return jpegsToPdf(pages, pageW, pageH, margin);
}
