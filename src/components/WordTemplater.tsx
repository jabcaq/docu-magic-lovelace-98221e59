import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, Download, List } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const WordTemplater = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith(".docx")) {
        setFile(selectedFile);
        toast({
          title: "File uploaded",
          description: `${selectedFile.name} is ready for processing`,
        });
      } else {
        toast({
          title: "Invalid file type",
          description: "Please upload a .docx file",
          variant: "destructive",
        });
      }
    }
  };

  const handleExtractRuns = async () => {
    if (!file) return;

    setIsProcessing(true);
    try {
      // TODO: Implement API call to extract runs endpoint
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate processing
      
      toast({
        title: "Success",
        description: "Word document runs extracted successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process document",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex justify-end">
        <Button onClick={() => navigate("/documents")} variant="outline" className="gap-2">
          <List className="h-4 w-4" />
          Zobacz dokumenty OCR
        </Button>
      </div>

      {/* Upload Section */}
      <Card className="p-6 border-2 border-dashed hover:border-primary/50 transition-colors">
        <div className="space-y-4">
          <div className="text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Upload Word Template</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a .docx file to extract and tag run elements
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file-upload">Select File</Label>
            <Input
              id="file-upload"
              type="file"
              accept=".docx"
              onChange={handleFileChange}
              className="cursor-pointer"
            />
          </div>

          {file && (
            <div className="flex items-center gap-3 p-3 bg-accent/10 rounded-lg">
              <FileText className="h-5 w-5 text-accent" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Actions Section */}
      {file && (
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-semibold">Actions</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Button
              onClick={handleExtractRuns}
              disabled={isProcessing}
              className="w-full"
            >
              {isProcessing ? "Processing..." : "Extract Runs"}
            </Button>
            <Button variant="outline" disabled className="w-full gap-2">
              <Download className="h-4 w-4" />
              Find & Replace
            </Button>
          </div>
        </Card>
      )}

      {/* Preview Section */}
      {file && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Document Preview</h3>
          <div className="bg-muted/30 rounded-lg p-8 text-center min-h-[200px] flex items-center justify-center">
            <div className="space-y-2">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Preview and tagging interface will appear here
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default WordTemplater;
