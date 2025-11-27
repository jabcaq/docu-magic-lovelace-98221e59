import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface OcrField {
  tag: string;
  label: string;
  value: string;
  category: 'vehicle' | 'person' | 'address' | 'documents' | 'dates' | 'financial' | 'transport' | 'exporter' | 'customs' | 'other';
  confidence: 'high' | 'medium' | 'low';
}

export interface OcrAnalysisResult {
  success: boolean;
  fileName: string;
  fileType: string;
  documentType: string;
  documentLanguage: string;
  summary: string;
  extractedFields: OcrField[];
  rawText: string;
  fieldsCount: number;
  documentId?: string;
  error?: string;
}

export interface UseOcrAnalysisOptions {
  saveToDatabase?: boolean;
  onProgress?: (progress: number, message: string) => void;
  onSuccess?: (result: OcrAnalysisResult) => void;
  onError?: (error: Error) => void;
}

export function useOcrAnalysis(options: UseOcrAnalysisOptions = {}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [result, setResult] = useState<OcrAnalysisResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const updateProgress = useCallback((value: number, message: string) => {
    setProgress(value);
    setProgressMessage(message);
    options.onProgress?.(value, message);
  }, [options]);

  /**
   * Analizuje plik za pomocą OCR (Gemini 2.5 Pro)
   * @param file - Plik do analizy (obraz, PDF lub DOC)
   */
  const analyzeFile = useCallback(async (file: File): Promise<OcrAnalysisResult> => {
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

      // Walidacja rozmiaru (max 20MB)
      const maxSize = 20 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error(`Plik jest za duży (${(file.size / 1024 / 1024).toFixed(2)} MB). Maksymalny rozmiar: 20 MB`);
      }

      updateProgress(20, 'Wysyłanie pliku do analizy...');

      // Pobierz sesję użytkownika
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Nie jesteś zalogowany');
      }

      updateProgress(30, 'Analizowanie dokumentu z Gemini 2.5 Pro...');

      // Przygotuj FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('saveToDatabase', String(options.saveToDatabase ?? true));

      // Wywołaj Edge Function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocr-analyze-document`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: formData,
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
  }, [options, updateProgress]);

  /**
   * Analizuje istniejący dokument z bazy danych
   * @param documentId - ID dokumentu w bazie
   */
  const analyzeDocument = useCallback(async (documentId: string): Promise<OcrAnalysisResult> => {
    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      updateProgress(20, 'Pobieranie dokumentu...');

      // Pobierz sesję użytkownika
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Nie jesteś zalogowany');
      }

      updateProgress(40, 'Analizowanie dokumentu z Gemini 2.5 Pro...');

      // Wywołaj Edge Function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocr-analyze-document`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            documentId,
            saveToDatabase: options.saveToDatabase ?? true,
          }),
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
  }, [options, updateProgress]);

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
   * Resetuje stan hooka
   */
  const reset = useCallback(() => {
    setIsAnalyzing(false);
    setProgress(0);
    setProgressMessage('');
    setResult(null);
    setError(null);
  }, []);

  return {
    // Stan
    isAnalyzing,
    progress,
    progressMessage,
    result,
    error,
    
    // Metody
    analyzeFile,
    analyzeDocument,
    getFieldsByCategory,
    getHighConfidenceFields,
    reset,
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

