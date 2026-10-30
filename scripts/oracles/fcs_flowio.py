# Independent FCS oracle using flowio (BSD-3). Emits per-channel stats and first rows.
import sys, json, flowio, numpy as np
out = {}
for path in sys.argv[2:]:
    try:
        f = flowio.FlowData(path, ignore_offset_discrepancy=True, ignore_offset_error=True)
    except TypeError:
        f = flowio.FlowData(path)
    ev = np.reshape(np.array(f.events, dtype=float), (-1, f.channel_count))
    out[path.split('/')[-1]] = {
        'count': int(f.event_count),
        'names': list(f.pnn_labels),
        'sums': ev.sum(axis=0).tolist(),
        'first': ev[:3].tolist(),
        'last': ev[-1].tolist(),
    }
json.dump(out, open(sys.argv[1], 'w'))
