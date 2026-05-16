# Frontend — 15min Slovenija

Next.js 14 (App Router) + MapLibre GL JS + deck.gl. Prikazuje podlago, meje občin in vročinski H3 heksagonalni sloj v res-10. Heksagonski sloj bere prave ocene iz `public/data/cell_scores_lite.json` (zgrajeno z `../backend/etl/03_score_cells.py`); rezerva s testno Ljubljano se vklopi le, če datoteka manjka.

## Hitri začetek

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Preverjanje tipov:
```bash
pnpm typecheck
```

Produkcijska gradnja:
```bash
pnpm build && pnpm start
```

## Kaj vidiš

- **Podlaga:** OpenFreeMap slog `liberty` (gostovan, brez API ključa — preklopljeno z `positron` zaradi boljše barvne nasičenosti skozi heksagone z alfa 0,5).
- **Sloj 1, zoom < 9:** 212 občin obarvanih po populacijsko uteženem povprečnem rezultatu (`public/data/obcine_scored.geojson`).
- **Sloj 2, zoom ≥ 9:** H3 heksagonalni vročinski sloj. Pripravljen v res-10 (~66 m rob, ~1,08 M celic), na strani brskalnika agregiran v res 6/7/8/9/10 glede na zoom — glej `zoomToResolution()` v `components/Map.tsx`. Pri zoomu ≥ 13 so obrobe heksagonov in izbiranje na lebdenje izklopljeni zaradi performans.

## Funkcije

### Kartica občine ob kliku (zoom < 9)
Klik na občino odpre stekleno kartico s povzetkom občine:
- ime občine, število prebivalcev, površina (km²) in gostota,
- povprečna 15-minutna ocena hoje oz. kolesarjenja (0–8) z barvnim značko,
- delež prebivalcev brez 15-minutnega dostopa do vsake od 8 kategorij (trgovina, izobraževanje, zdravstvo, park, javni promet, šport, storitve, delo).

Vrednosti za delež brez dostopa so prepečene v ETL koraku (`backend/etl/03_score_cells.py:aggregate_obcine`) in serializirane kot `walk_missing` / `bike_missing` v `obcine_scored.geojson`, tako da klik ne sproži nobene mrežne zahteve.

Izbrana občina dobi na zemljevidu poudarek (+0,15 alfe), tako da takoj vidiš, katera kartica pripada kateri občini.

### Heksagonalna kartica ob kliku (zoom ≥ 9)
Klik na heks odpre kartico celice s podrobnim povzetkom:
- skupna ocena 15-minutnega mesta (0–8) z barvno značko,
- število prebivalcev,
- vrstica za vsako od 8 kategorij s časom pešhoje ali kolesarjenja **z natančnostjo 1 minute** (1–15 min).

Natančnost 1 minute: vrednost v vrstici ni več zaokrožena na 5-min korake iz prednapečenih izokron, temveč izračunana ob kliku — Valhalla vrne dejanske čase potovanja do vsake bližnje lokacije v kategoriji (`amenities_for_point` RPC), kartica pa pokaže najkrajši čas, omejen na 1–15 min. Tako vrstica »Trgovina ✓ 7 min« kaže realen najkrajši dostop, namesto privzetega »10 min« iz 5-min korakov.

### Iskanje po naslovu in lokacijah
- **Iskanje po naslovu** spremeni izvorno točko v kartici na natančno koordinato naslova (namesto centroida celice). Vse Valhalla zahteve — izokrone, časi do lokacij, poti — uporabljajo to točko, tako da rezultati odražajo dejansko izhodišče uporabnika.
- **Klik na ✓ vrstico kategorije** sproži Valhalla `route` zahtevo do vsake dosegljive lokacije v kategoriji (do `MAX_PATHS_PER_CATEGORY`) in nariše animirane poti s časovnim razprtjem 0–500 ms (`buildAnimatedPaths` + `TripsLayer`).
- **»Prikaži dosegljivost (15 min hoje/kolesarjenja)«** prikaže Valhalla izokrono kot poligon prek heksagonov.

### Mehkejša zatemnitev heksagonov ob prikazu poti
Ko je prikazana izokrona ali kategorične poti, vsi nepovezani heksagoni dobijo manjšo alfo (–0,30), izbrana celica pa –0,15 — tako poti in območje dosega lepše izstopijo. Prehod animira lasten `requestAnimationFrame` v 500 ms (enako kot razprtje poti).

## Performans

H3 heksagonalni sloj je optimiziran z **predfilterom po H3 res-6 starših** in **izrezom glede na pogled** (viewport culling), tako da se pri visokih zoomih namesto vseh ~1,08 M celic agregira le tistih nekaj tisoč, ki so znotraj vidnega okvira.

- Ob nalaganju se vsaka izvorna tabela (score-cells, demand-cells, unpop-cells) enkrat shrani v `Map<res-6 starš, T[]>`. Ta indeks je precej manjši od polnega seznama in dovoljuje O(N) izbor vidnih celic.
- Ob vsakem `moveend` se okvir zemljevida razširi na 2× linearno (4× ploščine) in pretvori v množico res-6 celic z `h3.polygonToCells`. Pri zelo bližnjih zoomih, ko je viewport manjši od ene res-6 celice in `polygonToCells` vrne prazen seznam, se kot **varnostna mreža** doda res-6 celica pod sredino pogleda plus njen 1-obroč (`gridDisk` — 7 celic, ~84 km² pokritosti). To zagotavlja, da niti pri zoomu 14+ heksagoni ne izginejo.
- Vmesni `visible*` `useMemo`-ji preplujejo izbrani indeks in producirajo le tiste celice, ki sodijo v okvir. Obstoječi `aggregateMean` / `aggregateDemand` dobita manjši vhod, zato je ponoven izračun ob spremembi zooma ali premika praktično trenuten.
- Prag občine (`zoom < 9`) ostane nedotaknjen — heksagonalni izračuni se v tem območju preskočijo, prikaže se le obarvana ravnina občin.

Rezultat: pri zoomih 9–12 pan brez vidnih zamikov, pri zoomih 13+ heksagoni so vedno prisotni, povratek na občinski pogled pa je takojšen.

## Načrtovane poti

- `/` — Način A · Doma (potrošniški pogled, privzeto)
- `/investitor` — Način B · Investitorjev pogled (obrnjen vročinski sloj)
- `/obcina` — Način C · Občinski načrtovalec

Glej `../docs/TASKS.md` §E za status.

## Datoteke

```
frontend/
├── app/
│   ├── layout.tsx       # korenska HTML lupina
│   ├── page.tsx         # `/` pot — izriše <Map /> + legendo
│   └── globals.css      # postavitev + slogi legende + kartic
├── components/
│   ├── Map.tsx               # MapLibre + deck.gl, glavna logika
│   ├── Scorecard.tsx         # kartica celice (klik na heks)
│   └── ObcinaInfoCard.tsx    # kartica občine (klik na občino)
├── lib/
│   ├── valhalla.ts      # odjemalec za izokrone in poti
│   ├── supabase.ts      # cellScore + amenitiesForPoint + obcinaGeom
│   └── categories.ts    # 8 kategorij (id, slo. oznaka, ikona, barva)
├── public/
│   └── data/
│       ├── obcine_scored.geojson      # 212 občin + walk_missing/bike_missing
│       ├── cell_scores_lite.json      # heksagonalne ocene
│       ├── cell_demand_lite.json      # prednapečena povpraševanje (investitor)
│       └── cell_cat_scores.json       # per-kategorija lokalne pokritosti
├── package.json
├── tsconfig.json
├── next.config.mjs
└── .env.local           # ni v repu — glej CHECKLIST §5.3
```
