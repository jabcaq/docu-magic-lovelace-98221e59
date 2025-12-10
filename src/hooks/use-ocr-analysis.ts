import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type OcrProvider = 'gemini' | 'gemini-3-pro' | 'layout-parsing';

export interface OcrProviderInfo {
  id: OcrProvider;
  name: string;
  description: string;
  model: string;
  supportedTypes: string[];
  icon: string;
}

export const OCR_PROVIDERS: OcrProviderInfo[] = [
  {
    id: 'gemini',
    name: 'Gemini 2.5 Pro',
    description: 'Google AI - zaawansowana analiza wizualna i rozumienie dokumentów',
    model: 'google/gemini-2.5-pro',
    supportedTypes: ['image/*', 'application/pdf', '.doc', '.docx'],
    icon: '✨'
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro Preview',
    description: 'Najnowszy model Google AI - ulepszona analiza i rozumienie dokumentów',
    model: 'google/gemini-3-pro-preview',
    supportedTypes: ['image/*', 'application/pdf', '.doc', '.docx'],
    icon: '🚀'
  },
  {
    id: 'layout-parsing',
    name: 'Paddle OCR - VL',
    description: 'Specjalizowany OCR z rozpoznawaniem układu dokumentu i tabel',
    model: 'PaddleX Layout Parser',
    supportedTypes: ['image/*', 'application/pdf'],
    icon: '📐'
  }
];

export interface OcrField {
  tag: string;
  label: string;
  value: string;
  category: 'vehicle' | 'person' | 'address' | 'documents' | 'dates' | 'financial' | 'transport' | 'exporter' | 'customs' | 'other';
  confidence: 'high' | 'medium' | 'low';
}

export interface OcrAnalysisResult {
  success: boolean;
  provider: OcrProvider;
  fileName: string;
  fileNames?: string[]; // For multi-file analysis
  fileType: string;
  documentType: string;
  documentLanguage: string;
  summary: string;
  extractedFields: OcrField[];
  rawText: string;
  markdown?: string;
  fieldsCount: number;
  documentId?: string;
  error?: string;
  layoutResults?: number;
  filesAnalyzed?: number; // Number of files in multi-file analysis
}

export interface MultiFileProgress {
  currentFile: number;
  totalFiles: number;
  currentFileName: string;
  overallProgress: number;
}

export interface OcrRealtimeProgress {
  step: 'parsing' | 'extracting' | 'analyzing' | 'complete';
  current: number;
  total: number;
  percentage: number;
  details?: string;
  timestamp: string;
}

export interface UseOcrAnalysisOptions {
  provider?: OcrProvider;
  saveToDatabase?: boolean;
  onProgress?: (progress: number, message: string) => void;
  onMultiFileProgress?: (progress: MultiFileProgress) => void;
  onRealtimeProgress?: (progress: OcrRealtimeProgress) => void;
  onSuccess?: (result: OcrAnalysisResult) => void;
  onError?: (error: Error) => void;
}

export function useOcrAnalysis(options: UseOcrAnalysisOptions = {}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [realtimeProgress, setRealtimeProgress] = useState<OcrRealtimeProgress | null>(null);
  const [multiFileProgress, setMultiFileProgress] = useState<MultiFileProgress | null>(null);
  const [result, setResult] = useState<OcrAnalysisResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentProvider, setCurrentProvider] = useState<OcrProvider>(options.provider || 'gemini');

  const updateProgress = useCallback((value: number, message: string) => {
    setProgress(value);
    setProgressMessage(message);
    options.onProgress?.(value, message);
  }, [options]);

  const getEndpoint = useCallback((provider: OcrProvider) => {
    switch (provider) {
      case 'gemini':
      case 'gemini-3-pro':
        return 'ocr-analyze-document';
      case 'layout-parsing':
        return 'ocr-layout-parsing';
      default:
        return 'ocr-analyze-document';
    }
  }, []);

  const getProviderName = useCallback((provider: OcrProvider) => {
    const providerInfo = OCR_PROVIDERS.find(p => p.id === provider);
    return providerInfo?.name || provider;
  }, []);

  /**
   * Analizuje plik za pomocą wybranego providera OCR
   * @param file - Plik do analizy (obraz, PDF lub DOC)
   * @param provider - Provider OCR (opcjonalny, domyślnie używa currentProvider)
   */
  const analyzeFile = useCallback(async (
    file: File, 
    provider?: OcrProvider
  ): Promise<OcrAnalysisResult> => {
    const selectedProvider = provider || currentProvider;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    
    try {
      updateProgress(10, 'Przygotowywanie pliku...');

      // Walidacja typu pliku
      const allowedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];

      if (!allowedTypes.includes(file.type)) {
        throw new Error(`Nieobsługiwany typ pliku: ${file.type}. Obsługiwane: obrazy (JPG, PNG, GIF, WebP), PDF, DOC, DOCX`);
      }

      // Walidacja dla Layout Parsing API - nie obsługuje DOCX
      if (selectedProvider === 'layout-parsing' && 
          (file.type === 'application/msword' || 
           file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
        console.warn('Layout Parsing API nie obsługuje bezpośrednio DOCX, użyje ekstrakcji tekstu');
      }

      // Walidacja rozmiaru (max 20MB)
      const maxSize = 20 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error(`Plik jest za duży (${(file.size / 1024 / 1024).toFixed(2)} MB). Maksymalny rozmiar: 20 MB`);
      }

      updateProgress(20, `Wysyłanie pliku do ${getProviderName(selectedProvider)}...`);

      // Pobierz sesję użytkownika
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Nie jesteś zalogowany');
      }

      // Subscribe to realtime progress updates
      const userId = session.user.id;
      const progressChannel = supabase.channel(`ocr-progress-${userId}`);
      
      progressChannel
        .on('broadcast', { event: 'ocr_progress' }, (payload) => {
          const progressData = payload.payload as OcrRealtimeProgress;
          console.log('Realtime OCR progress:', progressData);
          setRealtimeProgress(progressData);
          options.onRealtimeProgress?.(progressData);
          
          // Update main progress based on realtime data
          if (progressData.step === 'parsing') {
            updateProgress(30 + (progressData.percentage * 0.1), progressData.details || 'Parsowanie PDF...');
          } else if (progressData.step === 'extracting') {
            updateProgress(40 + (progressData.percentage * 0.3), progressData.details || `Ekstrakcja strony ${progressData.current}/${progressData.total}...`);
          } else if (progressData.step === 'analyzing') {
            updateProgress(70, progressData.details || 'Analiza AI...');
          }
        })
        .subscribe();

      updateProgress(30, `Analizowanie dokumentu przez ${getProviderName(selectedProvider)}...`);

      // Przygotuj FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('saveToDatabase', String(options.saveToDatabase ?? true));
      
      // Dodaj model jeśli to gemini provider
      const providerInfo = OCR_PROVIDERS.find(p => p.id === selectedProvider);
      if (providerInfo && (selectedProvider === 'gemini' || selectedProvider === 'gemini-3-pro')) {
        formData.append('model', providerInfo.model);
      }

      // Wywołaj odpowiedni endpoint
      const endpoint = getEndpoint(selectedProvider);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: formData,
        }
      );

      updateProgress(80, 'Przetwarzanie wyników...');

      // Cleanup realtime channel
      supabase.removeChannel(progressChannel);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Błąd serwera: ${response.status}`);
      }

      const data: OcrAnalysisResult = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Analiza OCR nie powiodła się');
      }

      updateProgress(100, 'Analiza zakończona!');
      setRealtimeProgress(null);
      setResult(data);
      options.onSuccess?.(data);

      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Nieznany błąd');
      setError(error);
      options.onError?.(error);
      throw error;
    } finally {
      setIsAnalyzing(false);
      setRealtimeProgress(null);
    }
  }, [currentProvider, options, updateProgress, getEndpoint, getProviderName]);

  /**
   * Scala pola z wielu analiz, usuwając duplikaty i zachowując najwyższą pewność
   */
  const mergeFields = useCallback((allFields: OcrField[][]): OcrField[] => {
    const fieldMap = new Map<string, OcrField>();
    const confidenceOrder = { high: 3, medium: 2, low: 1 };
    
    for (const fields of allFields) {
      for (const field of fields) {
        const key = `${field.tag}_${field.value}`.toLowerCase();
        const existing = fieldMap.get(key);
        
        if (!existing) {
          fieldMap.set(key, field);
        } else {
          // Zachowaj pole z wyższą pewnością
          if (confidenceOrder[field.confidence] > confidenceOrder[existing.confidence]) {
            fieldMap.set(key, field);
          }
        }
      }
    }
    
    return Array.from(fieldMap.values());
  }, []);

  /**
   * Analizuje wiele plików i scala wyniki
   * @param files - Tablica plików do analizy
   * @param provider - Provider OCR (opcjonalny)
   */
  const analyzeMultipleFiles = useCallback(async (
    files: File[],
    provider?: OcrProvider
  ): Promise<OcrAnalysisResult> => {
    const selectedProvider = provider || currentProvider;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    
    const results: OcrAnalysisResult[] = [];
    const allFields: OcrField[][] = [];
    const fileNames: string[] = [];
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileProgress: MultiFileProgress = {
          currentFile: i + 1,
          totalFiles: files.length,
          currentFileName: file.name,
          overallProgress: Math.round((i / files.length) * 100),
        };
        
        setMultiFileProgress(fileProgress);
        options.onMultiFileProgress?.(fileProgress);
        updateProgress(fileProgress.overallProgress, `Analizuję plik ${i + 1}/${files.length}: ${file.name}...`);
        
        // Analyze single file (without triggering onSuccess for each)
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error('Nie jesteś zalogowany');
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('saveToDatabase', String(options.saveToDatabase ?? true));
        
        const providerInfo = OCR_PROVIDERS.find(p => p.id === selectedProvider);
        if (providerInfo && (selectedProvider === 'gemini' || selectedProvider === 'gemini-3-pro')) {
          formData.append('model', providerInfo.model);
        }
        
        const endpoint = getEndpoint(selectedProvider);
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: formData,
          }
        );
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(`Error analyzing ${file.name}:`, errorData);
          // Continue with other files even if one fails
          continue;
        }
        
        const data: OcrAnalysisResult = await response.json();
        
        if (data.success) {
          results.push(data);
          allFields.push(data.extractedFields);
          fileNames.push(file.name);
        }
      }
      
      if (results.length === 0) {
        throw new Error('Żaden plik nie został pomyślnie przeanalizowany');
      }
      
      // Merge all results
      const mergedFields = mergeFields(allFields);
      
      // Combine document types
      const documentTypes = [...new Set(results.map(r => r.documentType).filter(Boolean))];
      const languages = [...new Set(results.map(r => r.documentLanguage).filter(Boolean))];
      
      const combinedResult: OcrAnalysisResult = {
        success: true,
        provider: selectedProvider,
        fileName: fileNames.join(', '),
        fileNames,
        fileType: 'multiple',
        documentType: documentTypes.join(' + '),
        documentLanguage: languages[0] || 'pl',
        summary: `Połączona analiza ${results.length} dokumentów. Typy: ${documentTypes.join(', ') || 'nieznane'}`,
        extractedFields: mergedFields,
        rawText: results.map(r => r.rawText).join('\n\n---\n\n'),
        markdown: results.map(r => r.markdown || '').join('\n\n---\n\n'),
        fieldsCount: mergedFields.length,
        filesAnalyzed: results.length,
      };
      
      setMultiFileProgress(null);
      updateProgress(100, `Analiza zakończona! ${results.length} plików, ${mergedFields.length} pól`);
      setResult(combinedResult);
      options.onSuccess?.(combinedResult);
      
      return combinedResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Nieznany błąd');
      setError(error);
      setMultiFileProgress(null);
      options.onError?.(error);
      throw error;
    } finally {
      setIsAnalyzing(false);
    }
  }, [currentProvider, options, updateProgress, getEndpoint, mergeFields]);

  /**
   * Analizuje istniejący dokument z bazy danych
   * @param documentId - ID dokumentu w bazie
   * @param provider - Provider OCR (opcjonalny)
   */
  const analyzeDocument = useCallback(async (
    documentId: string,
    provider?: OcrProvider
  ): Promise<OcrAnalysisResult> => {
    const selectedProvider = provider || currentProvider;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      updateProgress(20, 'Pobieranie dokumentu...');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Nie jesteś zalogowany');
      }

      updateProgress(40, `Analizowanie przez ${getProviderName(selectedProvider)}...`);

      const endpoint = getEndpoint(selectedProvider);
      const providerInfo = OCR_PROVIDERS.find(p => p.id === selectedProvider);
      const requestBody: any = {
        documentId,
        saveToDatabase: options.saveToDatabase ?? true,
      };
      
      // Dodaj model jeśli to gemini provider
      if (providerInfo && (selectedProvider === 'gemini' || selectedProvider === 'gemini-3-pro')) {
        requestBody.model = providerInfo.model;
      }
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      updateProgress(80, 'Przetwarzanie wyników...');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Błąd serwera: ${response.status}`);
      }

      const data: OcrAnalysisResult = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Analiza OCR nie powiodła się');
      }

      updateProgress(100, 'Analiza zakończona!');
      setResult(data);
      options.onSuccess?.(data);

      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Nieznany błąd');
      setError(error);
      options.onError?.(error);
      throw error;
    } finally {
      setIsAnalyzing(false);
    }
  }, [currentProvider, options, updateProgress, getEndpoint, getProviderName]);

  /**
   * Grupuje wyekstrahowane pola według kategorii
   */
  const getFieldsByCategory = useCallback((fields: OcrField[]) => {
    const grouped: Record<string, OcrField[]> = {};
    
    for (const field of fields) {
      if (!grouped[field.category]) {
        grouped[field.category] = [];
      }
      grouped[field.category].push(field);
    }
    
    return grouped;
  }, []);

  /**
   * Pobiera pola o wysokiej pewności
   */
  const getHighConfidenceFields = useCallback((fields: OcrField[]) => {
    return fields.filter(f => f.confidence === 'high');
  }, []);

  /**
   * Zmienia aktualnego providera OCR
   */
  const changeProvider = useCallback((provider: OcrProvider) => {
    setCurrentProvider(provider);
  }, []);

  /**
   * Resetuje stan hooka
   */
  const reset = useCallback(() => {
    setIsAnalyzing(false);
    setProgress(0);
    setProgressMessage('');
    setMultiFileProgress(null);
    setResult(null);
    setError(null);
  }, []);

  return {
    // Stan
    isAnalyzing,
    progress,
    progressMessage,
    realtimeProgress,
    multiFileProgress,
    result,
    error,
    currentProvider,
    
    // Metody
    analyzeFile,
    analyzeMultipleFiles,
    analyzeDocument,
    getFieldsByCategory,
    getHighConfidenceFields,
    changeProvider,
    reset,
    
    // Stałe
    providers: OCR_PROVIDERS,
  };
}

// Kategorie pól z polskimi nazwami
export const FIELD_CATEGORIES = {
  vehicle: 'Dane pojazdu',
  person: 'Dane osobowe',
  address: 'Adresy',
  documents: 'Dokumenty',
  dates: 'Daty',
  financial: 'Dane finansowe',
  transport: 'Transport',
  exporter: 'Eksporter',
  customs: 'Dane celne',
  other: 'Inne',
} as const;

// Ikony kategorii (dla Lucide React)
export const FIELD_CATEGORY_ICONS = {
  vehicle: 'Car',
  person: 'User',
  address: 'MapPin',
  documents: 'FileText',
  dates: 'Calendar',
  financial: 'DollarSign',
  transport: 'Ship',
  exporter: 'Globe',
  customs: 'Shield',
  other: 'MoreHorizontal',
} as const;
