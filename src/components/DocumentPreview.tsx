import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface DocumentPreviewProps {
  documentId: string;
}

const DocumentPreview = ({ documentId }: DocumentPreviewProps) => {
  const [html, setHtml] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRenderedDocument = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase.functions.invoke("render-document", {
          body: { documentId },
        });

        if (error) throw error;

        setHtml(data.html);
      } catch (err) {
        console.error("Error fetching rendered document:", err);
        setError("Nie udało się wczytać podglądu dokumentu");
      } finally {
        setIsLoading(false);
      }
    };

    if (documentId) {
      fetchRenderedDocument();
    }
  }, [documentId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[600px] text-destructive">
        {error}
      </div>
    );
  }

  return (
    <ScrollArea className="h-[700px] w-full border rounded-lg bg-white dark:bg-gray-900 p-8">
      {html ? (
        <div 
          dangerouslySetInnerHTML={{ __html: html }}
          className="prose prose-base max-w-none [&_.doc-variable]:inline [&_.doc-tag-badge]:inline-block"
        />
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Brak zawartości do wyświetlenia
        </div>
      )}
    </ScrollArea>
  );
};

export default DocumentPreview;
