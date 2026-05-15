# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**15min Slovenija** — an interactive map scoring every populated H3 cell in Slovenia 0–8 on walking access to eight daily-needs categories, plus a population-density heatmap view. Built for the **GEO Slovenija** hackathon (15.–16. maj 2026) with a polish window through **SLO4D** (9. junij 2026). Slovenian-only UI; no i18n layer.

## Read these first

- `docs/TASKS.md` — **single source of truth for current state and the roadmap.** Read before starting work; tasks are priority-tagged (P0/P1/P2) with acceptance criteria.
- `docs/PLAN.md` — locked design decisions and the rationale for each (scoring formula, H3 resolution, color buckets, etc.).
- `docs/ARCHITECTURE.md` — system reference with the two-phase ETL→runtime diagram.
- `data/DATA_SOURCES.md` — every dataset with the exact curl to fetch it.

## Common commands

Frontend (Next.js 14 App Router, run from `frontend/`):
```bash
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm build        # production bundle
pnpm lint         # next lint
```

Backend ETL (Python 3.12 venv at `backend/.venv`, run from repo root):
```bash
source backend/.venv/bin/activate
python backend/etl/01_extract_amenities.py   # OSM → PostGIS amenities
python backend/etl/02_isochrones.py          # Valhalla bake, resumable (~1.3 min warm)
python backend/etl/03_score_cells.py         # ~30 s — produces cell_scores* + obcine_scored.geojson
python backend/etl/05_export_population.py   # res-10 → res-9 sum, produces cell_population_lite.json
bash backend/etl/04_bake_overlays.sh         # tippecanoe → PMTiles
```

Valhalla container (port 8002):
```bash
sudo chmod 666 /var/run/docker.sock   # if daemon restarted
docker start valhalla-slo
curl -X POST http://localhost:8002/isochrone -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":46.0512,"lon":14.5061}],"costing":"pedestrian","contours":[{"time":15}],"polygons":true}'
```

ETL is idempotent and partially resumable: re-run only the step whose inputs changed. `02_isochrones.py` resumes from a JSONL staging file; `03` and `05` are pure functions of their inputs.

## Architecture in one screen

Two phases, deliberately decoupled:

1. **ETL / precompute** (Python, runs locally) — OSM amenities → 112,866 pedestrian isochrones via local Valhalla → spatial-join populated Kontur cells (res 10) → `cell_scores_lite.json` (`{h3, score}`) and `cell_population_lite.json` (`{h3, pop}`, summed to res 9). Both files ship as static assets in `frontend/public/data/`.

2. **Live runtime** (browser) — Next.js fetches the two JSON files once, then `h3-js cellToParent` aggregates client-side per zoom. No tile pyramid; no server roundtrip for resolution changes. The single piece of "live" infra is Valhalla on Railway for click-to-isochrone (not yet wired in the live route).

Everything in `Map.tsx` flows from these conventions:

- **H3 base resolution is 10** (`H3_BASE_RES`). Score JSON is res-10 raw; population JSON is *pre-aggregated to res 9* in the ETL script for a 7× smaller payload.
- **Zoom→resolution map** in `zoomToResolution()` (6/7/8/9/10 across zoom 7→15+). Below `SHOW_OBCINE_FILL_BELOW` (= 9) the občina polygon layer takes over from hex tiles.
- **Two views** — `view: "15min" | "population"`, toggled by the bottom-right pill. Each branch in the layer-build effect must paint both at low (občina) and high (hex/heatmap) zoom — when adding a third view, mirror this structure.
- **Score layer** uses `H3HexagonLayer` with mean aggregation (`aggregateMean`). Picking + strokes are off at res ≥ 9 — stroke = 6 line segments per cell, picking = a second pass per mousemove, both dominate frame time at 1M cells.
- **Population layer** uses `HeatmapLayer` from `@deck.gl/aggregation-layers`. Points are H3 centroids precomputed once via `h3.cellToLatLng`; the GPU does Gaussian density + summing. Tunables are sensitive — the user has iterated on `radiusPixels` (currently 40) and `opacity` (0.5 so basemap labels read through). Do not "improve" without checking with them.
- **Občina low-zoom layer** is colored by `mean_score` (15-min view) only; population view drops the občina fill entirely and lets the heatmap cover all zooms.

## Things to know that aren't obvious from the code

- **The population fetch effect deliberately omits `popsLoading` from its deps.** Including it caused React to tear down the effect (flipping the cleanup's `cancelled = true`) the moment we called `setPopsLoading(true)`, aborting the in-flight fetch. See the comment block on the effect — don't "fix" it back.
- **The `cell_scores.json` full-fat file (~112 MB) lives only on disk** at `data/15min-slo/cell_scores.json`; only the lite file (h3+score) is committed/shipped. `05_export_population.py` reads the full file to get the population column.
- **`obcine_scored.geojson`** carries `mean_score`, `population`, `n_cells`, and `POV_KM2` — derive density on the fly (`population / POV_KM2`); there's no pre-baked density column.
- **OpenFreeMap basemap** is currently `positron` (was `liberty` for color saturation — switched back for perf, see TASKS §D2). No API key required.
- **Score color thresholds** are locked: 🟢 6–8 / 🟡 4–5 / 🟠 2–3 / 🔴 0–1. See PLAN §4. **Population palette** is a 6-stop magma applied via `HeatmapLayer.colorRange`; the swatch in `globals.css` `.legend-gradient` must stay in sync.
- The OSM amenity tag set and the eight categories are locked in PLAN §4. Adding a ninth category was explicitly rejected (TASKS §B3).

## Repo layout

```
frontend/   Next.js 14 App Router + MapLibre + deck.gl
backend/    etl/ Python pipeline + valhalla/ Docker + supabase/ migrations
data/       raw downloads (gitignored) + DATA_SOURCES.md
docs/       PLAN.md, ARCHITECTURE.md, TASKS.md, CHECKLIST.md, GEO-SLOVENIJA-CONFORM.md
```

## When you change something

- A new dataset means a new card in the "Izvor podatkov" provenance panel (TASKS §D6). Data without a public rationale doesn't ship — this is a hackathon scoring criterion, not a nice-to-have.
- Backend deploy targets are not live yet (Supabase, Railway Valhalla — both still TODO per TASKS §A1–A3). Frontend reads static JSON from `public/data/`; do not assume a REST API exists.
- After non-trivial frontend changes, run `pnpm typecheck` *and* `pnpm build`. The build catches things tsc misses (route generation, static analysis). UI behavior must be eyeballed via `pnpm dev` — there's no test suite.
