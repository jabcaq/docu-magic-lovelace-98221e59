-- Funkcja do fuzzy search w tabeli clients
CREATE OR REPLACE FUNCTION public.search_clients_fuzzy(
  search_term TEXT,
  p_user_id UUID,
  similarity_threshold FLOAT DEFAULT 0.3,
  max_results INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  normalized_name TEXT,
  eori TEXT,
  address TEXT,
  country TEXT,
  similarity_score FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    c.id,
    c.name,
    c.normalized_name,
    c.eori,
    c.address,
    c.country,
    similarity(c.normalized_name, UPPER(search_term)) as similarity_score
  FROM public.clients c
  WHERE c.user_id = p_user_id
    AND similarity(c.normalized_name, UPPER(search_term)) > similarity_threshold
  ORDER BY similarity_score DESC
  LIMIT max_results
$$;

-- Funkcja do fuzzy search w tabeli offices
CREATE OR REPLACE FUNCTION public.search_offices_fuzzy(
  search_term TEXT,
  p_user_id UUID,
  similarity_threshold FLOAT DEFAULT 0.3,
  max_results INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  normalized_name TEXT,
  office_type TEXT,
  country TEXT,
  address TEXT,
  similarity_score FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    o.id,
    o.name,
    o.normalized_name,
    o.office_type,
    o.country,
    o.address,
    similarity(o.normalized_name, UPPER(search_term)) as similarity_score
  FROM public.offices o
  WHERE o.user_id = p_user_id
    AND similarity(o.normalized_name, UPPER(search_term)) > similarity_threshold
  ORDER BY similarity_score DESC
  LIMIT max_results
$$;