-- Combine templater pipeline setup migrations

-- 1. Add 'templater_pipeline' to the analysis_approach check constraint
ALTER TABLE public.documents 
DROP CONSTRAINT IF EXISTS documents_analysis_approach_check;

ALTER TABLE public.documents 
ADD CONSTRAINT documents_analysis_approach_check 
CHECK (analysis_approach = ANY (ARRAY['runs'::text, 'xml_ai'::text, 'manual'::text, 'templater_pipeline'::text]));

-- 2. Add status tracking columns for async processing
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS processing_result jsonb DEFAULT NULL;

-- 3. Add 'templated' to documents status check constraint
ALTER TABLE public.documents
DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE public.documents
ADD CONSTRAINT documents_status_check
CHECK (status IN ('pending', 'processing', 'verified', 'rejected', 'templated'));