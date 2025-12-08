-- =============================================
-- Włączenie rozszerzenia pg_trgm dla fuzzy search NAJPIERW
-- =============================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================
-- OCR PIPELINE DATABASE SCHEMA
-- =============================================

-- 1. TABELA: clients (Baza klientów)
-- =============================================
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  eori TEXT,
  address TEXT,
  country TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indeks dla szybkiego wyszukiwania fuzzy
CREATE INDEX idx_clients_normalized_name ON public.clients USING gin (normalized_name gin_trgm_ops);
CREATE INDEX idx_clients_user_id ON public.clients (user_id);

-- Włącz RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Polityki RLS dla clients
CREATE POLICY "Users can view their own clients"
  ON public.clients FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own clients"
  ON public.clients FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own clients"
  ON public.clients FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own clients"
  ON public.clients FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger dla updated_at
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 2. TABELA: offices (Baza urzędów)
-- =============================================
CREATE TABLE public.offices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  office_type TEXT NOT NULL DEFAULT 'celny',
  country TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indeks dla szybkiego wyszukiwania fuzzy
CREATE INDEX idx_offices_normalized_name ON public.offices USING gin (normalized_name gin_trgm_ops);
CREATE INDEX idx_offices_user_id ON public.offices (user_id);

-- Włącz RLS
ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY;

-- Polityki RLS dla offices
CREATE POLICY "Users can view their own offices"
  ON public.offices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own offices"
  ON public.offices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own offices"
  ON public.offices FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own offices"
  ON public.offices FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger dla updated_at
CREATE TRIGGER update_offices_updated_at
  BEFORE UPDATE ON public.offices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 3. TABELA: ocr_documents (Dokumenty OCR)
-- =============================================
CREATE TABLE public.ocr_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  original_file_path TEXT NOT NULL,
  original_file_name TEXT,
  matched_template_id UUID REFERENCES public.templates(id) ON DELETE SET NULL,
  matched_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  matched_office_id UUID REFERENCES public.offices(id) ON DELETE SET NULL,
  preliminary_ocr_data JSONB DEFAULT '{}'::jsonb,
  extracted_fields JSONB DEFAULT '{}'::jsonb,
  generated_docx_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  human_corrections JSONB DEFAULT '{}'::jsonb,
  confidence_score FLOAT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indeksy
CREATE INDEX idx_ocr_documents_user_id ON public.ocr_documents (user_id);
CREATE INDEX idx_ocr_documents_status ON public.ocr_documents (status);
CREATE INDEX idx_ocr_documents_template_id ON public.ocr_documents (matched_template_id);

-- Włącz RLS
ALTER TABLE public.ocr_documents ENABLE ROW LEVEL SECURITY;

-- Polityki RLS dla ocr_documents
CREATE POLICY "Users can view their own ocr_documents"
  ON public.ocr_documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own ocr_documents"
  ON public.ocr_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ocr_documents"
  ON public.ocr_documents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ocr_documents"
  ON public.ocr_documents FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger dla updated_at
CREATE TRIGGER update_ocr_documents_updated_at
  BEFORE UPDATE ON public.ocr_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 4. TABELA: template_examples (Przykłady TAG→wartość)
-- =============================================
CREATE TABLE public.template_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  source_ocr_document_id UUID REFERENCES public.ocr_documents(id) ON DELETE SET NULL,
  tag_value_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrections_applied JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indeksy
CREATE INDEX idx_template_examples_template_id ON public.template_examples (template_id);

-- Włącz RLS
ALTER TABLE public.template_examples ENABLE ROW LEVEL SECURITY;

-- Polityki RLS dla template_examples (dostęp przez właściciela szablonu)
CREATE POLICY "Users can view template_examples for their templates"
  ON public.template_examples FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.templates
      WHERE templates.id = template_examples.template_id
      AND templates.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create template_examples for their templates"
  ON public.template_examples FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.templates
      WHERE templates.id = template_examples.template_id
      AND templates.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update template_examples for their templates"
  ON public.template_examples FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.templates
      WHERE templates.id = template_examples.template_id
      AND templates.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete template_examples for their templates"
  ON public.template_examples FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.templates
      WHERE templates.id = template_examples.template_id
      AND templates.user_id = auth.uid()
    )
  );