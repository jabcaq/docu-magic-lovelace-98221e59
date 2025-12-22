import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  History, 
  FileText, 
  Calendar, 
  ChevronRight, 
  Loader2, 
  RefreshCw,
  Trash2,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
  Filter,
  ArrowUpDown,
  User,
  Building2,
  FileType,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { OcrAnalysisResult, OcrField, OCR_PROVIDERS } from '@/hooks/use-ocr-analysis';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

interface OcrHistoryItem {
  id: string;
  original_file_name: string;
  original_file_path: string;
  extracted_fields: OcrField[] | null;
  preliminary_ocr_data: {
    documentType?: string;
    provider?: string;
    summary?: string;
    fieldsCount?: number;
    clientName?: string;
    clientEori?: string;
  } | null;
  status: string;
  confidence_score: number | null;
  created_at: string;
  matched_template_id: string | null;
  matched_client_id: string | null;
  generated_docx_path: string | null;
  client?: {
    name: string;
    eori: string | null;
  } | null;
  template?: {
    name: string;
  } | null;
}

interface OcrHistoryProps {
  onLoadResult?: (result: OcrAnalysisResult) => void;
  className?: string;
}

type SortOption = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc' | 'status';
type StatusFilter = 'all' | 'completed' | 'processing' | 'pending' | 'failed';

export function OcrHistory({ onLoadResult, className }: OcrHistoryProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<OcrHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<OcrHistoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('date_desc');
  const [showFilters, setShowFilters] = useState(false);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('ocr_documents')
        .select(`
          *,
          client:clients(name, eori),
          template:templates(name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Cast JSON fields to proper types
      const typedData: OcrHistoryItem[] = (data || []).map(item => ({
        ...item,
        extracted_fields: item.extracted_fields as unknown as OcrField[] | null,
        preliminary_ocr_data: item.preliminary_ocr_data as OcrHistoryItem['preliminary_ocr_data'],
        client: item.client as OcrHistoryItem['client'],
        template: item.template as OcrHistoryItem['template'],
      }));

      setItems(typedData);
    } catch (err: any) {
      console.error('Error fetching OCR history:', err);
      toast({
        variant: 'destructive',
        title: 'Błąd',
        description: 'Nie udało się pobrać historii OCR',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Filtered and sorted items
  const filteredItems = useMemo(() => {
    let result = [...items];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(item => {
        const fileName = item.original_file_name?.toLowerCase() || '';
        const clientName = item.client?.name?.toLowerCase() || item.preliminary_ocr_data?.clientName?.toLowerCase() || '';
        const docType = item.preliminary_ocr_data?.documentType?.toLowerCase() || '';
        const templateName = item.template?.name?.toLowerCase() || '';
        return fileName.includes(query) || clientName.includes(query) || docType.includes(query) || templateName.includes(query);
      });
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter(item => item.status === statusFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date_desc':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'date_asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'name_asc':
          return (a.original_file_name || '').localeCompare(b.original_file_name || '');
        case 'name_desc':
          return (b.original_file_name || '').localeCompare(a.original_file_name || '');
        case 'status':
          const statusOrder = { completed: 0, processing: 1, pending: 2, failed: 3 };
          return (statusOrder[a.status as keyof typeof statusOrder] || 4) - (statusOrder[b.status as keyof typeof statusOrder] || 4);
        default:
          return 0;
      }
    });

    return result;
  }, [items, searchQuery, statusFilter, sortBy]);

  const handleLoadResult = useCallback((item: OcrHistoryItem) => {
    if (!item.extracted_fields || item.extracted_fields.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Brak danych',
        description: 'Ten dokument nie ma zapisanych wyników OCR',
      });
      return;
    }

    // Reconstruct OcrAnalysisResult from history item
    const result: OcrAnalysisResult = {
      success: true,
      provider: (item.preliminary_ocr_data?.provider as any) || 'gemini',
      fileName: item.original_file_name || 'document',
      fileType: 'application/octet-stream',
      documentType: item.preliminary_ocr_data?.documentType || 'Dokument',
      documentLanguage: 'pl',
      summary: item.preliminary_ocr_data?.summary || '',
      extractedFields: item.extracted_fields,
      rawText: '',
      fieldsCount: item.extracted_fields.length,
      documentId: item.id,
    };

    onLoadResult?.(result);
    
    toast({
      title: 'Załadowano wyniki',
      description: `Wczytano ${item.extracted_fields.length} pól z "${item.original_file_name}"`,
    });
  }, [onLoadResult, toast]);

  const handleDelete = useCallback(async (itemId: string) => {
    setIsDeleting(itemId);
    try {
      const { error } = await supabase
        .from('ocr_documents')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      setItems(prev => prev.filter(i => i.id !== itemId));
      
      if (selectedItem?.id === itemId) {
        setSelectedItem(null);
      }

      toast({
        title: 'Usunięto',
        description: 'Wynik OCR został usunięty z historii',
      });
    } catch (err: any) {
      console.error('Error deleting OCR item:', err);
      toast({
        variant: 'destructive',
        title: 'Błąd',
        description: 'Nie udało się usunąć wyniku OCR',
      });
    } finally {
      setIsDeleting(null);
    }
  }, [selectedItem, toast]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><CheckCircle2 className="h-3 w-3 mr-1" /> Zakończone</Badge>;
      case 'processing':
        return <Badge variant="default" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> W trakcie</Badge>;
      case 'pending':
        return <Badge variant="default" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="h-3 w-3 mr-1" /> Oczekuje</Badge>;
      case 'failed':
        return <Badge variant="default" className="bg-red-500/10 text-red-600 border-red-500/20"><AlertCircle className="h-3 w-3 mr-1" /> Błąd</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setSortBy('date_desc');
  };

  const hasActiveFilters = searchQuery || statusFilter !== 'all' || sortBy !== 'date_desc';

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-amber-500" />
            <CardTitle>Historia OCR</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {filteredItems.length}/{items.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button 
              variant={showFilters ? "secondary" : "ghost"} 
              size="sm" 
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchHistory}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription>
          Przeglądaj i ponownie używaj poprzednich wyników analizy
        </CardDescription>

        {/* Search and filters */}
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Szukaj po nazwie pliku, kliencie, typie..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="flex gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie statusy</SelectItem>
                  <SelectItem value="completed">Zakończone</SelectItem>
                  <SelectItem value="processing">W trakcie</SelectItem>
                  <SelectItem value="pending">Oczekujące</SelectItem>
                  <SelectItem value="failed">Błędne</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <ArrowUpDown className="h-3 w-3 mr-1" />
                  <SelectValue placeholder="Sortowanie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date_desc">Najnowsze</SelectItem>
                  <SelectItem value="date_asc">Najstarsze</SelectItem>
                  <SelectItem value="name_asc">Nazwa A-Z</SelectItem>
                  <SelectItem value="name_desc">Nazwa Z-A</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">
                  <X className="h-3 w-3 mr-1" />
                  Wyczyść filtry
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">
              {items.length === 0 ? 'Brak historii' : 'Brak wyników'}
            </p>
            <p className="text-sm mt-1">
              {items.length === 0 
                ? 'Twoje analizy OCR pojawią się tutaj' 
                : 'Spróbuj zmienić kryteria wyszukiwania'
              }
            </p>
            {hasActiveFilters && (
              <Button variant="link" onClick={clearFilters} className="mt-2">
                Wyczyść filtry
              </Button>
            )}
          </div>
        ) : (
          <div className="flex">
            {/* Lista elementów */}
            <ScrollArea className="h-[400px] flex-1 border-r">
              <div className="divide-y">
                {filteredItems.map((item) => {
                  const clientName = item.client?.name || item.preliminary_ocr_data?.clientName;
                  const docType = item.preliminary_ocr_data?.documentType;
                  const templateName = item.template?.name;
                  
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'p-4 cursor-pointer transition-colors hover:bg-accent/50',
                        selectedItem?.id === item.id && 'bg-accent'
                      )}
                      onClick={() => setSelectedItem(item)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* File name */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium text-sm truncate">
                              {item.original_file_name || 'Bez nazwy'}
                            </span>
                          </div>

                          {/* Client and document type info */}
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-xs">
                            {clientName && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <User className="h-3 w-3" />
                                <span className="truncate max-w-[120px]">{clientName}</span>
                              </div>
                            )}
                            {docType && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <FileType className="h-3 w-3" />
                                <span className="truncate max-w-[100px]">{docType}</span>
                              </div>
                            )}
                            {templateName && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Building2 className="h-3 w-3" />
                                <span className="truncate max-w-[100px]">{templateName}</span>
                              </div>
                            )}
                          </div>

                          {/* Date */}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                            <Calendar className="h-3 w-3" />
                            <span>
                              {format(new Date(item.created_at), 'dd MMM yyyy, HH:mm', { locale: pl })}
                            </span>
                          </div>

                          {/* Status and fields count */}
                          <div className="flex items-center gap-2">
                            {getStatusBadge(item.status)}
                            {item.extracted_fields && item.extracted_fields.length > 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                {item.extracted_fields.length} pól
                              </Badge>
                            )}
                            {item.confidence_score !== null && item.confidence_score > 0 && (
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "text-[10px]",
                                  item.confidence_score >= 0.8 && "border-emerald-500/30 text-emerald-600",
                                  item.confidence_score >= 0.5 && item.confidence_score < 0.8 && "border-amber-500/30 text-amber-600",
                                  item.confidence_score < 0.5 && "border-red-500/30 text-red-600"
                                )}
                              >
                                {Math.round(item.confidence_score * 100)}%
                              </Badge>
                            )}
                          </div>
                        </div>
                        <ChevronRight className={cn(
                          'h-4 w-4 text-muted-foreground transition-transform shrink-0 mt-1',
                          selectedItem?.id === item.id && 'rotate-90'
                        )} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Panel szczegółów */}
            {selectedItem && (
              <div className="w-[300px] p-4 bg-muted/30">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Szczegóły</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Plik:</span>
                        <span className="font-medium truncate max-w-[150px]">
                          {selectedItem.original_file_name}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status:</span>
                        {getStatusBadge(selectedItem.status)}
                      </div>
                      {(selectedItem.client?.name || selectedItem.preliminary_ocr_data?.clientName) && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Klient:</span>
                          <span className="font-medium truncate max-w-[150px]">
                            {selectedItem.client?.name || selectedItem.preliminary_ocr_data?.clientName}
                          </span>
                        </div>
                      )}
                      {selectedItem.preliminary_ocr_data?.documentType && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Typ:</span>
                          <span className="font-medium">
                            {selectedItem.preliminary_ocr_data.documentType}
                          </span>
                        </div>
                      )}
                      {selectedItem.template?.name && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Szablon:</span>
                          <span className="font-medium truncate max-w-[150px]">
                            {selectedItem.template.name}
                          </span>
                        </div>
                      )}
                      {selectedItem.extracted_fields && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pola:</span>
                          <span className="font-medium">
                            {selectedItem.extracted_fields.length}
                          </span>
                        </div>
                      )}
                      {selectedItem.confidence_score !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pewność:</span>
                          <span className="font-medium">
                            {Math.round(selectedItem.confidence_score * 100)}%
                          </span>
                        </div>
                      )}
                      {selectedItem.preliminary_ocr_data?.provider && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Provider:</span>
                          <span className="font-medium">
                            {OCR_PROVIDERS.find(p => p.id === selectedItem.preliminary_ocr_data?.provider)?.name || selectedItem.preliminary_ocr_data.provider}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedItem.preliminary_ocr_data?.summary && (
                    <div>
                      <h4 className="font-medium mb-2">Podsumowanie</h4>
                      <p className="text-sm text-muted-foreground">
                        {selectedItem.preliminary_ocr_data.summary}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-2">
                    <Button 
                      className="w-full"
                      onClick={() => handleLoadResult(selectedItem)}
                      disabled={!selectedItem.extracted_fields || selectedItem.extracted_fields.length === 0}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Użyj ponownie
                    </Button>
                    
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" className="w-full text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Usuń
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Usuń wynik OCR?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Ta operacja jest nieodwracalna. Wynik OCR zostanie trwale usunięty z historii.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Anuluj</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => handleDelete(selectedItem.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {isDeleting === selectedItem.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Usuń'
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OcrHistory;
