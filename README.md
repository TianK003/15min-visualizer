# Ekipa: GEOGuessr

An interactive map showing how much of Slovenia is a true 15-minute neighborhood — every populated H3 cell scored 0–8 on walking access to the daily amenities people actually need, aggregated up to občine for the country view.

Built for **GEO Slovenija** (15.–16. maj 2026) with a polish window through **SLO4D** (9. junij 2026).

## What ships in the UI

- **Address search bar** (top center) — Photon primary, Nominatim fallback, 5-char minimum, SI-bounded
- **Click-anywhere Scorecard** — 0–8 score, per-category time chips, walk/bike toggle, live 15-min isochrone reveal, click a category row to draw paths to each reachable amenity in that category's color
- **Hoja / Kolo** mode toggle — flips the whole view (badge, chips, iso polygon, amenity pin set, active route) to real Valhalla `bicycle` costing
- **AI assistant** (bottom-right circular chat FAB) — describe a life scenario in Slovenian; the LLM picks categories + a target town and flies the map to the best cell
- **Investitor view** — second top-row pill switches the score map for a demand map (`population × (1 − served)`). Vertical category-filter pill column on the left, viridis-style 4-step palette with full hue + luminance separation for color-blind safety, dark-purple "zanemarljivo" for fully-served cells, pale parchment for Slovenia's unpopulated terrain (forests / ridges / lakes synthesized client-side from the obcina polygons)
- **Light + dark theme** — toggle in the bottom-left cluster or inside "Izvor podatkov"; persists to localStorage and swaps the basemap (positron ↔ dark-matter)
- **Provenance panel "Izvor podatkov"** — one card per dataset with licence, count, and rationale; links to the REST API docs
- **REST API docs** (`/api-docs`) — tabbed Swagger UI: hand-authored OpenAPI 3.1 for the Next.js routes (`/api/llm`, `/api/valhalla/{endpoint}`) + auto-generated PostgREST spec for the Supabase tables
- **Permalink** — every pan/zoom/click writes `#lng/lat/z/h3` to the URL; sharing the link restores the exact view

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

## Setup (WSL2 on Windows)

> The whole stack runs **inside WSL2** (Ubuntu). Only the browser stays on Windows — it talks to `http://localhost:3000` (Next.js), which proxies Supabase calls through to WSL via a same-origin path. Don't install Docker or Python on Windows; do all of it in the WSL shell.

All commands assume an Ubuntu shell opened in WSL (`wsl` or "Ubuntu" Start-menu icon). Paths use forward slashes.

### 1 · Install WSL2 + Ubuntu *(skip if already done)*

In **PowerShell as Administrator** on Windows:
```powershell
wsl --install -d Ubuntu
```
Reboot when prompted, then launch "Ubuntu" from the Start menu and create your Linux user.

### 2 · Install Docker Desktop with WSL2 backend

Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/). In Docker Desktop → Settings → **Resources → WSL Integration**, enable integration with your Ubuntu distro. Launch Docker Desktop and wait for the whale icon to settle.

Verify from the WSL shell:
```bash
docker --version
```

### 3 · Install the rest of the toolchain *(WSL shell)*

```bash
# Core build tools
sudo apt update && sudo apt install -y git curl build-essential

# Node.js 20 LTS + pnpm via Corepack
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable pnpm

# Python 3.12
sudo apt install -y python3.12 python3.12-venv python3-pip

# Supabase CLI (Linux amd64 binary)
mkdir -p ~/.local/bin
curl -sLo /tmp/supabase.tar.gz \
  https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz
tar -xzf /tmp/supabase.tar.gz -C ~/.local/bin/ supabase
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
exec $SHELL          # reload PATH

# Verify
git --version && node --version && pnpm --version && python3.12 --version
docker --version && supabase --version
```

### 4 · Clone the repo *(inside WSL)*

```bash
cd ~
git clone https://github.com/TianK003/15min-visualizer.git
cd 15min-visualizer
```

> **Keep the working copy on the WSL filesystem** (`~/15min-visualizer`, not `/mnt/c/...`). Cross-filesystem I/O is ~10× slower and breaks file-watcher hot-reload.

### 5 · Pre-fetch the raw datasets

The Geofabrik OSM extract, GURS občine, ARSO protected areas, and Kontur population GPKG are too large for git and live in `data/15min-slo/` (gitignored). Follow [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) — each source has the exact `curl` command. The relevant files end up as:

```
data/15min-slo/slovenia-latest.osm.pbf
data/15min-slo/obcine.geojson
data/15min-slo/zavarovana_si.geojson
data/15min-slo/natura2000_si.geojson
data/15min-slo/kontur_population_SI.gpkg
```

Quick start for the OSM extract:
```bash
mkdir -p data/15min-slo
curl -L https://download.geofabrik.de/europe/slovenia-latest.osm.pbf \
  -o data/15min-slo/slovenia-latest.osm.pbf
```

### 6 · Python virtual environment for the backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 7 · Frontend dependencies

```bash
cd frontend
pnpm install
cd ..
```

### 8 · Configure environment variables

**`backend/.env`** (gitignored — start from the example):
```bash
cp backend/.env.example backend/.env
```
Open `backend/.env` and fill in `SUPABASE_SERVICE_KEY` after step 9 below.

**`frontend/.env.local`** (gitignored — committed in the repo as a template if you wiped it, otherwise leave it):
```
NEXT_PUBLIC_SUPABASE_URL=/sb
SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste PUBLISHABLE_KEY from `supabase status --output env`>
NEXT_PUBLIC_USE_REMOTE_DATA=true
VALHALLA_URL=http://127.0.0.1:8002
```

The `/sb` value is intentional — `next.config.mjs` rewrites it server-side to `SUPABASE_INTERNAL_URL`. Browser talks to `localhost:3000/sb/...` (same-origin, no WSL port-forwarding issue); Next.js running inside WSL forwards to `127.0.0.1:54321`.

### 9 · Bring Supabase up and apply migrations

```bash
cd backend
supabase start          # first run pulls ~1 GB of Docker images
supabase status --output env
```
Copy `SECRET_KEY=` from the output into `backend/.env` as `SUPABASE_SERVICE_KEY`, and `PUBLISHABLE_KEY=` into `frontend/.env.local` as `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The migrations in `backend/supabase/migrations/` apply automatically.

Endpoints once it's up:
- REST: <http://127.0.0.1:54321> *(reachable only from WSL)*
- Studio (DB UI): <http://127.0.0.1:54323> *(open it from Windows — WSL forwards port 54323 the same way it forwards 3000)*
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

### 10 · Build and start the Valhalla container

The Valhalla Dockerfile downloads the SI OSM extract during the build and bakes a routing graph (~10 min on a modern laptop, one-time).

```bash
cd backend/valhalla
docker build -t valhalla-slo .
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
cd ../..
```

Smoke test (from WSL):
```bash
curl -X POST http://localhost:8002/isochrone -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":46.0512,"lon":14.5061}],"costing":"pedestrian","contours":[{"time":15}],"polygons":true}'
```

### 11 · Run the ETL pipeline once

```bash
cd backend
source .venv/bin/activate
python etl/01_extract_amenities.py     # ~30 s — OSM → 37,622 amenities
python etl/02_isochrones.py            # ~1.3 min — 112,866 isochrones (resumable)
python etl/03_score_cells.py           # ~30 s — 1,079,666 H3 cells scored
python etl/05_export_population.py     # ~10 s — population sidecar JSON
python etl/07_bin_cells_to_tiles.py    # ~5 s — F1 partial-load shards
python etl/08_flag_unbuildable.py      # ~20 s — flag protected-area cells
python etl/06_upload_to_supabase.py    # ~30 s — push everything to local Supabase
cd ..
```

> `06_upload_to_supabase.py` reads `SUPABASE_SERVICE_KEY` from `backend/.env`. If you skipped step 8 you'll get a clear error.

### 12 · Start the dev server

```bash
cd frontend
pnpm dev
```

Then open <http://localhost:3000> **in your Windows browser**. Country choropleth loads within a few seconds; click any občina or hex to open the Scorecard.

---

## Daily dev loop *(after first-time setup)*

```bash
# In a fresh WSL shell. Docker Desktop on Windows must already be running.
sudo chmod 666 /var/run/docker.sock     # only if Docker daemon restarted
cd ~/15min-visualizer/backend
supabase start                          # ~3 s if already initialized
docker start valhalla-slo               # instant if already built
cd ../frontend
pnpm dev                                # → open http://localhost:3000 in Windows
```

To shut everything down:
```bash
cd ~/15min-visualizer/backend
supabase stop
docker stop valhalla-slo
# Then Ctrl-C the `pnpm dev` window.
```

## Re-running the ETL

Run only the script whose inputs changed:

| Script | When to re-run |
|---|---|
| `01_extract_amenities.py` | OSM extract updated or category filters changed |
| `02_isochrones.py` | Amenity set changed (resumable — re-runs only missing rows) |
| `03_score_cells.py` | Scoring formula or H3 resolution changed |
| `05_export_population.py` | After `03` if you changed the population aggregation |
| `07_bin_cells_to_tiles.py` | After `03` if you want fresh partial-load shards |
| `08_flag_unbuildable.py` | After `protected_areas` changed |
| `06_upload_to_supabase.py` | After any of the above, to push to Supabase |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: command not found` in WSL | Docker Desktop not running, or WSL integration not enabled. Open Docker Desktop → Settings → Resources → WSL Integration |
| `permission denied while trying to connect to the Docker daemon socket` | `sudo chmod 666 /var/run/docker.sock` (re-run after each daemon restart) |
| `pnpm: command not found` | `sudo corepack enable pnpm`, then close + reopen the WSL shell |
| Frontend shows "Podatki s strežnika niso dosegljivi (Failed to fetch)" in Windows browser | WSL2 doesn't forward port 54321. Confirm `NEXT_PUBLIC_SUPABASE_URL=/sb` (not the raw URL) in `frontend/.env.local`, then restart `pnpm dev` so `next.config.mjs` picks up the rewrite |
| Frontend shows the yellow "vzorčne celice" banner | Supabase not running or upload not done. `supabase status` should show all services up; then re-run `06_upload_to_supabase.py` |
| Scorecard stuck on "Nalagam …" | Open devtools → Network. Look for `/sb/rest/v1/cell_scores?h3=eq.` and `/sb/rest/v1/rpc/amenities_for_point`. 401 means anon key mismatch in `.env.local`; 404 means the upload script wasn't run |
| Valhalla container 405 in browser console | By design; the app calls Valhalla via `/api/valhalla/*` (server-side proxy). Don't fetch port 8002 directly from the browser |
| Photon dropdown returns 400 | `&lang=sl` isn't supported by Photon; the code already omits it. Don't re-add it |
| Photon down entirely | The address search auto-falls back to Nominatim (`nominatim.openstreetmap.org/search`), bounded to Slovenia. If both fail, the dropdown shows "Iskanje naslova ni na voljo" |
| `/api/llm` returns 501 | `OPENROUTER_API_KEY` not set in `.env.local`. The chatbot calls OpenRouter; either set the key or close the chat affordance for the demo |
| Dark mode "stuck" | `localStorage.theme` persists across sessions. Open devtools → Application → Local Storage and remove the `theme` key to fall back to system preference |
| ETL `08_flag_unbuildable.py` fails with "relation does not exist" | Migrations not applied. Run `supabase db reset --local` and try again |
| `supabase start` hangs at "Pulling postgres..." | Docker Desktop just woke up — give it a minute. If it never finishes, `docker pull supabase/postgres:17.X.X` manually |
| Slow file-watch / `EBUSY` errors | Repo is on `/mnt/c/...`. Move it to the WSL filesystem (`~/`) |

## License

Apache 2.0.
