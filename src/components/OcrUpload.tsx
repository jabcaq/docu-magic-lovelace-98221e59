import { useCallback, useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  FileImage, 
  FileText, 
  File, 
  X, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Car,
  User,
  MapPin,
  Calendar,
  DollarSign,
  Ship,
  Globe,
  Shield,
  MoreHorizontal,
  Copy,
  Download,
  ChevronDown,
  ChevronUp,
  Sparkles,
  LayoutGrid,
  Check,
  FileSearch,
  ExternalLink,
  Eye,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { 
  useOcrAnalysis, 
  OcrField, 
  OcrAnalysisResult,
  OcrProvider,
  OcrRealtimeProgress,
  OCR_PROVIDERS,
  FIELD_CATEGORIES 
} from '@/hooks/use-ocr-analysis';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface OcrUploadProps {
  onAnalysisComplete?: (result: OcrAnalysisResult) => void;
  onProviderChange?: (provider: OcrProvider) => void;
  saveToDatabase?: boolean;
  defaultProvider?: OcrProvider;
  className?: string;
}

interface TemplateSuggestion {
  id: string;
  name: string;
  storagePath: string;
  score: number;
  matchReason: string;
  tagCount: number;
}

interface FillTemplateResult {
  success: boolean;
  base64: string;
  filename: string;
  storagePath?: string;
  templateName?: string;
  stats: {
    totalTemplateTags: number;
    matchedFields: number;
    unmatchedTags: number;
    replacementsMade: number;
    aiMatchingUsed?: boolean;
  };
  matchedFields: Array<{
    templateTag: string;
    ocrTag: string;
    ocrValue: string;
    ocrLabel: string;
    confidence: string;
    matchType: string;
  }>;
  unmatchedTags: string[];
}

interface TemplateSuggestionsProps {
  result: OcrAnalysisResult;
  onSelectTemplate?: (template: TemplateSuggestion) => void;
  onFillComplete?: (fillResult: FillTemplateResult) => void;
  onShowPreview?: (previewData: { storagePath: string; filename: string; base64: string; stats: FillTemplateResult['stats']; matchedFields: FillTemplateResult['matchedFields'] }) => void;
}

function TemplateSuggestions({ result, onSelectTemplate, onFillComplete, onShowPreview }: TemplateSuggestionsProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<TemplateSuggestion[]>([]);
  const [searched, setSearched] = useState(false);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [allTemplates, setAllTemplates] = useState<TemplateSuggestion[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [fillingTemplate, setFillingTemplate] = useState<string | null>(null);

  const fillTemplate = useCallback(async (template: TemplateSuggestion) => {
    setFillingTemplate(template.id);
    try {
      toast({
        title: 'Wypełnianie szablonu...',
        description: `AI analizuje i dopasowuje pola do "${template.name}"`,
      });

      const { data, error } = await supabase.functions.invoke('ocr-fill-template', {
        body: {
          templateId: template.id,
          ocrFields: result.extractedFields,
        }
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Nie udało się wypełnić szablonu');
      }

      const aiInfo = data.stats.aiMatchingUsed 
        ? ' (dopasowanie AI)' 
        : ' (dopasowanie podstawowe)';

      toast({
        title: 'Szablon wypełniony!' + aiInfo,
        description: `Dopasowano ${data.stats.matchedFields} z ${data.stats.totalTemplateTags} pól.`,
      });

      // Show preview instead of auto-download
      onShowPreview?.({
        storagePath: data.storagePath || '',
        filename: data.filename,
        base64: data.base64,
        stats: data.stats,
        matchedFields: data.matchedFields,
      });

      onSelectTemplate?.(template);
      onFillComplete?.(data);
    } catch (err: any) {
      console.error('Fill template error:', err);
      toast({
        variant: 'destructive',
        title: 'Błąd wypełniania szablonu',
        description: err.message || 'Nie udało się wypełnić szablonu',
      });
    } finally {
      setFillingTemplate(null);
    }
  }, [result.extractedFields, toast, onSelectTemplate, onFillComplete]);

  const searchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      // Build preliminary data from OCR result
      const preliminaryData = {
        documentType: result.documentType || '',
        companyName: result.extractedFields.find(f => 
          f.tag.toLowerCase().includes('importer') || 
          f.tag.toLowerCase().includes('company') ||
          f.tag.toLowerCase().includes('nadawca') ||
          f.tag.toLowerCase().includes('odbiorca')
        )?.value || '',
        officeName: result.extractedFields.find(f => 
          f.tag.toLowerCase().includes('urzad') || 
          f.tag.toLowerCase().includes('office') ||
          f.tag.toLowerCase().includes('celny')
        )?.value || '',
        characteristicNumbers: {
          vin: result.extractedFields.find(f => f.tag.toLowerCase().includes('vin'))?.value,
          mrn: result.extractedFields.find(f => f.tag.toLowerCase().includes('mrn'))?.value,
          eori: result.extractedFields.find(f => f.tag.toLowerCase().includes('eori'))?.value,
        },
        detectedLanguage: result.documentLanguage || 'pl',
      };

      const { data, error } = await supabase.functions.invoke('ocr-find-template', {
        body: { 
          preliminaryData,
          verifyWithLlm: false // Skip LLM for speed
        }
      });

      if (error) throw error;

      if (data.success && data.data?.candidates) {
        const mapped: TemplateSuggestion[] = data.data.candidates.map((c: any) => ({
          id: c.id,
          name: c.name,
          storagePath: c.storage_path,
          score: c.score,
          matchReason: c.tags?.slice(0, 3).join(', ') || 'Dopasowanie typu dokumentu',
          tagCount: c.tags?.length || 0,
        }));
        setSuggestions(mapped);
      } else {
        setSuggestions([]);
      }
      setSearched(true);
    } catch (err: any) {
      console.error('Template search error:', err);
      toast({
        variant: 'destructive',
        title: 'Błąd wyszukiwania szablonów',
        description: err.message || 'Nie udało się wyszukać szablonów',
      });
    } finally {
      setIsLoading(false);
    }
  }, [result, toast]);

  const loadAllTemplates = useCallback(async () => {
    setLoadingAll(true);
    try {
      const { data: templates, error } = await supabase
        .from('templates')
        .select('id, name, storage_path, tag_metadata')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped: TemplateSuggestion[] = (templates || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        storagePath: t.storage_path,
        score: 0,
        matchReason: 'Ręczny wybór',
        tagCount: Object.keys(t.tag_metadata || {}).length,
      }));
      setAllTemplates(mapped);
      setShowAllTemplates(true);
    } catch (err: any) {
      console.error('Load templates error:', err);
      toast({
        variant: 'destructive',
        title: 'Błąd ładowania szablonów',
        description: err.message || 'Nie udało się załadować szablonów',
      });
    } finally {
      setLoadingAll(false);
    }
  }, [toast]);

  // Auto-search on mount
  useEffect(() => {
    if (!searched && result.extractedFields.length > 0) {
      searchTemplates();
    }
  }, [searched, result.extractedFields.length, searchTemplates]);

  if (isLoading) {
    return (
      <div className="px-6 py-4 bg-blue-500/5 border-t border-blue-500/10">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          <span className="text-sm text-blue-600">Wyszukuję pasujące szablony...</span>
        </div>
      </div>
    );
  }

  if (searched && suggestions.length === 0 && !showAllTemplates) {
    return (
      <div className="px-6 py-4 bg-muted/30 border-t">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-muted-foreground">
            <FileSearch className="h-4 w-4" />
            <span className="text-sm">Nie znaleziono pasujących szablonów automatycznie</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={searchTemplates}>
              <Loader2 className={cn("h-3 w-3 mr-1", isLoading && "animate-spin")} />
              Szukaj ponownie
            </Button>
            <Button variant="default" size="sm" onClick={loadAllTemplates} disabled={loadingAll}>
              {loadingAll ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <FileText className="h-3 w-3 mr-1" />
              )}
              Wybierz ręcznie z bazy
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show all templates for manual selection
  if (showAllTemplates && allTemplates.length > 0) {
    return (
      <div className="border-t">
        <div className="px-6 py-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-500" />
              <span className="font-medium text-sm">Wszystkie szablony</span>
              <Badge variant="secondary" className="text-xs">
                {allTemplates.length}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowAllTemplates(false)}>
              Wróć do sugestii
            </Button>
          </div>
        </div>
        <div className="p-4 space-y-2 max-h-[300px] overflow-y-auto">
          {allTemplates.map((template) => (
            <div
              key={template.id}
              className="flex items-center justify-between p-3 rounded-lg bg-background/50 hover:bg-background/80 border border-border/50 transition-colors group cursor-pointer"
              onClick={() => fillTemplate(template)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="font-medium text-sm truncate">{template.name}</span>
                </div>
                {template.tagCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {template.tagCount} zmiennych w szablonie
                  </p>
                )}
              </div>
              <Button
                variant="default"
                size="sm"
                className="ml-2"
                disabled={fillingTemplate === template.id}
              >
                {fillingTemplate === template.id ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Download className="h-3 w-3 mr-1" />
                )}
                Wypełnij
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (suggestions.length === 0 && !showAllTemplates) {
    return null;
  }

  return (
    <div className="border-t">
      <div className="px-6 py-3 bg-gradient-to-r from-blue-500/10 to-violet-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-blue-500" />
            <span className="font-medium text-sm">Sugerowane szablony</span>
            <Badge variant="secondary" className="text-xs">
              {suggestions.length}
            </Badge>
            <div className="group relative">
              <div className="flex items-center gap-1 text-xs text-muted-foreground cursor-help border-b border-dashed border-muted-foreground/50">
                <span>?</span>
              </div>
              <div className="absolute left-0 top-full mt-2 z-50 w-64 p-3 bg-popover text-popover-foreground rounded-lg shadow-lg border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                <p className="font-medium text-xs mb-2">Punktacja dopasowania:</p>
                <ul className="text-xs space-y-1 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>30+ pkt = bardzo dobre dopasowanie</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    <span>15-29 pkt = częściowe dopasowanie</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground"></span>
                    <span>&lt;15 pkt = słabe dopasowanie</span>
                  </li>
                </ul>
                <p className="text-[10px] mt-2 text-muted-foreground/70">
                  Punkty przyznawane za: VIN (+25), typ dokumentu (+25), tagi (+15), przykłady historyczne (+25)
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={loadAllTemplates} disabled={loadingAll}>
              {loadingAll ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <FileText className="h-3 w-3 mr-1" />
              )}
              Wszystkie
            </Button>
            <Button variant="ghost" size="sm" onClick={searchTemplates} disabled={isLoading}>
              <Loader2 className={cn("h-3 w-3 mr-1", isLoading && "animate-spin")} />
              Odśwież
            </Button>
          </div>
        </div>
      </div>
      <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto">
        {suggestions.map((template) => (
          <div
            key={template.id}
            className="flex items-center justify-between p-3 rounded-lg bg-background/50 hover:bg-background/80 border border-border/50 transition-colors group cursor-pointer"
            onClick={() => fillTemplate(template)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-violet-500 shrink-0" />
                <span className="font-medium text-sm truncate">{template.name}</span>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-[10px] px-1.5",
                    template.score >= 30 ? "border-emerald-500/30 text-emerald-600" :
                    template.score >= 15 ? "border-amber-500/30 text-amber-600" :
                    "border-muted-foreground/30"
                  )}
                >
                  {template.score} pkt
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {template.matchReason}
              </p>
              {template.tagCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {template.tagCount} zmiennych w szablonie
                </p>
              )}
            </div>
            <Button
              variant="default"
              size="sm"
              className="ml-2"
              disabled={fillingTemplate === template.id}
            >
              {fillingTemplate === template.id ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              Wypełnij
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Modal podglądu wypełnionego szablonu
interface FilledDocumentPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  previewData: {
    storagePath: string;
    filename: string;
    base64: string;
    stats: FillTemplateResult['stats'];
    matchedFields: FillTemplateResult['matchedFields'];
  } | null;
}

function FilledDocumentPreview({ isOpen, onClose, previewData }: FilledDocumentPreviewProps) {
  const { toast } = useToast();
  const [html, setHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showMatchDetails, setShowMatchDetails] = useState(false);

  useEffect(() => {
    if (isOpen && previewData?.base64) {
      renderDocxToHtml(previewData.base64);
    } else {
      setHtml(null);
    }
  }, [isOpen, previewData?.base64]);

  const renderDocxToHtml = async (base64: string) => {
    setIsLoading(true);
    try {
      // Use render-template function with the base64 content
      const { data, error } = await supabase.functions.invoke('render-template', {
        body: { 
          templateId: previewData?.storagePath,
          type: 'filled',
          base64Content: base64 
        }
      });

      if (error) throw error;
      if (data.html) {
        setHtml(data.html);
      } else {
        // Fallback: convert base64 to blob URL for iframe
        setHtml(null);
      }
    } catch (err) {
      console.error('Error rendering preview:', err);
      // If render fails, we'll show download option
      setHtml(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (!previewData) return;
    
    const binaryString = atob(previewData.base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { 
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = previewData.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Pobrano',
      description: 'Wypełniony dokument został pobrany',
    });
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 200));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 50));

  const documentStyles = `
    .filled-document-page {
      background: white;
      width: 210mm;
      min-height: 297mm;
      padding: 15mm 20mm;
      margin: 20px auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
      font-family: 'Calibri', 'Arial', sans-serif;
      font-size: 10pt;
      line-height: 1.3;
      color: #000;
    }
    .filled-document-page p { margin: 0 0 6pt 0; text-align: left; }
    .filled-document-page table { width: 100%; border-collapse: collapse; margin: 6pt 0; font-size: 9pt; }
    .filled-document-page td, .filled-document-page th { border: 1px solid #000; padding: 3pt 5pt; text-align: left; vertical-align: top; }
    .filled-document-page th { background: #f0f0f0; font-weight: bold; }
    .filled-document-page .highlight { background-color: #FEF9C3; }
  `;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] w-full md:max-w-5xl h-[90vh] flex flex-col p-0 gap-0 [&>button]:hidden">
        <DialogHeader className="px-4 md:px-6 py-3 md:py-4 border-b shrink-0 bg-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
              <div className="h-8 w-8 md:h-10 md:w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5 text-emerald-500" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-sm md:text-lg font-semibold truncate">
                  {previewData?.filename || "Wypełniony dokument"}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-0.5 md:mt-1 flex-wrap">
                  {previewData?.stats && (
                    <>
                      <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600">
                        {previewData.stats.matchedFields}/{previewData.stats.totalTemplateTags} dopasowanych
                      </Badge>
                      {previewData.stats.aiMatchingUsed && (
                        <Badge variant="outline" className="text-xs border-violet-500/30 text-violet-600">
                          <Sparkles className="h-3 w-3 mr-1" />
                          AI
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            
            <div className="hidden md:flex items-center gap-1 border rounded-lg px-2 py-1 bg-muted/50">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} disabled={zoom <= 50}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs font-medium w-10 text-center">{zoom}%</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} disabled={zoom >= 200}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Button variant="default" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Pobierz
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Document preview */}
          <div className="flex-1 overflow-hidden bg-muted/30">
            {isLoading ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Generowanie podglądu...</p>
              </div>
            ) : html ? (
              <ScrollArea className="h-full">
                <style dangerouslySetInnerHTML={{ __html: documentStyles }} />
                <div 
                  className="py-6 px-4"
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
                >
                  <div 
                    className="filled-document-page"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </div>
              </ScrollArea>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
                <div className="p-6 rounded-full bg-emerald-500/10">
                  <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                </div>
                <div className="text-center">
                  <h3 className="font-semibold text-lg">Dokument gotowy do pobrania</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Wypełniono {previewData?.stats.matchedFields || 0} z {previewData?.stats.totalTemplateTags || 0} pól
                  </p>
                  {previewData?.stats.unmatchedTags > 0 && (
                    <p className="text-xs text-amber-600 mt-2">
                      {previewData.stats.unmatchedTags} pól pozostało niewypełnionych
                    </p>
                  )}
                </div>
                <Button size="lg" onClick={handleDownload}>
                  <Download className="h-5 w-5 mr-2" />
                  Pobierz dokument
                </Button>
              </div>
            )}
          </div>

          {/* Match details sidebar */}
          {previewData?.matchedFields && previewData.matchedFields.length > 0 && (
            <div className="w-full md:w-80 border-t md:border-t-0 md:border-l shrink-0 bg-card">
              <Collapsible open={showMatchDetails} onOpenChange={setShowMatchDetails}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between px-4 py-3 rounded-none border-b">
                    <span className="font-medium text-sm">Dopasowane pola ({previewData.matchedFields.length})</span>
                    {showMatchDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="h-[300px] md:h-[calc(100vh-250px)]">
                    <div className="p-3 space-y-2">
                      {previewData.matchedFields.map((field, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-muted/50 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <code className="text-violet-600 font-medium">{`{{${field.templateTag}}}`}</code>
                            <Badge variant="outline" className="text-[10px]">
                              {field.matchType === 'ai_matched' ? 'AI' : field.matchType}
                            </Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground truncate" title={field.ocrValue}>
                            → {field.ocrValue}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>

        {/* Footer - mobile */}
        <div className="px-4 py-3 border-t shrink-0 bg-card flex justify-between items-center gap-2 md:hidden">
          <div className="flex items-center gap-1 border rounded-lg px-2 py-1 bg-muted/50">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} disabled={zoom <= 50}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs font-medium w-8 text-center">{zoom}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} disabled={zoom >= 200}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Zamknij
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  vehicle: Car,
  person: User,
  address: MapPin,
  documents: FileText,
  dates: Calendar,
  financial: DollarSign,
  transport: Ship,
  exporter: Globe,
  customs: Shield,
  other: MoreHorizontal,
};

const CONFIDENCE_COLORS = {
  high: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  low: 'bg-red-500/10 text-red-600 border-red-500/20',
};

function getFileIcon(fileType: string) {
  if (fileType.startsWith('image/')) {
    return <FileImage className="h-8 w-8 text-blue-500" />;
  }
  if (fileType === 'application/pdf') {
    return <FileText className="h-8 w-8 text-red-500" />;
  }
  return <File className="h-8 w-8 text-violet-500" />;
}

function ProviderIcon({ provider }: { provider: OcrProvider }) {
  if (provider === 'gemini') {
    return <Sparkles className="h-5 w-5 text-violet-500" />;
  }
  return <LayoutGrid className="h-5 w-5 text-blue-500" />;
}

function FieldCard({ field }: { field: OcrField }) {
  const { toast } = useToast();
  
  const copyValue = () => {
    navigator.clipboard.writeText(field.value);
    toast({
      title: 'Skopiowano',
      description: `Wartość "${field.value}" skopiowana do schowka`,
    });
  };
  
  return (
    <div className="group flex items-center justify-between p-3 rounded-lg bg-background/50 hover:bg-background/80 border border-border/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-muted-foreground">{`{{${field.tag}}}`}</span>
          <Badge 
            variant="outline" 
            className={cn('text-[10px] px-1.5 py-0', CONFIDENCE_COLORS[field.confidence])}
          >
            {field.confidence === 'high' ? '✓' : field.confidence === 'medium' ? '~' : '?'}
          </Badge>
        </div>
        <p className="text-sm font-medium truncate">{field.label}</p>
        <p className="text-sm text-foreground/80 truncate font-mono">{field.value}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={copyValue}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CategorySection({ category, fields }: { category: string; fields: OcrField[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const Icon = CATEGORY_ICONS[category] || MoreHorizontal;
  const categoryLabel = FIELD_CATEGORIES[category as keyof typeof FIELD_CATEGORIES] || category;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button 
          variant="ghost" 
          className="w-full justify-between px-4 py-2 h-auto hover:bg-accent/50"
        >
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{categoryLabel}</span>
            <Badge variant="secondary" className="text-xs">
              {fields.length}
            </Badge>
          </div>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-2 px-4 pb-4">
          {fields.map((field, idx) => (
            <FieldCard key={`${field.tag}-${idx}`} field={field} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProviderSelector({ 
  value, 
  onChange,
  disabled 
}: { 
  value: OcrProvider; 
  onChange: (provider: OcrProvider) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Wybierz silnik OCR</Label>
      <RadioGroup 
        value={value} 
        onValueChange={(v) => onChange(v as OcrProvider)}
        className="grid grid-cols-1 md:grid-cols-2 gap-3"
        disabled={disabled}
      >
        {OCR_PROVIDERS.map((provider) => (
          <Label
            key={provider.id}
            htmlFor={provider.id}
            className={cn(
              'flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all',
              value === provider.id 
                ? 'border-primary bg-primary/5' 
                : 'border-border hover:border-primary/50 hover:bg-accent/30',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <RadioGroupItem value={provider.id} id={provider.id} className="mt-1" />
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">{provider.icon}</span>
                <span className="font-semibold">{provider.name}</span>
                {value === provider.id && (
                  <Check className="h-4 w-4 text-primary ml-auto" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {provider.description}
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                {provider.supportedTypes.map((type, idx) => (
                  <Badge 
                    key={idx} 
                    variant="outline" 
                    className="text-[10px] px-1.5 py-0"
                  >
                    {type.replace('application/', '').replace('image/', 'IMG ')}
                  </Badge>
                ))}
              </div>
            </div>
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
}

export function OcrUpload({ 
  onAnalysisComplete, 
  onProviderChange,
  saveToDatabase = true,
  defaultProvider = 'gemini',
  className 
}: OcrUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  
  const {
    isAnalyzing,
    progress,
    progressMessage,
    realtimeProgress,
    multiFileProgress,
    result,
    error,
    currentProvider,
    analyzeFile,
    analyzeMultipleFiles,
    getFieldsByCategory,
    changeProvider,
    reset,
  } = useOcrAnalysis({
    provider: defaultProvider,
    saveToDatabase,
    onSuccess: (result) => {
      const providerInfo = OCR_PROVIDERS.find(p => p.id === result.provider);
      const filesInfo = result.filesAnalyzed && result.filesAnalyzed > 1 
        ? ` (${result.filesAnalyzed} plików)` 
        : '';
      toast({
        title: 'Analiza zakończona!',
        description: `${providerInfo?.name || result.provider} wykrył ${result.fieldsCount} pól${filesInfo}`,
      });
      onAnalysisComplete?.(result);
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Błąd analizy',
        description: error.message,
      });
    },
  });

  // Notify parent when provider changes
  const handleProviderChange = useCallback((provider: OcrProvider) => {
    changeProvider(provider);
    onProviderChange?.(provider);
  }, [changeProvider, onProviderChange]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setSelectedFiles(prev => [...prev, ...files]);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(prev => [...prev, ...files]);
    }
    // Reset input to allow selecting the same file again
    if (e.target) {
      e.target.value = '';
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    
    try {
      if (selectedFiles.length === 1) {
        await analyzeFile(selectedFiles[0], currentProvider);
      } else {
        await analyzeMultipleFiles(selectedFiles, currentProvider);
      }
    } catch {
      // Błąd jest już obsłużony w hooku
    }
  }, [selectedFiles, analyzeFile, analyzeMultipleFiles, currentProvider]);

  const handleReset = useCallback(() => {
    setSelectedFiles([]);
    reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [reset]);

  const exportResults = useCallback(() => {
    if (!result) return;
    
    const exportData = {
      provider: result.provider,
      fileName: result.fileName,
      documentType: result.documentType,
      documentLanguage: result.documentLanguage,
      summary: result.summary,
      extractedFields: result.extractedFields,
      markdown: result.markdown,
      analyzedAt: new Date().toISOString(),
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr-${result.provider}-${result.fileName.replace(/\.[^/.]+$/, '')}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({
      title: 'Wyeksportowano',
      description: 'Wyniki OCR zostały zapisane jako JSON',
    });
  }, [result, toast]);

  const groupedFields = result ? getFieldsByCategory(result.extractedFields) : {};
  const [filledDocPreview, setFilledDocPreview] = useState<{
    storagePath: string;
    filename: string;
    base64: string;
    stats: FillTemplateResult['stats'];
    matchedFields: FillTemplateResult['matchedFields'];
  } | null>(null);
  const providerInfo = OCR_PROVIDERS.find(p => p.id === currentProvider);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Strefa uploadu */}
      {!result && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-gradient-to-br from-violet-500/10 via-transparent to-blue-500/10">
            <CardTitle className="flex items-center gap-2">
              <ProviderIcon provider={currentProvider} />
              OCR - Analiza dokumentów
            </CardTitle>
            <CardDescription>
              Wgraj dokument (obraz, PDF lub DOC) aby wyekstrahować dane
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {/* Wybór providera */}
            <ProviderSelector 
              value={currentProvider}
              onChange={handleProviderChange}
              disabled={isAnalyzing}
            />

            <Separator />

            {/* Upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              onChange={handleFileSelect}
              className="hidden"
              id="ocr-file-input"
              multiple
            />
            
            <div
              className={cn(
                'relative border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer',
                'hover:border-primary/50 hover:bg-accent/30',
                dragActive && 'border-primary bg-primary/5 scale-[1.02]',
                selectedFiles.length > 0 && 'border-primary/30 bg-primary/5'
              )}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="p-4 rounded-full bg-primary/10">
                  <Upload className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="font-medium">
                    {selectedFiles.length > 0 
                      ? 'Kliknij aby dodać więcej plików' 
                      : 'Przeciągnij pliki tutaj lub kliknij aby wybrać'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Obsługiwane: JPG, PNG, PDF, DOC, DOCX (max 20 MB na plik)
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Możesz wybrać wiele plików - zostaną połączone w jeden wynik
                  </p>
                </div>
              </div>
            </div>

            {/* Lista wybranych plików */}
            {selectedFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Wybrane pliki ({selectedFiles.length})
                  </span>
                  <Button variant="ghost" size="sm" onClick={handleReset}>
                    Usuń wszystkie
                  </Button>
                </div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {selectedFiles.map((file, index) => (
                    <div 
                      key={`${file.name}-${index}`}
                      className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 group"
                    >
                      {getFileIcon(file.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Przycisk analizy */}
            {selectedFiles.length > 0 && !isAnalyzing && (
              <Button 
                className="w-full" 
                size="lg"
                onClick={handleAnalyze}
              >
                <ProviderIcon provider={currentProvider} />
                <span className="ml-2">
                  Analizuj {selectedFiles.length > 1 ? `${selectedFiles.length} pliki` : '1 plik'} z {providerInfo?.name || currentProvider}
                </span>
              </Button>
            )}

            {/* Progress bar */}
            {isAnalyzing && (
              <div className="space-y-3">
                {multiFileProgress && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Plik {multiFileProgress.currentFile} z {multiFileProgress.totalFiles}</span>
                    <span className="truncate max-w-[200px]">{multiFileProgress.currentFileName}</span>
                  </div>
                )}
                
                {/* Realtime PDF progress */}
                {realtimeProgress && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-primary">
                        {realtimeProgress.step === 'parsing' && '📄 Parsowanie PDF'}
                        {realtimeProgress.step === 'extracting' && `📑 Ekstrakcja stron (${realtimeProgress.current}/${realtimeProgress.total})`}
                        {realtimeProgress.step === 'analyzing' && '🧠 Analiza AI'}
                        {realtimeProgress.step === 'complete' && '✅ Zakończono'}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {realtimeProgress.percentage}%
                      </Badge>
                    </div>
                    {realtimeProgress.details && (
                      <p className="text-xs text-muted-foreground">{realtimeProgress.details}</p>
                    )}
                    <Progress value={realtimeProgress.percentage} className="h-1.5" />
                  </div>
                )}
                
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">{progressMessage}</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            {/* Błąd */}
            {error && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Wystąpił błąd</p>
                  <p className="text-sm text-destructive/80">{error.message}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Wyniki analizy */}
      {result && (
        <Card>
          <CardHeader className="bg-gradient-to-br from-emerald-500/10 via-transparent to-blue-500/10">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Analiza zakończona
                  {result.filesAnalyzed && result.filesAnalyzed > 1 && (
                    <Badge variant="secondary" className="text-xs">
                      {result.filesAnalyzed} pliki połączone
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {OCR_PROVIDERS.find(p => p.id === result.provider)?.icon || '✨'} {OCR_PROVIDERS.find(p => p.id === result.provider)?.name || result.provider}
                  </Badge>
                  <span>•</span>
                  <span>{result.documentType}</span>
                  <span>•</span>
                  <span>{result.fieldsCount} pól</span>
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportResults}>
                  <Download className="h-4 w-4 mr-1" />
                  Eksportuj
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset}>
                  <Upload className="h-4 w-4 mr-1" />
                  Nowe pliki
                </Button>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="p-0">
            {/* Podsumowanie */}
            {result.summary && (
              <div className="px-6 py-4 bg-accent/30">
                <p className="text-sm">
                  <span className="font-medium">Podsumowanie: </span>
                  {result.summary}
                </p>
              </div>
            )}
            
            <Separator />
            
            {/* Pogrupowane pola */}
            <ScrollArea className="h-[500px]">
              <div className="py-2">
                {Object.entries(groupedFields).map(([category, fields]) => (
                  <CategorySection 
                    key={category} 
                    category={category} 
                    fields={fields} 
                  />
                ))}
                
                {result.fieldsCount === 0 && (
                  <div className="p-8 text-center text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-3 opacity-50" />
                    <p>Nie wykryto żadnych pól w dokumencie</p>
                    <p className="text-sm mt-1">Spróbuj użyć innego silnika OCR</p>
                  </div>
                )}
              </div>
            </ScrollArea>
            
            {/* Template suggestions */}
            <TemplateSuggestions 
              result={result} 
              onSelectTemplate={(template) => {
                toast({
                  title: 'Szablon wybrany',
                  description: `Wypełniono: ${template.name}`,
                });
              }}
              onFillComplete={(fillResult) => {
                console.log('Template fill complete:', fillResult.stats);
              }}
              onShowPreview={(previewData) => {
                setFilledDocPreview(previewData);
              }}
            />
            
            {/* Markdown output dla Layout Parsing */}
            {result.markdown && result.provider === 'layout-parsing' && (
              <>
                <Separator />
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between px-6 py-4">
                      <span className="font-medium">Rozpoznany tekst (Markdown)</span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-6 pb-4">
                      <ScrollArea className="h-[300px] rounded-lg border bg-muted/30 p-4">
                        <pre className="text-xs whitespace-pre-wrap font-mono">
                          {result.markdown}
                        </pre>
                      </ScrollArea>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal podglądu wypełnionego dokumentu */}
      <FilledDocumentPreview
        isOpen={!!filledDocPreview}
        onClose={() => setFilledDocPreview(null)}
        previewData={filledDocPreview}
      />
    </div>
  );
}

export default OcrUpload;
