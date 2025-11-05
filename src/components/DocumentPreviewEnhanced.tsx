import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import TextSelectionPopup from "./TextSelectionPopup";

interface DocumentPreviewEnhancedProps {
  documentId: string;
  highlightedFieldId?: string;
  onTagHover?: (fieldId: string | null) => void;
  onAddNewField?: (selectedText: string, tagName: string) => void;
  refreshKey?: number;
  isCleanView?: boolean;
  fieldValues?: Record<string, string>;
}

const DocumentPreviewEnhanced = ({
  documentId,
  highlightedFieldId,
  onTagHover,
  onAddNewField,
  refreshKey = 0,
  isCleanView = false,
  fieldValues = {},
}: DocumentPreviewEnhancedProps) => {
  const [html, setHtml] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionPopup, setSelectionPopup] = useState<{
    visible: boolean;
    position: { x: number; y: number };
    selectedText: string;
  } | null>(null);

  // Function to generate clean HTML without XML tags and with filled values
  const generateCleanHtml = (htmlContent: string) => {
    let clean = htmlContent;
    
    // Remove all XML tags like <w:r>, <w:t>, etc.
    clean = clean.replace(/<\/?w:[^>]+>/g, '');
    
    // Replace {{variableName}} with actual values
    clean = clean.replace(/<span class="doc-variable"[^>]*data-field-id="([^"]+)"[^>]*data-tag="([^"]+)"[^>]*>([^<]+)<span class="doc-tag-badge">[^<]*<\/span><\/span>/g, 
      (match, fieldId, tag, content) => {
        const value = fieldValues[fieldId] || content.replace(/[{}]/g, '');
        return `<span class="doc-field-value">${value}</span>`;
      }
    );
    
    // Clean up any remaining variable spans
    clean = clean.replace(/<span class="doc-variable"[^>]*>([^<]+)<\/span>/g, '$1');
    
    return clean;
  };

  useEffect(() => {
    const fetchRenderedDocument = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase.functions.invoke("render-document", {
          body: { documentId },
        });

        if (error) throw error;

        setHtml(data.html);
      } catch (err) {
        console.error("Error fetching rendered document:", err);
        setError("Nie udało się wczytać podglądu dokumentu");
      } finally {
        setIsLoading(false);
      }
    };

    if (documentId) {
      fetchRenderedDocument();
    }
  }, [documentId, refreshKey]);

  // Add interaction handlers to tagged elements
  useEffect(() => {
    if (!html || !onTagHover) return;

    const handleTagMouseEnter = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("doc-variable")) {
        const fieldId = target.getAttribute("data-field-id");
        if (fieldId) {
          onTagHover(fieldId);
        }
      }
    };

    const handleTagMouseLeave = () => {
      onTagHover(null);
    };

    const container = document.querySelector(".document-preview-content");
    if (container) {
      const tags = container.querySelectorAll(".doc-variable");
      tags.forEach((tag) => {
        tag.addEventListener("mouseenter", handleTagMouseEnter as EventListener);
        tag.addEventListener("mouseleave", handleTagMouseLeave);
      });

      return () => {
        tags.forEach((tag) => {
          tag.removeEventListener("mouseenter", handleTagMouseEnter as EventListener);
          tag.removeEventListener("mouseleave", handleTagMouseLeave);
        });
      };
    }
  }, [html, onTagHover]);

  // Highlight effect for selected field
  useEffect(() => {
    if (!highlightedFieldId) return;

    const tags = document.querySelectorAll(`[data-field-id="${highlightedFieldId}"]`);
    tags.forEach((tag) => {
      tag.classList.add("tag-highlighted");
    });

    return () => {
      tags.forEach((tag) => {
        tag.classList.remove("tag-highlighted");
      });
    };
  }, [highlightedFieldId]);

  // Handle text selection
  useEffect(() => {
    if (!contentRef.current || !onAddNewField || isCleanView) return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (!selectedText || selectedText.length < 2) {
        setSelectionPopup(null);
        return;
      }

      // Check if selection is within a non-tagged text element
      const range = selection?.getRangeAt(0);
      const container = range?.commonAncestorContainer;
      
      // Find the closest paragraph or text node
      let element = container?.nodeType === 3 ? container.parentElement : container as HTMLElement;
      
      // Check if we're not inside a .doc-variable
      if (element?.closest('.doc-variable')) {
        setSelectionPopup(null);
        return;
      }

      // Get selection position
      const rect = range?.getBoundingClientRect();
      if (rect) {
        setSelectionPopup({
          visible: true,
          position: {
            x: rect.left + window.scrollX,
            y: rect.bottom + window.scrollY + 10,
          },
          selectedText,
        });
      }
    };

    const content = contentRef.current;
    content.addEventListener('mouseup', handleMouseUp);

    return () => {
      content.removeEventListener('mouseup', handleMouseUp);
    };
  }, [html, onAddNewField, isCleanView]);

  const handleConfirmSelection = (tagName: string) => {
    if (selectionPopup && onAddNewField) {
      onAddNewField(selectionPopup.selectedText, tagName);
    }
    setSelectionPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleCancelSelection = () => {
    setSelectionPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[700px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[700px] text-destructive">
        {error}
      </div>
    );
  }

  return (
    <>
      {selectionPopup && (
        <TextSelectionPopup
          position={selectionPopup.position}
          selectedText={selectionPopup.selectedText}
          onConfirm={handleConfirmSelection}
          onCancel={handleCancelSelection}
        />
      )}
      
      <style>{`
        .document-preview-content {
          background: white;
          padding: 40px 60px;
          min-height: 100%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .tag-highlighted {
          animation: pulse-highlight 1s ease-in-out;
          background-color: #60a5fa !important;
          border-color: #3b82f6 !important;
        }
        
        @keyframes pulse-highlight {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.02);
          }
        }
        
        .doc-variable {
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .doc-variable:hover {
          background-color: #fde047 !important;
          transform: scale(1.01);
        }
        
        .doc-field-value {
          color: inherit;
          font-weight: normal;
        }
      `}</style>
      <ScrollArea className="h-[500px] sm:h-[600px] lg:h-[calc(100vh-320px)] w-full border rounded-lg bg-gray-100 dark:bg-gray-800">
        {html ? (
          <div className="p-4 sm:p-8">
            <div
              ref={contentRef}
              dangerouslySetInnerHTML={{ __html: isCleanView ? generateCleanHtml(html) : html }}
              className="document-preview-content max-w-[210mm] mx-auto [&_.doc-variable]:inline [&_.doc-tag-badge]:inline-block"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Brak zawartości do wyświetlenia
          </div>
        )}
      </ScrollArea>
    </>
  );
};

export default DocumentPreviewEnhanced;
