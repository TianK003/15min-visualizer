# Provisioning Checklist

> Goal: walk into the build session with infra warm — accounts created, projects provisioned, Slovenia OSM extract downloaded, Valhalla tested locally, repo skeleton on `main`. Total time: **~3–4 hours**, spread however suits you.

Work top-to-bottom. Items marked **(team)** can be delegated; the rest are tech-lead.

---

## Phase 1 — Accounts & projects (30 min)

### 1.1 GitHub org + repo
- [ ] Create org `15min-slovenija` (or use personal). Public.
- [ ] Create repo `15min-slovenija/app` — public, Apache 2.0 license, default branch `main`.
- [ ] Add team members with write access.
- [ ] Create issues board with milestones: `Day 1`, `Day 2`, `SLO4D polish`.

### 1.2 Vercel
- [ ] Sign in with GitHub at [vercel.com](https://vercel.com).
- [ ] Create project, link to `15min-slovenija/app`, **root directory `frontend`**.
- [ ] Don't deploy yet — wait until repo skeleton has at least the empty Next.js scaffold.
- [ ] Note auto-generated URL (e.g. `15min-slovenija.vercel.app`).

### 1.3 Supabase
- [ ] Sign up at [supabase.com](https://supabase.com).
- [ ] Create org "GEO Slovenija."
- [ ] Create project — **region: Frankfurt (eu-central-1)**, Postgres 16, Free plan.
- [ ] Save project URL + anon key + service_role key in a 1Password / Bitwarden vault. **Never commit them.**
- [ ] In SQL editor, run:
  ```sql
  create extension if not exists postgis;
  create extension if not exists h3;            -- via dbdev or h3-pg
  create extension if not exists postgis_topology;
  ```
  *(if `h3` extension errors, see [supabase/database/extensions](https://supabase.com/docs/guides/database/extensions); install via `dbdev` or fall back to client-side H3 in Python.)*

### 1.4 Railway (for Valhalla)
- [ ] Sign up with GitHub at [railway.app](https://railway.app).
- [ ] Add $5 credit (free) or upgrade to Hobby ($5/mo) — Valhalla container needs 2–4 GB RAM.
- [ ] Don't create the Valhalla service yet — happens after Phase 4 below.

### 1.5 (Optional) Cloudflare R2 — for PMTiles hosting
- [ ] Sign up at [cloudflare.com](https://cloudflare.com).
- [ ] Create R2 bucket `15min-slo-tiles`, public read.
- [ ] Generate S3-compatible API token.
- [ ] *Or skip and use Supabase Storage for the PMTiles file — also fine.*

> **No Maptiler signup needed.** The basemap is OpenFreeMap `positron` — free, no API key, no registration.

---

## Phase 2 — Local dev environment (1 h)

### 2.1 Tools (verify all `--version` works)
- [ ] Node 20+ (`node -v`)
- [ ] pnpm 9+ (`npm i -g pnpm`)
- [ ] Python 3.11+ (`python3 --version`)
- [ ] Docker Desktop (running)
- [ ] GDAL 3.8+ (`gdalinfo --version`) — for OSM/raster work
- [ ] tippecanoe (`tippecanoe -v`) — for PMTiles bake
  - macOS: `brew install tippecanoe`
  - Linux: build from source
- [ ] osmium (`osmium --version`) — for OSM filtering
  - `brew install osmium-tool` or `apt install osmium-tool`
- [ ] PMTiles CLI (`pmtiles --version`)
  - `brew install pmtiles` or download from [protomaps releases](https://github.com/protomaps/go-pmtiles/releases)
- [ ] `jq` for inspecting GeoJSONs (`jq --version`)

### 2.2 Editor
- [ ] VS Code with extensions: ESLint, Prettier, Python, Pylance, GitLens, Even Better TOML.

---

## Phase 3 — Data pre-fetch

All five data layers should be on disk under `data/15min-slo/` before the build starts. See **`data/DATA_SOURCES.md`** for the exact curl command per layer — license, layer name, and verification step are documented there.

- [ ] `slovenia-latest.osm.pbf` (~308 MB) — Geofabrik
- [ ] `obcine.geojson` — 212 features, stefanb GitHub mirror
- [ ] `zavarovana_si.geojson` — ~531 polygons, ARSO WFS
- [ ] `natura2000_si.geojson` — ~355 polygons, ARSO WFS
- [ ] `kontur_population_SI.gpkg` — HDX

---

## Phase 4 — Valhalla dry-run (1 h)

The single highest-risk piece of infrastructure. Validate locally before the build window.

### 4.1 Build the Valhalla container
- [ ] Pull official image:
  ```bash
  docker pull ghcr.io/gis-ops/docker-valhalla/valhalla:latest
  ```
- [ ] Create work dir:
  ```bash
  mkdir -p ~/15minut/backend/valhalla/custom_files
  cp ~/15minut/data/15min-slo/slovenia-latest.osm.pbf ~/15minut/backend/valhalla/custom_files/
  ```
- [ ] Run with SI extract (graph build ~5–10 min):
  ```bash
  docker run -d --name valhalla-slo \
    -p 8002:8002 \
    -v $HOME/15minut/backend/valhalla/custom_files:/custom_files \
    -e tile_urls="" \
    -e use_tiles_ignore_pbf=False \
    -e build_elevation=True \
    -e build_admins=True \
    -e build_time_zones=True \
    -e force_rebuild=True \
    ghcr.io/gis-ops/docker-valhalla/valhalla:latest
  ```
- [ ] Watch logs: `docker logs -f valhalla-slo`. Wait for `loki_worker_t::process` ready signal.

### 4.2 Smoke-test isochrone API
- [ ] Hit isochrone endpoint with a Ljubljana coordinate (Prešernov trg ≈ 46.0512, 14.5061):
  ```bash
  curl -X POST http://localhost:8002/isochrone \
    -H 'Content-Type: application/json' \
    -d '{
      "locations":[{"lat":46.0512,"lon":14.5061}],
      "costing":"pedestrian",
      "contours":[{"time":15,"color":"ff0000"}],
      "polygons":true
    }'
  ```
- [ ] Expect a GeoJSON feature with a polygon. Drag-drop into [geojson.io](https://geojson.io) and visually verify it covers central Ljubljana.

### 4.3 Bicycle smoke test
- [ ] Same call as 4.2 but `"costing":"bicycle"`. Polygon should be larger than the pedestrian one (covers ~2.5× the radius).
- [ ] If both work, you've validated the only routing modes the demo needs.

---

## Phase 5 — Repo skeleton (1 h)

The simple `frontend/` + `backend/` + `data/` skeleton already exists in this directory. Confirm:

- [ ] `frontend/package.json` and `frontend/app/page.tsx` exist
- [ ] `frontend/components/Map.tsx` exists
- [ ] `frontend/public/data/obcine.geojson` exists (copy from `data/15min-slo/`)
- [ ] `backend/requirements.txt` exists
- [ ] `backend/etl/01_extract_amenities.py` (and 02, 03, 04) exist as stubs
- [ ] `backend/valhalla/Dockerfile` exists
- [ ] `backend/supabase/migrations/` exists (empty for now)
- [ ] Root `README.md`, plus `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/CHECKLIST.md`, `docs/TASKS.md` all present
- [ ] `.gitignore` covers `node_modules/`, `.venv/`, `.next/`, raw `.pbf` and `.gpkg`

### 5.1 Install frontend dependencies
```bash
cd frontend && pnpm install
pnpm dev   # smoke-test the dev server
```

### 5.2 Install backend dependencies
```bash
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

### 5.3 `.env.local` (frontend, not committed)
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_VALHALLA_URL=https://valhalla-15min-slo.up.railway.app
NEXT_PUBLIC_LIVE_ISOCHRONE=true
```

### 5.4 CI minimal
- [ ] `.github/workflows/ci.yml` — lint + typecheck on PR. Skip tests for hackathon.
- [ ] Vercel auto-deploy on push to `main`. Confirm preview URL works.

---

## Phase 6 — Kickoff-morning smoke tests (30 min)

Run the night before or first thing on the build day at the venue.

- [ ] `curl https://[supabase-url]/rest/v1/` returns 200.
- [ ] Hit Photon: `curl 'https://photon.komoot.io/api/?q=Ljubljana+Slovenska+cesta+12&limit=5'` returns SI results.
- [ ] Hit Valhalla on Railway (after deploy): isochrone endpoint returns polygon.
- [ ] Hex JSON (once ETL has run): `curl https://[supabase-url]/storage/v1/object/public/cells/cell_scores.json.gz | gunzip | head` returns valid JSON; total length ~1.08M entries (was ~50k when baking at res-9).
- [ ] PMTiles overlays (ghosts + protected, once baked): open in [pmtiles viewer](https://protomaps.github.io/PMTiles/).
- [ ] Vercel preview: load `[project].vercel.app`, see Slovenia map with občine outlines.

If all six green: every yak shave is removed, building starts the moment the room opens.

---

## What to bring to the venue

- Laptop, charger, **second laptop or large external monitor**
- Ethernet cable + USB-C dongle (M Hotel WiFi will be loaded)
- Printed copy of this checklist + PLAN.md
- Slack/Discord/Telegram team channel pinned
- 1Password / Bitwarden access for shared keys
- Phone hotspot as WiFi backup
- Snacks, caffeine of choice, change of clothes (you sleep there per the brief)

---

## If things go sideways

| Symptom | Fix |
|---|---|
| Supabase h3 extension won't install | Compute H3 cells in Python, store as `text` column. Spatial joins still work via PostGIS. |
| Valhalla won't run on Railway | Fall back to OSRM (much lighter, walking + bicycle profiles both supported). Lose the isochrone polygon — show just the score + pin list on click. |
| Photon mangles SI addresses | Switch to Mapbox geocoder. Free tier covers the demo. |
| JSON cell payload too big (>5 MB compressed) | Currently at ~3 MB gzip (res-10). If it grows past 5 MB, switch on partial loading per res-7 parent tile — implementation plan in TASKS §F1. PMTiles ghosts/protected files are small (<10 MB) — non-issue. |
| OSM amenities missing in rural SI | Add OSM contribution as part of demo narrative — "we identified 47 missing kindergartens, here's the OpenStreetMap diff." |
