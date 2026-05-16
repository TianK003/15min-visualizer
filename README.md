# 15min Slovenija

> Ekipa: **GEOGuessr**

Interaktivni zemljevid, ki pokaže, kolikšen del Slovenije je resnično »15-minutna soseska« — vsako poseljeno H3 celico oceni od 0 do 8, glede na to, koliko dnevnih kategorij dobrin je dosegljivih v 15 minutah hoje ali kolesarjenja. Vse skupaj se agregira navzgor do občin za pogled celotne države.

Aplikacija je razvita za **GEO Slovenija** (15.–16. maj 2026), z dodelavo do **SLO4D** (9. junij 2026).

---

## 🇸🇮 O aplikaciji

15min Slovenija je odgovor na vprašanje: »Koliko od mojih dnevnih opravil lahko opravim peš ali s kolesom v 15 minutah?« Vsaka točka v Sloveniji je ocenjena od 0 do 8 — vsaka točka pomeni eno od osmih kategorij dnevnih dobrin (trgovina, izobraževanje, zdravstvo, park, javni promet, šport, storitve, delo). Ocena se izračuna iz dejanskih izokron za pešca in kolesarja, pridobljenih z lokalnim routing servisom Valhalla nad OSM cestnim omrežjem Slovenije.

### Funkcionalnosti vmesnika

- **Iskalnik naslovov** *(zgoraj na sredini)* — Photon kot primarni geocoder, Nominatim kot rezerva. Najmanj 5 znakov, omejeno na Slovenijo. Klik na rezultat zapelje zemljevid in odpre Scorecard.
- **Scorecard na klik celice** — 0–8 ocena, čas dosega po kategorijah, preklop hoja/kolo, prikaz 15-minutne izokrone v živo. Klik na vrstico kategorije izriše animirane poti do vsake dosegljive dobrine v barvi te kategorije, s svetlobnim učinkom na čelu poti.
- **Preklop Hoja / Kolo** — celoten pogled (značka, čas dobrin, izokron, dobrine, aktivne poti) se preusmeri na pravi Valhalla profil (`pedestrian` 4 km/h vs `bicycle` 13 km/h, profil Hybrid).
- **AI asistent** *(okrogel gumb spodaj desno)* — opišite življenjsko situacijo v slovenščini (»sva mlada družina, delava v Ljubljani in Mariboru«), LLM iz situacije izlušči zahtevane kategorije in ciljno mesto ter zemljevid zapelje na najboljše celice v okolici.
- **Investitorski pogled** *(druga pilula zgoraj)* — namesto ocene dostopnosti prikaže zemljevid povpraševanja (`populacija × (1 − že pokrito)`). Stranska kolonska menija omogočata filter po kategoriji; viridis paleta s 4 stopnjami za barvno-slepe prijazno ločljivost in temno-vijoličastim »zanemarljivim« območjem za že polno pokrite celice. Nepoeljene predele (gozdovi, hribi, jezera) sintetiziramo iz občinskih poligonov na strani odjemalca.
- **Svetla / temna tema** — preklop v levem spodnjem kotu ali znotraj »Izvor podatkov«. Zaradi vprašanja čitljivosti napisov v temni temi se ob vsakem nalaganju strani vmesnik vedno zažene v svetli temi.
- **»Izvor podatkov«** — pregled vseh uporabljenih virov (OSM, GURS, ARSO, Kontur, OpenFreeMap), z licenco, številom enot in kratko razlago. Iz tega panela vodita povezavi na celovito REST API dokumentacijo (Swagger UI) in surov OpenAPI 3.1 JSON.
- **REST API dokumentacija** (`/api-docs`) — Swagger UI s tabbed pogledom: »Združena dokumentacija« (ročno spisan OpenAPI 3.1, ki pokriva Next.js poti `/api/llm` in `/api/valhalla/{endpoint}` ter ključne Supabase tabele `cell_scores`, `obcine`, `amenities` in RPC funkciji `amenities_for_point` ter `llm_search_cells`) in »Supabase (živo)« (samodejno generiran PostgREST spec).
- **Trajni linki** — vsak premik / zoom / klik zapiše `#lng/lat/z/h3` v URL. Z deljenjem linka prejemnik vidi natanko enak pogled.

### Arhitektura v eni sliki

Dve fazi, namerno ločeni:

1. **ETL / pred-izračun** *(Python, lokalno)* — OSM dobrine → 112 866 pedestrian izokron preko lokalnega Valhalla → prostorski sjoin s populiranimi Kontur celicami (res-10) → `cell_scores_lite.json` (`{h3, score}`) in `cell_population_lite.json` (`{h3, pop}`, agregirano na res-9). Oba fajla se priložita kot statične datoteke v `frontend/public/data/`.
2. **Živo izvajanje** *(brskalnik)* — Next.js enkrat naloži obe JSON datoteki in nato `h3-js cellToParent` agregira po zoomu na strani odjemalca. Ni piramide tile-ov, ni round-tripa za spremembo resolucije. Edina prava »živa« infrastruktura je Valhalla za izokrone in poti ter Supabase za podrobnosti Scorecarda.

---

## 🚀 Kratek vodič vzpostavitve okolja

Najkrajša pot do delujočega zemljevida na vašem računalniku. Predpostavlja **Windows z WSL2** (Ubuntu) ali nativni Linux. Za podrobno različico z razlagami glej spodnji razdelek »Podrobna namestitev«.

### Predpogoji (enkratno)

1. **Docker Desktop** z omogočeno WSL integracijo. Po zagonu Docker Desktop-a v WSL terminalu preverite: `docker --version`.
2. **Node.js 20+ z pnpm**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   sudo corepack enable pnpm
   ```
3. **Python 3.12**:
   ```bash
   sudo apt install -y python3.12 python3.12-venv python3-pip
   ```
4. **Supabase CLI**:
   ```bash
   mkdir -p ~/.local/bin
   curl -sLo /tmp/supabase.tar.gz https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz
   tar -xzf /tmp/supabase.tar.gz -C ~/.local/bin/ supabase
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && exec $SHELL
   ```

### Zagon v 6 korakih

```bash
# 1. Klonirajte repo (vedno znotraj WSL filesystema, ne na /mnt/c)
git clone https://github.com/TianK003/15min-visualizer.git ~/15min-visualizer
cd ~/15min-visualizer

# 2. Backend Python venv + odvisnosti
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 3. Frontend odvisnosti
cd frontend && pnpm install && cd ..

# 4. Konfiguracija okolja
cp backend/.env.example backend/.env
# Datoteka frontend/.env.local naj vsebuje:
#   NEXT_PUBLIC_SUPABASE_URL=/sb
#   SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<iz `supabase status --output env`>
#   NEXT_PUBLIC_USE_REMOTE_DATA=true
#   VALHALLA_URL=http://127.0.0.1:8002

# 5. Lokalni Supabase + Valhalla
cd backend && supabase start && cd ..
# Prepišite SECRET_KEY → backend/.env, PUBLISHABLE_KEY → frontend/.env.local
cd backend/valhalla
docker build -t valhalla-slo .
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
cd ../..

# 6. Razvojni strežnik
cd frontend && pnpm dev
# Odprite http://localhost:3000
```

> **Opomba:** Surovi podatki (OSM, Kontur, občinske meje itd.) niso v repu — sledite navodilom v [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md), kjer je za vsak vir natanko ena vrstica `curl`. Datoteke pristanejo v `data/15min-slo/`.

---

## 📁 Postavitev repa

```
/
├── frontend/      Next.js 14 + MapLibre + deck.gl — uporabniški vmesnik
├── backend/       Python ETL, Valhalla container, Supabase migracije
├── data/          Surovi prenosi + katalog virov
└── docs/          Načrt, arhitektura, kontrolni seznami, opombe
```

---

## 📚 Dokumentacija

- **[`docs/TASKS.md`](./docs/TASKS.md)** — trenutno stanje + cela časovnica do izdaje. **Berite prvo, če se vračate k projektu.**
- **[`docs/PLAN.md`](./docs/PLAN.md)** — celoten projektni načrt, formula ocenjevanja, fiksne odločitve.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — sistemski opis: vsaka komponenta in zakaj obstaja.
- **[`docs/CHECKLIST.md`](./docs/CHECKLIST.md)** — kontrolni seznam priprave okolja.
- **[`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md)** — vsak vir podatkov, od kod prihaja in z natanko enim `curl` ukazom za prenos.
- **REST API**: `/api-docs` v zagnanem strežniku ali surov OpenAPI 3.1 na `/openapi.json`.

---

## 🛠️ Podrobna namestitev (WSL2 na Windows)

> Celoten stack teče **znotraj WSL2** (Ubuntu). Samo brskalnik ostane na Windows — pogovarja se s `http://localhost:3000` (Next.js). Ne nameščajte Dockerja ali Pythona na Windows; vse opravite v WSL terminalu.

Vsi ukazi predpostavljajo Ubuntu lupino, odprto v WSL (`wsl` ali ikona »Ubuntu« v Start meniju). Poti uporabljajo poševnice naprej.

### 1 · Namestitev WSL2 + Ubuntu *(preskočite, če že obstaja)*

V **PowerShell kot Administrator** na Windows:
```powershell
wsl --install -d Ubuntu
```
Po pozivu znova zaženite, nato zaženite »Ubuntu« iz Start menija in ustvarite uporabnika.

### 2 · Docker Desktop z WSL2 zalednim sistemom

Namestite [Docker Desktop za Windows](https://www.docker.com/products/docker-desktop/). V Docker Desktop → Nastavitve → **Resources → WSL Integration** omogočite integracijo z vašim Ubuntu distroom. Zaženite Docker Desktop in počakajte na zeleno ikono kita.

Preverite v WSL terminalu:
```bash
docker --version
```

### 3 · Preostala orodja *(WSL terminal)*

```bash
# Osnovna gradbena orodja
sudo apt update && sudo apt install -y git curl build-essential

# Node.js 20 LTS + pnpm preko Corepack
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
exec $SHELL          # ponovno naloži PATH

# Preveri
git --version && node --version && pnpm --version && python3.12 --version
docker --version && supabase --version
```

### 4 · Klon repa *(znotraj WSL)*

```bash
cd ~
git clone https://github.com/TianK003/15min-visualizer.git
cd 15min-visualizer
```

> **Delovni izvod naj bo na WSL datotečnem sistemu** (`~/15min-visualizer`, **ne** `/mnt/c/...`). Med-filesystemski I/O je ~10× počasnejši in zlomi hot-reload.

### 5 · Surovi podatki

Geofabrik OSM ekstrakt, GURS občine, ARSO zavarovana območja in Kontur populacija so preveliki za git in živijo v `data/15min-slo/` (gitignored). Sledite [`data/DATA_SOURCES.md`](./data/DATA_SOURCES.md) — vsak vir ima natanko en `curl`. Pričakovane datoteke:

```
data/15min-slo/slovenia-latest.osm.pbf
data/15min-slo/obcine.geojson
data/15min-slo/zavarovana_si.geojson
data/15min-slo/natura2000_si.geojson
data/15min-slo/kontur_population_SI.gpkg
```

Hiter začetek za OSM ekstrakt:
```bash
mkdir -p data/15min-slo
curl -L https://download.geofabrik.de/europe/slovenia-latest.osm.pbf \
  -o data/15min-slo/slovenia-latest.osm.pbf
```

### 6 · Python virtualno okolje za backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 7 · Frontend odvisnosti

```bash
cd frontend
pnpm install
cd ..
```

### 8 · Konfiguracija okolja

**`backend/.env`** (gitignored — naredite kopijo iz primera):
```bash
cp backend/.env.example backend/.env
```
Po koraku 9 spodaj odprite `backend/.env` in vpišite `SUPABASE_SERVICE_KEY`.

**`frontend/.env.local`** (gitignored):
```
NEXT_PUBLIC_SUPABASE_URL=/sb
SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prilepite PUBLISHABLE_KEY iz `supabase status --output env`>
NEXT_PUBLIC_USE_REMOTE_DATA=true
VALHALLA_URL=http://127.0.0.1:8002
```

Vrednost `/sb` je namerna — `next.config.mjs` jo na strežniški strani prepiše v `SUPABASE_INTERNAL_URL`. Brskalnik se pogovarja s `localhost:3000/sb/...` (isti origin, brez WSL port-forwarding težav); Next.js, ki teče v WSL, prevede klic na `127.0.0.1:54321`.

### 9 · Zaženite Supabase in apliciraj migracije

```bash
cd backend
supabase start          # prvi zagon prenese ~1 GB Docker slik
supabase status --output env
```
Iz izpisa prepišite `SECRET_KEY=` v `backend/.env` kot `SUPABASE_SERVICE_KEY`, in `PUBLISHABLE_KEY=` v `frontend/.env.local` kot `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Migracije v `backend/supabase/migrations/` se apliciraj samodejno.

Končne točke, ko je vse zagnano:
- REST: <http://127.0.0.1:54321> *(dosegljivo samo iz WSL)*
- Studio (DB UI): <http://127.0.0.1:54323> *(odprite iz Windows-a — WSL forwarda port 54323 enako kot 3000)*
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

### 10 · Zgradite in zaženite Valhalla container

Valhalla Dockerfile med gradnjo prenese OSM ekstrakt Slovenije in zgradi routing graf (~10 min na sodobnem prenosniku, enkratno).

```bash
cd backend/valhalla
docker build -t valhalla-slo .
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
cd ../..
```

Smoke test (iz WSL):
```bash
curl -X POST http://localhost:8002/isochrone -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":46.0512,"lon":14.5061}],"costing":"pedestrian","contours":[{"time":15}],"polygons":true}'
```

### 11 · Enkratni zagon ETL cevovoda

```bash
cd backend
source .venv/bin/activate
python etl/01_extract_amenities.py     # ~30 s — OSM → 37 622 dobrin
python etl/02_isochrones.py            # ~1.3 min — 112 866 izokron (lahko nadaljuje)
python etl/03_score_cells.py           # ~30 s — 1 079 666 H3 celic ocenjenih
python etl/05_export_population.py     # ~10 s — populacija sidecar JSON
python etl/07_bin_cells_to_tiles.py    # ~5 s — F1 partial-load shards
python etl/08_flag_unbuildable.py      # ~20 s — označi zaščitene celice
python etl/06_upload_to_supabase.py    # ~30 s — naloži vse v lokalni Supabase
cd ..
```

> `06_upload_to_supabase.py` bere `SUPABASE_SERVICE_KEY` iz `backend/.env`. Če ste izpustili korak 8, dobite jasno napako.

### 12 · Zaženite razvojni strežnik

```bash
cd frontend
pnpm dev
```

Odprite <http://localhost:3000> **v Windows brskalniku**. Občinski choropleth se naloži v nekaj sekundah; klik na občino ali heks odpre Scorecard.

---

## 🔄 Vsakdanji razvojni postopek *(po prvi namestitvi)*

```bash
# V novem WSL terminalu. Docker Desktop mora teči na Windows-u.
sudo chmod 666 /var/run/docker.sock     # samo če se je Docker daemon znova zagnal
cd ~/15min-visualizer/backend
supabase start                          # ~3 s, če je že inicializiran
docker start valhalla-slo               # takojšen, če je že zgrajen
cd ../frontend
pnpm dev                                # → http://localhost:3000 v Windows brskalniku
```

Zaustavitev vsega:
```bash
cd ~/15min-visualizer/backend
supabase stop
docker stop valhalla-slo
# Nato Ctrl-C v `pnpm dev` oknu.
```

## 🔁 Ponovno poganjanje ETL-ja

Poženite samo skripto, katere vhodi so se spremenili:

| Skripta | Kdaj pognati |
|---|---|
| `01_extract_amenities.py` | OSM ekstrakt posodobljen ali so se kategorije spremenile |
| `02_isochrones.py` | Spremenjena množica dobrin (nadaljevalno — žene samo manjkajoče vrstice) |
| `03_score_cells.py` | Sprememba formule ocenjevanja ali H3 resolucije |
| `05_export_population.py` | Po `03`, če se je spremenila agregacija populacije |
| `07_bin_cells_to_tiles.py` | Po `03`, če želite sveže partial-load shards |
| `08_flag_unbuildable.py` | Po spremembi `protected_areas` |
| `06_upload_to_supabase.py` | Po katerikoli od zgornjih, da naložite v Supabase |

## 🔧 Odpravljanje težav

| Simptom | Rešitev |
|---|---|
| `docker: command not found` v WSL | Docker Desktop ne teče ali WSL integracija ni omogočena. Odprite Docker Desktop → Settings → Resources → WSL Integration |
| `permission denied while trying to connect to the Docker daemon socket` | `sudo chmod 666 /var/run/docker.sock` (znova po vsakem zagonu Docker daemonsa) |
| `pnpm: command not found` | `sudo corepack enable pnpm`, nato zaprite in znova odprite WSL terminal |
| Frontend kaže »Podatki s strežnika niso dosegljivi (Failed to fetch)« v Windows brskalniku | WSL2 ne forwarda port 54321. Preverite, da je `NEXT_PUBLIC_SUPABASE_URL=/sb` (ne surov URL) v `frontend/.env.local`, nato znova poženite `pnpm dev`, da `next.config.mjs` ujame rewrite |
| Frontend prikazuje rumeno »vzorčne celice« obvestilo | Supabase ne teče ali nalaganje ni bilo izvedeno. `supabase status` mora pokazati vse storitve gor; nato znova poženite `06_upload_to_supabase.py` |
| Scorecard obstane na »Nalagam …« | Odprite devtools → Network. Poiščite `/sb/rest/v1/cell_scores?h3=eq.` in `/sb/rest/v1/rpc/amenities_for_point`. 401 pomeni, da se anon ključ ne ujema v `.env.local`; 404 pomeni, da ETL upload skripta ni bila pognana |
| Valhalla container vrača 405 v brskalniku | Po načrtu; aplikacija kliče Valhalla preko `/api/valhalla/*` (strežniški proxy). Ne kličite porta 8002 direktno iz brskalnika |
| Photon dropdown vrne 400 | `&lang=sl` ni podprt s strani Photona; koda ga že izpušča. Ne dodajajte ga nazaj |
| Photon popolnoma nedosegljiv | Iskalnik samodejno preklopi na Nominatim (`nominatim.openstreetmap.org/search`), omejen na Slovenijo. Če oba ne delujeta, dropdown prikaže »Iskanje naslova ni na voljo« |
| `/api/llm` vrne 501 | `OPENROUTER_API_KEY` ni nastavljen v `.env.local`. Chatbot kliče OpenRouter; nastavite ključ ali skrijte chat za demo |
| Slow file-watch / `EBUSY` napake | Repo je na `/mnt/c/...`. Premaknite ga na WSL filesystem (`~/`) |
| ETL `08_flag_unbuildable.py` propade z »relation does not exist« | Migracije niso aplicirane. Poženite `supabase db reset --local` in poskusite znova |
| `supabase start` obstane na »Pulling postgres...« | Docker Desktop se je pravkar zbudil — počakajte minuto. Če nikoli ne konča, ročno `docker pull supabase/postgres:17.X.X` |

---

## 📄 Licenca

Apache 2.0.
