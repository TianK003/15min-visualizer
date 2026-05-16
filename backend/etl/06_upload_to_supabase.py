"""
Step 6 — Upload ETL outputs into local Supabase.

Reads from data/15min-slo/ and writes to:
  - Postgres tables: obcine, protected_areas, amenities, amenity_isochrones, cell_scores
  - Storage buckets: cells/, overlays/

Env (defaults match `supabase start` local stack):
  DATABASE_URL          postgresql://postgres:postgres@127.0.0.1:54322/postgres
  SUPABASE_URL          http://127.0.0.1:54321
  SUPABASE_SERVICE_KEY  sb_secret_...   (from `supabase status --output env`)

Usage:
  source backend/.venv/bin/activate
  python backend/etl/06_upload_to_supabase.py
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
from pathlib import Path

import geopandas as gpd
import httpx
import pandas as pd
import psycopg
from dotenv import load_dotenv
from psycopg import sql

from _demographics_helpers import build_h3_to_sifra, load_obcine

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "15min-slo"

# Load secrets from backend/.env if present. The file is .gitignored.
load_dotenv(ROOT / "backend" / ".env")

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_KEY:
    sys.exit(
        "SUPABASE_SERVICE_KEY is required. Either:\n"
        "  - copy backend/.env.example to backend/.env and fill in the key, or\n"
        "  - export SUPABASE_SERVICE_KEY=$(supabase status --output env | "
        "grep '^SECRET_KEY=' | cut -d= -f2 | tr -d '\"')"
    )


def log(msg: str) -> None:
    print(msg, flush=True)


def upload_obcine(conn: psycopg.Connection) -> None:
    log("--- obcine ---")
    gdf = gpd.read_file(DATA_DIR / "obcine.geojson").to_crs(4326)
    rows = []
    for _, r in gdf.iterrows():
        rows.append((
            int(r["OB_ID"]) if pd.notna(r["OB_ID"]) else None,
            str(r["OB_UIME"]),
            r["OB_TIP"] == "D",
            r.geometry.wkt,
        ))
    with conn.cursor() as cur:
        cur.execute("truncate table obcine restart identity cascade;")
        cur.executemany(
            "insert into obcine (sifra, naziv, mestna_obcina, geom) "
            "values (%s, %s, %s, ST_Multi(ST_GeomFromText(%s, 4326)));",
            rows,
        )
    conn.commit()
    log(f"  OK: {len(rows):,} obcine")


def upload_protected_areas(conn: psycopg.Connection) -> None:
    log("--- protected_areas ---")
    rows = []
    for src, fname, cat_col in [
        ("zavarovana", "zavarovana_si.geojson", "ZO_VRSTA"),
        ("natura2000", "natura2000_si.geojson", "N2K_TIP_OBMOCJA"),
    ]:
        gdf = gpd.read_file(DATA_DIR / fname).to_crs(4326)
        for _, r in gdf.iterrows():
            rows.append((
                src,
                str(r[cat_col]) if pd.notna(r[cat_col]) else None,
                str(r["IME_OBM"]) if pd.notna(r["IME_OBM"]) else None,
                r.geometry.wkt,
            ))
    with conn.cursor() as cur:
        cur.execute("truncate table protected_areas restart identity cascade;")
        cur.executemany(
            "insert into protected_areas (source, category, name, geom) "
            "values (%s, %s, %s, ST_Multi(ST_GeomFromText(%s, 4326)));",
            rows,
        )
    conn.commit()
    log(f"  OK: {len(rows):,} protected areas")


def upload_amenities(conn: psycopg.Connection) -> None:
    log("--- amenities ---")
    gdf = gpd.read_file(DATA_DIR / "amenities.gpkg").to_crs(4326)
    rows = []
    for _, r in gdf.iterrows():
        rows.append((
            int(r["amenity_id"]),
            None,
            str(r["category"]),
            str(r["name"]) if pd.notna(r["name"]) else None,
            r.geometry.wkt,
        ))
    with conn.cursor() as cur:
        cur.execute("truncate table amenities restart identity cascade;")
        cur.executemany(
            "insert into amenities (id, osm_id, category, name, geom) "
            "values (%s, %s, %s, %s, ST_SetSRID(ST_GeomFromText(%s), 4326));",
            rows,
        )
        cur.execute(
            "select setval(pg_get_serial_sequence('amenities', 'id'), "
            "(select coalesce(max(id), 1) from amenities));"
        )
    conn.commit()
    log(f"  OK: {len(rows):,} amenities")


def upload_isochrones(conn: psycopg.Connection, batch_size: int = 2000) -> None:
    log("--- amenity_isochrones ---")
    with conn.cursor() as cur:
        cur.execute("truncate table amenity_isochrones cascade;")
    conn.commit()

    total = 0
    rows: list[tuple] = []

    def flush() -> None:
        nonlocal total
        if not rows:
            return
        with conn.cursor() as cur:
            cur.executemany(
                "insert into amenity_isochrones (amenity_id, mode, contour_min, polygon) "
                "values (%s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))) "
                "on conflict do nothing;",
                rows,
            )
        conn.commit()
        total += len(rows)
        rows.clear()
        sys.stdout.write(f"\r  loaded {total:,}")
        sys.stdout.flush()

    with (DATA_DIR / "amenity_isochrones.jsonl").open() as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows.append((
                int(rec["amenity_id"]),
                rec.get("mode", "pedestrian"),
                int(rec["contour_min"]),
                json.dumps(rec["geometry"]),
            ))
            if len(rows) >= batch_size:
                flush()
        flush()
    log(f"\n  OK: {total:,} isochrones")


def upload_cell_scores(conn: psycopg.Connection) -> None:
    log("--- cell_scores (~1.08M rows, COPY) ---")
    src = DATA_DIR / "cell_scores.json"

    # Build h3 → sifra ONCE before the copy loop. Adds ~20 s; total runtime
    # is dominated by the COPY itself anyway. centroid_lat/lng come from h3
    # so we don't need a parallel structure.
    obcine = load_obcine()
    h3_to_sifra = build_h3_to_sifra(obcine)

    t = time.time()
    with src.open() as f:
        cells = json.load(f)
    log(f"  loaded JSON in {time.time()-t:.1f}s")

    with conn.cursor() as cur:
        cur.execute("truncate table cell_scores;")
    conn.commit()

    t = time.time()
    with conn.cursor() as cur:
        with cur.copy(
            "copy cell_scores "
            "(h3, walk_score, bike_score, walk_min, bike_min, population, "
            " sifra, centroid_lat, centroid_lng) from stdin"
        ) as cp:
            import h3 as h3lib
            for c in cells:
                walk = c["walk_min"]
                bike = c.get("bike_min") or [None] * 8
                walk_lit = "{" + ",".join("NULL" if v is None else str(int(v)) for v in walk) + "}"
                bike_lit = "{" + ",".join("NULL" if v is None else str(int(v)) for v in bike) + "}"
                pop = c.get("population")
                pop_str = "\\N" if pop is None else f"{pop}"
                walk_score = c.get("walk_score", c.get("score", 0))
                bike_score = c.get("bike_score", 0)
                # Sifra + centroid. Cells outside any občina polygon get \\N
                # for sifra and skip centroid (the INNER JOIN in the RPC drops
                # them).
                sifra = h3_to_sifra.get(c["h3"])
                if sifra is None:
                    sifra_str = "\\N"
                    lat_str = "\\N"
                    lng_str = "\\N"
                else:
                    lat, lng = h3lib.cell_to_latlng(c["h3"])
                    sifra_str = str(sifra)
                    lat_str = f"{lat:.6f}"
                    lng_str = f"{lng:.6f}"
                cp.write(
                    f"{c['h3']}\t{walk_score}\t{bike_score}\t{walk_lit}\t{bike_lit}\t{pop_str}\t"
                    f"{sifra_str}\t{lat_str}\t{lng_str}\n"
                )
    conn.commit()
    log(f"  OK: {len(cells):,} cell_scores in {time.time()-t:.1f}s")


def upload_obcine_demographics(conn: psycopg.Connection) -> None:
    """Read obcine_demographics.json (already an artifact of 09_demographics.py)
    and TRUNCATE + COPY 212 rows into the Postgres table."""
    log("--- obcine_demographics ---")
    src = ROOT / "frontend" / "public" / "data" / "obcine_demographics.json"
    if not src.exists():
        log(f"  ⚠ {src.relative_to(ROOT)} missing — run 09_demographics.py first; skipping")
        return

    with src.open() as f:
        payload = json.load(f)

    with conn.cursor() as cur:
        cur.execute("truncate table obcine_demographics;")
        with cur.copy("copy obcine_demographics (sifra, el65, kids) from stdin") as cp:
            for sifra_str, v in payload.items():
                cp.write(f"{int(sifra_str)}\t{v['el65']}\t{v['kids']}\n")
    conn.commit()
    log(f"  OK: {len(payload):,} obcine_demographics")


def upload_storage_files() -> None:
    log("--- Storage buckets + files ---")
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
    }
    with httpx.Client(base_url=SUPABASE_URL, headers=headers, timeout=120.0) as cli:
        for bucket in ("cells", "overlays"):
            r = cli.post(
                "/storage/v1/bucket",
                json={"id": bucket, "name": bucket, "public": True},
            )
            if r.status_code in (200, 201):
                log(f"  OK: created bucket {bucket}")
            elif r.status_code == 409 or "already exists" in r.text.lower():
                log(f"  OK: bucket {bucket} exists")
            else:
                log(f"  ERR: bucket {bucket}: HTTP {r.status_code} {r.text}")

        # Supabase Storage doesn't preserve Content-Encoding headers, so we
        # upload the uncompressed JSON. The .gz stays in `data/` for cold deploys
        # to platforms (Vercel, Cloudflare) that gzip-on-the-fly.
        files = [
            ("cells",    "cell_scores_lite.json",     "cell_scores_lite.json",     "application/json",     None),
            ("cells",    "cell_demand_lite.json",     "cell_demand_lite.json",     "application/json",     None),
            ("overlays", "obcine_scored.geojson",     "obcine_scored.geojson",     "application/geo+json", None),
            ("overlays", "cell_population_lite.json", "cell_population_lite.json", "application/json",     None),
            ("overlays", "zavarovana_si.geojson",     "zavarovana_si.geojson",     "application/geo+json", None),
        ]
        for bucket, src_name, dst_name, ctype, encoding in files:
            src = DATA_DIR / src_name
            if not src.exists():
                log(f"  ⚠ {src_name} missing in data dir, skipping")
                continue
            up_headers = dict(headers)
            up_headers["Content-Type"] = ctype
            if encoding:
                up_headers["Content-Encoding"] = encoding
            up_headers["x-upsert"] = "true"
            with src.open("rb") as fh:
                r = cli.post(
                    f"/storage/v1/object/{bucket}/{dst_name}",
                    content=fh.read(),
                    headers=up_headers,
                )
            if r.status_code in (200, 201):
                log(f"  OK: {bucket}/{dst_name}  ({src.stat().st_size/1024:,.0f} KB)")
            else:
                log(f"  ERR: {bucket}/{dst_name}: HTTP {r.status_code} {r.text[:200]}")


def verify_counts(conn: psycopg.Connection) -> None:
    log("\n--- verifying row counts ---")
    with conn.cursor() as cur:
        for t in ("obcine", "protected_areas", "amenities", "amenity_isochrones",
                  "cell_scores", "obcine_demographics"):
            cur.execute(sql.SQL("select count(*) from {}").format(sql.Identifier(t)))
            (n,) = cur.fetchone()
            log(f"  {t:<22} {n:>10,}")


def main() -> None:
    t0 = time.time()
    log(f"Connecting to {DB_URL.split('@')[-1]} …")
    with psycopg.connect(DB_URL, autocommit=False) as conn:
        upload_obcine(conn)
        upload_protected_areas(conn)
        upload_amenities(conn)
        upload_isochrones(conn)
        upload_cell_scores(conn)
        upload_obcine_demographics(conn)   # ← new
        verify_counts(conn)

    upload_storage_files()
    log(f"\nDone in {(time.time()-t0)/60:.1f} min")


if __name__ == "__main__":
    main()
