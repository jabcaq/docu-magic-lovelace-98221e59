-- Add RLS policy to allow users to read processed documents
-- The processed files are stored in: processed/{documentId}/filename.docx
-- We need to check if the user owns the document

CREATE POLICY "Users can read processed documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' 
  AND name LIKE 'processed/%'
  AND EXISTS (
    SELECT 1 FROM public.documents
    WHERE documents.id::text = (storage.foldername(name))[2]
    AND documents.user_id = auth.uid()
  )
);