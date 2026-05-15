# Gradient Triangle Mesh — Design

**Date:** 2026-05-15
**Status:** Approved, pending implementation plan
**Scope:** Replace the flat `H3HexagonLayer` score visualization with a GPU-interpolated triangle mesh that produces a true heatmap look. High-zoom branch only; the občina low-zoom view and the population HeatmapLayer view are untouched.

## Motivation

The current 15-min score view renders each H3 cell as a flat-shaded hexagon (`H3HexagonLayer`, `colorForScore`). Hard band boundaries (🟢 6-8 / 🟡 4-5 / 🟠 2-3 / 🔴 0-1) make the scoring look discrete when in reality the underlying score is a continuous 0-8 value. A vertex-interpolated mesh communicates the continuity and reads as a proper heatmap.

## Visual spec

For each populated H3 cell, draw six triangles fanning out from the cell's centroid to the centroids of consecutive neighbors:

- Triangle `i`: `[center, neighbor[i], neighbor[(i + 1) mod 6]]`.
- The vertex at `center` is colored by the cell's own score.
- The two outer vertices are colored by their respective neighbors' scores.
- WebGL barycentric interpolation gives a smooth gradient across each triangle.
- If a neighbor is **not present** in the score dataset (edge of Slovenia, water, unpopulated), its vertex position is still computed (h3.cellToLatLng works for any valid h3 id) but its color is `[0, 0, 0, 0]` — alpha 0, so the triangle fades smoothly to fully transparent at that corner.

The result tiles seamlessly: every triangle is shared geometrically (different mesh, but same vertex positions) between two neighboring hexes; the gradient is continuous everywhere a hex meets a hex.

## Interaction spec

- **Picking**: triangle mesh itself is not pickable. A second `H3HexagonLayer` is rendered above it with `getFillColor: [0,0,0,0]` and `pickable: true`. deck.gl's picking pass is independent of fill alpha, so this is invisible to the eye but fully clickable.
- **Hover dot**: a single small dot is rendered at the hovered cell's centroid. Not shown by default — only appears on hover. Confirms "this is clickable" without permanent visual clutter.
- **Selected cell**: thick dark outline (stroke-only) on the hexagon. The current full-fill highlight is dropped because it would fight the smooth gradient.

## Zoom behavior

- The existing `aggregatedScores` memo aggregates H3 cells to the current zoom-driven resolution (`zoomToResolution`, mapping zoom 7→15+ to H3 res 6-10). The gradient mesh consumes this aggregated set unchanged.
- Below `SHOW_OBCINE_FILL_BELOW` (zoom < 9) the občina polygon layer continues to take over. Triangle mesh is not rendered there.
- Population view (`view === "population"`) is unaffected — that path uses `HeatmapLayer` and is untouched.

## Architecture

### New files

- **`frontend/lib/H3GradientMeshLayer.ts`** — custom deck.gl `Layer` (extends `@deck.gl/core` `Layer`). Renders a single non-indexed triangle list with two vertex attributes. Pure renderer; takes pre-built typed-array buffers as props.

- **`frontend/lib/gradientMesh.ts`** — pure functions:
  - `buildGradientMesh(cells: ScoreCell[], mode: Mode): { positions: Float32Array; colors: Uint8Array; vertexCount: number }`
  - `colorForScoreContinuous(score: number): [number, number, number]`

### Modified files

- **`frontend/components/Map.tsx`** — the high-zoom branch (the `else` after `showObcineFill` / `view === "population"`) is restructured. One new state, one new memo, and the layer list for that branch is reshaped. Everything else in the file is untouched.

## Custom layer details: `H3GradientMeshLayer`

**Props**
```ts
type H3GradientMeshLayerProps = {
  id: string;
  positions: Float32Array;   // [lng, lat, lng, lat, ...]
  colors: Uint8Array;        // [r, g, b, a, ...] per vertex
  vertexCount: number;       // total triangle vertices (= 18 × #cells in the worst case)
};
```

**Attribute manager** registers two vertex attributes:
- `positions`: size 2, FLOAT, not normalized.
- `colors`: size 4, UNSIGNED_BYTE, normalized (so the shader sees 0-1 floats).

**Shaders** (GLSL 3.00 ES, deck.gl v9):

```glsl
// vertex
in vec2 positions;
in vec4 colors;
out vec4 vColor;
void main() {
  vec3 p = vec3(positions, 0.0);
  gl_Position = project_position_to_clipspace(p);
  vColor = colors;
}

// fragment
in vec4 vColor;
out vec4 fragColor;
void main() {
  fragColor = vColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
```

Uses the `project32` shader module so projection matches every other deck.gl layer. **No picking module** — the invisible `H3HexagonLayer` above handles picking.

**Lifecycle**
- `initializeState()`: build a `Model` with the two attributes and `TRIANGLES` draw mode.
- `updateState()`: when `props.positions`/`props.colors` change identity, push the new typed arrays into the attribute buffers and update `vertexCount`.
- `draw()`: single `this.state.model.draw(...)` call.

## Mesh build: `buildGradientMesh`

Algorithm (called inside `useMemo`):

1. Build `scoreByH3: Map<string, number>` from input cells, choosing `c.w` or `c.b` based on `mode`.
2. Build `centroidCache: Map<string, [number, number]>` lazily — populated on demand via `h3.cellToLatLng` (swap `[lat, lng]` → `[lng, lat]`).
3. For each cell:
   - Get 6 neighbors via `h3.gridRingUnsafe(cell.h3, 1)`. Wrap in `try/catch` — `gridRingUnsafe` throws at H3 pentagons (12 globally, none near Slovenia, but the guard is cheap).
   - The returned ring is in deterministic cyclic order.
   - For `i = 0..5`, emit triangle `[center, neighbor[i], neighbor[(i + 1) % 6]]` into the output arrays.
   - For each vertex, look up its h3 in `scoreByH3`:
     - **Hit**: color = `[...colorForScoreContinuous(score), 128]` (alpha 128 matches the current `colorForScore` opacity).
     - **Miss**: color = `[0, 0, 0, 0]` (transparent corner — smooth fade to basemap).
   - Positions are always written from `centroidCache`, regardless of dataset membership.
4. Return the two typed arrays plus `vertexCount = 18 × cells.length` (worst case; in practice fewer if any cells were skipped as pentagons).

### `colorForScoreContinuous`

Piecewise-linear interpolation across four anchor RGB values that match the existing `colorForScore` palette:

| Score | RGB |
|-------|-----|
| 0     | `[239, 68, 68]`  (red) |
| 2     | `[249, 115, 22]` (orange) |
| 4     | `[234, 179, 8]`  (yellow) |
| 6     | `[16, 185, 129]` (green) |
| 8     | `[16, 185, 129]` (clamped — same as 6) |

Input is clamped to `[0, 8]`. Alpha is **not** returned by this function — appended at the call site so the mesh-builder controls opacity.

The existing stepped `colorForScore` is kept for the občina low-zoom layer (band legibility on large polygons is preferable there) and the existing legend.

## `Map.tsx` integration

**New state**:
```ts
const [hoveredCell, setHoveredCell] = useState<string | null>(null);
```

**New memo** placed alongside `aggregatedScores`:
```ts
const gradientMesh = useMemo(
  () => buildGradientMesh(aggregatedScores, mode),
  [aggregatedScores, mode],
);
```

**Layer composition in the high-zoom branch** (replaces the current single `H3HexagonLayer` + selected-hex fill):

1. `GeoJsonLayer` `id: "obcine-outline"` — **unchanged** (existing low-stroke občina overlay).
2. `H3GradientMeshLayer` `id: "scores-gradient"` — `{ positions, colors, vertexCount }` from `gradientMesh`. `pickable: false`.
3. `H3HexagonLayer` `id: "scores-pick"` — `data: aggregatedScores`, `pickable: true`, `getFillColor: [0,0,0,0]`, `stroked: false`, `extruded: false`. `onClick` is the existing handler verbatim (resolves aggregated → res-10 child, clears origin, sets `selectedH3`). `onHover: ({ object }) => setHoveredCell(object?.h3 ?? null)`.
4. `ScatterplotLayer` `id: "hover-dot"` — `data: hoveredCell ? [{ h3: hoveredCell }] : []`. `getPosition: d => { const [lat, lng] = h3.cellToLatLng(d.h3); return [lng, lat]; }`. `getRadius: 5`, `radiusUnits: "pixels"`, `radiusMinPixels: 4`. Fill `[255, 255, 255, 220]`, stroke `[17, 24, 39, 220]`, `lineWidthMinPixels: 1.5`. `pickable: false`.
5. `H3HexagonLayer` `id: "selected-hex"` — kept but reconfigured to stroke-only: `filled: false`, `stroked: true`, `getLineColor: [17, 24, 39, 255]`, `getLineWidth: 2.5`, `lineWidthUnits: "pixels"`, `lineWidthMinPixels: 2.5`. The old fill-color derivation (`parent`, `matchingScore`, `[hr, hg, hb]`) is removed.

**Layer-build effect deps**: add `gradientMesh` and `hoveredCell`; the existing `aggregatedScores`, `mode`, `selectedH3` etc. stay.

## Performance budget

- **Mesh size**: worst case (res-10, ~100k visible cells) = 100,000 × 6 triangles × 3 vertices = 1.8 M vertices.
  - Position buffer: 1.8 M × 2 floats × 4 bytes ≈ 14.4 MB.
  - Color buffer: 1.8 M × 4 bytes ≈ 7.2 MB.
  - Total ≈ 22 MB. Within budget.
- **Build time**: ~600 k hashmap lookups + ~100 k `gridRingUnsafe` calls. Estimated 150-400 ms on a typical laptop, single-threaded JS. Runs inside `useMemo`, off the render path.
- **Triggered by**: zoom changes that flip `currentRes` (rare), or walk/bike toggle (rare). Not on every pan / frame.
- **GPU**: single draw call, two attributes, no per-fragment branching. Trivial for any device.

If 150-400 ms hitches end up noticeable in practice, optimization paths: (a) move the build into a web worker, (b) switch to indexed geometry (5× smaller buffers), (c) memoize per-cell triangles and only rebuild changed cells. None of these are needed in v1.

## Edge cases

- **Pentagons**: 12 globally, none in Slovenia. `gridRingUnsafe` throws on them; catch and skip. Worst case the user sees a single missing hex on a pentagon, which can't happen for Slovenia's territory anyway.
- **Isolated cells** (cell present, no neighbors in dataset): all 6 outer vertices have alpha 0, center has the score color. Renders as a single faded disc. Acceptable.
- **Edge of Slovenia**: cells along the border have 1-4 missing neighbors. The mesh fades smoothly on those sides, producing a natural soft edge rather than a hard hexagonal cutoff.
- **Antimeridian**: not a concern — Slovenia is 13-17° E, nowhere near.
- **Walk/bike toggle**: triggers a fresh `buildGradientMesh` call via the memo dep. Sub-second rebuild is acceptable for a deliberate user action.

## What this design does not change

- The občina low-zoom view (`zoom < SHOW_OBCINE_FILL_BELOW`) — still uses `colorForScore` and `GeoJsonLayer`.
- The population view — `HeatmapLayer` is independent.
- The score dataset format, ETL, or backend.
- The legend (the four bands still make sense as a key to the gradient — the gradient passes through those exact anchor colors).
- Path animation, amenity dots, isochrone overlay, origin pin — all independent layers, untouched.
- Permalink, address search, scorecard, theme toggle — all independent.

## Open questions

None. All four design sections approved by the user during brainstorming.

## Acceptance criteria

- [ ] At zoom 9-15+, score view renders as a smoothly-interpolated heatmap with no visible hexagon edges where neighbors exist.
- [ ] Cells at the edge of the dataset fade smoothly to transparent, not a hard hex edge.
- [ ] Hovering a cell shows a single small dot at its centroid; the dot disappears when leaving the cell.
- [ ] Clicking anywhere within a cell's hexagonal footprint opens the Scorecard for that cell (same behavior as today).
- [ ] Selected cell is highlighted by a thick dark outline (no fill).
- [ ] Walk/bike toggle switches scores instantly (sub-second).
- [ ] Občina low-zoom view and population view are visually identical to today.
- [ ] `pnpm typecheck` and `pnpm build` pass.
