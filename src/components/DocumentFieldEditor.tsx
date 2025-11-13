import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, AlertCircle, Trash2, Edit2, Save, X } from "lucide-react";

interface DocumentField {
  id: string;
  label: string;
  value: string;
  tag: string;
  isNew?: boolean;
}

interface DocumentFieldEditorProps {
  field: DocumentField;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onDelete?: (fieldId: string) => void;
  onEdit?: (fieldId: string, newLabel: string, newTag: string) => void;
  autoFocus?: boolean;
  isHighlighted?: boolean;
  isNew?: boolean;
}

const DocumentFieldEditor = ({
  field,
  value,
  onChange,
  onFocus,
  onBlur,
  onDelete,
  onEdit,
  autoFocus = false,
  isHighlighted = false,
  isNew = false,
}: DocumentFieldEditorProps) => {
  const [isTouched, setIsTouched] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedLabel, setEditedLabel] = useState(field.label);
  const [editedTag, setEditedTag] = useState(field.tag);
  
  const isModified = value !== field.value;
  const isFilled = value.trim().length > 0;

  const handleBlur = () => {
    setIsTouched(true);
    onBlur();
  };

  const handleSaveEdit = () => {
    if (onEdit && (editedLabel !== field.label || editedTag !== field.tag)) {
      onEdit(field.id, editedLabel, editedTag);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedLabel(field.label);
    setEditedTag(field.tag);
    setIsEditing(false);
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
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editedLabel}
                onChange={(e) => setEditedLabel(e.target.value)}
                className="text-xs sm:text-sm"
                placeholder="Nazwa pola"
              />
              <Input
                value={editedTag}
                onChange={(e) => setEditedTag(e.target.value)}
                className="text-xs sm:text-sm font-mono"
                placeholder="Tag (np. {{nazwa}})"
              />
            </div>
          ) : (
            <>
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
                className={`text-[9px] sm:text-[10px] font-mono ${
                  isNew 
                    ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800" 
                    : "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
                }`}
              >
                {field.tag}
              </Badge>
              {isNew && (
                <Badge variant="secondary" className="text-[9px] ml-1">
                  NOWE
                </Badge>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleSaveEdit}
              >
                <Save className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleCancelEdit}
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <>
              {isModified && (
                <Badge variant="secondary" className="text-[10px] sm:text-xs">
                  Zmieniono
                </Badge>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
              {onDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => onDelete(field.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
        </div>
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
