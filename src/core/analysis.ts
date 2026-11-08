// Gate evaluation over a population hierarchy. Pure: FCS data + workspace
// state in, boolean masks and counts out. Runs in a worker in the UI.
import { compensate, invert, isSpectral, spilloverFromFcs, unmix, type SpilloverMatrix } from './compensation';
import { AppError, fail } from './errors';
import type { FcsFile } from './fcs';
import { populationPath, UNCOMP_SUFFIX, type AnchorBound, type DerivedParameter, type Dimension, type Gate, type Population, type SampleState, type Workspace } from './model';
import { axesFromGate } from './ellipse';
import { defaultGrid, ellipseLatticePolygon, eventCell, gridCoord, latticeMask, polygonGridMask, vertexCoord } from './gateGrid';
import { BIFUR_BINS, curlyQuadPolygon, magneticOffset1D, magneticOffset2D, MAGNETIC_BINS, percentBound, spiderLabelGrid } from './gateTools';
import { computeStat, gather } from './stats';
import { compileFormula, EVENT_NUMBER, FormulaError } from './formula';
import { splineDividers } from './spline';
import { decodeColumn } from './paramImport';
import { clusterFrequencyColumn, consensusColumn } from './clusterParams';
import { makeTransform } from './transforms';
import { maskFromBits } from './fileMask';

export interface PopulationResult {
  id: string;
  name: string;
  parentId: string | null;
  count: number;
  parentCount: number;
  error?: string;
  // A magnetic gate as moved on this sample (specs 10.4).
  moved?: Gate;
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
    readonly derived: DerivedParameter[] = [],
    // Sample id: selects this sample's values of imported and gate-derived parameters.
    readonly sampleId?: string,
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

  private derivedCache = new Map<string, Float64Array>();
  // Mask of a population by id (set by run(); gate-derived parameters use it).
  private popMask: (id: string) => Uint8Array = (id) => {
    const m = this.masks.get(id);
    if (!m) fail('GATE_INVALID', `Derived parameter population ${id} not found`);
    return m;
  };

  // Raw (compensated, untransformed) column for a channel or derived parameter.
  column(channel: string, compRef?: string): Float64Array {
    const ref = compRef ?? this.sample.compensation;
    let i = this.channelNames.indexOf(channel);
    if (i < 0 && channel.endsWith(UNCOMP_SUFFIX)) return this.column(channel.slice(0, -UNCOMP_SUFFIX.length), 'none');
    if (i < 0 && channel === EVENT_NUMBER) {
      // "Show Event # Parameter" (ParameterList.getParameterIDs; specs 24.2): the event index.
      const n = this.root.length, out = new Float64Array(n);
      for (let k = 0; k < n; k++) out[k] = k;
      return out;
    }
    if (i < 0) {
      const dp = this.derived.find((d) => d.name === channel);
      if (dp) return this.derivedColumn(dp, ref);
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

  // A derived parameter, computed once per matrix: a FlowJo formula
  // (src/core/formula.ts; values stored as 32-bit floats, Event # = 0-based
  // event index) or this app's earlier ratio A*(num-B)/(den-C).
  private derivedColumn(dp: DerivedParameter, ref: string): Float64Array {
    const key = `${dp.name}|${ref}`;
    const hit = this.derivedCache.get(key);
    if (hit) return hit;
    let out: Float64Array;
    if (dp.formula !== undefined) {
      const n = this.root.length;
      out = new Float64Array(n);
      if (dp.formula.trim().toUpperCase() === EVENT_NUMBER.toUpperCase()) {
        for (let i = 0; i < n; i++) out[i] = i;
      } else {
        const params = [...this.channelNames, ...this.derived.filter((d) => d.name !== dp.name).map((d) => d.name)];
        let f;
        try {
          f = compileFormula(dp.formula, params);
        } catch (e) {
          if (e instanceof FormulaError) fail('GATE_INVALID', `Derived parameter "${dp.name}": ${e.message}`);
          throw e;
        }
        const cols = f.variables.map((v) => (v === null ? null : v === EVENT_NUMBER ? 'event' : this.column(v, ref)));
        const vars = new Float64Array(cols.length);
        try {
          for (let i = 0; i < n; i++) {
            for (let k = 0; k < cols.length; k++) { const c = cols[k]; vars[k] = c === null ? NaN : c === 'event' ? i : c[i]; }
            out[i] = Math.fround(f.evaluate(vars));
          }
        } catch (e) {
          if (e instanceof FormulaError) fail('GATE_INVALID', `Derived parameter "${dp.name}": ${e.message}`);
          throw e;
        }
      }
    } else if ('imported' in dp) {
      const n = this.root.length;
      const enc = this.sampleId !== undefined ? dp.imported.data[this.sampleId] : undefined;
      const v = enc ? decodeColumn(enc) : null;
      out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = v && i < v.length ? v[i] : NaN;
    } else if ('gateDerived' in dp) {
      const n = this.root.length;
      const g = dp.gateDerived;
      if (g.sampleId !== this.sampleId) out = new Float64Array(n).fill(NaN);
      else {
        const masks = g.populations.map((id) => this.popMask(id));
        out = g.type === 'consensus' ? consensusColumn(masks, n) : clusterFrequencyColumn(masks[0] ?? new Uint8Array(n), masks.slice(1), n);
      }
    } else {
      if (dp.num === dp.name || dp.den === dp.name) fail('CHANNEL_MISSING', `Derived parameter "${dp.name}" refers to itself`);
      const x = this.column(dp.num, ref);
      const y = this.column(dp.den, ref);
      out = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) out[i] = (dp.A * (x[i] - dp.B)) / (y[i] - dp.C);
    }
    this.derivedCache.set(key, out);
    return out;
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
    this.popMask = (id) => {
      const p = byId.get(id);
      if (!p) fail('GATE_INVALID', `Derived parameter population ${id} not found`);
      return evalPop(p);
    };
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
      let moved: Gate | undefined;
      try {
        const g0 = p.gate.type === 'anchored' ? this.anchoredGate(p.gate, (path) => {
          const q = pops.find((x) => populationPath(pops, x.id) === path);
          if (!q) fail('GATE_INVALID', `Anchored gate statistic population "${path}" not found`);
          return { mask: evalPop(q), result: this.results.get(q.id)!, parentResult: q.parentId ? this.results.get(q.parentId) : undefined };
        }) : p.gate;
        const g1 = g0.type === 'rect' && g0.percent ? this.percentGate(g0, parentMask) : g0;
        const gate = p.magnetic ? this.magneticGate(g1, parentMask) : g1;
        if (gate !== p.gate) moved = gate; // magnetic: moved; anchored: resolved bounds
        mask = this.gateMask(gate, (ref) => {
          const r = byId.get(ref);
          if (!r) fail('GATE_INVALID', `Boolean gate references missing population ${ref}`);
          return evalPop(r);
        });
        if (p.exclude) for (let i = 0; i < mask.length; i++) mask[i] = 1 - mask[i];
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
      this.results.set(p.id, { id: p.id, name: p.name, parentId: p.parentId, count, parentCount, error, ...(moved ? { moved } : {}) });
      return mask;
    };
    for (const p of pops) evalPop(p);
    return this;
  }

  // FlowJo anchored range (TetheredRangeGate, specs 10.6): each bound is the
  // statistic of its population on this sample times the multiplier, as a
  // plain range (lower bound inclusive, upper exclusive, as rectangles).
  anchoredGate(g: Extract<Gate, { type: 'anchored' }>, pop: (path: string) => { mask: Uint8Array; result: PopulationResult; parentResult?: PopulationResult }): Gate {
    const total = this.root.length;
    const t = makeTransform(g.dims[0].transform);
    const bound = (b: AnchorBound | null): number | null => {
      if (!b) return null;
      const r = b.populationPath === '' ? null : pop(b.populationPath);
      const mask = r ? r.mask : this.root;
      let values: Float64Array | null = null;
      if (b.channel) {
        const col = this.column(b.channel);
        const v: number[] = [];
        for (let i = 0; i < mask.length; i++) if (mask[i]) v.push(col[i]);
        values = Float64Array.from(v);
      }
      const count = r ? r.result.count : total, parent = r ? r.result.parentCount : total;
      const stat = computeStat(b.stat, values, { count, parent, grandparent: r?.parentResult?.parentCount ?? total, total }, b.percentile, b.scale);
      if (typeof stat !== 'number' || !Number.isFinite(stat)) fail('GATE_INVALID', `Anchored gate statistic ${b.stat} is not a number on this sample`);
      return t.apply(stat * b.multiplier);
    };
    return { type: 'rect', dims: g.dims, min: [bound(g.min)], max: [bound(g.max)] };
  }

  // FlowJo percent gate (evaluatePercentGate, specs 10.6): percent bounds
  // become scale bounds from the parent's smoothed histogram on this sample.
  percentGate(g: Extract<Gate, { type: 'rect' }>, parentMask: Uint8Array): Gate {
    const pc = g.percent!;
    const bound = (k: number, p: number | null, fixed: number | null) => {
      if (p === null) return fixed;
      const v = gather(this.column((g.dims[k] as Extract<Dimension, { kind: 'channel' }>).channel, g.dims[k].compensation), parentMask);
      return makeTransform(g.dims[k].transform).apply(percentBound(v, pc.scales[k], p, k === 1 ? 256 : BIFUR_BINS));
    };
    return { type: 'rect', dims: g.dims, min: g.dims.map((_, k) => bound(k, pc.min[k] ?? null, g.min[k])), max: g.dims.map((_, k) => bound(k, pc.max[k] ?? null, g.max[k])) };
  }

  // FlowJo magnetic gate (FGate::MoveMagneticGate, specs 10.4): the gate as
  // drawn, moved over a 256-cell histogram of the parent population. Polygon
  // and rectangle gates move; other gates are used as drawn.
  magneticGate(g: Gate, parentMask: Uint8Array): Gate {
    const B = MAGNETIC_BINS;
    if (g.type === 'rect' && g.dims.length === 1 && g.min[0] !== null && g.max[0] !== null) {
      const grid = defaultGrid([g.dims[0], g.dims[0]], B);
      if (!grid) return g;
      const ax = grid.axes[0];
      const xs = this.dimension(g.dims[0]);
      const hist = new Float64Array(B);
      for (let i = 0; i < xs.length; i++) if (parentMask[i] && !Number.isNaN(xs[i])) hist[eventCell(ax, B, xs[i])]++;
      const shift = magneticOffset1D(hist, vertexCoord(ax, B, g.min[0]), vertexCoord(ax, B, g.max[0]));
      const d = (shift * (ax.max - ax.min)) / B;
      return { ...g, min: [g.min[0] + d], max: [g.max[0] + d] };
    }
    let verts: [number, number][];
    if (g.type === 'polygon') verts = g.vertices;
    else if (g.type === 'rect' && g.dims.length === 2 && g.min.every((v) => v !== null) && g.max.every((v) => v !== null)) {
      const [x0, y0] = g.min as number[], [x1, y1] = g.max as number[];
      verts = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
    } else return g;
    const dims = g.dims as [Dimension, Dimension];
    const grid = defaultGrid(dims, B);
    if (!grid) return g;
    const [ax, ay] = grid.axes;
    // Cells with y counting down, as the engine flips y (256 - byte).
    const xs = this.dimension(dims[0]);
    const ys = this.dimension(dims[1]);
    const hist = new Float64Array(B * B);
    for (let i = 0; i < xs.length; i++) {
      if (!parentMask[i] || Number.isNaN(xs[i]) || Number.isNaN(ys[i])) continue;
      const fy = B - 1 - eventCell(ay, B, ys[i]);
      hist[eventCell(ax, B, xs[i]) * B + fy]++;
    }
    const poly = verts.map((v): [number, number] => [vertexCoord(ax, B, v[0]), B - 1 - vertexCoord(ay, B, v[1])]);
    const [dx, dy] = magneticOffset2D(hist, poly);
    const ox = (dx * (ax.max - ax.min)) / B, oy = (-dy * (ay.max - ay.min)) / B;
    if (g.type === 'polygon') return { ...g, vertices: g.vertices.map(([a, b]) => [a + ox, b + oy]) };
    const r = g as Extract<Gate, { type: 'rect' }>;
    return { ...r, min: [r.min[0]! + ox, r.min[1]! + oy], max: [r.max[0]! + ox, r.max[1]! + oy] };
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
        if (g.grid) {
          const R = g.grid.resolution;
          if (!(Number.isInteger(R) && R >= 2 && R <= 4096)) fail('GATE_INVALID', `Polygon gate resolution ${R} is not an integer in 2..4096`);
          const [ax, ay] = g.grid.axes;
          if (!(ax.max > ax.min && ay.max > ay.min)) fail('GATE_INVALID', 'Polygon gate grid range is empty');
          const cells = polygonGridMask(g.grid, g.vertices);
          for (let i = 0; i < n; i++) {
            const x = xs[i];
            const y = ys[i];
            if (Number.isNaN(x) || Number.isNaN(y)) continue;
            out[i] = cells[eventCell(ax, R, x) * R + eventCell(ay, R, y)];
          }
          return out;
        }
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
        if (g.grid && g.dims.length === 2) {
          const R = g.grid.resolution;
          const [ax, ay] = g.grid.axes;
          let edges = g.edges;
          if (!edges || edges.length !== 4) {
            const e = axesFromGate(g.mean, g.cov, g.distanceSquare);
            const c = Math.cos(e.theta), s = Math.sin(e.theta);
            edges = [[e.cx + e.a * c, e.cy + e.a * s], [e.cx - e.a * c, e.cy - e.a * s], [e.cx - e.b * s, e.cy + e.b * c], [e.cx + e.b * s, e.cy - e.b * c]];
          }
          const out0 = ellipseLatticePolygon(edges.map(([x, y]) => [gridCoord(ax, R, x), gridCoord(ay, R, y)] as [number, number]));
          // FlowJo converts each outline pixel back to a data value and places
          // it on the grid like any polygon vertex.
          const back = (a: typeof ax, px: number) => vertexCoord(a, R, a.min + (px * (a.max - a.min)) / R);
          const vx = out0.vx.map((px) => back(ax, px));
          const vy = out0.vy.map((py) => back(ay, py));
          const cells = latticeMask(R, vx, vy);
          const xs = this.dimension(g.dims[0]);
          const ys = this.dimension(g.dims[1]);
          for (let i = 0; i < n; i++) {
            if (Number.isNaN(xs[i]) || Number.isNaN(ys[i])) continue;
            out[i] = cells[eventCell(ax, R, xs[i]) * R + eventCell(ay, R, ys[i])];
          }
          return out;
        }
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
          // NaN counts as below the divider (native QuadGate).
          for (let i = 0; i < n; i++) if (Number.isNaN(c[i]) ? side !== 0 : !(c[i] >= lo && c[i] < hi)) out[i] = 0;
        });
        return out;
      }
      case 'splineQuadrant': {
        if (g.xDivider.length < 1 || g.yDivider.length < 1) fail('GATE_INVALID', 'Spline quadrant needs control points on both dividers');
        const xs = this.dimension(g.dims[0]);
        const ys = this.dimension(g.dims[1]);
        const { xAt, yAt } = splineDividers(g.xDivider, g.yDivider);
        for (let i = 0; i < n; i++) {
          const x = xs[i];
          const y = ys[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const rx = x >= xAt(y) ? 1 : 0;
          const ry = y >= yAt(x) ? 1 : 0;
          out[i] = rx === g.side[0] && ry === g.side[1] ? 1 : 0;
        }
        return out;
      }
      case 'curlyQuad': {
        // FlowJo sends the four curly quadrants to the engine as one
        // gating:PolyQuad (specs 10.2), so they are gated as a spider quad.
        const [[x0, x1], [y0, y1]] = g.frame;
        if (!(x1 > x0 && y1 > y0) || !(g.quadrant >= 0 && g.quadrant <= 3)) fail('GATE_INVALID', 'Curly quad frame or quadrant is invalid');
        const polygons = [0, 1, 2, 3].map((q) => curlyQuadPolygon(g.center, q, [x0, x1], [y0, y1]));
        return this.gateMask({ type: 'spider', dims: g.dims, polygons, slot: g.quadrant, grid: g.grid }, ref);
      }
      case 'spider': {
        if (g.polygons.length !== 4 || g.polygons.some((q) => q.length < 3)) fail('GATE_INVALID', 'Spider quad needs four polygons');
        const grid = g.grid ?? defaultGrid(g.dims);
        if (!grid) fail('GATE_INVALID', 'Spider quad needs a finite display range on both axes');
        const R = grid.resolution;
        const [ax, ay] = grid.axes;
        const lattice = g.polygons.map((q) => q.map((v): [number, number] => [vertexCoord(ax, R, v[0]), vertexCoord(ay, R, v[1])]));
        const labels = spiderLabelGrid(R, lattice);
        const xs = this.dimension(g.dims[0]);
        const ys = this.dimension(g.dims[1]);
        for (let i = 0; i < n; i++) {
          if (Number.isNaN(xs[i]) || Number.isNaN(ys[i])) continue;
          out[i] = labels[eventCell(ax, R, xs[i]) * R + eventCell(ay, R, ys[i])] === g.slot ? 1 : 0;
        }
        return out;
      }
      case 'mask': {
        // FlowJo FileMaskGate: the events marked in the mask file (decoded
        // into bits when the gate is made; src/core/scriptApi.ts).
        const bits = maskFromBits(g.bits, n);
        out.set(bits);
        return out;
      }
      case 'anchored':
        // Bounds depend on statistics of other populations: resolved in run().
        return this.gateMask(this.anchoredGate(g, () => fail('GATE_INVALID', 'Anchored gate needs its statistic population')), ref);
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
