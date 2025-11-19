import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExtractedRun {
  text: string;
  formatting: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    fontSize?: string;
    fontFamily?: string;
    color?: string;
  };
  paragraphIndex: number;
}

const TestRuns = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<ExtractedRun[]>([]);
  const [processedTexts, setProcessedTexts] = useState<string[]>([]);
  const [identifying, setIdentifying] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setRuns([]);
      setProcessedTexts([]);
    }
  };

  const handleExtract = async () => {
    if (!file) return;

    setLoading(true);
    let filePath = '';
    try {
      // Validate file type
      if (!file.name.endsWith('.docx')) {
        throw new Error('Proszę wybrać plik .docx');
      }

      // Upload file to storage
      filePath = `test/${Date.now()}_${file.name.replace(/[()]/g, '')}`;
      console.log('Uploading file to:', filePath);
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: true
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }

      console.log('File uploaded successfully:', uploadData);

      // Wait a moment for storage to sync
      await new Promise(resolve => setTimeout(resolve, 500));

      // Call enhanced extraction function
      console.log('Calling extract-runs-enhanced with path:', filePath);
      const { data, error } = await supabase.functions.invoke("extract-runs-enhanced", {
        body: { storagePath: filePath },
      });

      if (error) {
        console.error('Function error:', error);
        throw error;
      }

      if (!data || !data.runs) {
        throw new Error('Brak danych z funkcji ekstrakcji');
      }

      setRuns(data.runs);
      toast({
        title: "Sukces",
        description: `Wyekstrahowano ${data.runs.length} runs`,
      });

      // Cleanup temp file
      await supabase.storage.from("documents").remove([filePath]);
    } catch (error) {
      console.error("Extraction error:", error);
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się wyekstrahować runs",
        variant: "destructive",
      });
      
      // Try to cleanup on error
      if (filePath) {
        try {
          await supabase.storage.from("documents").remove([filePath]);
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleIdentifyVariables = async () => {
    if (runs.length === 0) {
      toast({
        title: "Błąd",
        description: "Najpierw wyekstrahuj runs",
        variant: "destructive",
      });
      return;
    }

    setIdentifying(true);
    try {
      // Przygotuj dane z numerami i tekstem
      const runsData = runs.map((run, index) => ({
        number: index,
        text: run.text
      }));

      // Wyślij na webhook
      const webhookUrl = "https://kamil109-20109.wykr.es/webhook/d2861022-c147-4f9c-9225-ec66f9481d76";
      
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runs: runsData,
          timestamp: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status}`);
      }

      toast({
        title: "Sukces",
        description: `Wysłano ${runsData.length} runs na webhook`,
      });
    } catch (error) {
      console.error('Error sending to webhook:', error);
      toast({
        title: "Błąd",
        description: "Nie udało się wysłać danych na webhook",
        variant: "destructive",
      });
    } finally {
      setIdentifying(false);
    }
  };

  const handleRebuildDocx = async () => {
    if (!processedTexts || processedTexts.length === 0) {
      toast({
        title: "Błąd",
        description: "Najpierw zidentyfikuj zmienne",
        variant: "destructive",
      });
      return;
    }

    if (!file) {
      toast({
        title: "Błąd",
        description: "Brak pliku",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Upload file again for rebuild
      const filePath = `test/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data, error } = await supabase.functions.invoke('rebuild-docx-with-variables', {
        body: { 
          storagePath: filePath,
          newRunTexts: processedTexts 
        }
      });

      if (error) throw error;

      if (data.base64 && data.filename) {
        // Download the file
        const link = document.createElement('a');
        link.href = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${data.base64}`;
        link.download = data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast({
          title: "Sukces",
          description: "Dokument został przebudowany i pobrany",
        });
      }

      // Cleanup temp file
      await supabase.storage.from("documents").remove([filePath]);
    } catch (error) {
      console.error('Error rebuilding document:', error);
      toast({
        title: "Błąd",
        description: "Nie udało się przebudować dokumentu",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">Test Runs Extraction</h1>
          <p className="text-muted-foreground">
            Testowanie ulepszonego podejścia do ekstrakcji runs z DOCX
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upload Document</CardTitle>
            <CardDescription>
              Wybierz plik DOCX do analizy
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept=".docx"
                onChange={handleFileChange}
                className="flex-1"
                id="file-input"
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleExtract}
                  disabled={!file || loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Extract Runs
                    </>
                  )}
                </Button>
                {runs.length > 0 && (
                  <Button
                    onClick={handleIdentifyVariables}
                    disabled={identifying}
                    variant="secondary"
                  >
                    {identifying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Identifying...
                      </>
                    ) : (
                      'Identify Variables'
                    )}
                  </Button>
                )}
                {processedTexts.length > 0 && (
                  <Button
                    onClick={handleRebuildDocx}
                    disabled={loading}
                    variant="default"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Rebuilding...
                      </>
                    ) : (
                      'Rebuild DOCX'
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {runs.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Original Runs ({runs.length})</CardTitle>
                <CardDescription>
                  Runs z formatowaniem wyekstraktowane za pomocą OpenXML
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {runs.map((run, index) => (
                    <div
                      key={index}
                      className="p-3 border border-border rounded-lg bg-card"
                    >
                      <div className="flex items-start gap-4">
                        <span className="text-xs text-muted-foreground font-mono w-12">
                          #{index}
                        </span>
                        <div className="flex-1">
                          <p
                            className="text-sm mb-2"
                            style={{
                              fontWeight: run.formatting.bold ? "bold" : "normal",
                              fontStyle: run.formatting.italic ? "italic" : "normal",
                              textDecoration: run.formatting.underline ? "underline" : "none",
                              fontSize: run.formatting.fontSize || "14px",
                              fontFamily: run.formatting.fontFamily || "inherit",
                              color: run.formatting.color || "inherit",
                            }}
                          >
                            {run.text || "<empty>"}
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            <span className="text-xs px-2 py-1 bg-secondary rounded">
                              Para: {run.paragraphIndex}
                            </span>
                            {run.formatting.bold && (
                              <span className="text-xs px-2 py-1 bg-secondary rounded">
                                Bold
                              </span>
                            )}
                            {run.formatting.italic && (
                              <span className="text-xs px-2 py-1 bg-secondary rounded">
                                Italic
                              </span>
                            )}
                            {run.formatting.underline && (
                              <span className="text-xs px-2 py-1 bg-secondary rounded">
                                Underline
                              </span>
                            )}
                            {run.formatting.fontSize && (
                              <span className="text-xs px-2 py-1 bg-secondary rounded">
                                {run.formatting.fontSize}
                              </span>
                            )}
                            {run.formatting.fontFamily && (
                              <span className="text-xs px-2 py-1 bg-secondary rounded">
                                {run.formatting.fontFamily}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {processedTexts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>With Variables ({processedTexts.length})</CardTitle>
                  <CardDescription>
                    Dynamiczne dane zamienione na zmienne
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {processedTexts.map((text, index) => (
                      <div
                        key={index}
                        className="p-3 border border-border rounded-lg bg-card"
                      >
                        <div className="flex items-start gap-4">
                          <span className="text-xs text-muted-foreground font-mono w-12">
                            #{index}
                          </span>
                          <div className="flex-1">
                            <p className="font-mono text-sm bg-muted/50 p-2 rounded whitespace-pre-wrap">
                              {text || "<empty>"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TestRuns;
