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
    // Only fetch if id is valid (not undefined and not the literal ":id" string)
    if (id && id !== ":id" && id.length > 10) {
      fetchDocument();
    }
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

  const handleAddNewField = async (selectedText: string, tagName: string) => {
    if (!document) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Create a new tag format
      const tag = `{{${tagName}}}`;

      toast({
        title: "Dodawanie zmiennej...",
        description: `Dodaję pole "${tagName}" do dokumentu`,
      });

      // Note: Ideally, we'd update the specific run in document_runs table
      // For now, we'll just refetch the document to show the user feedback
      // The actual implementation would require server-side logic to update runs
      
      toast({
        title: "Informacja",
        description: `Wybrano tekst "${selectedText}" jako ${tagName}. Ta funkcja wymaga dodatkowej logiki serwerowej do pełnej implementacji.`,
      });

      // Refresh document
      await fetchDocument();
    } catch (error) {
      console.error("Error adding new field:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się dodać nowego pola",
        variant: "destructive",
      });
    }
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
    <div className="min-h-screen w-full max-w-[2560px] mx-auto flex flex-col bg-gradient-to-br from-background via-background to-accent/5 overflow-x-hidden">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm shrink-0 sticky top-0 z-50">
        <div className="w-full pl-0 pr-3 py-3">
            <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => navigate("/documents")}
              >
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
              <div className="min-w-0 flex-1">
                <h1 className="text-base sm:text-lg lg:text-xl font-bold truncate">{document.name}</h1>
                <p className="text-xs text-muted-foreground truncate">{document.type}</p>
              </div>
            </div>
            <Button 
              onClick={handleSave} 
              className="gap-2 shrink-0"
              disabled={isSaving}
              size="sm"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Zapisz zmiany</span>
              <span className="sm:hidden">Zapisz</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Info Bar */}
      <div className="border-b bg-card/30 backdrop-blur-sm shrink-0">
        <div className="w-full pl-0 pr-3 py-3">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 lg:gap-6 items-start sm:items-center">
              {document.template && (
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-xs sm:text-sm text-muted-foreground">Szablon:</span>
                  <Badge variant="secondary" className="text-xs">{document.template}</Badge>
                </div>
              )}
              <div className="flex items-center gap-2 min-w-0">
                <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs sm:text-sm text-muted-foreground">Word:</span>
                <span className="text-xs sm:text-sm font-medium truncate">{document.originalWord}</span>
              </div>
              <div className="w-full sm:flex-1 sm:min-w-[250px]">
                <VerificationProgress 
                  totalFields={document.fields.length}
                  completedFields={completedFields}
                />
              </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <main className="w-full flex-1 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-3 h-full pl-0 pr-3 py-3">
          {/* Left Column - Document Preview */}
          <div className="flex flex-col min-h-[400px] lg:min-h-0 lg:h-full">
            <Card className="p-3 sm:p-4 flex flex-col h-full overflow-hidden">
              <div className="flex items-center gap-2 mb-4 shrink-0 flex-wrap">
                <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                <h2 className="font-semibold text-base sm:text-lg">Podgląd dokumentu</h2>
                <Badge variant="outline" className="text-xs hidden sm:inline-flex">
                  Kliknij tag aby przejść do edycji
                </Badge>
              </div>
              <div className="flex-1 overflow-hidden">
                <DocumentPreviewEnhanced 
                  documentId={document.id}
                  highlightedFieldId={highlightedFieldId}
                  onTagHover={handleTagHover}
                  onAddNewField={handleAddNewField}
                />
              </div>
            </Card>
          </div>

          {/* Right Column - Editable Fields */}
          <div className="flex flex-col min-h-[400px] lg:min-h-0 lg:h-full">
            <Card className="p-3 sm:p-4 flex flex-col h-full overflow-hidden">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                <h2 className="font-semibold text-base sm:text-lg">Weryfikacja pól</h2>
                <Badge variant="secondary" className="ml-auto text-xs">
                  {completedFields}/{document.fields.length}
                </Badge>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
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
