// Gate actions on the selected population (FlowJo 10.6.2, specs 10): the
// Magnetic toggle, "Convert to" polygon / rectangle / ellipse, workspace copy
// and paste, and "Manually Enter Gate..." (rectangle or range from typed
// bounds, optionally quads or a bisector at the lower bounds).
import { useState } from 'react';
import { bisectorNames, convertGate, firstQuadNumber, gateLabel, quadNames, type ConvertTo } from '../core/gateTools';
import { uniqueName, type Dimension, type Gate, type Population } from '../core/model';
import type { Axis } from './gateGeometry';

interface Props {
  pop: Population | null;
  populations: Population[];
  canPaste: boolean;
  onMagnetic: (on: boolean) => void;
  onConvert: (gate: Gate) => void;
  onCopy: () => void;
  onPaste: () => void;
}

export function GateActions(p: Props) {
  const g = p.pop?.gate;
  const convertible = (to: ConvertTo) => !!g && convertGate(g, to) !== null;
  return (
    <div className="row" data-testid="gate-actions">
      <label title="The gate relocates to where the events are densest (FlowJo: Magnetic)">
        <input type="checkbox" data-testid="gate-magnetic" disabled={!g || g.type === 'boolean'} checked={!!p.pop?.magnetic} onChange={(e) => p.onMagnetic(e.target.checked)} /> Magnetic
      </label>
      <select data-testid="gate-convert" value="" disabled={!g || !(['polygon', 'rect', 'ellipse'] as ConvertTo[]).some(convertible)} onChange={(e) => {
        const to = e.target.value as ConvertTo;
        const out = g && convertGate(g, to);
        if (out) p.onConvert(out);
      }}>
        <option value="">Convert to...</option>
        <option value="polygon" disabled={!convertible('polygon')}>to Poly</option>
        <option value="rect" disabled={!convertible('rect')}>to Rect</option>
        <option value="ellipse" disabled={!convertible('ellipse')}>to Ellipse</option>
      </select>
      <button data-testid="gate-copy" disabled={!p.pop} onClick={p.onCopy} title="Copy the population, its children and sibling quads">Copy</button>
      <button data-testid="gate-paste" disabled={!p.canPaste} onClick={p.onPaste} title="Paste under the selected population (coordinates unchanged)">Paste</button>
    </div>
  );
}

// "Manually Enter Gate..." (ManualGateDP): Lower / Upper per axis in scale
// (intensity) units, pinned into the parameter's range; a 2-D rectangle or
// a 1-D range named "<x>[, <y>] subset", or quads / a bisector at the lower
// bounds. Values are typed in data units and converted to the axis scale.
export function ManualGateDialog(p: { x: Axis; y: Axis | null; xRange: [number, number]; yRange: [number, number] | null; xLabel: string; yLabel: string; children: string[]; onCreate: (gates: { name: string; gate: Gate }[]) => void; onClose: () => void }) {
  const [v, setV] = useState({ x0: '', x1: '', y0: '', y1: '' });
  const [quads, setQuads] = useState(false);
  const pin = (s: string, r: [number, number]) => Math.min(r[1], Math.max(r[0], Number(s)));
  const ok = [v.x0, v.x1, ...(p.y ? [v.y0, v.y1] : [])].every((s) => s.trim() !== '' && Number.isFinite(Number(s))) || (quads && v.x0.trim() !== '' && (!p.y || v.y0.trim() !== ''));
  const dim = (a: Axis): Dimension => ({ kind: 'channel', channel: a.channel, transform: a.spec });
  const create = () => {
    const X = dim(p.x), Y = p.y ? dim(p.y) : null;
    const ax = (s: string) => p.x.t.apply(pin(s, p.xRange));
    const ay = (s: string) => p.y!.t.apply(pin(s, p.yRange!));
    if (quads) {
      if (!Y) {
        const [lo, hi] = bisectorNames(p.xLabel, p.x.channel, p.children);
        const at = ax(v.x0);
        p.onCreate([{ name: lo, gate: { type: 'rect', dims: [X], min: [null], max: [at] } }, { name: hi, gate: { type: 'rect', dims: [X], min: [at], max: [null] } }]);
      } else {
        const names = quadNames(firstQuadNumber(p.children), p.xLabel, p.yLabel);
        const c: [number, number] = [ax(v.x0), ay(v.y0)];
        const mk = (sxi: number, syi: number, name: string) => ({ name, gate: { type: 'quadrant' as const, dims: [X, Y], dividers: [[c[0]], [c[1]]], side: [sxi, syi] } });
        p.onCreate([mk(0, 0, names[2]), mk(1, 0, names[3]), mk(0, 1, names[0]), mk(1, 1, names[1])]);
      }
    } else {
      const xs = [ax(v.x0), ax(v.x1)].sort((a, b) => a - b);
      const name = uniqueName(`${p.x.channel}${p.y ? `, ${p.y.channel}` : ''} subset`, p.children);
      if (!Y) p.onCreate([{ name, gate: { type: 'rect', dims: [X], min: [xs[0]], max: [xs[1]] } }]);
      else {
        const ys = [ay(v.y0), ay(v.y1)].sort((a, b) => a - b);
        p.onCreate([{ name, gate: { type: 'rect', dims: [X, Y], min: [xs[0], ys[0]], max: [xs[1], ys[1]] } }]);
      }
    }
    p.onClose();
  };
  const field = (k: keyof typeof v, label: string) => (
    <label>{label} <input data-testid={`manual-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} size={10} /></label>
  );
  return (
    <div className="dialog" role="dialog" aria-label="Manually Enter Gate">
      <h3>Manually Enter Gate</h3>
      <p className="muted">{p.x.channel} ({p.xRange[0]} - {p.xRange[1]})</p>
      <div className="row">{field('x0', 'Lower')}{field('x1', 'Upper')}</div>
      {p.y && p.yRange && (<>
        <p className="muted">{p.y.channel} ({p.yRange[0]} - {p.yRange[1]})</p>
        <div className="row">{field('y0', 'Lower')}{field('y1', 'Upper')}</div>
      </>)}
      <label><input type="checkbox" data-testid="manual-quads" checked={quads} onChange={(e) => setQuads(e.target.checked)} /> {p.y ? 'Make Quad Gates' : 'Make Bisector Gates'}</label>
      <div className="row">
        <button data-testid="manual-ok" disabled={!ok} onClick={create}>OK</button>
        <button onClick={p.onClose}>Cancel</button>
      </div>
    </div>
  );
}

