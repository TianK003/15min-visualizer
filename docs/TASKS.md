# TASKS — Roadmap to completion

> The canonical roadmap from where we are now to a shippable, polished product. Read **§1 (current state)** to orient, then **§3 (task list)** to plan work. Long-form context: `PLAN.md`, `ARCHITECTURE.md`, `DATA_SOURCES.md`.

This document tracks **open work only**. Completed tasks have been pruned — for the historical record, consult `git log docs/TASKS.md`. Tasks are grouped by phase and priority. Each task has an **owner placeholder**, **acceptance criteria**, and **dependencies** so any contributor can pick one up and finish it without re-deriving context.

## 0. Progress at a glance *(2026-05-16)*

Legend: 🟡 partial · ⏳ todo · DEC decision pending

| Phase | ID | Title | Status |
|---|---|---|---|
| A | A3 | Deploy Valhalla to Railway | 🟡 local only |
| A | A5 | Vercel deploy + CI | 🟡 CI done |
| B | B2 | Hand-pick amenity tags | ⏳ waits on user |
| B | B4 | Protected areas + unbuildable | 🟡 backend done |
| D | D3 | Mobile responsive | 🟡 panels OK |
| D | D4 | Accessibility | 🟡 ARIA wired |
| D | D5 | Empty/loading/error | 🟡 |
| D | D7 | Custom basemap | 🟡 positron + runtime POI/parking filter |
| F | F1 | Partial-load tiles | 🟡 ETL done |
| F | F2 | Web Worker | ⏳ |
| F | F3 | Binary attrs | ⏳ |
| F | F4 | Speed up first-time view switch | ⏳ **NEW** |
| G | G1 | Heatmap vs hexes | DEC |
| G | G2 | Ghosts overlay | ⏳ |

---

## 1. Current state snapshot

The end-to-end pipeline runs. The map renders all of Slovenia, with občina polygons coloured by population-weighted mean score at country zoom and an aggregating H3 hex layer at street zoom. Investor view, scorecard, address search, Valhalla isochrones + routes, LLM chat, dark/light theme, OpenAPI documentation are all live. Local Supabase + Valhalla containers run via `supabase start` and `docker start valhalla-slo`.

### Data on disk
- OSM Slovenia extract (308 MB), GURS občine (212 polygons), ARSO Zavarovana območja (531 polygons), ARSO Natura 2000 (355 polygons), Kontur Population SI (22,034 res-8 cells). All sources documented in `data/DATA_SOURCES.md`.

### ETL outputs
- 37,622 amenities classified into 8 categories
- 112,866 pedestrian + bicycle isochrones (5/10/15 min contours)
- 1,079,666 H3 res-10 cells scored (walk + bike); 212 občine aggregated
- 344,678 cells flagged `unbuildable=true` inside protected areas

### Open backend deploys
- Cloud Supabase via `supabase db push` — not yet
- Railway hosting the Valhalla container — not yet
- Vercel project link for the frontend — not yet

### Score distribution (res-10)
```
🟢 Green 6–8:    ~44 k cells  (4 %)
🟡 Yellow 4–5:   ~45 k cells  (4 %)
🟠 Orange 2–3:  ~105 k cells  (10 %)
🔴 Red 0–1:     ~886 k cells  (82 %)
```

---

## 2. How to bring everything back up (cold start)

```bash
# 1. Docker socket may need re-permissioning if the daemon restarted
sudo chmod 666 /var/run/docker.sock

# 2. Start Valhalla
docker start valhalla-slo
# Smoke test:
curl -X POST http://localhost:8002/isochrone -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":46.0512,"lon":14.5061}],"costing":"pedestrian","contours":[{"time":15}],"polygons":true}'

# 3. Local Supabase
cd /home/tiank/15minut/backend && supabase start

# 4. Frontend
cd /home/tiank/15minut/frontend && pnpm dev    # → http://localhost:3000
```

Re-bake scores (after data refresh or resolution change):
```bash
cd /home/tiank/15minut && source backend/.venv/bin/activate
python backend/etl/03_score_cells.py           # ~30 s at res-10
```

`02_isochrones.py` is resumable via the JSONL staging file. Only re-run `01` if OSM data changes; `02` if you change isochrone bake params; `03` if you change the scoring formula or H3 resolution.

---

## 3. Roadmap to completion

Tasks are tagged:
- **P0** — blocks shipping; must complete
- **P1** — required for a polished product
- **P2** — stretch / polish / nice-to-have
- **DEC** — open decision; not actionable until decided

---

### Phase A — Deploy the real backend  *(unblocks production)*

#### A3 · Deploy Valhalla to Railway · **P0** · 🟡 **PARTIAL — local only**
- **Why:** live "Show 15-min reach" isochrone overlay requires a public Valhalla URL.
- **Dependencies:** none.
- **Steps:** push `backend/valhalla/Dockerfile` to Railway, allocate ≥ 4 GB RAM, expose port 8002, copy URL into `VALHALLA_URL` (server-only env var, consumed by the `/api/valhalla/[endpoint]` proxy). Add `/health` endpoint check.
- **Status:** Valhalla running locally (`docker start valhalla-slo`, port 8002, 86 ms isochrone). `frontend/lib/valhalla.ts` + `frontend/app/api/valhalla/[endpoint]/route.ts` proxy in place (proxy is permanent — Valhalla returns 405 on CORS preflight regardless of host). Only Railway push + `VALHALLA_URL` env var remain.
- **AC:** isochrone POST against the Railway URL returns a valid polygon for Prešernov trg.

#### A5 · Vercel deploy + CI · **P1** · 🟡 **CI done, Vercel TODO**
- **Dependencies:** A3 (so VALHALLA_URL is real).
- **Steps:** link repo → Vercel project (root: `frontend/`), set env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `VALHALLA_URL`, `NEXT_PUBLIC_USE_REMOTE_DATA`). Add minimal GitHub Action: `pnpm install && pnpm typecheck`.
- **Status:** `.github/workflows/ci.yml` shipped — runs typecheck + build on PRs and pushes to `main` with placeholder env vars. Vercel project link still requires user action.
- **AC:** push to `main` triggers auto-deploy; preview URL works; CI green on PR.

---

### Phase B — Data quality & coverage

#### B2 · Hand-pick amenity tags · **P1** *(user's #5)* · ⏳ **TODO — waits on user**
- **Status:** Open per H7. User has not yet checked boxes in the candidate list below. No ETL re-run scheduled until the list is finalized.
- **Goal:** user-curated tag list per category for both the score AND the map pins. Currently several categories are overly broad (notably `delo` = any `office=*`), and several plausible tags are missing entirely (e.g. `dentist` in `zdravstvo`, `library` in `izobrazevanje`, `cafe` in `storitve`).
- **Process:** the user (you) provides the final pick from the candidate list. I do not edit `01_extract_amenities.py` until that pick is in. The candidate list per category is maintained as a checklist below; tick what to keep, strike what to drop, add anything missing.
- **After pick:** edit `CATEGORY_FILTERS` in `01_extract_amenities.py:38`, re-run `01` → `02` → `03`. Step 02 (~1–2 min) regenerates isochrones for the new amenity set. Step 03 (~30s) re-scores cells.
- **AC:** new amenity counts reviewed; new score distribution sanity-checked; visual map review by user passes.

##### Candidate tag list per category *(check the ones to keep)*

Format: `tag=value` — tags **bolded** are currently in `01_extract_amenities.py`.

**trgovina** — daily essentials and shops
- [x] **shop=supermarket** · **convenience** · **bakery** *(current)*
- [ ] shop=butcher · greengrocer · deli · dairy · cheese · seafood · beverages · wine · alcohol
- [ ] shop=chemist *(drogerija — cosmetics + everyday)*
- [ ] shop=general · kiosk · department_store · mall
- [ ] shop=clothes · shoes · jewelry · books · electronics *(probably skip — not "daily")*

**izobrazevanje** — education
- [x] **amenity=kindergarten** · **school** *(current)*
- [ ] amenity=college · university · music_school · language_school · driving_school
- [ ] amenity=library *(could go here or storitve)*

**zdravstvo** — health
- [x] **amenity=clinic** · **doctors** · **hospital** · **pharmacy** *(current)*
- [ ] amenity=dentist · veterinary
- [ ] healthcare=clinic · doctor · hospital · pharmacy · dentist *(newer OSM scheme; some POIs only use this)*

**park** — green space
- [x] **leisure=park** *(current)*
- [ ] leisure=garden · nature_reserve · common · dog_park
- [ ] landuse=recreation_ground · village_green
- [ ] *(skip natural=wood — too broad, captures whole forests)*

**promet** — public transport stops
- [x] **public_transport=stop_position** · **station** · **platform** *(current)*
- [ ] amenity=bus_station · ferry_terminal · taxi
- [ ] railway=station · halt · stop · tram_stop
- [ ] highway=bus_stop *(legacy tag — many SI bus stops are tagged ONLY this way; high signal, worth adding)*
- [ ] ❌ amenity=parking · parking_space *(explicit DROP — currently NOT in filter)*

**sport** — recreation
- [x] **leisure=sports_centre** · **playground** · **pitch** *(current)*
- [ ] leisure=stadium · swimming_pool · ice_rink · fitness_centre · fitness_station · sports_hall · golf_course
- [ ] *(skip `sport=*` — too broad, includes every individual sport tag on existing features)*

**storitve** — services
- [x] **amenity=post_office** · **bank** · **hairdresser** · **restaurant** *(current)*
- [ ] amenity=cafe · pub · bar · fast_food
- [ ] amenity=beauty_salon · dry_cleaning · laundry
- [ ] amenity=fuel · car_repair
- [ ] amenity=theatre · cinema · arts_centre · community_centre *(cultural — fold here per B3 decision)*
- [ ] ❌ amenity=atm · vending_machine · waste_basket · bench *(explicit DROP — micro-amenities, noise)*

**delo** — work
- [x] **office=*** *(current — VERY broad: lawyer, accountant, consulting, government, ngo, association, financial, insurance, telecommunication, advertising_agency, engineer, architect, employment_agency, …)*
- [ ] Tighter alternative: office=company · government · coworking · it · research
- [ ] Optional: landuse=commercial *(area-based, not point — needs different handling)*
- [ ] Optional: building=office *(building-typed only, much sparser but more reliable)*

**(user)** add anything you want that isn't above ⇩

#### B4 · Render protected areas + remove unbuildable terrain from possibility · **P1** · 🟡 **PARTIAL**
- **Status:** Backend done — `cell_scores.unbuildable` column added via migration `20260515090120_add_unbuildable.sql`; `08_flag_unbuildable.py` flags 344,678 cells (31.9%) whose centroid falls inside a protected area. Frontend hatched overlay rendering and the DEM-based mountain mask still TODO.
- **Goal:** protected areas (Natura 2000, Zavarovana območja) and mountain terrain should be visually distinct AND excluded from "the score is bad here, build something" suggestions in investor mode.
- **Steps:**
  1. Add diagonal-hatch overlay layer in `Map.tsx` — `SolidPolygonLayer` rendering `protected_areas.geojson` (or PMTiles for production) with diagonal stroke pattern. Score remains visible underneath at 0.5 alpha. Toggleable.
  2. **Mountain exclusion** — add `MTN_MASK` derived from DEM / OSM `natural=cliff` + slope > 30° OR elevation > 1500m. Tag cells inside as `unbuildable=true` in `cell_scores` table.
  3. Investor mode skips `unbuildable=true` cells when ranking demand.
  4. **Visual:** unbuildable cells render with a striped "no-build zone" pattern instead of the score color.
- **AC:** Triglav National Park visibly hatched; investor mode suggests zero amenities inside it.

---

### Phase D — Visual & UX polish

#### D3 · Mobile responsive layout · **P1** *(user's #11)* · ⏳ **TODO**
- **Status:** Only the Izvor podatkov panel has a 800 px breakpoint. Scorecard, AddressSearch, zoom indicator all use desktop fixed widths.
- **Goal:** site works on iPhone-class viewport widths (375 px+) without sideways scroll. Scorecard becomes a bottom sheet, search bar becomes full-width, zoom controls thumb-reachable.
- **Steps:**
  1. Audit `Map.tsx`, `Scorecard.tsx`, `AddressSearch.tsx` at 375 / 768 / 1280 px breakpoints.
  2. `Sheet` from shadcn auto-switches to bottom on mobile (verify).
  3. Replace any hardcoded `px` widths with `clamp()` or Tailwind responsive classes.
  4. Test touch panning + pinch zoom + tap-to-select hex on a real device (deck.gl supports it but the picking threshold needs tuning).
- **AC:** Lighthouse mobile score ≥ 90; manual test on iOS Safari + Android Chrome passes.

#### D4 · Accessibility pass · **P2** · ⏳ **TODO**
- **Status:** Basic ARIA labels on Scorecard, AddressSearch, view-switch buttons. Color contrast, full keyboard nav, axe-core sweep all pending.
- Color contrast (the orange hex on white obstacle: contrast 2.4:1 fails WCAG AA — solved by 0.5 alpha + dark basemap, but verify); keyboard nav on search + scorecard; ARIA labels on map controls; reduced-motion respects.
- **AC:** axe-core run on production build returns zero serious violations.

#### D5 · Empty / loading / error states · **P1** · 🟡 **PARTIAL**
- **Status:** "Nalagam podatke …" pill renders during the score-cells fetch and the investor first-load compute; dummy-data fallback banner if the Storage fetch 404s; Scorecard has loading + error variants; AddressSearch surfaces Photon errors. Comprehensive sweep over every async path not yet done.
- Loading skeleton for first paint; error banner when `cell_scores_lite.json` 404s; "Photon offline" banner with manual lat/lng input fallback (already in fallback in `Map.tsx`, extend to UI).
- **AC:** every async op has a defined loading + error state, no naked `null` returns.

#### D7 · Programmable / custom basemap style · **P2** · 🟡 **PARTIAL — runtime patch in place**
- **Status:** Light theme uses hosted Positron + a runtime `harmonizeBasemap()` hook in `Map.tsx` that runs on every `styledata` event and (a) removes any `fill-extrusion` layer (kills 3D buildings — there are none in Positron but defensive against future style swaps) and (b) appends a `class != parking` filter to every `poi_r*` symbol layer (kills the "P" parking icons). MapLibre's default attribution chip is disabled via `attributionControl: false`. A full fork-and-edit of the style JSON is still open if we want to push minzoom thresholds on street labels.
- **Why:** OpenFreeMap's hosted styles (`positron`, `liberty`, `bright`) are good defaults, but the basemap is currently fighting the heatmap and score palettes for visual attention. A bespoke style — muted background, reduced label density, no 3D extrusions, no POI icons — would let the deck.gl overlays read cleanly *and* drop a few ms per frame on weaker hardware.
- **Dependencies:** D1 (palette locked) so we know which neutrals harmonize with the chosen accent colors.
- **Approach (recommended: fork-and-edit):**
  1. Fetch the source positron style JSON once (`curl https://tiles.openfreemap.org/styles/positron > frontend/public/styles/custom.json`) and commit it.
  2. Point `BASEMAP_STYLE` in `Map.tsx` at `/styles/custom.json`.
  3. Edit `custom.json` to taste — recolor land/water fills, drop POI symbol layers, raise `minzoom` on street-name labels, remove any `fill-extrusion` layer.
  4. Optional runtime patches in `Map.tsx` for tweaks that depend on the active view.
- **Performance levers to bake in:**
  - No `fill-extrusion` layers (no 3D buildings).
  - No POI symbol layers (cafés, shops, etc.).
  - Street labels gated behind `minzoom: 14`.
  - Single-color land fill (no land-cover gradients).
  - Drop hillshade / contour layers if present.
- **AC:**
  - Custom style file checked into `frontend/public/styles/`.
  - At 1080p over the Slovenia bbox, frame time on the population heatmap drops measurably vs. stock positron (use the deck.gl `_animate` profiler; aim for ≤8 ms basemap draw).
  - Visual hierarchy holds: deck.gl overlays clearly readable over the basemap at every zoom from 7 → 16.

---

### Phase F — Performance & scale

#### F1 · Smooth interaction at close zoom (partial loading) · **P1** *(user's #13)* · 🟡 **PARTIAL**
- **Status:** ETL side done — `backend/etl/07_bin_cells_to_tiles.py` produced 4,051 res-7 shards in `data/15min-slo/tiles/` (median 10 KB, ≤12 KB max) plus `index.json` manifest. Frontend lazy-fetch logic + Storage upload of the shards not yet wired.
- **Goal:** at res-10 raw mode (zoom ≥ 15), only fetch + render cells in the current viewport bbox rather than holding all 1.08M in memory.
- **Approach:**
  1. Pre-bin cells by their res-7 parent during ETL → write one JSON per res-7 cell (~1000 tiles, each ≤200 KB). Filename = parent h3. ✅ done.
  2. Frontend: on zoom ≥ 13, compute viewport-visible res-7 parents → fetch their tiles lazily, cache in `Map<h3, ScoreCell[]>`.
  3. Aggregate function unions the loaded tiles.
- **Result:** initial page load drops from 3 MB → ~50 KB; close zoom adds ~10 tiles per pan.
- **AC:** Network panel on cold load < 100 KB before user pans; zoom to 16 + pan around Ljubljana fetches < 20 tiles total.

#### F2 · Web Worker for `aggregate()` · **P2** · ⏳ **TODO**
- Move `h3.cellToParent` aggregation off the main thread. Removes the ~70 ms freeze at low zoom on slower machines.
- **AC:** Performance profile shows zero main-thread blocks > 16 ms on zoom transition.

#### F3 · Binary attributes for deck.gl · **P2** · ⏳ **TODO**
- Replace `getFillColor: (d) => colorForScore(d.score)` with a pre-computed `Uint8Array` passed as `data.attributes.getFillColor`. Eliminates per-cell JS accessor calls.
- **AC:** Chrome devtools shows 1 ms attribute upload instead of 80 ms accessor sweep on data change.

#### F4 · Speed up first-time switch from Potrošnik → Investitor · **P1** · ⏳ **TODO**  *(NEW)*
- **Why:** the first click of the **Investitor** pill triggers a full chain of expensive work that the user pays for synchronously the first time around: fetch `cell_population_lite.json` (~MB-scale download) → compute `unpopCells` (212 občina polygons × `h3.polygonToCells` at res 9 + `cellToChildren`) → compute `investorCells` (1 M cells × `h3.cellToParent`) → compute `aggregatedInvestorCells` + `demandThresholds`. End-to-end this takes 5–10 s on a warm laptop. The `"Nalagam podatke …"` banner now correctly covers the freeze (see D5), but it's still a freeze — the user wants the switch to feel **instant** (<1 s perceived).
- **Goal:** clicking Investitor for the first time renders the demand layer within ~1 s of click. No banner. No freeze.
- **Approach options** (pick one or combine):
  1. **Pre-fetch + pre-compute on initial page load.** While the user is still in Potrošnik view, kick off the `pops` fetch and the `unpopCells` / `investorCells` builds in the background. By the time they click Investitor, results are already cached in state. Tradeoff: extra ~1 MB of bandwidth on first paint for users who never visit Investitor view.
  2. **Web Worker for the compute.** Offload the `h3.cellToParent`/`polygonToCells` work to a `worker.ts`. Main thread stays responsive — user can keep panning the map while the compute runs. Combines well with #1: pre-fetch on initial load, compute in worker as soon as data lands.
  3. **Pre-bake at ETL time.** Add a `backend/etl/09_export_investor.py` that pre-computes `investor_cells.json` (per-cell demand for each of the 8 categories) directly from `cell_scores.json` + `cell_population_lite.json`. Frontend just loads + paints — no runtime compute at all. Most invasive but the cleanest. Doubles as the foundation for B4 unbuildable filtering downstream.
- **Recommended:** start with #1 (cheap to ship, covers the warm-cache case) + #2 if the compute itself remains noticeable. Save #3 for SLO4D polish if the first two aren't enough.
- **AC:** stopwatch-test on a cold load — click Potrošnik then immediately click Investitor — the demand heatmap is fully painted within 1 s, with the main thread responsive (panning works) throughout the transition.

---

### Phase G — Stretch / differentiators

#### G1 · Heatmap vs hexagons decision · **DEC** *(user's #8)* · ⏳ **DECISION PENDING**
- **Question:** does a diffused heatmap (deck.gl `HeatmapLayer` over cell centroids) read better at low zoom than the hex polygons we have today?
- **Proposed test:**
  - Build a branch with `HeatmapLayer` at zoom < 12 and `H3HexagonLayer` at zoom ≥ 12 (auto-switch).
  - Side-by-side visual comparison with current hex-only aggregation.
- **Outcome:** ship the winner. Current intuition: heatmap reads better for country/region zoom (no discrete-cell artifacts), hexes win once you're "in" a city. The auto-switch is the right design.
- **AC:** user picks visual; chosen approach goes into main.

#### G2 · Municipality "ghosts" / planned developments · **P1** *(user's #10)* · ⏳ **TODO**
- **Goal:** show planned residential/commercial buildings as semi-transparent extruded polygons on the map. Click → estimated effect on local scores once built.
- **Steps:**
  1. Source: Ljubljana OPN data from PIS (Prostorski informacijski sistem) — manual download is fine for MVP. **Mock data acceptable** if PIS scraping is painful: hand-author 10–20 polygons for Ljubljana + Maribor.
  2. Render with deck.gl `PolygonLayer` + `extruded: true`, height proportional to planned floors.
  3. Click handler: estimated effect — pull amenity type from polygon metadata, recompute score for cells within 15-min walk if this amenity existed. Display delta in a card: "+0.3 average score for 1,400 residents."
  4. Time slider: "Today / 2030+" toggle that fades the ghost layer in/out.
- **Dependencies:** client-side effect-recompute helper.
- **AC:** Ljubljana ghosts visibly extruded at street zoom; clicking one shows realistic delta.

---

### Phase I — Open decisions (need user input)

| ID | Decision | Status |
|---|---|---|
| H1 | Project name + brand (literal "15min Slovenija" vs emotional "Doma" vs scoring "ProstorScore") | deferred — decide later |
| H7 | B2 hand-pick amenity tags | open — user will check boxes in the candidate list inline above |

---

## 4. Resolved with the user (historical, kept for context)

1. **B3 — 9th category:** scrapped. Score stays 0–8.
2. **G3 — LLM use cases:** natural-language search + cell narrative. Investor recommendations out of MVP.
3. **F1 — partial loading priority:** in scope. Mobile smoothness is a P1 concern; F1 lands before E2 (občina view).
4. **B2 — amenity pruning:** user hand-picks from the candidate list inline in B2. No ETL re-run until the list is checked.
5. **G2 — ghosts:** mock data acceptable for V1.
6. **Language:** UI is Slovenian only. No English translation in scope.
7. **Brand name:** deferred — work continues under the working name "15min Slovenija".
8. **H3 — H3 resolution:** res-10 locked.
9. **H4 — basemap:** `positron` (light) / `dark-matter` (dark) with runtime parking-POI filter.
10. **H6 — English translation:** out of scope; UI Slovenian only.

---

## 5. File map (current)

```
/
├── README.md
├── frontend/                  # Next.js 14 + MapLibre + deck.gl
│   ├── app/                   # routes (currently just /; /api-docs, /openapi.json)
│   ├── components/Map.tsx     # the entire map UI
│   ├── lib/                   # supabase.ts, valhalla.ts, photon.ts wrappers
│   ├── public/data/           # dev fallback; production reads from Supabase Storage
│   └── package.json
├── backend/
│   ├── etl/                   # 01–08 pipeline scripts (res-10)
│   ├── valhalla/              # Dockerfile + custom_files (gitignored)
│   ├── supabase/migrations/   # 0001_init + RPCs + RLS + unbuildable + bike + per-mode amenities
│   ├── requirements.txt
│   └── .venv/                 # gitignored
├── data/
│   ├── 15min-slo/             # raw downloads + intermediate ETL outputs
│   └── DATA_SOURCES.md
└── docs/
    ├── PLAN.md
    ├── ARCHITECTURE.md
    ├── ARCHITECTURE.svg
    ├── CHECKLIST.md
    └── TASKS.md               # this file
```

---

## 6. Troubleshooting

| Symptom | First thing to try |
|---|---|
| `docker: command not found` after restart | `sudo chmod 666 /var/run/docker.sock` |
| Valhalla container won't start | `docker logs valhalla-slo`; if graph corrupted, delete `backend/valhalla/custom_files/valhalla_tiles/` and restart |
| Frontend shows dummy Ljubljana hexes | `cell_scores_lite.json` missing from `frontend/public/data/`. Re-run `python backend/etl/03_score_cells.py` |
| Občine show no fill | `obcine_scored.geojson` missing. Same fix as above |
| Lag during pan at res-10 | check that `pickable: false` + `stroked: false` are active for `currentRes ≥ 9` (Map.tsx) |
| First click of Investitor freezes for ~5–10 s | known — tracked in F4. The banner shows during the freeze; underlying fix pending |
| ARSO WFS returns `<ows:Exception>` | Single-quote the URL, one line. See `DATA_SOURCES.md` |
| Photon mangles SI addresses | Fall back to Nominatim (already wired) or paste raw lat/lng |

---

## 7. One reminder

Mode A polish (Phase C, D) is worth more than any new mode. A single emotional flow — "type your address → see your score → see the 15-min walking polygon" — is the demo moment. Everything in Phase E, G is supporting cast. If forced to cut, kill stretch items, not Phase C polish.
