"""
Step 5 — export per-cell population as a lightweight frontend layer.

Reads the full cell_scores.json (already on disk from 03_score_cells.py),
aggregates res-10 populations up to res 9 (sum over each parent's 7 children),
and emits frontend/public/data/cell_population_lite.json: [{h3, pop}, ...].

Res 9 is enough granularity for the soft Gaussian heatmap (radiusPixels=40
covers ~170 m at street zoom, and individual res-10 cells are 66 m edge — the
extra resolution gets blurred away anyway) and shrinks the layer from
~1.08M points / 38 MB to ~154k points / ~5 MB.

The frontend lazy-loads this file the first time the user switches to the
"population" view, mirroring how cell_scores_lite.json drives the 15-min view.
"""

from __future__ import annotations

import gzip
import json
from collections import defaultdict
from pathlib import Path

import h3

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"
INPUT_FULL = DATA_DIR / "cell_scores.json"
OUTPUT_LITE = DATA_DIR / "cell_population_lite.json"
OUTPUT_LITE_GZ = DATA_DIR / "cell_population_lite.json.gz"
FRONTEND_LITE = ROOT / "frontend" / "public" / "data" / "cell_population_lite.json"

TARGET_RES = 9


def main() -> None:
    if not INPUT_FULL.exists():
        raise SystemExit(
            f"Missing {INPUT_FULL}. Run backend/etl/03_score_cells.py first."
        )

    print(f"Reading {INPUT_FULL.relative_to(ROOT)} …")
    rows = json.loads(INPUT_FULL.read_text())
    print(f"  {len(rows):,} res-10 cells")

    print(f"Aggregating to res {TARGET_RES} (sum) …")
    sums: defaultdict[str, float] = defaultdict(float)
    for r in rows:
        parent = h3.cell_to_parent(r["h3"], TARGET_RES)
        sums[parent] += float(r["population"])

    lite = [{"h3": h, "pop": round(p, 2)} for h, p in sums.items()]
    print(f"  → {len(lite):,} res-{TARGET_RES} cells")
    blob = json.dumps(lite, separators=(",", ":"))

    FRONTEND_LITE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_LITE.write_text(blob)
    FRONTEND_LITE.write_text(blob)
    with gzip.open(OUTPUT_LITE_GZ, "wt", compresslevel=9) as f:
        f.write(blob)

    pops = [r["pop"] for r in lite]
    pops_nz = [p for p in pops if p > 0]
    print()
    print(f"  ✓ {FRONTEND_LITE.relative_to(ROOT)}  ({FRONTEND_LITE.stat().st_size/1024/1024:,.1f} MB)")
    print(f"  ✓ {OUTPUT_LITE_GZ.relative_to(ROOT)}   ({OUTPUT_LITE_GZ.stat().st_size/1024:,.0f} KB)")
    print()
    print(f"  population distribution (non-zero cells: {len(pops_nz):,} / {len(pops):,}):")
    if pops_nz:
        srt = sorted(pops_nz)
        print(f"    min={srt[0]:.2f}  p50={srt[len(srt)//2]:.2f}  "
              f"p95={srt[int(len(srt)*0.95)]:.2f}  p99={srt[int(len(srt)*0.99)]:.2f}  "
              f"max={srt[-1]:.2f}")


if __name__ == "__main__":
    main()
