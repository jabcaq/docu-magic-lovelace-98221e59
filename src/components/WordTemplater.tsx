import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, FileText, Download, List } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import UploadProgressDialog from "@/components/UploadProgressDialog";

interface ExtractedRun {
  id: string;
  text: string;
  tag: string;
  type: "text" | "placeholder";
}

const WordTemplater = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedRuns, setExtractedRuns] = useState<ExtractedRun[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [processingTime, setProcessingTime] = useState(0);
  const { toast } = useToast();
  
  type StepStatus = "pending" | "loading" | "success" | "error";
  
  const [uploadProgress, setUploadProgress] = useState<{
    open: boolean;
    currentStep: number;
    steps: Array<{ id: string; label: string; status: StepStatus }>;
    error?: string;
  }>({
    open: false,
    currentStep: 0,
    steps: [
      { id: "upload", label: "Wysyłanie pliku do serwera", status: "pending" },
      { id: "ai", label: "Analiza AI i identyfikacja zmiennych", status: "pending" },
      { id: "xml", label: "Budowanie finalnego dokumentu XML", status: "pending" },
    ],
    error: undefined,
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith(".docx")) {
      toast({
        title: "Nieprawidłowy typ pliku",
        description: "Proszę przesłać plik .docx",
        variant: "destructive",
      });
      return;
    }

    setFile(selectedFile);
    setIsUploading(true);
    setExtractedRuns([]);
    setDocumentId(null);

    // Open progress dialog
    setUploadProgress({
      open: true,
      currentStep: 0,
      steps: [
        { id: "upload", label: "Wysyłanie pliku do serwera", status: "loading" },
        { id: "ai", label: "Analiza AI i identyfikacja zmiennych", status: "pending" },
        { id: "xml", label: "Budowanie finalnego dokumentu XML", status: "pending" },
      ],
      error: undefined,
    });

    try {
      // Get session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Brak sesji użytkownika");
      }

      // Step 1: Upload document
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("name", selectedFile.name);
      formData.append("type", "word");

      const response = await supabase.functions.invoke("upload-document", {
        body: formData,
      });

      if (response.error) {
        throw response.error;
      }

      const { document } = response.data;
      setDocumentId(document.id);

      // Step 1 complete
      setUploadProgress(prev => ({
        ...prev,
        currentStep: 1,
        steps: [
          { id: "upload", label: "Wysyłanie pliku do serwera", status: "success" },
          { id: "ai", label: "Analiza AI i identyfikacja zmiennych", status: "loading" },
          { id: "xml", label: "Budowanie finalnego dokumentu XML", status: "pending" },
        ],
      }));

      // Step 2: AI Analysis (triggered automatically by upload-document)
      // Wait for analysis to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      setUploadProgress(prev => ({
        ...prev,
        currentStep: 2,
        steps: [
          { id: "upload", label: "Wysyłanie pliku do serwera", status: "success" },
          { id: "ai", label: "Analiza AI i identyfikacja zmiennych", status: "success" },
          { id: "xml", label: "Budowanie finalnego dokumentu XML", status: "loading" },
        ],
      }));

      // Step 3: XML Building (already completed in backend)
      await new Promise(resolve => setTimeout(resolve, 1000));

      setUploadProgress(prev => ({
        ...prev,
        currentStep: 2,
        steps: [
          { id: "upload", label: "Wysyłanie pliku do serwera", status: "success" },
          { id: "ai", label: "Analiza AI i identyfikacja zmiennych", status: "success" },
          { id: "xml", label: "Budowanie finalnego dokumentu XML", status: "success" },
        ],
      }));

      toast({
        title: "Dokument przetworzony pomyślnie!",
        description: `${selectedFile.name} został przeanalizowany i jest gotowy do edycji`,
      });

      // Navigate to documents page
      setTimeout(() => {
        setUploadProgress(prev => ({ ...prev, open: false }));
        navigate("/documents");
      }, 1500);
    } catch (error) {
      console.error("Upload error:", error);
      
      const errorMessage = error instanceof Error ? error.message : "Nie udało się przetworzyć pliku";
      
      setUploadProgress(prev => ({
        ...prev,
        steps: prev.steps.map(step => 
          step.status === "loading" ? { ...step, status: "error" } : step
        ),
        error: errorMessage,
      }));

      toast({
        title: "Błąd przetwarzania",
        description: errorMessage,
        variant: "destructive",
      });
      
      setFile(null);
      
      setTimeout(() => {
        setUploadProgress(prev => ({ ...prev, open: false }));
      }, 3000);
    } finally {
      setIsUploading(false);
    }
  };

  const performExtractRuns = async (docId: string, content: string) => {
    setIsProcessing(true);
    setProcessingTime(0);

    // Start timer
    const startTime = Date.now();
    const timer = setInterval(() => {
      setProcessingTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    // Set timeout (2 minutes)
    const timeoutId = setTimeout(() => {
      clearInterval(timer);
      setIsProcessing(false);
      toast({
        title: "Przekroczono limit czasu",
        description: "Przetwarzanie trwa zbyt długo. Spróbuj ponownie z mniejszym dokumentem.",
        variant: "destructive",
      });
    }, 120000); // 2 minutes

    try {
      const { data, error } = await supabase.functions.invoke("extract-runs", {
        body: {
          documentId: docId,
          textContent: content,
        },
      });

      clearTimeout(timeoutId);
      clearInterval(timer);

      if (error) {
        throw error;
      }

      const { runs } = data;
      
      // Convert to frontend format
      const formattedRuns: ExtractedRun[] = runs.map((run: any) => ({
        id: `${run.index || Math.random()}`,
        text: run.text,
        tag: run.tag || "",
        type: run.tag ? "placeholder" : "text",
      }));
      
      setExtractedRuns(formattedRuns);
      
      toast({
        title: "Sukces!",
        description: `Wyekstrahowano ${formattedRuns.length} fragmentów, AI zatagowało ${formattedRuns.filter(r => r.tag).length} jako placeholdery (${processingTime}s)`,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      clearInterval(timer);
      console.error("Extract error:", error);
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się przetworzyć dokumentu",
        variant: "destructive",
      });
    } finally {
      clearInterval(timer);
      setIsProcessing(false);
    }
  };

  const handleExtractRuns = async () => {
    if (!documentId || !textContent.trim()) {
      toast({
        title: "Brak danych",
        description: "Proszę wpisać treść dokumentu do przetworzenia",
        variant: "destructive",
      });
      return;
    }

    await performExtractRuns(documentId, textContent);
  };

  const handleSaveTemplate = async () => {
    if (!documentId) {
      toast({
        title: "Błąd",
        description: "Brak ID dokumentu",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-template", {
        body: {
          documentId,
          templateName: templateName || undefined,
        },
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Szablon utworzony!",
        description: `Szablon "${data.template.name}" został zapisany z ${data.template.tagCount} tagami`,
      });

      // Reset form
      setFile(null);
      setDocumentId(null);
      setTextContent("");
      setExtractedRuns([]);
      setTemplateName("");
    } catch (error) {
      console.error("Save template error:", error);
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się zapisać szablonu",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTagChange = (runId: string, newTag: string) => {
    setExtractedRuns(prev => 
      prev.map(run => 
        run.id === runId 
          ? { ...run, tag: newTag, type: newTag ? "placeholder" : "text" }
          : run
      )
    );
  };

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex justify-end">
        <Button onClick={() => navigate("/documents")} variant="outline" className="gap-2">
          <List className="h-4 w-4" />
          Zobacz dokumenty OCR
        </Button>
      </div>

      {/* Upload Section */}
      <Card className="p-6 border-2 border-dashed hover:border-primary/50 transition-colors">
        <div className="space-y-4">
          <div className="text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Upload Word Template</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a .docx file to extract and tag run elements
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file-upload">Wybierz plik</Label>
            <Input
              id="file-upload"
              type="file"
              accept=".docx"
              onChange={handleFileChange}
              className="cursor-pointer"
              disabled={isUploading}
            />
            {isUploading && (
              <p className="text-sm text-muted-foreground">Przesyłanie pliku...</p>
            )}
          </div>

          {file && (
            <div className="flex items-center gap-3 p-3 bg-accent/10 rounded-lg">
              <FileText className="h-5 w-5 text-accent" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Text Input Section - shown during processing or if auto-extract failed */}
      {file && !extractedRuns.length && !isProcessing && (
        <Card className="p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">Treść dokumentu</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {textContent ? "Treść została automatycznie wyekstrahowana. Możesz ją edytować przed przetworzeniem." : "Wklej treść dokumentu, jeśli automatyczna ekstrakcja nie zadziałała."}
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="text-content">Tekst dokumentu</Label>
            <Textarea
              id="text-content"
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="Treść dokumentu..."
              className="min-h-[300px] font-mono text-sm"
            />
          </div>

          <Button
            onClick={handleExtractRuns}
            disabled={isProcessing || !textContent.trim()}
            className="w-full"
            size="lg"
          >
            {isProcessing ? "Przetwarzanie z AI..." : "Przetworz ponownie"}
          </Button>
        </Card>
      )}

      {/* Processing indicator */}
      {isProcessing && !extractedRuns.length && (
        <Card className="p-6">
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <div className="text-center space-y-2">
              <p className="text-sm font-medium">Przetwarzanie dokumentu z AI...</p>
              <p className="text-xs text-muted-foreground">
                Czas przetwarzania: {processingTime}s
              </p>
              <p className="text-xs text-muted-foreground">
                {processingTime < 30 
                  ? "Analizuję dokument..." 
                  : processingTime < 60 
                  ? "AI taguje fragmenty..." 
                  : "Prawie gotowe..."}
              </p>
              <p className="text-xs text-muted-foreground italic mt-4">
                Duże dokumenty mogą wymagać do 2 minut przetwarzania
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Extracted Runs Section */}
      {extractedRuns.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Wyekstrahowane fragmenty ({extractedRuns.length})</h3>
            <Button variant="outline" size="sm" onClick={() => setExtractedRuns([])}>
              Wyczyść
            </Button>
          </div>

          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {extractedRuns.map((run) => (
              <div
                key={run.id}
                className={`p-4 rounded-lg border transition-colors ${
                  run.type === "placeholder"
                    ? "bg-accent/10 border-accent"
                    : "bg-card border-border"
                }`}
              >
                <div className="grid gap-3 md:grid-cols-[1fr,300px] items-center">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground">#{run.id}</span>
                      {run.type === "placeholder" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                          Placeholder
                        </span>
                      )}
                    </div>
                    <p className="font-medium">{run.text}</p>
                  </div>
                  
                  <div className="space-y-1">
                    <Label htmlFor={`tag-${run.id}`} className="text-xs">
                      Tag szablonu
                    </Label>
                    <Input
                      id={`tag-${run.id}`}
                      value={run.tag}
                      onChange={(e) => handleTagChange(run.id, e.target.value)}
                      placeholder="np. {{NazwaZmiennej}}"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Nazwa szablonu (opcjonalnie)</Label>
              <Input
                id="template-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="np. Szablon Umowy Najmu v1"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-accent">
                  {extractedRuns.filter(r => r.type === "placeholder").length}
                </span>
                {" "}placeholderów z {extractedRuns.length} fragmentów
              </div>
              <Button 
                onClick={handleSaveTemplate}
                disabled={isProcessing}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Zapisz szablon
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Preview Section */}
      {file && extractedRuns.length === 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Podgląd dokumentu</h3>
          <div className="bg-muted/30 rounded-lg p-8 text-center min-h-[200px] flex items-center justify-center">
            <div className="space-y-2">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Kliknij "Extract Runs" aby wyekstrahować i otagować fragmenty dokumentu
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Upload Progress Dialog */}
      <UploadProgressDialog 
        open={uploadProgress.open}
        steps={uploadProgress.steps}
        currentStep={uploadProgress.currentStep}
        error={uploadProgress.error}
      />
    </div>
  );
};

export default WordTemplater;
