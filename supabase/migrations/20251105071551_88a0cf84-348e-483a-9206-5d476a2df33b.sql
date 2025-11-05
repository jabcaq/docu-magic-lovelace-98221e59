-- Add formatting metadata to document_fields table
ALTER TABLE document_fields 
ADD COLUMN IF NOT EXISTS run_formatting jsonb DEFAULT '{}'::jsonb;

-- Add runs metadata to documents table for storing original runs structure
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS runs_metadata jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN document_fields.run_formatting IS 'Stores OpenXML run formatting: bold, italic, font, size, color, etc.';
COMMENT ON COLUMN documents.runs_metadata IS 'Stores array of original OpenXML runs with formatting before AI tagging';