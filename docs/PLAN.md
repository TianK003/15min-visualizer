# 15-Minute Slovenia — Hackathon Plan

**Hackathon:** GEO Slovenija, 15.–16. maj 2026 (M Hotel, Ljubljana)
**Final demo:** Konferenca SLO4D, 9. junij 2026
**Prize pool:** 5.000 € + 3.000 € + 2.000 €
**Tech lead:** Tian Kljucanin

> **Status:** All 16 tech-lead decisions locked. This plan is the team source of truth.
>
> **Conformance & winning playbook:** `GEO-SLOVENIJA-CONFORM.md` (this directory) scores the project against the hackathon brief, lays out 15 tactical moves to win, and profiles every mentor + jury member. Read it before the build window — the top-3 do-firsts and the jury-lead profile in particular.

---

## 0. Scope reality check (read first)

You picked the most ambitious answers throughout, including two stretch features (Ljubljana "ghosts" overlay + fully responsive design) that together eat ~6 hours of the build window. Honest read:

- **Day 2 is tight.** Mode C (Občina/planner choropleth) is on the chopping block first if anything slips. Mode A (citizen) and Mode B (investor) are non-negotiable.
- **Live Valhalla on click** is the wow factor. It is also a single point of failure on demo day. Test it cold before submission. Have a "skip live, use precomputed" fallback ready behind a feature flag.
- **All of Slovenia + 8 categories + 3 modes + ghosts overlay + fully responsive in two build days.** This is doable only because of the precompute trick (§3) and because both halves of the team start in parallel from hour one.

The two things that make this win or lose: (1) the precompute pipeline running cleanly during the build window, (2) one polished demo flow ("type your address → see your livability score") that the jury can feel emotionally.

---

## 1. Grid: H3 hexagons at resolution 10

Use H3, not square grid. Hexagons have uniform neighbor distances (squares have a 4-vs-8 ambiguity that breaks accessibility math), and the H3 library is mature in Python (`h3`) and JS (`h3-js`), with native deck.gl support (`H3HexagonLayer`).

H3 resolution choice for Slovenia (20,273 km²):

| Res | Edge length | Hex area | Cells (full SI) | Cells (populated only) |
|-----|-------------|----------|-----------------|------------------------|
| 8   | ~461 m      | 0.74 km² | ~27,400         | ~3,000                 |
| 9   | ~174 m      | 0.105 km² | ~193,000       | ~154k                  |
| **10** | **~66 m** | **0.015 km²** | **~1.35M**   | **~1.08M (actual)**    |

**Locked: H3 res 10 (~66 m edge, ~130 m hex diameter).** Initially baked at res-9 (~170 m); upgraded to res-10 on 2026-05-13 for "house-block" granularity (~2–5 houses per cell in urban areas). The 7× cell count is absorbed by client-side aggregation: low zooms still render <500 hexes via `cellToParent`. Going finer (res-11) would break the "single JSON" architecture — TASKS §F1 lays out the partial-loading path if needed.

**Population source:** Kontur res-8 populated cells expanded to their 49 res-10 children. No building-footprint filter — uninhabited terrain is simply absent from Kontur and therefore absent from the score layer (no false-positive scoring inside Triglav National Park, etc.).

---

## 2. Locked tech stack

### Frontend (Vercel)
- **Next.js 14 App Router** on Vercel free tier
- **MapLibre GL JS** + **OpenFreeMap `positron` style** for the basemap (free, no API key, no registration)
- **deck.gl** with `H3HexagonLayer` for the heatmap overlay
- **shadcn/ui + Tailwind** for the side panel, tabs, scorecard
- **Zustand** for client state
- **Photon (Komoot public endpoint)** for address autocomplete — free, no key, decent SI coverage
- **Slovenian-only UI.** No `next-intl` switching layer; copy is hand-written in SL. English translation is **out of scope** (decision 2026-05-13).

### Backend (Supabase + Railway)
- **Supabase** = Postgres 16 + PostGIS 3.4 + auto-generated REST + Auth + Storage. Install `h3-pg` extension early.
- **Railway** = a single Docker container running **Valhalla** with Slovenia OSM baked in. Live isochrone API for click-on-cell wow factor (walking + biking only — no public transport routing).
- **Cloudflare R2 or Supabase Storage** for static artifacts (PMTiles overlays + the cell-scores JSON).
- ❌ **No FastAPI.** Supabase REST + RPC handles all reads. Saves a whole service.
- ❌ **No Firebase.** Wrong fit — Firestore can't do PostGIS spatial joins or H3 indexing.

### Routing engines (precompute layer)
- **OSRM** (Docker) for the bulk walking-distance matrix during the precompute phase — millisecond response, can run millions of pairs in minutes.
- **Valhalla** (Docker, persists into demo) for live walking/biking isochrones triggered on cell-click.

### Hex layer delivery — single-resolution JSON + client-side aggregation
- **Bake scores at H3 resolution 10 only** (~1.08M populated cells). Coarser zoom levels are aggregated **client-side** via `h3.cellToParent()` (see §3a). No multi-resolution tile pyramid needed at this data scale.
- Serve as **gzipped JSON** (~3 MB compressed, ~37 MB raw) from Supabase Storage or a Next.js static route. One file, no tile server, no PMTiles ceremony for the hex layer. (Partial-loading per res-7 parent tile planned to drop first-paint payload — see TASKS §F1.)
- **PMTiles is still used for non-aggregable layers**: Ljubljana ghosts overlay (planned-development polygons) and protected-area polygons (Natura 2000 + zavarovana območja). For those, `tippecanoe` makes sense.
- Frontend uses deck.gl `H3HexagonLayer` for the score layer (data array, GPU-instanced rendering) and MapLibre + `pmtiles` JS protocol for the polygon overlays.

### Repo
- **Simple split** — `frontend/` + `backend/` + `data/`. No monorepo, no workspaces, no Turborepo. Each subfolder is self-contained with its own `package.json` / `requirements.txt`.
- **Public from day 1**, Apache 2.0.

---

## 3. The "supply-side" precompute trick + biking

### Walking pipeline
Naive: 1M cells × 8 categories = 8M routing queries. Slow.

**Inverted approach (locked):**
1. For each amenity in Slovenia OSM (~37k total after extraction), generate one 15-minute walking isochrone polygon via Valhalla. We also bake 5- and 10-min contours in the same call for "nearest amenity" precision in the scorecard.
2. Spatial-join cell centroids against each category's union of isochrones, iterated widest → narrowest (15 → 10 → 5) so the smaller time wins.
3. **Score per cell = binary count, 0–8.** A category gets 1 point if at least one amenity falls within the 15-min walking polygon. (See §4 for the formula.)
4. Side-effect output: `cell_amenities (h3, amenity_id, category, walk_min)` join table for the click-to-show-pins feature.
5. Color buckets (locked, balanced narrative): green 6–8, yellow 4–5, orange 2–3, red 0–1.

Actual bake time observed: **02_isochrones.py ≈ 1.3 min** (464 req/s sustained against the local Valhalla container, 0 failures), **03_score_cells.py ≈ 30 s** at res-10. The "3–5 hours" estimate in earlier drafts assumed a hosted Valhalla and was off by two orders of magnitude. Output: `cell_scores` + `cell_amenities` tables in Postgres, exported as a single gzipped JSON.

**Only bake at H3 resolution 10.** Coarser zoom levels are aggregated client-side — see §3a.

### Biking (locked: speed multiplier)
- Store `walk_min` per cell-category pair. **Bike time = walk_min / 2.5.**
- Frontend toggle "Walk / Bike" rescales the threshold: 15 min walking ≡ 6 min biking, or equivalently a "15 min biking" view uses a 37.5-min walking threshold.
- Two precomputed columns is enough. No second Valhalla pass for the hackathon.
- Post-hackathon (before SLO4D): rerun bake with Valhalla `bicycle` profile for accuracy.

---

## 3a. Multi-scale rendering — client-side aggregation

**The score is computed once on the server at H3 res 10. The map renders any zoom level the user wants without a server roundtrip.**

This split mirrors the three operations on the map:

| Op | What | Where it runs | Why |
|---|---|---|---|
| Scoring | Run isochrones, classify amenities, compute 0–8 score | Server (precompute) | Needs Valhalla + OSM road graph; can't be done in browser |
| Aggregation | Roll res-10 cells up to coarser hexes for low-zoom view | Client (per render) | One-line `h3.cellToParent()` call, ~10 ms for 1.08M cells; web-worker move planned (TASKS §F2) |
| Rendering | Paint hexagons on the map | Client (GPU) | deck.gl `H3HexagonLayer` instanced WebGL — proven to ~1M items at 60 fps with strokes/picking disabled at high zoom |

### Implementation pattern

```ts
const aggregated = useMemo(() => {
  const targetRes = zoomToH3Res(viewState.zoom); // see table below
  if (targetRes >= H3_BASE_RES) return cells; // raw — H3_BASE_RES = 10

  const groups = new Map<string, { sum: number; count: number }>();
  for (const c of cells) {
    const parent = h3.cellToParent(c.h3, targetRes);
    const g = groups.get(parent);
    if (g) { g.sum += c.score; g.count += 1; }
    else groups.set(parent, { sum: c.score, count: 1 });
  }
  return Array.from(groups, ([h3, g]) => ({ h3, score: g.sum / g.count }));
}, [cells, viewState.zoom]);
```

### Zoom → resolution map (as implemented in `components/Map.tsx`)

| Zoom level | Rendered res | Visible cell count | Story |
|---|---|---|---|
| 5–9 (country) | 6 | ~450 chunky regional hexes | "Slovenia at a glance" |
| 10 (region) | 7 | ~3k mid hexes | "Where in this region" |
| 11–12 (city) | 8 | ~22k city hexes | "Which neighborhoods" |
| 13–14 (district) | 9 | ~154k district hexes | "Which side of the street" |
| 15+ (block) | 10 | ~1.08M raw cells (only viewport renders) | "Which house cluster" |

At zoom < 9, the občina polygon layer takes over from the hex layer — see `SHOW_OBCINE_FILL_BELOW` in `Map.tsx`.

### Aggregation function: locked = mean

Default: average child score. Intuitive ("this region averages 5.3/8"), smooth visuals during zoom.
Available toggles in Modes B and C (post-MVP): `min` (worst-of, planner story), `pct_ge_5` (share of livable cells).

### Payload size

Single gzipped JSON with all 1.08M res-10 cell scores: **~3 MB compressed** (~37 MB raw). Still smaller than baking a multi-resolution PMTiles pyramid; first paint loads everything, all zoom levels are free thereafter, no tile-server fetches mid-pan. For mobile-friendly first-paint we plan partial-loading per res-7 parent tile (TASKS §F1) — drops cold load to ~50 KB.

---

## 4. Locked: scoring formula + color narrative

### Formula
**Score = sum of binary indicators across 8 categories** (0–8 integer).

Each category contributes 1 if at least one matching amenity falls within the cell's 15-min walking isochrone, else 0.

```
score = Σ I(category_k_present), k = 1..8
```

Easy to bake, easy to explain, easy for the jury to grasp ("5 of 8 daily needs are reachable").

### The 8 categories (locked)
1. **Trgovina** — supermarket, convenience, bakery (`shop=supermarket|convenience|bakery`)
2. **Izobraževanje** — vrtec, šola (`amenity=kindergarten|school`)
3. **Zdravstvo** — zdravstveni dom, lekarna (`amenity=clinic|doctors|hospital|pharmacy`)
4. **Park / zelena površina** — park, urban forest (`leisure=park`, `landuse=forest` near settlements)
5. **Javni promet** — bus stop, train station as point amenities only (`public_transport=stop_position|station|platform`). Treated as a generic amenity within walking radius; no transit routing or schedule data.
6. **Šport / rekreacija** — stadium, sport hall, playground (`leisure=sports_centre|playground|pitch`)
7. **Storitve** — pošta, banka, frizer, restaurant (`amenity=post_office|bank|hairdresser|restaurant`)
8. **Delo** — coworking, office cluster (`office=*` density, OR populated-area baseline)

### Color thresholds (locked: balanced narrative)
- 🟢 **Green** — 6–8 / 8 (Ljubljana center, dense suburbs)
- 🟡 **Yellow** — 4–5 / 8 (most suburbs, smaller cities)
- 🟠 **Orange** — 2–3 / 8 (villages with one shop and a school)
- 🔴 **Red** — 0–1 / 8 (remote settlements)

This produces a map that looks like Slovenia actually is — Ljubljana center mostly green, Bohinj village orange/red, suburbs yellow. Best for jury credibility.

---

## 5. Data sources

All five layers are now downloaded and on disk. See `data/DATA_SOURCES.md` for source URLs, license, and the exact curl command per layer.

### Tier 1 — must-have (all CC / open)

| Source | What you get | Status |
|---|---|---|
| **OSM Slovenia extract** (Geofabrik) | Amenities, buildings, roads, landuse | ✓ on disk |
| **GURS občine** (stefanb mirror) | 212 municipality polygons | ✓ on disk |
| **ARSO zavarovana območja** (production WFS) | 531 protected-area polygons (parks, monuments, reserves) | ✓ on disk |
| **ARSO Natura 2000** (production WFS) | 355 ecological-network polygons | ✓ on disk |
| **Kontur Population SI** (HDX) | H3-native population layer | ✓ on disk |
| **Basemap** (OpenFreeMap positron) | Hosted vector tiles | hosted (no download) |

### Tier 2 — for differentiation
- **Atlas okolja** — poplavne karte for risk overlay (stretch).
- **Prostorski informacijski sistem (PIS)** — OPN-ji (planned developments) for the ghosts MVP.
- **OPSI (podatki.gov.si)** — open data portal for občinski datasets.
- **AJPES** — business registry for finer commercial categorization (post-hackathon).

### Transparency is a first-class deliverable (locked 2026-05-13)

We do not ship a black-box map. **Every dataset on the screen must be explainable to a non-technical user in one Slovenian sentence**, and to a judge in one bibliographic citation. This is implemented as the **"Izvor podatkov" provenance panel** — see `TASKS.md §D6` (priority P0).

Why this matters per the hackathon brief: the *izhodišča* explicitly call for **interoperability (#3 INSPIRE/ISO), transparency (#4), and reproducibility (#5)** — three criteria one well-built panel covers. Most teams will skip this and pay for it in scoring. We won't.

**Free bonus from Supabase: a live, schema-aware REST API + OpenAPI/Swagger spec.** PostgREST (Supabase's REST layer) auto-generates an OpenAPI 2.0 document from `0001_init.sql`, refreshed on every migration. We surface this two ways from the provenance panel: a raw OpenAPI JSON link (`<supabase>/rest/v1/`) and an embedded Swagger UI at `/api-docs` where any visitor can run live queries against the public dataset with the anon key. Zero API code to write for the standard CRUD surface; we only hand-write OpenAPI/Zod schemas for the Next.js LLM route (`§G3` in TASKS). Implementation details in `TASKS.md §D6` content sections 7 and implementation steps 6–8.

Operational rule: when a new layer is added to the pipeline, the corresponding card in the provenance panel ships in the same PR. Data without a public rationale doesn't ship.

---

## 6. Three-mode UX (one map, three lenses)

Shared state across modes: H3 cell layer, basemap, hatched protected-areas overlay, address geocoder, walk/bike toggle.

### Mode A — "Doma" (Citizen) — hero demo
Landing screen has a large address bar at top: "Vpišite svoj naslov."
On submit:
1. Map flies to address.
2. Side panel slides in showing **scorecard**: large score (e.g. "6/8"), 8 category icons (✓ or ✗), nearest amenity per category with travel time.
3. **Map auto-paints amenity pins for the clicked/searched cell** — every amenity within 15 min walk gets a category-colored pin with its walking time on a badge. Pulled from `cell_amenities` table (~10–50 pins per cell, single Supabase query). Hovering a pin highlights the matching scorecard row and vice-versa; category filter chips fade pins in/out.
4. **"Show 15-min reach" button** → live Valhalla call returns the real walking isochrone polygon, drawn as a soft cyan overlay.
5. Walk/Bike toggle rescales the polygon, the pin filter (walk_min ≤ 37.5), and the heatmap.

This is the screen the jury will touch. Ljubljana center scores 8/8, a remote alpine village scores 1/8 — the contrast tells the story before you say a word.

### Mode B — "Investitor / Razvijalec"
- Dropdown: "Kje odpreti [lekarno / vrtec / trgovino]?"
- Inverted heatmap (locked formula): **demand = (population in cell) × (1 − category_satisfied)**
- Click a hot cell → projection card: "Build here → ~3,400 residents gain access. Catchment radius: 850 m."
- Filter by občina.

### Mode C — "Občina" (Planner) — first to cut if Day 2 slips
- Choropleth by občina: average score, % cells underserved.
- Sortable ranking: top 5 / bottom 5 občine.
- Time slider stretch: "Today vs after planned OPN" using Ljubljana ghosts data.

### Cross-cutting overlays
- **Protected areas + unbuildable terrain** (TASKS §B4). Diagonal-hatch pattern over Natura 2000, zavarovana območja, and high-slope mountain terrain (DEM-derived). Score remains visible underneath at 0.5 alpha; investor mode skips these cells when ranking demand. Toggleable.
- **Ghosts of planned developments** — semi-transparent extruded polygons via deck.gl `PolygonLayer`. **Mock data acceptable for V1** (decision 2026-05-13); 10–20 hand-authored polygons for Ljubljana + Maribor. PIS scraping for real OPN data is a post-MVP polish item.
- **Walk / Bike toggle** — rescales the heatmap.

---

## 7. Two-day build plan

The hackathon is two consecutive build days. Below is the recommended order — adapt to who's online when and what's blocking.

### Day 1 (recommended: hackathon kickoff day)

| Block | JS team | Python/GIS team |
|------|---------|----------------|
| Morning kickoff | Repo bootstrap, Vercel + Supabase wired | Docker compose for Valhalla + OSRM, install h3-pg in Supabase |
| Morning build | Next.js scaffold confirmed running, MapLibre + OpenFreeMap rendering, mock H3 layer with random colors | Slovenia OSM extract → Postgres, amenity classification SQL, kick off Valhalla **graph build (background, ~1h)** |
| Lunch + early afternoon | Photon address autocomplete + scorecard component | Valhalla bake script: 37,622 amenities × 3 contour times each. Observed runtime ~1.3 min. |
| Afternoon | Side panel UI, mode tabs, walk/bike toggle, basemap styling | While Valhalla bakes: Naravovarstveni atlas / Zavarovana območja ingest, občina boundaries (GURS RPE), population grid (Kontur) |
| Evening | Connect to mock API, deploy preview to Vercel, wire deck.gl `H3HexagonLayer` + zoom→res aggregation hook | Bake completes → spatial join → write `cell_scores` + `cell_amenities` → export gzipped JSON → upload to Supabase Storage. `tippecanoe` only for ghosts/protected polygons. |
| End of day | Joint: drop real JSON into the map, watch the country color in. Verify aggregation looks right at country/region/city zooms. Wire Valhalla live API. Celebrate. |

### Day 2 (recommended: hackathon submission day)

| Block | Joint focus |
|------|-------------|
| Morning | Mode A polish: address search → scorecard → amenity pins with walk times → live Valhalla isochrone overlay |
| Late morning | Mode B: investor inverted heatmap + click-to-project |
| Early afternoon | Ljubljana "ghosts" MVP overlay (extruded planned residential) **+** mobile responsive pass |
| Mid afternoon | Mode C if alive; otherwise polish, copy, edge cases |
| Late afternoon | Demo script, slides, narrative, deploy final build |
| Submission | Final upload + presentation |

### Cut-list priority (if behind)
1. First cut: Mode C (Občina choropleth)
2. Second cut: Ghosts overlay (move to SLO4D polish)
3. Never cut: Mode A scorecard, address search, base hex layer

### Post-hackathon (~3.5 weeks before SLO4D on June 9)
Add: real bike costing (Valhalla `bicycle` profile), more občine for ghosts overlay, planner mode, performance tune, public landing page with marketing copy, real PIS scraping for ghosts. **No EN translation — UI is Slovenian only.**

---

## 8. What will go wrong (and how to dodge it)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Valhalla bake takes 12 h, not 5 h | Medium | Start the bake early in Day 1 afternoon. Have a precomputed walking-only fallback path through OSRM ready. |
| Valhalla container OOM on Railway | Medium | Test the SI-only OSM extract locally first. Provision Railway 4GB+ plan ahead of time. |
| Live Valhalla flaky during demo | Low–Medium | Feature flag for "skip live isochrone." Pre-render a few showcase cells' polygons as backup. |
| OSM amenity data sparse in rural SI | High | Embrace it. The story becomes "rural Slovenia is a 15-min city desert, here's the proof." |
| 1.08M hexes lag on mobile | Medium | Client-side aggregation (§3a) means low zoom renders ~450 hexes, not 1.08M. Strokes + picking disabled at high zoom (TASKS §F-current). Partial-loading per tile (TASKS §F1) is the next step if mobile real-device testing shows lag. |
| Photon mangles Slovenian addresses | Medium | Test 20 real SI addresses ahead of time. If broken, swap to Mapbox geocoder (signup, free tier). |
| Day 2 stretch features bury polish | High | Cut-list (§7) is law. Mode A polish > everything else. |
| Demo machine has no internet | Always | Pre-bake everything. PMTiles + offline Valhalla container if possible. Test in airplane mode the night before. |

---

## 9. Why this wins (jury angle)

The brief asks for solutions at the intersection of technical + social science, hitting at least one of four sklopi. This project hits all four:

1. ✅ *Pametno upravljanje prostora* — Mode B + C are exactly this.
2. ✅ *Vizualizacija, dostopnost in kakovost prostorskih podatkov* — the whole UX premise.
3. ✅ *Okolje in trajnostni razvoj* — 15-min cities reduce transport CO₂ ([IPCC: transport ≈ 20% of global CO₂](https://www.ipcc.ch/working-group/wg3/)).
4. ✅ *Pametna mobilnost in infrastruktura* — walking + biking isochrones, proximity to transit stops as a category.

Plus team mix — geodesy + data + UX + social science — directly satisfies kriterij K1 (vključenost tehničnega in družboslovnega kadra).

Closing slide writes itself: *"Today, only ~12% of Slovenians live in a true 15-minute neighborhood. Here's the map. Here's where to invest. Here's the policy gap."* — pair with the SL closing line *"Hackathon je prototip. SLO4D je launch."* (see `GEO-SLOVENIJA-CONFORM.md` §3.1 Tactical Move #15).

**Jury-angle critique:** the conformance analysis in `GEO-SLOVENIJA-CONFORM.md` rates this project as a **top-3 contender, not the favorite as of today**. Three gaps need closing: (1) Phase C / Mode A must ship before demo time, (2) Pillar 3 (environment) needs at least one feature beyond the CO₂ slide, (3) INSPIRE/ISO/transparency posture needs a `Izvor podatkov` provenance panel. Per-mentor "how to impress" tactics live in §4 of that file.

---

## 10. Open team-level decisions (not tech lead alone)

- **Project name + brand.** Deferred (decision 2026-05-13). Working name "15min Slovenija" continues to be used. Pick a final name before public launch / SLO4D submission.
- **Demo narrative lead** — who tells the story at submission time.
- **Visual / brand sketcher** — logo + favicon, low investment, high jury polish.
- **Submission deliverable owner** — README + architecture diagram + 1-page summary.

Resolved decisions (2026-05-13): see `TASKS.md §H` for the table — language (SL only), category count (8), hex resolution (10), LLM use cases (search + narrative), ghosts data (mock).

---

## Sources & references

- [GEO Slovenija hackathon](https://www.geo-slovenija.si)
- [eProstor — geodetic data](https://www.e-prostor.gov.si/en/access-to-geodetic-data/)
- [GURS OGC API Features](https://storitve-eprostor-test.gov.si/wfs-si-gurs-rpe/ogc/features/api)
- [Valhalla isochrone API](https://valhalla.github.io/valhalla/api/isochrone/api-reference/)
- [15min City Score Toolkit (Transform Transport)](https://transformtransport.org/research/urban-mobility-metrics/15min-city-score-toolkit-urban-walkability-analytics/)
- [Nature Cities 2024 — global 15-min city framework](https://www.nature.com/articles/s44284-024-00060-6)
- [H3 hexagon resolutions](https://h3geo.org/docs/core-library/restable/)
- [Geofabrik Slovenia OSM extract](https://download.geofabrik.de/europe/slovenia.html)
- [OSRM vs Valhalla comparison](https://github.com/gis-ops/tutorials/blob/master/general/foss_routing_engines_overview.md)
- [Supabase PostGIS docs](https://supabase.com/docs/guides/database/extensions/postgis)
- [PMTiles — Protomaps](https://protomaps.com/docs/pmtiles)
- [OpenFreeMap](https://openfreemap.org/)
