import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Upload, Search, Settings, ScanText, Users, LogOut, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import WordTemplater from "@/components/WordTemplater";
import AiUsageStats from "@/components/AiUsageStats";
import { OcrUpload } from "@/components/OcrUpload";
import { useUserRole } from "@/hooks/use-user-role";
import { TemplateSearch } from "@/components/TemplateSearch";
import { useOcrState } from "@/hooks/use-ocr-state";
const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role, loading, isAdmin } = useUserRole();
  const [activeTab, setActiveTab] = useState("templater");
  
  // Persistent OCR state - survives tab switches
  const ocrState = useOcrState('gemini');

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Błąd",
        description: "Nie udało się wylogować",
        variant: "destructive",
      });
    } else {
      navigate("/auth");
    }
  };

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
            <div className="flex gap-2">
              {isAdmin && (
                <Button variant="outline" onClick={() => navigate("/user-management")}>
                  <Users className="h-4 w-4 mr-2" />
                  Użytkownicy
                </Button>
              )}
              <Button variant="outline" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Wyloguj
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className={`grid w-full max-w-4xl mx-auto ${isAdmin ? 'grid-cols-4' : 'grid-cols-2'}`}>
              <TabsTrigger value="templater" className="gap-2">
                <FileText className="h-4 w-4" />
                Templater
              </TabsTrigger>
              <TabsTrigger value="ocr" className="gap-2">
                <Upload className="h-4 w-4" />
                OCR
              </TabsTrigger>
              {isAdmin && (
                <>
                  <TabsTrigger value="ai-stats" className="gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Statystyki AI
                  </TabsTrigger>
                  <TabsTrigger value="search" className="gap-2">
                    <Search className="h-4 w-4" />
                    Search
                  </TabsTrigger>
                </>
              )}
            </TabsList>


          <TabsContent value="templater" className="space-y-6">
            <WordTemplater userRole={role} />
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
            </div>
            <OcrUpload 
              saveToDatabase={true}
              persistentState={ocrState}
            />
          </TabsContent>

          {isAdmin && (
            <>
              <TabsContent value="ai-stats" className="space-y-6">
                <AiUsageStats />
              </TabsContent>

              <TabsContent value="search" className="space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-primary to-accent">
                    <Search className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Wyszukiwanie szablonów</h2>
                    <p className="text-sm text-muted-foreground">
                      Semantyczne wyszukiwanie dokumentów i szablonów z AI
                    </p>
                  </div>
                </div>
                <TemplateSearch />
              </TabsContent>
            </>
          )}
        </Tabs>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
