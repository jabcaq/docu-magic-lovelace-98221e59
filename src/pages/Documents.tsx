import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Calendar, Filter, Loader2, Trash2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type DocumentStatus = "pending" | "verified" | "rejected";

interface Document {
  id: string;
  name: string;
  type: string;
  date: string;
  status: DocumentStatus;
  template: string | null;
}

const Documents = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("date-desc");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const getStatusColor = (status: DocumentStatus) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "verified":
        return "bg-green-100 text-green-800 border-green-300";
      case "rejected":
        return "bg-red-100 text-red-800 border-red-300";
      default:
        return "";
    }
  };

  const getStatusLabel = (status: DocumentStatus) => {
    switch (status) {
      case "pending":
        return "Do weryfikacji";
      case "verified":
        return "Zweryfikowany";
      case "rejected":
        return "Odrzucony";
      default:
        return status;
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigate("/auth");
        return;
      }

      // Fetch documents with template names
      const { data: docsData, error: docsError } = await supabase
        .from("documents")
        .select(`
          id,
          name,
          type,
          created_at,
          status,
          template_id,
          storage_path
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (docsError) throw docsError;

      // Fetch template names for documents that have templates
      const templateIds = docsData
        ?.filter(doc => doc.template_id)
        .map(doc => doc.template_id) || [];

      let templatesMap: Record<string, string> = {};
      
      if (templateIds.length > 0) {
        const { data: templatesData, error: templatesError } = await supabase
          .from("templates")
          .select("id, name")
          .in("id", templateIds);

        if (templatesError) throw templatesError;

        templatesMap = Object.fromEntries(
          templatesData?.map(t => [t.id, t.name]) || []
        );
      }

      const formattedDocs: Document[] = docsData?.map(doc => ({
        id: doc.id,
        name: doc.name,
        type: doc.type,
        date: doc.created_at,
        status: doc.status as DocumentStatus,
        template: doc.template_id ? templatesMap[doc.template_id] : null,
      })) || [];

      setDocuments(formattedDocs);
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się pobrać dokumentów",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const extractPdfData = async (docId: string, docName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      toast({
        title: "Przetwarzanie...",
        description: "Wyciągam dane z PDF za pomocą AI",
      });

      const { data, error } = await supabase.functions.invoke('extract-pdf-data', {
        body: { documentId: docId }
      });

      if (error) throw error;

      toast({
        title: "Dane wyciągnięte!",
        description: `Znaleziono ${data.fieldsCreated} pól danych`,
      });

      // Navigate to verify page to see the results
      navigate(`/verify/${docId}`);
    } catch (error) {
      console.error('Error extracting PDF data:', error);
      toast({
        title: "Błąd",
        description: "Nie udało się wyciągnąć danych z PDF",
        variant: "destructive",
      });
    }
  };

  const deleteDocument = async (docId: string, docName: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click navigation
    
    if (!confirm(`Czy na pewno chcesz usunąć dokument "${docName}"?`)) {
      return;
    }

    try {
      // Get document details for storage path
      const { data: doc, error: fetchError } = await supabase
        .from("documents")
        .select("storage_path")
        .eq("id", docId)
        .single();

      if (fetchError) throw fetchError;

      // Delete file from storage
      if (doc.storage_path) {
        const { error: storageError } = await supabase.storage
          .from("documents")
          .remove([doc.storage_path]);

        if (storageError) {
          console.error("Storage deletion error:", storageError);
          // Continue with document deletion even if storage fails
        }
      }

      // Delete document fields first (due to foreign key)
      const { error: fieldsError } = await supabase
        .from("document_fields")
        .delete()
        .eq("document_id", docId);

      if (fieldsError) {
        console.error("Fields deletion error:", fieldsError);
      }

      // Delete document record
      const { error: docError } = await supabase
        .from("documents")
        .delete()
        .eq("id", docId);

      if (docError) throw docError;

      toast({
        title: "Dokument usunięty",
        description: `"${docName}" został usunięty`,
      });

      // Refresh documents list
      fetchDocuments();
    } catch (error) {
      console.error("Error deleting document:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się usunąć dokumentu",
        variant: "destructive",
      });
    }
  };

  const filteredDocuments = documents
    .filter((doc) => {
      const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           doc.type.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || doc.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortBy === "date-desc") return new Date(b.date).getTime() - new Date(a.date).getTime();
      if (sortBy === "date-asc") return new Date(a.date).getTime() - new Date(b.date).getTime();
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
                <FileText className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Dokumenty</h1>
                <p className="text-xs text-muted-foreground">Zarządzanie i weryfikacja</p>
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
          <div className="grid gap-4 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Szukaj dokumentów..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Wszystkie statusy</SelectItem>
                <SelectItem value="pending">Do weryfikacji</SelectItem>
                <SelectItem value="verified">Zweryfikowane</SelectItem>
                <SelectItem value="rejected">Odrzucone</SelectItem>
              </SelectContent>
            </Select>

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

        {/* Documents Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredDocuments.map((doc) => (
            <Card
              key={doc.id}
              className="p-6 cursor-pointer hover:shadow-lg transition-all hover:scale-105 relative group"
              onClick={() => navigate(`/verify/${doc.id}`)}
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getStatusColor(doc.status)}>
                      {getStatusLabel(doc.status)}
                    </Badge>
                    {doc.type === 'pdf' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/10 hover:text-primary"
                        onClick={(e) => extractPdfData(doc.id, doc.name, e)}
                        title="Wyciągnij dane AI"
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                      onClick={(e) => deleteDocument(doc.id, doc.name, e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-1 line-clamp-2">{doc.name}</h3>
                  <p className="text-sm text-muted-foreground">{doc.type}</p>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>{new Date(doc.date).toLocaleDateString("pl-PL")}</span>
                  </div>
                  {doc.template && (
                    <div className="text-xs text-muted-foreground">
                      Szablon: {doc.template}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
          </div>
        )}

        {!isLoading && filteredDocuments.length === 0 && (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Brak dokumentów</h3>
            <p className="text-muted-foreground">
              Nie znaleziono dokumentów spełniających kryteria wyszukiwania
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Documents;
