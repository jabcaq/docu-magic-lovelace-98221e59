-- Drop trigger first, then function, then recreate with security fixes
DROP TRIGGER IF EXISTS on_document_inserted ON public.documents;
DROP FUNCTION IF EXISTS public.trigger_document_analysis() CASCADE;

-- Create schema for extensions if not exists
CREATE SCHEMA IF NOT EXISTS extensions;

-- Move pg_net extension to extensions schema
DROP EXTENSION IF EXISTS pg_net CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Recreate function with proper search_path
CREATE OR REPLACE FUNCTION public.trigger_document_analysis()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Only trigger if auto_analyze is true and status is pending
  IF NEW.auto_analyze = true AND NEW.status = 'pending' THEN
    -- Call the analyze-document-fields function asynchronously
    PERFORM extensions.http_post(
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
$$;

-- Recreate trigger
CREATE TRIGGER on_document_inserted
  AFTER INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_document_analysis();