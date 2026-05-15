-- The 0–8 score on cell_scores was historically walking-only. The new pipeline
-- computes the same metric for biking; both are stored side-by-side so the
-- frontend mode toggle (Hoja / Kolo) can recolor the map without a refetch.
--
-- We keep the `score` column as an alias for walk_score (renamed via view-less
-- update) — easier than a destructive rename plus app rewire.

alter table public.cell_scores
  rename column score to walk_score;

alter table public.cell_scores
  add column if not exists bike_score smallint not null default 0
    check (bike_score between 0 and 8);

create index if not exists cell_scores_walk_score_ix on public.cell_scores (walk_score);
create index if not exists cell_scores_bike_score_ix on public.cell_scores (bike_score);

-- The original `cell_scores_score_ix` is now `cell_scores_walk_score_ix` via rename
-- happens implicitly with the column rename above? Postgres keeps the old name —
-- explicit re-create above ensures both indices exist with predictable names.
drop index if exists cell_scores_score_ix;
