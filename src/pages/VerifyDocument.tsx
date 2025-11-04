import { useState, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Save, FileText, Eye, Link2, Loader2, Download } from "lucide-react";
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
  const { id: documentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [highlightedFieldId, setHighlightedFieldId] = useState<string | null>(null);
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  // Fetch document data using React Query
  const { data: document, isLoading, error, refetch } = useQuery({
    queryKey: ['document', documentId],
    queryFn: async () => {
      if (!documentId) throw new Error("No document ID provided");

      // Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("Authentication required");
      }

      // Fetch document
      const { data: docData, error: docError } = await supabase
        .from("documents")
        .select("*")
        .eq("id", documentId)
        .eq("user_id", user.id)
        .single();

      if (docError) throw docError;
      if (!docData) throw new Error("Document not found");

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

      // Fetch document fields
      const { data: fieldsData, error: fieldsError } = await supabase
        .from("document_fields")
        .select("*")
        .eq("document_id", documentId)
        .order("position_in_html", { ascending: true });

      if (fieldsError) throw fieldsError;

      // Convert fields to the format expected by the UI
      const fields: DocumentField[] = fieldsData?.map((field) => ({
        id: field.id,
        label: field.field_name,
        value: field.field_value,
        tag: field.field_tag,
      })) || [];

      // Initialize edited fields
      const initialEditedFields: Record<string, string> = {};
      fields.forEach((field) => {
        initialEditedFields[field.id] = field.value;
      });
      setEditedFields(initialEditedFields);

      return {
        id: docData.id,
        name: docData.name,
        type: docData.type,
        template: templateName,
        originalWord: docData.name,
        fields,
      } as DocumentData;
    },
    enabled: !!documentId,
    retry: false,
  });

  // Handle query errors
  if (error) {
    toast({
      title: "Błąd",
      description: "Nie udało się pobrać dokumentu",
      variant: "destructive",
    });
    navigate("/documents");
    return null;
  }

  const completedFields = useMemo(() => {
    return Object.values(editedFields).filter(value => value.trim().length > 0).length;
  }, [editedFields]);

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
      if (!user) {
        toast({
          title: "Błąd",
          description: "Musisz być zalogowany",
          variant: "destructive",
        });
        return;
      }

      // Update changed field values in document_fields
      const changedFields = document.fields.filter(
        field => editedFields[field.id] !== field.value
      );

      // Update each changed field
      for (const field of changedFields) {
        const { error: updateError } = await supabase
          .from("document_fields")
          .update({ field_value: editedFields[field.id] })
          .eq("id", field.id);

        if (updateError) throw updateError;
      }

      // Update document status to verified
      const { error: updateError } = await supabase
        .from("documents")
        .update({ status: "verified" })
        .eq("id", document.id);

      if (updateError) throw updateError;

      toast({
        title: "Zapisano zmiany",
        description: `Zaktualizowano ${changedFields.length} pól`,
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
      toast({
        title: "Dodawanie zmiennej...",
        description: `Dodaję pole "${tagName}"`,
      });

      const { data, error } = await supabase.functions.invoke("add-document-field", {
        body: { 
          documentId: document.id, 
          selectedText, 
          tagName 
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      // Refetch document to get updated fields
      await refetch();

      // Trigger preview refresh to show updated HTML with highlighted variable
      setPreviewRefreshKey(prev => prev + 1);

      // Highlight the newly added field
      setHighlightedFieldId(data.fieldId);
      setFocusedFieldId(data.fieldId);

      // Scroll to the new field in the editor
      setTimeout(() => {
        const fieldElement = window.document.querySelector(`[data-field-id="${data.fieldId}"]`);
        if (fieldElement) {
          fieldElement.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 500);

      toast({
        title: "Sukces",
        description: `Dodano pole "${tagName}" do dokumentu`,
      });
    } catch (error) {
      console.error("Error adding new field:", error);
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się dodać nowego pola",
        variant: "destructive",
      });
    }
  };

  const handleDownloadDocument = async () => {
    if (!documentId) return;

    try {
      toast({
        title: "Przygotowywanie dokumentu...",
        description: "Generowanie pliku DOCX",
      });

      // Call edge function to convert HTML to DOCX
      const { data, error } = await supabase.functions.invoke("download-document", {
        body: { documentId }
      });

      if (error) throw error;

      if (!data || !data.base64) {
        throw new Error("Brak danych dokumentu");
      }

      // Convert base64 to blob
      const byteCharacters = atob(data.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { 
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
      });

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = data.filename || 'document.docx';
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Sukces",
        description: "Dokument został pobrany",
      });
    } catch (error) {
      console.error("Error downloading document:", error);
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się pobrać dokumentu",
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
    <div className="min-h-screen w-full flex flex-col bg-gradient-to-br from-background via-background to-accent/5">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm shrink-0 sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => navigate("/documents")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-bold truncate">{document.name}</h1>
                <p className="text-sm text-muted-foreground truncate">{document.type}</p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button 
                onClick={handleDownloadDocument} 
                variant="outline"
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Pobierz
              </Button>
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
        </div>
      </header>

      {/* Info Bar */}
      <div className="border-b bg-card/30 backdrop-blur-sm shrink-0">
        <div className="w-full px-6 py-3">
          <div className="flex flex-wrap gap-6 items-center">
            {document.template && (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground">Szablon:</span>
                <Badge variant="secondary">{document.template}</Badge>
              </div>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground">Word:</span>
              <span className="text-sm font-medium truncate">{document.originalWord}</span>
            </div>
            <div className="flex-1 min-w-[250px]">
              <VerificationProgress 
                totalFields={document.fields.length}
                completedFields={completedFields}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <main className="flex-1 overflow-hidden px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-4 h-full">
          {/* Left Column - Document Preview */}
          <Card className="p-4 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <Eye className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-lg">Podgląd dokumentu</h2>
              <Badge variant="outline" className="text-xs">
                Zaznacz tekst aby dodać zmienną
              </Badge>
            </div>
            <div className="flex-1 overflow-hidden">
              <DocumentPreviewEnhanced 
                documentId={document.id}
                highlightedFieldId={highlightedFieldId}
                onTagHover={handleTagHover}
                onAddNewField={handleAddNewField}
                refreshKey={previewRefreshKey}
              />
            </div>
          </Card>

          {/* Right Column - Editable Fields */}
          <Card className="p-4 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <FileText className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-lg">Weryfikacja pól</h2>
              <Badge variant="secondary" className="ml-auto">
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
      </main>
    </div>
  );
};

export default VerifyDocument;
