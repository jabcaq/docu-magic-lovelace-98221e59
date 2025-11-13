-- Add analysis_approach column to documents table
ALTER TABLE documents ADD COLUMN IF NOT EXISTS analysis_approach TEXT DEFAULT 'runs' CHECK (analysis_approach IN ('runs', 'xml_ai'));

COMMENT ON COLUMN documents.analysis_approach IS 'Method used for document analysis: runs (current approach with runs extraction) or xml_ai (full XML sent to AI)';