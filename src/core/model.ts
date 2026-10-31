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

export type Gate =
  // Each bound may be null (open). Membership: min <= x < max (Gating-ML 2.0).
  | { type: 'rect'; dims: Dimension[]; min: (number | null)[]; max: (number | null)[] }
  | { type: 'polygon'; dims: [Dimension, Dimension]; vertices: [number, number][] }
  // (x-mean)^T inv(cov) (x-mean) <= distanceSquare
  | { type: 'ellipsoid'; dims: Dimension[]; mean: number[]; cov: number[][]; distanceSquare: number }
  // One quadrant of a split. side[i] = index of the interval of dims[i] split by
  // dividers[i] (sorted). Interval k is [dividers[k-1], dividers[k]).
  | { type: 'quadrant'; dims: Dimension[]; dividers: number[][]; side: number[] }
  | { type: 'boolean'; op: 'and' | 'or' | 'not'; operands: { ref: string; complement?: boolean }[] };

export interface Population {
  id: string;
  name: string;
  parentId: string | null; // null = child of the ungated root
  gate: Gate;
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
}

export interface Group {
  id: string;
  name: string;
  sampleIds: string[];
  // Live group: membership is recomputed from this rule over all samples
  // (value null = samples without the key).
  criteria?: { key: string; value: string | null };
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
}

export interface PlotSettings {
  x: string;
  y: string | null;
  kind: 'pseudocolor' | 'density' | 'zebra' | 'dot' | 'contour' | 'histogram';
  contourLevel?: number; // percent per contour step
  showOutliers?: boolean;
  overlays?: string[]; // population paths drawn on top (backgating)
}

// A plot placed in the layout: rendered for whichever sample is chosen.
export interface LayoutItem extends PlotSettings {
  id: string;
  populationPath: string; // '' = all events
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
  | 'percentile';

export interface StatColumn {
  id: string;
  populationPath: string; // names joined by '/', resolved per sample
  stat: StatKind;
  channel?: string;
  percentile?: number;
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
