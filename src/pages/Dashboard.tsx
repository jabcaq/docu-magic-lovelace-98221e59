import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Upload, Search, Settings, Sparkles, ScanText, ExternalLink } from "lucide-react";
import WordTemplater from "@/components/WordTemplater";
import TestXmlAi from "@/components/TestXmlAi";
import DocxTemplateProcessor from "@/components/DocxTemplateProcessor";
import { OcrUpload } from "@/components/OcrUpload";

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState("generator");

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
          <TabsList className="grid w-full max-w-4xl grid-cols-6 mx-auto">
            <TabsTrigger value="generator" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Generator
            </TabsTrigger>
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
            <TabsTrigger value="xml-ai" className="gap-2">
              <FileText className="h-4 w-4" />
              XML + AI
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generator" className="space-y-6">
            <DocxTemplateProcessor />
          </TabsContent>

          <TabsContent value="templater" className="space-y-6">
            <WordTemplater />
          </TabsContent>

          <TabsContent value="ocr" className="space-y-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500">
                  <ScanText className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">OCR z Gemini 2.5 Pro</h2>
                  <p className="text-sm text-muted-foreground">
                    Wyciągaj dane z obrazów, PDF i dokumentów Word
                  </p>
                </div>
              </div>
              <Button variant="outline" asChild>
                <Link to="/ocr">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Otwórz pełny widok
                </Link>
              </Button>
            </div>
            <OcrUpload saveToDatabase={true} />
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

          <TabsContent value="xml-ai" className="space-y-6">
            <TestXmlAi />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Dashboard;
