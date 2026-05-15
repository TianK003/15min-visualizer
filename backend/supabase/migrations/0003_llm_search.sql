-- backend/supabase/migrations/0003_llm_search.sql

-- This RPC handles LLM-driven geographic and amenity searches.
-- By accepting a `jsonb` filter specification, the system is highly modular.
-- Future fields like `property_price` or `crime_rate` can be added without changing the function signature;
-- you simply append an `AND (filter_spec->>'max_price' IS NULL OR c.property_price <= ...)` line to the WHERE clause.

CREATE OR REPLACE FUNCTION llm_search_cells(
  filter_spec jsonb,
  p_limit integer default 5
) RETURNS TABLE (
  h3 text,
  score smallint,
  population real
) AS $$
DECLARE
  req_cats integer[];
  h3_list text[];
BEGIN
  -- Extract arrays from JSON if they exist.
  IF filter_spec ? 'required_category_indices' THEN
    req_cats := (SELECT array_agg(x::text::integer) FROM jsonb_array_elements(filter_spec->'required_category_indices') x);
  END IF;

  IF filter_spec ? 'h3_in' THEN
    h3_list := (SELECT array_agg(x::text) FROM jsonb_array_elements_text(filter_spec->'h3_in') x);
  END IF;

  RETURN QUERY
  SELECT c.h3, c.score, c.population
  FROM cell_scores c
  WHERE 
    -- 1. Geographic Filter (resolved via h3-js in Node.js backend)
    (h3_list IS NULL OR array_length(h3_list, 1) IS NULL OR c.h3 = ANY(h3_list))
    
    AND 
    -- 2. Amenity Filter
    -- Postgres arrays are 1-indexed. The LLM returns 0-indexed categories (e.g. 0=Trgovina).
    -- We add +1 to access the correct element in the `walk_min` array.
    (req_cats IS NULL OR array_length(req_cats, 1) IS NULL OR 
      (SELECT bool_and(c.walk_min[i + 1] <= 15) FROM unnest(req_cats) x(i)))

    -- 3. Future modular filters go here:
    -- AND (filter_spec->>'max_price' IS NULL OR c.property_price <= (filter_spec->>'max_price')::numeric)
    
  ORDER BY c.score DESC, c.population DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Grant access to the anon key so the frontend can call it
GRANT EXECUTE ON FUNCTION llm_search_cells TO anon;
