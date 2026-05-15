-- amenity_isochrones is exposed via PostgREST through the `public` schema.
-- The original 0001_init.sql enabled RLS on every other table but missed
-- this one. Enable RLS + permit anonymous read so the existing
-- amenities_for_point RPC (security invoker) keeps working.
alter table public.amenity_isochrones enable row level security;
create policy "public read amenity_isochrones"
  on public.amenity_isochrones for select using (true);
