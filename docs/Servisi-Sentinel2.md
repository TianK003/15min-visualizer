# Satelitski posnetki — WFS / WCS / WMS
Podatkovni vir zagotavlja satelitske posnetke (Sentinel-2) za obdobje **2020 – danes** preko standardnih OGC storitev.

---

## WFS — Footprinti posnetkov
Storitev vrača geometrije in metapodatke (vključno z **datumom posnetka**) za vse razpoložljive Sentinel-2 tile.


```
GET https://fusion.gemma.feri.um.si/gf-test/api/ws/73a869a3-e90f-4d51-8400-4b80205cc6a1/services/ogc/wfs?typeNames=footprints&outputFormat=geojson&request=GetFeature&version=2.0.0
```

---

## WCS — Rastrski podatki
Za pridobitev rastra glede na izbran datum in kanal oziroma indeks:

```
GET https://fusion.gemma.feri.um.si/gf-test/api/ws/73a869a3-e90f-4d51-8400-4b80205cc6a1/services/ogc/wcs
?SERVICE=WCS
&VERSION=1.0.0
&REQUEST=GetCoverage
&FORMAT=image/tiff
&COVERAGE=NDVI
&CRS=EPSG:3857
&BBOX=1614193.413648,5784317.450424,1621496.298173,5788775.309116
&WIDTH=253
&HEIGHT=153
&TIME=2026-04-04T12:00:00.000Z
```

| Parameter | Opis |
|---|---|
| `COVERAGE` | Kanal ali indeks, ki ga želimo pridobiti (npr. `NDVI`, `B04`, `SCL`) |
| `FORMAT` | Format izhoda — priporočeno `image/tiff` |
| `CRS` | Koordinatni sistem BBOX-a in izhoda, npr. `EPSG:3857` (Web Mercator) ali `EPSG:4326` (WGS 84) |
| `BBOX` | Prostorski okvir zahteve v obliki `minX,minY,maxX,maxY` v enotah izbranega CRS |
| `WIDTH` | Širina izhodnega rastra v pikslih |
| `HEIGHT` | Višina izhodnega rastra v pikslih |
| `TIME` | Datum posnetka v ISO 8601 formatu (pridobljen iz WFS footprinta), npr. `2026-04-04T12:00:00.000Z` |

---

## WMS
Storitev vrača vizualizacijo zemljevida kot sliko (PNG).

```
GET https://fusion.gemma.feri.um.si/gf-test/api/ws/73a869a3-e90f-4d51-8400-4b80205cc6a1/services/ogc/wms
?SERVICE=WMS
&REQUEST=Getmap
&LAYERS=NDVI
&STYLES=raster
&CRS=EPSG:3794
&BBOX=543000,153000,554000,160000
&WIDTH=1100
&HEIGHT=700
&FORMAT=image/png
&BGCOLOR=0xffffff
&TRANSPARENT=true
&EXCEPTIONS=XML
&TIME=2020-08-08
```

| Parameter | Opis |
|---|---|
| `LAYERS` | Kanal ali indeks za prikaz (npr. `NDVI`, `TCI`, `B04`) |
| `CRS` | Koordinatni sistem BBOX-a |
| `BBOX` | Prostorski okvir v obliki `minX,minY,maxX,maxY` v enotah izbranega CRS |
| `WIDTH` | Širina izhodne slike v pikslih |
| `HEIGHT` | Višina izhodne slike v pikslih |
| `BGCOLOR` | Barva ozadja v hex zapisu, npr. `0xffffff` (bela) |
| `TRANSPARENT` | Nastavitev za prozorno ozadje (`true` / `false`) |
| `TIME` | Datum posnetka v obliki `YYYY-MM-DD` |

---

## Razpoložljivi kanali in indeksi

### Spektralni kanali (Sentinel-2)

| ID | Naziv |
|---|---|
| `B01` | Aerosol |
| `B02` | Blue |
| `B03` | Green |
| `B04` | Red |
| `B05` | Vegetation Red edge 1 |
| `B06` | Vegetation Red edge 2 |
| `B07` | Vegetation Red edge 3 |
| `B08` | Near infrared |
| `B8A` | Narrow near infrared |
| `B09` | Water vapour |
| `B11`, `B12` | Shortwave infrared |s
| `AOT` | Aerosol Optical Thickness |
| `TCI` | True Colour Image |
| `SCL` | Scene classification |
| `WVP` | Water Vapour map |
| `PVI` | Preview Image |
| `MSK_CLDPRB` | Cloud probability mask |
| `MSK_SNWPRB` | Snow probability mask |

### Indeksi

| ID | Naziv |
|---|---|
| `NDVI` | Normalized Difference Vegetation Index |
| `GNDVI` | Green Normalized Difference Vegetation Index |
| `EVI` | Enhanced Vegetation Index |
| `EVI2` | Enhanced Vegetation Index (B09, B05) |
| `AVI` | Advanced Vegetation Index |
| `SAVI` | Soil Adjusted Vegetation Index |
| `MSAVI2` | Modified Soil Adjusted Vegetation Index (Simplified) |
| `OSAVI` | Agriculture Optimized Soil Adjusted Vegetation Index |
| `ARVI` | Atmospherically Resistant Vegetation Index |
| `SATVI` | Soil-Adjusted Total Vegetation Index |
| `SIPI1` | Structure Insensitive Pigment Index (B01) |
| `SIPI3` | Structure Insensitive Pigment Index (B02) |
| `NPCRI` | Normalized Pigment Chlorophyll Ratio Index |
| `NDRE1` | Normalized Difference Red Edge (B8A-B5) |
| `NDRE2` | Normalized Difference Red Edge (B8A-B6) |
| `NDRE3` | Normalized Difference Red Edge (B8A-B7) |
| `GCI` | Green Coverage Index |
| `NDMI1` | Normalized Difference Moisture Index (B11) |
| `NDMI2` | Normalized Difference Moisture Index (B12) |
| `NDWI` | Normalized Difference Water Index |
| `MSI` | Moisture Stress Index |
| `NDBI` | Normalized Difference Built-up Index |
| `BSI` | Bare Soil Index |
| `NDBSI` | Normalized Difference Bare Soil Index |
| `SI` | Shadow Index |
| `NDSI` | Normalized Difference Snow Index |
| `NDGI` | Normalized Difference Glacier Index |
| `NBRI` | Normalized Burned Ratio Index |
| `LANDSLIDE` | Landslide probability |
| `CLOUD` | Cloud mask |

---

## Omejitve

- Največja dovoljena velikost rastra pri enem WCS klicu je **2000 × 2000 pikslov**. Za večja območja je potrebno zahtevo razdeliti na manjše ploščice.