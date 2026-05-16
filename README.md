# 15min Slovenija

> **Team GEOGuessr** · Built at [GEO Slovenija](https://www.geo-slovenija.si) Hackathon (May 15–16, 2026)

<<<<<<< HEAD
The "15-minute city" concept promises that every resident can reach daily essentials — groceries, healthcare, schools, transit, parks — within a 15-minute walk. But nobody had measured this for an entire country, at house-block resolution, using real road-network routing. Until now.

15min Slovenija scores **every populated point in Slovenia** from 0 to 8 across eight daily-needs categories, using real walking and cycling isochrones computed over the entire OpenStreetMap road graph. The result: a single interactive map that answers "How livable is this exact spot?" for 1.08 million H3 hexagonal cells at ~66 m resolution.

We processed **37,622 amenities × 3 isochrone contours = 112,866 walking polygons** via a local Valhalla routing engine in under 2 minutes, then spatial-joined them against the Kontur population grid to produce a per-cell livability score — all during a 24-hour hackathon. The precomputed dataset ships as a single ~3 MB gzipped JSON; the browser aggregates it client-side across zoom levels via `h3-js cellToParent` with zero server roundtrips.

Our demo shows:
- **Ljubljana center** → 8/8 (all daily needs within 15 min walk)
- **Maribor suburbs** → 5/8 (missing niche services and workplaces)
- **Alpine village in Bohinj** → 1/8 (only a bus stop nearby)
- **Investor mode** → flips the map to show unmet demand: `population × (1 − already_served)`, revealing exactly where new facilities would have the most impact

The platform includes an **AI-powered natural-language search** (OpenRouter LLM): describe your life situation in Slovenian — *"sva mlada družina, delava v Ljubljani"* — and the system extracts required categories, finds the best-scoring cells near your target city, and flies the map there. Built on Supabase Postgres + PostGIS with auto-generated REST APIs, live Swagger UI documentation, and full data provenance for every layer.

This isn't a mockup. Every hexagon is backed by real isochrone geometry, real population data, and real amenity locations — fully reproducible from open data.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Quick Start (6 steps)](#quick-start-6-steps)
  - [Detailed Setup (WSL2 on Windows)](#detailed-setup-wsl2-on-windows)
- [ETL Pipeline](#etl-pipeline)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [Daily Development Workflow](#daily-development-workflow)
- [Troubleshooting](#troubleshooting)
- [Data Sources](#data-sources)
- [License](#license)
=======
Aplikacija na zemljevidu pokaže, kje v Sloveniji lahko vsakdanje obveznosti — od trgovine in šole do zdravnika, parka ali postaje — opraviš peš ali s kolesom v 15 minutah, in kje za to še manjka vsebin. Pokrije celotno državo z drobno mrežo (vsako polje je veliko približno hišni blok) in vsak del oceni od 0 do 8 glede na to, koliko od osmih kategorij dnevnih dobrin je iz njega dosegljivih v tem času.

Aplikacija je razvita za hackathon **GEO Slovenija** (15.–16. maj 2026), z dodelavo do **SLO4D** (9. junij 2026).

---

## 🇸🇮 Zakaj 15min Slovenija

**Problem.** O »15-minutnih soseskah« in kakovosti življenja v slovenskih krajih se veliko piše in govori, vendar redko na konkretnih podatkih. Razprava ostaja teoretična: nikjer ni karte, ki bi pokazala, kje so dnevne potrebe v resnici blizu in kje daleč. Občine, investitorji in posamezniki tako odločitve o lokacijah, gradnji in selitvi sprejemajo bolj na občutek kot na karti, ki bi v resnici prikazala dnevno dosegljivost.

**Rešitev.** 15min Slovenija združi javno dostopne vire (OSM, GURS, ARSO, eProstor, CRP, Kontur) v en sam interaktiven zemljevid, ki je razumljiv tudi brez tehničnega znanja. Vsako polje (~66 m) je ocenjeno od 0 do 8 glede na to, koliko od osmih kategorij dnevnih dobrin (trgovina, izobraževanje, zdravstvo, park, javni promet, šport, storitve, delo) je iz njega dosegljivih v 15 minutah hoje ali kolesarjenja. Aplikacija ima dva pogleda — **potrošniški** (»kje bi mi bilo dobro živeti?«) in **investitorski** (»kje bi nova trgovina, vrtec ali ambulanta največ pomenili?«) — in **AI svetovalca**, ki vsakdanji opis življenjske situacije prevede v iskanje po zemljevidu.

**Zakaj smo začeli.** Vsi podatki, ki so za tako analizo potrebni, so že javni — manjkala je le karta, ki bi jih sestavila v sliko, ki jo razume tudi nekdo, ki ne dela z GIS-orodji. Aplikacija je nastala kot konkretna podlaga za pogovor o tem, kje v Sloveniji se da kakovostno živeti brez avtomobila in kam bi se splačalo umestiti naslednjo storitev — bodisi za stanovalca, ki išče dom, bodisi za podjetje ali občino, ki išče lokacijo z največjim učinkom.

---

## ✨ Implementirane funkcionalnosti

### Pogled zemljevida

- **Dva pogleda zemljevida** *(preklop zgoraj na sredini)*:
  - **Potrošnik** — vsako polje obarvano po 0–8 oceni dostopnosti (zelena 6–8 → rdeča 0–1).
  - **Investitor** — vsako polje obarvano po nezadovoljenem povpraševanju `prebivalstvo × (1 − že pokrito) / št. celic`, da poudari predele s prebivalstvom, kjer dobrin še ni dovolj.
- **Preklop hoja / kolo** *(spodaj desno)* — vsi izračuni (ocena, izokron, dosegljive dobrine, animirane poti) se preusmerijo na pravi Valhalla profil (`pedestrian` 4 km/h ali `bicycle` 13 km/h, profil Hybrid).
- **Zoom-občutljiva agregacija** — pri oddaljenem pogledu se mreža zlije v občine; ob približanju se razrahlja v vse manjše H3 šesterokotnike (resolucija 6 → 10) brez dodatnega nalaganja. Spodnji prag samodejno preklopi na občinske poligone.
- **Trajni linki** — vsak premik, zoom ali klik zapiše `#lng/lat/z/h3` v URL. Deljenje linka pripelje prejemnika na natanko isti pogled.

### Iskanje in informacije o lokaciji

- **Iskalnik naslovov** *(zgoraj na sredini)* — Photon kot primarni geocoder, Nominatim kot rezerva. Omejeno na slovenski bbox, najmanj 5 znakov; podpira tudi prilepljen `lat,lng`. Izbira rezultata zapelje zemljevid in odpre Scorecard.
- **Scorecard celice** — ob kliku se na levi prikaže kartica z 0–8 oceno (barvni »badge«), časom dosega po vsaki kategoriji, razširljivim seznamom najbližjih dobrin (z imenom in časom v minutah) ter gumbom za prikaz 15-minutne izokrone v živo iz Valhalle.
- **Animirane poti** — klik na vrstico kategorije v Scorecardu nariše časovno animirane poti do vseh dosegljivih dobrin v barvi te kategorije, s svetlobnim učinkom na čelu poti. Hitrost se prilagaja razdalji.
- **Kartica občine** — pri oddaljenem pogledu klik na občino odpre kartico s povprečno oceno občine, prebivalstvom, gostoto in razčlenjenim deležem zadetih kategorij.

### AI svetovalec

- **Klepetalnik** *(okrogel gumb spodaj desno)* — odprt pogovor v slovenščini z LLM modelom (Vercel AI SDK + OpenRouter, `minimax/minimax-m2.7`). Iz opisa življenjske situacije (»sva mlada družina, delava v Ljubljani in Mariboru«) zgradi strukturirano poizvedbo (`SearchSpec`): zahtevane kategorije, ciljno mesto in uteži rangiranja.
- **Kartica AI zadetkov** *(zgoraj desno)* — prikaže do 5 najboljših celic z rangiranjem, povzetkom uporabljenega filtra, oceno po kategorijah in gumbom za priblićanje. Pini ostanejo na zemljevidu, dokler kartica ni zaprta.
- **Geokodiranje cilja** — če LLM razpozna ciljno mesto (npr. »blizu Ljubljane«), ga Photon prevede v koordinate, ki gredo neposredno v RPC `search_cells_v2` kot vir rangiranja po bližini.

### Investitorski pogled

- **Filter po kategoriji** *(leva stranska kolonska menija)* — preklop med osmimi kategorijami pokaže povpraševanje samo za izbrano dobrino (npr. »kje manjka vrtcev?«).
- **Pred-izračunani predlogi gradnje** — pini na konkretnih parcelah, kjer bi nova storitev najbolj pomenila. Pini se obarvajo po demografskem profilu okolice: kategorija zdravstva poudari delež prebivalstva 65+, kategorija izobraževanja delež otrok 0–14.
- **Izvzemanje neprimernih območij** — ARSO zavarovana območja in degradirana zemljišča (CRP) se na zemljevidu odštejejo, da priporočila padejo le na realno gradljive parcele iz eProstor.

### Vidnost in nastavitve

- **Svetla / temna tema** — gumb v levem spodnjem kotu. Zaradi čitljivosti napisov se aplikacija ob vsakem zagonu zažene v svetli temi.
- **Zložljiva legenda** *(zgoraj desno)* — prilagojena trenutnemu pogledu (lestvica ocen 0–8 v potrošniškem, stopnje povpraševanja v investitorskem).
- **Banner za nalaganje** in **opozorilo** za primer, ko strežnik ni dosegljiv (frontend tedaj prikaže vzorčne celice z jasnim obvestilom).

### Preglednost podatkov in API

- **Panel »Izvor podatkov«** — vsi viri (OSM, GURS, ARSO Zavarovana območja, Degradirana območja iz CRP, Predlogi za nove storitve iz eProstor, Kontur Population, OpenFreeMap) s številom enot, licencami, kratko utemeljitvijo in povezavo na izvirnik. Vključuje povezavo do celotne izvorne kode na GitHubu.
- **Privacy badge** — »Naslov se ne hrani. Obdelava poteka v vašem brskalniku.« Iskanje po naslovu nikoli ne gre čez naš strežnik.
- **REST API dokumentacija** *(`/api-docs`)* — Swagger UI s tabbed pogledom: ročno vzdrževan OpenAPI 3.1 (`/openapi.json`), ki pokriva Next.js poti (`/api/llm`, `/api/llm-search`, `/api/valhalla/{endpoint}`) in ključne Supabase poti (tabele `cell_scores`, `obcine`, `amenities`; RPC `amenities_for_point`, `llm_search_cells`, `search_cells_v2`), poleg žive Supabase PostgREST sheme za potrditev v živo.

### Arhitektura v eni sliki

Dve fazi, namerno ločeni:

1. **ETL / pred-izračun** *(Python, lokalno)* — OSM dobrine → 112 866 pedestrian izokron preko lokalnega Valhalla → prostorski sjoin s populiranimi Kontur celicami (res-10) → `cell_scores_lite.json` (`{h3, score}`) in `cell_population_lite.json` (`{h3, pop}`, agregirano na res-9). Oba fajla se priložita kot statične datoteke v `frontend/public/data/`.
2. **Živo izvajanje** *(brskalnik)* — Next.js enkrat naloži obe JSON datoteki in nato `h3-js cellToParent` agregira po zoomu na strani odjemalca. Ni piramide tile-ov, ni round-tripa za spremembo resolucije. Edina prava »živa« infrastruktura je Valhalla za izokrone in poti, Supabase za podrobnosti Scorecarda in OpenRouter za AI iskanje.
>>>>>>> 7461a288ada4742f8f66ffa6ab6c952e72075f24

---

## Features

### Citizen View ("Potrošnik")
- **Address search** — Photon (primary) + Nominatim (fallback) geocoder, scoped to Slovenia
- **Scorecard** — click any hexagonal cell to see its 0–8 livability score with per-category breakdown and travel times
- **Amenity pins** — category-colored markers for every reachable amenity, with walking/cycling time badges
- **Live isochrone overlay** — real-time 15-minute walking/cycling polygon via Valhalla, rendered as a translucent overlay
- **Walk / Bike toggle** — switches the entire view (score, travel times, isochrone, route animations) between pedestrian and bicycle profiles
- **Animated route paths** — click a scorecard category row to see animated paths to every reachable amenity in that category, with a glow effect at the path head

### Investor View ("Investitor")
- **Demand heatmap** — `population × (1 − category_satisfied)` reveals underserved areas
- **Category filter pills** — filter by any of 8 categories to find specific gaps (e.g., "Where do people need a pharmacy?")
- **Facility suggestion pins** — pre-computed optimal placement suggestions with rationale tooltips
- **Unpopulated masking** — forests, mountains, and lakes synthesized client-side from municipality polygons
- **Color-blind-safe palette** — 4-step viridis with dark-purple "negligible" zone for fully served cells

### Cross-Cutting
- **Client-side multi-scale aggregation** — 1.08M cells at res-10, aggregated to ~450 hexes at country zoom via `h3.cellToParent()` in <5 ms
- **Municipality choropleth** — low-zoom view colors 212 občine by mean score with population stats on hover
- **Light / dark theme** — toggle in the bottom-left corner
- **Permalink URLs** — every map state (`#lng/lat/zoom/h3`) is encoded in the URL for sharing
- **AI assistant** — natural-language search powered by OpenRouter LLM
- **Data provenance panel** ("Izvor podatkov") — every dataset listed with source, license, count, and explanation
- **REST API + Swagger UI** — auto-generated OpenAPI docs at `/api-docs`

---

## Architecture

The system is split into two deliberately decoupled phases:

```mermaid
flowchart TB
  subgraph ETL["Phase 1 · ETL / Precompute (Python, runs once)"]
    direction LR
    OSM[Geofabrik OSM PBF] --> PY[Python ETL · GeoPandas + H3]
    ARSO[ARSO Protected Areas] --> PY
    GURS[GURS Municipality GeoJSON] --> PY
    KON[Kontur Population H3] --> PY
    PY --> VAL[Valhalla Docker · isochrones]
    VAL --> SJ[Spatial Join · score per cell]
    SJ --> DB[(Supabase Postgres + PostGIS)]
    SJ --> JSON["cell_scores_lite.json<br/>+ cell_population_lite.json"]
  end

  subgraph LIVE["Phase 2 · Live Runtime (Browser)"]
    direction LR
    USER[User Browser] --> NX[Next.js 14]
    NX --> MAP[OpenFreeMap Basemap]
    NX --> CELL["Static JSON<br/>~3 MB · client aggregation"]
    NX --> SB[Supabase REST<br/>scorecard + amenities]
    NX --> PH[Photon Geocoder]
    NX --> VH[Valhalla<br/>live isochrone on click]
  end

  JSON -.serves.-> CELL
  DB -.RPC.-> SB
```

**Phase 1 (ETL):** Extract amenities from OSM → compute 112,866 isochrones via Valhalla → spatial-join against 1.08M populated H3 cells → export scores as static JSON + upload to Supabase.

**Phase 2 (Runtime):** Next.js loads the score JSON once on page load. All zoom-level changes are handled client-side via `h3.cellToParent()` aggregation — no tile server, no resolution-change roundtrips. The only live infrastructure is Valhalla (for on-click isochrones) and Supabase (for scorecard details and amenity pins).

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **Next.js 14** (App Router) | Server-side rendering, API routes, static asset serving |
| **MapLibre GL JS** | WebGL map rendering with OpenFreeMap vector tiles |
| **deck.gl** | `H3HexagonLayer` for hexagonal heatmaps, `PathLayer` for animated routes, `PolygonLayer` for isochrone overlays |
| **h3-js** | Client-side H3 cell aggregation across zoom levels |
| **Supabase JS** | Database queries for scorecard data and amenity details |
| **Zod** | Runtime schema validation for API payloads |
| **TypeScript** | Type safety across the frontend codebase |

### Backend
| Technology | Purpose |
|---|---|
| **Python 3.12** | ETL pipeline orchestration |
| **GeoPandas + Shapely** | Geospatial data processing and spatial joins |
| **Valhalla** (Docker) | Walking and cycling isochrone computation over OSM road network |
| **Supabase** (Postgres 16 + PostGIS 3.4) | Database with spatial indexing, auto-generated REST API, and RLS |
| **H3** (Python + PostgreSQL extension) | Hexagonal spatial indexing at resolution 10 |
| **OpenRouter** | LLM API for AI-powered natural-language location search |

### External Services
| Service | Role | Cost |
|---|---|---|
| **OpenFreeMap** | Vector tile basemap (positron / dark-matter styles) | Free, no key |
| **Photon** (Komoot) | Address autocomplete geocoder | Free, no key |
| **Nominatim** | Fallback geocoder | Free, rate-limited |

---

## Repository Structure

```
15min-visualizer/
├── frontend/                    # Next.js 14 frontend application
│   ├── app/                     # App Router pages + API routes
│   │   ├── api/llm/             # AI search endpoint (OpenRouter)
│   │   ├── api/valhalla/        # Valhalla proxy (avoids CORS)
│   │   ├── api-docs/            # Swagger UI page
│   │   ├── globals.css          # Design system (CSS custom properties)
│   │   ├── layout.tsx           # Root layout with theme initialization
│   │   └── page.tsx             # Main map page
│   ├── components/              # React components
│   │   ├── Map.tsx              # Core map component (~82 KB, all layers + interactions)
│   │   ├── Scorecard.tsx        # Cell detail panel with per-category breakdown
│   │   ├── AddressSearch.tsx    # Photon/Nominatim geocoder input
│   │   ├── ChatBox.tsx          # AI assistant chat interface
│   │   ├── IzvorPodatkov.tsx    # Data provenance panel
│   │   ├── ObcinaInfoCard.tsx   # Municipality hover info card
│   │   └── ThemeToggle.tsx      # Light/dark theme switcher
│   ├── lib/                     # Shared utilities
│   │   ├── categories.ts        # 8 category definitions (icons, colors, labels)
│   │   ├── supabase.ts          # Supabase client + query helpers
│   │   ├── valhalla.ts          # Valhalla API wrapper
│   │   ├── suggestions.ts       # Investor mode facility suggestion logic
│   │   ├── theme.ts             # Theme management
│   │   └── geo.ts               # Geospatial utilities
│   └── public/data/             # Static JSON datasets
├── backend/
│   ├── etl/                     # Python ETL pipeline (scripts 01–09)
│   ├── valhalla/                # Valhalla Dockerfile + config
│   └── supabase/                # Supabase config + SQL migrations
├── data/
│   ├── 15min-slo/               # Raw data downloads (gitignored)
│   └── DATA_SOURCES.md          # Dataset catalog with download commands
└── docs/                        # Project documentation
    ├── PLAN.md                  # Locked design decisions + scoring formula
    ├── ARCHITECTURE.md          # System architecture reference
    ├── TASKS.md                 # Roadmap with priority tags (P0/P1/P2)
    └── CHECKLIST.md             # Environment provisioning checklist
```

---

## Getting Started

### Prerequisites

- **Docker Desktop** with WSL2 integration enabled
- **Node.js 20+** with **pnpm** (via `corepack enable pnpm`)
- **Python 3.12** with `venv`
- **Supabase CLI**

### Quick Start (6 steps)

```bash
# 1. Clone the repository (inside WSL filesystem, not /mnt/c)
git clone https://github.com/TianK003/15min-visualizer.git ~/15min-visualizer
cd ~/15min-visualizer

# 2. Set up the Python backend
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 3. Install frontend dependencies
cd frontend && pnpm install && cd ..

# 4. Configure environment variables
cp backend/.env.example backend/.env
# Create frontend/.env.local with:
#   NEXT_PUBLIC_SUPABASE_URL=/sb
#   SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<from `supabase status --output env`>
#   NEXT_PUBLIC_USE_REMOTE_DATA=true
#   VALHALLA_URL=http://127.0.0.1:8002

# 5. Start local Supabase + Valhalla
cd backend && supabase start && cd ..
cd backend/valhalla
docker build -t valhalla-slo .
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
cd ../..

# 6. Start the dev server
cd frontend && pnpm dev
# Open http://localhost:3000
```

> **Note:** Raw datasets (OSM, Kontur, GURS, ARSO) are too large for git. Follow [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) for single-command downloads.

### Detailed Setup (WSL2 on Windows)

<details>
<summary>Click to expand full installation guide</summary>

#### 1. Install WSL2 + Ubuntu

In **PowerShell as Administrator**:
```powershell
wsl --install -d Ubuntu
```
Reboot, launch Ubuntu from Start menu, and create a user.

#### 2. Docker Desktop with WSL2

Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/). Enable WSL integration under **Settings → Resources → WSL Integration**.

```bash
docker --version   # verify from WSL terminal
```

#### 3. Development tools (WSL terminal)

```bash
# Build essentials
sudo apt update && sudo apt install -y git curl build-essential

# Node.js 20 LTS + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable pnpm

# Python 3.12
sudo apt install -y python3.12 python3.12-venv python3-pip

# Supabase CLI
mkdir -p ~/.local/bin
curl -sLo /tmp/supabase.tar.gz \
  https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz
tar -xzf /tmp/supabase.tar.gz -C ~/.local/bin/ supabase
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
exec $SHELL

# Verify all tools
git --version && node --version && pnpm --version && python3.12 --version
docker --version && supabase --version
```

#### 4. Clone the repository

```bash
cd ~
git clone https://github.com/TianK003/15min-visualizer.git
cd 15min-visualizer
```

> **Important:** Keep the repo on the WSL filesystem (`~/15min-visualizer`, **not** `/mnt/c/...`). Cross-filesystem I/O is ~10× slower and breaks hot-reload.

#### 5. Download raw data

Follow [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) — each source has a single `curl` command. Expected files:

```
data/15min-slo/slovenia-latest.osm.pbf
data/15min-slo/obcine.geojson
data/15min-slo/zavarovana_si.geojson
data/15min-slo/natura2000_si.geojson
data/15min-slo/kontur_population_SI.gpkg
```

#### 6. Python virtual environment

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

#### 7. Frontend dependencies

```bash
cd frontend && pnpm install && cd ..
```

#### 8. Environment configuration

**`backend/.env`** (copy from example, then fill in Supabase keys after step 9):
```bash
cp backend/.env.example backend/.env
```

**`frontend/.env.local`**:
```env
NEXT_PUBLIC_SUPABASE_URL=/sb
SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste PUBLISHABLE_KEY from supabase status>
NEXT_PUBLIC_USE_REMOTE_DATA=true
VALHALLA_URL=http://127.0.0.1:8002
```

The `/sb` proxy value is intentional — `next.config.mjs` rewrites `/sb/*` requests to `SUPABASE_INTERNAL_URL`, keeping all browser requests same-origin and avoiding WSL2 port-forwarding issues.

#### 9. Start Supabase

```bash
cd backend
supabase start          # first run downloads ~1 GB of Docker images
supabase status --output env
```

Copy `SECRET_KEY` → `backend/.env` as `SUPABASE_SERVICE_KEY`, and `PUBLISHABLE_KEY` → `frontend/.env.local` as `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Migrations in `backend/supabase/migrations/` are applied automatically.

Local endpoints:
- REST API: `http://127.0.0.1:54321`
- Studio (DB UI): `http://127.0.0.1:54323`
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

#### 10. Build and start Valhalla

```bash
cd backend/valhalla
docker build -t valhalla-slo .         # ~10 min, builds the SI routing graph
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
cd ../..
```

Smoke test:
```bash
curl -X POST http://localhost:8002/isochrone \
  -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":46.0512,"lon":14.5061}],"costing":"pedestrian","contours":[{"time":15}],"polygons":true}'
```

#### 11. Run the ETL pipeline

```bash
cd backend
source .venv/bin/activate
python etl/01_extract_amenities.py     # ~30 s — OSM → 37,622 amenities
python etl/02_isochrones.py            # ~1.3 min — 112,866 isochrones (resumable)
python etl/03_score_cells.py           # ~30 s — 1,079,666 H3 cells scored
python etl/05_export_population.py     # ~10 s — population sidecar JSON
python etl/07_bin_cells_to_tiles.py    # ~5 s — partial-load shards
python etl/08_flag_unbuildable.py      # ~20 s — mark protected-area cells
python etl/06_upload_to_supabase.py    # ~30 s — upload all data to local Supabase
cd ..
```

> `06_upload_to_supabase.py` requires `SUPABASE_SERVICE_KEY` in `backend/.env`.

#### 12. Start the dev server

```bash
cd frontend && pnpm dev
```

Open `http://localhost:3000` in your Windows browser.

</details>

---

## ETL Pipeline

The ETL pipeline transforms raw open data into the scored hexagonal grid. Each script is idempotent and can be re-run independently.

| Script | Input | Output | Runtime |
|---|---|---|---|
| `01_extract_amenities.py` | OSM PBF | 37,622 classified amenities in 8 categories | ~30 s |
| `02_isochrones.py` | Amenities + Valhalla | 112,866 isochrone polygons (5/10/15 min) | ~1.3 min |
| `03_score_cells.py` | Isochrones + Kontur population | 1,079,666 scored H3 cells + amenity associations | ~30 s |
| `05_export_population.py` | Cell scores | Population sidecar JSON (res-9 aggregated) | ~10 s |
| `07_bin_cells_to_tiles.py` | Cell scores | Partial-load shards for viewport-based loading | ~5 s |
| `08_flag_unbuildable.py` | Protected areas | Cells flagged as non-buildable | ~20 s |
| `06_upload_to_supabase.py` | All outputs | Data uploaded to Supabase Postgres | ~30 s |
| `09_demographics.py` | SURS statistics | Municipality demographic indicators | ~15 s |

### When to re-run

| Trigger | Scripts to run |
|---|---|
| OSM extract updated | `01` → `02` → `03` → `05` → `07` → `06` |
| Scoring formula changed | `03` → `05` → `07` → `06` |
| Population data updated | `05` → `06` |
| Protected areas updated | `08` → `06` |

---

## Environment Variables

### `frontend/.env.local`

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase REST URL (use `/sb` for WSL proxy) | `/sb` |
| `SUPABASE_INTERNAL_URL` | Internal Supabase URL for server-side requests | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key (read-only RLS) | `eyJ...` |
| `NEXT_PUBLIC_USE_REMOTE_DATA` | Load data from Supabase instead of static files | `true` |
| `VALHALLA_URL` | Valhalla routing engine URL | `http://127.0.0.1:8002` |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI assistant (optional) | `sk-or-...` |

### `backend/.env`

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase REST endpoint |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (full access) |

---

## API Documentation

The application exposes a REST API auto-generated by Supabase PostgREST, plus custom Next.js API routes.

### Swagger UI

When the dev server is running, visit [`/api-docs`](http://localhost:3000/api-docs) for interactive API documentation with two tabs:
- **Combined Documentation** — hand-written OpenAPI 3.1 covering Next.js routes and key Supabase tables
- **Supabase (Live)** — auto-generated PostgREST spec

Raw OpenAPI JSON is available at [`/openapi.json`](http://localhost:3000/openapi.json).

### Key Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/valhalla/{action}` | POST | Proxied Valhalla requests (isochrone, route) |
| `/api/llm` | POST | AI-powered natural-language location search |
| `/sb/rest/v1/cell_scores` | GET | Cell livability scores (PostgREST) |
| `/sb/rest/v1/rpc/amenities_for_point` | POST | Amenities reachable from a given cell |
| `/sb/rest/v1/rpc/llm_search_cells` | POST | Find best cells matching criteria |
| `/sb/rest/v1/obcine` | GET | Municipality boundaries and statistics |

---

## Daily Development Workflow

After the initial setup, the daily workflow is:

```bash
# Start services (Docker Desktop must be running on Windows)
cd ~/15min-visualizer/backend
supabase start                          # ~3 s if already initialized
docker start valhalla-slo               # instant if already built
cd ../frontend
pnpm dev                                # → http://localhost:3000

# Stop everything
cd ~/15min-visualizer/backend
supabase stop
docker stop valhalla-slo
# Ctrl-C in the pnpm dev terminal
```

### Development commands

```bash
pnpm dev          # Start Next.js dev server with hot reload
pnpm typecheck    # Run TypeScript type checking (tsc --noEmit)
pnpm build        # Production build (catches issues tsc misses)
pnpm lint         # ESLint
```

---

## Troubleshooting

| Symptom | Solution |
|---|---|
| `docker: command not found` in WSL | Docker Desktop not running or WSL integration not enabled. Check Docker Desktop → Settings → Resources → WSL Integration |
| `permission denied` on Docker socket | `sudo chmod 666 /var/run/docker.sock` (needed after each Docker daemon restart) |
| `pnpm: command not found` | `sudo corepack enable pnpm`, then restart WSL terminal |
| "Failed to fetch" in browser | WSL2 doesn't forward port 54321. Use `NEXT_PUBLIC_SUPABASE_URL=/sb` (not a raw URL) in `.env.local` |
| Yellow "sample data" banner | Supabase not running or data not uploaded. Run `supabase status` then `06_upload_to_supabase.py` |
| Scorecard stuck on loading | Check devtools → Network for 401 (key mismatch in `.env.local`) or 404 (ETL upload not run) |
| Valhalla returns 405 in browser | Expected — the app calls Valhalla via `/api/valhalla/*` server proxy, not directly |
| Photon returns 400 | Known issue: `&lang=sl` is unsupported. The codebase already omits it |
| `/api/llm` returns 501 | `OPENROUTER_API_KEY` not set in `.env.local` |
| Slow file-watch / `EBUSY` | Repo is on `/mnt/c/...`. Move it to the WSL filesystem (`~/`) |
| `supabase start` hangs on pulling | Docker Desktop just woke up — wait a minute, or manually `docker pull` the image |
| ETL `08_flag_unbuildable.py` fails | Migrations not applied. Run `supabase db reset --local` |

---

## Data Sources

All data is open and freely available. See [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) for download commands.

| Source | What | License | Records |
|---|---|---|---|
| **[Geofabrik OSM](https://download.geofabrik.de/europe/slovenia.html)** | Roads, amenities, buildings, land use | ODbL | ~308 MB PBF |
| **[GURS RPE](https://github.com/stefanb/gurs-rpe)** | 212 municipality boundaries | CC BY 4.0 | 212 polygons |
| **[ARSO Zavarovana območja](http://gis.arso.gov.si/geoserver/ows)** | Protected areas (parks, reserves) | ARSO Open | 531 polygons |
| **[ARSO Natura 2000](http://gis.arso.gov.si/geoserver/ows)** | EU ecological network | ARSO Open | 355 polygons |
| **[Kontur Population](https://data.humdata.org/dataset/kontur-population-slovenia)** | H3-native population density | CC BY 4.0 | ~27,400 cells |
| **[OpenFreeMap](https://openfreemap.org/)** | Vector tile basemap | Free | Hosted |

---

## The Eight Categories

Every cell is scored against these eight daily-needs categories:

| # | Category | OSM Tags | Examples |
|---|---|---|---|
| 1 | 🛒 **Trgovina** (Shopping) | `shop=supermarket\|convenience\|bakery` | Mercator, Spar, local bakeries |
| 2 | 🎓 **Izobraževanje** (Education) | `amenity=kindergarten\|school` | Kindergartens, primary schools |
| 3 | ⚕️ **Zdravstvo** (Healthcare) | `amenity=clinic\|doctors\|hospital\|pharmacy` | Health centers, pharmacies |
| 4 | 🌳 **Park** (Green spaces) | `leisure=park`, `landuse=forest` | City parks, urban forests |
| 5 | 🚌 **Javni promet** (Transit) | `public_transport=stop_position\|station` | Bus stops, train stations |
| 6 | 🏅 **Šport** (Sports) | `leisure=sports_centre\|playground\|pitch` | Sports halls, playgrounds |
| 7 | ✂️ **Storitve** (Services) | `amenity=post_office\|bank\|restaurant` | Post offices, banks, restaurants |
| 8 | 💼 **Delo** (Work) | `office=*` | Offices, coworking spaces |

**Score thresholds:** 🟢 6–8 (excellent) · 🟡 4–5 (adequate) · 🟠 2–3 (limited) · 🔴 0–1 (poor)

---

## License

[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)
