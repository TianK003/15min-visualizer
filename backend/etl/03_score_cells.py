"""
Step 3 — score every populated H3 res-9 cell across the 8 categories.

Inputs:
  - data/15min-slo/amenity_isochrones.jsonl    (from 02_isochrones.py)
  - data/15min-slo/kontur_population_SI.gpkg   (populated res-8 cells)

Outputs:
  - data/15min-slo/cell_scores.json            (full table: h3 + score + walk_min[8] + population)
  - data/15min-slo/cell_scores_lite.json.gz    (frontend layer: h3 + score)
  - data/15min-slo/cell_scores_summary.json    (counts by score bucket, for sanity-check)

Algorithm:
  1. Load Kontur (res 8) → expand each cell to its 7 res-9 children → 22k × 7 ≈ 154k cells.
  2. Compute centroid (point) per child cell.
  3. Load isochrones JSONL → GeoDataFrame, indexed by (category, contour_min).
  4. For each (category, contour_min) in {5, 10, 15}:
       sjoin cell centroids against that subset of isochrones
       if a cell is inside, set walk_min[category] = min(current, contour_min)
  5. score = sum(walk_min[cat] <= 15 for cat in CATEGORIES)
  6. Bike time is derived in the frontend as walk_min / 2.5 (PLAN §3 lock).
"""

from __future__ import annotations

import gzip
import json
import sys
import time
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"
ISOCHRONES_JSONL = DATA_DIR / "amenity_isochrones.jsonl"
KONTUR_GPKG = DATA_DIR / "kontur_population_SI.gpkg"

OUTPUT_FULL = DATA_DIR / "cell_scores.json"
OUTPUT_LITE = DATA_DIR / "cell_scores_lite.json"
OUTPUT_LITE_GZ = DATA_DIR / "cell_scores_lite.json.gz"
FRONTEND_LITE = ROOT / "frontend" / "public" / "data" / "cell_scores_lite.json"
OBCINE_INPUT = DATA_DIR / "obcine.geojson"
OBCINE_SCORED = DATA_DIR / "obcine_scored.geojson"
FRONTEND_OBCINE = ROOT / "frontend" / "public" / "data" / "obcine_scored.geojson"
SUMMARY = DATA_DIR / "cell_scores_summary.json"

H3_RES = 10
CATEGORIES = [
    "trgovina", "izobrazevanje", "zdravstvo", "park",
    "promet", "sport", "storitve", "delo",
]
CONTOURS_DESC = [15, 10, 5]  # iterate widest → narrowest; smaller value wins


def load_populated_cells() -> gpd.GeoDataFrame:
    print("Loading Kontur (res 8) …")
    kontur = gpd.read_file(KONTUR_GPKG)
    print(f"  {len(kontur):,} res-8 cells")

    # Population per parent → distribute uniformly across the 7 res-9 children
    rows = []
    for h3_parent, pop in zip(kontur["h3"], kontur["population"]):
        children = h3.cell_to_children(h3_parent, H3_RES)
        per_child = float(pop) / len(children)
        for child in children:
            lat, lng = h3.cell_to_latlng(child)
            rows.append((child, per_child, lng, lat))

    df = pd.DataFrame(rows, columns=["h3", "population", "lng", "lat"])
    df = df.drop_duplicates(subset="h3").reset_index(drop=True)
    geom = gpd.points_from_xy(df["lng"], df["lat"], crs="EPSG:4326")
    gdf = gpd.GeoDataFrame(df.drop(columns=["lng", "lat"]), geometry=geom, crs="EPSG:4326")
    print(f"  → {len(gdf):,} unique res-{H3_RES} cells")
    return gdf


def load_isochrones() -> gpd.GeoDataFrame:
    if not ISOCHRONES_JSONL.exists():
        sys.exit(f"Missing {ISOCHRONES_JSONL}. Run 02_isochrones.py first.")

    print("Loading isochrones …")
    records = []
    with ISOCHRONES_JSONL.open() as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            rec["geometry"] = shape(rec["geometry"])
            records.append(rec)

    gdf = gpd.GeoDataFrame(records, crs="EPSG:4326")
    print(f"  {len(gdf):,} polygons across {gdf['category'].nunique()} categories")
    print(gdf.groupby(["category", "contour_min"]).size().unstack(fill_value=0))
    return gdf


def score(cells: gpd.GeoDataFrame, isos: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    walk_min = np.full((len(cells), len(CATEGORIES)), 999, dtype=np.int16)

    for cat_idx, category in enumerate(CATEGORIES):
        cat_subset = isos[isos["category"] == category]
        if cat_subset.empty:
            continue
        for contour in CONTOURS_DESC:  # 15 → 10 → 5
            polys = cat_subset[cat_subset["contour_min"] == contour]
            if polys.empty:
                continue
            joined = gpd.sjoin(cells[["h3", "geometry"]], polys[["geometry"]], predicate="within")
            hit_h3 = set(joined["h3"])
            mask = cells["h3"].isin(hit_h3).values
            # The smaller contour overrides the larger because we iterate widest → narrowest
            walk_min[mask, cat_idx] = contour
            print(f"    {category:<14} ≤{contour:>2} min  hits {mask.sum():>7,}")

    score_int = (walk_min <= 15).sum(axis=1).astype(np.int8)
    cells = cells.copy()
    cells["score"] = score_int
    for i, cat in enumerate(CATEGORIES):
        cells[f"walk_{cat}"] = walk_min[:, i]
    return cells


def export(cells: gpd.GeoDataFrame) -> None:
    print("\nWriting outputs …")

    # Lite (frontend hex layer) — uncompressed for dev, gzipped sidecar for prod deploy
    lite = [{"h3": h, "score": int(s)} for h, s in zip(cells["h3"], cells["score"])]
    lite_blob = json.dumps(lite, separators=(",", ":"))
    OUTPUT_LITE.write_text(lite_blob)
    FRONTEND_LITE.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_LITE.write_text(lite_blob)
    with gzip.open(OUTPUT_LITE_GZ, "wt", compresslevel=9) as f:
        f.write(lite_blob)

    # Full
    full = []
    walk_cols = [f"walk_{c}" for c in CATEGORIES]
    for row in cells[["h3", "score", "population", *walk_cols]].itertuples(index=False):
        full.append({
            "h3": row.h3,
            "score": int(row.score),
            "population": round(float(row.population), 2),
            "walk_min": [None if int(v) > 15 else int(v) for v in row[3:]],
        })
    OUTPUT_FULL.write_text(json.dumps(full, separators=(",", ":")))

    summary = {
        "cells_total": len(cells),
        "by_score": pd.Series(cells["score"]).value_counts().sort_index().to_dict(),
        "color_buckets": {
            "green_6_8": int(((cells["score"] >= 6) & (cells["score"] <= 8)).sum()),
            "yellow_4_5": int(((cells["score"] >= 4) & (cells["score"] <= 5)).sum()),
            "orange_2_3": int(((cells["score"] >= 2) & (cells["score"] <= 3)).sum()),
            "red_0_1": int(((cells["score"] >= 0) & (cells["score"] <= 1)).sum()),
        },
    }
    summary["by_score"] = {int(k): int(v) for k, v in summary["by_score"].items()}
    SUMMARY.write_text(json.dumps(summary, indent=2))

    print(f"  ✓ {OUTPUT_LITE.relative_to(ROOT)}     ({OUTPUT_LITE.stat().st_size/1024:,.0f} KB)")
    print(f"  ✓ {OUTPUT_LITE_GZ.relative_to(ROOT)}  ({OUTPUT_LITE_GZ.stat().st_size/1024:,.0f} KB)")
    print(f"  ✓ {FRONTEND_LITE.relative_to(ROOT)}  (copy for frontend dev)")
    print(f"  ✓ {OUTPUT_FULL.relative_to(ROOT)}     ({OUTPUT_FULL.stat().st_size/1024/1024:,.1f} MB)")
    print(f"  ✓ {SUMMARY.relative_to(ROOT)}")
    print()
    print("Score distribution:")
    for k, v in summary["by_score"].items():
        bar = "█" * int(60 * v / max(summary["by_score"].values()))
        print(f"  {k}: {v:>7,}  {bar}")


def aggregate_obcine(cells: gpd.GeoDataFrame) -> None:
    """Population-weighted mean score per občina → obcine_scored.geojson."""
    if not OBCINE_INPUT.exists():
        print(f"\n  Skipping občina aggregation: {OBCINE_INPUT.name} not found.")
        return

    print(f"\nAggregating to občine …")
    obcine = gpd.read_file(OBCINE_INPUT)
    print(f"  {len(obcine):,} polygons loaded")

    # Spatial join: cell centroid → containing občina (uses STRtree under the hood).
    work = cells[["score", "population", "geometry"]].copy()
    work["score_pop"] = work["score"].astype(float) * work["population"]
    joined = gpd.sjoin(work, obcine[["geometry"]], predicate="within", how="inner")

    agg = (
        joined.groupby("index_right")
        .agg(
            score_pop_sum=("score_pop", "sum"),
            population_sum=("population", "sum"),
            n_cells=("score", "size"),
        )
    )
    agg["mean_score"] = (agg["score_pop_sum"] / agg["population_sum"]).fillna(0)

    obcine_out = obcine.copy()
    obcine_out["mean_score"] = agg["mean_score"].reindex(obcine_out.index).fillna(0).round(3)
    obcine_out["population"] = agg["population_sum"].reindex(obcine_out.index).fillna(0).round(0).astype(int)
    obcine_out["n_cells"] = agg["n_cells"].reindex(obcine_out.index).fillna(0).astype(int)

    if OBCINE_SCORED.exists():
        OBCINE_SCORED.unlink()
    obcine_out.to_file(OBCINE_SCORED, driver="GeoJSON")
    FRONTEND_OBCINE.parent.mkdir(parents=True, exist_ok=True)
    if FRONTEND_OBCINE.exists():
        FRONTEND_OBCINE.unlink()
    obcine_out.to_file(FRONTEND_OBCINE, driver="GeoJSON")

    print(f"  ✓ {OBCINE_SCORED.relative_to(ROOT)}     ({OBCINE_SCORED.stat().st_size/1024/1024:,.1f} MB)")
    print(f"  ✓ {FRONTEND_OBCINE.relative_to(ROOT)}")

    show = obcine_out[["OB_UIME", "mean_score", "population", "n_cells"]]
    print("\n  Top 5 občine by population-weighted mean score:")
    print("   ", show.nlargest(5, "mean_score").to_string(index=False).replace("\n", "\n    "))
    print("\n  Bottom 5:")
    print("   ", show.nsmallest(5, "mean_score").to_string(index=False).replace("\n", "\n    "))


def main() -> None:
    t0 = time.time()
    cells = load_populated_cells()
    isos = load_isochrones()
    print("\nScoring …")
    scored = score(cells, isos)
    export(scored)
    aggregate_obcine(scored)
    print(f"\nTotal wall time: {(time.time() - t0)/60:.1f} min")


if __name__ == "__main__":
    main()
