#!/usr/bin/env bash
# Step 4 — bake the two non-aggregable polygon overlays into PMTiles.
#
# Inputs:
#   data/15min-slo/zavarovana_si.geojson   (protected areas — Slovenian register)
#   data/15min-slo/natura2000_si.geojson   (Natura 2000)
#   (later) data/15min-slo/ljubljana_opn.geojson  (planned developments — ghosts MVP)
#
# Outputs:
#   data/15min-slo/protected.pmtiles   — combined zavarovana + Natura 2000
#   data/15min-slo/ghosts_ljubljana.pmtiles  — Ljubljana planned developments
#
# Upload these to Supabase Storage / Cloudflare R2 after baking; the frontend
# loads them via the pmtiles:// MapLibre protocol.

set -euo pipefail

DATA_DIR="$(cd "$(dirname "$0")/../../data/15min-slo" && pwd)"

# Combine the two protected-area sources into one PMTiles bundle.
# -Z = minzoom, -z = maxzoom. 4–14 covers country to neighborhood.
tippecanoe -o "$DATA_DIR/protected.pmtiles" \
  --force \
  --layer=protected \
  -Z4 -z14 \
  --drop-densest-as-needed \
  "$DATA_DIR/zavarovana_si.geojson" \
  "$DATA_DIR/natura2000_si.geojson"

# TODO once Ljubljana OPN data is on disk:
# tippecanoe -o "$DATA_DIR/ghosts_ljubljana.pmtiles" \
#   --force --layer=ghosts -Z10 -z16 \
#   "$DATA_DIR/ljubljana_opn.geojson"

echo "Done. Upload the .pmtiles files to Supabase Storage."
