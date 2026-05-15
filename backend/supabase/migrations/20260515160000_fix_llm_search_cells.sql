-- 0003_llm_search.sql referenced cell_scores.score, which was renamed to
-- walk_score by 20260515123032_add_bike_score.sql. The function was dropped
-- (PostgREST excludes it from the schema cache → PGRST202). Recreate against
-- the current schema, defaulting to walk_score for backward compatibility
-- with /api/llm callers that don't specify a mode.

CREATE OR REPLACE FUNCTION public.llm_search_cells(
  filter_spec jsonb,
  p_limit integer default 5
) RETURNS TABLE (
  h3 text,
  score smallint,
  population real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  req_cats integer[];
  h3_list  text[];
BEGIN
  IF filter_spec ? 'required_category_indices' THEN
    req_cats := (
      SELECT array_agg(x::text::integer)
      FROM jsonb_array_elements(filter_spec->'required_category_indices') x
    );
  END IF;

  IF filter_spec ? 'h3_in' THEN
    h3_list := (
      SELECT array_agg(x::text)
      FROM jsonb_array_elements_text(filter_spec->'h3_in') x
    );
  END IF;

  RETURN QUERY
  SELECT c.h3, c.walk_score AS score, c.population
  FROM public.cell_scores c
  WHERE
    (h3_list IS NULL OR array_length(h3_list, 1) IS NULL OR c.h3 = ANY(h3_list))
    AND
    -- walk_min is a smallint[] indexed from 1 (Postgres). The LLM returns
    -- 0-indexed category positions, so add 1 to access the right element.
    (req_cats IS NULL OR array_length(req_cats, 1) IS NULL OR
      (SELECT bool_and(c.walk_min[i + 1] IS NOT NULL AND c.walk_min[i + 1] <= 15)
       FROM unnest(req_cats) x(i)))
  ORDER BY c.walk_score DESC, c.population DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.llm_search_cells(jsonb, integer) TO anon, authenticated;
