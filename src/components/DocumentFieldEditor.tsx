import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Check, AlertCircle } from "lucide-react";

interface DocumentField {
  id: string;
  label: string;
  value: string;
  tag: string;
}

interface DocumentFieldEditorProps {
  field: DocumentField;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  autoFocus?: boolean;
  isHighlighted?: boolean;
}

const DocumentFieldEditor = ({
  field,
  value,
  onChange,
  onFocus,
  onBlur,
  autoFocus = false,
  isHighlighted = false,
}: DocumentFieldEditorProps) => {
  const [isTouched, setIsTouched] = useState(false);
  const isModified = value !== field.value;
  const isFilled = value.trim().length > 0;

  const handleBlur = () => {
    setIsTouched(true);
    onBlur();
  };

  return (
    <div
      className={`space-y-2 sm:space-y-3 p-3 sm:p-4 rounded-lg border-2 transition-all duration-200 ${
        isHighlighted
          ? "border-primary bg-primary/5 shadow-md"
          : "border-border bg-card hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
            <Label htmlFor={field.id} className="font-medium text-xs sm:text-sm truncate">
              {field.label}
            </Label>
            {isFilled && (
              <Check className="h-3 w-3 sm:h-4 sm:w-4 text-green-600 shrink-0" />
            )}
            {isTouched && !isFilled && (
              <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 text-orange-500 shrink-0" />
            )}
          </div>
          <Badge
            variant="outline"
            className="text-[9px] sm:text-[10px] font-mono bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
          >
            {field.tag}
          </Badge>
        </div>
        {isModified && (
          <Badge variant="secondary" className="text-[10px] sm:text-xs shrink-0">
            Zmieniono
          </Badge>
        )}
      </div>

      <Input
        id={field.id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={handleBlur}
        className="font-mono text-xs sm:text-sm"
        placeholder={`Wprowadź ${field.label.toLowerCase()}`}
        autoFocus={autoFocus}
      />

      {field.value && (
        <div className="text-[10px] sm:text-xs text-muted-foreground break-words">
          <span className="font-medium">Oryginał:</span> {field.value}
        </div>
      )}
    </div>
  );
};

export default DocumentFieldEditor;
