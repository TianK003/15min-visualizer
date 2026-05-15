"""
Step 2 — for each amenity, call Valhalla for a multi-contour pedestrian isochrone
(5, 10, 15 minutes), and save the polygons.

Inputs:
  - data/15min-slo/amenities.gpkg (from 01_extract_amenities.py)
  - A running Valhalla server (default: http://localhost:8002)

Outputs:
  - data/15min-slo/amenity_isochrones.jsonl   (append-only staging buffer)
  - data/15min-slo/amenity_isochrones.gpkg    (consolidated at end-of-run)
  - data/15min-slo/isochrone_errors.jsonl     (amenities that failed all retries)

Design choices:
  - JSONL staging makes the run resumable. Re-running skips amenity_ids already in the file.
  - Multi-contour {5, 10, 15} in one Valhalla call → same #requests as 15-only,
    but gives walk_min granularity for the scorecard sidebar.
  - Async with httpx + a semaphore. CONCURRENCY=6 is conservative; bump via env var
    VALHALLA_CONCURRENCY if your Valhalla container handles more.

CLI:
  python 02_isochrones.py            # full run, ~3-6 hours for 37k amenities
  python 02_isochrones.py --limit 50 # smoke test
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import geopandas as gpd
import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"
AMENITIES_GPKG = DATA_DIR / "amenities.gpkg"
ISOCHRONES_JSONL = DATA_DIR / "amenity_isochrones.jsonl"
ISOCHRONES_GPKG = DATA_DIR / "amenity_isochrones.gpkg"
ERRORS_JSONL = DATA_DIR / "isochrone_errors.jsonl"

VALHALLA_URL = os.environ.get("VALHALLA_URL", "http://localhost:8002") + "/isochrone"
CONCURRENCY = int(os.environ.get("VALHALLA_CONCURRENCY", "6"))
REQUEST_TIMEOUT = 60.0
MAX_RETRIES = 3
PROGRESS_EVERY = 100

CONTOURS = [5, 10, 15]  # minutes


def already_done_ids() -> set[int]:
    """Read existing JSONL to find amenity_ids we've already completed."""
    if not ISOCHRONES_JSONL.exists():
        return set()
    done: set[int] = set()
    with ISOCHRONES_JSONL.open() as f:
        for line in f:
            try:
                done.add(json.loads(line)["amenity_id"])
            except (json.JSONDecodeError, KeyError):
                continue
    return done


async def fetch_isochrone(
    client: httpx.AsyncClient, amenity_id: int, lon: float, lat: float
) -> tuple[int, dict[str, Any] | None, str | None]:
    payload = {
        "locations": [{"lat": lat, "lon": lon}],
        "costing": "pedestrian",
        "contours": [{"time": t} for t in CONTOURS],
        "polygons": True,
        "denoise": 0.1,
        "generalize": 50,
    }
    last_err = ""
    for attempt in range(MAX_RETRIES):
        try:
            r = await client.post(VALHALLA_URL, json=payload, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            return amenity_id, r.json(), None
        except Exception as exc:  # noqa: BLE001
            last_err = f"{type(exc).__name__}: {exc}"
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(2 ** attempt)
    return amenity_id, None, last_err


def parse_response(amenity_id: int, category: str, data: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for feat in data.get("features", []):
        contour = feat.get("properties", {}).get("contour")
        geom = feat.get("geometry")
        if contour is None or geom is None:
            continue
        rows.append({
            "amenity_id": amenity_id,
            "category": category,
            "contour_min": int(contour),
            "geometry": geom,
        })
    return rows


async def run(limit: int | None) -> None:
    if not AMENITIES_GPKG.exists():
        sys.exit(f"Missing {AMENITIES_GPKG}. Run 01_extract_amenities.py first.")

    amenities = gpd.read_file(AMENITIES_GPKG)
    print(f"Loaded {len(amenities):,} amenities")

    done = already_done_ids()
    if done:
        print(f"Resume: {len(done):,} already complete")
        amenities = amenities[~amenities["amenity_id"].isin(done)]

    if limit is not None:
        amenities = amenities.head(limit)

    n = len(amenities)
    if n == 0:
        print("Nothing to do.")
        return
    print(f"Processing {n:,} amenities @ concurrency={CONCURRENCY}, contours={CONTOURS}")

    sem = asyncio.Semaphore(CONCURRENCY)
    out_fp = ISOCHRONES_JSONL.open("a", buffering=1)  # line-buffered
    err_fp = ERRORS_JSONL.open("a", buffering=1)
    completed = 0
    failed = 0
    t0 = time.time()

    async def worker(client: httpx.AsyncClient, aid: int, cat: str, lon: float, lat: float) -> None:
        nonlocal completed, failed
        async with sem:
            amenity_id, data, err = await fetch_isochrone(client, aid, lon, lat)
        if data is None:
            failed += 1
            err_fp.write(json.dumps({"amenity_id": amenity_id, "category": cat, "error": err}) + "\n")
        else:
            for row in parse_response(amenity_id, cat, data):
                out_fp.write(json.dumps(row) + "\n")
        completed += 1
        if completed % PROGRESS_EVERY == 0 or completed == n:
            elapsed = time.time() - t0
            rate = completed / elapsed if elapsed > 0 else 0
            eta_min = ((n - completed) / rate) / 60 if rate > 0 else float("inf")
            print(
                f"  {completed:>7,} / {n:,}  ({100 * completed / n:5.1f}%)  "
                f"{rate:5.1f} req/s  ETA {eta_min:6.1f} min  fail {failed}"
            )

    async with httpx.AsyncClient() as client:
        tasks = [
            asyncio.create_task(
                worker(client, int(row.amenity_id), row.category, row.geometry.x, row.geometry.y)
            )
            for row in amenities.itertuples()
        ]
        await asyncio.gather(*tasks)

    out_fp.close()
    err_fp.close()
    print(f"\n✓ Bake complete: {completed - failed:,} ok, {failed} failed")
    print(f"  Staging:   {ISOCHRONES_JSONL.relative_to(ROOT)}")
    print(f"  Errors:    {ERRORS_JSONL.relative_to(ROOT)} (if any)")
    print(f"  Wall time: {(time.time() - t0)/60:.1f} min")
    print(f"\nNext: run `python backend/etl/02b_consolidate_isochrones.py` to build the GPKG,")
    print(f"      or `python backend/etl/03_score_cells.py` directly (it reads the JSONL).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bake pedestrian isochrones for every amenity.")
    parser.add_argument("--limit", type=int, default=None,
                        help="Process only the first N amenities (for smoke testing).")
    args = parser.parse_args()
    asyncio.run(run(args.limit))


if __name__ == "__main__":
    main()
