"""
Step 3 — score every populated H3 cell across the 8 categories,
separately for walking and biking.

Inputs:
  - data/15min-slo/amenity_isochrones.jsonl    (from 02_isochrones.py — rows
    carry a `mode` field "pedestrian" or "bicycle")
  - data/15min-slo/kontur_population_SI.gpkg

Outputs:
  - data/15min-slo/cell_scores.json            (h3, walk_score, bike_score,
                                                 walk_min[8], bike_min[8],
                                                 population)
  - data/15min-slo/cell_scores_lite.json[.gz]  (frontend layer: h3, w, b)
  - data/15min-slo/cell_scores_summary.json
  - data/15min-slo/obcine_scored.geojson       (per-občina walk/bike mean)

Algorithm:
  1. Load Kontur (res 8) → expand each cell to its 7 res-10 children (~154k).
  2. Compute centroid per cell.
  3. Load isochrones JSONL → split by mode.
  4. For each mode, for each (category, contour) sjoin cells → record min reachable contour.
  5. score = sum(reachable in 15 min for cat in CATEGORIES) — separately for walk/bike.
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
from shapely.geometry import shape

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
OUTPUT_DEMAND = DATA_DIR / "cell_demand_lite.json"
FRONTEND_DEMAND = ROOT / "frontend" / "public" / "data" / "cell_demand_lite.json"

H3_RES = 10
CATEGORIES = [
    "trgovina", "izobrazevanje", "zdravstvo", "park",
    "promet", "sport", "storitve", "delo",
]
CONTOURS_DESC = [15, 10, 5]  # iterate widest → narrowest; smaller value wins
MODES = ["pedestrian", "bicycle"]


def load_populated_cells() -> gpd.GeoDataFrame:
    print("Loading Kontur (res 8) …")
    kontur = gpd.read_file(KONTUR_GPKG)
    print(f"  {len(kontur):,} res-8 cells")

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
            # Backwards-compat: rows from the original walking-only bake
            # don't carry a `mode` field — treat them as pedestrian.
            rec.setdefault("mode", "pedestrian")
            records.append(rec)

    gdf = gpd.GeoDataFrame(records, crs="EPSG:4326")
    print(f"  {len(gdf):,} polygons across {gdf['category'].nunique()} categories")
    print("  by mode:")
    print(gdf.groupby(["mode", "contour_min"]).size().unstack(fill_value=0))
    return gdf


def score_one_mode(cells: gpd.GeoDataFrame, isos: gpd.GeoDataFrame, mode: str) -> np.ndarray:
    """Return an (n_cells, n_categories) int16 array of min reachable contour, 999 = unreachable."""
    out = np.full((len(cells), len(CATEGORIES)), 999, dtype=np.int16)
    subset = isos[isos["mode"] == mode]
    if subset.empty:
        print(f"  ⚠ no {mode} isochrones found, all cells marked unreachable")
        return out

    for cat_idx, category in enumerate(CATEGORIES):
        cat_subset = subset[subset["category"] == category]
        if cat_subset.empty:
            continue
        for contour in CONTOURS_DESC:  # 15 → 10 → 5
            polys = cat_subset[cat_subset["contour_min"] == contour]
            if polys.empty:
                continue
            joined = gpd.sjoin(cells[["h3", "geometry"]], polys[["geometry"]], predicate="within")
            hit_h3 = set(joined["h3"])
            mask = cells["h3"].isin(hit_h3).values
            out[mask, cat_idx] = contour
            print(f"    [{mode:<10}] {category:<14} ≤{contour:>2} min  hits {mask.sum():>7,}")
    return out


def score(cells: gpd.GeoDataFrame, isos: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    print("\nScoring walking …")
    walk = score_one_mode(cells, isos, "pedestrian")
    print("\nScoring biking …")
    bike = score_one_mode(cells, isos, "bicycle")

    walk_score = (walk <= 15).sum(axis=1).astype(np.int8)
    bike_score = (bike <= 15).sum(axis=1).astype(np.int8)

    cells = cells.copy()
    cells["walk_score"] = walk_score
    cells["bike_score"] = bike_score
    for i, cat in enumerate(CATEGORIES):
        cells[f"walk_{cat}"] = walk[:, i]
        cells[f"bike_{cat}"] = bike[:, i]
    return cells


def export(cells: gpd.GeoDataFrame) -> None:
    print("\nWriting outputs …")

    # Lite — frontend hex layer. Renamed shape: {h3, w, b}
    lite = [
        {"h3": h, "w": int(w), "b": int(b)}
        for h, w, b in zip(cells["h3"], cells["walk_score"], cells["bike_score"])
    ]
    lite_blob = json.dumps(lite, separators=(",", ":"))
    OUTPUT_LITE.write_text(lite_blob)
    FRONTEND_LITE.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_LITE.write_text(lite_blob)
    with gzip.open(OUTPUT_LITE_GZ, "wt", compresslevel=9) as f:
        f.write(lite_blob)

    # Full — full per-cell row used by REST scorecard fetch.
    full = []
    walk_cols = [f"walk_{c}" for c in CATEGORIES]
    bike_cols = [f"bike_{c}" for c in CATEGORIES]
    sel = cells[["h3", "walk_score", "bike_score", "population", *walk_cols, *bike_cols]]
    for row in sel.itertuples(index=False):
        h3v = row[0]
        walk_score = int(row[1])
        bike_score = int(row[2])
        pop = float(row[3])
        walk_vals = row[4:4 + 8]
        bike_vals = row[4 + 8:4 + 16]
        full.append({
            "h3": h3v,
            "walk_score": walk_score,
            "bike_score": bike_score,
            "population": round(pop, 2),
            "walk_min": [None if int(v) > 15 else int(v) for v in walk_vals],
            "bike_min": [None if int(v) > 15 else int(v) for v in bike_vals],
        })
    OUTPUT_FULL.write_text(json.dumps(full, separators=(",", ":")))

    summary = {
        "cells_total": len(cells),
        "by_walk_score": pd.Series(cells["walk_score"]).value_counts().sort_index().to_dict(),
        "by_bike_score": pd.Series(cells["bike_score"]).value_counts().sort_index().to_dict(),
    }
    summary["by_walk_score"] = {int(k): int(v) for k, v in summary["by_walk_score"].items()}
    summary["by_bike_score"] = {int(k): int(v) for k, v in summary["by_bike_score"].items()}
    SUMMARY.write_text(json.dumps(summary, indent=2))

    print(f"  ✓ {OUTPUT_LITE.relative_to(ROOT)}     ({OUTPUT_LITE.stat().st_size/1024:,.0f} KB)")
    print(f"  ✓ {OUTPUT_LITE_GZ.relative_to(ROOT)}  ({OUTPUT_LITE_GZ.stat().st_size/1024:,.0f} KB)")
    print(f"  ✓ {FRONTEND_LITE.relative_to(ROOT)}  (copy for frontend dev)")
    print(f"  ✓ {OUTPUT_FULL.relative_to(ROOT)}     ({OUTPUT_FULL.stat().st_size/1024/1024:,.1f} MB)")
    print(f"  ✓ {SUMMARY.relative_to(ROOT)}")
    print()
    print("Walk score distribution:")
    for k, v in summary["by_walk_score"].items():
        bar = "█" * int(60 * v / max(summary["by_walk_score"].values()))
        print(f"  {k}: {v:>7,}  {bar}")
    print("Bike score distribution:")
    for k, v in summary["by_bike_score"].items():
        bar = "█" * int(60 * v / max(summary["by_bike_score"].values()))
        print(f"  {k}: {v:>7,}  {bar}")


def aggregate_obcine(cells: gpd.GeoDataFrame) -> None:
    """Population-weighted walk + bike mean per občina."""
    if not OBCINE_INPUT.exists():
        print(f"\n  Skipping občina aggregation: {OBCINE_INPUT.name} not found.")
        return

    print("\nAggregating to občine …")
    obcine = gpd.read_file(OBCINE_INPUT)
    print(f"  {len(obcine):,} polygons loaded")

    work = cells[["walk_score", "bike_score", "population", "geometry"]].copy()
    work["walk_pop"] = work["walk_score"].astype(float) * work["population"]
    work["bike_pop"] = work["bike_score"].astype(float) * work["population"]
    joined = gpd.sjoin(work, obcine[["geometry"]], predicate="within", how="inner")

    agg = joined.groupby("index_right").agg(
        walk_sum=("walk_pop", "sum"),
        bike_sum=("bike_pop", "sum"),
        population_sum=("population", "sum"),
        n_cells=("walk_score", "size"),
    )
    agg["walk_mean"] = (agg["walk_sum"] / agg["population_sum"]).fillna(0)
    agg["bike_mean"] = (agg["bike_sum"] / agg["population_sum"]).fillna(0)

    obcine_out = obcine.copy()
    obcine_out["walk_mean"] = agg["walk_mean"].reindex(obcine_out.index).fillna(0).round(3)
    obcine_out["bike_mean"] = agg["bike_mean"].reindex(obcine_out.index).fillna(0).round(3)
    obcine_out["population"] = agg["population_sum"].reindex(obcine_out.index).fillna(0).round(0).astype(int)
    obcine_out["n_cells"] = agg["n_cells"].reindex(obcine_out.index).fillna(0).astype(int)

    if OBCINE_SCORED.exists():
        OBCINE_SCORED.unlink()
    obcine_out.to_file(OBCINE_SCORED, driver="GeoJSON")
    FRONTEND_OBCINE.parent.mkdir(parents=True, exist_ok=True)
    if FRONTEND_OBCINE.exists():
        FRONTEND_OBCINE.unlink()
    obcine_out.to_file(FRONTEND_OBCINE, driver="GeoJSON")

    print(f"  ✓ {OBCINE_SCORED.relative_to(ROOT)}  ({OBCINE_SCORED.stat().st_size/1024/1024:,.1f} MB)")
    print(f"  ✓ {FRONTEND_OBCINE.relative_to(ROOT)}")

    show = obcine_out[["OB_UIME", "walk_mean", "bike_mean", "population", "n_cells"]]
    print("\n  Top 5 občine by walk_mean:")
    print("   ", show.nlargest(5, "walk_mean").to_string(index=False).replace("\n", "\n    "))
    print("\n  Top 5 občine by bike_mean:")
    print("   ", show.nlargest(5, "bike_mean").to_string(index=False).replace("\n", "\n    "))


def export_investor(cells: gpd.GeoDataFrame) -> None:
    """Pre-bake investor-view demand so the browser doesn't compute it at runtime.

    Output: [{h3, wd, bd, p}] where wd/bd = walk/bike demand (pop × unmet share)
    and p = per-cell population. The browser uses these values directly, skipping
    the heavy useEffect compute and the need to load cell_population_lite.json.
    """
    print("\nPre-baking investor demand …")
    rows = []
    for row in cells[["h3", "walk_score", "bike_score", "population"]].itertuples(index=False):
        pop = float(row.population)
        if pop <= 0:
            continue  # skip cells with no population
        rows.append({
            "h3": row.h3,
            "wd": round(pop * (1.0 - row.walk_score / 8), 3),
            "bd": round(pop * (1.0 - row.bike_score / 8), 3),
            "p":  round(pop, 3),
        })
    blob = json.dumps(rows, separators=(",", ":"))
    OUTPUT_DEMAND.write_text(blob)
    FRONTEND_DEMAND.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_DEMAND.write_text(blob)
    print(f"  ✓ {OUTPUT_DEMAND.relative_to(ROOT)}  ({len(rows):,} cells, {OUTPUT_DEMAND.stat().st_size/1024:,.0f} KB)")
    print(f"  ✓ {FRONTEND_DEMAND.relative_to(ROOT)}")


def main() -> None:
    t0 = time.time()
    cells = load_populated_cells()
    isos = load_isochrones()
    scored = score(cells, isos)
    export(scored)
    export_investor(scored)
    aggregate_obcine(scored)
    print(f"\nTotal wall time: {(time.time() - t0)/60:.1f} min")


if __name__ == "__main__":
    main()
