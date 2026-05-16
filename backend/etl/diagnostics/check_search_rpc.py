# backend/etl/diagnostics/check_search_rpc.py
"""
Smoke-test the search_cells_v2 RPC against the live local Supabase.

Reads `search_cells_v2_cases.json` and for each case calls the RPC and checks
that at least one of the expected občine appears in the top 5. Prints a pass /
fail line per case and exits non-zero if any case fails.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
CASES = Path(__file__).with_name("search_cells_v2_cases.json")
load_dotenv(ROOT / "backend" / ".env")

URL = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321")
KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not KEY:
    sys.exit("SUPABASE_SERVICE_KEY required (see backend/.env)")


def run_case(case: dict) -> bool:
    body = {
        "filter_spec": case["filter_spec"],
        "ranking_weights": case["ranking_weights"],
        "target_lat": case["target_lat"],
        "target_lng": case["target_lng"],
        "p_limit": 5,
    }
    r = httpx.post(
        f"{URL}/rest/v1/rpc/search_cells_v2",
        json=body,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"},
        timeout=30.0,
    )
    if r.status_code != 200:
        print(f"  ✗ HTTP {r.status_code}: {r.text[:200]}")
        return False
    rows = r.json()
    obcine = [row["obcina_name"] for row in rows]
    hit = any(o in case["expected_obcina_in_top5"] for o in obcine)
    if hit:
        print(f"  ✓ top5 = {obcine}")
    else:
        print(f"  ✗ top5 = {obcine}  (expected one of {case['expected_obcina_in_top5']})")
    return hit


def main() -> None:
    with CASES.open() as f:
        spec = json.load(f)
    fails = 0
    for case in spec["cases"]:
        print(f"\n▶ {case['name']}")
        if not run_case(case):
            fails += 1
    print()
    if fails:
        sys.exit(f"{fails}/{len(spec['cases'])} cases FAILED")
    print(f"all {len(spec['cases'])} cases passed ✓")


if __name__ == "__main__":
    main()
