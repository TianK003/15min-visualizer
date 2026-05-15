"""
Step 1 — extract amenities from the Slovenia OSM PBF and classify them into the 8 categories.

Inputs:
  - data/15min-slo/slovenia-latest.osm.pbf

Outputs:
  - data/15min-slo/amenities.gpkg            (single layer with all 8 categories, point geometry)
  - data/15min-slo/amenity_counts.json       (sanity-check counts per category)

The 8 categories are locked in PLAN.md §4.

Strategy: call `osmium tags-filter` (system binary) once per category to produce a
filtered PBF, then `osmium export` to GeoJSON, then GeoPandas to compute a
representative point per feature and combine into one GeoDataFrame.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"
INPUT_PBF = DATA_DIR / "slovenia-latest.osm.pbf"
OUTPUT_GPKG = DATA_DIR / "amenities.gpkg"
COUNTS_JSON = DATA_DIR / "amenity_counts.json"

# Locked osmium tag-filter expressions per category (PLAN.md §4).
# Prefix nwr/ = match nodes, ways, and relations.
CATEGORY_FILTERS: dict[str, list[str]] = {
    "trgovina": ["nwr/shop=supermarket,convenience,bakery"],
    "izobrazevanje": ["nwr/amenity=kindergarten,school"],
    "zdravstvo": ["nwr/amenity=clinic,doctors,hospital,pharmacy"],
    "park": ["nwr/leisure=park"],
    "promet": ["nwr/public_transport=stop_position,station,platform"],
    "sport": ["nwr/leisure=sports_centre,playground,pitch"],
    "storitve": ["nwr/amenity=post_office,bank,hairdresser,restaurant"],
    "delo": ["nwr/office"],  # any office=* value
}


def extract_category(category: str, filters: list[str], workdir: Path) -> gpd.GeoDataFrame:
    """Filter the PBF for one category, export to GeoJSON, return a point GeoDataFrame."""
    filtered_pbf = workdir / f"{category}.osm.pbf"
    geojson = workdir / f"{category}.geojson"

    subprocess.run(
        [
            "osmium", "tags-filter",
            "--overwrite",
            "-o", str(filtered_pbf),
            str(INPUT_PBF),
            *filters,
        ],
        check=True,
        capture_output=True,
    )

    # osmium export computes proper geometries (polygons for closed ways, etc.)
    # and skips features without valid geometry.
    subprocess.run(
        [
            "osmium", "export",
            "--overwrite",
            "-o", str(geojson),
            "-f", "geojson",
            str(filtered_pbf),
        ],
        check=True,
        capture_output=True,
    )

    if geojson.stat().st_size < 50:
        return gpd.GeoDataFrame(
            {"category": [], "name": [], "geometry": []}, geometry="geometry", crs="EPSG:4326"
        )

    gdf = gpd.read_file(geojson)

    # Collapse polygons/lines to representative points.
    gdf["geometry"] = gdf.geometry.representative_point()
    gdf["category"] = category
    keep_cols = ["category", "geometry"]
    if "name" in gdf.columns:
        keep_cols.insert(1, "name")
    return gdf[keep_cols]


def main() -> None:
    if not INPUT_PBF.exists():
        sys.exit(f"Missing input: {INPUT_PBF}. See data/DATA_SOURCES.md.")

    if shutil.which("osmium") is None:
        sys.exit("`osmium` CLI not found on PATH. Install with `sudo apt install osmium-tool`.")

    print(f"Reading {INPUT_PBF.name} ({INPUT_PBF.stat().st_size / 1e6:.0f} MB)\n")

    with tempfile.TemporaryDirectory(prefix="etl_amenities_") as tmp:
        workdir = Path(tmp)
        frames: list[gpd.GeoDataFrame] = []
        counts: dict[str, int] = {}

        for category, filters in CATEGORY_FILTERS.items():
            print(f"  [{category}]")
            gdf = extract_category(category, filters, workdir)
            counts[category] = len(gdf)
            print(f"    {len(gdf):,} features")
            if not gdf.empty:
                frames.append(gdf)

    if not frames:
        sys.exit("No amenities extracted — something is wrong with the PBF or filters.")

    combined = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs="EPSG:4326")
    combined.insert(0, "amenity_id", range(len(combined)))

    # GPKG output, single layer
    if OUTPUT_GPKG.exists():
        OUTPUT_GPKG.unlink()
    combined.to_file(OUTPUT_GPKG, driver="GPKG", layer="amenities")

    counts["_total"] = len(combined)
    COUNTS_JSON.write_text(json.dumps(counts, indent=2, ensure_ascii=False))

    print(f"\n✓ {len(combined):,} amenities written to {OUTPUT_GPKG.relative_to(ROOT)}")
    print(f"✓ Counts → {COUNTS_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
