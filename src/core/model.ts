// Workspace state. Pure data (JSON-serialisable); event data lives outside.
import type { SpilloverMatrix } from './compensation';
import type { TransformSpec } from './transforms';

// A gate dimension: a channel name ($PnN) evaluated after the sample's
// compensation and the given transform. Gate coordinates are in transformed
// units. 'ratio' dimensions implement Gating-ML fratio. compensation: undefined =
// the sample's compensation, 'uncompensated', 'file', or a matrix id.
export type Dimension =
  | { kind: 'channel'; channel: string; transform: TransformSpec; compensation?: string }
  | { kind: 'ratio'; num: string; den: string; A: number; B: number; C: number; transform: TransformSpec; compensation?: string };

// One axis of a FlowJo gate grid, in gate (dimension) units: 'round' for
// linear axes, 'floor' for transformed axes; [min, max] spans the R cells.
// logicle: parameters of a logicle axis; gate vertices on such an axis are
// placed through FlowJo's single-precision logicle lookup table.
export interface GridAxis {
  mode: 'round' | 'floor';
  min: number;
  max: number;
  logicle?: { T: number; W: number; M: number; A: number };
}
export interface GateGrid {
  resolution: number;
  axes: [GridAxis, GridAxis];
}

export type Gate =
  // Each bound may be null (open). Membership: min <= x < max (Gating-ML 2.0).
  // percent: FlowJo percent gate (manual entry in Percentile units, specs
  // 10.6): bounds recomputed on each sample from the parent's smoothed
  // histogram; min/max hold the percentiles (null = not a percent bound) and
  // scales the FlowJo channel scale of each dimension.
  | { type: 'rect'; dims: Dimension[]; min: (number | null)[]; max: (number | null)[]; percent?: { min: (number | null)[]; max: (number | null)[]; scales: import('./flowjoStats').ChannelScale[] } }
  // grid: evaluate on FlowJo 10's gate grid (src/core/gateGrid.ts); absent =
  // exact point-in-polygon (Gating-ML semantics).
  | { type: 'polygon'; dims: [Dimension, Dimension]; vertices: [number, number][]; grid?: GateGrid }
  // (x-mean)^T inv(cov) (x-mean) <= distanceSquare
  // grid (2-D only): evaluate as FlowJo 10 does, on the outline polygon of the
  // ellipse whose axis endpoints are edges (gate units; derived from mean/cov
  // when absent). Without grid: exact (Gating-ML semantics).
  | { type: 'ellipsoid'; dims: Dimension[]; mean: number[]; cov: number[][]; distanceSquare: number; grid?: GateGrid; edges?: [number, number][] }
  // One quadrant of a split. side[i] = index of the interval of dims[i] split by
  // dividers[i] (sorted). Interval k is [dividers[k-1], dividers[k]).
  | { type: 'quadrant'; dims: Dimension[]; dividers: number[][]; side: number[] }
  // Curved quadrant: each divider is a monotone cubic spline through control
  // points. xDivider gives x as a function of y (points sorted by y); yDivider
  // gives y as a function of x (sorted by x). Outside the control points the
  // end value is held. side[0] = 0: x < divider, 1: x >= divider (same for y).
  | { type: 'splineQuadrant'; dims: [Dimension, Dimension]; xDivider: [number, number][]; yDivider: [number, number][]; side: [number, number] }
  // FlowJo 10 curly quad (specs 10.2): one quadrant (0 upper-left, 1
  // upper-right, 2 lower-left, 3 lower-right) of the parabola outline built on
  // a 256-pixel frame spanning frame[0] (x) and frame[1] (y) in gate units;
  // the four quadrants are gated together as a spider quad (gating:PolyQuad).
  | { type: 'curlyQuad'; dims: [Dimension, Dimension]; center: [number, number]; quadrant: number; frame: [[number, number], [number, number]]; grid?: GateGrid }
  // FlowJo 10 spider quad (gating:PolyQuad, specs 10.3): four abutting
  // polygons (gate units) in slot order 0 upper-left, 1 upper-right, 2
  // lower-left, 3 lower-right; this population is polygons[slot]. Each lattice
  // point belongs to the first polygon containing it; points in none count as
  // slot 0, as in FlowJo.
  | { type: 'spider'; dims: [Dimension, Dimension]; polygons: [number, number][][]; slot: number; grid?: GateGrid }
  // FlowJo anchored range (TetheredRangeGate, specs 10.6): a 1-D range whose
  // bounds are a live statistic times a multiplier; a missing bound is open.
  | { type: 'anchored'; dims: [Dimension]; min: AnchorBound | null; max: AnchorBound | null }
  | { type: 'boolean'; op: 'and' | 'or' | 'not'; operands: { ref: string; complement?: boolean }[] };

// A statistic of a population of the same sample (populationPath '' = all
// events) times a multiplier, in scale (data) units. scale: the FlowJo channel
// scale the statistic is computed on (snapshotted when the gate is made).
export interface AnchorBound {
  populationPath: string;
  stat: StatKind;
  channel?: string;
  percentile?: number;
  multiplier: number;
  scale?: import('./flowjoStats').ChannelScale;
}

export interface Population {
  id: string;
  name: string;
  parentId: string | null; // null = child of the ungated root
  gate: Gate;
  // FlowJo eventsInside="0": the population is the parent's events outside the gate.
  exclude?: boolean;
  // Group that owns this population (FlowJo owningGroup): set by "Copy
  // analysis to group"; specs 7.2.
  owningGroup?: string;
  // FlowJo magnetic gate (specs 10.4): on each sample the gate moves toward
  // the densest events of the parent before gating.
  magnetic?: boolean;
}

export interface SampleState {
  id: string;
  fileName: string;
  fileSize: number;
  fingerprint: string; // SHA-256 of the file bytes, used to relink on reopen
  datasetIndex: number;
  compensation: string; // 'none' | 'file' | matrix id
  populations: Population[];
  keywordsSnapshot: Record<string, string>;
  annotations?: Record<string, string>; // user-entered sample metadata
  channelNames: string[];
  eventCount: number;
  // FlowJo linear axis ranges of an imported .wsp sample, per FlowJo parameter
  // name, in this app's raw units. Written back on .wsp export so FlowJo's
  // channel-dependent rules (open rectangle bounds, gate grid) see the same axes.
  flowjoLinearRanges?: Record<string, [number, number]>;
}

export interface Group {
  id: string;
  name: string;
  sampleIds: string[];
  // Live group: membership is recomputed from the criteria over all samples.
  // { key, value }: exact match (value null = samples without the key).
  // { rules, ... }: FlowJo 10 group criteria (src/core/groupCriteria.ts).
  criteria?: { key: string; value: string | null } | GroupCriteria;
  // FlowJo group role (metadata; written to and read from .wsp).
  role?: GroupRole;
  // FlowJo synchronized group: moving a group-owned gate moves it in every member.
  synchronized?: boolean;
  // FlowJo group display: text colour (#rrggbb) and font style.
  color?: string;
  fontStyle?: 'plain' | 'bold' | 'italic';
}

export type GroupRole = 'undefined' | 'test' | 'controls' | 'replicate' | 'compensation' | 'instrumentation' | 'baseline' | 'gatingLevel';

// FlowJo 10 group criteria: up to 4 keyword criteria, optional stain sets
// and an optional reference group ("also" = either, "only" = both).
export interface GroupCriteria {
  rules: KeywordRule[];
  stains?: string[];
  refGroup?: { name: string; fn: string };
}

export interface KeywordRule {
  // Applied to the running result, which starts true (also on the first rule).
  connector: 'and' | 'or' | 'andNot';
  keyword: string;
  // FlowJo's functions: = (equals), != (notEquals), >, >=, <, <=, Contains,
  // Lacks (notContains), Exists. startsWith / endsWith are this app's own.
  op: 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'notContains' | 'exists' | 'startsWith' | 'endsWith';
  value: string;
}

export interface Workspace {
  format: 'flowjo-rea-workspace';
  version: 1;
  name: string;
  samples: SampleState[];
  groups: Group[];
  matrices: SpilloverMatrix[];
  // Display scale per channel name; gates carry their own transforms.
  channelTransforms: Record<string, TransformSpec>;
  // Statistics table configuration.
  statColumns: StatColumn[];
  notes: string;
  provenance: { importedFrom?: string; warnings: string[] };
  // Plot layout per population path ('' = ungated), shared across samples.
  plots?: Record<string, PlotSettings>;
  layout?: LayoutItem[];
  statTemplates?: { id: string; name: string; columns: StatColumn[] }[];
  derivedParameters?: DerivedParameter[];
}

// A user-defined channel computed per event as A*(num-B)/(den-C) on the
// sample's compensated values (FlowJo-style ratio derived parameter).
export interface DerivedParameter {
  name: string;
  num: string;
  den: string;
  A: number;
  B: number;
  C: number;
}

export interface PlotSettings {
  x: string;
  y: string | null;
  kind: 'pseudocolor' | 'density' | 'zebra' | 'dot' | 'contour' | 'histogram';
  contourLevel?: number; // percent per contour step
  showOutliers?: boolean;
  normalize?: boolean; // histogram "Normalized To Mode" (default raw counts)
  overlays?: string[]; // population paths drawn on top (backgating)
}

// A layout cell: a plot rendered for whichever sample is chosen, or a text block.
export type LayoutItem = LayoutPlot | LayoutText;
export interface LayoutPlot extends PlotSettings {
  id: string;
  populationPath: string; // '' = all events
  text?: undefined;
}
export interface LayoutText {
  id: string;
  text: string;
}

export type StatKind =
  | 'count'
  | 'freqParent'
  | 'freqGrandparent'
  | 'freqTotal'
  | 'mean'
  | 'median'
  | 'geomean'
  | 'sd'
  | 'cv'
  | 'robustSd'
  | 'robustCv'
  | 'mad'
  | 'min'
  | 'max'
  | 'percentile'
  | 'mode'
  | 'correlation'
  | 'freqOf';

export interface StatColumn {
  id: string;
  populationPath: string; // names joined by '/', resolved per sample
  stat: StatKind;
  channel?: string;
  percentile?: number;
  // Freq. of: the ancestor population's name (FlowJo "ancestor" attribute).
  ancestor?: string;
  // Correlation: the second parameter (FlowJo "correlate" attribute).
  correlate?: string;
}

export function emptyWorkspace(name = 'Untitled'): Workspace {
  return {
    format: 'flowjo-rea-workspace',
    version: 1,
    name,
    samples: [],
    groups: [{ id: 'all', name: 'All Samples', sampleIds: [] }],
    matrices: [],
    channelTransforms: {},
    statColumns: [],
    notes: '',
    provenance: { warnings: [] },
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

// FlowJo 10 keeps sibling gate names unique (specs 6.7): a taken name gets
// the first free "-N" suffix, N = 1..999; a name already ending in "-" plus up
// to 3 digits (dash after the 3rd character) is numbered from its stem, so a
// copy of "CD4-1" is "CD4-2". Past 999 the time in milliseconds is appended.
// Names compare exactly. Also used for group names.
export function uniqueName(name: string, taken: Iterable<string>): string {
  const t = new Set(taken);
  if (!t.has(name)) return name;
  let stem = name;
  const dash = name.lastIndexOf('-');
  if (dash > 2 && dash > name.length - 4 && /^\d*$/.test(name.slice(dash + 1))) stem = name.slice(0, dash);
  for (let k = 1; k <= 999; k++) if (!t.has(`${stem}-${k}`)) return `${stem}-${k}`;
  return `${name}${Date.now()}`;
}

export function populationPath(pops: Population[], id: string): string {
  const names: string[] = [];
  let cur = pops.find((p) => p.id === id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parentId ? pops.find((p) => p.id === cur!.parentId) : undefined;
  }
  return names.join('/');
}

export function gateDims(g: Gate): Dimension[] {
  return g.type === 'boolean' ? [] : g.dims;
}

export function dimLabel(d: Dimension): string {
  return d.kind === 'channel' ? d.channel : `${d.num}/${d.den}`;
}
