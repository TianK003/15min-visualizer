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

- **[`docs/TASKS.md`](./docs/TASKS.md)** — current state of the build + the full roadmap to completion (every remaining task, priority-tagged with acceptance criteria). **Read this first if returning to the project.**
- **[`docs/PLAN.md`](./docs/PLAN.md)** — full project plan, scoring formula, locked decisions, two-day timeline.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — system reference: every component and why it's there. See `docs/ARCHITECTURE.svg` for the diagram.
- **[`docs/CHECKLIST.md`](./docs/CHECKLIST.md)** — provisioning checklist (accounts, tools, smoke tests).
- **[`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md)** — every dataset, where it comes from, exact curl to fetch it.

## Quick start

```bash
# 1. Confirm raw data is on disk (see data/DATA_SOURCES.md for download commands)
ls data/15min-slo/

# 2. Frontend — show the map
cd frontend && pnpm install && pnpm dev   # → http://localhost:3000

# 3. Backend — run the ETL pipeline (assumes Valhalla container is up)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
docker build -t valhalla-slo ./valhalla
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
python etl/01_extract_amenities.py
python etl/02_isochrones.py
python etl/03_score_cells.py
```

## Current state

End-to-end pipeline runs. **37,622 OSM amenities → 112,866 isochrones → 1,079,666 scored cells (res-10) → 212 občine** with population-weighted mean. Wall time ~10 min cold, ~30 s warm re-bake of step 03. See `docs/TASKS.md` for the criteria-satisfied checklist and the full roadmap.

The map:
- Country zoom: 212 občine coloured by mean walkability score.
- City zoom: aggregating H3 hex layer (res 6 → 7 → 8 → 9 → 10 as you zoom).
- Click any polygon → stats logged to the browser console. Hex click is currently off at zoom ≥ 13 for perf — re-enabled when the scorecard lands (see TASKS §C2).

## License

Apache 2.0.
