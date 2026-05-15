# Backend

Three pieces here, only loosely coupled:

- `etl/` — Python pipeline that produces `cell_scores.json.gz` and the PMTiles overlays.
- `valhalla/` — Dockerfile + config for the Valhalla routing container (graph build from Slovenia OSM, exposed on port 8002).
- `supabase/migrations/` — SQL migrations for the PostgreSQL schema (tables, indexes, RLS).

## Python environment setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

System-level dependencies (not in `requirements.txt` — install via OS package manager):

- GDAL ≥ 3.8 (`gdalinfo --version`) — required by GeoPandas / Fiona at runtime
- `osmium-tool` for CLI filtering of the OSM PBF
- `tippecanoe` for the PMTiles bake in `etl/04_bake_overlays.sh`

## Running the ETL pipeline

The four scripts in `etl/` run in order. Each reads/writes via Postgres + the `data/15min-slo/` raw files.

```bash
# 1. Filter OSM, classify amenities, write to PostGIS
python etl/01_extract_amenities.py

# 2. Call Valhalla for every amenity (long-running; ~3–5 h on 16 cores)
python etl/02_isochrones.py

# 3. Score every populated H3 cell, export gzipped JSON
python etl/03_score_cells.py

# 4. Bake PMTiles for protected/ghosts overlays
bash etl/04_bake_overlays.sh
```

See `ARCHITECTURE.md` §"Phase 1 — ETL components" for what each step does in detail.

## Valhalla

The Docker image is built from `valhalla/Dockerfile`. It pulls the `gis-ops/docker-valhalla` upstream and bakes in the Slovenia OSM extract.

Build and run locally:
```bash
docker build -t valhalla-slo ./valhalla
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
docker logs -f valhalla-slo   # wait for the worker-ready signal
```

Smoke test (Prešernov trg, 15-min pedestrian isochrone):
```bash
curl -X POST http://localhost:8002/isochrone \
  -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":46.0512,"lon":14.5061}],"costing":"pedestrian","contours":[{"time":15}],"polygons":true}'
```

## Supabase

Migrations apply via the Supabase CLI:
```bash
supabase db push
```

Add new migration files as `supabase/migrations/<timestamp>_description.sql`.
