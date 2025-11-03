import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, Download, List } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExtractedRun {
  id: string;
  text: string;
  tag: string;
  type: "text" | "placeholder";
}

const WordTemplater = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedRuns, setExtractedRuns] = useState<ExtractedRun[]>([]);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith(".docx")) {
        setFile(selectedFile);
        toast({
          title: "File uploaded",
          description: `${selectedFile.name} is ready for processing`,
        });
      } else {
        toast({
          title: "Invalid file type",
          description: "Please upload a .docx file",
          variant: "destructive",
        });
      }
    }
  };

  const handleExtractRuns = async () => {
    if (!file) return;

    setIsProcessing(true);
    try {
      // TODO: Implement API call to extract runs endpoint
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate processing
      
      // Mock extracted runs for demonstration
      const mockRuns: ExtractedRun[] = [
        { id: "1", text: "Umowa najmu lokalu mieszkalnego", tag: "", type: "text" },
        { id: "2", text: "Jan Kowalski", tag: "{{NajemcaNazwisko}}", type: "placeholder" },
        { id: "3", text: "zamieszkały w ", tag: "", type: "text" },
        { id: "4", text: "Warszawa, ul. Kwiatowa 15", tag: "{{NajemcaAdres}}", type: "placeholder" },
        { id: "5", text: ", legitymujący się dowodem osobistym nr ", tag: "", type: "text" },
        { id: "6", text: "ABC123456", tag: "{{NajemcaDowod}}", type: "placeholder" },
        { id: "7", text: " oraz PESEL ", tag: "", type: "text" },
        { id: "8", text: "85010112345", tag: "{{NajemcaPESEL}}", type: "placeholder" },
        { id: "9", text: ", zwany dalej Najemcą, wynajmuje lokal o powierzchni ", tag: "", type: "text" },
        { id: "10", text: "45 m²", tag: "{{LokalPowierzchnia}}", type: "placeholder" },
        { id: "11", text: " znajdujący się pod adresem ", tag: "", type: "text" },
        { id: "12", text: "Warszawa, ul. Słoneczna 10/15", tag: "{{LokalAdres}}", type: "placeholder" },
      ];
      
      setExtractedRuns(mockRuns);
      
      toast({
        title: "Sukces!",
        description: `Wyekstrahowano ${mockRuns.length} fragmentów tekstu. Możesz teraz edytować tagi.`,
      });
    } catch (error) {
      toast({
        title: "Błąd",
        description: "Nie udało się przetworzyć dokumentu",
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
            <Label htmlFor="file-upload">Select File</Label>
            <Input
              id="file-upload"
              type="file"
              accept=".docx"
              onChange={handleFileChange}
              className="cursor-pointer"
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
            </div>
          )}
        </div>
      </Card>

      {/* Actions Section */}
      {file && (
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-semibold">Actions</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Button
              onClick={handleExtractRuns}
              disabled={isProcessing}
              className="w-full"
            >
              {isProcessing ? "Processing..." : "Extract Runs"}
            </Button>
            <Button variant="outline" disabled className="w-full gap-2">
              <Download className="h-4 w-4" />
              Find & Replace
            </Button>
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

          <div className="mt-6 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <div className="text-muted-foreground">
                <span className="font-medium text-accent">
                  {extractedRuns.filter(r => r.type === "placeholder").length}
                </span>
                {" "}placeholderów z {extractedRuns.length} fragmentów
              </div>
              <Button className="gap-2">
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
    </div>
  );
};

export default WordTemplater;
