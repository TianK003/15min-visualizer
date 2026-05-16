-- 0004_llm_search_v2.sql — schema + RPC for the v2 LLM-driven search.

-- (1) obcine.sifra needs a UNIQUE constraint so it can act as the FK target
-- for obcine_demographics. The existing data has 212 distinct sifras (1..212),
-- so this never raises. Wrapped in DO so re-running the migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'obcine_sifra_unique' AND conrelid = 'public.obcine'::regclass
  ) THEN
    ALTER TABLE public.obcine ADD CONSTRAINT obcine_sifra_unique UNIQUE (sifra);
  END IF;
END$$;

-- (2) Demographics table — kept separate from `obcine` so demographic
-- refreshes don't churn polygon geometry rows.
CREATE TABLE IF NOT EXISTS public.obcine_demographics (
  sifra integer PRIMARY KEY REFERENCES public.obcine(sifra) ON DELETE CASCADE,
  el65  real NOT NULL,
  kids  real NOT NULL
);

ALTER TABLE public.obcine_demographics ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'obcine_demographics' AND policyname = 'public read obcine_demographics'
  ) THEN
    CREATE POLICY "public read obcine_demographics"
      ON public.obcine_demographics FOR SELECT USING (true);
  END IF;
END$$;

-- (3) Per-cell občina assignment + centroid for km-scale distance math.
-- All three are nullable; ~2.6% of cells fall outside any obcina polygon
-- (sea / border cells) and stay NULL. The INNER JOIN in the RPC drops them.
ALTER TABLE public.cell_scores
  ADD COLUMN IF NOT EXISTS sifra        integer,
  ADD COLUMN IF NOT EXISTS centroid_lat real,
  ADD COLUMN IF NOT EXISTS centroid_lng real;

CREATE INDEX IF NOT EXISTS cell_scores_sifra_ix ON public.cell_scores (sifra);

-- (4) The RPC. Soft category filtering (counts how many of `required` a cell
-- reaches, used as a score component, not a WHERE filter). Server-side weight
-- normalization so we don't trust the LLM's arithmetic.
CREATE OR REPLACE FUNCTION public.search_cells_v2(
  filter_spec     jsonb,
  ranking_weights jsonb,
  target_lat      real    DEFAULT NULL,
  target_lng      real    DEFAULT NULL,
  p_limit         integer DEFAULT 5
) RETURNS TABLE (
  h3            text,
  sifra         integer,
  obcina_name   text,
  walk_score    smallint,
  bike_score    smallint,
  walk_min      smallint[],
  population    real,
  el65          real,
  kids          real,
  cats_hit      integer,
  cats_required integer,
  composite     real
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  req_cats integer[];
  h3_list  text[];
  w_cat    real := COALESCE((ranking_weights->>'categories')::real,  0);
  w_pop    real := COALESCE((ranking_weights->>'population')::real,  0);
  w_dem    real := COALESCE((ranking_weights->>'demand')::real,      0);
  w_prox   real := COALESCE((ranking_weights->>'proximity')::real,   0);
  w_bike   real := COALESCE((ranking_weights->>'bikeability')::real, 0);
  w_sum    real;
BEGIN
  w_sum := w_cat + w_pop + w_dem + w_prox + w_bike;
  IF w_sum = 0 THEN
    w_cat := 1; w_sum := 1;
  END IF;
  w_cat  := w_cat  / w_sum;  w_pop  := w_pop  / w_sum;
  w_dem  := w_dem  / w_sum;  w_prox := w_prox / w_sum;
  w_bike := w_bike / w_sum;

  IF filter_spec ? 'required_category_indices' THEN
    req_cats := (SELECT array_agg(x::text::integer)
                 FROM jsonb_array_elements(filter_spec->'required_category_indices') x);
  END IF;
  IF filter_spec ? 'h3_in' THEN
    h3_list := (SELECT array_agg(x::text)
                FROM jsonb_array_elements_text(filter_spec->'h3_in') x);
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT
      c.h3, c.sifra, o.naziv AS obcina_name,
      c.walk_score, c.bike_score, c.walk_min, c.population,
      d.el65, d.kids,
      c.centroid_lat, c.centroid_lng,
      COALESCE(array_length(req_cats, 1), 0) AS cats_required,
      COALESCE((SELECT count(*) FROM unnest(req_cats) x
                WHERE c.walk_min[x + 1] IS NOT NULL
                  AND c.walk_min[x + 1] <= 15), 0)::integer AS cats_hit
    FROM public.cell_scores c
    JOIN public.obcine o                    ON o.sifra = c.sifra
    LEFT JOIN public.obcine_demographics d  ON d.sifra = c.sifra
    WHERE c.population > 0
      AND (h3_list IS NULL OR c.h3 = ANY(h3_list))
  ),
  scored AS (
    SELECT *,
      CASE WHEN cats_required = 0 THEN 1.0
           ELSE cats_hit::real / cats_required END                              AS n_cat,
      LEAST(population / 5000.0, 1.0)                                           AS n_pop,
      LEAST((population * (1.0 - walk_score::real / 8.0)) / 3000.0, 1.0)        AS n_dem,
      CASE WHEN target_lat IS NULL OR centroid_lat IS NULL THEN 0
           ELSE GREATEST(0, 1.0 - LEAST(
             sqrt(power((centroid_lat - target_lat) * 111.0, 2) +
                  power((centroid_lng - target_lng) * 77.5, 2)) / 15.0, 1.0))
      END                                                                       AS n_prox,
      bike_score::real / 8.0                                                    AS n_bike
    FROM candidate
  )
  SELECT h3, sifra, obcina_name, walk_score, bike_score, walk_min, population,
         el65, kids, cats_hit, cats_required,
         (w_cat * n_cat + w_pop * n_pop + w_dem * n_dem +
          w_prox * n_prox + w_bike * n_bike)::real AS composite
  FROM scored
  ORDER BY composite DESC, population DESC NULLS LAST, h3 ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_cells_v2(jsonb, jsonb, real, real, integer)
  TO anon, authenticated;
