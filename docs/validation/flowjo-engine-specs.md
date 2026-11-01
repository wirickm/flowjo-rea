# FlowJo engine behavioral specs

Behavior of FlowJo's native analysis engine, written as specifications for an
independent implementation. Source: static analysis of `libNativeEngine.dylib`
from the public FlowJo 11.2.0 macOS x64 installer (see
`docs/reverse-engineering.md`). No FlowJo code, disassembly or decompiled
output is reproduced here.

Evidence labels follow `docs/compatibility-matrix.md`: *observed* (seen in the
binary or a FlowJo file), *derived* (reasoned from observations), *unknown*.

**Version caveat.** Every FlowJo-computed count available to this project
comes from FlowJo 10.6.2 to 10.10.0 (Java). These specs describe FlowJo
11.2.0 (C++). They have not been validated against any FlowJo 11 output, and
where tested below they do not reproduce the FlowJo 10 counts.

## 1. Polygon gates (FlowJo 11.2.0)

Status: *observed* (control flow and constants), not reference-validated.

Polygon membership is decided on a raster, not by an exact point-in-polygon
test on event values.

1. **Resolution.** Each polygon has a gate resolution `R` (the .wsp
   attribute `gateResolution`; schema default 256; every fixture polygon uses
   256). `R` must divide 4096 (the engine uses a right shift).
2. **Event cell.** For each axis, the event value is mapped to an index in
   0..4095 via the axis transform's 4096-entry lookup table (largest table
   edge at or below the value; values below the axis minimum map to 0, above
   the maximum to 4095). That index is shifted right by log2(4096 / R),
   giving a column `i` and row index `k` in 0..R-1. The mask row is flipped:
   `row = R - 1 - k`.
3. **Vertex snapping.** Each vertex is converted to integer grid units:
   - linear axes: `trunc((v - min) * R / (max - min))`;
   - other transforms: lookup-table index (as in step 2) times `R / 4096`,
     truncated;
   - the y axis is flipped (`trunc(R - u)`), so the polygon and the mask
     rows share the same orientation.
4. **Mask.** Cell `(i, row)` is in the gate if the lattice point
   `(i, row)` lies inside the snapped polygon or on its boundary:
   - scanline fill at each integer row between `ceil(minY + 1e-13)` and
     `floor(maxY - 1e-13)` (clamped to the grid): crossings use the half-open
     edge rule `y1 < y <= y2`; a horizontal edge lying on the scanline
     contributes both endpoints; crossings are sorted and paired, and the
     integer columns strictly between each pair (`ceil(c0 + 1e-13)` to
     `floor(c1 - 1e-13)`) are filled;
   - an edge pass then adds every lattice point lying exactly (within 1e-13)
     on an edge, walking edges in polygon orientation order (start vertex
     excluded, end vertex included). For gates attached to a quadrant
     (`quadId` 1 to 4) the edge pass excludes some boundary points depending
     on the quadrant; for `quadId = -1` (ordinary polygons) all boundary
     lattice points are included.
5. **Membership.** An event is in the gate when its cell is set.

Reference check (8_color_ICS.wsp, Singlets polygon, linear axes, parent count
equal to FlowJo's; FlowJo 10.6.2 reference): this spec gives about +1,520
events against FlowJo 10's count (our current exact test gives -595). The
same lattice with the boundary excluded gives -97. No rule tried at
resolution 256 or 4096 (cell centre, any corner, any overlap, half-open
boundary) reproduced FlowJo 10 exactly. Conclusion: FlowJo 10's polygon
semantics differ from FlowJo 11's, or a detail of the lookup-table edges is
still wrong (a 1/16-bin shift moves the Singlets count by roughly 400 events).

The point-in-polygon routine `ScalePointSet::PointInPoly` (used elsewhere,
not by gate computation) is an even-odd crossing test with the same half-open
rule, takes event coordinates as 32-bit floats, and counts points on edges and
vertices as inside.

## 2. Ellipse gates (FlowJo 11.2.0)

Status: *observed* (structure), not reference-validated.

- The ellipse's defining points (foci and edge points from the .wsp) are
  converted to integer grid units with the same snapping as polygon vertices
  (section 1, step 3) before the ellipse parameters are computed.
- Membership is analytic in that scaled space: with centre `(cx, cy)`, angle
  `t`, semi-axes `a` and `b`, an event at scaled `(x, y)` is inside when
  `((dx cos t + dy sin t) / a)^2 + ((dy cos t - dx sin t) / b)^2 <= 1`
  (boundary inclusive), where `dx = x - cx`, `dy = y - cy`.
- Not yet determined: the range `R` passed to the snapping for ellipses, and
  which stored field is `a` versus `b`. Snapping the defining points to an
  integer grid is a candidate explanation for the logicle ellipse gap (2-3%),
  untested.

## 3. Open items

- FlowJo 10 (the version that wrote every reference count) is a separate
  Java application. Its installer is not at a guessable public URL, so its
  polygon and ellipse rules are unknown.
- Statistic conventions (`GStatistics::Median`, `MedianExact`, `Percentile*`,
  `RobustCV*`) not yet analysed.
