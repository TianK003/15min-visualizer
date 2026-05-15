"""
Step 8 — tag cell_scores.unbuildable=true for cells inside protected areas
(TASKS §B4).

Runs entirely in Postgres via a spatial join. With the GIST index on
protected_areas.geom this is one ST_Within sweep per cell — typically
~10–30s for 1.08M cells against 886 polygons.

Source data is already in protected_areas table (loaded by 06_upload_to_supabase.py).
Cell centroids are reconstructed from h3 via the h3-py library so we don't
need the h3-pg extension installed in Postgres.
"""
from __future__ import annotations

import io
import os
import time

import h3
import psycopg

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)


def main() -> None:
    t0 = time.time()
    with psycopg.connect(DB_URL) as conn:
        # 1. Materialize a temp table of cell centroids
        with conn.cursor() as cur:
            print("Building cell centroid temp table …")
            cur.execute("create temporary table _cell_pts (h3 text primary key, geom geometry(Point, 4326));")

            cur.execute("select h3 from cell_scores")
            rows = cur.fetchall()
            print(f"  {len(rows):,} cells to project")

            buf = io.StringIO()
            for (h,) in rows:
                lat, lng = h3.cell_to_latlng(h)
                buf.write(f"{h}\tSRID=4326;POINT({lng} {lat})\n")
            buf.seek(0)
            t1 = time.time()
            with cur.copy("copy _cell_pts (h3, geom) from stdin") as cp:
                cp.write(buf.getvalue())
            print(f"  populated in {time.time()-t1:.1f}s")

            cur.execute("create index on _cell_pts using gist (geom);")

            # 2. Flag cells whose centroid is within any protected polygon
            print("Spatial join → setting unbuildable …")
            cur.execute("""
                update cell_scores cs
                set unbuildable = true
                where exists (
                  select 1 from _cell_pts p
                  join protected_areas pa on st_within(p.geom, pa.geom)
                  where p.h3 = cs.h3
                );
            """)
            n = cur.rowcount
            print(f"  flagged {n:,} cells")

            cur.execute("select count(*) filter (where unbuildable), count(*) from cell_scores;")
            unb, tot = cur.fetchone()
            pct = unb * 100.0 / tot if tot else 0
            print(f"\nResult: {unb:,} / {tot:,} cells unbuildable ({pct:.1f}%)")
        conn.commit()
    print(f"Done in {(time.time()-t0)/60:.1f} min")


if __name__ == "__main__":
    main()
