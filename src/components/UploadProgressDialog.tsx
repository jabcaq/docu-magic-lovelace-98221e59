import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CheckCircle2, Loader2, Circle, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type StepStatus = "pending" | "loading" | "success" | "error";

interface Step {
  id: string;
  label: string;
  status: StepStatus;
}

interface UploadProgressDialogProps {
  open: boolean;
  steps: Step[];
  currentStep: number;
  error?: string;
}

const UploadProgressDialog = ({
  open,
  steps,
  currentStep,
  error,
}: UploadProgressDialogProps) => {
  const progress = ((currentStep + 1) / steps.length) * 100;

  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case "loading":
        return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case "error":
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Circle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>Przetwarzanie dokumentu</DialogTitle>
          <DialogDescription>
            {error ? "Wystąpił błąd podczas przetwarzania" : "Proszę czekać..."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <Progress value={progress} className="h-2" />

          <div className="space-y-4">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={`flex items-start gap-3 ${
                  step.status === "loading" ? "opacity-100" : step.status === "pending" ? "opacity-50" : "opacity-100"
                }`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {getStepIcon(step.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${
                    step.status === "error" ? "text-destructive" : "text-foreground"
                  }`}>
                    {step.label}
                  </p>
                  {step.status === "loading" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      W trakcie...
                    </p>
                  )}
                  {step.status === "success" && (
                    <p className="text-xs text-green-600 mt-1">
                      Ukończono
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadProgressDialog;
