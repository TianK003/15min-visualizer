"""
Download all občina (municipality) data from SURS SiStat PxWeb API.

Outputs:
  - obcine_indicators.csv   — 58 indicators for all 212 občine (latest year)
  - obcine_age_distribution.csv — population by 5-year age group and sex (latest half-year)

API docs: https://pxweb.stat.si/SiStatData/pxweb/sl/Data/
"""

import json, csv, time, sys, pathlib, urllib.request, urllib.error

# Force UTF-8 output on Windows console
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://pxweb.stat.si/SiStatData/api/v1/sl/Data"
OUT_DIR = pathlib.Path(__file__).parent

# ── helpers ──────────────────────────────────────────────────────────────────

def api_get_metadata(table_id: str) -> dict:
    """GET table metadata (variables, codes, labels)."""
    url = f"{BASE}/{table_id}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def api_post_query(table_id: str, query: list, response_format: str = "json") -> dict:
    """POST a PxWeb query and return parsed JSON-stat response."""
    url = f"{BASE}/{table_id}"
    body = json.dumps({"query": query, "response": {"format": response_format}}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    # PxWeb may rate-limit; retry once after 5 s
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                print(f"  Rate-limited, waiting 10 s …")
                time.sleep(10)
            else:
                raise


def jsonstat_to_rows(js: dict) -> list[dict]:
    """
    Flatten a JSON-stat (v1, as returned by PxWeb) response into a list of dicts.
    Each dict maps dimension labels + "value" to the cell value.
    """
    # PxWeb returns {"columns":[...], "data":[{"key":[...], "values":["..."]},...]}
    # or the old JSON-stat format. We handle the PxWeb-native format here.
    cols = [c["text"] for c in js["columns"]]
    rows = []
    for entry in js["data"]:
        row = dict(zip(cols, entry["key"]))
        row["value"] = entry["values"][0]
        rows.append(row)
    return rows


# ── 1. Main indicators table: 2640010S.px ────────────────────────────────────

def download_indicators():
    table = "2640010S.px"
    print(f"\n{'='*60}")
    print(f"Downloading main indicators from {table} …")
    print(f"{'='*60}")

    meta = api_get_metadata(table)

    # Get variable codes
    meritve_var = next(v for v in meta["variables"] if v["code"] == "MERITVE")
    obcine_var  = next(v for v in meta["variables"] if v["code"] == "OBČINE")
    leto_var    = next(v for v in meta["variables"] if v["code"] == "LETO")

    all_meritve = meritve_var["values"]
    meritve_labels = dict(zip(meritve_var["values"], meritve_var["valueTexts"]))

    # Skip "SLOVENIJA" (code "0") — it's the national aggregate
    obcine_codes = [c for c in obcine_var["values"] if c != "0"]
    obcine_labels = dict(zip(obcine_var["values"], obcine_var["valueTexts"]))

    latest_year = leto_var["values"][-1]
    print(f"  Latest year: {latest_year}")
    print(f"  Občine: {len(obcine_codes)}")
    print(f"  Measurements: {len(all_meritve)}")

    # PxWeb has a cell limit per query (~100k). With 58 meritve × 212 občine × 1 year = 12,296 cells → OK.
    query = [
        {"code": "MERITVE", "selection": {"filter": "item", "values": all_meritve}},
        {"code": "OBČINE",  "selection": {"filter": "item", "values": obcine_codes}},
        {"code": "LETO",    "selection": {"filter": "item", "values": [latest_year]}},
    ]

    data = api_post_query(table, query)
    rows = jsonstat_to_rows(data)
    print(f"  Received {len(rows)} data cells")

    # Pivot: one row per občina, columns = measurements
    pivot = {}
    for r in rows:
        obcina = r["OBČINE"]
        meritev = r["MERITVE"]
        if obcina not in pivot:
            pivot[obcina] = {"Občina": obcina, "Leto": latest_year}
        pivot[obcina][meritev] = r["value"]

    # Sort by občina name
    sorted_rows = sorted(pivot.values(), key=lambda x: x["Občina"])

    # Column order
    col_names = ["Občina", "Leto"] + [meritve_labels[k] for k in all_meritve]

    outpath = OUT_DIR / "obcine_indicators.csv"
    with open(outpath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=col_names, extrasaction="ignore")
        writer.writeheader()
        for row in sorted_rows:
            # Map internal column keys to label-based keys
            out = {"Občina": row["Občina"], "Leto": row["Leto"]}
            for code in all_meritve:
                out[meritve_labels[code]] = row.get(code, "")
            writer.writerow(out)

    print(f"  ✓ Saved {len(sorted_rows)} občine → {outpath}")
    return outpath


# ── 2. Age distribution table: 05V1006S.px ──────────────────────────────────

def download_age_distribution():
    table = "05V1006S.px"
    print(f"\n{'='*60}")
    print(f"Downloading age distribution from {table} …")
    print(f"{'='*60}")

    meta = api_get_metadata(table)

    spol_var   = next(v for v in meta["variables"] if v["code"] == "SPOL")
    obcine_var = next(v for v in meta["variables"] if v["code"] == "OBČINE")
    pol_var    = next(v for v in meta["variables"] if v["code"] == "POLLETJE")
    age_var    = next(v for v in meta["variables"] if v["code"] == "STAROSTNE SKUPINE")

    obcine_codes = [c for c in obcine_var["values"] if c != "0"]
    obcine_labels = dict(zip(obcine_var["values"], obcine_var["valueTexts"]))
    spol_labels = dict(zip(spol_var["values"], spol_var["valueTexts"]))
    age_labels  = dict(zip(age_var["values"], age_var["valueTexts"]))

    latest_polletje = pol_var["values"][-1]
    # Use all sex categories: SKUPAJ, Moški, Ženske
    all_spol = spol_var["values"]
    # Use all age groups
    all_age = age_var["values"]

    print(f"  Latest half-year: {latest_polletje}")
    print(f"  Občine: {len(obcine_codes)}")
    print(f"  Sex categories: {len(all_spol)}")
    print(f"  Age groups: {len(all_age)}")

    # Cells = 3 × 212 × 1 × 22 = 13,992 → OK
    query = [
        {"code": "SPOL",              "selection": {"filter": "item", "values": all_spol}},
        {"code": "OBČINE",            "selection": {"filter": "item", "values": obcine_codes}},
        {"code": "POLLETJE",          "selection": {"filter": "item", "values": [latest_polletje]}},
        {"code": "STAROSTNE SKUPINE", "selection": {"filter": "item", "values": all_age}},
    ]

    data = api_post_query(table, query)
    rows = jsonstat_to_rows(data)
    print(f"  Received {len(rows)} data cells")

    # Pivot: one row per (občina, spol), columns = age groups
    pivot = {}
    for r in rows:
        obcina = r["OBČINE"]
        spol = r["SPOL"]
        age = r["STAROSTNE SKUPINE"]
        key = (obcina, spol)
        if key not in pivot:
            pivot[key] = {"Občina": obcina, "Spol": spol, "Polletje": latest_polletje}
        pivot[key][age] = r["value"]

    sorted_rows = sorted(pivot.values(), key=lambda x: (x["Občina"], x["Spol"]))

    col_names = ["Občina", "Spol", "Polletje"] + [age_labels[k] for k in all_age]

    outpath = OUT_DIR / "obcine_age_distribution.csv"
    with open(outpath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=col_names, extrasaction="ignore")
        writer.writeheader()
        for row in sorted_rows:
            out = {"Občina": row["Občina"], "Spol": row["Spol"], "Polletje": row["Polletje"]}
            for code in all_age:
                out[age_labels[code]] = row.get(code, "")
            writer.writerow(out)

    print(f"  ✓ Saved {len(sorted_rows)} rows → {outpath}")
    return outpath


# ── 3. Additional useful tables ──────────────────────────────────────────────

def download_salaries_detail():
    """Download detailed salary data per občina from 0701024S.px (annual, by municipality of workplace)."""
    table = "0701024S.px"
    print(f"\n{'='*60}")
    print(f"Downloading detailed salary data from {table} …")
    print(f"{'='*60}")

    meta = api_get_metadata(table)

    # Explore variables
    for v in meta["variables"]:
        print(f"  Variable: {v['code']} — {len(v['values'])} values")

    kazalnik_var = next(v for v in meta["variables"] if v["code"] == "KAZALNIK")
    obcine_var   = next(v for v in meta["variables"] if v["code"] == "OBČINE")
    leto_var     = next(v for v in meta["variables"] if v["code"] == "LETO")

    kazalnik_labels = dict(zip(kazalnik_var["values"], kazalnik_var["valueTexts"]))
    obcine_codes = [c for c in obcine_var["values"] if c != "0"]
    latest_year = leto_var["values"][-1]

    print(f"  Latest year: {latest_year}")
    print(f"  Salary measures: {list(kazalnik_labels.values())}")

    query = [
        {"code": "OBČINE",   "selection": {"filter": "item", "values": obcine_codes}},
        {"code": "KAZALNIK", "selection": {"filter": "item", "values": kazalnik_var["values"]}},
        {"code": "LETO",     "selection": {"filter": "item", "values": [latest_year]}},
    ]

    data = api_post_query(table, query)
    rows = jsonstat_to_rows(data)
    print(f"  Received {len(rows)} data cells")

    # Pivot
    pivot = {}
    for r in rows:
        obcina = r["OBČINE"]
        kazalnik = r["KAZALNIK"]
        if obcina not in pivot:
            pivot[obcina] = {"Občina": obcina, "Leto": latest_year}
        pivot[obcina][kazalnik] = r["value"]

    sorted_rows = sorted(pivot.values(), key=lambda x: x["Občina"])
    col_names = ["Občina", "Leto"] + [kazalnik_labels[k] for k in kazalnik_var["values"]]

    outpath = OUT_DIR / "obcine_salaries.csv"
    with open(outpath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=col_names, extrasaction="ignore")
        writer.writeheader()
        for row in sorted_rows:
            out = {"Občina": row["Občina"], "Leto": row["Leto"]}
            for code in kazalnik_var["values"]:
                out[kazalnik_labels[code]] = row.get(code, "")
            writer.writerow(out)

    print(f"  ✓ Saved {len(sorted_rows)} občine → {outpath}")
    return outpath


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print("SURS SiStat — Občine Data Downloader")
    print("=" * 60)

    results = []

    # 1. Main indicators (population, density, education, economy, etc.)
    results.append(download_indicators())
    time.sleep(2)  # polite delay

    # 2. Age distribution by sex
    results.append(download_age_distribution())
    time.sleep(2)

    # 3. Detailed salary data
    try:
        results.append(download_salaries_detail())
    except Exception as e:
        print(f"  ⚠ Salary detail table failed: {e}")

    print(f"\n{'='*60}")
    print("Done! Output files:")
    for r in results:
        print(f"  → {r}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
