import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Send, Loader2 } from "lucide-react";

const TestXmlAi = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.docx') && !selectedFile.name.endsWith('.doc')) {
        toast({
          title: "Invalid file type",
          description: "Please select a .docx or .doc file",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
      toast({
        title: "File selected",
        description: selectedFile.name,
      });
    }
  };

  const handleSendToWebhook = async () => {
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a DOCX file first",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Upload file to Supabase Storage
      const sanitizedFileName = file.name.replace(/[()]/g, '');
      const timestamp = Date.now();
      const fileName = `test-xml/${timestamp}-${sanitizedFileName}`;

      console.log("Uploading file:", fileName);
      
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, file, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: true
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        throw uploadError;
      }

      toast({
        title: "File uploaded",
        description: "Processing and sending to webhook...",
      });

      // Wait a bit for storage sync
      await new Promise(resolve => setTimeout(resolve, 500));

      // Call edge function to extract XML and send to webhook
      console.log("Calling extract-and-send-xml function");
      const { data, error: functionError } = await supabase.functions.invoke(
        'extract-and-send-xml',
        {
          body: { storagePath: fileName }
        }
      );

      if (functionError) {
        console.error("Function error:", functionError);
        throw functionError;
      }

      console.log("Webhook response:", data);

      toast({
        title: "Success!",
        description: "XML extracted and sent to webhook successfully",
      });

      // Cleanup
      await supabase.storage.from('documents').remove([fileName]);
      setFile(null);
      
    } catch (error) {
      console.error("Error processing file:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process file",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card className="p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Send className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-2xl font-semibold">Test XML + AI Webhook</h3>
          <p className="text-muted-foreground">
            Upload a DOCX file to extract XML and send it to the webhook
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Input
              type="file"
              accept=".docx,.doc"
              onChange={handleFileSelect}
              className="cursor-pointer"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
            >
              <Upload className="h-4 w-4" />
            </Button>
          </div>

          {file && (
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium">Selected file:</p>
              <p className="text-sm text-muted-foreground">{file.name}</p>
            </div>
          )}

          <Button
            onClick={handleSendToWebhook}
            disabled={!file || isProcessing}
            className="w-full"
            size="lg"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Extract XML & Send to Webhook
              </>
            )}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground text-center">
          Webhook URL: https://kamil109-20109.wykr.es/webhook/5facd64d-a48f-41b3-ad07-a52fd32f60f1
        </div>
      </div>
    </Card>
  );
};

export default TestXmlAi;
