import { useCallback, useState, useRef } from 'react';
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
  Check
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
import { useToast } from '@/hooks/use-toast';
import { 
  useOcrAnalysis, 
  OcrField, 
  OcrAnalysisResult,
  OcrProvider,
  OCR_PROVIDERS,
  FIELD_CATEGORIES 
} from '@/hooks/use-ocr-analysis';
import { cn } from '@/lib/utils';

interface OcrUploadProps {
  onAnalysisComplete?: (result: OcrAnalysisResult) => void;
  saveToDatabase?: boolean;
  defaultProvider?: OcrProvider;
  className?: string;
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
  saveToDatabase = true,
  defaultProvider = 'gemini',
  className 
}: OcrUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const {
    isAnalyzing,
    progress,
    progressMessage,
    result,
    error,
    currentProvider,
    analyzeFile,
    getFieldsByCategory,
    changeProvider,
    reset,
  } = useOcrAnalysis({
    provider: defaultProvider,
    saveToDatabase,
    onSuccess: (result) => {
      toast({
        title: 'Analiza zakończona!',
        description: `${result.provider === 'gemini' ? 'Gemini 2.5 Pro' : 'Layout Parsing'} wykrył ${result.fieldsCount} pól`,
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
    
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return;
    
    try {
      await analyzeFile(selectedFile, currentProvider);
    } catch {
      // Błąd jest już obsłużony w hooku
    }
  }, [selectedFile, analyzeFile, currentProvider]);

  const handleReset = useCallback(() => {
    setSelectedFile(null);
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
              onChange={changeProvider}
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
            />
            
            <div
              className={cn(
                'relative border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer',
                'hover:border-primary/50 hover:bg-accent/30',
                dragActive && 'border-primary bg-primary/5 scale-[1.02]',
                selectedFile && 'border-primary/30 bg-primary/5'
              )}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => !selectedFile && fileInputRef.current?.click()}
            >
              {!selectedFile ? (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="p-4 rounded-full bg-primary/10">
                    <Upload className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Przeciągnij plik tutaj lub kliknij aby wybrać</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Obsługiwane: JPG, PNG, PDF, DOC, DOCX (max 20 MB)
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  {getFileIcon(selectedFile.type)}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Przycisk analizy */}
            {selectedFile && !isAnalyzing && (
              <Button 
                className="w-full" 
                size="lg"
                onClick={handleAnalyze}
              >
                <ProviderIcon provider={currentProvider} />
                <span className="ml-2">
                  Analizuj z {providerInfo?.name || currentProvider}
                </span>
              </Button>
            )}

            {/* Progress bar */}
            {isAnalyzing && (
              <div className="space-y-3">
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
                </CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {result.provider === 'gemini' ? '✨ Gemini 2.5 Pro' : '📐 Layout Parsing'}
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
                  Nowy plik
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
    </div>
  );
}

export default OcrUpload;
