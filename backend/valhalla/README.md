# Valhalla container

Wraps the upstream `ghcr.io/gis-ops/docker-valhalla/valhalla:latest` image with the Slovenia OSM extract baked in. Exposes the standard Valhalla HTTP API on port 8002.

## Build + run locally

```bash
docker build -t valhalla-slo .
docker run -d -p 8002:8002 --name valhalla-slo valhalla-slo
docker logs -f valhalla-slo
```

First boot triggers the graph build (~5–10 min on the SI extract). Watch for `loki_worker_t::process` ready signal in the logs.

## Smoke test

```bash
curl -X POST http://localhost:8002/isochrone \
  -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":46.0512,"lon":14.5061}],"costing":"pedestrian","contours":[{"time":15}],"polygons":true}'
```

Returns a GeoJSON polygon. Paste it into [geojson.io](https://geojson.io) — it should cover central Ljubljana.

## Railway deployment

Railway will detect the `Dockerfile` automatically. After deploy, the public URL goes into the frontend's `NEXT_PUBLIC_VALHALLA_URL` env var.
