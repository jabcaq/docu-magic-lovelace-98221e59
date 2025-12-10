import { useState, useCallback } from 'react';
import { OcrAnalysisResult, OcrProvider } from './use-ocr-analysis';

export interface OcrPersistentState {
  result: OcrAnalysisResult | null;
  selectedFiles: File[];
  currentProvider: OcrProvider;
  filledDocPreview: {
    storagePath: string;
    filename: string;
    base64: string;
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
  } | null;
}

export function useOcrState(defaultProvider: OcrProvider = 'gemini') {
  const [result, setResult] = useState<OcrAnalysisResult | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [currentProvider, setCurrentProvider] = useState<OcrProvider>(defaultProvider);
  const [filledDocPreview, setFilledDocPreview] = useState<OcrPersistentState['filledDocPreview']>(null);

  const resetState = useCallback(() => {
    setResult(null);
    setSelectedFiles([]);
    setFilledDocPreview(null);
  }, []);

  const updateResult = useCallback((newResult: OcrAnalysisResult | null) => {
    setResult(newResult);
  }, []);

  const updateSelectedFiles = useCallback((files: File[]) => {
    setSelectedFiles(files);
  }, []);

  const updateProvider = useCallback((provider: OcrProvider) => {
    setCurrentProvider(provider);
  }, []);

  const updateFilledDocPreview = useCallback((preview: OcrPersistentState['filledDocPreview']) => {
    setFilledDocPreview(preview);
  }, []);

  return {
    // State
    result,
    selectedFiles,
    currentProvider,
    filledDocPreview,
    // Actions
    setResult: updateResult,
    setSelectedFiles: updateSelectedFiles,
    setCurrentProvider: updateProvider,
    setFilledDocPreview: updateFilledDocPreview,
    resetState,
  };
}
