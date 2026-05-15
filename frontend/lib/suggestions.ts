const OPN_WFS = "https://ipi.eprostor.gov.si/wfs-si-mnvp-pa/wfs";
const GURS_BUILDINGS_WFS = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs";

export const CAT_LABELS = [
  "Trgovina", "Izobraževanje", "Zdravstvo", "Park",
  "Javni promet", "Šport", "Storitve", "Delo",
];
export const CAT_ICONS = ["🛒", "🎓", "⚕️", "🌳", "🚌", "🏟️", "✂️", "💼"];

export const ZONE_REASONS: Record<string, Record<number, string>> = {
  CU: {
    0: "Centralna cona — primerna za trgovine in prodajalne",
    1: "Centralna cona — primerna za šole in vrtce",
    2: "Centralna cona — primerna za zdravstvene ustanove",
    6: "Centralna cona — primerna za storitvene dejavnosti",
    7: "Centralna cona — primerna za pisarne in coworking",
  },
  CD: {
    0: "Druga centralna cona — primerna za trgovine",
    1: "Druga centralna cona — primerna za izobraževanje",
    2: "Druga centralna cona — primerna za zdravstvo",
    6: "Druga centralna cona — primerna za storitve",
    7: "Druga centralna cona — primerna za delovne prostore",
  },
  ZS: {
    3: "Rekreacijska cona — primerna za park ali zeleno površino",
    5: "Rekreacijska cona — primerna za šport in igrišča",
  },
  CZ: {
    3: "Zelena površina — namenjena parkom in javnemu zelenilu",
  },
  ZD: {
    3: "Urejena zelena površina — primerna za park",
    5: "Urejena zelena površina — primerna za rekreacijo",
  },
  PO: {
    7: "Gospodarska cona — primerna za pisarne in podjetja",
  },
  PI: {
    7: "Industrijska cona — primerna za delovne prostore",
  },
};

const CAT_ZONES: (string[] | null)[] = [
  ["CU", "CD"],        // 0 Trgovina
  ["CU", "CD"],        // 1 Izobraževanje
  ["CU", "CD"],        // 2 Zdravstvo
  ["CZ", "ZD", "ZS"],  // 3 Park
  null,                // 4 Javni promet
  ["ZS", "ZD"],        // 5 Šport
  ["CU", "CD"],        // 6 Storitve
  ["PO", "PI", "CU"],  // 7 Delo
];

export const ZONE_LABELS: Record<string, string> = {
  CU: "Centralne dejavnosti",
  CD: "Centralne dejavnosti",
  ZS: "Šport in rekreacija",
  CZ: "Zelena površina",
  ZD: "Zelena površina",
  PO: "Gospodarska cona",
  PI: "Industrijska cona",
};

export type Suggestion = {
  categoryIndex: number;
  lat: number;
  lng: number;
  zoneCode: string;
  zoneDesc: string;
  distanceM: number;
  source: "fro" | "opn";
};

// Ray-casting point-in-polygon (GeoJSON coords are [lng, lat]).
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeom(lng: number, lat: number, geom: GeoJSON.Geometry): boolean {
  if (geom.type === "Polygon") {
    const rings = (geom as GeoJSON.Polygon).coordinates;
    return pointInRing(lng, lat, rings[0]) &&
      rings.slice(1).every((hole) => !pointInRing(lng, lat, hole));
  }
  if (geom.type === "MultiPolygon") {
    return (geom as GeoJSON.MultiPolygon).coordinates.some((poly) =>
      pointInRing(lng, lat, poly[0]) &&
      poly.slice(1).every((hole) => !pointInRing(lng, lat, hole))
    );
  }
  return false;
}

// Returns the first exterior ring of a polygon/multipolygon geometry.
function outerRing(geom: GeoJSON.Geometry): number[][] | null {
  if (geom.type === "Polygon") return (geom as GeoJSON.Polygon).coordinates[0];
  if (geom.type === "MultiPolygon") return (geom as GeoJSON.MultiPolygon).coordinates[0][0];
  return null;
}

// Find a point inside the zone polygon that avoids building footprints.
// Samples a 7×7 grid within the zone bbox, keeps candidates inside the zone
// but outside all buildings, then picks the one furthest from any building.
// Falls back to the zone centroid if no empty spot is found.
function findEmptyPoint(
  zoneGeom: GeoJSON.Geometry,
  buildings: GeoJSON.Geometry[],
): [number, number] {
  const ring = outerRing(zoneGeom);
  if (!ring) return [0, 0];

  const lngs = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const centLng = (minLng + maxLng) / 2;
  const centLat = (minLat + maxLat) / 2;

  // Quick path: centroid not in any building → use it.
  if (!buildings.some((b) => pointInGeom(centLng, centLat, b))) {
    return [centLat, centLng];
  }

  // Build flat list of building outer rings for distance checks.
  const bRings: number[][][] = [];
  for (const b of buildings) {
    const r = outerRing(b);
    if (r) bRings.push(r);
  }

  const N = 7;
  let bestLat = centLat, bestLng = centLng, bestDist = -1;

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const sLng = minLng + ((maxLng - minLng) * i) / N;
      const sLat = minLat + ((maxLat - minLat) * j) / N;

      if (!pointInGeom(sLng, sLat, zoneGeom)) continue;
      if (buildings.some((b) => pointInGeom(sLng, sLat, b))) continue;

      // Min squared distance to nearest building ring vertex.
      let minD2 = Infinity;
      for (const r of bRings) {
        for (const [bx, by] of r) {
          const d2 = (sLng - bx) ** 2 + (sLat - by) ** 2;
          if (d2 < minD2) minD2 = d2;
        }
      }

      if (minD2 > bestDist) {
        bestDist = minD2;
        bestLat = sLat;
        bestLng = sLng;
      }
    }
  }

  return [bestLat, bestLng];
}

// Module-level FRO cache — fetched once on first hexagon click.
let froCache: GeoJSON.Feature[] | null = null;

async function loadFro(): Promise<GeoJSON.Feature[]> {
  if (froCache !== null) return froCache;
  try {
    const res = await fetch("/data/fro.geojson");
    if (!res.ok) { froCache = []; return []; }
    const fc = (await res.json()) as GeoJSON.FeatureCollection;
    froCache = fc.features;
  } catch {
    froCache = [];
  }
  return froCache;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchBuildings(
  bbox: string,
  signal?: AbortSignal,
): Promise<GeoJSON.Geometry[]> {
  // STAVBE_OBRIS = building footprint polygons from GURS cadastre.
  // This WFS requires BBOX as a query param (not CQL_FILTER) for spatial filtering.
  const url =
    `${GURS_BUILDINGS_WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=SI.GURS.KN:STAVBE_OBRIS&SRSNAME=EPSG:4326&OUTPUTFORMAT=application/json` +
    `&COUNT=300&BBOX=${bbox},EPSG:4326`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const fc = (await res.json()) as GeoJSON.FeatureCollection;
    return fc.features.map((f) => f.geometry);
  } catch {
    return [];
  }
}

export async function fetchSuggestions(
  lat: number,
  lng: number,
  missingCategories: number[],
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const relevant = missingCategories.filter((i) => CAT_ZONES[i] !== null);
  if (relevant.length === 0) return [];

  const allZones = [...new Set(relevant.flatMap((i) => CAT_ZONES[i]!))];
  const zonesStr = allZones.map((z) => `'${z}'`).join(",");

  const dlat = 0.018;
  const dlng = 0.025;
  const bbox = `${lng - dlng},${lat - dlat},${lng + dlng},${lat + dlat}`;

  const opnUrl =
    `${OPN_WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=SI.MNVP.PA:NRP_OPN&SRSNAME=EPSG:4326&OUTPUTFORMAT=application/json` +
    `&CQL_FILTER=BBOX(GEOM,${bbox},'EPSG:4326')+AND+NRP_OZN+IN+(${zonesStr})`;

  // Fetch OPN zones, buildings, and FRO degraded areas in parallel.
  const [opnRes, buildings, froFeatures] = await Promise.all([
    fetch(opnUrl, { signal }),
    fetchBuildings(bbox, signal),
    loadFro(),
  ]);

  if (!opnRes.ok) return [];
  const fc = (await opnRes.json()) as GeoJSON.FeatureCollection;

  // Pre-filter FRO polygons whose centroid is within 2 km.
  const nearbyFro = froFeatures
    .map((f) => {
      const ring = outerRing(f.geometry as GeoJSON.Geometry);
      if (!ring) return null;
      const clng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      const clat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      return { geom: f.geometry as GeoJSON.Geometry, clat, clng, dist: haversineM(lat, lng, clat, clng) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.dist < 2000)
    .sort((a, b) => a.dist - b.dist);

  const suggestions: Suggestion[] = [];

  for (const catIdx of relevant) {
    // Priority 1: nearest FRO degraded area.
    if (nearbyFro.length > 0) {
      const fro = nearbyFro[0];
      const [pinLat, pinLng] = findEmptyPoint(fro.geom, buildings);
      suggestions.push({
        categoryIndex: catIdx,
        lat: pinLat,
        lng: pinLng,
        zoneCode: "FRO",
        zoneDesc: "Degradirano območje",
        distanceM: fro.dist,
        source: "fro",
      });
      continue;
    }

    // Priority 2: nearest matching OPN zone.
    const zones = CAT_ZONES[catIdx]!;
    let best: { suggestion: Suggestion; geom: GeoJSON.Geometry } | null = null;

    for (const feature of fc.features) {
      const code = feature.properties?.NRP_OZN as string;
      if (!zones.includes(code)) continue;

      const ring = outerRing(feature.geometry as GeoJSON.Geometry);
      if (!ring) continue;

      const clng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      const clat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      const dist = haversineM(lat, lng, clat, clng);

      if (!best || dist < best.suggestion.distanceM) {
        best = {
          geom: feature.geometry as GeoJSON.Geometry,
          suggestion: {
            categoryIndex: catIdx,
            lat: clat,
            lng: clng,
            zoneCode: code,
            zoneDesc: ZONE_LABELS[code] ?? feature.properties?.NRP_OPIS ?? code,
            distanceM: dist,
            source: "opn",
          },
        };
      }
    }

    if (!best) continue;

    const [pinLat, pinLng] = findEmptyPoint(best.geom, buildings);
    best.suggestion.lat = pinLat;
    best.suggestion.lng = pinLng;
    suggestions.push(best.suggestion);
  }

  return suggestions;
}
