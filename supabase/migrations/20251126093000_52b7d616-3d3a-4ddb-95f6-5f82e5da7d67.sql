-- Drop the existing constraint and create a new one with 'manual' included
ALTER TABLE public.documents 
DROP CONSTRAINT documents_analysis_approach_check;

ALTER TABLE public.documents 
ADD CONSTRAINT documents_analysis_approach_check 
CHECK (analysis_approach = ANY (ARRAY['runs'::text, 'xml_ai'::text, 'manual'::text]));