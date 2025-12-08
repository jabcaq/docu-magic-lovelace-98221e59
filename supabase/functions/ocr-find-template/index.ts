import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PreliminaryData {
  companyName?: string | null;
  companyNameNormalized?: string | null;
  officeName?: string | null;
  officeNameNormalized?: string | null;
  documentType?: string | null;
  // Can be array or object
  characteristicNumbers?: { type: string; value: string }[] | Record<string, string | undefined>;
  detectedLanguage?: string | null;
}

interface TemplateCandidate {
  id: string;
  name: string;
  storage_path: string;
  tag_metadata: Record<string, any>;
  tags: string[];
  score: number;
  hasExamples: boolean;
}

interface FindTemplateResult {
  bestMatch: TemplateCandidate | null;
  candidates: TemplateCandidate[];
  exampleTagValueMap: Record<string, string> | null;
  confidence: number;
  llmVerified: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openRouterApiKey = Deno.env.get("OPEN_ROUTER_API_KEY");
    
    // Get user from JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error("Authorization header is required");
    }
    
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      throw new Error("Invalid or expired token");
    }
    const userId = user.id;
    console.log("User authenticated:", userId);
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { preliminaryData, ocrDocumentId, verifyWithLlm = true } = await req.json();

    if (!preliminaryData) {
      throw new Error("preliminaryData is required");
    }

    const data = preliminaryData as PreliminaryData;
    
    // Normalize characteristicNumbers to array format
    let charNumbers: { type: string; value: string }[] = [];
    if (data.characteristicNumbers) {
      if (Array.isArray(data.characteristicNumbers)) {
        charNumbers = data.characteristicNumbers;
      } else {
        // Convert object {vin: "123", mrn: "456"} to array [{type: "vin", value: "123"}, ...]
        charNumbers = Object.entries(data.characteristicNumbers)
          .filter(([_, v]) => v !== undefined && v !== null)
          .map(([type, value]) => ({ type, value: value as string }));
      }
    }
    
    console.log("Finding template for document type:", data.documentType, "charNumbers:", charNumbers);

    let result: FindTemplateResult = {
      bestMatch: null,
      candidates: [],
      exampleTagValueMap: null,
      confidence: 0,
      llmVerified: false,
    };

    // Fetch all templates for the user
    const { data: templates, error: templatesError } = await supabase
      .from("templates")
      .select("id, name, storage_path, tag_metadata")
      .eq("user_id", userId);

    if (templatesError) {
      console.error("Error fetching templates:", templatesError);
      throw new Error("Failed to fetch templates");
    }

    if (!templates || templates.length === 0) {
      console.log("No templates found for user");
      return new Response(JSON.stringify({
        success: true,
        data: result,
        message: "No templates available",
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log("Found templates:", templates.length);

    // Score each template based on matching criteria
    const scoredTemplates: TemplateCandidate[] = [];

    for (const template of templates) {
      let score = 0;
      const tagMetadata = template.tag_metadata || {};
      const tags = Object.keys(tagMetadata);
      
      // Check if template name contains document type keywords
      const templateNameLower = template.name.toLowerCase();
      const docTypeLower = (data.documentType || "").toLowerCase();
      
      if (docTypeLower && templateNameLower.includes(docTypeLower)) {
        score += 30;
      }
      
      // Check for specific document type keywords
      const docTypeKeywords = ["celne", "sad", "deklaracja", "faktura", "import", "eksport", "vat", "akcyza"];
      for (const keyword of docTypeKeywords) {
        if (docTypeLower.includes(keyword) && templateNameLower.includes(keyword)) {
          score += 20;
        }
      }

      // Check if template has relevant tags for characteristic numbers
      const characteristicTypes = charNumbers.map(n => n.type.toUpperCase());
      for (const tag of tags) {
        const tagUpper = tag.toUpperCase();
        if (characteristicTypes.some(type => tagUpper.includes(type))) {
          score += 15;
        }
        // Common customs document tags
        if (tagUpper.includes("VIN") || tagUpper.includes("MRN") || tagUpper.includes("EORI")) {
          score += 5;
        }
      }

      // Check for company/office related tags
      if (data.companyName) {
        for (const tag of tags) {
          const tagUpper = tag.toUpperCase();
          if (tagUpper.includes("FIRMA") || tagUpper.includes("IMPORTER") || 
              tagUpper.includes("ODBIORCA") || tagUpper.includes("NADAWCA") ||
              tagUpper.includes("COMPANY") || tagUpper.includes("CLIENT")) {
            score += 10;
          }
        }
      }

      // Check if template has examples
      const { data: examples } = await supabase
        .from("template_examples")
        .select("id")
        .eq("template_id", template.id)
        .limit(1);

      const hasExamples = examples && examples.length > 0;
      if (hasExamples) {
        score += 25; // Templates with examples are more reliable
      }

      scoredTemplates.push({
        id: template.id,
        name: template.name,
        storage_path: template.storage_path,
        tag_metadata: tagMetadata,
        tags,
        score,
        hasExamples: hasExamples ?? false,
      });
    }

    // Sort by score descending
    scoredTemplates.sort((a, b) => b.score - a.score);

    // Take top candidates
    result.candidates = scoredTemplates.slice(0, 5);
    console.log("Top candidates:", result.candidates.map(c => ({ name: c.name, score: c.score })));

    // If we have candidates, optionally verify with LLM
    if (result.candidates.length > 0 && verifyWithLlm && openRouterApiKey) {
      console.log("Verifying template match with LLM...");

      const verificationPrompt = `Wybierz najlepszy szablon dokumentu Word dla przetworzenia dokumentu OCR.

INFORMACJE O DOKUMENCIE:
- Typ dokumentu: ${data.documentType || "nieznany"}
- Firma: ${data.companyName || "brak"}
- Urząd: ${data.officeName || "brak"}
- Charakterystyczne numery: ${charNumbers.map(n => `${n.type}: ${n.value}`).join(", ") || "brak"}

DOSTĘPNE SZABLONY:
${result.candidates.map((t, i) => `${i + 1}. "${t.name}"
   - Tagi: ${t.tags.slice(0, 10).join(", ")}${t.tags.length > 10 ? "..." : ""}
   - Ma przykłady historyczne: ${t.hasExamples ? "tak" : "nie"}
   - Score wstępny: ${t.score}`).join("\n\n")}

Odpowiedz w formacie JSON:
{
  "bestTemplateIndex": numer 1-5 najlepszego szablonu lub null jeśli żaden nie pasuje,
  "confidence": 0.0-1.0 pewność dopasowania,
  "reasoning": "krótkie uzasadnienie wyboru"
}`;

      try {
        const llmResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://docu-magic.app",
            "X-Title": "DocuMagic OCR Pipeline",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "user", content: verificationPrompt }
            ],
            temperature: 0.1,
            max_tokens: 500,
          }),
        });

        if (llmResponse.ok) {
          const llmData = await llmResponse.json();
          const content = llmData.choices?.[0]?.message?.content || "";
          
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const verification = JSON.parse(jsonMatch[0]);
            console.log("LLM verification result:", verification);

            if (verification.bestTemplateIndex && verification.confidence >= 0.4) {
              const idx = verification.bestTemplateIndex - 1;
              if (idx >= 0 && idx < result.candidates.length) {
                result.bestMatch = result.candidates[idx];
                result.confidence = verification.confidence;
                result.llmVerified = true;
              }
            }
          }
        }
      } catch (llmError) {
        console.error("LLM verification error:", llmError);
      }
    }

    // If no LLM verification or it failed, use highest scored template
    if (!result.bestMatch && result.candidates.length > 0 && result.candidates[0].score >= 30) {
      result.bestMatch = result.candidates[0];
      result.confidence = Math.min(result.candidates[0].score / 100, 0.8);
    }

    // Fetch example tag-value map if we have a best match
    if (result.bestMatch) {
      console.log("Fetching examples for template:", result.bestMatch.name);
      
      const { data: examples } = await supabase
        .from("template_examples")
        .select("tag_value_map, corrections_applied")
        .eq("template_id", result.bestMatch.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (examples && examples.length > 0) {
        result.exampleTagValueMap = examples[0].tag_value_map as Record<string, string>;
        console.log("Found example with", Object.keys(result.exampleTagValueMap).length, "tags");
      }
    }

    // Update ocr_documents if ID provided
    if (ocrDocumentId && result.bestMatch) {
      console.log("Updating ocr_documents with template match:", ocrDocumentId);

      const { error: updateError } = await supabase
        .from("ocr_documents")
        .update({
          matched_template_id: result.bestMatch.id,
          status: "template_matched",
          confidence_score: result.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ocrDocumentId);

      if (updateError) {
        console.error("Failed to update ocr_documents:", updateError);
      }
    }

    console.log("Template search completed. Best match:", result.bestMatch?.name);

    return new Response(JSON.stringify({
      success: true,
      data: result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in ocr-find-template function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
