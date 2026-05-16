# 15min Slovenija

> **Ekipa GEOGuessr** · [GEO Slovenija](https://www.geo-slovenija.si) Hackathon (15.–16. maj 2026)

![Demo potrošniškega pogleda](data/readme/potrosnik.gif)

---

## O projektu

O »15-minutnih soseskah« — torej naseljih, kjer lahko vsakdanje obveznosti (trgovino, šolo, zdravnika, park, postajo) opraviš peš ali s kolesom v 15 minutah — se v Sloveniji govori že leta. Manjka pa karta, ki bi z dejanskimi podatki pokazala, **kje pri nas tak način življenja v resnici obstaja in kje šele bo**. Naredili smo jo.

15min Slovenija pokrije **celotno državo**, ne le nekaj primerov: vsak naseljen del Slovenije, od centra Ljubljane do najmanjše vasi v Beli krajini, je analiziran na ločljivosti približno enega hišnega bloka (~66 m). Skupaj **1,08 milijona poseljenih celic**, **37 622 dnevnih dobrin** iz OpenStreetMap in **112 866 pešhodnih izokron**, izračunanih nad celotnim cestnim omrežjem Slovenije z routing engine-om Valhalla. Rezultat ni teoretična ocena — vsak rezultat je naslonjen na realno pot po obstoječih cestah.

Posamezne ocene niso bistvo. Karta je. **Šele ko pogledaš celotno državo na isti karti, vidiš sliko, ki je v razpravah o urejanju mest manjkala** — koliko Slovenije v resnici dosega standard 15-minutnih sosesk, kje so vrzeli največje in kje bi bil vpliv nove storitve največji. Prvič smo lahko jasno pokazali, da imajo le največja mesta — Ljubljana, Maribor, Celje, Kranj, Koper — predele s polno pokritostjo, medtem ko velika večina države dnevne obveznosti pogojuje z avtom.

### Kaj naredi ta projekt drugače

- **Cela Slovenija, ne vzorec.** 212 občin, 1,08 milijona celic, vsaka povezljiva z izvirnimi podatki.
- **Dva uporabniška vidika v enem produktu.** Pogled **»Potrošnik«** odgovarja na *»kje bi mi bilo dobro živeti?«*; pogled **»Investitor«** odgovarja na *»kje bi nova storitev imela največji učinek?«* (povpraševanje = `populacija × (1 − že pokrito)`).
- **AI svetovalec v slovenščini.** Opišeš situacijo (»sva mlada družina, delava v Ljubljani in Mariboru«), aplikacija ti predstavi 5 najprimernejših lokacij. Model LLM (`minimax/minimax-m2.7` prek OpenRouter) prevede prosti opis v strukturirano poizvedbo (kategorije, ciljno mesto, uteži), PostgreSQL pa po tej shemi vrne rangirano listo celic.
- **Konkretni predlogi gradnje, ne samo barvni zemljevidi.** V investitorskem pogledu pripravimo pred-izračunane predloge konkretnih parcel, kjer bi nova storitev največ pomenila. Izvzamemo zavarovana območja (ARSO) in degradirana zemljišča (CRP), predloge gradnje pa povežemo z eProstorjem in demografskim profilom okolice (zdravstvo poudari delež 65+, izobraževanje delež otrok 0–14).
- **Realna pot, ne zračna razdalja.** Vsaka 15-minutna izokrona izračunana s pešhodno/kolesarsko hitrostjo nad celotnim cestnim grafom Slovenije, ne kot krog okrog amenities.
- **Reproducibilno iz odprtih podatkov.** OSM (Geofabrik), GURS, ARSO, CRP, eProstor, Kontur. Vsak korak ETL cevovoda je ponovljiv z eno skripto.
- **Zasebnost po načelu.** Naslovi se v iskalniku nikjer ne shranjujejo. Geokodiranje teče preko Photona/Nominatima brez naših strežnikov.
- **Javen REST API + Swagger UI.** Vsa baza je dostopna preko PostgREST; ročno vzdrževan OpenAPI 3.1 spec na `/openapi.json`.

### Kaj smo s tem produktom dokazali

1. **15-minutne soseske v Sloveniji niso pravilo, ampak izjema.** Polno pokritost (8/8) dosegajo le predeli največjih mestnih središč — Ljubljana, Maribor, Celje, Kranj, Koper. Razlika med »največja mesta« in »ostala Slovenija« je v dnevni dosegljivosti veliko ostrejša, kot bi pričakovali iz javnih razprav.
2. **Investitorski pogled prikaže konkretne lokacije priložnosti.** V Mariboru, Murski Soboti in Novi Gorici obstajajo predeli z visoko populacijo in pomanjkljivo dostopnostjo do izobraževanja ali zdravstva — natanko tam, kjer bi nova storitev imela največji učinek na 15-minutno dostopnost.
3. **Dnevna dostopnost s kolesom drastično spremeni sliko.** Preklop na kolesarski profil podvoji ali potroji pokritost v primestjih največjih mest — kar je nezahteven, a v javnih razpravah malo prisoten argument za vlaganja v kolesarsko infrastrukturo.

---

## Kazalo

- [Funkcionalnosti](#funkcionalnosti)
- [Arhitektura](#arhitektura)
- [Tehnologije](#tehnologije)
- [Postavitev repa](#postavitev-repa)
- [Namestitev](#namestitev)
  - [Predpogoji](#predpogoji)
  - [Hitri zagon (6 korakov)](#hitri-zagon-6-korakov)
  - [Podrobna namestitev (WSL2 na Windows)](#podrobna-namestitev-wsl2-na-windows)
- [ETL cevovod](#etl-cevovod)
- [Spremenljivke okolja](#spremenljivke-okolja)
- [API dokumentacija](#api-dokumentacija)
- [Vsakdanji razvojni postopek](#vsakdanji-razvojni-postopek)
- [Odpravljanje težav](#odpravljanje-težav)
- [Viri podatkov](#viri-podatkov)
- [Osem kategorij](#osem-kategorij)
- [Licenca](#licenca)

---

## Funkcionalnosti

### Potrošniški pogled (»Potrošnik«)

- **Iskalnik naslovov** — Photon kot primarni geocoder, Nominatim kot rezerva. Omejeno na slovenski bbox, najmanj 5 znakov; podpira tudi prilepljen `lat,lng`.
- **Scorecard celice** — klik na poljubno H3 celico prikaže oceno 0–8 (barvni »badge«), čas dosega po vsaki kategoriji in razširljiv seznam najbližjih dobrin (z imenom in časom v minutah).
- **Pini dobrin** — kategorijsko obarvani markerji za vsako dosegljivo dobrino z značkami časa hoje ali kolesarjenja.
- **Živi 15-minutni izokron** — preko Valhalle, narisan kot prosojni poligon nad zemljevidom.
- **Preklop Hoja / Kolo** — celoten pogled (ocena, čas dobrin, izokron, animirane poti) se preusmeri na pravi Valhalla profil (`pedestrian` 4 km/h ali `bicycle` 13 km/h, profil Hybrid).
- **Animirane poti do dobrin** — klik na vrstico kategorije v Scorecardu nariše časovno animirane poti do vsake dosegljive dobrine v barvi kategorije, s svetlobnim učinkom na čelu poti.
- **Kartica občine** — pri oddaljenem pogledu klik na občino odpre kartico s povprečno oceno, prebivalstvom, gostoto in razčlenjenim deležem zadetih kategorij.

### Investitorski pogled (»Investitor«)

- **Heatmap povpraševanja** — `populacija × (1 − pokritje_kategorije)` razkrije podpopolne predele.
- **Filter po kategoriji** — pillsi za vseh 8 kategorij omogočajo iskanje konkretnih vrzeli (npr. *»kje manjka vrtcev?«*).
- **Predlogi gradnje (pini)** — pred-izračunane konkretne parcele iz eProstor, kjer bi nova storitev imela največji učinek. Pini se obarvajo po demografskem profilu okolice (zdravstvo poudari delež 65+, izobraževanje delež otrok 0–14).
- **Izvzemanje neprimernih območij** — ARSO zavarovana območja in degradirana zemljišča iz CRP se odštejejo, da priporočila padejo le na realno gradljive parcele.
- **Maskiranje neposeljenih predelov** — gozdovi, hribi in jezera sintetizirani na strani odjemalca iz občinskih poligonov.
- **Barvno-slepe prijazna paleta** — 4-stopenjska viridis z opacitetjo, ki se ujema potrošniškemu pogledu.

### Skupno za oba pogleda

- **Klient-side multi-scale agregacija** — 1,08 milijona celic pri res-10, agregiranih na ~450 šesterokotnikov pri pogledu na cele državo preko `h3.cellToParent()`, manj kot 5 ms.
- **Občinski choropleth** — pri oddaljenem pogledu 212 občin pobarvanih po povprečni oceni s statistiko prebivalstva na hover.
- **Svetla / temna tema** — gumb v levem spodnjem kotu (zaradi čitljivosti aplikacija ob vsakem zagonu zažene v svetli temi).
- **Trajni linki (permalinki)** — vsak premik, zoom in klik zapiše `#lng/lat/zoom/h3` v URL; deljenje linka pripelje prejemnika na natanko isti pogled.
- **AI svetovalec** — naravnojezično iskanje v slovenščini, prek OpenRouter LLM.
- **Panel »Izvor podatkov«** — vsi viri (OSM, GURS, ARSO, CRP, eProstor, Kontur, OpenFreeMap) s številom enot, licencami, kratko utemeljitvijo in povezavo na izvirnik.
- **REST API + Swagger UI** — avtomatsko generirani PostgREST + ročno vzdrževan OpenAPI 3.1 spec na [`/api-docs`](http://localhost:3000/api-docs).

---

## Arhitektura

Sistem je razdeljen v dve namerno ločeni fazi:

```mermaid
flowchart TB
  subgraph ETL["Faza 1 · ETL / pred-izračun (Python, lokalno, enkrat)"]
    direction LR
    OSM[Geofabrik OSM PBF] --> PY[Python ETL · GeoPandas + H3]
    ARSO[ARSO zavarovana območja] --> PY
    GURS[GURS občinske meje] --> PY
    KON[Kontur populacija H3] --> PY
    CRP[CRP degradirana območja] --> PY
    EPR[eProstor parcele] --> PY
    PY --> VAL[Valhalla Docker · izokrone]
    VAL --> SJ[Spatial join · ocena na celico]
    SJ --> DB[(Supabase Postgres + PostGIS)]
    SJ --> JSON["cell_scores_lite.json<br/>+ cell_population_lite.json"]
  end

  subgraph LIVE["Faza 2 · živo izvajanje (brskalnik)"]
    direction LR
    USER[Brskalnik uporabnika] --> NX[Next.js 14]
    NX --> MAP[OpenFreeMap basemap]
    NX --> CELL["Statični JSON<br/>~3 MB · agregacija v brskalniku"]
    NX --> SB[Supabase REST<br/>Scorecard + dobrine]
    NX --> PH[Photon geocoder]
    NX --> VH[Valhalla<br/>izokron na klik]
    NX --> AI[OpenRouter LLM<br/>AI iskanje]
  end

  JSON -.serves.-> CELL
  DB -.RPC.-> SB
```

**Faza 1 (ETL):** Ekstrakcija dobrin iz OSM → izračun 112 866 izokron preko Valhalle → spatial join s 1,08 milijona poseljenih H3 celic → izvoz ocen kot statični JSON in nalaganje v Supabase.

**Faza 2 (živo):** Next.js naloži JSON enkrat na začetku. Spremembe zooma se obdelajo na strani odjemalca preko `h3.cellToParent()` brez tile-server roundtripov. Edina »živa« infrastruktura je Valhalla (za izokrone na klik), Supabase (za podrobnosti Scorecarda in pine dobrin) in OpenRouter (za AI iskanje).

---

## Tehnologije

### Frontend

| Tehnologija | Namen |
|---|---|
| **Next.js 14** (App Router) | SSR, API poti, statične datoteke |
| **MapLibre GL JS** | WebGL renderiranje z OpenFreeMap vektorskimi ploščicami |
| **deck.gl** | `H3HexagonLayer`, `PathLayer`, `GeoJsonLayer`, `IconLayer`, `TripsLayer` |
| **h3-js** | Klient-side H3 agregacija po zoomu |
| **Vercel AI SDK + OpenRouter** | Strukturiran LLM izhod (`generateObject` + Zod shema) |
| **Supabase JS** | Klici v PostgREST in RPC |
| **Zod** | Validacija API teles |
| **TypeScript** | Tipska varnost frontenda |

### Backend

| Tehnologija | Namen |
|---|---|
| **Python 3.12** | Orkestracija ETL cevovoda |
| **GeoPandas + Shapely** | Geoprostorska obdelava in spatial join |
| **Valhalla** (Docker) | Izračun izokron in poti nad OSM cestnim omrežjem |
| **Supabase** (Postgres 16 + PostGIS 3.4) | Baza s prostorskim indeksom, generiranim REST API in RLS |
| **H3** (Python + PostgreSQL ekstenzija) | Šesterokotno prostorsko indeksiranje (res-10) |
| **OpenRouter** | LLM API (model `minimax/minimax-m2.7`) za naravnojezično iskanje |

### Zunanje storitve

| Storitev | Vloga | Strošek |
|---|---|---|
| **OpenFreeMap** | Vektorske ploščice (positron / dark-matter) | Brezplačno, brez ključa |
| **Photon** (Komoot) | Avtokomplet naslovov | Brezplačno, brez ključa |
| **Nominatim** | Rezervni geocoder | Brezplačno, omejeno |

---

## Postavitev repa

```
15min-visualizer/
├── frontend/                    # Next.js 14 frontend
│   ├── app/                     # App Router poti + API
│   │   ├── api/llm/             # AI iskanje v1 (OpenRouter)
│   │   ├── api/llm-search/      # AI iskanje v2 (generateObject + ranking weights)
│   │   ├── api/valhalla/        # Valhalla proxy (obvod CORS)
│   │   ├── api-docs/            # Swagger UI
│   │   ├── openapi.json/        # Ročno vzdrževan OpenAPI 3.1 spec
│   │   ├── globals.css          # Design system (CSS custom properties)
│   │   ├── layout.tsx           # Root layout z inicializacijo teme
│   │   └── page.tsx             # Glavna karta
│   ├── components/              # React komponente
│   │   ├── Map.tsx              # Karta z vsemi layerji in interakcijami
│   │   ├── Scorecard.tsx        # Panel s podrobnostmi celice
│   │   ├── ResultCard.tsx       # AI rezultati (top 5)
│   │   ├── ChatBox.tsx          # AI klepetalnik (v1 flow)
│   │   ├── AddressSearch.tsx    # Photon/Nominatim iskalnik
│   │   ├── IzvorPodatkov.tsx    # Panel z viri podatkov
│   │   ├── ObcinaInfoCard.tsx   # Kartica občine
│   │   └── ThemeToggle.tsx      # Svetla/temna tema
│   ├── lib/                     # Pomožni moduli
│   │   ├── categories.ts        # Definicije 8 kategorij (ikone, barve, oznake)
│   │   ├── llm-search.ts        # SearchSpec Zod shema + SYSTEM_PROMPT
│   │   ├── supabase.ts          # Supabase klient + pomagala
│   │   ├── valhalla.ts          # Valhalla API ovojnica
│   │   ├── suggestions.ts       # Logika predlogov gradnje
│   │   ├── theme.ts             # Upravljanje teme
│   │   └── geo.ts               # Geoprostorska pomagala
│   └── public/data/             # Statične JSON datoteke
├── backend/
│   ├── etl/                     # Python ETL cevovod (skripte 01–09)
│   ├── valhalla/                # Valhalla Dockerfile + konfiguracija
│   └── supabase/                # Supabase config + SQL migracije
├── data/
│   ├── 15min-slo/               # Surovi prenosi (gitignored)
│   ├── readme/                  # Slike za README (gifi, screenshoti)
│   └── DATA_SOURCES.md          # Katalog virov z ukazi za prenos
└── docs/                        # Projektne dokumente
    ├── PLAN.md                  # Fiksne odločitve in formula
    ├── ARCHITECTURE.md          # Sistemski opis
    ├── TASKS.md                 # Roadmap s prioritetami (P0/P1/P2)
    └── CHECKLIST.md             # Kontrolni seznam priprave okolja
```

---

## Namestitev

### Predpogoji

- **Docker Desktop** z omogočeno WSL2 integracijo
- **Node.js 20+** z **pnpm** (preko `corepack enable pnpm`)
- **Python 3.12** z `venv`
- **Supabase CLI**

### Hitri zagon (6 korakov)

```bash
# 1. Klon repa (znotraj WSL filesystema, ne /mnt/c)
git clone https://github.com/TianK003/15min-visualizer.git ~/15min-visualizer
cd ~/15min-visualizer

# 2. Python backend
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 3. Frontend odvisnosti
cd frontend && pnpm install && cd ..

# 4. Spremenljivke okolja
cp backend/.env.example backend/.env
# Ustvarite frontend/.env.local z:
#   NEXT_PUBLIC_SUPABASE_URL=/sb
#   SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<iz `supabase status --output env`>
#   NEXT_PUBLIC_USE_REMOTE_DATA=true
#   VALHALLA_URL=http://127.0.0.1:8002
#   OPENROUTER_API_KEY=<vaš ključ> (neobvezno, za AI iskanje)

# 5. Lokalni Supabase + Valhalla
cd backend && supabase start && cd ..
cd backend/valhalla
docker build -t valhalla-slo .
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
cd ../..

# 6. Razvojni strežnik
cd frontend && pnpm dev
# Odprite http://localhost:3000
```

> **Opomba:** Surovi podatki (OSM, Kontur, GURS, ARSO) so preveliki za git. Sledite [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) za enojne ukaze prenosov.

### Podrobna namestitev (WSL2 na Windows)

<details>
<summary>Razširite za celovit vodič namestitve</summary>

#### 1. Namestitev WSL2 + Ubuntu

V **PowerShell kot administrator**:
```powershell
wsl --install -d Ubuntu
```
Znova zaženite, odprite Ubuntu iz Start menija in ustvarite uporabnika.

#### 2. Docker Desktop z WSL2

Namestite [Docker Desktop za Windows](https://www.docker.com/products/docker-desktop/). Omogočite WSL integracijo pod **Settings → Resources → WSL Integration**.

```bash
docker --version   # preverite iz WSL terminala
```

#### 3. Razvojna orodja (WSL terminal)

```bash
# Osnovna orodja
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

# Preverite vse
git --version && node --version && pnpm --version && python3.12 --version
docker --version && supabase --version
```

#### 4. Klon repa

```bash
cd ~
git clone https://github.com/TianK003/15min-visualizer.git
cd 15min-visualizer
```

> **Pomembno:** Repo naj bo na WSL filesystemu (`~/15min-visualizer`, **ne** `/mnt/c/...`). Med-filesystemski I/O je ~10× počasnejši in zlomi hot-reload.

#### 5. Prenos surovih podatkov

Sledite [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) — vsak vir ima en `curl` ukaz. Pričakovane datoteke:

```
data/15min-slo/slovenia-latest.osm.pbf
data/15min-slo/obcine.geojson
data/15min-slo/zavarovana_si.geojson
data/15min-slo/kontur_population_SI.gpkg
```

#### 6. Python virtualno okolje

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

#### 7. Frontend odvisnosti

```bash
cd frontend && pnpm install && cd ..
```

#### 8. Konfiguracija okolja

**`backend/.env`** (kopirajte iz vzorca, dopolnite po koraku 9):
```bash
cp backend/.env.example backend/.env
```

**`frontend/.env.local`**:
```env
NEXT_PUBLIC_SUPABASE_URL=/sb
SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prilepite PUBLISHABLE_KEY iz supabase status>
NEXT_PUBLIC_USE_REMOTE_DATA=true
VALHALLA_URL=http://127.0.0.1:8002
OPENROUTER_API_KEY=<vaš ključ za AI iskanje>
```

Vrednost `/sb` je namerna — `next.config.mjs` prepiše `/sb/*` zahteve na `SUPABASE_INTERNAL_URL`, kar obide WSL2 port-forwarding težave.

#### 9. Zagon Supabase

```bash
cd backend
supabase start          # prvi zagon prenese ~1 GB Docker slik
supabase status --output env
```

Prepišite `SECRET_KEY` → `backend/.env` kot `SUPABASE_SERVICE_KEY` in `PUBLISHABLE_KEY` → `frontend/.env.local` kot `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Migracije iz `backend/supabase/migrations/` se aplicirajo samodejno.

Lokalne končne točke:
- REST API: `http://127.0.0.1:54321`
- Studio (DB UI): `http://127.0.0.1:54323`
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

#### 10. Gradnja in zagon Valhalla

```bash
cd backend/valhalla
docker build -t valhalla-slo .         # ~10 min, gradi SI routing graph
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
cd ../..
```

Smoke test:
```bash
curl -X POST http://localhost:8002/isochrone \
  -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":46.0512,"lon":14.5061}],"costing":"pedestrian","contours":[{"time":15}],"polygons":true}'
```

#### 11. ETL cevovod

```bash
cd backend
source .venv/bin/activate
python etl/01_extract_amenities.py     # ~30 s — OSM → 37 622 dobrin
python etl/02_isochrones.py            # ~1.3 min — 112 866 izokron (nadaljevalno)
python etl/03_score_cells.py           # ~30 s — 1 079 666 H3 celic ocenjenih
python etl/05_export_population.py     # ~10 s — populacijski sidecar JSON
python etl/07_bin_cells_to_tiles.py    # ~5 s — partial-load shards
python etl/08_flag_unbuildable.py      # ~20 s — označi zavarovane celice
python etl/06_upload_to_supabase.py    # ~30 s — naloži v lokalni Supabase
cd ..
```

> `06_upload_to_supabase.py` zahteva `SUPABASE_SERVICE_KEY` v `backend/.env`.

#### 12. Razvojni strežnik

```bash
cd frontend && pnpm dev
```

Odprite `http://localhost:3000` **v Windows brskalniku**.

</details>

---

## ETL cevovod

ETL cevovod pretvori surove odprte podatke v ocenjeno šesterokotno mrežo. Vsaka skripta je idempotentna in jo je mogoče pognati neodvisno.

| Skripta | Vhod | Izhod | Trajanje |
|---|---|---|---|
| `01_extract_amenities.py` | OSM PBF | 37 622 klasificiranih dobrin v 8 kategorijah | ~30 s |
| `02_isochrones.py` | Dobrine + Valhalla | 112 866 izokronskih poligonov (5/10/15 min) | ~1,3 min |
| `03_score_cells.py` | Izokrone + Kontur populacija | 1 079 666 ocenjenih H3 celic + asociacije | ~30 s |
| `05_export_population.py` | Ocene celic | Populacijski sidecar JSON (res-9 agregat) | ~10 s |
| `07_bin_cells_to_tiles.py` | Ocene celic | Partial-load shards za viewport-loading | ~5 s |
| `08_flag_unbuildable.py` | Zavarovana območja | Celice označene kot nepoznlive | ~20 s |
| `09_demographics.py` | SURS statistika | Demografski indikatorji občin | ~15 s |
| `06_upload_to_supabase.py` | Vsi izhodi | Podatki naloženi v Supabase Postgres | ~30 s |

### Kdaj pognati ponovno

| Sprožilec | Skripte za pognati |
|---|---|
| OSM ekstrakt posodobljen | `01` → `02` → `03` → `05` → `07` → `06` |
| Spremenjena formula ocenjevanja | `03` → `05` → `07` → `06` |
| Posodobljeni populacijski podatki | `05` → `06` |
| Posodobljena zavarovana območja | `08` → `06` |

---

## Spremenljivke okolja

### `frontend/.env.local`

| Spremenljivka | Opis | Primer |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase REST URL (`/sb` za WSL proxy) | `/sb` |
| `SUPABASE_INTERNAL_URL` | Interni Supabase URL za serverside klice | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonimni ključ (samo-bralni RLS) | `eyJ...` |
| `NEXT_PUBLIC_USE_REMOTE_DATA` | Naloži podatke iz Supabase namesto statičnih datotek | `true` |
| `VALHALLA_URL` | Valhalla routing engine URL | `http://127.0.0.1:8002` |
| `OPENROUTER_API_KEY` | OpenRouter ključ za AI svetovalca (neobvezno) | `sk-or-...` |
| `MODEL` | Override LLM modela (privzeto `minimax/minimax-m2.7`) | `minimax/minimax-m2.7` |

### `backend/.env`

| Spremenljivka | Opis |
|---|---|
| `SUPABASE_URL` | Supabase REST endpoint |
| `SUPABASE_SERVICE_KEY` | Supabase service-role ključ (polen dostop) |

---

## API dokumentacija

Aplikacija izpostavlja REST API, ki ga samodejno generira Supabase PostgREST, ter ročno vzdrževane Next.js API poti.

### Swagger UI

Ob zagnanem razvojnem strežniku obiščite [`/api-docs`](http://localhost:3000/api-docs) za interaktivno API dokumentacijo z dvema zavihkoma:
- **Združena dokumentacija** — ročno vzdrževan OpenAPI 3.1 (Next.js poti + ključne Supabase tabele/RPC)
- **Supabase (živo)** — avtomatsko generirana PostgREST shema

Surovi OpenAPI JSON je dostopen na [`/openapi.json`](http://localhost:3000/openapi.json).

### Ključne končne točke

| Pot | Metoda | Opis |
|---|---|---|
| `/api/llm` | POST | AI iskanje v1 (kombiniran search + narrative) |
| `/api/llm-search` | POST | AI iskanje v2 — strukturiran izhod z ranking_weights in `search_cells_v2` |
| `/api/valhalla/{endpoint}` | POST | Proxy klici v Valhalla (`isochrone`, `route`, `locate`, `matrix`, `sources_to_targets`, `trace_route`) |
| `/sb/rest/v1/cell_scores` | GET | Ocene dostopnosti celic (PostgREST) |
| `/sb/rest/v1/obcine` | GET | Občinske meje in statistika |
| `/sb/rest/v1/amenities` | GET | OSM dobrine po kategorijah |
| `/sb/rest/v1/rpc/amenities_for_point` | POST | Dobrine dosegljive iz izhodišča v 15 min |
| `/sb/rest/v1/rpc/llm_search_cells` | POST | Iskanje najboljših celic (v1) |
| `/sb/rest/v1/rpc/search_cells_v2` | POST | Iskanje najboljših celic (v2 z utežmi in ciljno bližino) |

---

## Vsakdanji razvojni postopek

Po prvi namestitvi je dnevni potek:

```bash
# Zagon storitev (Docker Desktop mora teči na Windows)
cd ~/15min-visualizer/backend
supabase start                          # ~3 s, če je že inicializiran
docker start valhalla-slo               # takojšen, če je že zgrajen
cd ../frontend
pnpm dev                                # → http://localhost:3000

# Zaustavitev vsega
cd ~/15min-visualizer/backend
supabase stop
docker stop valhalla-slo
# Ctrl-C v pnpm dev terminalu
```

### Razvojni ukazi

```bash
pnpm dev          # Next.js dev strežnik s hot reload
pnpm typecheck    # TypeScript preverjanje tipov (tsc --noEmit)
pnpm build        # produkcijski build (ujame stvari, ki jih tsc spregleda)
pnpm lint         # ESLint
```

---

## Odpravljanje težav

| Simptom | Rešitev |
|---|---|
| `docker: command not found` v WSL | Docker Desktop ne teče ali WSL integracija ni omogočena. Preverite Docker Desktop → Settings → Resources → WSL Integration |
| `permission denied` na Docker socketu | `sudo chmod 666 /var/run/docker.sock` (potrebno po vsakem ponovnem zagonu Docker daemonsa) |
| `pnpm: command not found` | `sudo corepack enable pnpm`, nato znova odprite WSL terminal |
| »Failed to fetch« v brskalniku | WSL2 ne forwarda port 54321. Uporabite `NEXT_PUBLIC_SUPABASE_URL=/sb` (ne surov URL) v `.env.local` |
| Rumeno opozorilo o »vzorčnih podatkih« | Supabase ne teče ali nalaganje ni izvedeno. Zaženite `supabase status` in nato `06_upload_to_supabase.py` |
| Scorecard obstane na »Nalagam …« | DevTools → Network: 401 = neujemajoč ključ v `.env.local`; 404 = ETL upload ni bil pognan |
| Valhalla vrne 405 v brskalniku | Po načrtu — aplikacija kliče Valhalla preko `/api/valhalla/*` proxyja, ne direktno |
| Photon vrne 400 | Znana težava: `&lang=sl` ni podprt. Koda ga že izpušča |
| `/api/llm` vrne 501 | `OPENROUTER_API_KEY` ni nastavljen v `.env.local` |
| Počasen file-watch / `EBUSY` napake | Repo je na `/mnt/c/...`. Premaknite ga na WSL filesystem (`~/`) |
| `supabase start` obstane na pulling | Docker Desktop se je pravkar zbudil — počakajte minuto ali ročno `docker pull` |
| ETL `08_flag_unbuildable.py` propade | Migracije niso aplicirane. Zaženite `supabase db reset --local` |

---

## Viri podatkov

Vsi podatki so odprti in javno dostopni. Glej [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) za ukaze prenosov.

| Vir | Vsebina | Licenca | Zapisi |
|---|---|---|---|
| **[Geofabrik OSM](https://download.geofabrik.de/europe/slovenia.html)** | Ceste, dobrine, stavbe, raba tal | ODbL | ~308 MB PBF |
| **[GURS RPE](https://github.com/stefanb/gurs-rpe)** | 212 občinskih mej | CC BY 4.0 | 212 poligonov |
| **[ARSO zavarovana območja](https://gis.arso.gov.si/related/ARSO_WFS/)** | Naravoarstveni status (parki, rezervati) | CC BY 4.0 | 531 poligonov |
| **[CRP — degradirana območja](https://crp.gis.si/)** | Centralni register degradiranih zemljišč | Javno dostopno | — |
| **[eProstor — predlogi za nove storitve](https://eprostor.gov.si/imps/srv/slv/catalog.search#/metadata/9a8fd241-9162-407c-94e7-c98e05766881)** | Negradijene parcele za priporočila gradnje | Javno dostopno | — |
| **[Kontur Population](https://data.humdata.org/dataset/kontur-population-slovenia)** | H3-natively populacijski raster | CC BY 4.0 | ~27 400 res-8 celic |
| **[OpenFreeMap](https://openfreemap.org/)** | Vektorski osnovni zemljevid | Brezplačno | Hostano |

---

## Osem kategorij

Vsaka celica je ocenjena glede na teh osem kategorij dnevnih dobrin:

| # | Kategorija | OSM oznake | Primeri |
|---|---|---|---|
| 1 | 🛒 **Trgovina** | `shop=supermarket\|convenience\|bakery` | Mercator, Spar, lokalne pekarne |
| 2 | 🎓 **Izobraževanje** | `amenity=kindergarten\|school` | Vrtci, osnovne šole |
| 3 | ⚕️ **Zdravstvo** | `amenity=clinic\|doctors\|hospital\|pharmacy` | Zdravstveni domovi, lekarne |
| 4 | 🌳 **Park** | `leisure=park`, `landuse=forest` | Mestni parki, urbani gozdovi |
| 5 | 🚌 **Javni promet** | `public_transport=stop_position\|station` | Avtobusne in železniške postaje |
| 6 | 🏅 **Šport** | `leisure=sports_centre\|playground\|pitch` | Telovadnice, igrišča |
| 7 | ✂️ **Storitve** | `amenity=post_office\|bank\|restaurant` | Pošte, banke, restavracije |
| 8 | 💼 **Delo** | `office=*` | Pisarne, coworking prostori |

**Pragovi ocen:** 🟢 6–8 (odlično) · 🟡 4–5 (zadovoljivo) · 🟠 2–3 (omejeno) · 🔴 0–1 (slabo)

---

## Licenca

[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)
