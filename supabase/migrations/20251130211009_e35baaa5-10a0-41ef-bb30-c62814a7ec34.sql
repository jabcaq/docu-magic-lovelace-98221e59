-- Drop the incorrect policy
DROP POLICY IF EXISTS "Users can read processed documents" ON storage.objects;

-- Create corrected policy with proper reference to storage path
CREATE POLICY "Users can read processed documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' 
  AND storage.objects.name LIKE 'processed/%'
  AND EXISTS (
    SELECT 1 FROM public.documents
    WHERE documents.id::text = (storage.foldername(storage.objects.name))[2]
    AND documents.user_id = auth.uid()
  )
);