import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, FileText, Image as ImageIcon, Link2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import MagnifyingGlass from "@/components/MagnifyingGlass";
import { supabase } from "@/integrations/supabase/client";

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
  imageUrl: string;
  fields: DocumentField[];
}

const VerifyDocument = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

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

      // Get document file URL from storage
      const { data: urlData } = supabase.storage
        .from("documents")
        .getPublicUrl(docData.storage_path);

      // Convert runs to fields
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
        imageUrl: urlData.publicUrl,
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
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
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
            <Button onClick={handleSave} className="gap-2">
              <Save className="h-4 w-4" />
              Zapisz zmiany
            </Button>
          </div>
        </div>
      </header>

      {/* Info Bar */}
      <div className="border-b bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-3">
          <div className="flex flex-wrap gap-4 text-sm">
            {document.template && (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Szablon:</span>
                <Badge variant="secondary">{document.template}</Badge>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Oryginalny Word:</span>
              <span className="font-medium">{document.originalWord}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <main className="container mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left Column - Image with Magnifying Glass */}
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <ImageIcon className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Obraz dokumentu</h2>
              </div>
              <MagnifyingGlass
                imageUrl={document.imageUrl}
                onImageLoad={() => setImageLoaded(true)}
              />
            </Card>
          </div>

          {/* Right Column - Editable Fields */}
          <div className="space-y-4">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <FileText className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Pola dokumentu</h2>
              </div>

              <div className="space-y-6">
                {document.fields.map((field, index) => (
                  <div key={field.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={field.id} className="font-medium">
                        {field.label}
                      </Label>
                      <Badge variant="outline" className="text-xs font-mono">
                        {field.tag}
                      </Badge>
                    </div>
                    <Input
                      id={field.id}
                      ref={(el) => (inputRefs.current[field.id] = el)}
                      value={editedFields[field.id] || ""}
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, field.id)}
                      className="font-mono text-sm"
                      placeholder={`Wprowadź ${field.label.toLowerCase()}`}
                      autoFocus={index === 0}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t">
                <div className="flex gap-3">
                  <Button onClick={handleSave} className="flex-1 gap-2">
                    <Save className="h-4 w-4" />
                    Zapisz do bazy danych
                  </Button>
                  <Button variant="outline" className="flex-1" disabled>
                    Zapisz do Google Drive
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default VerifyDocument;
