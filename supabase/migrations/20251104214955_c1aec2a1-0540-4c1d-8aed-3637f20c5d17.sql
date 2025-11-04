-- Add auto_analyze field to documents table
ALTER TABLE public.documents 
ADD COLUMN auto_analyze BOOLEAN DEFAULT true;

-- Create function to trigger document analysis
CREATE OR REPLACE FUNCTION public.trigger_document_analysis()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger if auto_analyze is true and status is pending
  IF NEW.auto_analyze = true AND NEW.status = 'pending' THEN
    -- Call the analyze-document-fields function asynchronously
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/analyze-document-fields',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('documentId', NEW.id::text)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on documents insert
CREATE TRIGGER on_document_inserted
  AFTER INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_document_analysis();

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;