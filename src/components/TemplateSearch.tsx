import { useState, useCallback, useMemo } from 'react';
import { Search, FileText, FileCheck, Loader2, Download, Eye, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TemplatePreviewModal } from './TemplatePreviewModal';

interface SearchResult {
  id: string;
  type: 'template' | 'document';
  name: string;
  storagePath: string;
  tags: string[];
  hasTemplate: boolean;
  templateId?: string;
  score: number;
  reason: string;
  createdAt: string;
}

type FilterType = 'all' | 'template' | 'document';

export function TemplateSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<{ id: string; name: string; storagePath: string; tagCount: number } | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const { toast } = useToast();

  const filteredResults = useMemo(() => {
    if (filterType === 'all') return results;
    if (filterType === 'template') return results.filter(r => r.hasTemplate);
    return results.filter(r => !r.hasTemplate);
  }, [results, filterType]);

  const handleSearch = useCallback(async () => {
    if (query.trim().length < 2) {
      toast({
        title: 'Za krótkie zapytanie',
        description: 'Wpisz minimum 2 znaki',
        variant: 'destructive',
      });
      return;
    }

    setIsSearching(true);
    setHasSearched(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Brak sesji');
      }

      const response = await supabase.functions.invoke('search-templates', {
        body: { query: query.trim(), limit: 10 },
      });

      if (response.error) {
        throw response.error;
      }

      setResults(response.data.results || []);
      
      if (response.data.results?.length === 0) {
        toast({
          title: 'Brak wyników',
          description: 'Nie znaleziono pasujących dokumentów',
        });
      }
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: 'Błąd wyszukiwania',
        description: error instanceof Error ? error.message : 'Spróbuj ponownie',
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  }, [query, toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handlePreview = (result: SearchResult) => {
    setSelectedTemplate({
      id: result.id,
      name: result.name,
      storagePath: result.storagePath,
      tagCount: result.tags.length,
    });
  };

  const handleConvertToTemplate = async (result: SearchResult) => {
    setConvertingId(result.id);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

      const response = await supabase.functions.invoke('create-template', {
        body: { 
          documentId: result.id,
          templateName: result.name.replace(/\.[^/.]+$/, '') + ' - Szablon',
        },
      });

      if (response.error) throw response.error;

      toast({
        title: 'Szablon utworzony',
        description: 'Dokument został przekonwertowany na szablon',
      });

      // Update result in list
      setResults(prev => prev.map(r => 
        r.id === result.id 
          ? { ...r, hasTemplate: true, type: 'template' as const, templateId: response.data.template.id }
          : r
      ));
    } catch (error) {
      console.error('Convert error:', error);
      toast({
        title: 'Błąd konwersji',
        description: error instanceof Error ? error.message : 'Spróbuj ponownie',
        variant: 'destructive',
      });
    } finally {
      setConvertingId(null);
    }
  };

  const handleDownload = async (result: SearchResult) => {
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(result.storagePath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Pobrano',
        description: result.name,
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: 'Błąd pobierania',
        description: 'Nie udało się pobrać pliku',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Input */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Szukaj szablonów i dokumentów..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-10"
            disabled={isSearching}
          />
        </div>
        <Button onClick={handleSearch} disabled={isSearching || query.trim().length < 2}>
          {isSearching ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Szukam...
            </>
          ) : (
            'Szukaj'
          )}
        </Button>
      </div>

      {/* Filter Toggle */}
      {hasSearched && results.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Filtruj:</span>
          <ToggleGroup type="single" value={filterType} onValueChange={(v) => v && setFilterType(v as FilterType)}>
            <ToggleGroupItem value="all" aria-label="Wszystkie">
              Wszystkie ({results.length})
            </ToggleGroupItem>
            <ToggleGroupItem value="template" aria-label="Szablony">
              <FileCheck className="h-4 w-4 mr-1" />
              Szablony ({results.filter(r => r.hasTemplate).length})
            </ToggleGroupItem>
            <ToggleGroupItem value="document" aria-label="Dokumenty">
              <FileText className="h-4 w-4 mr-1" />
              Dokumenty ({results.filter(r => !r.hasTemplate).length})
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {/* Search Tips */}
      {!hasSearched && (
        <Card className="border-dashed">
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground space-y-2">
              <Search className="h-12 w-12 mx-auto opacity-50" />
              <p className="font-medium">Wyszukiwanie semantyczne</p>
              <p className="text-sm">
                Wpisz frazę opisującą dokument, np. "faktura VAT", "umowa najmu", "odprawa celna samochodu"
              </p>
              <p className="text-xs">
                System przeszuka nazwy dokumentów i zmienne (tagi) używając AI
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {hasSearched && !isSearching && (
        <div className="space-y-3">
          {filteredResults.length > 0 && filterType !== 'all' && (
            <p className="text-sm text-muted-foreground">
              Wyświetlono {filteredResults.length} z {results.length} wyników
            </p>
          )}

          {filteredResults.map((result) => (
            <Card key={result.id} className="hover:bg-accent/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {result.hasTemplate ? (
                        <FileCheck className="h-4 w-4 text-green-500 shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-medium truncate">{result.name}</span>
                      <Badge variant={result.hasTemplate ? 'default' : 'secondary'} className="shrink-0">
                        {result.hasTemplate ? 'Szablon' : 'Dokument'}
                      </Badge>
                    </div>

                    {/* Score bar */}
                    <div className="flex items-center gap-2 mb-2">
                      <Progress value={result.score * 100} className="h-2 flex-1 max-w-[200px]" />
                      <span className="text-xs text-muted-foreground">
                        {Math.round(result.score * 100)}% dopasowania
                      </span>
                    </div>

                    {/* Reason */}
                    <p className="text-sm text-muted-foreground mb-2">{result.reason}</p>

                    {/* Tags */}
                    {result.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {result.tags.slice(0, 5).map((tag, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                        {result.tags.length > 5 && (
                          <Badge variant="outline" className="text-xs">
                            +{result.tags.length - 5}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handlePreview(result)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDownload(result)}>
                      <Download className="h-4 w-4" />
                    </Button>
                    {!result.hasTemplate && (
                      <Button 
                        size="sm" 
                        onClick={() => handleConvertToTemplate(result)}
                        disabled={convertingId === result.id}
                      >
                        {convertingId === result.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <ArrowRight className="h-4 w-4 mr-1" />
                            Stwórz szablon
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {filteredResults.length === 0 && results.length > 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground">
                <p>Brak wyników dla wybranego filtra</p>
                <p className="text-sm mt-1">Zmień filtr lub spróbuj innych słów kluczowych</p>
              </CardContent>
            </Card>
          )}

          {results.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground">
                <p>Brak wyników dla "{query}"</p>
                <p className="text-sm mt-1">Spróbuj innych słów kluczowych</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {selectedTemplate && (
        <TemplatePreviewModal
          isOpen={!!selectedTemplate}
          onClose={() => setSelectedTemplate(null)}
          template={selectedTemplate}
        />
      )}
    </div>
  );
}
