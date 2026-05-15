# TASKS — Roadmap to completion

> The canonical roadmap from where we are now to a shippable, polished product. Read **§1 (current state)** to orient, then **§3 (task list)** to plan work. Long-form context: `PLAN.md`, `ARCHITECTURE.md`, `DATA_SOURCES.md`.

This document supersedes `HANDOFF.md`. Tasks are grouped by phase and priority. Each task has an **owner placeholder**, **acceptance criteria**, and **dependencies** so any contributor can pick one up and finish it without re-deriving context.

## 0. Progress at a glance *(2026-05-15)*

Legend: ✅ done · 🟡 partial · ⏳ todo · DEC decision pending

| Phase | ID | Title | Status |
|---|---|---|---|
| A | A1 | Provision Supabase + apply schema | ✅ local |
| A | A2 | Load ETL into Supabase | ✅ local |
| A | A3 | Deploy Valhalla to Railway | 🟡 local only |
| A | A4 | Wire frontend to live data | ✅ |
| A | A5 | Vercel deploy + CI | 🟡 CI done |
| B | B1 | Coverage diagnostic | ✅ 0/212 missing |
| B | B2 | Hand-pick amenity tags | ⏳ waits on user |
| B | B3 | 9th category | scrapped |
| B | B4 | Protected areas + unbuildable | 🟡 backend done |
| B | B5 | Docs res-10 sweep | ✅ |
| C | C1 | Address search (Photon + Nominatim fallback) | ✅ |
| C | C2 | Scorecard + click | ✅ |
| C | C3 | Path-to-amenity | ✅ |
| C | C4 | Live isochrone | ✅ |
| C | C5 | Walk/Bike toggle | ✅ |
| D | D1 | Style system (glass + tokens + dark mode) | ✅ |
| D | D2 | Map design pass | ✅ |
| D | D3 | Mobile responsive | 🟡 panels OK |
| D | D4 | Accessibility | 🟡 ARIA wired |
| D | D5 | Empty/loading/error | 🟡 |
| D | D6 | Izvor podatkov + Swagger | ✅ |
| D | D7 | Custom basemap | ⏳ |
| D | D8 | Dark mode toggle | ✅ |
| E | E1 | Investor mode | ⏳ |
| E | E2 | Občina planner | ⏳ |
| E | E3 | Mode switcher | ⏳ |
| F | F1 | Partial-load tiles | 🟡 ETL done |
| F | F2 | Web Worker | ⏳ |
| F | F3 | Binary attrs | ⏳ |
| G | G1 | Heatmap vs hexes | DEC |
| G | G2 | Ghosts overlay | ⏳ |
| G | G3 | LLM integration (search) | ✅ live |
| G | G4 | Permalink hash | ✅ |
| H | H1 | OpenAPI spec for Next.js routes | ✅ |
| H | H2 | AI chat assistant (ChatBox) | ✅ |

---

## 1. Current state snapshot

The end-to-end pipeline runs. The map renders all of Slovenia, with občina polygons coloured by population-weighted mean score at country zoom and an aggregating H3 hex layer at street zoom.

### Data
- [x] OSM Slovenia extract on disk (308 MB)
- [x] GURS občine boundaries (212 polygons, 14 MB)
- [x] ARSO Zavarovana območja (531 polygons, 4 MB) — **on disk, not yet rendered**
- [x] ARSO Natura 2000 (355 polygons, 9 MB) — **on disk, not yet rendered**
- [x] Kontur Population SI (22,034 res-8 cells)
- [x] All sources documented in `data/DATA_SOURCES.md`

### Backend — ETL pipeline + local Supabase
- [x] `01_extract_amenities.py` — 37,622 amenities classified into 8 categories
- [x] `02_isochrones.py` — 112,866 pedestrian isochrones, 464 req/s, resumable
- [x] `03_score_cells.py` — **1,079,666 H3 res-10 cells** + 212 občine aggregated (~30 s wall time)
- [x] `06_upload_to_supabase.py` — bulk-load all 5 tables + 3 Storage objects (2026-05-15)
- [x] `07_bin_cells_to_tiles.py` — F1 res-7 tile bake (4,051 shards, 2026-05-15)
- [x] `08_flag_unbuildable.py` — 344,678 cells flagged inside protected areas (B4 partial, 2026-05-15)
- [x] Valhalla container builds + runs locally
- [x] Supabase project provisioned + schema applied — **local** via `supabase start` (2026-05-15)
- [x] Static artifacts uploaded to Supabase Storage — **local** buckets `cells/`, `overlays/` (2026-05-15)
- [ ] Cloud Supabase deploy via `supabase db push`
- [ ] Railway hosting the Valhalla container

### Frontend
- [x] Next.js 14 + TypeScript + MapLibre + deck.gl scaffold
- [x] OpenFreeMap `positron` basemap (switched back from `liberty` for perf)
- [x] Občina polygons at zoom < 9, H3 hex layer at zoom ≥ 9 (aggregated via `h3.cellToParent`)
- [x] Hex resolution: baked at res-10 (~66 m edge), aggregates to res 6/7/8/9 by zoom
- [x] Click-to-open Scorecard side panel with score, 8 categories, walk/bike toggle, "show 15-min reach" Valhalla button (C2/C4/C5, 2026-05-15)
- [x] Top-bar AddressSearch (Photon + lat/lng paste fallback) (C1, 2026-05-15)
- [x] Izvor podatkov provenance panel + `/api-docs` Swagger UI route (D6, 2026-05-15)
- [x] `/api/llm` server-only route, Zod-validated (G3 stub, 2026-05-15)
- [x] `/api/valhalla/[endpoint]` server proxy (works around Valhalla 405-on-OPTIONS, 2026-05-15)
- [x] URL hash permalink — lng/lat/zoom/h3 (G4, 2026-05-15)
- [x] Live zoom indicator + dummy-data fallback banner + loading banner

### Score distribution (still matches project hypothesis at res-10)
```
🟢 Green 6–8:    ~44 k cells  (4 %)
🟡 Yellow 4–5:   ~45 k cells  (4 %)
🟠 Orange 2–3:  ~105 k cells  (10 %)
🔴 Red 0–1:     ~886 k cells  (82 %)
```

### Repo
- [x] Simple `frontend/` + `backend/` + `data/` + `docs/` layout
- [x] `backend/requirements.txt`, Python 3.12 venv, deck.gl + h3-js installed
- [x] Apache 2.0
- [x] CI (typecheck + build on PR) — `.github/workflows/ci.yml` (2026-05-15)
- [ ] Vercel project linked

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

# 3. Frontend
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

Each task has: a short ID (`A1`, `B2`, …) for cross-reference, the **owner** (TBD until assigned), **dependencies**, and **acceptance criteria** (AC).

---

### Phase A — Deploy the real backend  *(unblocks production)*

#### A1 · Provision Supabase + apply schema · **P0** · ✅ **DONE (local) 2026-05-15**
- **Why:** every other backend task assumes a live database.
- **Dependencies:** none.
- **Status:** Local stack via `supabase start` running with schema applied. Added migrations `0001_init.sql` (6 tables + RLS), `20260515084121_rpc_helpers.sql` (`amenities_for_point` RPC), `20260515085614_rls_amenity_isochrones.sql` (closes RLS gap), `20260515090120_add_unbuildable.sql` (B4 column). Cloud deploy (`supabase link` + `db push`) deferred.
- **Steps:**
  1. Create Supabase project (Frankfurt, free plan) per `CHECKLIST.md §1.3`.
  2. Enable extensions: `postgis`, `postgis_topology`, `h3` (via `dbdev`).
  3. Apply `backend/supabase/migrations/0001_init.sql` via `supabase db push`.
  4. Save URL + anon key + service_role key in 1Password.
- **AC:** `curl https://<project>.supabase.co/rest/v1/cell_scores?limit=1` returns 200 and an empty array.

#### A2 · Load ETL outputs into Supabase · **P0** · ✅ **DONE (local) 2026-05-15**
- **Why:** the frontend will hit REST endpoints for per-cell scorecard + amenity-pin data.
- **Dependencies:** A1.
- **Status:** `backend/etl/06_upload_to_supabase.py` loads exact-count rows: obcine 212, protected_areas 886, amenities 37,622, amenity_isochrones 112,866, cell_scores 1,079,666. Storage buckets `cells/` + `overlays/` hold `cell_scores_lite.json`, `obcine_scored.geojson`, `cell_population_lite.json`. `cell_amenities` table intentionally empty — replaced by the `amenities_for_point` RPC (saves ~30M rows). RLS public-read enabled on all six tables.
- **Steps:**
  1. Extend `03_score_cells.py` (or add `03b_upload.py`) to bulk-insert `amenities`, `amenity_isochrones`, `cell_scores`, `cell_amenities`, `obcine` via Supabase Python client.
  2. Upload `cell_scores_lite.json.gz` + `obcine_scored.geojson` to public Storage buckets `cells/` and `overlays/`.
  3. Configure RLS: anon-key read-only on all six tables.
- **AC:** `https://<project>.supabase.co/rest/v1/cell_amenities?h3=eq.<known-h3>` returns the expected amenity rows.

#### A3 · Deploy Valhalla to Railway · **P0** · 🟡 **PARTIAL — local only**
- **Why:** live "Show 15-min reach" isochrone overlay requires a public Valhalla URL.
- **Dependencies:** none (parallel with A1/A2).
- **Steps:** push `backend/valhalla/Dockerfile` to Railway, allocate ≥ 4 GB RAM, expose port 8002, copy URL into `VALHALLA_URL` (server-only env var, consumed by the `/api/valhalla/[endpoint]` proxy). Add `/health` endpoint check.
- **Status:** Valhalla running locally (`docker start valhalla-slo`, port 8002, 86 ms isochrone). `frontend/lib/valhalla.ts` + `frontend/app/api/valhalla/[endpoint]/route.ts` proxy in place (proxy is permanent — Valhalla returns 405 on CORS preflight regardless of host). Only Railway push + `VALHALLA_URL` env var remain.
- **AC:** isochrone POST against the Railway URL returns a valid polygon for Prešernov trg.

#### A4 · Wire frontend to live data sources · **P0** · ✅ **DONE 2026-05-15**
- **Why:** flips the site from static-JSON-from-`public/data/` to the real Supabase + Storage URLs.
- **Dependencies:** A2, A3.
- **Steps:**
  1. Create `frontend/lib/supabase.ts` (Supabase JS client).
  2. Create `frontend/lib/valhalla.ts` wrapper for isochrone calls.
  3. Switch `SCORES_URL` and `OBCINE_URL` in `components/Map.tsx` to Storage URLs (env-flagged so local dev still uses `public/data/`).
- **Status:** `lib/supabase.ts` + `lib/valhalla.ts` shipped. `Map.tsx` URL constants are env-conditional via `NEXT_PUBLIC_USE_REMOTE_DATA`. **Gotcha:** supabase-js `.rpc()`/`.from().single()` hung under React strict mode locally — switched data queries to direct `fetch` against PostgREST (see `lib/supabase.ts`). The `createClient` singleton stays for future auth/realtime needs.
- **AC:** in production build, network panel shows fetches from `supabase.co`, not `/data/`.

#### A5 · Vercel deploy + CI · **P1** · 🟡 **CI done, Vercel TODO**
- **Dependencies:** A4.
- **Steps:** link repo → Vercel project (root: `frontend/`), set env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `VALHALLA_URL`, `NEXT_PUBLIC_USE_REMOTE_DATA`). Add minimal GitHub Action: `pnpm install && pnpm typecheck`.
- **Status:** `.github/workflows/ci.yml` shipped — runs typecheck + build on PRs and pushes to `main` with placeholder env vars. Vercel project link still requires user action.
- **AC:** push to `main` triggers auto-deploy; preview URL works; CI green on PR.

---

### Phase B — Data quality & coverage

#### B1 · Debug missing-hex areas · **P0** *(user's #12)* · ✅ **DONE 2026-05-15**
- **Status:** `backend/etl/diagnostics/coverage_check.py` shipped. **0 / 212 občine have `n_cells == 0`.** Smallest by cell count: Odranci (317 cells, 6.93 km²). Acceptance bar met. The <2% uncovered land area check is not run since no obcina is missing — leaving as future polish.
- **Symptom:** certain parts of Slovenia have no hexagons rendered at street zoom.
- **Likely causes (in probable order):**
  1. Kontur res-8 source has no cell there (uninhabited — expected, not a bug).
  2. Cell centroid falls outside obcina polygon → dropped by `aggregate_obcine`'s `predicate="within"` sjoin (orphan cells).
  3. Border / sea / lake cells missing from Kontur entirely.
- **Steps:**
  1. Write `backend/etl/diagnostics/coverage_check.py` that overlays raw Kontur cells vs scored cells vs občina polygons, flagging any obcina with `n_cells == 0` or `>10%` area uncovered.
  2. If "Kontur missing it" → augment with `OSM building=*` filter to add residential cells Kontur skipped (rare in Slovenia but possible).
  3. If "sjoin orphan" → use `predicate="intersects"` + `keep_left` semantics.
- **AC:** every obcina has `n_cells > 0` AND the `coverage_check` script reports <2% uncovered land area per obcina.

#### B2 · Hand-pick amenity tags · **P1** *(user's #5)* · ⏳ **TODO — waits on user**
- **Status:** Open per H7. User has not yet checked boxes in the candidate list below. No ETL re-run scheduled until the list is finalized.
- **Goal:** user-curated tag list per category for both the score AND the map pins. Currently several categories are overly broad (notably `delo` = any `office=*`), and several plausible tags are missing entirely (e.g. `dentist` in `zdravstvo`, `library` in `izobrazevanje`, `cafe` in `storitve`).
- **Process:** the user (you) provides the final pick from the candidate list. I do not edit `01_extract_amenities.py` until that pick is in. The candidate list per category is maintained as a checklist below; tick what to keep, strike what to drop, add anything missing.
- **After pick:** edit `CATEGORY_FILTERS` in `01_extract_amenities.py:38`, re-run `01` → `02` → `03`. Step 02 (~1–2 min) regenerates isochrones for the new amenity set. Step 03 (~30s) re-scores cells.
- **AC:** new amenity counts reviewed; new score distribution sanity-checked; visual map review by user passes.

##### Candidate tag list per category *(check the ones to keep)*

Format: `tag=value` — number after each value is the rough count in OSM Slovenia (estimate, not verified per-tag). Tags **bolded** are currently in `01_extract_amenities.py`.

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
- [ ] ❌ amenity=parking · parking_space *(explicit DROP — currently NOT in filter, listed here for clarity)*

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

#### B3 · ~~9th cultural category~~ · **scrapped**
- Decision (2026-05-13): not adding `kultura` as a 9th category. Score range stays 0–8. Cultural amenities (museum, library, gallery, theatre) may be folded into `storitve` as part of B2's hand-pick — flag in that audit if you want them counted.

#### B4 · Render protected areas + remove unbuildable terrain from possibility · **P1** *(user's #7)* · 🟡 **PARTIAL 2026-05-15**
- **Status:** Backend done — `cell_scores.unbuildable` column added via migration `20260515090120_add_unbuildable.sql`; `08_flag_unbuildable.py` flags 344,678 cells (31.9%) whose centroid falls inside a protected area. Frontend hatched overlay rendering and the DEM-based mountain mask still TODO.
- **Goal:** protected areas (Natura 2000, Zavarovana območja) and mountain terrain should be visually distinct AND excluded from "the score is bad here, build something" suggestions in investor mode.
- **Steps:**
  1. Add diagonal-hatch overlay layer in `Map.tsx` — `SolidPolygonLayer` rendering `protected_areas.geojson` (or PMTiles for production) with diagonal stroke pattern. Score remains visible underneath at 0.5 alpha. Toggleable.
  2. **Mountain exclusion** — add `MTN_MASK` derived from DEM / OSM `natural=cliff` + slope > 30° OR elevation > 1500m. Tag cells inside as `unbuildable=true` in `cell_scores` table.
  3. Investor mode (C2) skips `unbuildable=true` cells when ranking demand.
  4. **Visual:** unbuildable cells render with a striped "no-build zone" pattern instead of the score color.
- **Dependencies:** B3 (so cells table schema is final before adding column).
- **AC:** Triglav National Park visibly hatched; investor mode suggests zero amenities inside it.

#### B5 · Update PLAN.md + ARCHITECTURE.md to reflect res-10 reality · **P2** · ✅ **DONE**
- Done 2026-05-13. Remaining "res 9" mentions in docs are in valid context (aggregation pyramid or historical notes).
- **AC:** grep `'res 9'`, `'50k'`, `'500 KB'` in `docs/` returns zero stale matches.

---

### Phase C — Core interactivity *(the demo moments)*

#### C1 · Address search bar · **P0** *(user's #9 "critical")* · ✅ **DONE 2026-05-15**
- **Status:** `frontend/components/AddressSearch.tsx` shipped — debounced Photon autocomplete (no `lang=sl` param; Photon doesn't support it), SI bbox constraint, lat/lng paste fallback, Enter-to-select. **Nominatim fallback** added 2026-05-15: when Photon throws (network failure, non-2xx, CORS), the same query retries against `nominatim.openstreetmap.org/search` bounded to Slovenia, with results normalized to the Photon feature shape. Minimum-character threshold raised from 3 → 5 to cut Photon traffic + dropdown noise. On pick: `map.flyTo()` + `setSelectedH3` → scorecard opens. shadcn `Command` not used — plain `<input>` + dropdown was lighter for now.
- **Goal:** prominent top-bar search "Vpišite svoj naslov" → debounced Photon autocomplete → on-select `map.flyTo()` + scorecard opens for the cell containing the result.
- **Steps:**
  1. Add `components/AddressSearch.tsx`: shadcn `Command` + Photon API.
  2. Photon endpoint: `https://photon.komoot.io/api/?q={q}&lang=sl&bbox=13.3,45.4,16.7,46.9` (constrained to SI).
  3. On selection: `h3.latLngToCell(lat, lng, 10)` → fetch from `cell_scores` table → open scorecard (C2).
  4. Failure fallback: free-form `lat,lng` paste.
- **AC:** typing "Prešernov trg, Ljubljana" yields a dropdown, clicking flies map + opens scorecard within 800 ms.

#### C2 · Scorecard side panel + click handler · **P0** *(user's #3, #4)* · ✅ **DONE 2026-05-15**
- **Status:** `frontend/components/Scorecard.tsx` shipped. Renders big score badge with color bucket, 8 category rows (icon + name + check + time), walk/bike toggle, "Show 15-min reach" button, and an expandable "N dosegljivih lokacij" list of amenities via the RPC. Hex layer `pickable: true` always now (perf hit acceptable for hackathon; can revisit). For Prešernov trg the panel shows 8/8 with all categories at 5 min and ~880 amenities.
- **Goal:** click a hex (or arrive via search) → side panel with the cell's score, 8 (or 9) category rows, each row shows walk + bike times.
- **Steps:**
  1. Re-enable `pickable: true` on hex layer with **`onHover` disabled** (lazy picking on click only — needs `_subLayerProps` or a manual `useEffect` listener on the map). Avoids the perf regression we found at res-10.
  2. Add `components/Scorecard.tsx`: shadcn `Sheet` (right-side), header with big "6/8", grid of category rows.
  3. Each row: icon, name, ✓/✗, walk-time chip, bike-time chip (`walk_min / 2.5` rounded).
  4. Fetch source: `cell_scores` row from Supabase (full file, not lite — has `walk_min[]`).
- **Dependencies:** A2 (live data), B3 (category set finalized).
- **AC:** clicking a hex opens panel within 400 ms; all 8/9 rows render with both walk and bike chips.

#### C3 · Path-to-amenity on amenity click · **P1** *(user's #3 "tracking the path")* · ✅ **DONE 2026-05-15**
- **Status:** Shipped. Clicking a Scorecard category row fires `fetchRoutesForCategory` (`Scorecard.tsx:200`), which calls `/api/valhalla/route` for up to 25 nearest in-category amenities, decodes the returned polylines via `decodePolyline`, and emits a `RouteSet { categoryId, paths }` to `Map.tsx`. The map renders the paths as a `PathLayer` in the active category's color, with larger same-color end-markers and a 🏠 origin pin. Hover-name labels on amenity dots are gated to the active category (Map.tsx:522).
- **AC met:** clicking "Trgovina" draws amber paths from origin to every nearest shop inside the 15-min iso, end markers + origin pin make the relationship unambiguous.

#### C4 · "Show 15-min reach" isochrone overlay · **P0** · ✅ **DONE 2026-05-15**
- **Status:** "Prikaži dosegljivost" button in Scorecard fires `isochrone()` via the `/api/valhalla` proxy; returned GeoJSON Feature renders as a `GeoJsonLayer` with cyan fill + outline. Local Valhalla responds in ~86 ms; total UI-perceived latency well under 1.5 s.
- **Goal:** button in scorecard → live Valhalla isochrone polygon, drawn over the heatmap.
- **Steps:** POST to Valhalla `/isochrone` (15 min walking, then 6 min for bike toggle). Render as `PolygonLayer` with soft cyan fill (alpha 0.3).
- **Dependencies:** A3, C2.
- **AC:** button click → polygon visible within 1.5 s.

#### C5 · Walk/Bike toggle · **P1** · ✅ **DONE 2026-05-15**
- **Status:** Global Hoja/Kolo toggle above the view-switch + per-Scorecard chip toggle. The toggle rescales (1) the visible isochrone (separate Valhalla bake per mode, both fetched once on iso reveal — see `Scorecard.tsx:184–198`), (2) the visible amenity dots (filtered to the mode-specific iso), (3) the active route set (re-fetched with `costing=bicycle`), and (4) the score badge (`walk_score` vs `bike_score`).
- **Implementation:** speeds locked at `NEXT_PUBLIC_WALKING_SPEED=4` and `NEXT_PUBLIC_CYCLING_SPEED=13`; bike uses `bicycle_type=Hybrid`. Real Valhalla `bicycle` costing — no walk/2.5 estimate any more.
- **AC met:** toggling flips polygon + chips + pins + active path within one render frame; route layer re-bakes asynchronously.

---

### Phase D — Visual & UX polish

#### D1 · Style system — glass + material + sleek · **P0** *(user's #1)* · ✅ **DONE 2026-05-15**
- **Status:** Token-driven CSS shipped — every surface, button, chip, pill, and dropdown reads from `--surface-glass`, `--border-glass`, `--text-primary`, `--accent`, `--shadow-lg` (and ~20 more) declared at the `:root` level. The `[data-theme="dark"]` selector overrides those tokens in one block, so a single `data-theme` flip on `<html>` reskins the entire app. Glass-morphism baseline = `backdrop-filter: blur(20px) saturate(140%)` on rgba surfaces, 1 px hairline borders, single soft shadow scale (`0 8px 24px var(--shadow)`). No Tailwind/shadcn — token system is small enough to live in `globals.css` alongside hand-tuned component selectors.
- **AC met:** all panels (legend, zoom indicator, view switch, mode toggle, address search + dropdown, scorecard, provenance, chatbox, theme toggle, "Od kod podatki?" pill, banner, loading banner) share one visual language across both themes.

#### D2 · Map design pass · **P1** *(user's #5)* · ✅ **DONE 2026-05-15**
- **Status:** Basemap is now theme-aware — light mode uses OpenFreeMap `positron`, dark mode uses `dark-matter`. Občina outlines hold at 1 px and read against both themes thanks to alpha rather than solid color. Hex strokes are intentionally off at res ≥ 9 (perf). Score color buckets are unchanged per PLAN §4 lock; they read on both backgrounds because the buckets are fully saturated.
- **AC met:** visual hierarchy holds in both themes — amenity pins > active path > scorecard panel > hex fill > občina outline > basemap.

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

#### D6 · "Izvor podatkov" — data-provenance UI · **P0** *(transparency · user-resolved 2026-05-13)* · ✅ **DONE 2026-05-15**
- **Status:** `frontend/components/IzvorPodatkov.tsx` shipped with all 6 dataset cards (each with a "Zakaj smo to izbrali" sentence), plain-SL summary, methodology block, privacy badge, GitHub SHA link (when `NEXT_PUBLIC_GIT_SHA` is set), and Swagger UI links. `frontend/app/api-docs/page.tsx` renders the live OpenAPI spec from the Supabase URL. Bottom-left "Od kod podatki?" pill opens the panel. Info-icon next to scorecard not yet wired.
- **Why:** Transparency is a project-defining commitment. One panel hits four izhodišča in one component (**INSPIRE/ISO #3, transparency #4, reproducibility #5, GDPR #9** adjacency) and — critically — speaks to *normal users*, not just judges. Most teams ship a black-box map. This separates us. Origin: `GEO-SLOVENIJA-CONFORM.md §3.4` Tactical Move #4, escalated to P0 by user.
- **Audience:** layered for both a curious citizen ("Od kod te številke?") and a technical judge (license, SHA, parameters).
- **Content — required sections:**
  1. **Plain-language summary** (4–6 Slovenian sentences): what the map shows, where the numbers come from, how to read the score, where to learn more. Reading time <60 s.
  2. **Per-dataset cards** — one card per layer, each with: source URL, license, version/date, row count, and a one-sentence **"Zakaj smo to izbrali"** rationale.
     - OSM Slovenia (Geofabrik) · 37,622 amenities · ODbL · PBF date pinned
     - GURS občine · 212 polygons · CC-BY 4.0
     - ARSO Zavarovana območja · 531 polygons · WFS · CC-BY 4.0
     - ARSO Natura 2000 · 355 polygons · WFS · CC-BY 4.0
     - Kontur Population SI · 22,034 res-8 → 1,079,666 res-10 children
     - OpenFreeMap `liberty` basemap · open vector tiles, no API key
  3. **Methodology summary** — also in plain SL:
     - H3 res-10 (~66 m edge) — why this resolution, not res-9 or res-11
     - 8 categories with OSM tag list per category (link to GitHub `01_extract_amenities.py`)
     - Score formula: *Σ I(kategorija_k dosegljiva v 15 min hoje)* → 0–8
     - Color buckets: 6+ green, 4–5 yellow, 2–3 orange, 0–1 red
     - Bike time = walk_min / 2.5 (PLAN §3 lock)
  4. **Reproducibility footer** — GitHub repo URL + **commit SHA injected at build time** + observed bake runtimes ("02_isochrones.py ≈ 1,3 min, 464 req/s").
  5. **License + attribution** — Apache 2.0 (project); CC-BY for each base dataset; OpenStreetMap contributor attribution.
  6. **Privacy** — *"Naslov se ne hrani. Vsa obdelava poteka v vašem brskalniku."* (also rendered as a badge per Tactical Move #10).
  7. **Live API specification (Swagger / OpenAPI)** — *zero-code surface, free from Supabase*. Two access points exposed under "Tehnične podrobnosti":
     - **a. Raw OpenAPI 2.0 JSON** — direct link to `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`. PostgREST auto-generates this from our schema (`backend/supabase/migrations/0001_init.sql`), refreshed on every migration. Hits **izhodišče #3 (INSPIRE/ISO interoperability — OAS is an OGC-adjacent standard)** and **#5 (reproducibility — anyone can query the public dataset)**.
     - **b. Embedded Swagger UI** at `/api-docs` route in the Next.js app, using `swagger-ui-react` pointed at the Supabase OpenAPI URL. Renders every table + RPC function with runnable code samples (`curl`, `JavaScript`, `Python`, `Dart`). User can paste the public anon key and execute reads from the browser. Frame in the panel as: *"Naši podatki niso skriti — preverite jih sami."*
     - **What we get for free, no implementation:** REST endpoint per table, filtering grammar (`eq`, `gte`, `lte`, `in`, `like`), embedded foreign-key joins via `?select=*,občina(*)`, pagination, ordering, OpenAPI spec regenerated on each schema change.
     - **What stays manual:** the LLM API route at `/api/llm` (TASKS §G3) is a Next.js route, not PostgREST. Document it with a Zod schema co-located with the route — one source of truth for runtime validation + spec.
- **Surfaces (where it appears):**
  1. **Persistent footer link** "Od kod podatki?" — visible on every page.
  2. **Info icon (ⓘ)** next to the scorecard score → deep-link to methodology section of the same panel.
  3. **Landing-page nav** "O projektu" entry that opens this panel.
- **Implementation steps:**
  1. Author all SL copy. Use `data/DATA_SOURCES.md` as source of truth; **add the "Zakaj" rationale sentence per dataset** (currently missing).
  2. Build `frontend/components/IzvorPodatkov.tsx` — shadcn `Sheet` (right-side desktop, bottom-sheet mobile per D3).
  3. Layered disclosure: plain summary always visible; per-dataset cards expanded by default; **"Tehnične podrobnosti"** collapsible block hides version strings, SHAs, exact osmium tag filters.
  4. Wire the three surfaces (footer, scorecard ⓘ, landing nav).
  5. Inject `process.env.NEXT_PUBLIC_GIT_SHA` at build time (Vercel exposes `VERCEL_GIT_COMMIT_SHA`). Make it a clickable link to `github.com/.../commit/<sha>`.
  6. Install `swagger-ui-react` + `@types/swagger-ui-react`. Create `frontend/app/api-docs/page.tsx` rendering `<SwaggerUI url={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`} />`. Set `Authorization: Bearer <anon-key>` as a default request header so "Try it out" works out of the box.
  7. Add two links inside the panel's "Tehnične podrobnosti" block: "REST API (Swagger UI) →" → `/api-docs`, and "OpenAPI spec (JSON) →" → the raw Supabase URL. Co-locate with the GitHub commit SHA link.
  8. After Supabase migration A1 lands, run a one-time smoke check: load `/api-docs`, expand `cell_amenities`, paste `h3=eq.<known-cell>` filter, click "Execute", confirm a JSON response.
- **Dependencies:** D1 (style system) for the panel chrome; D3 (mobile responsive) for the bottom-sheet on mobile.
- **AC:**
  - Every dataset in `DATA_SOURCES.md` has a card.
  - "Zakaj" rationale is one Slovenian sentence per dataset.
  - SL copy reads coherently to a non-technical user in under 60 seconds (pair-test before submission).
  - Panel opens within 200 ms.
  - One click from the panel takes the user to the GitHub repo at the exact commit that built the deployed bundle.
  - No external network calls when opening the provenance panel itself (everything bundled — Swagger UI is a *separate route* the user opts into).
  - `/api-docs` route renders Swagger UI showing all 6 tables (`amenities`, `amenity_isochrones`, `cell_scores`, `cell_amenities`, `obcine`, `protected_areas`) and any RPC functions; "Try it out" executes successfully against the deployed Supabase project with the public anon key.
  - Raw OpenAPI JSON URL returns 200 and validates as OAS 2.0.

#### D5 · Empty / loading / error states · **P1** · 🟡 **PARTIAL 2026-05-15**
- **Status:** "Nalagam podatke …" pill renders during the score-cells fetch; dummy-data fallback banner if the Storage fetch 404s; Scorecard has loading + error variants; AddressSearch surfaces Photon errors. Comprehensive sweep over every async path not yet done.
- Loading skeleton for first paint; error banner when `cell_scores_lite.json` 404s; "Photon offline" banner with manual lat/lng input fallback (already in fallback in `Map.tsx`, extend to UI).
- **AC:** every async op has a defined loading + error state, no naked `null` returns.

#### D8 · Dark mode toggle · **P1** *(user request 2026-05-15)* · ✅ **DONE 2026-05-15**
- **Status:** A theme toggle (sun/moon icon) sits next to the "Od kod podatki?" pill in the lower-left cluster. State persists to `localStorage` under the key `theme`; first load defaults to the user's `prefers-color-scheme`. The toggle flips `data-theme` on `<html>` (driving every CSS token override) **and** swaps the MapLibre style at runtime (`positron` ↔ `dark-matter`) without remounting the map. The same control is mirrored inside the "Izvor podatkov" panel under a "Videz" section so users who discover the panel first can still toggle.
- **AC met:** flicker-free switch (no reload), basemap and panels both flip, preference persists across sessions.

#### D7 · Programmable / custom basemap style · **P2** · ⏳ **TODO**
- **Why:** OpenFreeMap's hosted styles (`positron`, `liberty`, `bright`) are good defaults, but the basemap is currently fighting the heatmap and score palettes for visual attention. A bespoke style — muted background, reduced label density, no 3D extrusions, no POI icons — would let the deck.gl overlays read cleanly *and* drop a few ms per frame on weaker hardware.
- **Dependencies:** D1 (palette locked) so we know which neutrals harmonize with the chosen accent colors.
- **Approach (recommended: fork-and-edit):**
  1. Fetch the source positron style JSON once (`curl https://tiles.openfreemap.org/styles/positron > frontend/public/styles/custom.json`) and commit it.
  2. Point `BASEMAP_STYLE` in `Map.tsx` at `/styles/custom.json`.
  3. Edit `custom.json` to taste — recolor land/water fills, drop POI symbol layers, raise `minzoom` on street-name labels, remove any `fill-extrusion` layer (positron has none, but worth checking).
  4. Optional runtime patches in `Map.tsx` (e.g., `map.setLayoutProperty('place_label_small', 'visibility', 'none')`) for tweaks that depend on the active view.
- **Alternative (heaviest, most control):** write a style from scratch against the OpenFreeMap planet vector tile source (`https://tiles.openfreemap.org/planet`). Reserve for the SLO4D launch polish, not the hackathon window.
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

### Phase E — Modes (B + C)

#### E1 · Mode B — Investor view · **P0** *(user's #9 "critical")* · ⏳ **TODO**
- **Status:** Backend ready — `cell_scores.unbuildable` + per-category `walk_min[]` are all queryable. UI not built yet (no `/investitor` route, no demand layer, no projection card).
- **Goal:** dedicated `/investitor` route. Inverted heatmap: `demand = population × (1 − category_satisfied)`. Click a hot cell → "Build a [category] here → N residents gain access."
- **Steps:**
  1. New page `frontend/app/investitor/page.tsx` — reuses `<Map />` with a different `mode='investor'` prop.
  2. Category dropdown (top bar) — pick which of 8/9 categories to optimize for.
  3. Compute `demand_per_cell` client-side from `cell_scores` (we already store per-category satisfaction; demand = pop × (1 − sat)).
  4. Color cells by demand (purple-gradient palette, distinct from green-red).
  5. Click handler: open projection card showing population gain + nearest 3 competitors (other amenities in same category within 1 km).
  6. Občina filter dropdown (filter visible cells to one obcina).
  7. Respect B4's `unbuildable=true` flag — gray those cells out.
- **Dependencies:** A4, B3, B4.
- **AC:** picking "lekarna" in Triglav region returns zero suggestions (all unbuildable); in Maribor suburbs returns specific hot cells.

#### E2 · Mode C — Občina planner view · **P1** *(user's #14)* · ⏳ **TODO**
- **Status:** Backend ready — `obcine_scored.geojson` ships `mean_score`, `population`, `n_cells` for every občina. UI not built.
- **Goal:** `/obcina` route. Choropleth + sortable scoreboard.
- **Steps:**
  1. Sortable side table: columns = obcina name, mean_score, population, %-cells-with-score-≥-6 ("15-min-city share"), n_cells. Click row → map zooms to that obcina + side panel with quick facts.
  2. Quick-facts panel: 4 stat tiles (population, % satisfying 15-min, top-served category, top-underserved category).
  3. Top-5 / bottom-5 highlight (already in `aggregate_obcine` output; just surface in UI).
- **Dependencies:** A2 (live data).
- **AC:** sort by `15-min city share` reveals Ljubljana > Maribor > Koper > … as top; bottom is Kostel.

#### E3 · Mode switcher · **P1** · ⏳ **TODO**
- Tab control in header: "Doma" / "Investitor" / "Občina". Preserves map viewport across modes.
- **Status:** URL hash already carries lng/lat/zoom (from G4), so cross-mode viewport sync is straightforward once E1/E2 land.
- **AC:** switching tabs keeps the same lat/lng/zoom; only the data layer + side panel swap.

---

### Phase F — Performance & scale

#### F1 · Smooth interaction at close zoom (partial loading) · **P1** *(user's #13)* · 🟡 **PARTIAL 2026-05-15**
- **Status:** ETL side done — `backend/etl/07_bin_cells_to_tiles.py` produced 4,051 res-7 shards in `data/15min-slo/tiles/` (median 10 KB, ≤12 KB max) plus `index.json` manifest. Frontend lazy-fetch logic + Storage upload of the shards not yet wired.
- **Goal:** at res-10 raw mode (zoom ≥ 15), only fetch + render cells in the current viewport bbox rather than holding all 1.08M in memory.
- **Approach:**
  1. Pre-bin cells by their res-7 parent during ETL → write one JSON per res-7 cell (~1000 tiles, each ≤200 KB). Filename = parent h3.
  2. Frontend: on zoom ≥ 13, compute viewport-visible res-7 parents → fetch their tiles lazily, cache in `Map<h3, ScoreCell[]>`.
  3. Aggregate function unions the loaded tiles.
- **Result:** initial page load drops from 3 MB → ~50 KB; close zoom adds ~10 tiles per pan.
- **Dependencies:** A2 (so we know storage layout).
- **AC:** Network panel on cold load < 100 KB before user pans; zoom to 16 + pan around Ljubljana fetches < 20 tiles total.

#### F2 · Web Worker for `aggregate()` · **P2** · ⏳ **TODO**
- Move `h3.cellToParent` aggregation off the main thread. Removes the ~70 ms freeze at low zoom on slower machines.
- **AC:** Performance profile shows zero main-thread blocks > 16 ms on zoom transition.

#### F3 · Binary attributes for deck.gl · **P2** · ⏳ **TODO**
- Replace `getFillColor: (d) => colorForScore(d.score)` with a pre-computed `Uint8Array` passed as `data.attributes.getFillColor`. Eliminates per-cell JS accessor calls.
- **AC:** Chrome devtools shows 1 ms attribute upload instead of 80 ms accessor sweep on data change.

---

### Phase G — Stretch / differentiators

#### G1 · Heatmap vs hexagons decision · **DEC** *(user's #8)* · ⏳ **DECISION PENDING**
- **Question:** does a diffused heatmap (deck.gl `HeatmapLayer` over cell centroids) read better at low zoom than the hex polygons we have today?
- **Proposed test:**
  - Build a branch with `HeatmapLayer` at zoom < 12 and `H3HexagonLayer` at zoom ≥ 12 (auto-switch).
  - Side-by-side visual comparison with current hex-only aggregation.
- **Outcome:** ship the winner. My current intuition: heatmap reads better for country/region zoom (no discrete-cell artifacts), hexes win once you're "in" a city. The auto-switch is the right design.
- **AC:** user picks visual; chosen approach goes into main.

#### G2 · Municipality "ghosts" / planned developments · **P1** *(user's #10)* · ⏳ **TODO**
- **Goal:** show planned residential/commercial buildings as semi-transparent extruded polygons on the map. Click → estimated effect on local scores once built.
- **Steps:**
  1. Source: Ljubljana OPN data from PIS (Prostorski informacijski sistem) — manual download is fine for MVP. **Mock data acceptable** if PIS scraping is painful: hand-author 10–20 polygons for Ljubljana + Maribor.
  2. Render with deck.gl `PolygonLayer` + `extruded: true`, height proportional to planned floors.
  3. Click handler: estimated effect — pull amenity type from polygon metadata, recompute score for cells within 15-min walk if this amenity existed. Display delta in a card: "+0.3 average score for 1,400 residents."
  4. Time slider: "Today / 2030+" toggle that fades the ghost layer in/out.
- **Dependencies:** C2 (scorecard infra), client-side effect-recompute helper.
- **AC:** Ljubljana ghosts visibly extruded at street zoom; clicking one shows realistic delta.

#### G3 · LLM integration · **P1** *(user's #15)* · ✅ **DONE (search) 2026-05-15**
- **Status:** `frontend/app/api/llm/route.ts` shipped — server-only, Zod-validated discriminated union (`narrative` | `search`). The `search` branch is **live**: it calls OpenRouter (`OPENROUTER_API_KEY`, model defaults to `minimax/minimax-01` and is configurable via `MODEL`), parses a strict JSON spec from the LLM (`required_category_indices`, `target_town`, `reasoning`, `reply_text_sl`), geocodes the town via Photon, expands to an `h3.gridDisk` ~5–7 km radius, and calls the Supabase `llm_search_cells` RPC. Conversation history is forwarded so follow-ups refine the previous answer. Frontend wiring is the `ChatBox.tsx` floating affordance (H2). Narrative branch remains a deterministic stub for now — TODO when SLO4D polish window opens (per-IP rate limit + Supabase `cell_narratives` cache).
- **Locked use cases (decision 2026-05-13):** both **A · Natural-language search** + **B · Cell narrative**. Investor recommendations are out of MVP scope.
- **Use case A · Natural-language search**
  - User types a free-form query, e.g. *"Občina z visokim povprečnim seštevkom, kjer je rezultat pretežno posledica dobre dostopnosti v gosto poseljenih območjih"*.
  - LLM extracts a structured filter spec: `{ scope: "obcina", mean_score: ">=4", driver: "dense_high_score" }`.
  - Frontend applies the filter to the obcina layer (or hex layer if the query is cell-scoped) and pans to the top match.
  - Implementation note: the LLM never returns raw SQL. It returns a typed JSON spec validated by Zod, then a hand-written client mapper applies it. Keeps the surface auditable.
- **Use case B · Cell narrative**
  - On scorecard open, render a 2–3-sentence Slovenian description of the cell.
  - Example: *"Območje leži v zaledju Bohinjskega jezera, znotraj Triglavskega narodnega parka. V 15 minutah hoje so dosegljivi park in trgovina, ne pa zdravstveni dom in šola — najbližja sta v Bohinjski Bistrici, 3 km južneje."*
  - Context fed to the prompt: cell's `cell_scores` row, 3 nearest amenities, containing obcina, protected-area flag, distance to nearest urban core.
  - Cached per H3 cell (the narrative doesn't change between page loads) — store in Supabase `cell_narratives (h3, text_sl, generated_at)`.
- **Implementation steps:**
  1. New API route `frontend/app/api/llm/route.ts` — server-only (Kimi key never reaches client).
  2. Env var `KIMI_API_KEY` in Vercel.
  3. Prompt templates in `frontend/lib/prompts/{narrative,search}.ts` — Slovenian system prompts, JSON-schema-enforced outputs.
  4. Zod validators for both response shapes.
  5. Rate-limit per IP (Vercel KV or in-memory LRU): 30 LLM calls / hour / IP.
  6. Narrative cache table created via new migration `backend/supabase/migrations/0002_llm_cache.sql`.
- **Dependencies:** A4 (live data).
- **AC:** typing a SL natural-language query produces a structured filter + map state within 3 s; opening a scorecard renders a SL narrative within 2 s (cache miss) or 200 ms (cache hit).

#### G4 · Permalink / URL state for sharing · **P2** · ✅ **DONE 2026-05-15**
- **Status:** URL **hash** (not query params) carries `lng/lat/z/h3`. Map writes on every `moveend`/`zoom` via a ref to avoid stale-closure overwrite, and restores via `readHash()` on mount. Mode segment will land alongside E3. Test: navigate to `/#lng=14.5061&lat=46.0512&z=14&h3=8a1e1216b367fff` → scorecard for Prešernov trg opens.
- Store `lat,lng,zoom,mode,selectedH3` in URL query params. Sharing the URL re-opens the same view + scorecard.
- **AC:** copy URL → paste into incognito → identical view.

---

### Phase H — Documentation + AI assistant

#### H1 · OpenAPI / Swagger documentation for Next.js routes · **P1** *(user request 2026-05-15)* · ✅ **DONE 2026-05-15**
- **Goal:** the `/api-docs` route should describe every Next.js REST endpoint we ship, not only the auto-generated PostgREST surface for the Supabase tables.
- **Implementation:**
  1. Hand-authored OpenAPI 3.1 spec at `frontend/public/openapi.json` — describes `POST /api/llm` (`kind=search` and `kind=narrative` discriminated request bodies, plus all four response shapes: search-ok, narrative-ok, validation-error, missing-key) and `POST /api/valhalla/{endpoint}` (isochrone + route + locate + matrix + trace_route).
  2. `frontend/app/api-docs/page.tsx` rewritten to a tabbed Swagger UI: **App API** (loads `/openapi.json`) and **Supabase REST** (loads the PostgREST URL with the anon key auto-injected). User picks which surface to explore.
  3. Provenance panel updated with two links: "REST API — Next.js (Swagger UI)" and "REST API — Supabase tables".
- **AC met:** loading `/api-docs` and switching tabs renders both specs; "Try it out" succeeds against the locally running stack for `/api/llm` (search) and `/api/valhalla/isochrone`.

#### H2 · AI chat assistant ("Najdi mi dom") · **P1** · ✅ **DONE 2026-05-15**
- **Status:** `frontend/components/ChatBox.tsx` shipped — floating bottom-right affordance, expands into a 380 × 600 chat panel. Sends user message + prior turns to `/api/llm` (`kind=search`); on response renders the SL summary, a filter-summary chip (`🔍`), and flies the map to the top-ranked H3 cell. Conversation history excludes filter-summary lines so the LLM keeps focus.
- **AC met:** typing a SL life scenario ("Sva družina, delava v Ljubljani in Mariboru…") produces a structured filter + map flyTo within ~3 s using the live OpenRouter integration.

### Phase I — Open decisions (need user input)

These are not actionable until a decision is made.

| ID | Decision | Status |
|---|---|---|
| H1 | Project name + brand (literal "15min Slovenija" vs emotional "Doma" vs scoring "ProstorScore") | deferred — decide later |
| H2 | ~~9th category~~ | **resolved 2026-05-13: no 9th category, score stays 0–8** |
| H3 | Hexagon resolution lock — keep res-10 as the bake target | **resolved: res-10 locked** |
| H4 | Basemap final — `liberty` (current) or `positron` after D1 visual polish? | open |
| H5 | LLM use cases (G3) | **resolved: natural-language search + cell narrative** |
| H6 | English translation | **resolved: out of scope; UI Slovenian only** |
| H7 | B2 hand-pick amenity tags | open — user will check boxes in the candidate list inline above |
| H8 | G2 ghosts data source | **resolved: mock data acceptable for V1** |

---

## 4. What I added beyond the user's list

Flagged separately so the user can accept / reject each:

- **A5 · CI + Vercel deploy** — implied by "real backend" but worth tracking separately.
- **B1 acceptance criteria** — pinned to <2% uncovered land per obcina (the user asked to investigate; this is the proposed pass bar).
- **B5 · Doc-update sweep** — PLAN and ARCHITECTURE still describe res-9 reality. **(done 2026-05-13)**
- **D4 · Accessibility** — not in the brief but matters for the SLO4D demo + general polish.
- **D5 · Empty/error states** — needed for production but trivially overlooked.
- **F2/F3 · Web Worker + binary attributes** — non-blocking perf wins for after F1.
- **G4 · Permalink** — small feature, big polish multiplier.
- **H · Open decisions block** — the items I couldn't resolve myself.

## 5. Resolved with the user (2026-05-13)

1. **B3 — 9th category:** scrapped. Score stays 0–8.
2. **G3 — LLM use cases:** natural-language search + cell narrative. Investor recommendations out of MVP.
3. **F1 — partial loading priority:** in scope. Mobile smoothness is a P1 concern; F1 lands before E2 (občina view).
4. **B2 — amenity pruning:** user hand-picks from the candidate list inline in B2. No ETL re-run until the list is checked.
5. **G2 — ghosts:** mock data acceptable for V1.
6. **Language:** UI is Slovenian only. No English translation in scope (no `next-intl` switching layer needed for the demo).
7. **Brand name:** deferred — work continues under the working name "15min Slovenija".

---

## 6. File map (current)

```
/
├── README.md
├── frontend/                  # Next.js 14 + MapLibre + deck.gl
│   ├── app/                   # routes (currently just /; add /investitor /obcina)
│   ├── components/Map.tsx     # the entire map UI for now — split into Map + Scorecard + AddressSearch + ModeSwitcher as work progresses
│   ├── lib/                   # add supabase.ts, valhalla.ts, photon.ts wrappers
│   ├── public/data/           # dev fallback; production reads from Supabase Storage
│   └── package.json
├── backend/
│   ├── etl/                   # 01–04 pipeline scripts (res-10 as of now)
│   ├── valhalla/              # Dockerfile + custom_files (gitignored)
│   ├── supabase/migrations/   # 0001_init.sql (not yet applied)
│   ├── requirements.txt
│   └── .venv/                 # gitignored
├── data/
│   ├── 15min-slo/             # raw downloads + intermediate ETL outputs
│   └── DATA_SOURCES.md
└── docs/
    ├── PLAN.md                # project plan (needs res-10 update — see B5)
    ├── ARCHITECTURE.md        # system reference (needs res-10 update — see B5)
    ├── ARCHITECTURE.svg
    ├── CHECKLIST.md           # provisioning checklist
    └── TASKS.md               # this file
```

---

## 7. Troubleshooting

| Symptom | First thing to try |
|---|---|
| `docker: command not found` after restart | `sudo chmod 666 /var/run/docker.sock` |
| Valhalla container won't start | `docker logs valhalla-slo`; if graph corrupted, delete `backend/valhalla/custom_files/valhalla_tiles/` and restart |
| Frontend shows dummy Ljubljana hexes | `cell_scores_lite.json` missing from `frontend/public/data/`. Re-run `python backend/etl/03_score_cells.py` |
| Občine show no fill | `obcine_scored.geojson` missing. Same fix as above |
| Lag during pan at res-10 | check that `pickable: false` + `stroked: false` are active for `currentRes ≥ 9` (Map.tsx) |
| Hex click does nothing at street zoom | by design (C2 will re-enable click-only picking); use Občina view for now |
| ARSO WFS returns `<ows:Exception>` | Single-quote the URL, one line. See `DATA_SOURCES.md` |
| Photon mangles SI addresses | Fall back to Mapbox geocoder (free tier, needs signup) |

---

## 8. One reminder

Mode A polish (Phase C, D) is worth more than any new mode. A single emotional flow — "type your address → see your score → see the 15-min walking polygon" — is the demo moment. Everything in Phase E, G is supporting cast. If forced to cut, kill stretch items, not Phase C polish.
