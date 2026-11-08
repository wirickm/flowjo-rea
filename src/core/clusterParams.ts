// FlowJo 10.6.2 "Consensus Gate" (WSCommand.CONSENSUS_DP) and "Cluster
// Frequency" (WSCommand.CLUSTER_FREQ_DP) derived parameters. Java side:
// WorkspaceAction -> FlowCAPUtil.createClusterComparisonParameter /
// createClusterConsensusParameter / doClusterComparisonQuery choose the
// populations and the name; the native engine computes the values
// (Sample::CreateConsensusGateParameter, Sample::CreateClusterFrequencyParameter).
// Spec: docs/validation/ui-gaps/workspace.md section O. Implemented independently.

// Parameter name: each population name followed by "." (primary first for
// Cluster Frequency), then "Consensus" or "ClusterFreq".
export function clusterParamName(type: 'consensus' | 'clusterFrequency', names: string[]): string {
  return names.map((n) => `${n}.`).join('') + (type === 'clusterFrequency' ? 'ClusterFreq' : 'Consensus');
}

// Consensus: the fraction of the populations that contain the event; an event
// in none gets 0.001 instead of 0. Values are stored as float32.
export function consensusColumn(masks: Uint8Array[], n: number): Float64Array {
  const out = new Float64Array(n);
  const k = masks.length;
  for (let i = 0; i < n; i++) {
    if (!k) { out[i] = Math.fround(0.001); continue; }
    let c = 0;
    for (const m of masks) c += m[i];
    const v = c * (1 / k);
    out[i] = Math.fround(v === 0 ? v + 0.001 : v);
  }
  return out;
}

// Cluster Frequency: events outside the primary population get 10; events in
// it get 30 + 100 * (fraction of the other populations containing them), or 30
// when there are no other populations. Every value is then multiplied by
// (float)(3723.636282928721 / largest value) so the largest becomes ~3723.6.
export function clusterFrequencyColumn(primary: Uint8Array, others: Uint8Array[], n: number): Float64Array {
  const out = new Float64Array(n);
  const k = others.length;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    let v = 10;
    if (primary[i]) {
      if (k < 1) v = 30;
      else {
        let c = 0;
        for (const m of others) c += m[i];
        v = c * (1 / k) * 100 + 30;
      }
    }
    out[i] = Math.fround(v);
    if (out[i] > max) max = out[i];
  }
  if (n > 0) {
    const f = Math.fround(3723.636282928721 / max);
    for (let i = 0; i < n; i++) out[i] = Math.fround(out[i] * f);
  }
  return out;
}

// Population choice (FlowCAPUtil): Consensus uses the selected populations
// of one sample and needs at least two; Cluster Frequency uses the focused
// population as the primary and the other selected populations of the same
// sample, and needs at least one other.
export function clusterSelectionError(type: 'consensus' | 'clusterFrequency', count: number): string | null {
  if (type === 'consensus') return count < 2 ? 'Select at least two populations of one sample.' : null;
  return count < 2 ? 'Select the primary population and at least one other population of the same sample.' : null;
}
