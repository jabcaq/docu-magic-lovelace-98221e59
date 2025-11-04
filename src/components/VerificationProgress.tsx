import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle } from "lucide-react";

interface VerificationProgressProps {
  totalFields: number;
  completedFields: number;
}

const VerificationProgress = ({
  totalFields,
  completedFields,
}: VerificationProgressProps) => {
  const percentage = totalFields > 0 ? (completedFields / totalFields) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {percentage === 100 ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">
            Postęp weryfikacji
          </span>
        </div>
        <span className="text-muted-foreground">
          {completedFields} / {totalFields}
        </span>
      </div>
      <Progress value={percentage} className="h-2" />
    </div>
  );
};

export default VerificationProgress;
