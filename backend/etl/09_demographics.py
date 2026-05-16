"""
Step 9 — enrich investor-view data with per-občina demographic context.

This is a post-processing step on top of the outputs from 03_score_cells.py.
It does NOT touch the per-cell scores, only adds the občina sifra (OB_ID) to
the demand cells and suggestion pins, and emits a small lookup table mapping
sifra → demographic indicators (currently just el65, the 65+ share).

The frontend uses this to apply an "elderly bonus" multiplier to demand in
the Zdravstvo (cat 2) investor view: areas with a higher 65+ share get a
higher implied need for new healthcare. The multiplier is tunable in
Map.tsx (ELDERLY_WEIGHT_ZDRAVSTVO).

Inputs:
  - data/15min-slo/cell_demand_lite.json    (h3, wd, bd, p)
  - frontend/public/data/building_suggestions.json
  - data/15min-slo/obcine.geojson           (OB_ID = sifra, OB_UIME = name)
  - data/obcine_indicators.csv              (SURS scrape, "Občina" = 3-digit sifra)

Outputs (overwritten in place):
  - data/15min-slo/cell_demand_lite.json           + frontend copy   (adds `s`)
  - frontend/public/data/building_suggestions.json                   (adds `s`)
  - data/15min-slo/obcine_demographics.json        + frontend copy   (new)

Performance notes:
  cell_demand_lite has ~1.08M rows. We build the h3 → sifra mapping once via
  h3.polygon_to_cells per občina (fast, ~5 s total for 212 polygons at res 10),
  not a per-cell PIP. Pins are joined separately with a small STRtree.
"""
from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point
from shapely.strtree import STRtree

from _demographics_helpers import build_h3_to_sifra, load_obcine

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"
DATA_RAW = ROOT / "data"
FRONTEND_DATA = ROOT / "frontend" / "public" / "data"

DEMAND_PATH = DATA_DIR / "cell_demand_lite.json"
FRONTEND_DEMAND = FRONTEND_DATA / "cell_demand_lite.json"
SUGGESTIONS_PATH = FRONTEND_DATA / "building_suggestions.json"
OBCINE_GEOJSON = DATA_DIR / "obcine.geojson"
INDICATORS_CSV = DATA_RAW / "obcine_indicators.csv"
DEMOGRAPHICS_OUT = DATA_DIR / "obcine_demographics.json"
FRONTEND_DEMOGRAPHICS = FRONTEND_DATA / "obcine_demographics.json"

H3_RES = 10
EL65_COL = "Delež prebivalcev starih 65 let ali več - 1. januar"
KIDS_COL = "Delež prebivalcev starih 0 do 14 let - 1. januar"


def log(msg: str) -> None:
    print(msg, flush=True)


def load_indicators() -> dict[int, dict]:
    """Read obcine_indicators.csv, return
        {sifra_int: {el65: float, kids: float}}.
    SURS sifre come as 3-digit zero-padded strings ('001', '002', …). The
    age-share columns are percents (e.g. '21.2'); we divide by 100 to get
    fractions. Rows with empty fields (rare) fall back to national means."""
    out: dict[int, dict] = {}

    def _pct(value: str | None, fallback: float) -> float:
        if value is None:
            return fallback
        cleaned = value.strip().replace(",", ".")
        try:
            return float(cleaned) / 100.0
        except (ValueError, TypeError):
            return fallback

    with INDICATORS_CSV.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sifra_str = row.get("Občina", "").strip()
            if not sifra_str:
                continue
            try:
                sifra = int(sifra_str)
            except ValueError:
                continue
            el65 = _pct(row.get(EL65_COL), 0.21)
            kids = _pct(row.get(KIDS_COL), 0.15)
            out[sifra] = {"el65": round(el65, 4), "kids": round(kids, 4)}
    log(f"  loaded {len(out)} občine from indicators CSV")
    return out


def write_demographics(demographics: dict[int, dict], obcine: gpd.GeoDataFrame) -> None:
    # Attach name from obcine.geojson so the frontend can debug-print without
    # carrying a parallel name file.
    by_sifra = {int(r["OB_ID"]): str(r["OB_UIME"]) for _, r in obcine.iterrows()}
    payload = {}
    for sifra, d in demographics.items():
        payload[str(sifra)] = {
            "el65": d["el65"],
            "kids": d["kids"],
            "name": by_sifra.get(sifra, ""),
        }
    blob = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    DEMOGRAPHICS_OUT.write_text(blob, encoding="utf-8")
    FRONTEND_DEMOGRAPHICS.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_DEMOGRAPHICS.write_text(blob, encoding="utf-8")
    log(f"  ✓ {DEMOGRAPHICS_OUT.relative_to(ROOT)}  ({len(payload)} občine, {DEMOGRAPHICS_OUT.stat().st_size/1024:.1f} KB)")
    log(f"  ✓ {FRONTEND_DEMOGRAPHICS.relative_to(ROOT)}")


def patch_cell_demand(h3_to_sifra: dict[str, int]) -> None:
    log("Patching cell_demand_lite.json …")
    t0 = time.time()
    with DEMAND_PATH.open() as f:
        rows = json.load(f)
    matched = 0
    for r in rows:
        s = h3_to_sifra.get(r["h3"])
        if s is None:
            continue
        r["s"] = s
        matched += 1
    blob = json.dumps(rows, separators=(",", ":"))
    DEMAND_PATH.write_text(blob)
    FRONTEND_DEMAND.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_DEMAND.write_text(blob)
    log(f"  matched {matched:,} / {len(rows):,} cells in {time.time()-t0:.1f}s "
        f"({DEMAND_PATH.stat().st_size/1024/1024:.1f} MB)")


def patch_suggestions(obcine: gpd.GeoDataFrame) -> None:
    """Spatially join each pin to its containing občina via STRtree.
    1200 pins × 212 polygons → < 1 s with the index."""
    if not SUGGESTIONS_PATH.exists():
        log(f"  Skipping suggestions patch: {SUGGESTIONS_PATH} not found.")
        return
    log("Patching building_suggestions.json …")
    t0 = time.time()
    with SUGGESTIONS_PATH.open() as f:
        data = json.load(f)

    geoms = list(obcine.geometry.values)
    sifras = [int(s) for s in obcine["OB_ID"].values]
    tree = STRtree(geoms)

    matched = 0
    unmatched = 0
    for cat_idx, pins in data.items():
        for pin in pins:
            pt = Point(pin["lng"], pin["lat"])
            # STRtree.query returns *indices* of candidate geoms in shapely 2.x.
            cand = tree.query(pt)
            assigned = None
            for idx in cand:
                if geoms[idx].contains(pt):
                    assigned = sifras[idx]
                    break
            if assigned is None:
                # Fallback: closest centroid (border/coast pins). Rare.
                best_d = float("inf")
                for i, g in enumerate(geoms):
                    d = pt.distance(g)
                    if d < best_d:
                        best_d = d
                        assigned = sifras[i]
                unmatched += 1
            pin["s"] = assigned
            matched += 1
    blob = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    SUGGESTIONS_PATH.write_text(blob, encoding="utf-8")
    log(f"  matched {matched} pins ({unmatched} via centroid fallback) "
        f"in {time.time()-t0:.1f}s")


def main() -> None:
    log(f"Reading {OBCINE_GEOJSON.relative_to(ROOT)} …")
    obcine = load_obcine()
    log(f"  {len(obcine)} polygons")

    demographics = load_indicators()
    write_demographics(demographics, obcine)

    h3_to_sifra = build_h3_to_sifra(obcine)
    patch_cell_demand(h3_to_sifra)
    patch_suggestions(obcine)

    log("\nDone.")


if __name__ == "__main__":
    sys.exit(main())
