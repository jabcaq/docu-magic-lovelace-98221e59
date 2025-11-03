import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileText, Zap, Shield, ArrowRight } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      {/* Hero Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-block">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-6 shadow-lg">
              <FileText className="h-10 w-10 text-primary-foreground" />
            </div>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold leading-tight">
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              AI-Powered Document
            </span>
            <br />
            <span className="text-foreground">Automation Platform</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Transform unstructured documents into structured, editable Word files using
            advanced OCR, LLM-powered field mapping, and intelligent templating.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button 
              size="lg" 
              className="gap-2 text-lg px-8"
              onClick={() => navigate("/dashboard")}
            >
              Get Started
              <ArrowRight className="h-5 w-5" />
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              className="text-lg px-8"
            >
              Learn More
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="p-6 rounded-xl bg-card border hover:shadow-lg transition-shadow">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Word Templater</h3>
            <p className="text-muted-foreground">
              Extract and tag Word document elements. Create dynamic templates with
              intelligent placeholders.
            </p>
          </div>

          <div className="p-6 rounded-xl bg-card border hover:shadow-lg transition-shadow">
            <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
              <Zap className="h-6 w-6 text-accent" />
            </div>
            <h3 className="text-xl font-semibold mb-2">OCR AI Translator</h3>
            <p className="text-muted-foreground">
              Convert images and PDFs to structured documents using advanced OCR
              and LLM-powered data extraction.
            </p>
          </div>

          <div className="p-6 rounded-xl bg-card border hover:shadow-lg transition-shadow">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Semantic Search</h3>
            <p className="text-muted-foreground">
              Find the perfect template instantly with AI-powered semantic search
              across your document library.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;
