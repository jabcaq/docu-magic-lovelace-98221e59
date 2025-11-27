import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  ScanText, 
  History, 
  FileText,
  Clock,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OcrUpload } from '@/components/OcrUpload';
import { OcrAnalysisResult, FIELD_CATEGORIES } from '@/hooks/use-ocr-analysis';

interface AnalysisHistoryItem extends OcrAnalysisResult {
  analyzedAt: Date;
}

export default function OcrAnalysis() {
  const [history, setHistory] = useState<AnalysisHistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<AnalysisHistoryItem | null>(null);

  const handleAnalysisComplete = (result: OcrAnalysisResult) => {
    const historyItem: AnalysisHistoryItem = {
      ...result,
      analyzedAt: new Date(),
    };
    setHistory(prev => [historyItem, ...prev]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/dashboard">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500">
                  <ScanText className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">OCR z Gemini 2.5 Pro</h1>
                  <p className="text-sm text-white/60">
                    Inteligentna ekstrakcja danych z dokumentów
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-violet-500/20 text-violet-300 border-violet-500/30">
                <Sparkles className="h-3 w-3 mr-1" />
                Gemini 2.5 Pro
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="upload" className="space-y-6">
          <TabsList className="bg-white/5 border border-white/10">
            <TabsTrigger 
              value="upload" 
              className="data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-300"
            >
              <ScanText className="h-4 w-4 mr-2" />
              Nowa analiza
            </TabsTrigger>
            <TabsTrigger 
              value="history"
              className="data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-300"
            >
              <History className="h-4 w-4 mr-2" />
              Historia ({history.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Upload Section */}
              <div className="lg:col-span-2">
                <OcrUpload 
                  onAnalysisComplete={handleAnalysisComplete}
                  saveToDatabase={true}
                />
              </div>

              {/* Info Panel */}
              <div className="space-y-4">
                <Card className="bg-white/5 border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">
                      Obsługiwane formaty
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3 text-white/80">
                      <div className="p-2 rounded-lg bg-blue-500/20">
                        <FileText className="h-4 w-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="font-medium">Obrazy</p>
                        <p className="text-xs text-white/50">JPG, PNG, GIF, WebP</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-white/80">
                      <div className="p-2 rounded-lg bg-red-500/20">
                        <FileText className="h-4 w-4 text-red-400" />
                      </div>
                      <div>
                        <p className="font-medium">PDF</p>
                        <p className="text-xs text-white/50">Skany, dokumenty wielostronicowe</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-white/80">
                      <div className="p-2 rounded-lg bg-violet-500/20">
                        <FileText className="h-4 w-4 text-violet-400" />
                      </div>
                      <div>
                        <p className="font-medium">Word</p>
                        <p className="text-xs text-white/50">DOC, DOCX</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white/5 border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">
                      Wykrywane kategorie
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(FIELD_CATEGORIES).map(([key, label]) => (
                        <Badge 
                          key={key}
                          variant="outline" 
                          className="bg-white/5 border-white/10 text-white/70"
                        >
                          {label}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-violet-500/20 to-blue-500/20 border-violet-500/30">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <Sparkles className="h-5 w-5 text-violet-400 mt-0.5" />
                      <div>
                        <p className="font-medium text-white">
                          Zaawansowana analiza AI
                        </p>
                        <p className="text-sm text-white/70 mt-1">
                          Gemini 2.5 Pro automatycznie rozpoznaje typy dokumentów, 
                          wyodrębnia dane i określa poziom pewności dla każdego pola.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history">
            {history.length === 0 ? (
              <Card className="bg-white/5 border-white/10">
                <CardContent className="py-12 text-center">
                  <History className="h-12 w-12 text-white/20 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-white/80">
                    Brak historii analiz
                  </h3>
                  <p className="text-white/50 mt-1">
                    Przeanalizowane dokumenty pojawią się tutaj
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
                  <Card className="bg-white/5 border-white/10">
                    <CardHeader>
                      <CardTitle className="text-white">Historia analiz</CardTitle>
                      <CardDescription>
                        Kliknij aby zobaczyć szczegóły
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="h-[500px]">
                        <div className="p-4 space-y-2">
                          {history.map((item, index) => (
                            <button
                              key={index}
                              onClick={() => setSelectedHistoryItem(item)}
                              className={`w-full text-left p-4 rounded-lg transition-colors ${
                                selectedHistoryItem === item
                                  ? 'bg-violet-500/20 border border-violet-500/30'
                                  : 'bg-white/5 hover:bg-white/10 border border-transparent'
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="min-w-0">
                                  <p className="font-medium text-white truncate">
                                    {item.fileName}
                                  </p>
                                  <p className="text-sm text-white/50 truncate mt-1">
                                    {item.documentType}
                                  </p>
                                </div>
                                <Badge 
                                  variant="secondary" 
                                  className="bg-emerald-500/20 text-emerald-300 shrink-0 ml-2"
                                >
                                  {item.fieldsCount}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-1 mt-2 text-xs text-white/40">
                                <Clock className="h-3 w-3" />
                                {item.analyzedAt.toLocaleTimeString('pl-PL')}
                              </div>
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>

                <div className="lg:col-span-2">
                  {selectedHistoryItem ? (
                    <Card className="bg-white/5 border-white/10">
                      <CardHeader className="bg-gradient-to-br from-emerald-500/10 via-transparent to-blue-500/10">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-white flex items-center gap-2">
                              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                              {selectedHistoryItem.fileName}
                            </CardTitle>
                            <CardDescription>
                              {selectedHistoryItem.documentType} • {selectedHistoryItem.fieldsCount} pól
                            </CardDescription>
                          </div>
                          <Badge className="bg-white/10 text-white/70">
                            {selectedHistoryItem.documentLanguage?.toUpperCase()}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6">
                        {selectedHistoryItem.summary && (
                          <div className="p-4 rounded-lg bg-white/5 mb-6">
                            <p className="text-sm text-white/80">
                              <span className="font-medium text-white">Podsumowanie: </span>
                              {selectedHistoryItem.summary}
                            </p>
                          </div>
                        )}
                        
                        <ScrollArea className="h-[400px]">
                          <div className="space-y-3">
                            {selectedHistoryItem.extractedFields.map((field, idx) => (
                              <div 
                                key={idx}
                                className="flex items-center justify-between p-3 rounded-lg bg-white/5"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-mono text-violet-400">
                                    {`{{${field.tag}}}`}
                                  </p>
                                  <p className="font-medium text-white mt-1">
                                    {field.label}
                                  </p>
                                  <p className="text-sm text-white/70 font-mono truncate">
                                    {field.value}
                                  </p>
                                </div>
                                <Badge 
                                  variant="outline"
                                  className={`shrink-0 ml-4 ${
                                    field.confidence === 'high' 
                                      ? 'border-emerald-500/30 text-emerald-400'
                                      : field.confidence === 'medium'
                                      ? 'border-amber-500/30 text-amber-400'
                                      : 'border-red-500/30 text-red-400'
                                  }`}
                                >
                                  {field.confidence === 'high' ? '✓ wysoka' : 
                                   field.confidence === 'medium' ? '~ średnia' : '? niska'}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="bg-white/5 border-white/10 h-full">
                      <CardContent className="py-12 text-center flex flex-col items-center justify-center h-full">
                        <FileText className="h-12 w-12 text-white/20 mb-4" />
                        <p className="text-white/50">
                          Wybierz analizę z listy aby zobaczyć szczegóły
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

