"""
Step 2 — for each amenity, call Valhalla for a multi-contour isochrone
(5, 10, 15 minutes), and save the polygons. Runs twice: once for pedestrian,
once for bicycle.

Speeds (locked):
  - walking_speed = 4 km/h   (override via WALKING_SPEED env)
  - cycling_speed = 13 km/h  (override via CYCLING_SPEED env)
  Valhalla bicycle uses bicycle_type=Hybrid (the default for urban routing).

Inputs:
  - data/15min-slo/amenities.gpkg (from 01_extract_amenities.py)
  - A running Valhalla server (default: http://localhost:8002)

Outputs:
  - data/15min-slo/amenity_isochrones.jsonl   (append-only, resumable)
  - data/15min-slo/isochrone_errors.jsonl     (amenities that failed all retries)

Each row in the JSONL now carries a `mode` field ("pedestrian" or "bicycle").
Resume tracking is per (amenity_id, mode) so the same amenity gets two passes.

CLI:
  python 02_isochrones.py --costing pedestrian   # walking pass
  python 02_isochrones.py --costing bicycle      # biking pass
  python 02_isochrones.py --limit 50             # smoke (default costing pedestrian)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Literal

import geopandas as gpd
import httpx

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"
AMENITIES_GPKG = DATA_DIR / "amenities.gpkg"
ISOCHRONES_JSONL = DATA_DIR / "amenity_isochrones.jsonl"
ERRORS_JSONL = DATA_DIR / "isochrone_errors.jsonl"

VALHALLA_URL = os.environ.get("VALHALLA_URL", "http://localhost:8002") + "/isochrone"
CONCURRENCY = int(os.environ.get("VALHALLA_CONCURRENCY", "6"))
REQUEST_TIMEOUT = 60.0
MAX_RETRIES = 3
PROGRESS_EVERY = 100

WALKING_SPEED = float(os.environ.get("WALKING_SPEED", "4"))
CYCLING_SPEED = float(os.environ.get("CYCLING_SPEED", "13"))

CONTOURS = [5, 10, 15]  # minutes

Mode = Literal["pedestrian", "bicycle"]


def already_done_pairs() -> set[tuple[int, str]]:
    """Read existing JSONL → set of (amenity_id, mode) already complete.

    Rows written before the bike pass don't carry a `mode` field; treat them
    as pedestrian so the walking work isn't repeated.
    """
    if not ISOCHRONES_JSONL.exists():
        return set()
    done: set[tuple[int, str]] = set()
    with ISOCHRONES_JSONL.open() as f:
        for line in f:
            try:
                rec = json.loads(line)
                done.add((int(rec["amenity_id"]), rec.get("mode", "pedestrian")))
            except (json.JSONDecodeError, KeyError, ValueError):
                continue
    return done


def costing_options(mode: Mode) -> dict[str, Any]:
    if mode == "pedestrian":
        return {"pedestrian": {"walking_speed": WALKING_SPEED}}
    # Hybrid is Valhalla's default for general-purpose city biking;
    # set bicycle_type explicitly so we don't drift on Valhalla version upgrades.
    return {"bicycle": {"bicycle_type": "Hybrid", "cycling_speed": CYCLING_SPEED}}


async def fetch_isochrone(
    client: httpx.AsyncClient, amenity_id: int, lon: float, lat: float, mode: Mode
) -> tuple[int, dict[str, Any] | None, str | None]:
    payload = {
        "locations": [{"lat": lat, "lon": lon}],
        "costing": mode,
        "costing_options": costing_options(mode),
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


def parse_response(
    amenity_id: int, category: str, mode: Mode, data: dict[str, Any]
) -> list[dict[str, Any]]:
    rows = []
    for feat in data.get("features", []):
        contour = feat.get("properties", {}).get("contour")
        geom = feat.get("geometry")
        if contour is None or geom is None:
            continue
        rows.append({
            "amenity_id": amenity_id,
            "category": category,
            "mode": mode,
            "contour_min": int(contour),
            "geometry": geom,
        })
    return rows


async def run(mode: Mode, limit: int | None) -> None:
    if not AMENITIES_GPKG.exists():
        sys.exit(f"Missing {AMENITIES_GPKG}. Run 01_extract_amenities.py first.")

    amenities = gpd.read_file(AMENITIES_GPKG)
    print(f"Loaded {len(amenities):,} amenities · mode={mode} · "
          f"speed={WALKING_SPEED if mode == 'pedestrian' else CYCLING_SPEED} km/h")

    done = {aid for (aid, m) in already_done_pairs() if m == mode}
    if done:
        print(f"Resume: {len(done):,} already complete for mode={mode}")
        amenities = amenities[~amenities["amenity_id"].isin(done)]

    if limit is not None:
        amenities = amenities.head(limit)

    n = len(amenities)
    if n == 0:
        print("Nothing to do.")
        return
    print(f"Processing {n:,} amenities @ concurrency={CONCURRENCY}, contours={CONTOURS}")

    sem = asyncio.Semaphore(CONCURRENCY)
    out_fp = ISOCHRONES_JSONL.open("a", buffering=1)
    err_fp = ERRORS_JSONL.open("a", buffering=1)
    completed = 0
    failed = 0
    t0 = time.time()

    async def worker(client: httpx.AsyncClient, aid: int, cat: str, lon: float, lat: float) -> None:
        nonlocal completed, failed
        async with sem:
            amenity_id, data, err = await fetch_isochrone(client, aid, lon, lat, mode)
        if data is None:
            failed += 1
            err_fp.write(json.dumps({"amenity_id": amenity_id, "category": cat, "mode": mode, "error": err}) + "\n")
        else:
            for row in parse_response(amenity_id, cat, mode, data):
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
    print(f"\n✓ {mode} bake complete: {completed - failed:,} ok, {failed} failed")
    print(f"  Staging:   {ISOCHRONES_JSONL.relative_to(ROOT)}")
    print(f"  Wall time: {(time.time() - t0)/60:.1f} min")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bake isochrones for every amenity.")
    parser.add_argument(
        "--costing", choices=["pedestrian", "bicycle"], default="pedestrian",
        help="Travel mode. Run once with pedestrian, once with bicycle.",
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="Process only the first N amenities (for smoke testing).")
    args = parser.parse_args()
    asyncio.run(run(args.costing, args.limit))


if __name__ == "__main__":
    main()
