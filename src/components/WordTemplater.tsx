import { useState, useEffect, useRef } from "react";
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

interface TemplaterPipelineResult {
  templateBase64: string | null;
  storagePath?: string; // New field for large files
  templateFilename: string | null;
  stats: {
    paragraphs: number;
    runs: number;
    batches: number;
    changesApplied: number;
  };
  usage?: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costPLN: number;
  };
  replacements: Array<{ id: string; originalText: string; newText: string }>;
  message?: string;
}

type AnalysisApproach = "runs" | "xml_ai" | "templater_pipeline";

interface WordTemplaterProps {
  userRole?: "admin" | "gosc" | null;
}

const WordTemplater = ({ userRole }: WordTemplaterProps = {}) => {
  const navigate = useNavigate();

  const buildInitialSteps = (approach: AnalysisApproach) => {
    if (approach === "templater_pipeline") {
      return [
        { id: "upload", label: "Wysyłanie pliku do serwera", status: "pending" as StepStatus },
        { id: "pipeline", label: "Analiza Word Templater (AI + XML)", status: "pending" as StepStatus },
        { id: "download", label: "Generowanie szablonu DOCX", status: "pending" as StepStatus },
      ];
    }
    return [
      { id: "upload", label: "Wysyłanie pliku do serwera", status: "pending" as StepStatus },
      { id: "ai", label: "Analiza AI i identyfikacja zmiennych", status: "pending" as StepStatus },
      { id: "xml", label: "Budowanie finalnego dokumentu XML", status: "pending" as StepStatus },
    ];
  };

  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedRuns, setExtractedRuns] = useState<ExtractedRun[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [processingTime, setProcessingTime] = useState(0);
  const [analysisApproach, setAnalysisApproach] = useState<AnalysisApproach>(
    userRole === "gosc" ? "templater_pipeline" : "runs"
  );
  const [templaterResult, setTemplaterResult] = useState<TemplaterPipelineResult | null>(null);
  const { toast } = useToast();
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  
  type StepStatus = "pending" | "loading" | "success" | "error";
  
  const [uploadProgress, setUploadProgress] = useState<{
    open: boolean;
    currentStep: number;
    steps: Array<{ id: string; label: string; status: StepStatus }>;
    error?: string;
  }>({
    open: false,
    currentStep: 0,
    steps: buildInitialSteps("runs"),
    error: undefined,
  });

  const handleAnalysisApproachChange = (value: AnalysisApproach) => {
    setAnalysisApproach(value);
    setTemplaterResult(null);
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, []);

  const pollForStatus = async (docId: string, fileName: string) => {
    // Start polling
    pollingInterval.current = setInterval(async () => {
      try {
        const { data: doc, error } = await supabase
          .from("documents")
          .select("processing_status, processing_result")
          .eq("id", docId)
          .single();

        if (error) throw error;

        console.log(`[Polling] Status: ${doc.processing_status}`, doc);
        console.log(`[Polling] Result:`, doc.processing_result);

        if (doc.processing_status === "completed") {
          if (pollingInterval.current) clearInterval(pollingInterval.current);
          
          const result = doc.processing_result as any;
          console.log('[Polling] Processing completed!', result);
          
          const stats = result?.stats || { paragraphs: 0, runs: 0, batches: 0, changesApplied: 0 };
          const replacements = result?.replacements || [];
          const usage = result?.usage || null;
          
          console.log('[Polling] Stats:', stats);
          console.log('[Polling] Usage:', usage);
          console.log('[Polling] Replacements:', replacements);

          const templaterData = {
            templateBase64: result?.templateBase64 ?? null,
            storagePath: result?.storagePath,
            templateFilename: result?.templateFilename ?? `${fileName.replace(/\.docx$/i, "")}_processed.docx`,
            stats,
            usage,
            replacements,
            message: result?.message,
          };
          
          console.log('[Polling] Setting templater result:', templaterData);
          setTemplaterResult(templaterData);

          setUploadProgress(prev => ({
            ...prev,
            currentStep: 2,
            steps: prev.steps.map(step => {
              if (step.id === "pipeline" || step.id === "download") {
                return { ...step, status: "success" as StepStatus };
              }
              return step;
            }),
          }));

          toast({
            title: stats.changesApplied > 0 ? "✅ Szablon gotowy!" : "⚠️ Brak zmian do zastosowania",
            description: stats.changesApplied > 0 
              ? `Znaleziono ${stats.changesApplied} zmiennych w ${stats.paragraphs} paragrafach`
              : "LLM nie znalazł zmiennych w tym dokumencie",
          });

          setIsUploading(false);
          setTimeout(() => {
            setUploadProgress(prev => ({ ...prev, open: false }));
          }, 2000);

        } else if (doc.processing_status === "error") {
          if (pollingInterval.current) clearInterval(pollingInterval.current);
          const errorMsg = (doc.processing_result as any)?.error || "Unknown processing error";
          throw new Error(errorMsg);
        }
        // If 'processing' or 'pending', continue polling
      } catch (err) {
        if (pollingInterval.current) clearInterval(pollingInterval.current);
        console.error("Polling error:", err);
        setUploadProgress(prev => ({
          ...prev,
          steps: prev.steps.map(step => 
            step.status === "loading" ? { ...step, status: "error" } : step
          ),
          error: err instanceof Error ? err.message : "Processing failed",
        }));
        setIsUploading(false);
      }
    }, 2000); // Poll every 2 seconds
  };

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
    setTemplaterResult(null);

    // Open progress dialog
    const initialSteps = buildInitialSteps(analysisApproach).map((step, index) =>
      index === 0 ? { ...step, status: "loading" as StepStatus } : step
    );
    setUploadProgress({
      open: true,
      currentStep: 0,
      steps: initialSteps,
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
      formData.append("analysisApproach", analysisApproach);

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
        steps: prev.steps.map(step => {
          if (step.id === "upload") {
            return { ...step, status: "success" as StepStatus };
          }
          if (
            step.id === "ai" ||
            step.id === "pipeline"
          ) {
            return { ...step, status: "loading" as StepStatus };
          }
          return step;
        }),
      }));

      if (analysisApproach === "templater_pipeline") {
        // Trigger the pipeline
        const { error: pipelineError } = await supabase.functions.invoke("word-templater-pipeline", {
          body: { documentId: document.id },
        });

        if (pipelineError) {
          throw pipelineError;
        }

        // Start polling for completion instead of waiting
        await pollForStatus(document.id, selectedFile.name);
        return;
      }

      // Step 2: AI Analysis (triggered automatically by upload-document)
      // Wait for analysis to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      setUploadProgress(prev => ({
        ...prev,
        currentStep: 2,
        steps: prev.steps.map(step => {
          if (step.id === "ai") {
            return { ...step, status: "success" as StepStatus };
          }
          if (step.id === "xml") {
            return { ...step, status: "loading" as StepStatus };
          }
          return step;
        }),
      }));

      // Step 3: XML Building (already completed in backend)
      await new Promise(resolve => setTimeout(resolve, 1000));

      setUploadProgress(prev => ({
        ...prev,
        currentStep: 2,
        steps: prev.steps.map(step =>
          step.id === "xml" ? { ...step, status: "success" as StepStatus } : step
        ),
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
      // Only set uploading to false if NOT polling (polling handles it internally when done)
      if (analysisApproach !== "templater_pipeline") {
        setIsUploading(false);
      }
    }
  };

  const handleDownloadTemplaterDoc = async () => {
    if (!templaterResult) return;

    try {
      let blob: Blob;

      if (templaterResult.storagePath) {
        // Download from storage (new method for large files)
        const { data, error } = await supabase.storage
          .from("documents")
          .download(templaterResult.storagePath);

        if (error) throw error;
        if (!data) throw new Error("Empty file downloaded");
        blob = data;
      } else if (templaterResult.templateBase64) {
        // Legacy method: Base64
        const byteCharacters = atob(templaterResult.templateBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        blob = new Blob([byteArray], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      } else {
        toast({
          title: "Błąd pobierania",
          description: "Brak danych pliku (Base64 lub Storage Path).",
          variant: "destructive",
        });
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = templaterResult.templateFilename || "processed_document.docx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Błąd pobierania",
        description: error instanceof Error ? error.message : "Nie udało się pobrać pliku.",
        variant: "destructive",
      });
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

  const handleSaveTemplaterAsTemplate = async () => {
    if (!documentId || !templaterResult) {
      toast({
        title: "Błąd",
        description: "Brak dokumentu do zapisania jako szablon",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-template", {
        body: {
          documentId,
          templateName: file?.name?.replace(/\.docx$/i, "") || "Szablon",
        },
      });

      if (error) {
        throw error;
      }

      toast({
        title: "✅ Szablon zapisany w bazie!",
        description: `Szablon "${data.template.name}" został zapisany z ${data.template.tagCount} tagami`,
      });

    } catch (error) {
      console.error("Save templater template error:", error);
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

          <div className="space-y-4">
            <div className="flex flex-col gap-3 mb-4">
              <label className="text-sm font-medium">Metoda analizy dokumentu:</label>
              <div className="flex gap-4">
                {userRole !== "gosc" && (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="analysis-approach"
                        value="runs"
                        checked={analysisApproach === "runs"}
                        onChange={(e) => handleAnalysisApproachChange(e.target.value as AnalysisApproach)}
                        className="w-4 h-4"
                        disabled={isUploading}
                      />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">Analiza Runs (szybsza)</span>
                        <span className="text-xs text-muted-foreground">Obecne podejście z ekstrakcją formatowania</span>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="analysis-approach"
                        value="xml_ai"
                        checked={analysisApproach === "xml_ai"}
                        onChange={(e) => handleAnalysisApproachChange(e.target.value as AnalysisApproach)}
                        className="w-4 h-4"
                        disabled={isUploading}
                      />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">Analiza XML + AI</span>
                        <span className="text-xs text-muted-foreground">Pełna analiza struktury przez AI</span>
                      </div>
                    </label>
                  </>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="analysis-approach"
                    value="templater_pipeline"
                    checked={analysisApproach === "templater_pipeline"}
                    onChange={(e) => handleAnalysisApproachChange(e.target.value as AnalysisApproach)}
                    className="w-4 h-4"
                    disabled={isUploading || userRole === "gosc"}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      Word Templater pipeline
                      {userRole === "gosc" && " (wymagane)"}
                    </span>
                    <span className="text-xs text-muted-foreground">Deterministyczny Find &amp; Replace runów</span>
                  </div>
                </label>
              </div>
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
      {file && analysisApproach !== "templater_pipeline" && !extractedRuns.length && !isProcessing && (
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
      {analysisApproach !== "templater_pipeline" && isProcessing && !extractedRuns.length && (
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

      {analysisApproach === "templater_pipeline" && templaterResult && (
        <Card className="p-6 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Word Templater pipeline</h3>
              <p className="text-sm text-muted-foreground">
                {templaterResult.message
                  ? templaterResult.message
                  : `Zastosowano ${templaterResult.stats.changesApplied} zmian w ${templaterResult.stats.paragraphs} paragrafach`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleDownloadTemplaterDoc}
                variant="outline"
                className="gap-2"
                disabled={!templaterResult.templateBase64 && !templaterResult.storagePath}
              >
                <Download className="h-4 w-4" />
                Pobierz DOCX
              </Button>
              <Button
                onClick={handleSaveTemplaterAsTemplate}
                className="gap-2"
                disabled={isProcessing || !documentId}
              >
                <FileText className="h-4 w-4" />
                {isProcessing ? "Zapisuję..." : "Zapisz jako szablon"}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Paragrafy</p>
              <p className="text-lg font-semibold">{templaterResult.stats.paragraphs}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Runy</p>
              <p className="text-lg font-semibold">{templaterResult.stats.runs}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Batchy LLM</p>
              <p className="text-lg font-semibold">{templaterResult.stats.batches}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Zastosowane zmiany</p>
              <p className="text-lg font-semibold">{templaterResult.stats.changesApplied}</p>
            </div>
          </div>

          {/* AI Usage Stats */}
          {templaterResult.usage && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-medium">📊 Statystyki AI</p>
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Model</p>
                  <p className="text-sm font-mono font-medium">{templaterResult.usage.model}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tokeny (input)</p>
                  <p className="text-sm font-semibold">{templaterResult.usage.promptTokens.toLocaleString('pl-PL')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tokeny (output)</p>
                  <p className="text-sm font-semibold">{templaterResult.usage.completionTokens.toLocaleString('pl-PL')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Koszt analizy</p>
                  <p className="text-sm font-semibold text-primary">
                    {templaterResult.usage.costPLN.toLocaleString('pl-PL', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} PLN
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Łącznie: {templaterResult.usage.totalTokens.toLocaleString('pl-PL')} tokenów
              </p>
            </div>
          )}

          {templaterResult.replacements.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Przykładowe zamiany:</p>
              <div className="max-h-[260px] overflow-y-auto divide-y rounded-lg border">
                {templaterResult.replacements.slice(0, 10).map(change => (
                  <div key={change.id} className="flex flex-col gap-1 p-3 md:flex-row md:items-center md:justify-between">
                    <span className="text-xs font-mono text-muted-foreground">{change.id}</span>
                    <div className="text-sm md:text-right">
                      <p className="text-muted-foreground line-clamp-1">„{change.originalText || "—"}"</p>
                      <p className="font-semibold line-clamp-1">→ {change.newText || "(puste)"}</p>
                    </div>
                  </div>
                ))}
              </div>
              {templaterResult.replacements.length > 10 && (
                <p className="text-xs text-muted-foreground">
                  +{templaterResult.replacements.length - 10} dodatkowych zamian
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              LLM nie zasugerowało żadnych zmian dla tego dokumentu.
            </p>
          )}
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
      {analysisApproach !== "templater_pipeline" && file && extractedRuns.length === 0 && (
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
