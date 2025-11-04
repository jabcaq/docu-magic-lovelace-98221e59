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
    <div className="space-y-2 sm:space-y-3">
      <div className="flex items-center justify-between text-xs sm:text-sm">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {percentage === 100 ? (
            <CheckCircle2 className="h-3 w-3 sm:h-4 sm:w-4 text-green-600" />
          ) : (
            <Circle className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
          )}
          <span className="font-medium">
            Postęp
          </span>
        </div>
        <span className="text-muted-foreground">
          {completedFields} / {totalFields}
        </span>
      </div>
      <Progress value={percentage} className="h-1.5 sm:h-2" />
    </div>
  );
};

export default VerificationProgress;
