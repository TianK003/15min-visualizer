# Data Sources

All raw data lives under `data/15min-slo/`. Every command below is one line — paste as-is.

## 1. OpenStreetMap — Slovenia extract

**What it's for:** the foundation of everything. Roads feed Valhalla's routing. Buildings mark "populated" cells. Points/POIs (shops, schools, clinics, parks, transit stops, etc.) populate the 8 amenity categories that drive the 15-minute score.

**Source:** Geofabrik daily extract — https://download.geofabrik.de/europe/slovenia.html
**License:** ODbL (attribution required, share-alike on derivatives).

```bash
curl -o ~/15minut/data/15min-slo/slovenia-latest.osm.pbf https://download.geofabrik.de/europe/slovenia-latest.osm.pbf
```

## 2. GURS — Občine boundaries (212 municipalities)

**What it's for:** the polygon overlay for Mode C (planner choropleth), hover labels in all modes, and per-občina aggregations in narrative slides.

**Source:** community-maintained mirror of the official GURS RPE dataset — https://github.com/stefanb/gurs-rpe
**Why the mirror and not the official eProstor API:** the official OGC API endpoint paginates by default and returns a metadata descriptor at the obvious URL; the mirror is a clean single-file GeoJSON, same data, same CC-BY 4.0 license.

```bash
curl -L -o ~/15minut/data/15min-slo/obcine.geojson https://raw.githubusercontent.com/stefanb/gurs-rpe/master/OB.geojson
```

## 3. ARSO — Zavarovana območja (Slovenian protected areas)

**What it's for:** the "non-applicable" hatched overlay. Triglav National Park, regional/landscape parks, nature reserves, monuments — places where the 15-min score is suppressed because the area is legally protected and not normal residential land.

**Source:** ARSO production GeoServer WFS — `gis.arso.gov.si/geoserver/ows`, layer `ARSO:ZOS_ZO_PLG_DRZ` (~531 polygons, ~4 MB).
**License:** ARSO open data, attribution required.

```bash
curl -o ~/15minut/data/15min-slo/zavarovana_si.geojson 'http://gis.arso.gov.si/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=ARSO:ZOS_ZO_PLG_DRZ&outputFormat=application/json&srsName=EPSG:4326'
```

## 4. ARSO — Natura 2000 (EU ecological network)

**What it's for:** same purpose as Zavarovana območja, but covers a much larger share of the country (~37% of Slovenia, vs ~12% for the strict national register). Adds Pohorje, Kočevski rog, river corridors, etc. Render together as one merged "non-applicable" mask, or as two separate hatch patterns.

**Source:** same ARSO GeoServer, layer `ARSO:ZOS_N2K_PLG` (~355 polygons).
**License:** ARSO open data; underlying Natura 2000 designations are EU-wide.

```bash
curl -o ~/15minut/data/15min-slo/natura2000_si.geojson 'http://gis.arso.gov.si/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=ARSO:ZOS_N2K_PLG&outputFormat=application/json&srsName=EPSG:4326'
```

## 5. Kontur — Population density (Slovenia, H3 400 m)

**What it's for:** the demand side. Investor-mode "how many people benefit from this score?" needs population per cell. Also masks cells with zero residents so we don't paint scores on empty forest. H3-native means we can roll it into our res 9 grid with `cellToParent`.

**Source:** Kontur Population Slovenia, hosted on HDX — https://data.humdata.org/dataset/kontur-population-slovenia
**Why this and not SURS:** Kontur fuses Microsoft/Meta/WorldPop building footprints into a calibrated H3 layer — much better "where people actually live" signal than a uniform census grid. SURS only publicly exposes a 1 km grid; their 100 m grid isn't downloadable without friction. Recency gap (2023 → 2025) is invisible for a 15-min-city map.
**License:** CC BY 4.0.

```bash
# Grab the current resource URL from the dataset page (resource URL rotates on updates):
# https://data.humdata.org/dataset/kontur-population-slovenia
# At time of writing, the file in this repo is kontur_population_SI.gpkg (~4 MB).
```

## 6. Basemap — OpenFreeMap (no download, hosted tiles)

**What it's for:** the visual canvas underneath every other layer. Streets, buildings, terrain shading.

**Source:** OpenFreeMap — https://openfreemap.org/
**Why this and not Maptiler:** free, no API key, no registration, no cookies, no view limits, vector-tile MapLibre-native. Matches the hackathon's open-source mandate. The `positron` style is visually equivalent to Maptiler's "Dataviz Light."

```ts
// MapLibre style URL — drop this directly into the map config:
style: 'https://tiles.openfreemap.org/styles/positron'
```

---

## Verification after every download

```bash
jq '.features | length' ~/15minut/data/15min-slo/obcine.geojson         # ~212
jq '.features | length' ~/15minut/data/15min-slo/zavarovana_si.geojson  # ~531
jq '.features | length' ~/15minut/data/15min-slo/natura2000_si.geojson  # ~355
osmium fileinfo ~/15minut/data/15min-slo/slovenia-latest.osm.pbf        # ~300 MB, several M nodes
```

If any of the JSON checks errors with "parse error," `head -c 200` on the file — you'll see an `<ows:Exception>` block telling you exactly what the WFS server rejected.
