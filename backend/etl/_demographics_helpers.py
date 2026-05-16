# backend/etl/_demographics_helpers.py
"""
Shared building blocks for the demographics enrichment pipeline.

Both `09_demographics.py` (patches the JSON cell_demand file + emits
obcine_demographics.json) and `06_upload_to_supabase.py` (backfills the
cell_scores Postgres table with sifra + centroid) need the same h3 → sifra
mapping computed via h3.polygon_to_cells. Putting it here keeps a single
algorithm — boundary cells get the same občina assignment everywhere.
"""
from __future__ import annotations

import time
from pathlib import Path

import geopandas as gpd
import h3
from shapely.geometry import Polygon, MultiPolygon

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"
OBCINE_GEOJSON = DATA_DIR / "obcine.geojson"

H3_RES = 10


def load_obcine() -> gpd.GeoDataFrame:
    """Read obcine.geojson reprojected to EPSG:4326."""
    return gpd.read_file(OBCINE_GEOJSON).to_crs(4326)


def build_h3_to_sifra(obcine: gpd.GeoDataFrame, verbose: bool = True) -> dict[str, int]:
    """For every res-10 H3 cell inside each občina polygon, map cell → sifra.
    Uses h3.polygon_to_cells (centroid containment per H3 spec). ~20 s for 212
    polygons covering Slovenia. Boundary cells are deterministically assigned
    to whichever občina h3 puts them in."""
    if verbose:
        print("Building h3 → sifra map (h3.polygon_to_cells)…", flush=True)
    out: dict[str, int] = {}
    t0 = time.time()

    def _ring_to_coords(ring):
        # h3 v4 expects (lat, lng) pairs; shapely gives (lng, lat).
        return [(y, x) for (x, y) in ring]

    for _, row in obcine.iterrows():
        sifra = int(row["OB_ID"])
        geom = row.geometry
        polys: list[Polygon] = []
        if isinstance(geom, MultiPolygon):
            polys.extend(geom.geoms)
        elif isinstance(geom, Polygon):
            polys.append(geom)
        else:
            continue

        for poly in polys:
            outer = _ring_to_coords(poly.exterior.coords)
            holes = [_ring_to_coords(r.coords) for r in poly.interiors]
            shape = h3.LatLngPoly(outer, *holes) if holes else h3.LatLngPoly(outer)
            for c in h3.polygon_to_cells(shape, H3_RES):
                out[c] = sifra

    if verbose:
        print(f"  → {len(out):,} h3 cells assigned in {time.time()-t0:.1f}s", flush=True)
    return out
