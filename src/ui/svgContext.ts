// Records the subset of CanvasRenderingContext2D used by renderPlot and
// emits SVG: axes, text, gates, contours, dots and histograms become vector
// elements; the pseudocolor density raster is embedded as an <image>.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

let clipSeq = 0;

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  transform: string;
  openGroups: number;
}

export class SvgContext {
  private out: string[] = [];
  private path = '';
  private stack: State[] = [];
  private st: State = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', textAlign: 'start', transform: '', openGroups: 0 };
  private dash: number[] = [];

  constructor(readonly width: number, readonly height: number) {}

  get fillStyle() { return this.st.fillStyle; }
  set fillStyle(v: string) { this.st.fillStyle = v; }
  get strokeStyle() { return this.st.strokeStyle; }
  set strokeStyle(v: string) { this.st.strokeStyle = v; }
  get lineWidth() { return this.st.lineWidth; }
  set lineWidth(v: number) { this.st.lineWidth = v; }
  get font() { return this.st.font; }
  set font(v: string) { this.st.font = v; }
  get textAlign() { return this.st.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.st.textAlign = v; }

  private tf() { return this.st.transform ? ` transform="${this.st.transform}"` : ''; }
  private fontSize() { return parseFloat(/(\d+(\.\d+)?)px/.exec(this.st.font)?.[1] ?? '10'); }

  save() { this.stack.push({ ...this.st, openGroups: 0 }); this.st.openGroups = 0; }
  restore() {
    for (let i = 0; i < this.st.openGroups; i++) this.out.push('</g>');
    const prev = this.stack.pop();
    if (prev) this.st = prev;
  }
  translate(x: number, y: number) { this.st.transform += ` translate(${n(x)} ${n(y)})`; }
  rotate(a: number) { this.st.transform += ` rotate(${n((a * 180) / Math.PI)})`; }
  setLineDash(d: number[]) { this.dash = d; }

  beginPath() { this.path = ''; }
  moveTo(x: number, y: number) { this.path += `M${n(x)} ${n(y)}`; }
  lineTo(x: number, y: number) { this.path += `L${n(x)} ${n(y)}`; }
  closePath() { this.path += 'Z'; }
  rect(x: number, y: number, w: number, h: number) { this.path += `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`; }
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    this.path += `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0`;
  }
  stroke() {
    if (!this.path) return;
    const dash = this.dash.length ? ` stroke-dasharray="${this.dash.join(' ')}"` : '';
    this.out.push(`<path d="${this.path}" fill="none" stroke="${esc(this.st.strokeStyle)}" stroke-width="${n(this.st.lineWidth)}"${dash}${this.tf()}/>`);
  }
  fill() {
    if (this.path) this.out.push(`<path d="${this.path}" fill="${esc(this.st.fillStyle)}"${this.tf()}/>`);
  }
  clip() {
    const id = `clip${++clipSeq}`; // unique across embedded plots
    this.out.push(`<clipPath id="${id}"><path d="${this.path}"/></clipPath><g clip-path="url(#${id})">`);
    this.st.openGroups++;
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${esc(this.st.fillStyle)}"${this.tf()}/>`);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${esc(this.st.strokeStyle)}" stroke-width="${n(this.st.lineWidth)}"${this.tf()}/>`);
  }
  measureText(t: string) { return { width: t.length * this.fontSize() * 0.55 } as TextMetrics; }
  fillText(t: string, x: number, y: number) {
    const anchor = this.st.textAlign === 'center' ? 'middle' : this.st.textAlign === 'right' || this.st.textAlign === 'end' ? 'end' : 'start';
    this.out.push(`<text x="${n(x)}" y="${n(y)}" font-family="sans-serif" font-size="${n(this.fontSize())}" fill="${esc(this.st.fillStyle)}" text-anchor="${anchor}"${this.tf()}>${esc(t)}</text>`);
  }
  // Real ImageData in browsers (it is passed to a canvas putImageData);
  // a plain object elsewhere (tests).
  createImageData(w: number, h: number) {
    if (typeof ImageData !== 'undefined') return new ImageData(w, h);
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' } as ImageData;
  }
  drawImage(img: { toDataURL?: () => string; width: number; height: number }, x: number, y: number) {
    if (img.toDataURL) this.out.push(`<image x="${n(x)}" y="${n(y)}" width="${img.width}" height="${img.height}" href="${img.toDataURL()}"${this.tf()}/>`);
  }

  // Place another SVG document's content at (x, y), for composing layouts.
  embed(svgBody: string, x: number, y: number) {
    this.out.push(`<g transform="translate(${n(x)} ${n(y)})">${svgBody}</g>`);
  }

  body() { return this.out.join('\n'); }

  toString() {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">\n<rect width="100%" height="100%" fill="#fff"/>\n${this.body()}\n</svg>\n`;
  }
}

export const asCanvas = (c: SvgContext) => c as unknown as CanvasRenderingContext2D;
