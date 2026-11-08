// Batch output targets of the layout editor (Batch$BatchDestination: Layout,
// Printer, Web, Web movie, PowerPoint, PDF; Batch.doInBackground, outputWeb,
// outputWebMovie, outputPowerpoint; WebPageCreator, HtmlMovieCreator,
// PowerPointCreator). Rules decoded with javap and written here independently;
// docs/validation/ui-gaps/layout.md section 6.5.
import type { LayoutItem, SavedLayout, Workspace } from './model';
import { uniqueName } from './layoutArrange';
import { currentLayout, layoutNames } from './layoutFigures';
import { writeZip } from './zip';

export type BatchTarget = 'pdf' | 'png' | 'svg' | 'layout' | 'web' | 'webmovie' | 'pptx';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// Layout destination (Batch.doInBackground with isLayout): a new layout named
// after the batch (LEditor.uniqueTemplateName), marked as a batch, with the
// template's print layout, the tile list as its figures, iteration off and the
// template's iteration group; it becomes the current layout. The previous
// current layout joins the other layouts.
export function batchLayoutPatch(ws: Workspace, batchName: string, items: LayoutItem[]): Partial<Workspace> {
  const cur = currentLayout(ws);
  const next: SavedLayout = { name: uniqueName(batchName, layoutNames(ws)), layout: items, ...(ws.layoutPage ? { layoutPage: ws.layoutPage } : {}), layoutIteration: { type: 'OFF' }, ...(ws.layoutGroup ? { layoutGroup: ws.layoutGroup } : {}) };
  return { layoutName: next.name, layout: next.layout, layoutPage: next.layoutPage, layoutIteration: next.layoutIteration, layoutGuides: undefined, layoutGrids: undefined, layoutGroup: next.layoutGroup, otherLayouts: [...(ws.otherLayouts ?? []), cur] };
}

// Web destination (WebPageCreator): <title> and <h2> with the batch name, a
// rule, then one image per tile named "<index>.<sample name>" with / \ :
// replaced by _, then a footer table "This page was created by FlowJo, version
// <v><BR><date>" (date pattern EEE, MMM dd, yyyy, hh:mm:ss a). Own rule: one
// HTML file with the images inline (data: URLs) instead of an index file and a
// FlowJo_Web_files folder; the footer names this app and has no remote logo.
export const webImageName = (index: number, sampleName: string) => `${index}.${sampleName.replace(/[/\\:]/g, '_')}`;
export function webPageHtml(title: string, images: { name: string; src: string }[], version: string, date: Date): string {
  const d = date.toLocaleString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  return `<html>\n<head><meta charset="utf-8"></head>\n<title>\n${esc(title)}</title>\n<body><p>\n<h2>${esc(title)}</h2>\n<hr><p>\n`
    + images.map((im) => `<IMG src="${im.src}" alt="${esc(im.name)}" title="${esc(im.name)}" BORDER=0 ALIGN=bottom>\n`).join('')
    + `<p></p>\n<P><TABLE BORDER=1>\n<TR>\n<TD>\n<P>This page was created by ${esc(version)}<BR>${esc(d)}</TD></TR>\n</TABLE></P>\n</body>\n</html>`;
}

// PowerPoint destination (PowerPointCreator): a presentation with one slide
// per tile (blank slide layout), each a picture at (0, 0) sized
// w x s, h x s EMU with s = (int) min(9000000 / w, 6750000 / h) (w, h the
// tile's size in points), on FlowJo's 10 x 7.5 in template. FlowJo copies a
// template .pptx and embeds WMF pictures; own rule: a minimal package written
// here with PNG pictures (no vector format in the browser).
export const pptxScale = (w: number, h: number) => Math.trunc(Math.min(9000000 / Math.max(1, w), 6750000 / Math.max(1, h)));
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (list: [string, string, string][]) => `${HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, t, target]) => `<Relationship Id="${id}" Type="${REL}/${t}" Target="${target}"/>`).join('')}</Relationships>`;
const EMPTY_TREE = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
const THEME = `${HDR}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office">`
  + [['dk1', '000000'], ['lt1', 'FFFFFF'], ['dk2', '1F497D'], ['lt2', 'EEECE1'], ['accent1', '4F81BD'], ['accent2', 'C0504D'], ['accent3', '9BBB59'], ['accent4', '8064A2'], ['accent5', '4BACC6'], ['accent6', 'F79646'], ['hlink', '0000FF'], ['folHlink', '800080']].map(([n, c]) => `<a:${n}><a:srgbClr val="${c}"/></a:${n}>`).join('')
  + '</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + '<a:fmtScheme name="Office"><a:fillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:fillStyleLst><a:lnStyleLst>' + '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3)
  + '</a:lnStyleLst><a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst><a:bgFillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
export function pptxFromImages(slides: { png: Uint8Array; w: number; h: number }[]): Uint8Array {
  const files: { name: string; data: Uint8Array | string }[] = [
    { name: '[Content_Types].xml', data: `${HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>`
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      + slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
    { name: 'ppt/presentation.xml', data: `${HDR}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`] as [string, string, string])]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `${HDR}<p:sldMaster ${NS}>${EMPTY_TREE}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `${HDR}<p:sldLayout ${NS} type="blank" preserve="1">${EMPTY_TREE.replace('<p:cSld>', '<p:cSld name="Blank">')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: THEME },
  ];
  slides.forEach((sl, i) => {
    const s = pptxScale(sl.w, sl.h), cx = Math.round(sl.w * s), cy = Math.round(sl.h * s);
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: `${HDR}<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture${i + 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>` });
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', `../media/image${i + 1}.png`]]) });
    files.push({ name: `ppt/media/image${i + 1}.png`, data: sl.png });
  });
  return writeZip(files);
}
