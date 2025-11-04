import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Plus, X } from "lucide-react";

interface TextSelectionPopupProps {
  position: { x: number; y: number };
  selectedText: string;
  onConfirm: (tagName: string) => void;
  onCancel: () => void;
}

const TextSelectionPopup = ({
  position,
  selectedText,
  onConfirm,
  onCancel,
}: TextSelectionPopupProps) => {
  const [tagName, setTagName] = useState("");

  const handleConfirm = () => {
    if (tagName.trim()) {
      onConfirm(tagName.trim());
    }
  };

  return (
    <Card
      className="fixed z-50 p-4 shadow-lg w-80 animate-in fade-in slide-in-from-bottom-2"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium">Dodaj nową zmienną</p>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              "{selectedText}"
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div>
          <Input
            placeholder="Nazwa zmiennej (np. NumerFaktury)"
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleConfirm();
              } else if (e.key === "Escape") {
                onCancel();
              }
            }}
            autoFocus
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="flex-1"
          >
            Anuluj
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!tagName.trim()}
            className="flex-1 gap-2"
          >
            <Plus className="h-4 w-4" />
            Dodaj
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default TextSelectionPopup;
