# Ekipa: GEOGuessr

An interactive map showing how much of Slovenia is a true 15-minute neighborhood — every populated H3 cell scored 0–8 on walking access to the daily amenities people actually need, aggregated up to občine for the country view.

Built for **GEO Slovenija** (15.–16. maj 2026) with a polish window through **SLO4D** (9. junij 2026).

## Repo layout

```
/
├── frontend/      Next.js 14 + MapLibre + deck.gl — the map UI
├── backend/       Python ETL pipeline, Valhalla container, Supabase migrations
├── data/          Raw downloads + the data-sources catalog
└── docs/          Project plan, architecture, checklists, handoff notes
```

## Documentation

- **[`docs/TASKS.md`](./docs/TASKS.md)** — current state of the build + the full roadmap to completion. **Read this first if returning to the project.**
- **[`docs/PLAN.md`](./docs/PLAN.md)** — full project plan, scoring formula, locked decisions, two-day timeline.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — system reference: every component and why it's there.
- **[`docs/CHECKLIST.md`](./docs/CHECKLIST.md)** — provisioning checklist (accounts, tools, smoke tests).
- **[`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md)** — every dataset, where it comes from, exact curl to fetch it.

---

## Setup (Windows)

All commands assume **PowerShell** (default Windows terminal). Run them from a fresh PowerShell window unless noted. Paths use backslashes; Windows accepts forward slashes too if you prefer.

### 1 · Install prerequisites

Install each of these once. Versions listed are the minimum tested.

| Tool | Recommended install | Verify |
|---|---|---|
| **Git** | `winget install --id Git.Git` | `git --version` |
| **Node.js 20+** | `winget install --id OpenJS.NodeJS.LTS` | `node --version` |
| **pnpm 10+** | `corepack enable pnpm` (ships with Node) | `pnpm --version` |
| **Python 3.12** | `winget install --id Python.Python.3.12` | `python --version` |
| **Docker Desktop** | `winget install --id Docker.DockerDesktop` | `docker --version` after launching Docker Desktop |
| **Supabase CLI** | `scoop install supabase` (install scoop first: see [scoop.sh](https://scoop.sh)) — or download [the latest `supabase_windows_amd64.tar.gz`](https://github.com/supabase/cli/releases/latest), extract, put `supabase.exe` on PATH | `supabase --version` |

After installing Docker Desktop, **launch it** and wait for the whale icon to go steady — Docker must be running before `supabase start` and `docker start valhalla-slo`.

### 2 · Clone the repo

```powershell
git clone https://github.com/TianK003/15min-visualizer.git
cd 15min-visualizer
```

### 3 · Pre-fetch the raw datasets

The Geofabrik OSM extract, GURS občine, ARSO protected areas, and Kontur population GPKG are too large for git and live in `data/15min-slo/` (gitignored). Follow [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) — each source has the exact `curl` (or `Invoke-WebRequest`) command. The relevant files end up as:

```
data\15min-slo\slovenia-latest.osm.pbf
data\15min-slo\obcine.geojson
data\15min-slo\zavarovana_si.geojson
data\15min-slo\natura2000_si.geojson
data\15min-slo\kontur_population_SI.gpkg
```

PowerShell equivalent for the OSM extract:
```powershell
mkdir data\15min-slo -Force
Invoke-WebRequest https://download.geofabrik.de/europe/slovenia-latest.osm.pbf -OutFile data\15min-slo\slovenia-latest.osm.pbf
```

### 4 · Python virtual environment for the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1     # if blocked: run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
pip install -r requirements.txt
cd ..
```

### 5 · Frontend dependencies

```powershell
cd frontend
pnpm install
cd ..
```

### 6 · Configure environment variables

**`backend\.env`** (gitignored — start from the example file):
```powershell
copy backend\.env.example backend\.env
```
Open `backend\.env` and fill in `SUPABASE_SERVICE_KEY` after step 7 below (you'll get it from `supabase status --output env`).

**`frontend\.env.local`** (gitignored — create new):
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste PUBLISHABLE_KEY from `supabase status --output env`>
NEXT_PUBLIC_USE_REMOTE_DATA=true
VALHALLA_URL=http://127.0.0.1:8002
```

### 7 · Bring Supabase up and apply migrations

```powershell
cd backend
supabase start          # first run pulls ~1 GB of Docker images
supabase status --output env > .env.status   # copy keys from here into the two env files above
```

Default endpoints once it's up:
- REST: <http://127.0.0.1:54321>
- Studio (DB UI): <http://127.0.0.1:54323>
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

### 8 · Build and start the Valhalla container

The Valhalla Dockerfile downloads the SI OSM extract during the build and bakes a routing graph (~10 min on a modern laptop).

```powershell
cd backend\valhalla
docker build -t valhalla-slo .
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
cd ..\..
```

Smoke test:
```powershell
curl -X POST http://localhost:8002/isochrone -H "Content-Type: application/json" -d '{\"locations\":[{\"lat\":46.0512,\"lon\":14.5061}],\"costing\":\"pedestrian\",\"contours\":[{\"time\":15}],\"polygons\":true}'
```

### 9 · Run the ETL pipeline once

These produce the score tables on disk. Total wall time ~5 min on a modern laptop, mostly the isochrone bake.

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python etl\01_extract_amenities.py     # ~30 s — OSM → 37,622 amenities
python etl\02_isochrones.py            # ~1.3 min — 112,866 isochrones (resumable)
python etl\03_score_cells.py           # ~30 s — 1,079,666 H3 cells scored
python etl\05_export_population.py     # ~10 s — population sidecar JSON
python etl\07_bin_cells_to_tiles.py    # ~5 s — F1 partial-load shards
python etl\08_flag_unbuildable.py      # ~20 s — flag protected-area cells
python etl\06_upload_to_supabase.py    # ~30 s — push everything to local Supabase
cd ..
```

> **Note:** `06_upload_to_supabase.py` reads `SUPABASE_SERVICE_KEY` from `backend\.env`. If you skipped step 6 you'll get a clear error.

### 10 · Start the dev server

```powershell
cd frontend
pnpm dev
```

Open <http://localhost:3000>. You should see the country choropleth load within a few seconds. Click any občina or hex → the Scorecard panel opens.

---

## Daily dev loop *(after first-time setup)*

```powershell
# Make sure Docker Desktop is running, then:
cd backend
supabase start                    # ~3 s if already initialized
docker start valhalla-slo         # instant if already built
cd ..\frontend
pnpm dev                          # → http://localhost:3000
```

To shut everything down:
```powershell
cd backend
supabase stop
docker stop valhalla-slo
# Then Ctrl-C the `pnpm dev` window.
```

## Re-running the ETL

You don't need to re-run every step every time. Run only the script whose inputs changed:

| Script | When to re-run |
|---|---|
| `01_extract_amenities.py` | OSM extract updated or category filters changed |
| `02_isochrones.py` | Amenity set changed (resumable — re-runs only missing rows) |
| `03_score_cells.py` | Scoring formula or H3 resolution changed |
| `05_export_population.py` | After `03` if you changed the population aggregation |
| `07_bin_cells_to_tiles.py` | After `03` if you want fresh partial-load shards |
| `08_flag_unbuildable.py` | After protected_areas changed |
| `06_upload_to_supabase.py` | After any of the above, to push to Supabase |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm: command not found` | `corepack enable pnpm` then close + reopen PowerShell |
| `cannot be loaded because running scripts is disabled` when activating venv | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (one-time) |
| `supabase start` hangs / Docker errors | Open Docker Desktop, wait for "Docker Engine running" |
| `docker: error during connect ... pipe/docker_engine` | Same — Docker Desktop isn't running |
| Frontend shows the yellow "vzorčne celice" banner | Supabase isn't reachable. Check `supabase status`, confirm `NEXT_PUBLIC_SUPABASE_URL` matches |
| `Failed to fetch` on first load (Windows browser) | You're not on WSL2 anymore so the proxy isn't needed — make sure `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` in `frontend\.env.local` |
| Valhalla container 405 on browser request | By design; the app calls Valhalla via the `/api/valhalla/*` proxy. Don't fetch port 8002 directly from the browser |
| Photon dropdown returns 400 | `&lang=sl` isn't supported by Photon; the code already omits it. If you re-add it, expect 400 |
| Scorecard stuck on "Nalagam …" | Open devtools → Network → look for the `/rest/v1/cell_scores?h3=eq.` and `/rest/v1/rpc/amenities_for_point` calls. 401 means anon key mismatch; 404 means the upload script wasn't run |
| ETL `08_flag_unbuildable.py` fails with "relation does not exist" | Migrations not applied. Run `supabase db reset --local` and try again |

## License

Apache 2.0.
