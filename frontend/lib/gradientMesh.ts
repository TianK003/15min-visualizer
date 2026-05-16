import * as h3 from "h3-js";

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
