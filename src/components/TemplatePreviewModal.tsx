import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, FileText, Loader2, AlertCircle, ZoomIn, ZoomOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface TemplatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: {
    id: string;
    name: string;
    storagePath: string;
    tagCount: number;
  } | null;
}

export function TemplatePreviewModal({ isOpen, onClose, template }: TemplatePreviewModalProps) {
  const { toast } = useToast();
  const [html, setHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [variableCount, setVariableCount] = useState(0);

  useEffect(() => {
    if (isOpen && template) {
      loadPreview();
      setZoom(100);
    } else {
      setHtml(null);
      setError(null);
      setVariableCount(0);
    }
  }, [isOpen, template?.id]);

  const loadPreview = async () => {
    if (!template) return;

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fnError } = await supabase.functions.invoke("render-template", {
        body: { templateId: template.id },
      });

      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);

      setHtml(data.html);
      
      // Count variables from rendered HTML
      const varMatches = (data.html || "").match(/\{\{[^}]+\}\}/g);
      setVariableCount(varMatches ? varMatches.length : 0);
    } catch (err) {
      console.error("Error loading preview:", err);
      setError(err instanceof Error ? err.message : "Nie udało się załadować podglądu");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!template) return;

    try {
      setIsDownloading(true);

      const { data, error } = await supabase.storage
        .from("documents")
        .download(template.storagePath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = template.name.endsWith(".docx") ? template.name : `${template.name}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Pobrano",
        description: "Szablon został pobrany",
      });
    } catch (err) {
      console.error("Download error:", err);
      toast({
        title: "Błąd",
        description: "Nie udało się pobrać szablonu",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 200));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 50));

  // CSS for A4 document styling - matching Word appearance
  const documentStyles = `
    .document-page {
      background: white;
      width: 210mm;
      min-height: 297mm;
      padding: 15mm 20mm;
      margin: 20px auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
      font-family: 'Calibri', 'Arial', sans-serif;
      font-size: 10pt;
      line-height: 1.3;
      color: #000;
      transform-origin: top center;
    }
    .document-page p {
      margin: 0 0 6pt 0;
      text-align: left;
    }
    .document-page table {
      width: 100%;
      border-collapse: collapse;
      margin: 6pt 0;
      font-size: 9pt;
    }
    .document-page td, .document-page th {
      border: 1px solid #000;
      padding: 3pt 5pt;
      text-align: left;
      vertical-align: top;
    }
    .document-page th {
      background: #f0f0f0;
      font-weight: bold;
    }
    .document-page .var { 
      background-color: #FEF3C7; 
      border: 1px solid #F59E0B; 
      padding: 0 4px; 
      border-radius: 2px; 
      font-weight: 500; 
      font-family: 'Courier New', monospace;
      font-size: 0.85em;
      color: #92400E;
      text-decoration: underline;
      text-decoration-color: #F59E0B;
    }
    .document-page .filled {
      background-color: #FEF08A;
      padding: 0 2px;
      border-radius: 1px;
    }
  `;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] w-full md:max-w-5xl h-[90vh] flex flex-col p-0 gap-0 [&>button]:hidden">
        {/* Header */}
        <DialogHeader className="px-4 md:px-6 py-3 md:py-4 border-b shrink-0 bg-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
              <div className="h-8 w-8 md:h-10 md:w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-sm md:text-lg font-semibold truncate">
                  {template?.name || "Podgląd szablonu"}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-0.5 md:mt-1">
                  <Badge variant="secondary" className="text-xs">
                    {variableCount} zmiennych
                  </Badge>
                </div>
              </div>
            </div>
            
            {/* Zoom controls */}
            <div className="hidden md:flex items-center gap-1 border rounded-lg px-2 py-1 bg-muted/50">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} disabled={zoom <= 50}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs font-medium w-10 text-center">{zoom}%</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} disabled={zoom >= 200}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>

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
              Pobierz
            </Button>
          </div>
        </DialogHeader>

        {/* Content - Document Preview */}
        <div className="flex-1 overflow-hidden bg-muted/30">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generowanie podglądu dokumentu...</p>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-destructive text-center">{error}</p>
              <Button variant="outline" size="sm" onClick={loadPreview}>
                Spróbuj ponownie
              </Button>
            </div>
          ) : html ? (
            <ScrollArea className="h-full">
              <style dangerouslySetInnerHTML={{ __html: documentStyles }} />
              <div 
                className="py-6 px-4"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
              >
                <div 
                  className="document-page"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </div>
            </ScrollArea>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-muted-foreground">Brak zawartości do wyświetlenia</p>
            </div>
          )}
        </div>

        {/* Footer - mobile friendly */}
        <div className="px-4 py-3 border-t shrink-0 bg-card flex justify-between items-center gap-2 md:hidden">
          {/* Mobile zoom */}
          <div className="flex items-center gap-1 border rounded-lg px-2 py-1 bg-muted/50">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} disabled={zoom <= 50}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs font-medium w-8 text-center">{zoom}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} disabled={zoom >= 200}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>
          
          <Button variant="outline" size="sm" onClick={onClose}>
            Zamknij
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
