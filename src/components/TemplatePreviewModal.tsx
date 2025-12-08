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
import { Download, X, FileText, Loader2, AlertCircle } from "lucide-react";
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

  useEffect(() => {
    if (isOpen && template) {
      loadPreview();
    } else {
      setHtml(null);
      setError(null);
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold truncate">
                  {template?.name || "Podgląd szablonu"}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs">
                    {template?.tagCount || 0} zmiennych
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generowanie podglądu...</p>
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
              <div
                className="p-6"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </ScrollArea>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-muted-foreground">Brak zawartości do wyświetlenia</p>
            </div>
          )}
        </div>

        {/* Footer - mobile friendly */}
        <div className="px-6 py-4 border-t shrink-0 flex justify-end gap-2 sm:hidden">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Zamknij
          </Button>
          <Button onClick={handleDownload} disabled={isDownloading} className="flex-1">
            {isDownloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Pobierz
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
