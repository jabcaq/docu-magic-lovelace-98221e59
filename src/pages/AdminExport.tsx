import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Download, Copy, Loader2 } from "lucide-react";

const TABLES = [
  "clients",
  "offices", 
  "documents",
  "document_fields",
  "templates",
  "template_examples",
  "ocr_documents",
  "user_roles",
] as const;

type TableName = typeof TABLES[number];

const AdminExport = () => {
  const [loading, setLoading] = useState(false);
  const [exportData, setExportData] = useState<Record<string, unknown> | null>(null);
  const { toast } = useToast();

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const tables: Record<string, unknown[]> = {};

      for (const table of TABLES) {
        const { data, error } = await supabase
          .from(table)
          .select("*");

        if (error) {
          console.warn(`Error fetching ${table}:`, error.message);
          tables[table] = [];
        } else {
          tables[table] = data || [];
        }
      }

      const result = {
        exported_at: new Date().toISOString(),
        tables,
      };

      setExportData(result);
      return result;
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Błąd eksportu",
        description: "Nie udało się pobrać danych",
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    const data = await fetchAllData();
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Eksport zakończony",
      description: "Plik JSON został pobrany",
    });
  };

  const handleCopy = async () => {
    if (!exportData) {
      const data = await fetchAllData();
      if (!data) return;
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    } else {
      await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    }

    toast({
      title: "Skopiowano",
      description: "Dane zostały skopiowane do schowka",
    });
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Admin Export Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Eksportuje wszystkie dane z tabel: {TABLES.join(", ")}
          </p>

          <div className="flex gap-4">
            <Button onClick={handleExport} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Export All Data
            </Button>

            <Button variant="outline" onClick={handleCopy} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              Copy to Clipboard
            </Button>
          </div>

          {exportData && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                Ostatni eksport: {exportData.exported_at as string}
              </p>
              <p className="text-sm text-muted-foreground">
                Tabel: {Object.keys(exportData.tables as Record<string, unknown>).length}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminExport;
