// Create Calibration Parameter (PlatformNavCommand.CALIBRATION). FlowJo
// 10.6.2 ships only the command and its dictionary strings (plat.calibration.*):
// NodeFactory.doPlatform has no branch for it, so the command does nothing.
// This app's own rule (spec docs/validation/ui-gaps/platforms.md): a MESF
// bead regression log10(MESF) = a + b log10(MFI) over the peaks the user
// enters, saved as a derived parameter MESF = 10^a * X^b.
export interface CalibrationPeak { mfi: number; mesf: number }
export interface CalibrationFit { slope: number; intercept: number; r: number; n: number }

export function fitCalibration(peaks: CalibrationPeak[]): CalibrationFit | null {
  const pts = peaks.filter((p) => p.mfi > 0 && p.mesf > 0).map((p) => [Math.log10(p.mfi), Math.log10(p.mesf)]);
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : 1, n };
}

// The derived-parameter formula (src/core/formula.ts syntax).
export function calibrationFormula(channel: string, f: CalibrationFit): string {
  // Plain decimals only: the formula parser would split "1e-5" at the sign.
  const dec = (v: number) => { const s = String(Number(v.toPrecision(8))); return s.includes('e') ? v.toFixed(20).replace(/0+$/, '') : s; };
  return `${dec(10 ** f.intercept)}*${channel}^${dec(f.slope)}`;
}
// Derived parameter names allow letters, digits and underscore only.
export function calibrationName(channel: string): string {
  return `${channel.replace(/[^A-Za-z0-9_]/g, '_')}_MESF`;
}
