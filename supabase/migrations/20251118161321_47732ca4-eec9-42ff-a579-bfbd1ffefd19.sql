-- Drop existing policies if they exist to recreate them properly
DROP POLICY IF EXISTS "Users can upload to documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;

-- Policy for uploading files to documents bucket
CREATE POLICY "Users can upload to documents bucket"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (auth.uid()::text = (storage.foldername(name))[1] OR 
   name LIKE 'test/%')
);

-- Policy for reading files from documents bucket
CREATE POLICY "Users can read their own documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  (auth.uid()::text = (storage.foldername(name))[1] OR 
   name LIKE 'test/%')
);

-- Policy for deleting files from documents bucket
CREATE POLICY "Users can delete their own documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (auth.uid()::text = (storage.foldername(name))[1] OR 
   name LIKE 'test/%')
);