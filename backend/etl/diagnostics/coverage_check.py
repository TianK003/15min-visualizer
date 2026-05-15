"""
Coverage diagnostic (TASKS §B1).

For each občina, verify it has n_cells > 0 and report cell coverage.
Surface any obvious gaps where Kontur missed populated terrain.

Usage:
  source backend/.venv/bin/activate
  python backend/etl/diagnostics/coverage_check.py
"""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "data" / "15min-slo"


def main() -> None:
    obcine = gpd.read_file(DATA_DIR / "obcine_scored.geojson")

    total = len(obcine)
    zero = int((obcine["n_cells"] == 0).sum())
    low = int(((obcine["n_cells"] > 0) & (obcine["n_cells"] < 10)).sum())

    print(f"Občine total:                   {total}")
    print(f"Občine with n_cells == 0:       {zero}")
    print(f"Občine with 0 < n_cells < 10:   {low}")
    print()

    if zero:
        print("⚠ Občine with no cells (uninhabited per Kontur or sjoin miss):")
        for _, r in obcine[obcine["n_cells"] == 0].iterrows():
            print(f"   - {r['OB_UIME']}  ({r['POV_KM2']:.1f} km²)")
        print()

    print("Bottom 10 by cell count:")
    bot = obcine.sort_values("n_cells").head(10)[["OB_UIME", "n_cells", "population", "POV_KM2"]]
    print(bot.to_string(index=False))
    print()
    print("Top 10 by cell count:")
    top = obcine.sort_values("n_cells", ascending=False).head(10)[["OB_UIME", "n_cells", "population", "POV_KM2"]]
    print(top.to_string(index=False))


if __name__ == "__main__":
    main()
