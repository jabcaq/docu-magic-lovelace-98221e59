import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, TrendingUp, Coins, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DocumentUsage {
  id: string;
  name: string;
  created_at: string;
  processing_result: {
    usage?: {
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costPLN: number;
    };
    stats?: {
      changesApplied: number;
      paragraphs: number;
    };
  } | null;
}

interface AggregatedStats {
  totalDocuments: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostPLN: number;
  averageTokensPerDoc: number;
  averageCostPerDoc: number;
  modelBreakdown: Record<string, { count: number; tokens: number; cost: number }>;
}

const AiUsageStats = () => {
  const [documents, setDocuments] = useState<DocumentUsage[]>([]);
  const [stats, setStats] = useState<AggregatedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchStats = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, created_at, processing_result")
        .eq("processing_status", "completed")
        .not("processing_result", "is", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const docsWithUsage = (data || []).filter(
        (doc: any) => doc.processing_result?.usage
      ) as DocumentUsage[];

      setDocuments(docsWithUsage);

      // Calculate aggregated stats
      const aggregated: AggregatedStats = {
        totalDocuments: docsWithUsage.length,
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCostPLN: 0,
        averageTokensPerDoc: 0,
        averageCostPerDoc: 0,
        modelBreakdown: {},
      };

      docsWithUsage.forEach((doc) => {
        const usage = doc.processing_result?.usage;
        if (usage) {
          aggregated.totalTokens += usage.totalTokens;
          aggregated.totalPromptTokens += usage.promptTokens;
          aggregated.totalCompletionTokens += usage.completionTokens;
          aggregated.totalCostPLN += usage.costPLN;

          const model = usage.model || "unknown";
          if (!aggregated.modelBreakdown[model]) {
            aggregated.modelBreakdown[model] = { count: 0, tokens: 0, cost: 0 };
          }
          aggregated.modelBreakdown[model].count += 1;
          aggregated.modelBreakdown[model].tokens += usage.totalTokens;
          aggregated.modelBreakdown[model].cost += usage.costPLN;
        }
      });

      if (docsWithUsage.length > 0) {
        aggregated.averageTokensPerDoc = Math.round(
          aggregated.totalTokens / docsWithUsage.length
        );
        aggregated.averageCostPerDoc =
          aggregated.totalCostPLN / docsWithUsage.length;
      }

      setStats(aggregated);
    } catch (err) {
      console.error("Error fetching AI stats:", err);
      toast({
        title: "Błąd",
        description: "Nie udało się pobrać statystyk AI",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500">
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Statystyki użycia AI</h2>
            <p className="text-sm text-muted-foreground">
              Przegląd kosztów i zużycia tokenów
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={fetchStats} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Odśwież
        </Button>
      </div>

      {/* Summary Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dokumenty z AI</p>
                <p className="text-2xl font-bold">{stats.totalDocuments}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <BarChart3 className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Łącznie tokenów</p>
                <p className="text-2xl font-bold">
                  {stats.totalTokens.toLocaleString("pl-PL")}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Coins className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Łączny koszt</p>
                <p className="text-2xl font-bold text-primary">
                  {stats.totalCostPLN.toLocaleString("pl-PL", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4,
                  })}{" "}
                  PLN
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Coins className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Śr. koszt/dok.</p>
                <p className="text-2xl font-bold">
                  {stats.averageCostPerDoc.toLocaleString("pl-PL", {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  })}{" "}
                  PLN
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Model Breakdown */}
      {stats && Object.keys(stats.modelBreakdown).length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Użycie wg modelu</h3>
          <div className="space-y-3">
            {Object.entries(stats.modelBreakdown).map(([model, data]) => (
              <div
                key={model}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div>
                  <p className="font-mono text-sm font-medium">{model}</p>
                  <p className="text-xs text-muted-foreground">
                    {data.count} dokumentów
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">
                    {data.tokens.toLocaleString("pl-PL")} tokenów
                  </p>
                  <p className="text-xs text-primary">
                    {data.cost.toLocaleString("pl-PL", {
                      minimumFractionDigits: 4,
                      maximumFractionDigits: 4,
                    })}{" "}
                    PLN
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Detailed token breakdown */}
      {stats && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Szczegóły tokenów</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground">Tokeny wejściowe (prompt)</p>
              <p className="text-xl font-bold">
                {stats.totalPromptTokens.toLocaleString("pl-PL")}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground">Tokeny wyjściowe (completion)</p>
              <p className="text-xl font-bold">
                {stats.totalCompletionTokens.toLocaleString("pl-PL")}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground">Średnio tokenów/dokument</p>
              <p className="text-xl font-bold">
                {stats.averageTokensPerDoc.toLocaleString("pl-PL")}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Recent Documents */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">
          Ostatnie dokumenty ({documents.length})
        </h3>
        {documents.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            Brak przetworzonych dokumentów z danymi AI
          </p>
        ) : (
          <div className="max-h-[400px] overflow-y-auto divide-y rounded-lg border">
            {documents.slice(0, 20).map((doc) => {
              const usage = doc.processing_result?.usage;
              return (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(doc.created_at).toLocaleString("pl-PL")}
                    </p>
                  </div>
                  {usage && (
                    <div className="text-right ml-4 shrink-0">
                      <p className="text-sm font-mono">
                        {usage.totalTokens.toLocaleString("pl-PL")} tok
                      </p>
                      <p className="text-xs text-primary">
                        {usage.costPLN.toLocaleString("pl-PL", {
                          minimumFractionDigits: 4,
                          maximumFractionDigits: 4,
                        })}{" "}
                        PLN
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default AiUsageStats;
