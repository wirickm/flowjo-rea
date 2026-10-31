// Analysis service: owns parsed FCS data and per-sample engines. Runs inside
// the Web Worker in the app and directly in Node tests.
import { SampleEngine, type PopulationResult } from './analysis';
import { spilloverFromFcs, type SpilloverMatrix } from './compensation';
import { AppError } from './errors';
import { parseFcs, type FcsChannel, type FcsFile } from './fcs';
import { estimateSpillover, type ControlInput, type WizardResult } from './compWizard';
import { writeFcs } from './fcsWriter';
import type { DerivedParameter, Dimension, Population, StatColumn } from './model';
import { populationPath } from './model';
import { fingerprint } from './project';
import { computeStat, gather } from './stats';
import { makeTransform } from './transforms';

export interface SampleMeta {
  sampleId: string;
  fileName: string;
  fileSize: number;
  fingerprint: string;
  version: string;
  eventCount: number;
  channels: FcsChannel[];
  keywords: Record<string, string>;
  warnings: string[];
  hasSpillover: boolean;
  spillover: SpilloverMatrix | null;
  datasetCount: number;
}

export interface AnalyzeRequest {
  sampleId: string;
  compensation: string;
  populations: Population[];
  matrices: SpilloverMatrix[];
  derived?: DerivedParameter[];
}

export interface PlotRequest extends AnalyzeRequest {
  popId: string | null;
  x: Dimension;
  y: Dimension | null;
  bins: number;
  xRange: [number, number];
  yRange: [number, number] | null;
  maxPoints: number;
}

export interface PlotResult {
  count: number;
  bins: number;
  density: Float32Array; // bins x bins (row = y) or bins (histogram)
  points: Float32Array; // interleaved x,y display coordinates (subsample)
  xExtent: [number, number]; // finite data extent in display units
  yExtent: [number, number] | null;
}

export interface StatsRequest extends AnalyzeRequest {
  columns: StatColumn[];
}

export interface WizardRequest {
  // primary = channel the tube is stained for, null = unstained control
  controls: { sampleId: string; primary: string | null; compensation: string; populations: Population[] }[];
  channels: string[];
  positivePct: number;
  gatePath: string; // '' = all events; else a population path present in every control
  matrices: SpilloverMatrix[];
}

export interface ExportRequest extends AnalyzeRequest {
  popId: string | null;
  format: 'csv' | 'fcs';
  channels: string[];
  compensated: boolean;
}

export class AnalysisService {
  private files = new Map<string, FcsFile>();
  private engines = new Map<string, { key: string; engine: SampleEngine }>();

  async load(sampleId: string, fileName: string, bytes: Uint8Array, datasetIndex = 0): Promise<SampleMeta> {
    const f = parseFcs(bytes, { datasetIndex });
    this.files.set(sampleId, f);
    this.engines.delete(sampleId);
    let spill: SpilloverMatrix | null = null;
    const warnings = [...f.warnings];
    try {
      spill = spilloverFromFcs(f);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      warnings.push(`Spillover keyword unusable: ${e.message}`);
    }
    return {
      sampleId,
      fileName,
      fileSize: bytes.length,
      fingerprint: await fingerprint(bytes),
      version: f.version,
      eventCount: f.eventCount,
      channels: f.channels,
      keywords: f.keywords,
      warnings,
      hasSpillover: !!spill,
      spillover: spill,
      datasetCount: f.datasetOffsets.length,
    };
  }

  unload(sampleId: string) {
    this.files.delete(sampleId);
    this.engines.delete(sampleId);
  }

  has(sampleId: string) {
    return this.files.has(sampleId);
  }

  engine(r: AnalyzeRequest): SampleEngine {
    const f = this.files.get(r.sampleId);
    if (!f) throw new AppError('WORKSPACE_INVALID', 'Sample data is not loaded');
    const key = JSON.stringify([r.compensation, r.populations, r.matrices, r.derived]);
    const hit = this.engines.get(r.sampleId);
    if (hit && hit.key === key) return hit.engine;
    const engine = new SampleEngine(f, { compensation: r.compensation, populations: r.populations }, r.matrices, r.derived ?? []).run();
    this.engines.set(r.sampleId, { key, engine });
    return engine;
  }

  analyze(r: AnalyzeRequest): { results: PopulationResult[]; total: number; compError?: string } {
    const eng = this.engine(r);
    let compError: string | undefined;
    try {
      eng.compensated(r.compensation);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      compError = e.message;
    }
    return { results: r.populations.map((p) => eng.results.get(p.id)!), total: eng.root.length, compError };
  }

  plot(r: PlotRequest): PlotResult {
    const eng = this.engine(r);
    const mask = r.popId ? eng.masks.get(r.popId) : eng.root;
    if (!mask) throw new AppError('GATE_INVALID', 'Population not found');
    const xs = eng.dimension(r.x);
    const ys = r.y ? eng.dimension(r.y) : null;
    const B = r.bins;
    const [x0, x1] = r.xRange;
    const [y0, y1] = r.yRange ?? [0, 1];
    const density = new Float32Array(ys ? B * B : B);
    let count = 0;
    let ex0 = Infinity, ex1 = -Infinity, ey0 = Infinity, ey1 = -Infinity;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      count++;
      const x = xs[i];
      if (Number.isFinite(x)) { if (x < ex0) ex0 = x; if (x > ex1) ex1 = x; }
      // Off-scale events pile up on the axis edge, as in FlowJo.
      const bx = Math.min(B - 1, Math.max(0, Math.floor(((x - x0) / (x1 - x0)) * B)));
      if (!Number.isFinite(bx)) continue;
      if (ys) {
        const y = ys[i];
        if (Number.isFinite(y)) { if (y < ey0) ey0 = y; if (y > ey1) ey1 = y; }
        const by = Math.min(B - 1, Math.max(0, Math.floor(((y - y0) / (y1 - y0)) * B)));
        if (!Number.isFinite(by)) continue;
        density[by * B + bx]++;
      } else density[bx]++;
    }
    // maxPoints is an upper bound on the sampled events returned.
    const step = Math.max(1, Math.ceil(count / r.maxPoints));
    const pts: number[] = [];
    let k = 0;
    if (ys) for (let i = 0; i < mask.length; i++) if (mask[i] && k++ % step === 0) pts.push(xs[i], ys[i]);
    return {
      count,
      bins: B,
      density,
      points: Float32Array.from(pts),
      xExtent: [ex0, ex1],
      yExtent: ys ? [ey0, ey1] : null,
    };
  }

  stats(r: StatsRequest): (number | string)[] {
    const eng = this.engine(r);
    const total = eng.root.length;
    const byPath = new Map(r.populations.map((p) => [populationPath(r.populations, p.id), p]));
    return r.columns.map((c) => {
      try {
        const p = c.populationPath === '' ? null : byPath.get(c.populationPath);
        if (c.populationPath !== '' && !p) return 'missing population';
        const res = p ? eng.results.get(p.id)! : null;
        if (res?.error) return `error: ${res.error}`;
        const count = res ? res.count : total;
        const parent = res ? res.parentCount : total;
        let grand = total;
        const parentPop = p?.parentId ? r.populations.find((x) => x.id === p.parentId) : null;
        if (parentPop) grand = eng.results.get(parentPop.id)!.parentCount;
        const mask = p ? eng.masks.get(p.id)! : eng.root;
        let values: Float64Array | null = null;
        if (c.channel) values = gather(eng.column(c.channel), mask);
        return computeStat(c.stat, values, { count, parent, grandparent: grand, total }, c.percentile);
      } catch (e) {
        if (e instanceof AppError) return `error: ${e.message}`;
        throw e;
      }
    });
  }

  // Spillover from single-stain controls on raw (uncompensated) values.
  compWizard(r: WizardRequest): WizardResult {
    const inputs: ControlInput[] = r.controls.map((c) => {
      const f = this.files.get(c.sampleId);
      if (!f) throw new AppError('WORKSPACE_INVALID', 'Control sample data is not loaded');
      let mask: Uint8Array | undefined;
      if (r.gatePath) {
        const pop = c.populations.find((p) => populationPath(c.populations, p.id) === r.gatePath);
        if (!pop) throw new AppError('GATE_INVALID', `Population "${r.gatePath}" is missing in ${f.keywords['$FIL'] ?? c.sampleId}`);
        mask = this.engine({ sampleId: c.sampleId, compensation: c.compensation, populations: c.populations, matrices: r.matrices }).masks.get(pop.id);
      }
      return {
        label: f.keywords['$FIL'] ?? c.sampleId,
        primary: c.primary,
        columns: new Map(f.channels.map((ch, i) => [ch.name, f.data[i]])),
        mask,
      };
    });
    return estimateSpillover(inputs, r.channels, r.positivePct);
  }

  exportEvents(r: ExportRequest): Uint8Array {
    const eng = this.engine(r);
    const f = this.files.get(r.sampleId)!;
    const mask = r.popId ? eng.masks.get(r.popId)! : eng.root;
    const cols = r.channels.map((ch) => gather(r.compensated ? eng.column(ch) : eng.column(ch, 'uncompensated'), mask));
    if (r.format === 'csv') {
      const lines = [r.channels.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')];
      const n = cols[0]?.length ?? 0;
      for (let i = 0; i < n; i++) lines.push(cols.map((c) => String(c[i])).join(','));
      return new TextEncoder().encode(lines.join('\n') + '\n');
    }
    const chans = r.channels.map((ch, k) => {
      // Unmixed fluorochromes have no FCS parameter; use the largest detector range.
      const meta = f.channels.find((c) => c.name === ch);
      return { name: ch, label: meta ? meta.label : 'unmixed', range: meta ? meta.range : Math.max(...f.channels.map((c) => c.range)), values: cols[k] };
    });
    const extra: Record<string, string> = {};
    // Values are written in scale units (Time already in seconds, gain applied),
    // so $TIMESTEP is written as 1 to avoid rescaling on re-read.
    for (const k of ['$CYT', '$DATE', '$BTIM', '$ETIM', '$FIL', '$SRC']) if (f.keywords[k]) extra[k] = f.keywords[k];
    if (f.keywords['$TIMESTEP']) extra['$TIMESTEP'] = '1';
    extra['FLOWJO_REA_SOURCE'] = f.keywords['$FIL'] ?? '';
    extra['FLOWJO_REA_POPULATION'] = r.popId ? populationPath(r.populations, r.popId) : 'All events';
    extra['FLOWJO_REA_COMPENSATED'] = r.compensated ? r.compensation : 'uncompensated';
    // Compensated values are written as-is; the spillover keyword is omitted so
    // readers do not compensate twice.
    if (!r.compensated && f.keywords['$SPILLOVER']) extra['$SPILLOVER'] = f.keywords['$SPILLOVER'];
    return writeFcs(chans, extra);
  }

  // Display-space values of one event dimension, for tests and tooling.
  dimensionValues(r: AnalyzeRequest, d: Dimension): Float64Array {
    return this.engine(r).dimension(d);
  }
}

export { makeTransform };
