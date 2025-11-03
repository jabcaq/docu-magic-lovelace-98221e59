import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, FileText, Image as ImageIcon, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import MagnifyingGlass from "@/components/MagnifyingGlass";

interface DocumentField {
  id: string;
  label: string;
  value: string;
  tag: string;
}

interface DocumentData {
  id: string;
  name: string;
  type: string;
  template: string;
  originalWord: string;
  imageUrl: string;
  fields: DocumentField[];
}

const mockDocument: DocumentData = {
  id: "1",
  name: "Umowa najmu - Kowalski",
  type: "Umowa najmu",
  template: "Szablon Umowy Najmu v2",
  originalWord: "umowa_najmu_master.docx",
  imageUrl: "https://images.unsplash.com/photo-1554224311-beee460ae6fb?w=800",
  fields: [
    { id: "1", label: "Imię i nazwisko najemcy", value: "Jan Kowalski", tag: "{{NajemcaNazwisko}}" },
    { id: "2", label: "PESEL", value: "85010112345", tag: "{{NajemcaPESEL}}" },
    { id: "3", label: "Adres", value: "ul. Kwiatowa 15, Warszawa", tag: "{{NajemcaAdres}}" },
    { id: "4", label: "Data rozpoczęcia", value: "2025-12-01", tag: "{{DataRozpoczecia}}" },
    { id: "5", label: "Czynsz miesięczny", value: "2500 PLN", tag: "{{CzynszKwota}}" },
    { id: "6", label: "Kaucja", value: "5000 PLN", tag: "{{KaucjaKwota}}" },
    { id: "7", label: "Numer lokalu", value: "15", tag: "{{LokalNumer}}" },
    { id: "8", label: "Powierzchnia", value: "45 m²", tag: "{{LokalPowierzchnia}}" },
  ],
};

const VerifyDocument = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [document, setDocument] = useState<DocumentData>(mockDocument);
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    // Initialize edited fields with current values
    const initialFields: Record<string, string> = {};
    document.fields.forEach((field) => {
      initialFields[field.id] = field.value;
    });
    setEditedFields(initialFields);
  }, [document.fields]);

  const handleFieldChange = (fieldId: string, value: string) => {
    setEditedFields((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  const handleSave = async () => {
    try {
      // TODO: Implement save to backend with manual_overrides tracking
      await new Promise((resolve) => setTimeout(resolve, 1000));

      toast({
        title: "Zapisano zmiany",
        description: "Dokument został zaktualizowany i zapisany do bazy danych",
      });

      navigate("/documents");
    } catch (error) {
      toast({
        title: "Błąd",
        description: "Nie udało się zapisać zmian",
        variant: "destructive",
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentFieldId: string) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const fieldIds = document.fields.map((f) => f.id);
      const currentIndex = fieldIds.indexOf(currentFieldId);
      const nextIndex = (currentIndex + 1) % fieldIds.length;
      const nextFieldId = fieldIds[nextIndex];
      inputRefs.current[nextFieldId]?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/documents")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold">{document.name}</h1>
                <p className="text-xs text-muted-foreground">{document.type}</p>
              </div>
            </div>
            <Button onClick={handleSave} className="gap-2">
              <Save className="h-4 w-4" />
              Zapisz zmiany
            </Button>
          </div>
        </div>
      </header>

      {/* Info Bar */}
      <div className="border-b bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Szablon:</span>
              <Badge variant="secondary">{document.template}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Oryginalny Word:</span>
              <span className="font-medium">{document.originalWord}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <main className="container mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left Column - Image with Magnifying Glass */}
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <ImageIcon className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Obraz dokumentu</h2>
              </div>
              <MagnifyingGlass
                imageUrl={document.imageUrl}
                onImageLoad={() => setImageLoaded(true)}
              />
            </Card>
          </div>

          {/* Right Column - Editable Fields */}
          <div className="space-y-4">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <FileText className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Pola dokumentu</h2>
              </div>

              <div className="space-y-6">
                {document.fields.map((field, index) => (
                  <div key={field.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={field.id} className="font-medium">
                        {field.label}
                      </Label>
                      <Badge variant="outline" className="text-xs font-mono">
                        {field.tag}
                      </Badge>
                    </div>
                    <Input
                      id={field.id}
                      ref={(el) => (inputRefs.current[field.id] = el)}
                      value={editedFields[field.id] || ""}
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, field.id)}
                      className="font-mono text-sm"
                      placeholder={`Wprowadź ${field.label.toLowerCase()}`}
                      autoFocus={index === 0}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t">
                <div className="flex gap-3">
                  <Button onClick={handleSave} className="flex-1 gap-2">
                    <Save className="h-4 w-4" />
                    Zapisz do bazy danych
                  </Button>
                  <Button variant="outline" className="flex-1" disabled>
                    Zapisz do Google Drive
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default VerifyDocument;
