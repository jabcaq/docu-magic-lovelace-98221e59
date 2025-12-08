import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Download, FileText, Loader2, Eye, EyeOff, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DocumentPreview = () => {
  const { id: documentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showVariables, setShowVariables] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Fetch document data
  const { data: document, isLoading, error } = useQuery({
    queryKey: ['document-preview', documentId],
    queryFn: async () => {
      if (!documentId) throw new Error("No document ID provided");

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("Authentication required");
      }

      const { data: docData, error: docError } = await supabase
        .from("documents")
        .select("*, templates(name)")
        .eq("id", documentId)
        .eq("user_id", user.id)
        .single();

      if (docError) throw docError;
      if (!docData) throw new Error("Document not found");

      // Get processing result for variables count
      const processingResult = docData.processing_result as any;
      const variablesCount = processingResult?.totalChanges || 0;

      return {
        id: docData.id,
        name: docData.name,
        status: docData.processing_status,
        storagePath: docData.storage_path,
        templateName: (docData.templates as any)?.name || null,
        variablesCount,
        processingResult,
      };
    },
    enabled: !!documentId,
    retry: false,
  });

  // Set default template name
  useEffect(() => {
    if (document?.name) {
      const baseName = document.name.replace(/\.[^/.]+$/, '');
      setTemplateName(`${baseName}_szablon`);
    }
  }, [document?.name]);

  const handleDownload = async () => {
    if (!document?.storagePath) return;

    try {
      setIsDownloading(true);
      toast({
        title: "Pobieranie dokumentu...",
      });

      const { data, error } = await supabase.storage
        .from("documents")
        .download(document.storagePath);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.name;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Sukces",
        description: "Dokument został pobrany",
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się pobrać dokumentu",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!documentId || !templateName.trim()) return;

    try {
      setIsSavingTemplate(true);
      toast({
        title: "Zapisywanie szablonu...",
      });

      const { data, error } = await supabase.functions.invoke("create-template", {
        body: { documentId, templateName: templateName.trim() },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setShowSaveTemplateDialog(false);
      toast({
        title: "Sukces",
        description: `Szablon "${templateName}" został zapisany`,
      });

      // Optionally navigate to documents
      navigate("/documents");
    } catch (error) {
      console.error("Save template error:", error);
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się zapisać szablonu",
        variant: "destructive",
      });
    } finally {
      setIsSavingTemplate(false);
    }
  };

  // Render HTML preview with optional variable highlighting
  const renderPreview = () => {
    if (!document?.processingResult) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <p>Brak podglądu dla tego dokumentu</p>
        </div>
      );
    }

    // Get changes from processing result
    const changes = document.processingResult.changes || [];
    
    if (changes.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <p>Nie znaleziono zmiennych w dokumencie</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="grid gap-2">
          {changes.map((change: any, index: number) => (
            <Card key={index} className="p-3 bg-muted/30">
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="shrink-0 font-mono text-xs">
                  #{index + 1}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">
                      {showVariables ? (
                        <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          {change.newText}
                        </code>
                      ) : (
                        change.originalText
                      )}
                    </span>
                  </div>
                  {showVariables && (
                    <p className="text-xs text-muted-foreground">
                      Oryginał: <span className="italic">{change.originalText}</span>
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  if (error) {
    toast({
      title: "Błąd",
      description: "Nie udało się pobrać dokumentu",
      variant: "destructive",
    });
    navigate("/documents");
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Ładowanie podglądu...</p>
        </div>
      </div>
    );
  }

  if (!document) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate("/documents")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {document.name}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={document.status === "completed" ? "default" : "secondary"}>
                    {document.status === "completed" ? "Przetworzony" : document.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {document.variablesCount} zmiennych
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowVariables(!showVariables)}
              >
                {showVariables ? (
                  <>
                    <EyeOff className="h-4 w-4 mr-2" />
                    Pokaż oryginał
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Pokaż zmienne
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Pobierz DOCX
              </Button>
              <Button
                size="sm"
                onClick={() => setShowSaveTemplateDialog(true)}
              >
                <Save className="h-4 w-4 mr-2" />
                Zapisz jako szablon
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-6">
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-2">Lista zmiennych</h2>
            <p className="text-sm text-muted-foreground">
              Poniżej znajdują się wszystkie zmienne wykryte i zastąpione w dokumencie.
              {showVariables 
                ? " Widoczne są placeholdery {{zmienna}}." 
                : " Widoczne są oryginalne wartości."
              }
            </p>
          </div>
          <ScrollArea className="h-[calc(100vh-350px)]">
            {renderPreview()}
          </ScrollArea>
        </Card>
      </div>

      {/* Save Template Dialog */}
      <Dialog open={showSaveTemplateDialog} onOpenChange={setShowSaveTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zapisz jako szablon</DialogTitle>
            <DialogDescription>
              Przetworyzony dokument zostanie zapisany jako szablon wielokrotnego użytku.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="templateName">Nazwa szablonu</Label>
            <Input
              id="templateName"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Wpisz nazwę szablonu"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveTemplateDialog(false)}>
              Anuluj
            </Button>
            <Button 
              onClick={handleSaveAsTemplate} 
              disabled={isSavingTemplate || !templateName.trim()}
            >
              {isSavingTemplate ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Zapisz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DocumentPreview;
