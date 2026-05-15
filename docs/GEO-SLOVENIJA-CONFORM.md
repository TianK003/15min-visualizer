# GEO Slovenija 2026 — Conformance Report & Winning Playbook

> Prepared 2026-05-13 from 15 parallel research passes (13 person profiles + project scoring + tactical generation). Cross-references `PLAN.md`. Read both before the build window.

---

## 1. TL;DR

**Verdict:** top-3 contender, **not the favorite as of today**. The engineering and the honest "82% of cells are red" data story are prize-grade; the medal is gated on (a) shipping Phase C (Mode A demo flow) in 48 hours, (b) fixing the thin Pillar 3 (environment), and (c) ticking INSPIRE/ISO/transparency boxes most teams will skip.

**Three moves to do first (tonight, before any feature work):**

1. **Rehearse 3 hero addresses with offline cache.** Single biggest swing factor between win and loss is whether the live demo holds for 90 s. Hard-cache scorecards + Valhalla polygons for Prešernov trg (8/8), a Maribor suburb (4/8), an alpine village (1/8). `?demo=1` flag bypasses network.
2. **Cold-open with "82% rdečih celic" stat.** Zero engineering cost; reframes the project from "another map" to "a verdict on Slovenian spatial policy."
3. **Build a `Izvor podatkov` data-provenance panel.** Cheapest high-leverage move that hits four izhodišča in one (INSPIRE, ISO, transparency, reproducibility). ~2 hours.

Detailed scoring in §2, tactical playbook in §3, mentor intelligence in §4, PLAN.md critique in §5.

---

## 2. Conformance scoring

### 2.1 Thematic pillars (1–10)

| Pillar | Score | Justification |
|---|---|---|
| 1 · Pametno upravljanje prostora | **9/10** | Modes B (Investitor) + C (Občina) and per-občina aggregation map directly onto smart spatial management. Ghosts overlay is a planning-decision tool. |
| 2 · Vizualizacija in dostopnost | **8/10** | Interactive multi-resolution H3 map, scorecard, SL-language UX serves non-experts. Loses points for no 3D/4D/AR/VR (ghosts extrusion is the only 3D nod, and is post-MVP). |
| 3 · Okolje in trajnostni razvoj | **5/10** | 15-min city → reduced car-km is real environmental contribution; protected-area suppression respects ecology. But no flood-risk, no urban-heat-island, no forest monitoring. The CO₂ argument is a slide, not a feature. |
| 4 · Pametna mobilnost in infrastruktura | **7/10** | Walking + biking isochrones, transit-stop proximity, live Valhalla. Loses points: `promet` is a point-amenity proxy with no transit routing or schedule data. |
| **Overall coverage** | **8/10** | Hits all four pillars credibly; one (P3) is thin. The brief explicitly rewards covering "at least one", so 3.5/4 is a strength. |

### 2.2 Izhodišča checklist (#1–10)

| # | Criterion | Status | Note |
|---|---|---|---|
| 1 | EU data usage | partial | OSM/Geofabrik + Kontur (HDX) used; no Copernicus/Eurostat layer. |
| 2 | GURS data usage | pass | GURS občine in production; ARSO WFS for protected areas. |
| 3 | INSPIRE / ISO interoperability | **partial — fixable** | Inputs are open standards; no explicit INSPIRE conformance or metadata export. **Tactical move #4** closes this. |
| 4 | Transparency | pass | Open scoring formula (binary 0–8), public repo Apache 2.0, honest score distribution. |
| 5 | Reproducibility | pass | ETL scripts 01–04, deterministic, resumable, ~1.3 min full bake; `DATA_SOURCES.md` with curl commands. |
| 6 | End-user usefulness | pass | Three real audiences (citizen / investor / planner). |
| 7 | Geographic dimension | pass | National coverage at res-10 (~66 m, ~1.08M cells), 212 občine. |
| 8 | Open source | pass | Apache 2.0 from day 1; open stack throughout. |
| 9 | GDPR | pass | No PII; address search client-side via public Photon; LLM key server-only. **Tactical move #10** makes this *visible*. |
| 10 | Feasibility | **partial — risk** | ETL proven; Supabase, Railway, Vercel still unprovisioned per TASKS §A1–A5. Deployment is the biggest open risk. |

### 2.3 Judging criteria (1–10)

| Criterion | Score | Why |
|---|---|---|
| Inovativnost | 7/10 | H3 + inverted isochrone precompute trick is genuinely clever; 15-min city concept itself is known (Moreno, MIT, Sony CSL). Differentiation comes from national coverage + LLM narrative in Slovenian + planned ghosts, not the core idea. |
| Uporabnost | 9/10 | Three concrete roles, scorecard, search, walk/bike toggle, route-to-amenity, investor demand projection. Strongest dimension. |
| Tehnična izvedba | 8/10 | Real numbers: 37,622 amenities → 112,866 isochrones in 1.3 min, 1.08M scored cells in 30 s. Loses points: Supabase/Railway not deployed; F1 partial loading not done. Production stack is plan, not running. |
| Kakovost predstavitve | 7/10 | Demo narrative is rehearsed in PLAN §9; single-point-of-failure plan exists. But Mode A is still TODO — on current state ("static map + obcina layer") there is no jury-touchable moment. |
| Potencial za razvoj | 9/10 | SLO4D path on roadmap; biking accuracy, real PIS ghosts, narrative LLM expansion all sketched; open-source lowers občina adoption friction. Genuine post-hackathon path. |

### 2.4 Top 3 strengths

1. **Honest, national-scale, reproducible dataset.** 1.08M H3 res-10 cells with 82% red distribution is uncomfortable truth — exactly the kind of evidence-based finding that jury rewards over demo charm. Reproducible in ~2 minutes from raw OSM.
2. **The precompute architecture is genuinely good.** Inverting amenities→isochrones turned an 8M-query problem into 1.3 minutes; client-side `cellToParent` removed the multi-resolution tile pyramid entirely. GIS-savvy judges (Mongus, Mangafič) will notice.
3. **Three audiences, one map.** Citizen / Investor / Planner maps onto občine + ministrstvo + razvijalec as real post-hackathon customers.

### 2.5 Top 3 gaps

1. **Nothing the jury can touch yet.** Mode A (the hero demo) — address search, scorecard, amenity pins, live isochrone — is entirely in Phase C **TODO**. 48 hours to build C1–C5 + A1–A5 + D1 polish is aggressive. If Day 2 slips, you arrive with a colored map and no story moment. **Risk: highest.**
2. **Pillar 3 (environment) is rhetorical.** The CO₂ slide is one IPCC link. No flood-risk, no heat-island, no forest-cover, no air-quality, no DEM-based slope layer — and Slovenia's geoportals offer all of these. Adding even one cheap environmental overlay (Atlas okolja flood map is already listed in `DATA_SOURCES.md` Tier 2) would lift Pillar 3 from 5 → 8 with half a day of work.
3. **No INSPIRE/ISO posture.** Criterion #3 is in the brief and the project doesn't address it. No metadata export (ISO 19115), no OGC API Features endpoint, no STAC catalog — small additions (a `metadata.xml` per dataset, a `/api/features` route via PostGIS) would tick the box. As-is, half-credit from a judge looking for it.

---

## 3. Tactical playbook — 15 winning moves

Numbered. Effort tag (S/M/L). Strengthens column ties to a judging criterion or pillar. Top-3 do-firsts are repeated from §1.

### 3.1 Narrative & framing

**#1 · Cold-open with the "82% rdečih celic" shock statistic.** *(Effort: S · Strengthens: innovation, usefulness, presentation)*
- Demo slide 1: one number, black bg, white type. Scripted line: *"To ni napaka v podatkih. To je politika prostora."*
- Add as fixed pill on landing: "82% rdečih celic. Tukaj je dokaz."

**#15 · End with the SLO4D bridge slide.** *(S · Strengthens: development potential)*
- Final slide: "Kaj prinese SLO4D 9. junija" — 3 bullets: real PIS-scraped ghosts for 212 občine, planner-mode API, biking with real Valhalla bicycle costing.
- Closing line: *"Hackathon je prototip. SLO4D je launch."*

### 3.2 Demo robustness

**#2 · Hero address dress rehearsal with offline cache.** *(S · Strengthens: technical execution, presentation)*
- Hard-cache scorecards + amenity pins + Valhalla polygons for Prešernov trg (8/8), a Maribor suburb (4/8), Bohinj village (1/8) as JSON in `frontend/public/data/demo_cache/`.
- `?demo=1` flag pre-loads them and disables network calls.
- Rehearse the 30-second flow per address; time it.

**#13 · 60-second backup demo video.** *(S · Strengthens: risk mitigation)*
- Record canonical flow with SL voiceover end of Day 1.
- 1080p MP4 on USB + unlisted YouTube link.
- Fallback line: *"Zaradi internetnih težav predvajamo posnetek — koda teče lokalno na tem laptopu."*

### 3.3 Interactivity & wow

**#3 · "Slovenija na prvi pogled" intro animation.** *(S · Strengthens: visualization pillar, presentation)*
- On first load, animate `viewState` from zoom 5 → 14 over 4 s. Hexes fade from 450 chunky regions → 22k city blocks → 1M house-clusters.
- Overlay text during animation: *"1 zemljevid. 1,08 milijona celic. 8 vsakdanjih potreb."*

**#5 · Side-by-side address comparison.** *(M · Strengthens: innovation, usefulness)*
- "+ primerjaj" button next to address bar.
- Split scorecards, dual isochrones in different cyan/magenta, diff badge (*"+3 storitve, –1 zelena površina"*).
- No team will replicate this; ~2 h work on top of C2.

**#7 · Pre-baked LLM narrative ticker.** *(M · Strengthens: innovation, development potential)*
- Pre-generate Kimi narratives for 50 hand-picked cells; store in `cell_narratives` or static JSON.
- Left-side landing-page ticker "Iz življenja celic" rotates 3 narratives every 8 s, each with "Pojdi tja →" button.
- Live generation still fires for clicked cells; the ticker guarantees the feature is visible even on a slow Kimi API.

**#8 · One flagship ghost building moment.** *(M · Strengthens: innovation, pillar 1)*
- Pick ONE polygon — e.g. planned residential block in BTC/Brdo Ljubljana. Author it carefully with floor count + amenity type.
- Top-bar toggle "2026 / 2030" fades ghost in, re-colors affected cells with delta, shows card *"+1.2 povprečna ocena za 1,847 prebivalcev v 15-min radiju."*
- Rehearse as a separate 20-second beat.

### 3.4 Technical credibility

**#4 · `Izvor podatkov` data-provenance panel.** *(S · Strengthens: INSPIRE/ISO, transparency, reproducibility)*
- Footer link → modal listing each layer: source, license, version, ingestion date, row count.
  *Example row:* "GURS RPE občine · CC-BY 4.0 · prevzeto 2026-05-12 · 212 polygonov".
- Include H3 res, isochrone bake params, Valhalla profile version, OSM PBF date.
- Link to public GitHub repo + commit SHA per artifact.

**#9 · Public reproducibility checklist in README.** *(S · Strengthens: reproducibility, open-source)*
- Section "Reproduciraj rezultate v 30 minutah" with exact `docker run valhalla` + `python 01..03` + `pnpm dev` sequence.
- Include observed runtimes ("02_isochrones.py ≈ 1.3 min").
- Pin OSM PBF date + Valhalla image SHA so anyone can match the bake exactly.

**#12 · Wire one GURS-deep dataset beyond občine.** *(M · Strengthens: GURS izhodišče, usefulness)*
- Add GURS hišne številke as a fallback when Photon mangles SI input (known risk per PLAN §8).
- Cite the GURS OGC API Features endpoint by name in the provenance modal.
- Slide line: *"Vir naslovov: GURS RPE — uradni register Republike Slovenije."*

### 3.5 Accessibility & trust

**#10 · GDPR one-liner everywhere.** *(S · Strengthens: GDPR, trust)*
- Below address bar: *"Naslov se ne hrani. Vsa obdelava poteka v vašem brskalniku."* with `(i)` tooltip.
- Scorecard badge *"Vaši podatki ne zapuščajo brskalnika"*.
- Scrub server logs for address terms.

**#14 · Color-blind safe palette toggle.** *(S · Strengthens: accessibility, visualization)*
- Settings toggle "Barvno-slepa paleta" → swap to ColorBrewer blue-yellow-purple ramp.
- Test default red-orange-yellow-green with [coblis](https://www.color-blindness.com/coblis-color-blindness-simulator/) and adjust hues so green vs orange separate under deuteranopia.

### 3.6 Domain depth

**#6 · "Rezultat občine" leaderboard with named winners/losers.** *(M · Strengthens: usefulness, pillar 1)*
- Even if E2 (full Mode C) slips, ship the sortable table as a standalone page.
- Three highlight cards above the table: *"Najboljša: Ljubljana · 5,2/8"*, *"Največ priložnosti: Kostel · 0,7/8"*, *"Najhitreje rastoča: Maribor"*.

### 3.7 Mentor relationship

**#11 · Engage one mentor before noon Day 1.** *(S · Strengthens: mentor sponsorship)*
- Open with a real technical question, not a status update: *"Smo uporabili Kontur res-8 razširjen na res-10 otroke — ali to ustreza temu, kako bi Geodetska Uprava agregirala prebivalstvo za analizo storitvenih območij, ali bi morali uporabiti GURS register prebivalstva?"*
- Follow up with a current-state screenshot and ask for one specific critique.
- End of Day 1: 3-sentence update on what you incorporated.

### Top-3 do-first ranking *(repeated from §1)*

1. **#2** — Rehearse hero addresses with offline cache. Demo robustness is the single biggest swing.
2. **#1** — Cold-open with "82% red" stat. Reframes the project for free.
3. **#4** — Data-provenance panel. Four izhodišča in one component.

---

## 4. Mentor & jury intelligence

### 4.1 Cross-cutting themes (what nearly all of them care about)

- **GURS / eProstor data over OSM-only.** Mangafič, Švab Lenarčič, Vrečko, Horvat, Šturm, Petrovič, Požar (inferred) will all ask: *"Have you used the official registers — RPE, register stavb, hišne številke, evidenca dejanske rabe?"* Lift the project from "GIS hack" to "national-data product" by naming them in the provenance modal (move #4).
- **Open-source / FOSS4G credibility.** Mangafič (OSGeo SI board), Šturm (QGIS plugin author), Mongus (academic) lean strongly here. Mention QGIS-loadable GeoPackage export of hex scores as a deliberate output.
- **LiDAR / national elevation data.** Žel, Švab Lenarčič, Vrečko, Mongus, Dougan all work on national LiDAR. Showing that Valhalla isochrones respect real terrain (steep ravines, staircases) — not Euclidean buffers — separates you from naive teams.
- **Slovenian coverage beyond Ljubljana.** Mongus has city-scale work on Celje; Šturm works Karst region; Pomurje is Mangafič's PhD turf. Have a non-Ljubljana demo cell loaded.
- **Cartographic rigor.** Petrovič will scrutinize color ramps, legend, MAUP edge effects. Use ColorBrewer-safe ramps and an explicit legend.
- **Honest about uncertainty.** Vrečko's PhD is uncertainty quantification in DTMs. Acknowledging where the dataset is sparse (rural micro-villages, edge cases) signals scientific maturity.

### 4.2 Content mentors (7)

#### dr. Alen Mangafič — **GIS lead, GI Slovenije** · *PhD defense 19 May 2026 (4 days after hackathon!)*
- **Specialty:** Open-source geospatial + ML on hyperspectral / SAR / LiDAR. PostGIS, QGIS, GRASS, Python power user. OSGeo SI board secretary.
- **Key work:** PhD on hyperspectral ML for heavy-metal soil contamination near Celje (Remote Sensing MDPI 2025); co-led national QGIS/LiDAR training; GRASS addon `i.hyper`.
- **Resonance:** He is the FOSS4G purist on the panel. The H3 + Valhalla + PostGIS + MapLibre/deck.gl stack is exactly what he champions.
- **How to impress:**
  1. Show the PostGIS schema + H3 indexing strategy + query-latency numbers — engineering rigor, not slideware.
  2. Mention OSGeo tooling explicitly (QGIS validation, GDAL, no proprietary lock-in); offer to publish the dataset openly.
  3. Have a planner-mode demo loaded with **Celje** (his PhD turf) + Natura 2000 overlay running live on his laptop.
- **Pronounce:** AH-len MAHN-gah-fitch.

#### Aljaž Žel — *(inferred: UM FERI LiDAR group, Žalik/Mongus lab)*
- **Specialty (inferred):** LiDAR point-cloud processing, 3D reconstruction, image-to-point-cloud fusion.
- **Key work:** IEEE 2020 on image projection onto LiDAR surfaces; 2024 ICP-based colorization of wall paintings; part of UM FERI's airborne-LiDAR DTM filtering toolchain.
- **Resonance:** His group built the algorithms that process Slovenia's national LiDAR — the upstream layer feeding our population/building inputs.
- **How to impress:**
  1. Show an H3 cell drilldown that visibly bends around a steep ravine or staircase — prove Valhalla isochrones use real elevation.
  2. Ask his opinion on res-10 vs res-9 for terrain-aware walkability.
  3. Frame planner mode as a downstream consumer of point-cloud-derived building footprints.
- **Pronounce:** AHL-yazh ZHELL.
- **⚠️ Caveat:** identification inferred from strongest academic match; not absolute. Verify on-site.

#### Štefan Horvat — *(unverifiable from public sources)*
- **Likely affiliation:** GURS / MNVP / UL FGG content-mentor cohort.
- **Inferred resonance:** authoritative SI datasets (RPE, register stavb, LIDAR-DMR, GJI).
- **How to impress (generic — pivot live based on intro):**
  1. Cite exact GURS/eProstor layers you ingested with CC-BY attribution.
  2. Validate on at least one Prekmurje/Pomurje občina — regional diversity beyond Ljubljana.
  3. Bring a data-quality slide: coverage gaps, POI freshness.
- **Pronounce:** SHTEH-fahn HOR-vaht.
- **⚠️ Caveat:** could not find substantive info in 8 searches. Ask organizers for his bio or check the venue's mentor wall.

#### dr. Andreja Švab Lenarčič — **Geodetski inštitut Slovenije, Remote Sensing**
- **Specialty:** LiDAR + optical satellite classification, image segmentation, automated building / land-cover detection. Career-long contractor for GURS.
- **Key work:** PhD on LiDAR classification for land cover (UL FGG, 2018); Pomurje research award; co-author on unified physical-environment change detection (Geodetski vestnik 2017).
- **Resonance:** Her career is turning national-scale raster/LiDAR data into vector layers — the exact upstream pipeline feeding our hex grid.
- **How to impress:**
  1. Name GURS/eProstor layers (DOF, LiDAR-DMR, registered buildings) you used to seed populated hexes, not just OSM.
  2. Speak the resolution tradeoff honestly: res-10 (~66 m) vs the ~0.5 m DOF / 1 m LiDAR she works at.
  3. Have a change-detection answer: how would the score update when a new building appears in next year's ortofoto pass?
- **Pronounce:** AHN-dre-yah SHVAHB le-NAR-chich.

#### Nejc Dougan — **Founder & CTO, Flai · PhD candidate UL FGG/FRI**
- **Specialty:** AI-powered geospatial automation, deep learning on LiDAR. xyHt's "24 Young Geospatial Professionals to Watch 2024".
- **Key work:** Flai SaaS (AI auto-classification of LiDAR); Geo Week & GEO Business speaker; PhD on CNNs for aerial laser scanning.
- **Resonance:** Lives at the intersection of geodesy rigor + modern engineering — exactly our stack. Will care about classification correctness + scaling to 1M cells.
- **How to impress:**
  1. Walk through the ETL/Valhalla pipeline and the res-10 choice (edge length vs compute tradeoff) — he respects engineering discipline.
  2. Demo deck.gl H3HexagonLayer perf on full 1.08M cells — frame rates, Supabase query latency.
  3. Mention LiDAR-derived inputs (DMR/DOF from eVode/ARSO); even better: fuse a LiDAR-derived "walkability" signal (slope, sidewalk presence).
  4. Be precise about LLM narrative grounding — no hallucinated POIs.
- **Pronounce:** "Neyts DOO-gan".

#### dr. Tomaž Šturm — **Founder, Spatial Mind · Gozdarski inštitut Slovenije collaborator**
- **Specialty:** GIS spatial modeling for forest fire risk + nature conservation. Open-source / QGIS bent. PhD UL FGG 2013.
- **Key work:** Operates Slovenia's Canadian Fire Weather Index system (zdravgozd.si); GWR forest-fire probability model for Karst; **QNarcIS — QGIS plugin unifying Natura 2000 + protected areas in one workflow.**
- **Resonance:** Thinks in our exact terms — gridded indicators over SI, Natura 2000 / zavarovana območja, FOSS web GIS.
- **How to impress:**
  1. Show the Natura 2000 / zavarovana območja overlay EARLY in the demo; explain walkability ↔ conservation interaction.
  2. Speak open-source: QGIS-loadable GeoPackage export of hex scores; "QNarcIS-style" single-plugin for občina planners.
  3. Frame methodology rigorously: isochrone-based accessibility as spatial predictor; mention GWR/regression validation against census or ZRSVN data.
- **Pronounce:** TOH-mahzh SHTOORM.

#### Anja Vrečko — **UL FGG teaching assistant + PhD researcher · GEO8 founder · GeoDev Meetup organizer**
- **Specialty:** Airborne laser scanning, DTMs, **uncertainty quantification** in high-res DTMs. Part of her PhD at KTH Stockholm + IPI Hannover.
- **Key work:** "Power lines from ALS via Hough Transform" (Geodetski vestnik 2015); debris-flow DTM modeling; co-author "Status & quality of topographic data in Slovenia"; co-organizes GeoDev Meetup.
- **Resonance:** Will scrutinize data quality + uncertainty; values clean dev stacks — exactly an H3 + Valhalla + deck.gl niche.
- **How to impress:**
  1. Show how you handle H3 cell uncertainty at population boundaries; isochrone degradation in rural sparse hexes.
  2. Cite authoritative SI sources (RPE/GURS, eProstor, Natura 2000) — she knows them intimately.
  3. Demo deck.gl/MapLibre live; offer to present at a GeoDev Meetup; speak in metric walking-minute terms, not abstract scores.
- **Pronounce:** AHN-yah VRETCH-koh.

### 4.3 Coaching (2)

#### Jan Keber — *(inferred: Dhimahi, Ljubljana — Wayv maritime mobility platform)*
- **Specialty (inferred):** Full-stack web dev (Vue, mobile, IoT). If same person, has shipped a real spatial-mobility product (Wayv passenger transport along SI coast).
- **Resonance:** Hands-on experience shipping a map-based mobility product in SI — directly your genre. Will probe execution + product polish, not academic GIS.
- **How to impress:**
  1. Open with a live MapLibre demo — no slideware. Practitioners respect working software.
  2. Show citizen/investor/planner toggle as ONE cohesive product — "one map, three lenses."
  3. Crisply defend stack choices (Valhalla, H3, Supabase) — be ready for trade-off questions.
- **Pronounce:** YAHN KEH-behr.
- **⚠️ Caveat:** identity not 100% confirmed. Verify when introductions happen.

#### doc. dr. Dušan Petrovič — **UL FGG, Head of Chair for Cartography · Vice-President ICA 2023–2027**
- **Specialty:** Topographic + mountain cartography, map design, 3D visualization, **web/automated cartography**, OSM data quality, web-map usability.
- **Key work:** Mountain Cartography Slovenia; Soča/Isonzo WWI front visualization (Int. J. Cartography 2018); **"Effective Online Mapping and Map Viewer Design for the Senior Population" (Cartographic Journal 2015)** — directly your concern.
- **Resonance:** He will scrutinize the *map itself* — symbolisation, legend, color ramps, hierarchy, whether the 8-category composite reads honestly at multiple scales.
- **How to impress:**
  1. Show a deliberate cartographic design rationale: ColorBrewer-safe ramps, MapLibre zoom-dependent styling, explicit 15-min score legend, Slovenian toponymy/diacritics done right.
  2. Reference SI base data (DTK, GURS); discuss how H3 aggregation handles MAUP/edge effects against real topography (mountains break "walking" isochrones — he will notice).
  3. Frame Natura 2000 overlay as a visual-hierarchy problem (figure/ground, transparency). **Invite his critique on map readability before talking tech.**
- **Pronounce:** DOO-shahn PEH-troh-vich.

### 4.4 Jury (4)

#### Nina Požar — *(unverifiable; almost certainly GURS / SLO4D programme)*
- **Likely affiliation:** "greenslo.gu@gov.si" is the only public link → Green Slovenia / SLO4D office at GURS or MNVP.
- **Likely focus:** institutional / policy — coordinating open spatial data, INSPIRE/SDI alignment, operationalising GURS data for občine + ministries.
- **Resonance:** She'll care most about: (a) actual reuse of official GURS open data, (b) public-value framing for občine + ministries, (c) solutions that *extend* the GEO Slovenija ecosystem rather than build a parallel silo.
- **How to impress (CRITICAL — jury lead):**
  1. Cite GURS datasets by name on screen — RPE, register prostorskih enot, hišne številke, evidenca dejanske rabe — proving you used her institution's data.
  2. Explicitly frame the project as a **SLO4D / Green Slovenia use-case** — citizen-facing layer on top of national SDI, not a competitor.
  3. Demo planner mode first, not the citizen toy — decision-makers buy outcomes for občine.
  4. Show ONE concrete policy lever: *"This hex scores 2/8 — Občina X could add a vrtec here and lift 1,400 residents into the 15-min threshold."* Quantified, actionable, SI place names.
  5. Speak Slovenian for opening + closing 30 s. Mention Natura 2000 overlay as evidence of regulatory awareness.
- **Pronounce:** NEE-nah POH-zhar.
- **⚠️ Caveat:** identity not publicly verifiable. Recommend emailing `greenslo.gu@gov.si` or LinkedIn search from a logged-in account before the pitch.

#### dr. Domen Mongus — **UM FERI, Associate Professor · Head of GeMMA Lab · also opening speaker**
- **Specialty:** Geospatial CS — LiDAR processing, mathematical morphology, computational geometry, urban-scale AI/data fusion. ~2,330 citations, h-index 21.
- **Key work:** Signature paper "Parameter-free ground filtering of LiDAR for DTM" (ISPRS J. 2012, 320 cit.); ISPRS 2014 on differential morphological profiles; lead of PrAEctiCe Horizon Europe project; **Nature Scientific Reports 2025 on retro-reflective facade thermal impact across 914 Celje buildings** — direct city-scale parallel to your work.
- **Resonance:** Cares about turning raw geospatial data into actionable urban decisions — exactly our hex-level scoring. Personally builds city-scale SI analyses fusing 3D + simulation. **Speaker AND jury → highest weight.**
- **How to impress:**
  1. Frame H3 hex grid as a discrete morphological tessellation — speak his mathematical-morphology language.
  2. Show the Valhalla isochrone pipeline as a reproducible algorithm with explicit parameters (no "parameter-free" magic — clearly documented).
  3. Mention Celje or any non-Ljubljana coverage — he works on SI cities beyond the capital.
  4. Be ready to discuss data quality / density assumptions of inputs (GURS, OSM) — he literally wrote papers on point-density evaluation.
- **Pronounce:** DOH-men MOHN-goose.

#### Eva Tisaj Žnidaršič — **Business Analyst at Bankart · DragonHack co-founder**
- **Specialty:** Fintech business analysis + **veteran hackathon organizer**. Her lens is event quality, team execution, turning 24-48h prototypes into credible products — NOT geospatial expertise.
- **Key work:** Co-founded DragonHack — SI's longest-running university hackathon (~150+ students/year, 10+ editions); Bankart payments; promoter of SI hackathon culture.
- **Resonance:** Will judge less on geodesy minutiae, more on whether you SHIPPED a coherent working product. LLM-in-Slovenian narrative + live MapLibre interactivity are exactly her "wow demo" rewards.
- **How to impress:**
  1. Live demo first, slides second — show shipped product.
  2. Mention engineering choices succinctly (Valhalla, H3, Supabase, deck.gl) — clarity, not jargon.
  3. Frame impact in human terms: *"What a parent in Fužine sees vs. what someone in Bežigrad sees."* Story + data = DragonHack winning formula.
- **Pronounce:** EH-vah TEE-sigh ZHNEE-dar-shich.

#### Žan Novšak — *(unverifiable from public sources)*
- **Inferred:** possible FGG diploma 2013 (wastewater Zapuže/Sevnica). FGG-trained civil engineering / geodesy background most likely.
- **How to impress (generic — pivot live):**
  1. Lead with methodological rigor: Valhalla params, H3 resolution choice, population weighting handling.
  2. Demo planner mode with a real Slovenian municipality (Ljubljana or Sevnica — possible biographical hook).
  3. Defend data provenance + ETL reproducibility; show Supabase schema if asked.
- **Pronounce:** ZHAHN NOHV-shahk.
- **⚠️ Caveat:** no substantive professional profile found in 8 searches. Ask organizers for jury bios on-site.

### 4.5 Verification gaps

The team should personally verify these on Day 1 morning (introductions or a quick `gh org bio` check):

| Person | What's unknown | Cheapest way to confirm |
|---|---|---|
| Aljaž Žel | Whether the UM FERI LiDAR-lab match is the right Aljaž Žel | Introduce yourself and ask his field |
| Štefan Horvat | His employer + specialty | Direct intro |
| Jan Keber | Whether Dhimahi/Wayv is the right Jan Keber | LinkedIn check at venue, or intro |
| Nina Požar | Her role at GURS/SLO4D | Email `greenslo.gu@gov.si` or intro |
| Žan Novšak | His specialty | Direct intro |

If you walk in with these confirmed, you can route each demo segment to the right person's strengths.

---

## 5. Cross-reference to PLAN.md

### 5.1 Praise — what PLAN.md got right

- **§0 scope reality check** is honest and pragmatic. The "two things that make this win or lose" formulation (precompute pipeline + one polished emotional flow) is exactly what the conformance analysis confirms.
- **§3 precompute trick** holds up. Inverting amenities→isochrones is the project's strongest engineering bet and lands directly with Mangafič, Mongus, Dougan.
- **§4 scoring formula** is intentionally simple ("5 of 8 daily needs are reachable"). This translates well in a 5-minute pitch and is defensible to non-technical jury (Eva Tisaj).
- **§9 win narrative** opens with the right closing line. Keep it; pair it with tactical move #1's cold-open.

### 5.2 Critique — gaps the conformance research surfaced

| Where in PLAN.md | Critique | Recommendation |
|---|---|---|
| §0 + §9 | "We hit all 4 pillars." Pillar 3 (environment) is rhetorical — one IPCC link, no feature. | Add at least one environmental overlay (Atlas okolja flood map is on disk per `DATA_SOURCES.md` Tier 2). Half-day of work lifts Pillar 3 from 5 → 8. |
| §1, §3, §3a | The doc references res-9 in some leftover spots even after our 2026-05-13 sweep. (Already mostly fixed.) | Final regex check before submission. |
| §6 modes | Mode A polish prioritized but no offline cache strategy mentioned for the demo. | Add Tactical Move #2 (hero-address cache) as a "demo-readiness" sub-section in §7. |
| §6 / §7 | INSPIRE/ISO/metadata posture isn't addressed. | Add Tactical Move #4 (`Izvor podatkov` panel) as a §6 cross-cutting overlay item. Single component, four izhodišča. |
| §8 risks | Slovenian-specific risk: address geocoding accuracy. | Add Tactical Move #12 (GURS hišne številke fallback) to risk-mitigation table. |
| §9 jury angle | Closing slide is general. | Append: "Hackathon je prototip. SLO4D je launch." (Tactical Move #15). |

### 5.3 Recommendations — what to add to PLAN.md *(implemented as a cross-reference link, not a full rewrite)*

1. **Add a link at the top of PLAN.md** pointing here. *(Done in 5.4 below.)*
2. **Reference this report from §9** ("Why this wins · jury angle") so the team reads both before pitching.
3. **Echo the top-3 do-firsts** into PLAN.md §0 so they don't get lost in the scope-reality bullets.
4. **Stop saying "fully responsive" is stretch** — mobile is a P1 concern per the conformance research (mentors will test on phones).

### 5.4 PLAN.md edit

Two edits being applied in this commit:
- A "Conformance & winning playbook" cross-reference at the top of `PLAN.md`.
- A note in `§9 Why this wins (jury angle)` linking here.

No other PLAN.md surgery — this report carries the conformance critique so PLAN stays clean.

---

## 6. Sources

Per-person source URLs are in the agent transcripts; the most consulted hubs were:

- **University of Ljubljana FGG** — https://www.fgg.uni-lj.si/
- **Geodetski inštitut Slovenije** — https://www.gis.si/
- **GURS** — https://www.gov.si/en/state-authorities/bodies-within-ministries/surveying-and-mapping-authority/
- **UM FERI** — https://feri.um.si/
- **Geodetski vestnik** — https://www.geodetski-vestnik.com/
- **GeoDev Meetup Slovenia** — community calendar
- **Google Scholar, ResearchGate, LinkedIn, COBISS** — per individual

This report was compiled from 15 parallel research passes on 2026-05-13. Verification gaps in §4.5 are honest and should be closed during Day 1 introductions, not extrapolated further from public web sources.
