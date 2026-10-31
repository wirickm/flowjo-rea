// Minimal PDF writer: a real JPEG embeds into a structurally valid single-page
// PDF with the right object offsets.
import { describe, expect, it } from 'vitest';
import { jpegToPdf } from '../src/ui/pdf';

// Smallest valid JPEG (1x1) as base64.
const JPEG_1x1 = Uint8Array.from(
  atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q=='),
  (c) => c.charCodeAt(0),
);

describe('minimal PDF export', () => {
  it('produces a valid single-page PDF around a JPEG', () => {
    const pdf = jpegToPdf(JPEG_1x1, 920, 442);
    const head = String.fromCharCode(...pdf.subarray(0, 8));
    const tail = String.fromCharCode(...pdf.subarray(pdf.length - 6));
    expect(head).toBe('%PDF-1.4');
    expect(tail).toBe('%%EOF\n');
    const text = String.fromCharCode(...pdf);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/MediaBox [0 0 612 792]');
    // startxref points at the xref table
    const m = /startxref\n(\d+)\n%%EOF/.exec(text)!;
    const xrefAt = Number(m[1]);
    expect(String.fromCharCode(...pdf.subarray(xrefAt, xrefAt + 4))).toBe('xref');
    // the embedded JPEG bytes appear verbatim
    const streamStart = text.indexOf('stream\n', text.indexOf('DCTDecode')) + 7;
    expect([...pdf.subarray(streamStart, streamStart + 3)]).toEqual([0xff, 0xd8, 0xff]);
    // every xref offset points at the start of "<n> 0 obj"
    const rows = text.slice(xrefAt).split("\n").slice(3, 8);
    rows.forEach((row, i) => {
      const off = Number(row.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length), `object ${i + 1} offset`).toBe(`${i + 1} 0 obj`);
    });
  });
});
