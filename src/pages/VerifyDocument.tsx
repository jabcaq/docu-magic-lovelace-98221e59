import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Save, FileText, Eye, Link2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import DocumentPreviewEnhanced from "@/components/DocumentPreviewEnhanced";
import DocumentFieldEditor from "@/components/DocumentFieldEditor";
import VerificationProgress from "@/components/VerificationProgress";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

interface DocumentField {
  id: string;
  label: string;
  value: string;
  tag: string;
}

interface DocumentData {
  id: string;
  name: string;
  type: string;
  template: string | null;
  originalWord: string;
  fields: DocumentField[];
}

const VerifyDocument = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [highlightedFieldId, setHighlightedFieldId] = useState<string | null>(null);
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchDocument();
  }, [id]);

  useEffect(() => {
    if (document) {
      // Initialize edited fields with current values
      const initialFields: Record<string, string> = {};
      document.fields.forEach((field) => {
        initialFields[field.id] = field.value;
      });
      setEditedFields(initialFields);
    }
  }, [document]);

  const completedFields = useMemo(() => {
    return Object.values(editedFields).filter(value => value.trim().length > 0).length;
  }, [editedFields]);

  const fetchDocument = async () => {
    if (!id) return;

    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigate("/auth");
        return;
      }

      // Fetch document
      const { data: docData, error: docError } = await supabase
        .from("documents")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (docError) throw docError;

      // Fetch template name if exists
      let templateName = null;
      if (docData.template_id) {
        const { data: templateData } = await supabase
          .from("templates")
          .select("name")
          .eq("id", docData.template_id)
          .single();
        
        templateName = templateData?.name || null;
      }

      // Fetch document runs (tagged segments)
      const { data: runsData, error: runsError } = await supabase
        .from("document_runs")
        .select("*")
        .eq("document_id", id)
        .order("run_index", { ascending: true });

      if (runsError) throw runsError;

      // Convert runs to fields (only tagged ones for editing)
      const fields: DocumentField[] = runsData
        ?.filter(run => run.tag) // Only tagged runs
        .map((run, index) => ({
          id: run.id,
          label: run.tag?.replace(/[{}]/g, '') || `Pole ${index + 1}`,
          value: run.text,
          tag: run.tag || '',
        })) || [];

      setDocument({
        id: docData.id,
        name: docData.name,
        type: docData.type,
        template: templateName,
        originalWord: docData.name,
        fields,
      });

    } catch (error) {
      console.error("Error fetching document:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się pobrać dokumentu",
        variant: "destructive",
      });
      navigate("/documents");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFieldChange = (fieldId: string, value: string) => {
    setEditedFields((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  const handleSave = async () => {
    if (!document) return;

    try {
      setIsSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Save manual overrides for changed fields
      const changedFields = document.fields.filter(
        field => editedFields[field.id] !== field.value
      );

      for (const field of changedFields) {
        await supabase
          .from("manual_overrides")
          .insert({
            document_id: document.id,
            user_id: user.id,
            field_id: field.id,
            original_value: field.value,
            corrected_value: editedFields[field.id],
          });
      }

      // Update document status to verified
      await supabase
        .from("documents")
        .update({ status: "verified" })
        .eq("id", document.id);

      toast({
        title: "Zapisano zmiany",
        description: `Zaktualizowano ${changedFields.length} pól i zapisano do bazy danych`,
      });

      navigate("/documents");
    } catch (error) {
      console.error("Save error:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się zapisać zmian",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentFieldId: string) => {
    if (!document) return;
    
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const fieldIds = document.fields.map((f) => f.id);
      const currentIndex = fieldIds.indexOf(currentFieldId);
      const nextIndex = (currentIndex + 1) % fieldIds.length;
      const nextFieldId = fieldIds[nextIndex];
      inputRefs.current[nextFieldId]?.focus();
    }
  };

  const handleTagHover = (fieldId: string | null) => {
    setHighlightedFieldId(fieldId);
  };

  const handleFieldFocus = (fieldId: string) => {
    setFocusedFieldId(fieldId);
    setHighlightedFieldId(fieldId);
    
    // Scroll to the field in the document preview
    const tagElement = window.document.querySelector(`[data-field-id="${fieldId}"]`);
    if (tagElement) {
      tagElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const handleFieldBlur = () => {
    setFocusedFieldId(null);
    setHighlightedFieldId(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Nie znaleziono dokumentu</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="w-full px-8 py-4">
          <div className="flex items-center justify-between max-w-[2000px] mx-auto">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/documents")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold">{document.name}</h1>
                <p className="text-xs text-muted-foreground">{document.type}</p>
              </div>
            </div>
            <Button 
              onClick={handleSave} 
              className="gap-2"
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Zapisz zmiany
            </Button>
          </div>
        </div>
      </header>

      {/* Info Bar */}
      <div className="border-b bg-card/30 backdrop-blur-sm">
        <div className="w-full px-8 py-4">
          <div className="max-w-[2000px] mx-auto">
            <div className="flex flex-wrap gap-6 items-center">
              {document.template && (
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Szablon:</span>
                  <Badge variant="secondary">{document.template}</Badge>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Oryginalny Word:</span>
                <span className="text-sm font-medium">{document.originalWord}</span>
              </div>
              <div className="flex-1 min-w-[300px] max-w-md">
                <VerificationProgress 
                  totalFields={document.fields.length}
                  completedFields={completedFields}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <main className="w-full px-8 py-8 max-w-[2000px] mx-auto">
        <div className="grid lg:grid-cols-[1.3fr,0.7fr] gap-12 xl:gap-16">
          {/* Left Column - Document Preview */}
          <div className="space-y-4">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <Eye className="h-5 w-5 text-primary" />
                <h2 className="font-semibold text-lg">Podgląd dokumentu</h2>
                <Badge variant="outline" className="ml-auto text-xs">
                  Kliknij tag aby przejść do edycji
                </Badge>
              </div>
              <DocumentPreviewEnhanced 
                documentId={document.id}
                highlightedFieldId={highlightedFieldId}
                onTagHover={handleTagHover}
              />
            </Card>
          </div>

          {/* Right Column - Editable Fields */}
          <div className="space-y-4">
            <Card className="p-6 sticky top-24">
              <div className="flex items-center gap-2 mb-6">
                <FileText className="h-5 w-5 text-primary" />
                <h2 className="font-semibold text-lg">Weryfikacja pól</h2>
              </div>

              <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto pr-2">
                {document.fields.map((field, index) => (
                  <DocumentFieldEditor
                    key={field.id}
                    field={field}
                    value={editedFields[field.id] || ""}
                    onChange={(value) => handleFieldChange(field.id, value)}
                    onFocus={() => handleFieldFocus(field.id)}
                    onBlur={handleFieldBlur}
                    autoFocus={index === 0}
                    isHighlighted={highlightedFieldId === field.id}
                  />
                ))}
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default VerifyDocument;
