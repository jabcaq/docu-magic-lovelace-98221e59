import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PreliminaryOcrResult {
  companyName: string | null;
  companyNameNormalized: string | null;
  officeName: string | null;
  officeNameNormalized: string | null;
  documentType: string | null;
  characteristicNumbers: {
    type: string;
    value: string;
  }[];
  detectedLanguage: string | null;
  confidence: number;
  rawExtraction: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const { imageBase64, storagePath, ocrDocumentId } = await req.json();

    if (!imageBase64 && !storagePath) {
      throw new Error("Either imageBase64 or storagePath must be provided");
    }

    let base64Image = imageBase64;
    let mimeType = "image/jpeg";

    // If storagePath is provided, fetch the image from Supabase storage
    if (storagePath && !imageBase64) {
      console.log("Fetching image from storage:", storagePath);
      
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: fileData, error: downloadError } = await supabase.storage
        .from("documents")
        .download(storagePath);

      if (downloadError) {
        throw new Error(`Failed to download file: ${downloadError.message}`);
      }

      // Convert blob to base64
      const arrayBuffer = await fileData.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      base64Image = btoa(String.fromCharCode(...uint8Array));
      
      // Determine mime type from file extension
      if (storagePath.toLowerCase().endsWith('.png')) {
        mimeType = "image/png";
      } else if (storagePath.toLowerCase().endsWith('.pdf')) {
        mimeType = "application/pdf";
      } else if (storagePath.toLowerCase().endsWith('.webp')) {
        mimeType = "image/webp";
      }
    }

    console.log("Sending image to OpenRouter for preliminary OCR analysis...");

    const systemPrompt = `Jesteś ekspertem od analizy dokumentów celnych, podatkowych i handlowych. Twoim zadaniem jest wstępna analiza dokumentu i wyciągnięcie charakterystycznych informacji.

Przeanalizuj dokument i wyciągnij:
1. NAZWA FIRMY/KLIENTA - firma która jest głównym podmiotem dokumentu (importer, eksporter, odbiorca)
2. NAZWA URZĘDU - urząd celny, skarbowy lub inna instytucja która wydała/obsługuje dokument
3. TYP DOKUMENTU - np. "SAD", "Deklaracja celna", "Faktura", "Dokument odprawy celnej", "Potwierdzenie importu"
4. CHARAKTERYSTYCZNE NUMERY - wszystkie ważne numery identyfikacyjne:
   - VIN (numer nadwozia pojazdu, 17 znaków)
   - MRN (Movement Reference Number, format np. 24PL...)
   - EORI (Economic Operators Registration and Identification)
   - Numer dokumentu/deklaracji
   - Numer faktury
   - Numer rejestracyjny pojazdu
   - Inne charakterystyczne numery

Odpowiedz TYLKO w formacie JSON:
{
  "companyName": "pełna nazwa firmy lub null",
  "companyNameNormalized": "nazwa firmy bez znaków specjalnych, wielkie litery, lub null",
  "officeName": "pełna nazwa urzędu lub null",
  "officeNameNormalized": "nazwa urzędu bez znaków specjalnych, wielkie litery, lub null",
  "documentType": "typ dokumentu lub null",
  "characteristicNumbers": [
    {"type": "VIN", "value": "ABC123..."},
    {"type": "MRN", "value": "24PL..."},
    {"type": "EORI", "value": "PL..."}
  ],
  "detectedLanguage": "pl/en/de/nl/itp",
  "confidence": 0.0-1.0
}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://docu-magic.app",
        "X-Title": "DocuMagic OCR Pipeline",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Przeanalizuj ten dokument i wyciągnij charakterystyczne informacje zgodnie z instrukcjami."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter API error:", response.status, errorText);
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const aiResponse = await response.json();
    console.log("OpenRouter response received");

    const content = aiResponse.choices?.[0]?.message?.content || "";
    console.log("AI response content:", content);

    // Parse JSON from AI response
    let result: PreliminaryOcrResult;
    try {
      // Extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in AI response");
      }
      const parsed = JSON.parse(jsonMatch[0]);
      
      result = {
        companyName: parsed.companyName || null,
        companyNameNormalized: parsed.companyNameNormalized || null,
        officeName: parsed.officeName || null,
        officeNameNormalized: parsed.officeNameNormalized || null,
        documentType: parsed.documentType || null,
        characteristicNumbers: Array.isArray(parsed.characteristicNumbers) 
          ? parsed.characteristicNumbers 
          : [],
        detectedLanguage: parsed.detectedLanguage || null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        rawExtraction: content,
      };
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      result = {
        companyName: null,
        companyNameNormalized: null,
        officeName: null,
        officeNameNormalized: null,
        documentType: null,
        characteristicNumbers: [],
        detectedLanguage: null,
        confidence: 0,
        rawExtraction: content,
      };
    }

    // If ocrDocumentId is provided, update the database record
    if (ocrDocumentId) {
      console.log("Updating ocr_documents record:", ocrDocumentId);
      
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { error: updateError } = await supabase
        .from("ocr_documents")
        .update({
          preliminary_ocr_data: result,
          status: "preliminary",
          confidence_score: result.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ocrDocumentId);

      if (updateError) {
        console.error("Failed to update ocr_documents:", updateError);
      }
    }

    console.log("Preliminary OCR completed successfully");

    return new Response(JSON.stringify({
      success: true,
      data: result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in ocr-preliminary function:', error);
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
