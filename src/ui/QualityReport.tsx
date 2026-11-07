// Sample quality report (the Sample Quality part of FlowJo's PropertiesDialog,
// fed by SampleQualityControl.getTrendConsistency / getKineticConsistency /
// getEventRate2): docs/validation/ui-gaps/workspace.md.
import { QUALITY_LOOK, TREND_RATIO_LIMIT, type SampleQualityResult } from '../core/sampleQuality';

const g = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(4)) : String(v));

export function QualityReport(p: { name: string; result: SampleQualityResult; onClose: () => void }) {
  const r = p.result;
  const look = QUALITY_LOOK[r.status];
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal wide" role="dialog" aria-label="Sample Quality" data-testid="quality-report">
        <div className="modal-head"><b>Sample Quality - {p.name}</b><button onClick={p.onClose} aria-label="Close" data-testid="quality-close">x</button></div>
        <div className="modal-body">
          <p>Sample quality: <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: look.color, border: '1px solid #555' }} />{' '}
            <b data-testid="quality-status">{look.label}</b> ({r.events} events, {r.segments} time segments; drifting parameters: <span data-testid="quality-drifting">{r.drifting.length ? r.drifting.join(', ') : 'none'}</span>)</p>
          {r.message && <p className="warn" data-testid="quality-message">{r.message}</p>}
          {r.params.length > 0 && (
            <table className="grid" data-testid="quality-table">
              <thead><tr><th>Parameter</th><th>Trend (slope / mean = ratio)</th><th>Kinetic (mean +/- SD)</th><th>Segment medians</th><th>First / last channel</th></tr></thead>
              <tbody>{r.params.map((q) => (
                <tr key={q.name} data-testid={`quality-row-${q.name}`} style={{ color: Math.abs(q.ratio) > TREND_RATIO_LIMIT ? '#b00' : undefined }}>
                  <td>{q.name}</td><td>{g(q.slope)} / {g(q.mean)} = {g(q.ratio)}</td><td>{g(q.kineticMean)} +/- {g(q.kineticSd)}</td>
                  <td style={{ fontSize: 10 }}>{q.medians.join(' ')}</td><td>{q.numInFirstChannels} / {q.numInLastChannels}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {r.time && (
            <p data-testid="quality-time">Sample time: {r.time.sampleTime} s; time per 1/50 of the events: {g(r.time.avgDeltaT)}; largest time step: {g(r.time.biggestDeltaT)};
              event rate trend: slope {g(r.time.rateSlope)}, mean {g(r.time.rateMean)}</p>
          )}
          <button onClick={p.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
