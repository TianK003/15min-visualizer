# Gradient Triangle Mesh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `H3HexagonLayer` score fill at high zoom with a GPU vertex-interpolated triangle mesh, while keeping click + hover + selection behavior intact.

**Architecture:** A new custom deck.gl `Layer` (`H3GradientMeshLayer`) renders a non-indexed triangle list with per-vertex `positions` + `colors` attributes — WebGL handles the gradient. A pure mesh-builder (`buildGradientMesh`) generates the two typed arrays from the existing `aggregatedScores`. Picking is delegated to an invisible `H3HexagonLayer` sibling. A `ScatterplotLayer` shows a small dot at the hovered cell's centroid. The selected-cell highlight becomes a stroke-only outline.

**Tech Stack:** Next.js 14 App Router, TypeScript, deck.gl v9 (`@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/geo-layers`, `@deck.gl/mapbox`), luma.gl v9, h3-js v4, MapLibre GL v4. No test framework — verification is `pnpm typecheck`, `pnpm build`, and visual eyeball via `pnpm dev`.

**Spec:** `docs/superpowers/specs/2026-05-15-gradient-triangle-mesh-design.md`

---

## File Structure

```
frontend/
├── lib/
│   ├── gradientMesh.ts          # NEW — pure functions: colorForScoreContinuous, buildGradientMesh
│   └── H3GradientMeshLayer.ts   # NEW — custom deck.gl Layer with vs/fs shaders
└── components/
    └── Map.tsx                  # MODIFIED — high-zoom branch only
```

**Responsibilities:**
- `gradientMesh.ts` — pure data transformations. No deck.gl imports. Easily testable / inspectable.
- `H3GradientMeshLayer.ts` — pure renderer. Takes typed arrays as props. No h3 logic.
- `Map.tsx` — composition. The high-zoom branch in the layer-build effect (currently lines 561-630) is restructured; everything else is untouched.

---

### Task 1: Color gradient function

**Files:**
- Create: `frontend/lib/gradientMesh.ts`

- [ ] **Step 1: Create the file with `colorForScoreContinuous`**

Write the file with this content:

```typescript
// Piecewise-linear color ramp matching the existing stepped `colorForScore`
// anchors at 0/2/4/6/8. Returns RGB only — alpha is appended at call sites
// so the mesh builder controls opacity.

type Rgb = [number, number, number];

const ANCHORS: Array<{ score: number; rgb: Rgb }> = [
  { score: 0, rgb: [239, 68, 68] },    // red
  { score: 2, rgb: [249, 115, 22] },   // orange
  { score: 4, rgb: [234, 179, 8] },    // yellow
  { score: 6, rgb: [16, 185, 129] },   // green
  { score: 8, rgb: [16, 185, 129] },   // clamps from 6 onward
];

export function colorForScoreContinuous(score: number): Rgb {
  const s = Math.max(0, Math.min(8, score));
  for (let i = 1; i < ANCHORS.length; i++) {
    const a = ANCHORS[i - 1];
    const b = ANCHORS[i];
    if (s <= b.score) {
      const span = b.score - a.score;
      const t = span === 0 ? 0 : (s - a.score) / span;
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }
  return ANCHORS[ANCHORS.length - 1].rgb;
}
```

- [ ] **Step 2: Type-check**

Run from `frontend/`:
```
pnpm typecheck
```
Expected: exits cleanly, zero errors.

- [ ] **Step 3: Spot-check the function**

Run from `frontend/`:
```
node -e "const {colorForScoreContinuous} = require('./lib/gradientMesh.ts'); console.log(colorForScoreContinuous(0), colorForScoreContinuous(3), colorForScoreContinuous(6), colorForScoreContinuous(8));"
```

(If `node` can't load `.ts` directly in this project, skip this step and verify visually in Task 4.)

Expected sanity check: `[239,68,68]` at score 0, something between orange and yellow at score 3 (around `[242, 147, 15]`), green `[16,185,129]` at 6 and 8.

- [ ] **Step 4: Commit**

```
git add frontend/lib/gradientMesh.ts
git commit -m "Add colorForScoreContinuous gradient ramp for triangle mesh"
```

---

### Task 2: Mesh builder

**Files:**
- Modify: `frontend/lib/gradientMesh.ts` (append `buildGradientMesh`)

- [ ] **Step 1: Append the mesh builder**

Add to `frontend/lib/gradientMesh.ts` (after `colorForScoreContinuous`):

```typescript
import * as h3 from "h3-js";

export type ScoreCell = { h3: string; w: number; b: number };
export type Mode = "walk" | "bike";

export type GradientMesh = {
  positions: Float32Array;  // [lng, lat, lng, lat, ...]
  colors: Uint8Array;       // [r, g, b, a, ...] per vertex
  vertexCount: number;
};

// Alpha used for fully-present vertices. Matches the existing flat fill's
// alpha (128) so the gradient mesh reads at the same intensity as before.
const VERTEX_ALPHA = 128;

export function buildGradientMesh(cells: ScoreCell[], mode: Mode): GradientMesh {
  // Score lookup keyed by h3id; mode selects the walk vs bike score column.
  const scoreByH3 = new Map<string, number>();
  for (const c of cells) {
    scoreByH3.set(c.h3, mode === "bike" ? c.b : c.w);
  }

  // Centroid cache reused for the cell and its neighbors across iterations —
  // each neighbor's centroid is hit roughly 7 times across the full pass.
  const centroidCache = new Map<string, [number, number]>();
  const centroidOf = (id: string): [number, number] => {
    let p = centroidCache.get(id);
    if (!p) {
      const [lat, lng] = h3.cellToLatLng(id);
      p = [lng, lat];
      centroidCache.set(id, p);
    }
    return p;
  };

  // Pre-allocate: 6 triangles × 3 vertices × cells.length, worst case.
  const maxVerts = cells.length * 6 * 3;
  const positions = new Float32Array(maxVerts * 2);
  const colors = new Uint8Array(maxVerts * 4);
  let v = 0; // vertex index

  const writeVertex = (id: string, fallbackPos: [number, number] | null) => {
    const pos = fallbackPos ?? centroidOf(id);
    positions[v * 2] = pos[0];
    positions[v * 2 + 1] = pos[1];
    const score = scoreByH3.get(id);
    if (score === undefined) {
      // Missing neighbor — transparent corner. RGB is irrelevant but zero it
      // for cleanliness (avoids any blend artifact at alpha 0).
      colors[v * 4] = 0;
      colors[v * 4 + 1] = 0;
      colors[v * 4 + 2] = 0;
      colors[v * 4 + 3] = 0;
    } else {
      const [r, g, b] = colorForScoreContinuous(score);
      colors[v * 4] = r;
      colors[v * 4 + 1] = g;
      colors[v * 4 + 2] = b;
      colors[v * 4 + 3] = VERTEX_ALPHA;
    }
    v++;
  };

  for (const cell of cells) {
    let ring: string[];
    try {
      // gridRingUnsafe returns the 6 neighbors in deterministic cyclic order.
      // It throws on H3 pentagons (12 globally, none in Slovenia) — skip them.
      ring = h3.gridRingUnsafe(cell.h3, 1);
    } catch {
      continue;
    }
    if (ring.length !== 6) continue;

    const centerPos = centroidOf(cell.h3);

    for (let i = 0; i < 6; i++) {
      const nA = ring[i];
      const nB = ring[(i + 1) % 6];
      writeVertex(cell.h3, centerPos);
      writeVertex(nA, null);
      writeVertex(nB, null);
    }
  }

  // If we skipped any pentagons, the tail of the buffer is unused. Slice to
  // the actual written length so the GPU doesn't draw zero-area junk triangles.
  return {
    positions: v === maxVerts ? positions : positions.slice(0, v * 2),
    colors: v === maxVerts ? colors : colors.slice(0, v * 4),
    vertexCount: v,
  };
}
```

- [ ] **Step 2: Type-check**

```
pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```
git add frontend/lib/gradientMesh.ts
git commit -m "Add buildGradientMesh: per-cell triangle fan with neighbor-colored corners"
```

---

### Task 3: Custom deck.gl layer

**Files:**
- Create: `frontend/lib/H3GradientMeshLayer.ts`

- [ ] **Step 1: Create the layer file**

Write `frontend/lib/H3GradientMeshLayer.ts`:

```typescript
import { Layer, project32 } from "@deck.gl/core";
import type { LayerProps, UpdateParameters, DefaultProps } from "@deck.gl/core";
import { Model } from "@luma.gl/engine";

const vs = `\
#version 300 es
#define SHADER_NAME h3-gradient-mesh-vs

in vec2 positions;
in vec4 colors;

out vec4 vColor;

void main() {
  vec3 p = vec3(positions, 0.0);
  gl_Position = project_position_to_clipspace(p);
  vColor = colors;
}
`;

const fs = `\
#version 300 es
#define SHADER_NAME h3-gradient-mesh-fs
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

export type H3GradientMeshLayerProps = {
  positions: Float32Array;
  colors: Uint8Array;
  vertexCount: number;
} & LayerProps;

const defaultProps: DefaultProps<H3GradientMeshLayerProps> = {
  positions: { type: "object", value: new Float32Array() },
  colors: { type: "object", value: new Uint8Array() },
  vertexCount: { type: "number", value: 0 },
};

export class H3GradientMeshLayer extends Layer<H3GradientMeshLayerProps> {
  static layerName = "H3GradientMeshLayer";
  static defaultProps = defaultProps;

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32] });
  }

  initializeState(): void {
    const { device } = this.context;
    const shaders = this.getShaders();
    const model = new Model(device, {
      ...shaders,
      id: this.props.id,
      bufferLayout: [
        { name: "positions", format: "float32x2" },
        { name: "colors", format: "unorm8x4" },
      ],
      topology: "triangle-list",
      vertexCount: 0,
    });
    this.setState({ model, positionsBuffer: null, colorsBuffer: null });
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const { props, oldProps, changeFlags } = params;
    if (
      changeFlags.propsOrDataChanged ||
      props.positions !== oldProps.positions ||
      props.colors !== oldProps.colors ||
      props.vertexCount !== oldProps.vertexCount
    ) {
      this._updateBuffers();
    }
  }

  draw(): void {
    const { model } = this.state as { model: Model };
    if (!model) return;
    model.draw(this.context.renderPass);
  }

  finalizeState(context: { device: unknown } | undefined): void {
    super.finalizeState?.(context as never);
    const state = this.state as {
      positionsBuffer?: { destroy: () => void } | null;
      colorsBuffer?: { destroy: () => void } | null;
    };
    state.positionsBuffer?.destroy();
    state.colorsBuffer?.destroy();
  }

  private _updateBuffers(): void {
    const { device } = this.context;
    const { positions, colors, vertexCount } = this.props;
    const state = this.state as {
      model: Model;
      positionsBuffer: { destroy: () => void } | null;
      colorsBuffer: { destroy: () => void } | null;
    };

    state.positionsBuffer?.destroy();
    state.colorsBuffer?.destroy();

    const positionsBuffer = device.createBuffer({ data: positions, usage: 0x0020 /* VERTEX */ });
    const colorsBuffer = device.createBuffer({ data: colors, usage: 0x0020 /* VERTEX */ });

    state.model.setAttributes({
      positions: positionsBuffer,
      colors: colorsBuffer,
    });
    state.model.setVertexCount(vertexCount);

    this.setState({ positionsBuffer, colorsBuffer });
  }
}
```

**Note on deck.gl v9 API:** the exact shape of `device.createBuffer`, `model.setAttributes`, and `model.setVertexCount` should be verified against the installed `@luma.gl/engine` version (`pnpm list @luma.gl/engine` from `frontend/`). The skeleton above follows the documented v9 API; if a method name or option differs in the installed minor version, fix it in place and continue.

- [ ] **Step 2: Type-check**

```
pnpm typecheck
```
Expected: zero errors. If errors point at `@luma.gl` types (Model / Buffer / usage flags), fix the API call against the installed types — do NOT add `any` casts unless the type really is unexposed.

- [ ] **Step 3: Build**

```
pnpm build
```
Expected: build succeeds. The custom layer code is compiled but not yet referenced by anything, so a successful build only proves the file is syntactically valid TS.

- [ ] **Step 4: Commit**

```
git add frontend/lib/H3GradientMeshLayer.ts
git commit -m "Add H3GradientMeshLayer custom deck.gl layer (vertex-color interp)"
```

---

### Task 4: Wire the gradient mesh + invisible pickable layer into Map.tsx

**Files:**
- Modify: `frontend/components/Map.tsx`

This task replaces the visible `H3HexagonLayer` fill at high zoom with the gradient mesh, and adds an invisible `H3HexagonLayer` that handles picking. Hover dot and selection-outline changes come in tasks 5 and 6.

- [ ] **Step 1: Add imports near the existing deck.gl imports (around line 8-11)**

Find:
```typescript
import { GeoJsonLayer, TextLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { H3HexagonLayer, TripsLayer } from "@deck.gl/geo-layers";
```

Add immediately below those three lines:
```typescript
import { H3GradientMeshLayer } from "@/lib/H3GradientMeshLayer";
import { buildGradientMesh } from "@/lib/gradientMesh";
```

- [ ] **Step 2: Add the `gradientMesh` memo**

Find the `aggregatedScores` memo (around line 479-482):
```typescript
const aggregatedScores = useMemo(
  () => (showObcineFill ? [] : aggregateMean(cells, currentRes)),
  [cells, currentRes, showObcineFill],
);
```

Add immediately after it:
```typescript
const gradientMesh = useMemo(
  () => buildGradientMesh(aggregatedScores, mode),
  [aggregatedScores, mode],
);
```

- [ ] **Step 3: Replace the visible H3HexagonLayer in the high-zoom branch**

Find this block (around line 561-599) inside the layer-build effect:
```typescript
} else {
  layers.push(
    new GeoJsonLayer({
      id: "obcine-outline",
      data: OBCINE_URL,
      stroked: true,
      filled: false,
      lineWidthMinPixels: 1,
      getLineColor: [80, 80, 80, 160],
      pickable: false,
    }),
    new H3HexagonLayer<ScoreCell>({
      id: "scores",
      data: aggregatedScores,
      pickable: true, // click-only (no onHover) — perf hit acceptable
      stroked: true,
      filled: true,
      extruded: false,
      getHexagon: (d) => d.h3,
      getFillColor: (d) => colorForScore(mode === "bike" ? d.b : d.w),
      getLineColor: [255, 255, 255, 70],
      lineWidthUnits: "pixels",
      getLineWidth: 0.5,
      updateTriggers: { getFillColor: [aggregatedScores, mode] },
      onClick: ({ object }) => {
        if (!object) return;
        // Convert aggregated h3 to a representative res-10 child for
        // scorecard fetch; if already res-10 use as-is.
        const target =
          h3.getResolution(object.h3) >= H3_BASE_RES
            ? object.h3
            : h3.cellToChildren(object.h3, H3_BASE_RES)[0];
        // Tile click drops any address anchor — route from cell centroid.
        setOriginLngLat(null);
        setOriginFromAddress(false);
        setSelectedH3(target);
      },
    }),
  );
```

Replace the entire `new H3HexagonLayer<ScoreCell>({ id: "scores", ... })` argument with the two-layer pair below. Keep the `GeoJsonLayer` obcine-outline as-is at the top of the `layers.push(...)` call.

The shape after replacement:
```typescript
} else {
  layers.push(
    new GeoJsonLayer({
      id: "obcine-outline",
      data: OBCINE_URL,
      stroked: true,
      filled: false,
      lineWidthMinPixels: 1,
      getLineColor: [80, 80, 80, 160],
      pickable: false,
    }),
    new H3GradientMeshLayer({
      id: "scores-gradient",
      positions: gradientMesh.positions,
      colors: gradientMesh.colors,
      vertexCount: gradientMesh.vertexCount,
      pickable: false,
    }),
    new H3HexagonLayer<ScoreCell>({
      id: "scores-pick",
      data: aggregatedScores,
      pickable: true,
      stroked: false,
      filled: true,
      extruded: false,
      getHexagon: (d) => d.h3,
      // Invisible — picking pass uses picking IDs, not fill alpha.
      getFillColor: [0, 0, 0, 0],
      onClick: ({ object }) => {
        if (!object) return;
        const target =
          h3.getResolution(object.h3) >= H3_BASE_RES
            ? object.h3
            : h3.cellToChildren(object.h3, H3_BASE_RES)[0];
        setOriginLngLat(null);
        setOriginFromAddress(false);
        setSelectedH3(target);
      },
    }),
  );
```

- [ ] **Step 4: Add `gradientMesh` to the layer-build effect's dependency array**

Find the end of that `useEffect` (around line 788):
```typescript
}, [aggregatedScores, popPoints, showObcineFill, currentRes, view, isoFeature, routeSet, amenityDots, hoveredAmenity, mode, selectedH3, originLngLat, animatedPaths, animTime]);
```

Insert `gradientMesh` after `aggregatedScores`:
```typescript
}, [aggregatedScores, gradientMesh, popPoints, showObcineFill, currentRes, view, isoFeature, routeSet, amenityDots, hoveredAmenity, mode, selectedH3, originLngLat, animatedPaths, animTime]);
```

- [ ] **Step 5: Type-check and build**

```
pnpm typecheck
pnpm build
```
Both expected to pass.

- [ ] **Step 6: Visual eyeball check**

Run `pnpm dev` and open http://localhost:3000.

Verify:
- At zoom ≥ 9 (typical: zoom in on Ljubljana), score view shows a smooth gradient — no visible hex edges within Slovenia.
- At the edge of populated cells, colors fade smoothly to fully transparent (you should see basemap through the edge transition, not a hard hex cut).
- Clicking anywhere within a hex still opens the Scorecard for that cell (the old click behavior is preserved).
- At zoom < 9, the občina polygon view is unchanged.
- Toggling Poseljenost view shows the heatmap unchanged.

The selected-cell highlight in this task may still appear *over* the gradient (the existing `selected-hex` full-fill layer is still in place from earlier code). That's fixed in task 6.

- [ ] **Step 7: Commit**

```
git add frontend/components/Map.tsx
git commit -m "Wire H3GradientMeshLayer + invisible pickable hex layer into Map.tsx"
```

---

### Task 5: Hover dot

**Files:**
- Modify: `frontend/components/Map.tsx`

- [ ] **Step 1: Add the `hoveredCell` state**

Find the block of `useState` declarations inside `SloveniaMap()` (around line 269-303). After the existing `const [hoveredAmenity, ...] = useState<AmenityForPoint | null>(null);` line, add:
```typescript
const [hoveredCell, setHoveredCell] = useState<string | null>(null);
```

- [ ] **Step 2: Wire `onHover` on the invisible pickable layer**

In the `scores-pick` H3HexagonLayer (added in Task 4 step 3), add an `onHover` handler. The full layer with both handlers:
```typescript
new H3HexagonLayer<ScoreCell>({
  id: "scores-pick",
  data: aggregatedScores,
  pickable: true,
  stroked: false,
  filled: true,
  extruded: false,
  getHexagon: (d) => d.h3,
  getFillColor: [0, 0, 0, 0],
  onClick: ({ object }) => {
    if (!object) return;
    const target =
      h3.getResolution(object.h3) >= H3_BASE_RES
        ? object.h3
        : h3.cellToChildren(object.h3, H3_BASE_RES)[0];
    setOriginLngLat(null);
    setOriginFromAddress(false);
    setSelectedH3(target);
  },
  onHover: ({ object }) => setHoveredCell(object?.h3 ?? null),
}),
```

- [ ] **Step 3: Push a hover-dot ScatterplotLayer**

Immediately after the `scores-pick` H3HexagonLayer in the `layers.push(...)` call (still inside the high-zoom `else` branch), add:

```typescript
new ScatterplotLayer<{ h3: string }>({
  id: "hover-dot",
  data: hoveredCell ? [{ h3: hoveredCell }] : [],
  getPosition: (d) => {
    const [lat, lng] = h3.cellToLatLng(d.h3);
    return [lng, lat];
  },
  getRadius: 5,
  radiusUnits: "pixels",
  radiusMinPixels: 4,
  getFillColor: [255, 255, 255, 220],
  stroked: true,
  getLineColor: [17, 24, 39, 220],
  lineWidthMinPixels: 1.5,
  pickable: false,
}),
```

Note: `ScatterplotLayer` is already imported (line 8) — no new imports needed.

- [ ] **Step 4: Add `hoveredCell` to the layer-build effect dep array**

Update the dependency array at the end of the layer-build effect to include `hoveredCell`:
```typescript
}, [aggregatedScores, gradientMesh, popPoints, showObcineFill, currentRes, view, isoFeature, routeSet, amenityDots, hoveredAmenity, hoveredCell, mode, selectedH3, originLngLat, animatedPaths, animTime]);
```

- [ ] **Step 5: Type-check**

```
pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 6: Visual eyeball check**

`pnpm dev`. At zoom ≥ 9, move the mouse across cells. Verify:
- A small white dot with a dark outline appears under the cursor, centered on the hovered hex.
- The dot disappears when the mouse leaves any cell (e.g., moves over the basemap outside Slovenia).
- The dot moves smoothly cell-to-cell as you slide across.
- Clicking still selects the cell.

- [ ] **Step 7: Commit**

```
git add frontend/components/Map.tsx
git commit -m "Add hover dot at hovered cell centroid"
```

---

### Task 6: Convert selected-hex to stroke-only outline

**Files:**
- Modify: `frontend/components/Map.tsx`

- [ ] **Step 1: Replace the selected-hex layer block**

Find the existing selected-hex block (around lines 606-630):
```typescript
if (selectedH3) {
  const parent = h3.cellToParent(selectedH3, currentRes);
  const matchingScore = aggregatedScores.find((c) => c.h3 === parent);
  const score = matchingScore
    ? (mode === "bike" ? matchingScore.b : matchingScore.w)
    : 4;
  const [hr, hg, hb] = colorForScore(score);
  layers.push(
    new H3HexagonLayer<{ h3: string }>({
      id: "selected-hex",
      data: [{ h3: parent }],
      getHexagon: (d) => d.h3,
      stroked: true,
      filled: true,
      extruded: false,
      getFillColor: [hr, hg, hb, 220],
      getLineColor: [17, 24, 39, 255],
      getLineWidth: 2.5,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 2.5,
      pickable: false,
      updateTriggers: { getFillColor: [score] },
    }),
  );
}
```

Replace it with the stroke-only version:
```typescript
if (selectedH3) {
  const parent = h3.cellToParent(selectedH3, currentRes);
  layers.push(
    new H3HexagonLayer<{ h3: string }>({
      id: "selected-hex",
      data: [{ h3: parent }],
      getHexagon: (d) => d.h3,
      stroked: true,
      filled: false,
      extruded: false,
      getLineColor: [17, 24, 39, 255],
      getLineWidth: 2.5,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 2.5,
      pickable: false,
    }),
  );
}
```

The `parent`, `matchingScore`, `score`, `[hr, hg, hb]`, `getFillColor`, and `updateTriggers` lines all disappear — outline-only doesn't need them.

- [ ] **Step 2: Type-check and build**

```
pnpm typecheck
pnpm build
```
Both expected to pass.

- [ ] **Step 3: Visual eyeball check**

`pnpm dev`. At zoom ≥ 9:
- Click a cell. Expected: a thick dark hex outline appears around the cell — no fill — and the underlying gradient color shows through unchanged.
- Click another cell. Expected: outline moves to the new cell.
- Pan / zoom: the outline tracks the selected cell.
- Close the Scorecard (X). Expected: the outline disappears.

- [ ] **Step 4: Commit**

```
git add frontend/components/Map.tsx
git commit -m "Convert selected-hex highlight to stroke-only outline"
```

---

### Task 7: Final acceptance check

**Files:** none modified — verification only.

- [ ] **Step 1: Run the build**

```
pnpm typecheck
pnpm build
```
Both must pass with zero errors.

- [ ] **Step 2: Acceptance criteria sweep**

Start `pnpm dev` and walk through each acceptance criterion from the spec:

1. **Smooth heatmap at zoom 9-15+** — zoom into Ljubljana, verify continuous gradient with no visible hex boundaries between populated cells.
2. **Smooth edge fade** — pan to the Slovenia-Austria or Slovenia-Croatia border, or any unpopulated region. Verify the score layer fades smoothly to fully transparent, not a hard hex cut.
3. **Hover dot** — at zoom ≥ 9, hovering a cell shows a small dot at its centroid; the dot disappears when leaving the cell.
4. **Click → Scorecard** — clicking anywhere within a cell opens the Scorecard for that cell.
5. **Stroke-only selection** — selected cell shows a thick dark outline only; the gradient shows through unchanged.
6. **Walk/bike toggle** — sub-second swap; gradient updates appropriately.
7. **Občina low-zoom view (zoom < 9)** — zoom out; the občina polygon fill renders identically to before this work.
8. **Population view** — toggle to Poseljenost; the heatmap is identical to before this work.

- [ ] **Step 3: Test other interactions for regressions**

- AddressSearch: pick an address. Map flies in, cell is selected, Scorecard opens, gradient is intact.
- Theme toggle (light ↔ dark): basemap swaps; gradient persists.
- Permalink: copy URL, paste in new tab. Map restores center / zoom / selected cell.
- Category click in Scorecard: paths animate, amenity dots render, origin pin renders. None of these layers should be obscured by the gradient.

- [ ] **Step 4: Final commit (if anything changed during the sweep)**

If the sweep surfaced a minor fix, commit it. Otherwise this task ends without a commit.

```
git status
```
If clean, you're done. If something was tweaked:
```
git add frontend/components/Map.tsx
git commit -m "Polish gradient mesh integration after acceptance pass"
```

---

## Notes for the implementer

- **No test suite exists** in this repo (`CLAUDE.md`). Verification is `pnpm typecheck`, `pnpm build`, and visual eyeball via `pnpm dev`. Do not introduce a test framework — it's out of scope.
- **deck.gl v9 / luma.gl v9 API drift**: the custom layer in Task 3 follows the documented v9 API at the time of writing. If `device.createBuffer`, `Model.setAttributes`, `Model.setVertexCount`, or the buffer-usage flag literal don't match the installed `@luma.gl/engine` version exactly, fix in place — `pnpm list @luma.gl/engine` will show the version. Don't reach for `any` to paper over real type mismatches.
- **Pentagons**: `gridRingUnsafe` throws on H3 pentagons. The catch-and-skip is safe for Slovenia (no pentagons in the country) but the guard is cheap and correct.
- **Performance**: the mesh build is JS-side, single-threaded, ~150-400 ms at res 10. It runs inside `useMemo` — only on zoom-level changes or walk/bike toggle, not per frame. If a noticeable hitch surfaces in practice, the optimization path is web-worker offload — that's a future-task, not this plan.
- **Don't touch** the population view (`view === "population"`), the občina low-zoom branch, the path/amenity/isochrone/origin layers, the legend, the scorecard, or the ETL. All of those are explicitly outside scope.
