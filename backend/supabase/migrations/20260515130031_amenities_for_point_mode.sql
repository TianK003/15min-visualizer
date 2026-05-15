-- Extend amenities_for_point with an optional p_mode parameter so the
-- frontend can request bike-reachable amenities (which uses bike isochrones
-- baked in 02_isochrones.py --costing bicycle) just by passing 'bicycle'.
--
-- Default stays 'pedestrian' so any existing caller keeps working.
--
-- The old single-arg signature would now be ambiguous if we just added the
-- parameter to the existing function — drop it first.

drop function if exists public.amenities_for_point(double precision, double precision);

create or replace function public.amenities_for_point(
  p_lat  double precision,
  p_lng  double precision,
  p_mode text default 'pedestrian'
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
  where ai.mode = p_mode
    and st_within(
      st_setsrid(st_makepoint(p_lng, p_lat), 4326),
      ai.polygon
    )
  group by a.id, a.category, a.name, a.geom
  order by walk_min asc, a.category asc;
$$;

grant execute on function public.amenities_for_point(double precision, double precision, text)
  to anon, authenticated;
