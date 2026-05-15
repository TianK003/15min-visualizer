-- Per TASKS §B4: cells whose centroid falls inside a protected area
-- (Natura 2000 or zavarovana območja) are "unbuildable" — investor mode
-- (E1) skips them when ranking demand, and the frontend can render them
-- with a distinct hatched pattern.
--
-- The mountain-terrain part of the original spec (slope > 30° OR
-- elevation > 1500m) needs a DEM ingest that's out of scope here; the
-- column is a generic boolean so we can OR more sources into it later.
alter table public.cell_scores
  add column if not exists unbuildable boolean not null default false;

create index if not exists cell_scores_unbuildable_ix
  on public.cell_scores (unbuildable)
  where unbuildable;
