import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Upload, 
  FileText, 
  Download, 
  Sparkles, 
  CheckCircle2, 
  Loader2,
  ArrowRight,
  Info,
  Eye,
  XCircle,
  Circle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";

interface ExtractedVariable {
  name: string;
  tag: string;
  originalValue: string;
  source?: "text" | "visual";
}

interface ProcessingResult {
  success: boolean;
  templateBase64?: string;
  templateFilename?: string;
  variables?: ExtractedVariable[];
  variableCount?: number;
  textBasedCount?: number;
  visualCount?: number;
  aiResponse?: string; // Odpowiedź z Gemini
  error?: string;
}

const DocxTemplateProcessor = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [showAiDetailsDialog, setShowAiDetailsDialog] = useState(false);
  const [progressSteps, setProgressSteps] = useState<Array<{label: string; status: "pending" | "loading" | "success" | "error"}>>([]);

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
    setResult(null);
    setDocumentId(null);
  };

  const handleUploadAndProcess = async () => {
    if (!file) {
      toast({
        title: "Brak pliku",
        description: "Proszę wybrać plik DOCX",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsUploading(true);
      setShowProgressDialog(true);
      
      // Inicjalizuj kroki postępu
      setProgressSteps([
        { label: "Wysyłanie pliku...", status: "loading" },
        { label: "Analiza tekstowa z Gemini 2.5 Pro", status: "pending" },
        { label: "Zastosowanie zmiennych z analizy tekstowej", status: "pending" },
        { label: "Konwersja na obrazy stron", status: "pending" },
        { label: "Weryfikacja wizualna z Gemini 2.5 Pro", status: "pending" },
        { label: "Zastosowanie zmiennych z weryfikacji wizualnej", status: "pending" },
        { label: "Generowanie finalnego szablonu", status: "pending" },
      ]);

      // Get session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Brak sesji użytkownika");
      }

      // Step 1: Upload document (without automatic analysis)
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", file.name);
      formData.append("type", "word");
      formData.append("analysisApproach", "manual"); // Skip automatic analysis

      const uploadResponse = await supabase.functions.invoke("upload-document", {
        body: formData,
      });

      if (uploadResponse.error) {
        throw uploadResponse.error;
      }

      const uploadedDocId = uploadResponse.data.document.id;
      setDocumentId(uploadedDocId);
      setIsUploading(false);
      setIsProcessing(true);
      
      // Aktualizuj kroki
      setProgressSteps(prev => [
        { ...prev[0], status: "success" },
        { ...prev[1], status: "loading" },
        ...prev.slice(2)
      ]);

      // Step 2: Process with new template function (uses OpenRouter automatically)
      const processResponse = await supabase.functions.invoke("process-docx-template", {
        body: { 
          documentId: uploadedDocId
        },
      });

      if (processResponse.error) {
        throw processResponse.error;
      }

      const processData = processResponse.data as ProcessingResult;
      
      if (!processData.success) {
        throw new Error(processData.error || "Błąd przetwarzania");
      }

      // Aktualizuj wszystkie kroki na sukces
      setProgressSteps(prev => prev.map(step => ({ ...step, status: "success" as const })));

      setResult(processData);
      setProcessingStep("");

      // Zamknij dialog po chwili
      setTimeout(() => {
        setShowProgressDialog(false);
      }, 1000);

      toast({
        title: "Sukces! 🎉",
        description: `Znaleziono ${processData.variableCount} zmiennych w dokumencie`,
      });

    } catch (error) {
      console.error("Processing error:", error);
      const errorMessage = error instanceof Error ? error.message : "Nieznany błąd";
      
      // Oznacz aktualny krok jako błąd
      setProgressSteps(prev => prev.map((step, idx) => 
        step.status === "loading" ? { ...step, status: "error" as const } : step
      ));
      
      toast({
        title: "Błąd przetwarzania",
        description: errorMessage,
        variant: "destructive",
      });
      
      setResult({ success: false, error: errorMessage });
    } finally {
      setIsUploading(false);
      setIsProcessing(false);
      setProcessingStep("");
    }
  };

  const handleDownloadTemplate = () => {
    if (!result?.templateBase64 || !result?.templateFilename) return;

    // Convert base64 to blob
    const byteCharacters = atob(result.templateBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { 
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
    });

    // Download
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.templateFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Pobrano szablon",
      description: result.templateFilename,
    });
  };

  const handleGoToEditor = () => {
    if (documentId) {
      navigate(`/verify/${documentId}`);
    }
  };

  const handleReset = () => {
    setFile(null);
    setDocumentId(null);
    setResult(null);
    setProcessingStep("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Generator Szablonów DOCX
          </h2>
          <p className="text-muted-foreground mt-1">
            Prześlij dokument DOCX, a AI automatycznie zidentyfikuje zmienne i stworzy szablon
          </p>
        </div>
        <Button onClick={() => navigate("/documents")} variant="outline">
          Zobacz dokumenty
        </Button>
      </div>


      {/* Upload Section */}
      <Card className="p-6 border-2 border-dashed hover:border-primary/50 transition-colors">
        <div className="space-y-4">
          <div className="text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Wybierz plik DOCX</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Plik zostanie przeanalizowany, a wszystkie dynamiczne dane zamienione na zmienne
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Plik dokumentu</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".docx"
                onChange={handleFileChange}
                className="cursor-pointer"
                disabled={isUploading || isProcessing}
              />
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
                {!isUploading && !isProcessing && !result && (
                  <Button onClick={handleUploadAndProcess} className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Przetwórz
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Processing Status */}
      {(isUploading || isProcessing) && (
        <Card className="p-6">
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="relative">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm font-medium">{processingStep}</p>
              <p className="text-xs text-muted-foreground">
                To może potrwać do 30 sekund...
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Results */}
      {result && (
        <Card className="p-6">
          {result.success ? (
            <div className="space-y-6">
              {/* Success Header */}
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-green-700">
                    Szablon wygenerowany pomyślnie!
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Znaleziono <span className="font-medium text-primary">{result.variableCount}</span> zmiennych do podstawienia
                    {result.textBasedCount !== undefined && result.visualCount !== undefined && (
                      <span className="ml-2 text-xs">
                        ({result.textBasedCount} z analizy tekstowej, {result.visualCount} z weryfikacji wizualnej)
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Variables List */}
              {result.variables && result.variables.length > 0 && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Wykryte zmienne:</Label>
                  <div className="grid gap-2 max-h-[300px] overflow-y-auto">
                    {result.variables.map((variable, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between p-3 bg-accent/5 rounded-lg border"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Badge variant="secondary" className="font-mono shrink-0">
                            {variable.tag}
                          </Badge>
                          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate text-muted-foreground">
                            {variable.originalValue}
                          </span>
                          {"source" in variable && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              {variable.source === "visual" ? "👁️ Wizualna" : "📝 Tekstowa"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                <Button onClick={handleDownloadTemplate} className="gap-2">
                  <Download className="h-4 w-4" />
                  Pobierz szablon DOCX
                </Button>
                <Button onClick={handleGoToEditor} variant="outline" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Edytuj w przeglądarce
                </Button>
                {result.aiResponse && (
                  <Button 
                    onClick={() => setShowAiDetailsDialog(true)} 
                    variant="outline" 
                    className="gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    Zobacz szczegóły z Gemini
                  </Button>
                )}
                <Button onClick={handleReset} variant="ghost" className="gap-2">
                  Przetwórz kolejny
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <FileText className="h-6 w-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-700">
                  Błąd przetwarzania
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {result.error}
                </p>
                <Button onClick={handleReset} variant="outline" className="mt-4">
                  Spróbuj ponownie
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Progress Dialog */}
      <Dialog open={showProgressDialog} onOpenChange={setShowProgressDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Przetwarzanie dokumentu</DialogTitle>
            <DialogDescription>
              Proszę czekać, trwa analiza dokumentu...
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {progressSteps.length > 0 && (
              <Progress 
                value={(progressSteps.filter(s => s.status === "success").length / progressSteps.length) * 100} 
                className="h-2" 
              />
            )}

            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {progressSteps.map((step, index) => {
                const getStepIcon = () => {
                  switch (step.status) {
                    case "loading":
                      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
                    case "success":
                      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
                    case "error":
                      return <XCircle className="h-4 w-4 text-destructive" />;
                    default:
                      return <Circle className="h-4 w-4 text-muted-foreground" />;
                  }
                };

                return (
                  <div
                    key={index}
                    className={`flex items-start gap-3 ${
                      step.status === "loading" ? "opacity-100" : step.status === "pending" ? "opacity-50" : "opacity-100"
                    }`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {getStepIcon()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${
                        step.status === "error" ? "text-destructive" : "text-foreground"
                      }`}>
                        {step.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Details Dialog */}
      <Dialog open={showAiDetailsDialog} onOpenChange={setShowAiDetailsDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              Szczegóły analizy z Gemini 2.5 Pro
            </DialogTitle>
            <DialogDescription>
              Pełna odpowiedź z modelu AI pokazująca, jakie zmienne zostały wykryte
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {result?.aiResponse ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Odpowiedź z Gemini:</Label>
                <div className="rounded-lg border bg-muted/50 p-4 max-h-[500px] overflow-y-auto">
                  <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                    {result.aiResponse}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Brak dostępnej odpowiedzi z AI
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Info Box */}
      <Card className="p-4 bg-blue-50 border-blue-200">
        <div className="flex gap-3">
          <Sparkles className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Jak to działa?</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700">
              <li>Wgrywasz dokument DOCX (np. fakturę, dokument celny)</li>
              <li>AI analizuje treść i identyfikuje dane zmienne (analiza tekstowa)</li>
              <li>Dokument jest konwertowany na obrazy i weryfikowany wizualnie przez Gemini 2.5 Pro</li>
              <li>Zmienne są zamieniane na tagi np. <code className="bg-blue-100 px-1 rounded">{"{{vinNumber}}"}</code></li>
              <li>Pobierasz gotowy szablon z zachowanym formatowaniem</li>
            </ol>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default DocxTemplateProcessor;

