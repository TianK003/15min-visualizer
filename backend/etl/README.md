# ETL pipeline

Python scripts that turn raw OSM + Kontur + SURS data into the static JSON +
Postgres rows that the frontend reads. Each script writes to `data/15min-slo/`
and / or `frontend/public/data/`. Local Supabase is the storage / RPC backend
(see [project_local_supabase memory](../../docs/superpowers/specs/) for the
local stack details).

## Run order (for the local Supabase stack)

1. `python 01_extract_amenities.py` — OSM → `amenities.gpkg` (~5 min, only when osm.pbf changes)
2. `python 02_isochrones.py` — Valhalla bake (~1.3 min warm, resumable)
3. `python 03_score_cells.py` — produces `cell_scores*` + `obcine_scored.geojson` (~30 s)
4. `bash 04_bake_overlays.sh` — tippecanoe → PMTiles (only when overlays change)
5. `python 05_export_population.py` — produces `cell_population_lite.json` (~20 s)
6. `python 09_demographics.py` — patches `cell_demand_lite.json` + `building_suggestions.json` with `sifra`; emits `obcine_demographics.json` (~30 s)
7. `supabase migration up` (from `backend/`) — applies all migrations including `0004_llm_search_v2.sql` (~5 s)
8. `python 06_upload_to_supabase.py` — uploads everything to local Postgres + Storage (~3-4 min). **MUST** run after step 7 or the `cell_scores` COPY fails because the new columns don't exist yet.
9. `python diagnostics/check_search_rpc.py` — verifies `search_cells_v2` with 6 golden cases (~5 s).

Re-running any step is safe — all are idempotent (TRUNCATE+COPY for tables, overwrites for files).

## Dependency notes

- **Step 6 → 9 ordering matters.** `09_demographics.py` writes `obcine_demographics.json` and adds a `sifra` column to `cell_demand_lite.json` + `building_suggestions.json`. Step 6 (`06_upload_to_supabase.py`) reads `obcine_demographics.json` and uses the shared `_demographics_helpers.build_h3_to_sifra()` to backfill `cell_scores.sifra` + `centroid_lat/lng`. If you swap the order, step 6 either skips the demographics upload (warning, not error) or runs but lacks the sifra mapping needed for the LLM-search RPC.
- **Migration before upload.** `06_upload_to_supabase.py` writes 9 columns to `cell_scores` (the new three were added by migration `0004_llm_search_v2.sql`). Without the migration applied, the COPY raises "column does not exist".
- **`_demographics_helpers.py`** is a sibling import — works because every ETL script is invoked from `backend/etl/` (Python auto-adds the cwd to sys.path).
