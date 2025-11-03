import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Calendar, Filter } from "lucide-react";

type DocumentStatus = "pending" | "verified" | "rejected";

interface Document {
  id: string;
  name: string;
  type: string;
  date: string;
  status: DocumentStatus;
  template: string;
  thumbnail?: string;
}

const mockDocuments: Document[] = [
  {
    id: "1",
    name: "Umowa najmu - Kowalski",
    type: "Umowa najmu",
    date: "2025-11-03",
    status: "pending",
    template: "Szablon Umowy Najmu v2",
  },
  {
    id: "2",
    name: "Faktura VAT 2025/01/123",
    type: "Faktura",
    date: "2025-11-02",
    status: "verified",
    template: "Szablon Faktury",
  },
  {
    id: "3",
    name: "Wniosek urlopowy - Nowak",
    type: "Wniosek",
    date: "2025-11-01",
    status: "pending",
    template: "Szablon Wniosku",
  },
  {
    id: "4",
    name: "Protokół spotkania",
    type: "Protokół",
    date: "2025-10-31",
    status: "verified",
    template: "Szablon Protokołu",
  },
];

const Documents = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("date-desc");

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

  const filteredDocuments = mockDocuments
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
        <div className="container mx-auto px-6 py-4">
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
      <main className="container mx-auto px-6 py-8">
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredDocuments.map((doc) => (
            <Card
              key={doc.id}
              className="p-6 cursor-pointer hover:shadow-lg transition-all hover:scale-105"
              onClick={() => navigate(`/verify/${doc.id}`)}
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <Badge className={getStatusColor(doc.status)}>
                    {getStatusLabel(doc.status)}
                  </Badge>
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
                  <div className="text-xs text-muted-foreground">
                    Szablon: {doc.template}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {filteredDocuments.length === 0 && (
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
