// FlowJo 10.6.2 "Check Sample Quality" (WSCommand.CHECKSAMPLEQUALITY):
// docs/validation/ui-gaps/workspace.md. Behavioural rules decoded from
// WSSampleQualityAction, SampleQualityControl (Java) and the native engine's
// SampleValidity::ProcessQuery / CheckDataConsistency; implemented
// independently.
//
// Per parameter: the events are split, in acquisition order, into K equal
// segments (K from the event count); each segment's median channel is
// taken; a least-squares line through the K medians gives the trend
// slope, and ratio = |slope| * K / mean(medians) is the relative drift over
// the whole run. A parameter drifts when |ratio| > 0.01; with n drifting
// parameters the sample status follows floor(sqrt(n)).

export type QualityStatus = 'unchecked' | 'valid' | 'ok' | 'irregular' | 'flawed' | 'malformed';

// SampleQualityControl$QC: dictionary label and indicator colour.
export const QUALITY_LOOK: Record<QualityStatus, { label: string; color: string }> = {
  unchecked: { label: 'Unchecked', color: '#b6b6b6' },
  valid: { label: 'Valid', color: '#00ff00' },
  ok: { label: 'OK', color: '#0000ff' },
  irregular: { label: 'Irregular', color: '#ff00ff' },
  flawed: { label: 'Flawed', color: '#ffc800' },
  malformed: { label: 'Potentially malformed', color: '#ff0000' },
};

export const MIN_QUALITY_EVENTS = 2000;
export const TREND_RATIO_LIMIT = 0.01;

export interface ParameterCheck {
  name: string;
  numChannels: number;
  numInFirstChannels: number;
  numInLastChannels: number;
  minChannel: number;
  maxChannel: number;
  medians: number[];
  // KineticsThresholdCheck: mean and sample SD of the segment medians.
  kineticMean: number;
  kineticSd: number;
  // TrendThresholdCheck
  slope: number;
  mean: number;
  ratio: number;
}

export interface TimeCheck {
  sampleTime: number; // seconds ($BTIM to $ETIM)
  avgDeltaT: number; // (last - first time) / 50
  values: number[]; // time span of each of 50 equal event blocks
  biggestDeltaT: number;
  avgEventDeltaT: number; // mean positive time step between events
  rateSlope: number; // EventRateConsistency over the K segment time spans
  rateMean: number;
}

export interface SampleQualityResult {
  status: QualityStatus;
  message?: string;
  events: number;
  segments: number;
  params: ParameterCheck[];
  drifting: string[];
  time?: TimeCheck;
}

// Number of time segments (SampleValidity::CheckDataConsistency).
export function segmentCount(events: number): number {
  return events < 5000 ? 7 : events < 25000 ? 10 : events < 200000 ? 20 : events < 1000000 ? 30 : 40;
}

// Segments dropped at each end of the event-rate regression.
export function rateTrim(events: number): number {
  return events < 200000 ? 1 : 2;
}

// GParameter::GetChannelRange with the 4096-bucket cap of BasicHistogram:
// floating point (and ASCII) data use 4096 channels; integer data the power
// of two at or above $PnR, at most 4096.
export function qualityChannels(datatype: string | undefined, range: number): number {
  if (!(range > 0) || range > 4096) return 4096;
  const d = (datatype ?? 'F').trim().toUpperCase();
  if (d === 'F' || d === 'D' || d === 'A') return 4096;
  let p = 1;
  while (p < range) p *= 2;
  return Math.min(4096, p);
}

// BasicHistogram::ChannelMedian(false): the first channel whose cumulative
// count reaches half of the total (the last channel at most).
export function channelMedian(hist: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < hist.length; i++) total += hist[i];
  const target = total * 0.5;
  if (!(target > 0)) return 0;
  let sum = 0;
  let b = 0;
  for (; b < hist.length - 1; b++) {
    sum += hist[b];
    if (sum >= target) return b;
  }
  return Math.max(0, hist.length - 1);
}

// Least-squares line through y[0..n-1] at x = 1..n: slope and mean of y.
export function lineFit(y: ArrayLike<number>): { slope: number; mean: number } {
  const n = y.length;
  if (n === 0) return { slope: 0, mean: 0 };
  let sy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sy += y[i];
    sxy += (i + 1) * y[i];
  }
  if (n === 1) return { slope: 0, mean: sy };
  const sx = (n * (n + 1)) / 2;
  const sxx = (n * (n + 1) * (2 * n + 1)) / 6;
  return { slope: (n * sxy - sx * sy) / (n * sxx - sx * sx), mean: sy / n };
}

// One parameter. toChannel maps an event value to a channel 0..channels-1.
export function checkParameter(name: string, values: ArrayLike<number>, toChannel: (v: number) => number, channels: number, K = segmentCount(values.length)): ParameterCheck {
  const N = values.length;
  const bin = (v: number) => {
    const c = Math.floor(toChannel(v));
    return Number.isFinite(c) ? Math.min(channels - 1, Math.max(0, c)) : 0;
  };
  const whole = new Float64Array(channels);
  for (let i = 0; i < N; i++) whole[bin(values[i])]++;
  const seg = Math.floor(N / K);
  const medians: number[] = [];
  const h = new Float64Array(channels);
  for (let k = 0; k < K; k++) {
    h.fill(0);
    const start = k * seg;
    const end = Math.min(start + seg, N);
    for (let i = start; i < end; i++) h[bin(values[i])]++;
    medians.push(Math.trunc(channelMedian(h)));
  }
  const kineticMean = medians.reduce((a, b) => a + b, 0) / K;
  const kineticSd = K > 1 ? Math.sqrt(medians.reduce((a, m) => a + (m - kineticMean) ** 2, 0) / (K - 1)) : 0;
  const { slope, mean } = lineFit(medians);
  const ratio = K > 1 ? (Math.abs(slope) * K) / mean : 0;
  return {
    name, numChannels: channels, numInFirstChannels: whole[0], numInLastChannels: whole[channels - 1],
    minChannel: 1, maxChannel: channels - 1, medians, kineticMean, kineticSd, slope, mean, ratio,
  };
}

// SampleQualityControl.getStatusForQualityResponse.
export function statusFor(params: ParameterCheck[]): QualityStatus {
  const n = params.filter((p) => Math.abs(p.ratio) > TREND_RATIO_LIMIT).length;
  const k = Math.floor(Math.sqrt(n));
  return k > 8 ? 'malformed' : k > 4 ? 'flawed' : k > 2 ? 'irregular' : k > 0 ? 'ok' : 'valid';
}

// Time checks (SampleValidity::CheckDataConsistency, Time / LargeDeltaTimeCheck
// / EventRateConsistency elements). Run only when the sample lasted at least
// 20 seconds.
export function checkTime(t: ArrayLike<number>, sampleTime: number): TimeCheck | undefined {
  const N = t.length;
  if (N < 2 || !(sampleTime >= 20)) return undefined;
  let biggest = 0;
  let sum = 0;
  let pos = 0;
  for (let i = 1; i < N; i++) {
    const d = t[i] - t[i - 1];
    if (d > biggest) biggest = d;
    if (d > 0) { sum += d; pos++; }
  }
  const values: number[] = [];
  for (let i = 0; i < 50; i++) {
    const a = Math.floor(i * N * 0.02);
    const b = Math.max(a, Math.floor((i + 1) * N * 0.02) - 1);
    values.push(t[Math.min(b, N - 1)] - t[Math.min(a, N - 1)]);
  }
  const K = segmentCount(N);
  const trim = rateTrim(N);
  const edges: number[] = [];
  for (let k = 0; k < K; k++) edges.push(t[Math.floor((k * N) / K)]);
  edges.push(t[N - 1]);
  const spans = edges.slice(1).map((e, k) => e - edges[k]);
  const fit = lineFit(spans.slice(trim, K - trim));
  return {
    sampleTime, avgDeltaT: (t[N - 1] - t[0]) * 0.02, values, biggestDeltaT: biggest,
    avgEventDeltaT: pos ? sum / pos : 0, rateSlope: fit.slope, rateMean: fit.mean,
  };
}

export interface QualityInput {
  events: number;
  params: { name: string; values: ArrayLike<number>; toChannel: (v: number) => number; channels: number }[];
  time?: ArrayLike<number>;
  sampleTime?: number;
}

export function checkSampleQuality(inp: QualityInput): SampleQualityResult {
  const K = segmentCount(inp.events);
  if (inp.events < MIN_QUALITY_EVENTS) {
    // The engine answers with a failure element and no parameter checks,
    // which SampleQualityControl reads as Valid.
    return { status: 'valid', message: 'Too few events to check validity.', events: inp.events, segments: K, params: [], drifting: [] };
  }
  const params = inp.params.map((p) => checkParameter(p.name, p.values, p.toChannel, p.channels, K));
  return {
    status: statusFor(params), events: inp.events, segments: K, params,
    drifting: params.filter((p) => Math.abs(p.ratio) > TREND_RATIO_LIMIT).map((p) => p.name),
    time: inp.time ? checkTime(inp.time, inp.sampleTime ?? 0) : undefined,
  };
}

// $BTIM / $ETIM (hh:mm:ss[.cc]) to elapsed seconds; 0 when unknown.
export function elapsedSeconds(btim?: string, etim?: string): number {
  const secs = (s?: string) => {
    const m = /^(\d+):(\d+):(\d+)(?:[.:](\d+))?/.exec((s ?? '').trim());
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
  };
  const d = secs(etim) - secs(btim);
  return Number.isFinite(d) ? (d < 0 ? d + 86400 : d) : 0;
}

// Parameters the check covers: every data parameter except Time (the engine
// skips the time and non-data parameters).
export function qualityParameters(names: string[]): string[] {
  return names.filter((n) => !/^time$/i.test(n));
}
