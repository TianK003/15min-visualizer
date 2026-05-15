# Frontend — 15min Slovenija

Next.js 14 (App Router) + MapLibre GL JS + deck.gl. Renders the basemap, občine boundaries, and an H3 res-10 hex heatmap. The hex layer reads real scores from `public/data/cell_scores_lite.json` (produced by `../backend/etl/03_score_cells.py`); the dummy-Ljubljana fallback only activates if that file is missing.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Type-check:
```bash
pnpm typecheck
```

Build for production:
```bash
pnpm build && pnpm start
```

## What you see

- **Basemap:** OpenFreeMap `liberty` style (hosted, no API key — switched from `positron` for higher saturation through 0.5-alpha hex fills).
- **Overlay 1, zoom < 9:** 212 občine filled by population-weighted mean score (`public/data/obcine_scored.geojson`).
- **Overlay 2, zoom ≥ 9:** H3 hex heatmap. Baked at res-10 (~66 m edge, ~1.08M cells), aggregated client-side to res 6/7/8/9/10 by zoom — see `zoomToResolution()` in `components/Map.tsx`. At zoom ≥ 13, hex strokes and pick-on-hover are disabled for perf.

Currently, clicking občine logs to console; clicking individual hexes works only at zoom < 13 (pick-on-hover disabled at higher zoom). The full scorecard UI is tracked as **TASKS §C2**.

## Routes (planned)

- `/` — Mode A · Doma (citizen view, default)
- `/investitor` — Mode B · Investor inverted-heatmap view
- `/obcina` — Mode C · Občina planner view

See `../docs/TASKS.md` §E for status.

## File map

```
frontend/
├── app/
│   ├── layout.tsx       # root HTML shell
│   ├── page.tsx         # `/` route — renders <Map /> + legend
│   └── globals.css      # bare layout + legend styles
├── components/
│   └── Map.tsx          # MapLibre + deck.gl, all the demo logic
├── public/
│   └── data/
│       └── obcine.geojson   # 212 SI municipalities, copied from data/15min-slo/
├── package.json
├── tsconfig.json
├── next.config.mjs
└── .env.local           # not committed — see CHECKLIST §5.3
```
