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
