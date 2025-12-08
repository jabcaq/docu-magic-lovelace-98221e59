import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Calendar, Loader2, Trash2, FileStack } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Template {
  id: string;
  name: string;
  createdAt: string;
  storagePath: string;
  tagCount: number;
}

const Documents = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("date-desc");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigate("/auth");
        return;
      }

      const { data: templatesData, error } = await supabase
        .from("templates")
        .select("id, name, created_at, storage_path, tag_metadata")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const formattedTemplates: Template[] = templatesData?.map(t => {
        const tagMetadata = t.tag_metadata as any;
        const tagCount = Array.isArray(tagMetadata) ? tagMetadata.length : 0;
        
        return {
          id: t.id,
          name: t.name,
          createdAt: t.created_at,
          storagePath: t.storage_path,
          tagCount,
        };
      }) || [];

      setTemplates(formattedTemplates);
    } catch (error) {
      console.error("Error fetching templates:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się pobrać szablonów",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const deleteTemplate = async (templateId: string, templateName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm(`Czy na pewno chcesz usunąć szablon "${templateName}"?`)) {
      return;
    }

    try {
      const { data: template, error: fetchError } = await supabase
        .from("templates")
        .select("storage_path")
        .eq("id", templateId)
        .single();

      if (fetchError) throw fetchError;

      // Delete file from storage
      if (template.storage_path) {
        await supabase.storage
          .from("documents")
          .remove([template.storage_path]);
      }

      // Delete template record
      const { error: deleteError } = await supabase
        .from("templates")
        .delete()
        .eq("id", templateId);

      if (deleteError) throw deleteError;

      toast({
        title: "Szablon usunięty",
        description: `"${templateName}" został usunięty`,
      });

      fetchTemplates();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się usunąć szablonu",
        variant: "destructive",
      });
    }
  };

  const downloadTemplate = async (templateId: string, templateName: string, storagePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      toast({ title: "Pobieranie..." });

      const { data, error } = await supabase.storage
        .from("documents")
        .download(storagePath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = templateName.endsWith('.docx') ? templateName : `${templateName}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Pobrano",
        description: "Szablon został pobrany",
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się pobrać szablonu",
        variant: "destructive",
      });
    }
  };

  const filteredTemplates = templates
    .filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "date-desc") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === "date-asc") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return 0;
    });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <FileStack className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Szablony</h1>
                <p className="text-xs text-muted-foreground">Zapisane szablony dokumentów</p>
              </div>
            </div>
            <Button onClick={() => navigate("/dashboard")} variant="outline">
              Powrót
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full px-6 py-8">
        {/* Filters & Search */}
        <div className="mb-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Szukaj szablonów..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Sortuj" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date-desc">Najnowsze</SelectItem>
                <SelectItem value="date-asc">Najstarsze</SelectItem>
                <SelectItem value="name">Nazwa A-Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Templates Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((template) => (
              <Card
                key={template.id}
                className="p-6 cursor-pointer hover:shadow-lg transition-all hover:scale-105 relative group"
                onClick={(e) => downloadTemplate(template.id, template.name, template.storagePath, e)}
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {template.tagCount} zmiennych
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => deleteTemplate(template.id, template.name, e)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-1 line-clamp-2">{template.name}</h3>
                    <p className="text-sm text-muted-foreground">Szablon DOCX</p>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>{new Date(template.createdAt).toLocaleDateString("pl-PL")}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && filteredTemplates.length === 0 && (
          <div className="text-center py-12">
            <FileStack className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Brak szablonów</h3>
            <p className="text-muted-foreground">
              Nie masz jeszcze żadnych zapisanych szablonów. Przetwórz dokument w zakładce "Templater" i zapisz go jako szablon.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Documents;
