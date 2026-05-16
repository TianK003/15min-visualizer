-- 20260516000000_fix_search_cells_v2_ambiguous.sql
--
-- In 0004_llm_search_v2.sql every RETURNS TABLE column name becomes an
-- implicit OUT variable in plpgsql scope. When those names also appear
-- unqualified inside the RETURN QUERY CTEs, PostgreSQL raises
-- "column reference <name> is ambiguous" at runtime. This affects:
--   cats_required, population, walk_score, bike_score, walk_min,
--   h3, sifra, obcina_name, el65, kids, cats_hit, composite
-- Fix: prefix ALL intermediate CTE aliases with "r_" so they never
-- collide with the output column names, then project back to the
-- expected names in the final SELECT.

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
      c.h3                 AS r_h3,
      c.sifra              AS r_sifra,
      o.naziv              AS r_obcina_name,
      c.walk_score         AS r_walk_score,
      c.bike_score         AS r_bike_score,
      c.walk_min           AS r_walk_min,
      c.population         AS r_population,
      d.el65               AS r_el65,
      d.kids               AS r_kids,
      c.centroid_lat       AS r_centroid_lat,
      c.centroid_lng       AS r_centroid_lng,
      COALESCE(array_length(req_cats, 1), 0) AS r_cats_required,
      COALESCE((SELECT count(*) FROM unnest(req_cats) x
                WHERE c.walk_min[x + 1] IS NOT NULL
                  AND c.walk_min[x + 1] <= 15), 0)::integer AS r_cats_hit
    FROM public.cell_scores c
    JOIN public.obcine o                   ON o.sifra = c.sifra
    LEFT JOIN public.obcine_demographics d ON d.sifra = c.sifra
    WHERE c.population > 0
      AND (h3_list IS NULL OR c.h3 = ANY(h3_list))
  ),
  scored AS (
    SELECT *,
      CASE WHEN r_cats_required = 0 THEN 1.0
           ELSE r_cats_hit::real / r_cats_required END          AS n_cat,
      LEAST(r_population / 5000.0, 1.0)                         AS n_pop,
      LEAST((r_population * (1.0 - r_walk_score::real / 8.0))
            / 3000.0, 1.0)                                       AS n_dem,
      CASE WHEN target_lat IS NULL OR r_centroid_lat IS NULL THEN 0
           ELSE GREATEST(0, 1.0 - LEAST(
             sqrt(power((r_centroid_lat - target_lat)  * 111.0, 2) +
                  power((r_centroid_lng - target_lng) * 77.5, 2)) / 15.0,
             1.0))
      END                                                        AS n_prox,
      r_bike_score::real / 8.0                                   AS n_bike
    FROM candidate
  )
  SELECT
    r_h3,
    r_sifra,
    r_obcina_name,
    r_walk_score,
    r_bike_score,
    r_walk_min,
    r_population,
    r_el65,
    r_kids,
    r_cats_hit,
    r_cats_required,
    (w_cat * n_cat + w_pop * n_pop + w_dem * n_dem +
     w_prox * n_prox + w_bike * n_bike)::real AS r_composite
  FROM scored
  ORDER BY r_composite DESC, r_population DESC NULLS LAST, r_h3 ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_cells_v2(jsonb, jsonb, real, real, integer)
  TO anon, authenticated;
