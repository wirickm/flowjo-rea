import { describe, expect, it } from 'vitest';
import { autoPageScale, handleAt, invertSelection, pasteOffset, resizeBox, scaledPage, sortNames, uniqueName, zoomFit, zoomIn, zoomOut, type Box } from '../src/core/layoutArrange';
import { addLayout, annoToken, arrowHead, deleteLayout, duplicateLayout, headerText, keywordToken, layoutNames, lineFromPoints, liveText, renameLayout, selectLayout, snapLineAngle, styleOf } from '../src/core/layoutFigures';
import { emptyWorkspace, type LayoutItem, type Workspace } from '../src/core/model';
import { parseFigList, writeFigList } from '../src/core/wspLayout';
import { parseXml } from '../src/core/xml';
import { parseWsp } from '../src/core/wsp';
import { writeWsp } from '../src/core/wspWriter';

const b = (x: number, y: number, w: number, h: number, id = 'a'): Box => ({ id, x, y, w, h });

describe('resize handles (Fig.pointToHandleIndex, ResizeDrag, FigEditable.doResize)', () => {
  const box = b(100, 100, 200, 100);
  it('corner handles within 6 pt; edge midpoints and the inside move; outside is -1', () => {
    expect([handleAt(box, { x: 100, y: 100 }), handleAt(box, { x: 305, y: 95 }), handleAt(box, { x: 98, y: 203 }), handleAt(box, { x: 300, y: 200 })]).toEqual([1, 3, 7, 9]);
    expect(handleAt(box, { x: 200, y: 100 })).toBe(5);
    expect(handleAt(box, { x: 150, y: 150 })).toBe(5);
    expect(handleAt(box, { x: 90, y: 150 })).toBe(-1);
  });
  it('the opposite corner stays; at least 4 pt', () => {
    expect(resizeBox(box, 9, { x: 350, y: 260 })).toMatchObject({ x: 100, y: 100, w: 250, h: 160 });
    expect(resizeBox(box, 1, { x: 150, y: 120 })).toMatchObject({ x: 150, y: 120, w: 150, h: 80 });
    expect(resizeBox(box, 9, { x: 101, y: 101 })).toMatchObject({ w: 4, h: 4 });
    // dragging past the anchor flips the box
    expect(resizeBox(box, 9, { x: 50, y: 50 })).toMatchObject({ x: 50, y: 50, w: 50, h: 50 });
  });
  it('Shift keeps the aspect ratio (closest point on the diagonal)', () => {
    const r = resizeBox(box, 9, { x: 500, y: 120 }, true);
    expect(r.w / r.h).toBeCloseTo(2, 1);
    expect(r.x).toBe(100);
  });
});

describe('zoom and page scaling (EditorZoom, LayoutEditor.setAutoPageScale)', () => {
  it('zoom steps 12..400 %', () => {
    expect([zoomIn(1), zoomIn(4), zoomOut(1), zoomOut(0.12), zoomIn(0.8)]).toEqual([1.5, 4, 0.75, 0.12, 1.5]);
  });
  it('Fit to Window takes the step below the fitting ratio', () => {
    expect(zoomFit({ w: 800, h: 600 }, { w: 1000, h: 500 })).toBe(0.75);
    expect(zoomFit({ w: 1000, h: 1000 }, { w: 500, h: 500 })).toBe(1.5);
  });
  it('Scale To Width / Height / Page: extent over page; small layouts stay 1', () => {
    const page = { w: 468, h: 648 };
    const boxes = [b(0, 0, 936, 324)];
    expect(autoPageScale(boxes, page, 'width')).toBe(2);
    expect(autoPageScale(boxes, page, 'height')).toBe(0.5);
    expect(autoPageScale(boxes, page, 'page')).toBe(2);
    expect(autoPageScale([b(0, 0, 40, 40)], page, 'page')).toBe(1);
    expect(scaledPage({ paper: 'letter', orientation: 'portrait', scale: 2 })).toEqual({ w: 936, h: 1296 });
  });
});

describe('selection and clipboard (LESelectionAction, LEPasteAction)', () => {
  it('Invert Selection', () => expect(invertSelection(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']));
  it('Paste: +4 pt when the figures are in view, else moved into view first', () => {
    expect(pasteOffset({ x: 10, y: 10 }, b(0, 0, 500, 500))).toEqual({ dx: 4, dy: 4 });
    expect(pasteOffset({ x: 10, y: 10 }, b(300, 200, 500, 500))).toEqual({ dx: 294, dy: 194 });
  });
});

describe('the layout list (SExplorer, NameUtil.uniqueName)', () => {
  it('unique names drop a short numeric suffix and count from 1', () => {
    expect(uniqueName('Layout', ['Layout'])).toBe('Layout-1');
    expect(uniqueName('Layout', ['Layout', 'Layout-1'])).toBe('Layout-2');
    expect(uniqueName('Layout-1', ['Layout', 'Layout-1'])).toBe('Layout-2');
    expect(uniqueName('Fig', [])).toBe('Fig');
    expect(sortNames(['b', 'A', 'c'])).toEqual(['A', 'b', 'c']);
  });
  const apply = (ws: Workspace, patch: Partial<Workspace>) => Object.assign(ws, patch);
  it('Add, select, Duplicate, Rename and Delete keep figures with their layout', () => {
    const ws = emptyWorkspace();
    ws.layout = [{ id: 't', text: 'one' }];
    apply(ws, addLayout(ws));
    expect(ws.layoutName).toBe('Layout-1');
    expect(ws.layout).toBeUndefined();
    expect(layoutNames(ws)).toEqual(['Layout', 'Layout-1']);
    apply(ws, selectLayout(ws, 'Layout'));
    expect(ws.layout?.[0]).toMatchObject({ text: 'one' });
    apply(ws, duplicateLayout(ws));
    expect(ws.layoutName).toBe('Layout-2');
    expect(ws.layout?.[0]).toMatchObject({ text: 'one' });
    apply(ws, renameLayout(ws, 'Layout'));
    expect(ws.layoutName).toBe('Layout-2'); // taken: made unique
    apply(ws, renameLayout(ws, 'Alpha'));
    expect(layoutNames(ws)).toEqual(['Alpha', 'Layout', 'Layout-1']);
    apply(ws, deleteLayout(ws));
    expect(ws.layoutName).toBe('Layout');
    expect(layoutNames(ws)).toEqual(['Layout', 'Layout-1']);
  });
  it('deleting the only layout leaves an empty one', () => {
    const ws = emptyWorkspace();
    ws.layout = [{ id: 't', text: 'x' }];
    apply(ws, deleteLayout(ws));
    expect(ws.layout).toBeUndefined();
    expect(layoutNames(ws)).toEqual(['Layout']);
  });
});

describe('figures: styles, lines, live text, header / footer', () => {
  it('shapes default to a Normal black line; charts and text to no line', () => {
    expect(styleOf({ id: 's', shape: 'rect' })).toMatchObject({ weight: 'normal', line: '#000000' });
    expect(styleOf({ id: 't', text: '' })).toMatchObject({ weight: 'none' });
  });
  it('arrowheads are 18 pt triangles with the tip on the end point', () => {
    const t = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(t[0]).toEqual({ x: 100, y: 0 });
    expect(t[1].x).toBeCloseTo(82); expect(Math.abs(t[1].y)).toBeCloseTo(9);
  });
  it('lines snap to 22.5 degree steps with Shift and keep their direction', () => {
    expect(snapLineAngle({ x: 0, y: 0 }, { x: 100, y: 3 })).toEqual({ x: 100, y: 0 });
    expect(lineFromPoints({ x: 50, y: 10 }, { x: 10, y: 40 })).toEqual({ left: 10, top: 10, width: 40, height: 30, ends: [1, 0, 0, 1] });
  });
  it('Insert Keyword / Annotation fields show live values', () => {
    const t = `Sample ${keywordToken('$FIL')} on page ${annoToken('page')} (${annoToken('samplename')})`;
    expect(liveText(t, { keyword: (k) => (k === '$FIL' ? 'a.fcs' : undefined), page: 3, sampleName: 'A' })).toBe('Sample a.fcs on page 3 (A)');
  });
  it('header tags', () => {
    expect(headerText('<DocumentName/> - Page <PageNumber/> <Version/>', { document: 'Layout', page: 2, version: 'v' })).toBe('Layout - Page 2 v');
  });
});

describe('.wsp figures: shapes, images, text styles and live fields; several layouts', () => {
  const items: LayoutItem[] = [
    { id: 'r', shape: 'rect', left: 10, top: 20, width: 100, height: 50, style: { fill: '#ff0000', line: '#0000ff', weight: 'heavy', lineStyle: 'dashed', gradientType: 'vertical', gradient: '#00ff00' }, sizeLock: true },
    { id: 'l', shape: 'line', left: 10, top: 100, width: 80, height: 40, ends: [1, 0, 0, 1], arrow: 'double' },
    { id: 'e', shape: 'ellipse', left: 200, top: 20, width: 60, height: 60 },
    { id: 'i', image: 'https://example.org/x.png', left: 300, top: 20, width: 20, height: 10 },
    { id: 't', text: `n = ${keywordToken('$TOT')} ${annoToken('date')}`, left: 5, top: 300, width: 200, height: 40, font: 'Serif', size: 14, bold: true, italic: true, color: '#123456' },
  ];
  const xml = writeFigList(items, [], () => '1', (_s, c) => c);
  const back = parseFigList(parseXml(xml).documentElement, () => 's', (_s, n) => n);
  it('writes FlowJo shape elements with the common Fig attributes', () => {
    expect(xml).toContain('<Rectangle x="10"  y="20"  width="100"  height="50"  lineWeight="Heavy"  fill="#ff0000"  stroke="#0000ff"  lineStyle="Dashed"  gradientColor="#00ff00"  gradientStyle="le.gradientstyle.vertical"');
    expect(xml).toContain('sizeLock="1"');
    expect(xml).toContain('<Line x1="90"  y1="100"  x2="10"  y2="140"  arrow="Double-headed"');
    expect(xml).toContain('<Ellipse ');
    expect(xml).toContain('<Image ');
  });
  it('reads them back (size lock is not read, as in FlowJo 10.6.2)', () => {
    expect(back.warnings).toEqual([]);
    expect(back.items[0]).toMatchObject({ shape: 'rect', left: 10, top: 20, width: 100, height: 50, style: { fill: '#ff0000', line: '#0000ff', weight: 'heavy', lineStyle: 'dashed', gradientType: 'vertical', gradient: '#00ff00' } });
    expect(back.items[0].sizeLock).toBeUndefined();
    expect(back.items[1]).toMatchObject({ shape: 'line', left: 10, top: 100, width: 80, height: 40, ends: [1, 0, 0, 1], arrow: 'double' });
    expect(back.items[2]).toMatchObject({ shape: 'ellipse' });
    expect(back.items[3]).toMatchObject({ image: 'https://example.org/x.png', width: 20, height: 10 });
    expect(back.items[4]).toMatchObject({ text: 'n = {{keyword:$TOT}} {{anno:date}}', font: 'Serif', size: 14, bold: true, italic: true, color: '#123456' });
  });
  it('keeps every layout through .wsp export and import; old single-layout workspaces still load', () => {
    const ws = emptyWorkspace();
    ws.samples.push({ id: 's', fileName: 's.fcs', fileSize: 0, fingerprint: '', datasetIndex: 0, compensation: 'none', populations: [], keywordsSnapshot: {}, channelNames: ['FSC-A'], eventCount: 1 });
    ws.groups[0].sampleIds = ['s'];
    ws.layout = [{ id: 't1', text: 'first' }];
    Object.assign(ws, addLayout(ws));
    ws.layout = [{ id: 't2', text: 'second' }];
    ws.layoutPage = { paper: 'a4', orientation: 'landscape', scale: 1.5 };
    const { xml: wsp } = writeWsp({ ws, sampleMatrix: () => null });
    expect(wsp).toContain('<LayoutEditor current="Layout-1"');
    expect(wsp).toContain('scaling="1.5"');
    const r = parseWsp(wsp).workspace;
    expect(r.layoutName).toBe('Layout-1');
    expect(r.layout?.map((x) => x.text)).toEqual(['second']);
    expect(r.layoutPage).toEqual({ paper: 'a4', orientation: 'landscape', scale: 1.5 });
    expect(r.otherLayouts?.map((l) => [l.name, l.layout?.map((x) => x.text).join()])).toEqual([['Layout', 'first']]);
    // a workspace saved before several layouts: one layout array, named "Layout"
    const old = { ...emptyWorkspace(), layout: [{ id: 'x', text: 'old' }] } as Workspace;
    expect(layoutNames(old)).toEqual(['Layout']);
  });
});
