import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Upload, Search, Settings } from "lucide-react";
import WordTemplater from "@/components/WordTemplater";

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState("templater");

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <FileText className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  DocuAI
                </h1>
                <p className="text-xs text-muted-foreground">Document Automation Platform</p>
              </div>
            </div>
            <Button variant="outline" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-4 mx-auto">
            <TabsTrigger value="templater" className="gap-2">
              <FileText className="h-4 w-4" />
              Templater
            </TabsTrigger>
            <TabsTrigger value="ocr" className="gap-2">
              <Upload className="h-4 w-4" />
              OCR
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-2">
              <Search className="h-4 w-4" />
              Search
            </TabsTrigger>
            <TabsTrigger value="test" className="gap-2">
              <Settings className="h-4 w-4" />
              Test
            </TabsTrigger>
          </TabsList>

          <TabsContent value="templater" className="space-y-6">
            <WordTemplater />
          </TabsContent>

          <TabsContent value="ocr" className="space-y-6">
            <Card className="p-8 text-center">
              <div className="max-w-md mx-auto space-y-4">
                <div className="h-16 w-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto">
                  <Upload className="h-8 w-8 text-accent" />
                </div>
                <h3 className="text-xl font-semibold">OCR AI Translator</h3>
                <p className="text-muted-foreground">
                  Upload images or PDFs to extract text and generate structured Word documents
                </p>
                <Button className="mt-4" disabled>
                  Coming Soon
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="search" className="space-y-6">
            <Card className="p-8 text-center">
              <div className="max-w-md mx-auto space-y-4">
                <div className="h-16 w-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto">
                  <Search className="h-8 w-8 text-accent" />
                </div>
                <h3 className="text-xl font-semibold">Template Search</h3>
                <p className="text-muted-foreground">
                  Semantic search across all your Word templates powered by AI
                </p>
                <Button className="mt-4" disabled>
                  Coming Soon
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="test" className="space-y-6">
            <Card className="p-8 text-center">
              <div className="max-w-md mx-auto space-y-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Settings className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Test Runs</h3>
                <p className="text-muted-foreground">
                  Test document processing and variable extraction
                </p>
                <Button className="mt-4" onClick={() => window.location.href = '/test-runs'}>
                  Go to Test Page
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Dashboard;
