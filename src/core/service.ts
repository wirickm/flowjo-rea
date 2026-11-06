// Analysis service: owns parsed FCS data and per-sample engines. Runs inside
// the Web Worker in the app and directly in Node tests.
import { SampleEngine, type PopulationResult } from './analysis';
import { spilloverFromFcs, type SpilloverMatrix } from './compensation';
import { capPositions, channelValue, concatCap, csvScaleValue, headerName, orderByEndTime, SAMPLE_ID_PARAMETER, type HeaderFormat } from './exportRules';
import { AppError, fail } from './errors';
import { parseFcs, type FcsChannel, type FcsFile } from './fcs';
import { estimateAfSpectrum } from './autofluorescence';
import { estimateSpillover, type ControlInput, type WizardResult } from './compWizard';
import { writeFcs } from './fcsWriter';
import type { DerivedParameter, Dimension, Population, StatColumn } from './model';
import { populationPath } from './model';
import { fingerprint } from './project';
import { channelOf, valueOf, type ChannelScale } from './flowjoStats';
import { flowjoWizard, spilloverSpreading, type FlowjoWizardResult, type WizardEntry, type WizardPopulation } from './compFlowjo';
import { BIFUR_BINS, bifurValley, smoothHistogram1D } from './gateTools';
import { computeStat, gather, validPercentile } from './stats';
import { makeTransform, type TransformSpec } from './transforms';
import { fitCellCycle, type CellCycleFit } from './cellcycle';
import { fitProliferation, type ProliferationFit } from './proliferation';
import { allEventsSlice, checkKinetics, kineticsSeries, kineticsTimeAxis, percentileThreshold, sortSlices, timesliceStats, usesThreshold, type KineticsSettings, type SliceStats, type Timeslice } from './kinetics';

export interface KineticsReport { values: Float64Array; range: number; width: number; threshold: number | null; total: number; scale: number; timeWidth: number; slices: (Timeslice & SliceStats)[] }

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
  datasetIndex: number;
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
  // FlowJo channel scales (by channel name) for FlowJo-convention statistics.
  scales?: Record<string, ChannelScale>;
  // Kinetics node settings by population path, for kinetic columns.
  kinetics?: Record<string, KineticsSettings>;
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
  // csv: scale values; csv-channel: channel values (0..1023); fcs: FCS 3.1.
  format: 'csv' | 'csv-channel' | 'fcs';
  channels: string[];
  compensated: boolean;
  // FlowJo "no more than N" (specs 9; deterministic decimation, not random).
  maxEvents?: number;
  header?: HeaderFormat;
  writeHeader?: boolean;
  // Scales of the channels, for channel values.
  transforms?: Record<string, TransformSpec>;
}

export interface PlatformRequest extends AnalyzeRequest {
  popId: string | null;
  channel: string;
}

export class AnalysisService {
  private files = new Map<string, FcsFile>();
  private bytes = new Map<string, { fileName: string; bytes: Uint8Array }>();
  private engines = new Map<string, { key: string; engine: SampleEngine }>();

  async load(sampleId: string, fileName: string, bytes: Uint8Array, datasetIndex = 0): Promise<SampleMeta> {
    const f = parseFcs(bytes, { datasetIndex });
    this.bytes.set(sampleId, { fileName, bytes });
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
      datasetIndex,
    };
  }

  // Switch a loaded sample to another data set ($NEXTDATA) of the same file.
  async selectDataset(sampleId: string, datasetIndex: number): Promise<SampleMeta> {
    const b = this.bytes.get(sampleId);
    if (!b) throw new AppError('WORKSPACE_INVALID', 'Sample data is not loaded');
    return this.load(sampleId, b.fileName, b.bytes, datasetIndex);
  }

  // Move a loaded sample to another id (a new file relinked to a workspace sample).
  rekey(from: string, to: string) {
    const b = this.bytes.get(from);
    const f = this.files.get(from);
    if (!b || !f) throw new AppError('WORKSPACE_INVALID', 'Sample data is not loaded');
    this.unload(from);
    this.bytes.set(to, b);
    this.files.set(to, f);
    this.engines.delete(to);
  }

  unload(sampleId: string) {
    this.bytes.delete(sampleId);
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
        if (c.stat === 'percentile' && !validPercentile(c.percentile)) return 'error: percentile must be an integer from 0 to 100';
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
        // Freq. of: the nearest ancestor with the named population (specs 8.1).
        let ancestor: number | undefined;
        if (c.stat === 'freqOf') {
          let a = p?.parentId ? r.populations.find((x) => x.id === p.parentId) : undefined;
          while (a && a.name !== c.ancestor) a = a.parentId ? r.populations.find((x) => x.id === a!.parentId) : undefined;
          if (!a) return `error: no ancestor named "${c.ancestor ?? ''}"`;
          ancestor = eng.results.get(a.id)!.count;
        }
        if (c.stat === 'kinetic') {
          const st = r.kinetics?.[c.populationPath];
          if (!st || !c.kin) return 'error: no Kinetics node on this population';
          const f = this.files.get(r.sampleId)!;
          const timeCh = f.channels.find((x) => /^time$/i.test(x.name))?.name ?? null;
          const secs = (t?: string) => { const m = /^(\d+):(\d+):(\d+)/.exec((t ?? '').trim()); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined; };
          const b = secs(f.keywords['$BTIM']), e = secs(f.keywords['$ETIM']);
          const rep = this.kinetics({ ...r, popId: p ? p.id : null, channel: st.yAxis, timeChannel: timeCh, settings: st, scale: r.scales?.[st.yAxis] ?? { kind: 'linear', min: 0, max: f.channels.find((x) => x.name === st.yAxis)?.range ?? 1024 }, durationSeconds: b !== undefined && e !== undefined && e - b > 0 ? e - b : undefined });
          const sl = rep.slices.find((x) => x.name === c.kin!.timeslice);
          return sl ? sl[c.kin.key] : NaN;
        }
        const values2 = c.stat === 'correlation' && c.correlate ? gather(eng.column(c.correlate), mask) : null;
        return computeStat(c.stat, values, { count, parent, grandparent: grand, total, ancestor }, c.percentile, c.channel ? r.scales?.[c.channel] : undefined, values2);
      } catch (e) {
        if (e instanceof AppError) return `error: ${e.message}`;
        throw e;
      }
    });
  }

  // Spillover from single-stain controls on raw (uncompensated) values.
  // Estimate an AF spectrum from an unstained control over a matrix's detectors.
  estimateAf(r: { sampleId: string; detectors: string[]; compensation: string; populations: Population[]; matrices: SpilloverMatrix[]; gatePath: string }): number[] {
    const f = this.files.get(r.sampleId);
    if (!f) throw new AppError('WORKSPACE_INVALID', 'Unstained control data is not loaded');
    let mask: Uint8Array | undefined;
    if (r.gatePath) {
      const pop = r.populations.find((p) => populationPath(r.populations, p.id) === r.gatePath);
      if (!pop) throw new AppError('GATE_INVALID', `Population "${r.gatePath}" is missing in the control`);
      mask = this.engine({ sampleId: r.sampleId, compensation: r.compensation, populations: r.populations, matrices: r.matrices }).masks.get(pop.id);
    }
    const columns = new Map(f.channels.map((ch, i) => [ch.name, f.data[i]]));
    return estimateAfSpectrum(columns, r.detectors, mask);
  }

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

  // FlowJo 10's compensation wizard on positive / negative populations of
  // single-stain controls, with the spillover spreading matrix (specs 14).
  flowjoWizard(r: { controls: { sampleId: string; compensation: string; populations: Population[]; primary: string; posPath: string | null; negPath: string | null; neg?: { sampleId: string; compensation: string; populations: Population[] } }[]; matrices: SpilloverMatrix[]; detectors: string[]; scales: Record<string, ChannelScale>; name?: string }): FlowjoWizardResult & { ssm: { channels: string[]; values: number[][] } } {
    const entries: WizardEntry[] = r.controls.map((c) => {
      const pop = (path: string | null, src: { sampleId: string; compensation: string; populations: Population[] } = c): WizardPopulation | null => {
        if (!path) return null;
        const p = src.populations.find((x) => populationPath(src.populations, x.id) === path);
        if (!p) return null;
        const eng = this.engine({ sampleId: src.sampleId, compensation: src.compensation, populations: src.populations, matrices: r.matrices });
        const mask = eng.masks.get(p.id)!;
        return { name: path, values: new Map(r.detectors.map((d) => [d, gather(eng.column(d, 'uncompensated'), mask)])), parentCount: eng.results.get(p.id)!.parentCount, cleaned: p.parentId !== null };
      };
      return { primary: c.primary, pos: pop(c.posPath), neg: pop(c.negPath, c.neg ?? c) };
    });
    const res = flowjoWizard(entries, r.detectors, r.scales, r.name);
    return { ...res, ssm: spilloverSpreading(entries, r.detectors, r.scales) };
  }

  // Population values for export, with FlowJo's event cap applied.
  private exportColumns(r: ExportRequest, cap: number | undefined) {
    const eng = this.engine(r);
    const mask = r.popId ? eng.masks.get(r.popId)! : eng.root;
    const full = r.channels.map((ch) => gather(r.compensated ? eng.column(ch) : eng.column(ch, 'uncompensated'), mask));
    const count = full[0]?.length ?? Array.from(mask).reduce((a, b) => a + b, 0);
    const keep = capPositions(count, cap, r.popId !== null);
    return { count, cols: full.map((c) => Float64Array.from(keep, (i) => c[i])) };
  }

  private writeExport(r: ExportRequest, cols: Float64Array[], extraCols: { name: string; values: Float64Array }[], extra: Record<string, string>): Uint8Array {
    const f = this.files.get(r.sampleId)!;
    if (r.format !== 'fcs') {
      const fmt = r.header ?? 'p';
      const head = [...r.channels.map((ch) => headerName(ch, f.channels.find((c) => c.name === ch)?.label, fmt)), ...extraCols.map((e) => e.name)];
      const lines = r.writeHeader === false ? [] : [head.join(',')];
      const n = cols[0]?.length ?? extraCols[0]?.values.length ?? 0;
      for (let i = 0; i < n; i++) {
        const row = cols.map((c, k) => (r.format === 'csv-channel' ? String(channelValue(c[i], r.transforms?.[r.channels[k]] ?? { kind: 'none' })) : csvScaleValue(c[i])));
        for (const e of extraCols) row.push(String(e.values[i]));
        lines.push(row.join(','));
      }
      return new TextEncoder().encode(lines.join('\n') + '\n');
    }
    const chans = [
      ...r.channels.map((ch, k) => {
        // Unmixed fluorochromes have no FCS parameter; use the largest detector range.
        const meta = f.channels.find((c) => c.name === ch);
        return { name: ch, label: meta ? meta.label : 'unmixed', range: meta ? meta.range : Math.max(...f.channels.map((c) => c.range)), values: cols[k] };
      }),
      ...extraCols.map((e) => ({ name: e.name, label: '', range: Math.max(1, ...e.values), values: e.values })),
    ];
    const kw: Record<string, string> = {};
    // Values are written in scale units (Time already in seconds, gain applied),
    // so $TIMESTEP is written as 1 to avoid rescaling on re-read (own rule;
    // FlowJo writes raw units with the original keywords, specs 9).
    for (const k of ['$CYT', '$DATE', '$BTIM', '$ETIM', '$FIL', '$SRC']) if (f.keywords[k]) kw[k] = f.keywords[k];
    if (f.keywords['$TIMESTEP']) kw['$TIMESTEP'] = '1';
    // Compensated values are written as-is; the spillover keyword is omitted so
    // readers do not compensate twice.
    if (!r.compensated && f.keywords['$SPILLOVER']) kw['$SPILLOVER'] = f.keywords['$SPILLOVER'];
    return writeFcs(chans, { ...kw, ...extra });
  }

  exportEvents(r: ExportRequest): Uint8Array {
    const f = this.files.get(r.sampleId)!;
    const { cols } = this.exportColumns(r, r.maxEvents);
    return this.writeExport(r, cols, [], {
      FLOWJO_REA_SOURCE: f.keywords['$FIL'] ?? '',
      FLOWJO_REA_POPULATION: r.popId ? populationPath(r.populations, r.popId) : 'All events',
      FLOWJO_REA_COMPENSATED: r.compensated ? r.compensation : 'uncompensated',
    });
  }

  // FlowJo "Concatenate": the populations in $ETIM order, each capped at
  // trunc(sum of min(N, count) / populations), with a SampleID parameter
  // holding each population's 1-based position (specs 9). The parameters
  // must be the same in every population.
  exportConcatenated(parts: ExportRequest[]): Uint8Array {
    if (!parts.length) fail('UNSUPPORTED_FEATURE', 'Nothing to concatenate');
    const names = parts[0].channels.join('\u0000');
    if (parts.some((p) => p.channels.join('\u0000') !== names)) fail('UNSUPPORTED_FEATURE', 'Concatenation needs the same parameters in every sample');
    const ordered = orderByEndTime(parts, (p) => this.files.get(p.sampleId)?.keywords['$ETIM']);
    const counts = ordered.map((p) => this.exportColumns(p, undefined).count);
    const cap = concatCap(counts, parts[0].maxEvents);
    const pieces = ordered.map((p) => this.exportColumns(p, cap).cols);
    const cols = parts[0].channels.map((_, k) => Float64Array.from(pieces.flatMap((c) => Array.from(c[k]))));
    const ids = Float64Array.from(pieces.flatMap((c, i) => Array.from({ length: c[0]?.length ?? 0 }, () => i + 1)));
    return this.writeExport(ordered[0], cols, [{ name: SAMPLE_ID_PARAMETER, values: ids }], {
      FLOWJO_REA_CONCATENATED: ordered.map((p) => this.files.get(p.sampleId)?.keywords['$FIL'] ?? p.sampleId).join(', '),
    });
  }

  private platformData(r: PlatformRequest) {
    const eng = this.engine(r);
    const mask = r.popId ? eng.masks.get(r.popId) : eng.root;
    if (!mask) throw new AppError('GATE_INVALID', 'Population not found');
    return { eng, mask, values: gather(eng.column(r.channel), mask) };
  }

  // Cell cycle on a linear DNA histogram: bin k covers [k*w, (k+1)*w) of the
  // compensated channel, w = channel range / channels. The channel count is
  // FlowJo 10's: min(channel range, 1024), not user-set (specs section 6.1).
  cellCycle(r: PlatformRequest & { model: 'dean-jett-fox' | 'watson'; constrainG2?: boolean }): CellCycleFit & { binWidth: number; histogram: Float64Array } {
    const { values } = this.platformData(r);
    const f = this.files.get(r.sampleId)!;
    const range = f.channels.find((c) => c.name === r.channel)?.range || 1024;
    const bins = cellCycleChannels(range);
    const w = range / bins;
    const hist = new Float64Array(bins);
    for (const v of values) {
      const k = Math.floor(v / w);
      if (k >= 0 && k < bins) hist[k]++;
    }
    const fit = fitCellCycle(hist, { model: r.model, constrainG2: r.constrainG2 ?? true });
    return { ...fit, binWidth: w, histogram: hist };
  }

  proliferation(r: PlatformRequest & { maxGenerations?: number }): ProliferationFit {
    return fitProliferation(this.platformData(r).values, { maxGenerations: r.maxGenerations });
  }

  // FlowJo 10.6.2 kinetics (specs 11): the series of the chosen statistic
  // over time for the population, then each timeslice's statistics. Without
  // a Time parameter the event number is the time, as the engine does.
  kinetics(r: PlatformRequest & { timeChannel: string | null; settings: KineticsSettings; scale: ChannelScale; durationSeconds?: number; timeRange?: [number, number] }): KineticsReport {
    checkKinetics(r.settings);
    const { eng, mask } = this.platformData({ ...r, channel: r.settings.yAxis });
    const y = eng.column(r.settings.yAxis);
    const time = r.timeChannel ? eng.column(r.timeChannel) : Float64Array.from({ length: y.length }, (_, i) => i);
    const st = r.settings;
    const withAxis = (n: number, range: number) => kineticsTimeAxis(n, range, r.durationSeconds);
    let threshold: number | null = null;
    if (usesThreshold(st.statistic)) {
      const th = st.threshold;
      if (!th) fail('GATE_INVALID', 'Kinetics: define a threshold for this statistic');
      if (th.kind === 'absolute') threshold = th.value;
      else {
        const sl = st.timeslices.find((x) => x.name === th.timeslice);
        if (!sl) fail('GATE_INVALID', `Kinetics: threshold timeslice "${th.timeslice}" not found`);
        threshold = percentileThreshold(y, mask, th.percentile, sl.startTime, sl.endTime, r.scale);
      }
    }
    const series = kineticsSeries(time, y, mask, { stat: st.statistic, percentile: st.percentile, smoothing: st.smoothing, threshold: threshold ?? 0, scale: r.scale });
    const axis = withAxis(series.values.length, series.range);
    // The X parameter's scale: the Time channel range (or the event count).
    const f = this.files.get(r.sampleId)!;
    const tr = r.timeRange ?? (r.timeChannel ? [0, f.channels.find((c) => c.name === r.timeChannel)?.range ?? time.length] : [0, time.length]);
    const slices = [allEventsSlice(series.values.length, axis.scale), ...sortSlices(st.timeslices)].map((sl) => ({ ...sl, ...timesliceStats(series.values, sl, tr[1], tr[1] - tr[0]) }));
    return { values: series.values, range: series.range, width: series.width, threshold, total: axis.total, scale: axis.scale, timeWidth: tr[1] - tr[0], slices };
  }

  // Display-space values of one event dimension, for tests and tooling.
  // BifurGate (ws.autoquad, specs 10.8): for each channel, the split (data
  // units) at the valley of the smoothed 4096-channel histogram of the
  // selected population's parent (all events for a top-level population or
  // the root), or null when the histogram is unimodal.
  bifurcate(r: AnalyzeRequest & { popId: string | null; channels: string[]; scales: Record<string, ChannelScale> }): { channel: string; split: number | null }[] {
    const eng = this.engine(r);
    const pop = r.popId ? r.populations.find((p) => p.id === r.popId) : null;
    const mask = pop?.parentId ? eng.masks.get(pop.parentId)! : eng.root;
    return r.channels.map((channel) => {
      const s = r.scales[channel];
      if (!s) return { channel, split: null };
      const v = gather(eng.column(channel), mask);
      const counts = new Float64Array(BIFUR_BINS);
      for (let i = 0; i < v.length; i++) if (!Number.isNaN(v[i])) counts[channelOf(s, v[i])]++;
      const valley = bifurValley(smoothHistogram1D(counts));
      return { channel, split: valley < 0 ? null : valueOf(s, valley) };
    });
  }

  dimensionValues(r: AnalyzeRequest, d: Dimension): Float64Array {
    return this.engine(r).dimension(d);
  }
}

// FlowJo 10's cell cycle histogram resolution: the channel range, capped at
// 1024 channels (FlowJo CCNode.HISTOGRAM_CHANNELS; specs section 6.1).
export const CELL_CYCLE_MAX_CHANNELS = 1024;
export function cellCycleChannels(range: number): number {
  return Math.max(1, Math.min(CELL_CYCLE_MAX_CHANNELS, Math.floor(range)));
}

export { makeTransform };
