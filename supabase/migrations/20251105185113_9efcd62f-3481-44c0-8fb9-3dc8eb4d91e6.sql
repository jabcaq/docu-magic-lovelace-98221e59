-- Add xml_content column to documents table
ALTER TABLE documents 
ADD COLUMN xml_content TEXT;

-- Rename html_content to html_cache to clarify its purpose
ALTER TABLE documents 
RENAME COLUMN html_content TO html_cache;

-- Add comment to clarify the columns
COMMENT ON COLUMN documents.xml_content IS 'Primary source: OpenXML document.xml content from the DOCX file';
COMMENT ON COLUMN documents.html_cache IS 'Cached HTML preview generated from XML for UI display';