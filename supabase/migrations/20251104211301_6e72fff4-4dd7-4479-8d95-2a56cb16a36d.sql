-- Add HTML content column to documents table
ALTER TABLE documents ADD COLUMN html_content TEXT;

-- Drop document_runs table as it's no longer needed
DROP TABLE IF EXISTS document_runs CASCADE;

-- Drop manual_overrides table as we'll handle edits differently
DROP TABLE IF EXISTS manual_overrides CASCADE;

-- Create new table for storing field definitions (extracted variables)
CREATE TABLE document_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  field_tag TEXT NOT NULL,
  position_in_html INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on document_fields
ALTER TABLE document_fields ENABLE ROW LEVEL SECURITY;

-- Create policies for document_fields
CREATE POLICY "Users can view fields of their own documents"
  ON document_fields FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_fields.document_id
      AND documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert fields for their own documents"
  ON document_fields FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_fields.document_id
      AND documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update fields of their own documents"
  ON document_fields FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_fields.document_id
      AND documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete fields of their own documents"
  ON document_fields FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_fields.document_id
      AND documents.user_id = auth.uid()
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER update_document_fields_updated_at
  BEFORE UPDATE ON document_fields
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create index for faster queries
CREATE INDEX idx_document_fields_document_id ON document_fields(document_id);