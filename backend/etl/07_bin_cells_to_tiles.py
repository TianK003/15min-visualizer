"""
Step 7 — partial-load tile bake (TASKS §F1).

Bins the 1.08M res-10 cell scores by their res-7 parent → one JSON file per
res-7 cell (~1000 tiles, each typically 50–200 KB). The frontend can then
fetch only the tiles whose res-7 parent intersects the current viewport,
dropping cold-load payload from 37 MB to ~50 KB until the user zooms in.

Inputs:
  data/15min-slo/cell_scores.json    (full output of 03_score_cells.py)

Outputs:
  data/15min-slo/tiles/{res7-h3}.json   (per-tile shards)
  data/15min-slo/tiles/index.json       (manifest: list of all tile ids)

Storage layout after upload:
  cells/tiles/{res7-h3}.json
  cells/tiles/index.json
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import h3

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"
SRC = DATA_DIR / "cell_scores.json"
OUT_DIR = DATA_DIR / "tiles"

TILE_RES = 7  # ~5 km edge; ~1000 tiles across SI


def main() -> None:
    t0 = time.time()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Wipe stale shards so the bake is idempotent.
    for p in OUT_DIR.glob("*.json"):
        p.unlink()

    with SRC.open() as f:
        cells = json.load(f)
    print(f"Loaded {len(cells):,} cells in {time.time()-t0:.1f}s")

    buckets: dict[str, list] = {}
    for c in cells:
        parent = h3.cell_to_parent(c["h3"], TILE_RES)
        buckets.setdefault(parent, []).append({"h3": c["h3"], "score": c["score"]})

    print(f"Binned into {len(buckets)} res-{TILE_RES} tiles")

    sizes: list[int] = []
    for tile_id, rows in buckets.items():
        path = OUT_DIR / f"{tile_id}.json"
        path.write_text(json.dumps(rows, separators=(",", ":")))
        sizes.append(path.stat().st_size)

    manifest = {
        "tile_resolution": TILE_RES,
        "base_resolution": 10,
        "tile_count": len(buckets),
        "tile_ids": sorted(buckets.keys()),
    }
    (OUT_DIR / "index.json").write_text(json.dumps(manifest, separators=(",", ":")))

    sizes.sort()
    print(f"\nTile sizes (KB): min={sizes[0]/1024:.1f}  median={sizes[len(sizes)//2]/1024:.1f}  max={sizes[-1]/1024:.1f}  total={sum(sizes)/1024/1024:.1f} MB")
    print(f"Manifest: {(OUT_DIR / 'index.json').stat().st_size/1024:.1f} KB")
    print(f"\nDone in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
