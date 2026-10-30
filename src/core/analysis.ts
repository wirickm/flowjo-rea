// Gate evaluation over a population hierarchy. Pure: FCS data + workspace
// state in, boolean masks and counts out. Runs in a worker in the UI.
import { compensate, invert, isSpectral, spilloverFromFcs, unmix, type SpilloverMatrix } from './compensation';
import { AppError, fail } from './errors';
import type { FcsFile } from './fcs';
import type { Dimension, Gate, Population, SampleState, Workspace } from './model';
import { makeTransform } from './transforms';

export interface PopulationResult {
  id: string;
  name: string;
  parentId: string | null;
  count: number;
  parentCount: number;
  error?: string;
}

export class SampleEngine {
  private compCache = new Map<string, Float64Array[]>();
  private unmixCache = new Map<string, Map<string, Float64Array>>();
  private dimCache = new Map<string, Float64Array>();
  readonly masks = new Map<string, Uint8Array>();
  readonly results = new Map<string, PopulationResult>();
  readonly root: Uint8Array;
  readonly channelNames: string[];

  constructor(
    readonly fcs: FcsFile,
    readonly sample: Pick<SampleState, 'compensation' | 'populations'>,
    readonly matrices: SpilloverMatrix[],
  ) {
    this.channelNames = fcs.channels.map((c) => c.name);
    this.root = new Uint8Array(fcs.eventCount).fill(1);
  }

  matrixFor(ref: string): SpilloverMatrix | null {
    if (ref === 'none' || ref === 'uncompensated') return null;
    if (ref === 'FCS') return spilloverFromFcs(this.fcs); // Gating-ML: no keyword = uncompensated
    if (ref === 'file') {
      const m = spilloverFromFcs(this.fcs);
      if (!m) fail('COMP_INVALID', 'Sample has no spillover keyword ($SPILLOVER/SPILL) to compensate with');
      return m;
    }
    const m = this.matrices.find((x) => x.id === ref);
    if (!m) fail('COMP_INVALID', `Compensation matrix "${ref}" is not defined`);
    return m;
  }

  compensated(ref: string): Float64Array[] {
    const hit = this.compCache.get(ref);
    if (hit) return hit;
    const m = this.matrixFor(ref);
    let data = this.fcs.data;
    if (m && isSpectral(m)) {
      // Detector columns stay raw; unmixed fluorochromes are extra columns.
      this.unmixCache.set(ref, unmix(this.fcs.data, this.channelNames, m));
    } else if (m) data = compensate(this.fcs.data, this.channelNames, m);
    this.compCache.set(ref, data);
    return data;
  }

  // Raw (compensated, untransformed) column for a channel.
  column(channel: string, compRef?: string): Float64Array {
    const ref = compRef ?? this.sample.compensation;
    let i = this.channelNames.indexOf(channel);
    if (i < 0) {
      this.compensated(ref); // fills unmixCache for spectral matrices
      const unmixed = this.unmixCache.get(ref)?.get(channel);
      if (unmixed) return unmixed;
      // Gating-ML spectrum matrices name compensated outputs by fluorochrome.
      const m = this.matrixFor(ref);
      const k = m?.outputNames?.indexOf(channel) ?? -1;
      if (m && k >= 0) i = this.channelNames.indexOf(m.channels[k]);
    }
    if (i < 0) fail('CHANNEL_MISSING', `Channel "${channel}" is not in this sample`);
    return this.compensated(ref)[i];
  }

  // Column for a gate dimension (compensated, then transformed).
  dimension(d: Dimension): Float64Array {
    const key = JSON.stringify(d);
    const hit = this.dimCache.get(key);
    if (hit) return hit;
    const t = makeTransform(d.transform);
    let src: Float64Array;
    if (d.kind === 'channel') {
      src = this.column(d.channel, d.compensation);
    } else {
      // Gating-ML fratio: A * (x - B) / (y - C)
      const x = this.column(d.num, d.compensation);
      const y = this.column(d.den, d.compensation);
      src = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) src[i] = (d.A * (x[i] - d.B)) / (y[i] - d.C);
    }
    let out = src;
    if (d.transform.kind !== 'none') {
      out = new Float64Array(src.length);
      for (let i = 0; i < src.length; i++) out[i] = t.apply(src[i]);
    }
    this.dimCache.set(key, out);
    return out;
  }

  // Evaluate all populations. Errors are recorded per population (and its
  // descendants get empty masks) rather than aborting the whole sample.
  run(): this {
    const pops = this.sample.populations;
    const byId = new Map(pops.map((p) => [p.id, p]));
    const visiting = new Set<string>();
    const evalPop = (p: Population): Uint8Array => {
      const done = this.masks.get(p.id);
      if (done) return done;
      if (visiting.has(p.id)) fail('GATE_INVALID', `Cycle in population hierarchy at "${p.name}"`);
      visiting.add(p.id);
      let parentMask = this.root;
      if (p.parentId) {
        const parent = byId.get(p.parentId);
        if (!parent) fail('GATE_INVALID', `Population "${p.name}" references missing parent ${p.parentId}`);
        parentMask = evalPop(parent);
      }
      let mask: Uint8Array;
      let error: string | undefined;
      try {
        mask = this.gateMask(p.gate, (ref) => {
          const r = byId.get(ref);
          if (!r) fail('GATE_INVALID', `Boolean gate references missing population ${ref}`);
          return evalPop(r);
        });
        for (let i = 0; i < mask.length; i++) mask[i] &= parentMask[i];
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        error = e.message;
        mask = new Uint8Array(this.root.length);
      }
      visiting.delete(p.id);
      this.masks.set(p.id, mask);
      let count = 0;
      let parentCount = 0;
      for (let i = 0; i < mask.length; i++) {
        count += mask[i];
        parentCount += parentMask[i];
      }
      this.results.set(p.id, { id: p.id, name: p.name, parentId: p.parentId, count, parentCount, error });
      return mask;
    };
    for (const p of pops) evalPop(p);
    return this;
  }

  gateMask(g: Gate, ref: (id: string) => Uint8Array): Uint8Array {
    const n = this.root.length;
    const out = new Uint8Array(n);
    switch (g.type) {
      case 'rect': {
        if (g.dims.length === 0 || g.min.length !== g.dims.length || g.max.length !== g.dims.length) {
          fail('GATE_INVALID', 'Rectangle gate bounds do not match its dimensions');
        }
        const cols = g.dims.map((d) => this.dimension(d));
        out.fill(1);
        cols.forEach((c, k) => {
          const lo = g.min[k];
          const hi = g.max[k];
          for (let i = 0; i < n; i++) {
            const v = c[i];
            if (!(lo === null || v >= lo) || !(hi === null || v < hi)) out[i] = 0;
          }
        });
        return out;
      }
      case 'polygon': {
        if (g.vertices.length < 3) fail('GATE_INVALID', 'Polygon gate needs at least 3 vertices');
        const xs = this.dimension(g.dims[0]);
        const ys = this.dimension(g.dims[1]);
        const vx = g.vertices.map((v) => v[0]);
        const vy = g.vertices.map((v) => v[1]);
        const m = vx.length;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let k = 0; k < m; k++) {
          x0 = Math.min(x0, vx[k]); x1 = Math.max(x1, vx[k]);
          y0 = Math.min(y0, vy[k]); y1 = Math.max(y1, vy[k]);
        }
        for (let i = 0; i < n; i++) {
          const x = xs[i];
          const y = ys[i];
          if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
          // Even-odd crossing test.
          let inside = false;
          for (let a = 0, b = m - 1; a < m; b = a++) {
            if (vy[a] > y !== vy[b] > y && x < ((vx[b] - vx[a]) * (y - vy[a])) / (vy[b] - vy[a]) + vx[a]) inside = !inside;
          }
          out[i] = inside ? 1 : 0;
        }
        return out;
      }
      case 'ellipsoid': {
        const k = g.dims.length;
        if (g.mean.length !== k || g.cov.length !== k) fail('GATE_INVALID', 'Ellipsoid gate dimensions mismatch');
        let inv: number[][];
        try {
          inv = invert(g.cov);
        } catch {
          fail('GATE_INVALID', 'Ellipsoid covariance matrix is singular');
        }
        const cols = g.dims.map((d) => this.dimension(d));
        const diff = new Float64Array(k);
        for (let i = 0; i < n; i++) {
          for (let a = 0; a < k; a++) diff[a] = cols[a][i] - g.mean[a];
          let s = 0;
          for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += diff[a] * inv[a][b] * diff[b];
          out[i] = s <= g.distanceSquare ? 1 : 0;
        }
        return out;
      }
      case 'quadrant': {
        const cols = g.dims.map((d) => this.dimension(d));
        out.fill(1);
        cols.forEach((c, k) => {
          const div = g.dividers[k];
          const side = g.side[k];
          const lo = side === 0 ? -Infinity : div[side - 1];
          const hi = side >= div.length ? Infinity : div[side];
          for (let i = 0; i < n; i++) if (!(c[i] >= lo && c[i] < hi)) out[i] = 0;
        });
        return out;
      }
      case 'boolean': {
        const ms = g.operands.map((o) => {
          const m = ref(o.ref);
          if (!o.complement) return m;
          const c = new Uint8Array(n);
          for (let i = 0; i < n; i++) c[i] = 1 - m[i];
          return c;
        });
        if (g.op === 'not') {
          if (ms.length !== 1) fail('GATE_INVALID', 'NOT gate needs exactly one operand');
          for (let i = 0; i < n; i++) out[i] = 1 - ms[0][i];
        } else if (g.op === 'and') {
          if (ms.length < 1) fail('GATE_INVALID', 'AND gate needs operands');
          out.fill(1);
          for (const m of ms) for (let i = 0; i < n; i++) out[i] &= m[i];
        } else {
          if (ms.length < 1) fail('GATE_INVALID', 'OR gate needs operands');
          for (const m of ms) for (let i = 0; i < n; i++) out[i] |= m[i];
        }
        return out;
      }
    }
  }
}

export function analyzeSample(fcs: FcsFile, sample: SampleState, ws: Pick<Workspace, 'matrices'>): SampleEngine {
  return new SampleEngine(fcs, sample, ws.matrices).run();
}

export { invert };
