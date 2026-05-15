-- amenities_for_point: given a (lat, lng) for a cell centroid, return every
-- amenity whose precomputed walking isochrone covers that point. The smallest
-- contour_min that still contains the point is the cell's walk time to that
-- amenity. Replaces the materialized cell_amenities table.
create or replace function public.amenities_for_point(
  p_lat double precision,
  p_lng double precision
)
returns table (
  amenity_id bigint,
  category   text,
  name       text,
  walk_min   smallint,
  lat        double precision,
  lng        double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    a.id                                                 as amenity_id,
    a.category                                           as category,
    a.name                                               as name,
    min(ai.contour_min)::smallint                        as walk_min,
    st_y(a.geom)::double precision                       as lat,
    st_x(a.geom)::double precision                       as lng
  from public.amenities a
  join public.amenity_isochrones ai on ai.amenity_id = a.id
  where ai.mode = 'pedestrian'
    and st_within(
      st_setsrid(st_makepoint(p_lng, p_lat), 4326),
      ai.polygon
    )
  group by a.id, a.category, a.name, a.geom
  order by walk_min asc, a.category asc;
$$;

-- Expose via PostgREST RPC for anonymous clients.
grant execute on function public.amenities_for_point(double precision, double precision)
  to anon, authenticated;
