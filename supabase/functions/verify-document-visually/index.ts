import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VisualVariable {
  text: string;
  tag: string;
  pageNumber: number;
  position?: { x: number; y: number };
  confidence?: number;
}

/**
 * Verify document visually using Gemini 2.5 Pro Vision
 * Takes images of document pages and checks for additional variables
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openRouterApiKey = Deno.env.get("OPEN_ROUTER_API_KEY");
    
    if (!openRouterApiKey) {
      throw new Error("OPEN_ROUTER_API_KEY not configured");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { documentId, pageImages } = await req.json();

    if (!pageImages || !Array.isArray(pageImages) || pageImages.length === 0) {
      throw new Error("pageImages array is required");
    }

    console.log("=== Visual Verification with Gemini 2.5 Pro ===");
    console.log("Document ID:", documentId);
    console.log("Pages to verify:", pageImages.length);

    const allFoundVariables: VisualVariable[] = [];

    // Process each page image
    for (let pageIndex = 0; pageIndex < pageImages.length; pageIndex++) {
      const imageBase64 = pageImages[pageIndex];
      const pageNumber = pageIndex + 1;

      console.log(`→ Analyzing page ${pageNumber}/${pageImages.length}...`);

      // Prepare vision prompt
      const systemPrompt = `Jesteś ekspertem od analizy wizualnej dokumentów celnych i administracyjnych.

ZADANIE: Przeanalizuj obraz strony dokumentu i znajdź WSZYSTKIE dane zmienne, które NIE zostały jeszcze zamienione na placeholdery {{tag}}.

SZCZEGÓLNIE SZUKAJ:
- Tekstów które wyglądają jak dane (numery, daty, nazwiska, adresy, kwoty)
- Tekstów które są różne w każdym dokumencie
- Tekstów które NIE są etykietami (etykiety kończą się dwukropkiem)

NIE ZAMIENIAJ:
- Etykiet i nagłówków (teksty z dwukropkiem)
- Wartości stałych (MARLOG CAR HANDLING BV, NL006223527, itp.)
- Placeholderów już zamienionych ({{...}})

FORMAT ODPOWIEDZI:
Zwróć JSON array z obiektami:
[
  {
    "text": "oryginalny tekst z dokumentu",
    "tag": "{{nazwaZmiennej}}",
    "position": "opis gdzie na stronie (opcjonalnie)"
  }
]

Jeśli nie znajdziesz żadnych dodatkowych zmiennych, zwróć pusty array: [].`;

      const userPrompt = `Przeanalizuj tę stronę dokumentu (strona ${pageNumber} z ${pageImages.length}) i znajdź wszystkie dane zmienne, które NIE zostały jeszcze zamienione na placeholdery {{tag}}.

Zwróć JSON array z wykrytymi zmiennymi. Jeśli nie ma dodatkowych zmiennych, zwróć [].`;

      // Call Gemini 2.5 Pro Vision via OpenRouter
      const visionResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://docu-magic.app",
          "X-Title": "DocuMagic Visual Verification",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro", // Vision model - Gemini 2.5 Pro
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `${systemPrompt}\n\n${userPrompt}`,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 4000,
        }),
      });

      if (!visionResponse.ok) {
        const errorText = await visionResponse.text();
        console.error(`Vision API error (page ${pageNumber}):`, visionResponse.status, errorText);
        // Continue with other pages even if one fails
        continue;
      }

      const visionData = await visionResponse.json();
      const visionContent = visionData?.choices?.[0]?.message?.content;

      if (!visionContent) {
        console.warn(`No content from vision API for page ${pageNumber}`);
        continue;
      }

      // Parse JSON response
      let pageVariables: VisualVariable[] = [];
      try {
        const cleaned = visionContent
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          pageVariables = parsed.map((v: any) => ({
            text: v.text || v.originalText || "",
            tag: v.tag || "",
            pageNumber,
            position: v.position,
            confidence: v.confidence,
          })).filter((v: VisualVariable) => v.text && v.tag);
        }
      } catch (parseError) {
        console.error(`Failed to parse vision response for page ${pageNumber}:`, parseError);
        console.log("Raw response:", visionContent.substring(0, 500));
      }

      console.log(`✓ Page ${pageNumber}: Found ${pageVariables.length} additional variables`);
      allFoundVariables.push(...pageVariables);
    }

    console.log(`✓ Visual verification complete: ${allFoundVariables.length} total additional variables found`);

    return new Response(
      JSON.stringify({
        success: true,
        variables: allFoundVariables,
        totalFound: allFoundVariables.length,
        pagesAnalyzed: pageImages.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("❌ Error in visual verification:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage, success: false }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

