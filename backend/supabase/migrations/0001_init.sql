-- Initial schema for 15min Slovenija.
-- Apply with `supabase db push` after the Supabase project is provisioned.
-- See ARCHITECTURE.md §"Phase 1 — ETL components / Storage" for the table reference.

create extension if not exists postgis;
create extension if not exists postgis_topology;
-- h3 extension via dbdev; if it errors, fall back to text H3 columns.
-- create extension if not exists h3;

-- 1. amenities — populated by backend/etl/01_extract_amenities.py
create table if not exists amenities (
  id              bigserial primary key,
  osm_id          bigint,
  category        text not null,
  name            text,
  geom            geometry(Point, 4326) not null,
  source_tags     jsonb
);
create index if not exists amenities_geom_gix on amenities using gist (geom);
create index if not exists amenities_category_ix on amenities (category);

-- 2. amenity_isochrones — populated by 02_isochrones.py
create table if not exists amenity_isochrones (
  amenity_id      bigint references amenities(id) on delete cascade,
  mode            text not null default 'pedestrian',
  contour_min     integer not null default 15,
  polygon         geometry(MultiPolygon, 4326) not null,
  primary key (amenity_id, mode, contour_min)
);
create index if not exists amenity_isochrones_polygon_gix on amenity_isochrones using gist (polygon);

-- 3. cell_scores — populated by 03_score_cells.py
create table if not exists cell_scores (
  h3              text primary key,
  score           smallint not null check (score between 0 and 8),
  walk_min        smallint[] not null,    -- 8 elements, one per category
  bike_min        smallint[] not null,    -- walk_min / 2.5
  population      real
);
create index if not exists cell_scores_score_ix on cell_scores (score);

-- 4. cell_amenities — click-to-show-pins join table
create table if not exists cell_amenities (
  h3              text not null,
  amenity_id      bigint not null references amenities(id) on delete cascade,
  category        text not null,
  walk_min        smallint not null,
  primary key (h3, amenity_id)
);
create index if not exists cell_amenities_h3_ix on cell_amenities (h3);

-- 5. obcine — populated from data/15min-slo/obcine.geojson
create table if not exists obcine (
  id              bigserial primary key,
  sifra           integer,
  naziv           text not null,
  mestna_obcina   boolean default false,
  geom            geometry(MultiPolygon, 4326) not null
);
create index if not exists obcine_geom_gix on obcine using gist (geom);

-- 6. protected_areas — populated from zavarovana_si + natura2000_si
create table if not exists protected_areas (
  id              bigserial primary key,
  source          text not null,   -- 'zavarovana' | 'natura2000'
  category        text,            -- ZO_VRSTA value for zavarovana
  name            text,
  geom            geometry(MultiPolygon, 4326) not null
);
create index if not exists protected_areas_geom_gix on protected_areas using gist (geom);

-- Row-level security: everything is public-read for the anon key.
alter table amenities enable row level security;
alter table cell_scores enable row level security;
alter table cell_amenities enable row level security;
alter table obcine enable row level security;
alter table protected_areas enable row level security;

create policy "public read amenities" on amenities for select using (true);
create policy "public read cell_scores" on cell_scores for select using (true);
create policy "public read cell_amenities" on cell_amenities for select using (true);
create policy "public read obcine" on obcine for select using (true);
create policy "public read protected_areas" on protected_areas for select using (true);
