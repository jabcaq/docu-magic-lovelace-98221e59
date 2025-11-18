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
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setRuns([]);
    }
  };

  const handleExtract = async () => {
    if (!file) return;

    setLoading(true);
    try {
      // Upload file to storage
      const filePath = `test/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Call enhanced extraction function
      const { data, error } = await supabase.functions.invoke("extract-runs-enhanced", {
        body: { storagePath: filePath },
      });

      if (error) throw error;

      setRuns(data.runs || []);
      toast({
        title: "Sukces",
        description: `Wyekstrahowano ${data.runs?.length || 0} runs`,
      });

      // Cleanup temp file
      await supabase.storage.from("documents").remove([filePath]);
    } catch (error) {
      console.error("Extraction error:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się wyekstrahować runs",
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
            </div>
          </CardContent>
        </Card>

        {runs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Extracted Runs ({runs.length})</CardTitle>
              <CardDescription>
                Lista wszystkich runs z dokumentu
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
        )}
      </div>
    </div>
  );
};

export default TestRuns;
