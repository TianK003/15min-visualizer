# Valhalla routing container with Slovenia OSM baked in.
# Wraps the upstream gis-ops image and downloads the SI PBF at build time so
# Railway gets a self-contained image ready to serve isochrone requests.

FROM ghcr.io/gis-ops/docker-valhalla/valhalla:latest

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /custom_files \
    && curl -fL -o /custom_files/slovenia-latest.osm.pbf \
        https://download.geofabrik.de/europe/slovenia-latest.osm.pbf

ENV tile_urls=""
ENV use_tiles_ignore_pbf=False
ENV build_elevation=False
ENV build_admins=True
ENV build_time_zones=False
ENV force_rebuild=True

EXPOSE 8002
