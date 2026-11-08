// FlowJo 10.6.2 "Annotate Experiment..." (WSCommand.MIFlowCyt / MIFLOW,
// PlatformNavCommand MIFLOWCYT; MIFlowCytDialog, MIFlowCytElement,
// com.treestar.flowjo.core.fcs.MIFLOW; spec docs/validation/ui-gaps/
// workspace.md). The annotation is the workspace's <experiment> element:
// the Overview fields are direct children of <experiment>, then <specimen>,
// <instrument>, <analysis> and <figures> sections, each field an element
// holding its text.
import { attr, esc, kid, kids, text, type El } from './xml';

export interface MiFigure { id: string; mimetype: string; description: string }
export interface Experiment {
  fields: Record<string, string>; // overview element name -> text
  specimen: Record<string, string>;
  instrument: Record<string, string>;
  analysis: Record<string, string>;
  figures: MiFigure[];
}
// [element name, dialog label] in MIFlowCytDialog panel order.
export const OVERVIEW_FIELDS: [string, string][] = [
  ['id', 'ID'], ['name', 'Experiment'], ['project', 'Project'], ['created', 'Date'], ['date_end', 'to'],
  ['primary_researcher', 'Researcher'], ['primary_investigator', 'Lab'], ['organization', 'Organization'], ['keywords', 'Keywords'],
  ['purpose', 'Purpose'], ['conclusion', 'Conclusion'], ['quality_control_measures', 'Quality Control'], ['comments', 'Comments'],
];
export const SPECIMEN_FIELDS: [string, string][] = [
  ['description', 'Sample Description'], ['source', 'Source'], ['organism', 'Organism'], ['age', 'Age'], ['gender', 'Gender'],
  ['phenotype', 'Phenotype'], ['genotype', 'Genotype'], ['characteristics', 'Characteristics'], ['treatment_long', 'Treatment Description'],
];
// compensation: shown and read by FlowJo's panel but not written by its
// extract(); flowjo-rea writes it too (own rule, so the text is not lost).
export const INSTRUMENT_FIELDS: [string, string][] = [['model', 'Model'], ['vendor', 'Manufacturer'], ['location', 'Location'], ['flow_cell', 'Flow cell'], ['panel', 'Panel'], ['compensation', 'Compensation']];
export const ANALYSIS_FIELDS: [string, string][] = [['protocol', 'Protocol'], ['gating', 'Gating'], ['groups', 'Grouping']];
// Multi-line (text area) fields.
export const LONG_FIELDS = new Set(['purpose', 'conclusion', 'quality_control_measures', 'comments', 'description', 'characteristics', 'treatment_long', 'panel', 'compensation', 'gating', 'groups']);

// FCSTimeDateUtil.getCurrentDateString (dd-MMM-yyyy as in $DATE).
export function currentDate(d = new Date()): string {
  return `${String(d.getDate()).padStart(2, '0')}-${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()]}-${d.getFullYear()}`;
}
// A new annotation (MIFlowCytOverviewPanel: both dates today;
// MIFlowCytAnalysisPanel: protocol "FlowJo <version>  (FlowJo, LLC, Ashland OR)").
export function newExperiment(d = new Date()): Experiment {
  return { fields: { created: currentDate(d), date_end: currentDate(d) }, specimen: {}, instrument: {}, analysis: { protocol: 'FlowJo v10  (FlowJo, LLC, Ashland OR)' }, figures: [] };
}
export const isEmptyExperiment = (e: Experiment) => ![e.fields, e.specimen, e.instrument, e.analysis].some((r) => Object.values(r).some((v) => v)) && !e.figures.length;

const read = (e: El | undefined, list: [string, string][]) => {
  const out: Record<string, string> = {};
  if (e) for (const [k] of list) { const c = kid(e, k); if (c) out[k] = text(c); }
  return out;
};
export function readExperiment(e: El): Experiment {
  const figs = kid(e, 'figures');
  return {
    fields: read(e, OVERVIEW_FIELDS), specimen: read(kid(e, 'specimen'), SPECIMEN_FIELDS), instrument: read(kid(e, 'instrument'), INSTRUMENT_FIELDS), analysis: read(kid(e, 'analysis'), ANALYSIS_FIELDS),
    figures: figs ? kids(figs, 'figure').map((f) => ({ id: attr(f, 'id') ?? '', mimetype: attr(f, 'mimetype') ?? '', description: attr(f, 'description') ?? '' })) : [],
  };
}
const elems = (r: Record<string, string>, list: [string, string][]) => list.map(([k]) => `<${k}>${esc(r[k] ?? '')}</${k}>`).join('');
// MIFlowCytTTPane.extract order: overview fields, specimen, instrument,
// analysis, figures.
export function experimentXml(e: Experiment): string {
  return `<experiment>${elems(e.fields, OVERVIEW_FIELDS)}<specimen>${elems(e.specimen, SPECIMEN_FIELDS)}</specimen><instrument>${elems(e.instrument, INSTRUMENT_FIELDS)}</instrument><analysis>${elems(e.analysis, ANALYSIS_FIELDS)}</analysis><figures>${e.figures.map((f) => `<figure id="${esc(f.id)}" mimetype="${esc(f.mimetype)}" description="${esc(f.description)}" />`).join('')}</figures></experiment>`;
}
// MIFlowCytElement.toHTML (Print): one table per section.
export function experimentHtml(e: Experiment): string {
  const sec = (title: string, r: Record<string, string>, list: [string, string][]) => `<h3>${title}</h3><table border="1" cellspacing="0" cellpadding="3">${list.map(([k, l]) => `<tr><th align="left">${esc(l)}</th><td>${esc(r[k] ?? '').replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`;
  return `<html><body>${sec('Overview', e.fields, OVERVIEW_FIELDS)}${sec('Specimen', e.specimen, SPECIMEN_FIELDS)}${sec('Instrument', e.instrument, INSTRUMENT_FIELDS)}${sec('Analysis', e.analysis, ANALYSIS_FIELDS)}<h3>Figures</h3><table border="1" cellspacing="0" cellpadding="3">${e.figures.map((f) => `<tr><td>${esc(f.id)}</td><td>${esc(f.mimetype)}</td><td>${esc(f.description)}</td></tr>`).join('')}</table></body></html>`;
}

// Save As Figure / Batch to Figure (FJTableCommand.SAVE_FIGURE,
// TECommand.BATCHTOFIGURE; docs/validation/ui-gaps/tables.md): a table stored
// as an experiment figure the way FigureSpec(TableData, name, description)
// builds one: the next figure number as id, mimetype "text/table", the given
// description (own rule: the table data itself is not embedded).
export function addTableFigure(e: Experiment | undefined, description: string): Experiment {
  const base = e ?? newExperiment();
  const next = 1 + Math.max(0, ...base.figures.map((f) => Number(f.id)).filter((n) => Number.isFinite(n)));
  return { ...base, figures: [...base.figures, { id: String(next), mimetype: 'text/table', description }] };
}
