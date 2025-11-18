import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TagMapping {
  [key: string]: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Invalid token");
    }

    const { documentId, textContent } = await req.json();

    if (!documentId || !textContent) {
      throw new Error("Missing documentId or textContent");
    }

    console.log(`Extracting runs for document ${documentId}`);

    // Split text into runs (paragraphs and sentences)
    const runs = extractRuns(textContent);
    
    console.log(`Extracted ${runs.length} runs, sending to AI for tagging...`);

    // Use Lovable AI to tag runs
    const taggedRuns = await tagRunsWithAI(runs, lovableApiKey);

    console.log(`AI tagged ${taggedRuns.filter(r => r.tag).length} runs as placeholders`);

    // Save runs to database
    const { error: insertError } = await supabase
      .from("document_runs")
      .insert(
        taggedRuns.map((run, index) => ({
          document_id: documentId,
          run_index: index,
          text: run.text,
          tag: run.tag || null,
          type: run.tag ? "placeholder" : "text",
        }))
      );

    if (insertError) {
      console.error("Error inserting runs:", insertError);
      throw insertError;
    }

    // Update document status
    await supabase
      .from("documents")
      .update({ status: "processing" })
      .eq("id", documentId);

    return new Response(
      JSON.stringify({
        success: true,
        runs: taggedRuns,
        totalRuns: taggedRuns.length,
        placeholders: taggedRuns.filter(r => r.tag).length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in extract-runs:", error);
    
    if (error instanceof Error && error.message.includes("429")) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (error instanceof Error && error.message.includes("402")) {
      return new Response(
        JSON.stringify({ error: "Payment required. Please add credits to continue." }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function extractRuns(text: string): Array<{ text: string }> {
  // Split by paragraphs first
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  
  const runs: Array<{ text: string }> = [];
  
  for (const para of paragraphs) {
    // Split long paragraphs into sentences
    const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed) {
        runs.push({ text: trimmed });
      }
    }
  }
  
  return runs;
}

async function tagRunsWithAI(
  runs: Array<{ text: string }>,
  apiKey: string
): Promise<Array<{ text: string; tag?: string }>> {
  const systemPrompt = `Jesteś ekspertem w analizie dokumentów prawnych i administracyjnych.
Twoim zadaniem jest zidentyfikowanie fragmentów tekstu, które są dynamicznymi danymi (mogą się zmieniać między dokumentami) i przypisanie im odpowiednich tagów.

Dynamiczne dane to np.:
- Imiona i nazwiska ({{ClientName}}, {{LandlordName}}, etc.)
- Daty ({{Date}}, {{StartDate}}, {{EndDate}})
- Adresy ({{Address}}, {{PropertyAddress}})
- Kwoty i liczby ({{Amount}}, {{Rent}}, {{Deposit}})
- Numery dokumentów ({{DocumentNumber}}, {{PESEL}}, {{IDNumber}})
- Powierzchnie, wymiary ({{Area}}, {{Size}})

Statyczne dane to np.:
- Tytuły dokumentów
- Standardowe klauzule prawne
- Zwroty "zwany dalej", "w imieniu", "zgodnie z"

Nazwy tagów:
- W formacie CamelCase
- Po angielsku
- Opisowe i intuicyjne
- Unikalne w dokumencie`;

  const userPrompt = `Przeanalizuj poniższe fragmenty dokumentu i zataguj tylko te, które są dynamicznymi danymi.
Dla każdego fragmentu zwróć: text (oryginalny tekst) i tag (jeśli to dynamiczna dana).

Fragmenty:
${runs.map((r, i) => `${i + 1}. "${r.text}"`).join("\n")}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "tag_runs",
              description: "Tag document runs with appropriate placeholders",
              parameters: {
                type: "object",
                properties: {
                  tagged_runs: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        index: { type: "number", description: "Index of the run (1-based)" },
                        text: { type: "string", description: "Original text" },
                        tag: { 
                          type: "string", 
                          description: "Tag in format {{TagName}} if dynamic data, empty if static" 
                        },
                      },
                      required: ["index", "text", "tag"],
                    },
                  },
                },
                required: ["tagged_runs"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "tag_runs" } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`AI API error: ${response.status} - ${errorText}`);
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      console.log("No tool call in response, returning original runs");
      return runs;
    }

    const result = JSON.parse(toolCall.function.arguments);
    const taggedRuns = result.tagged_runs;

    // Merge AI tags with original runs
    return runs.map((run, index) => {
      const aiTag = taggedRuns.find((t: any) => t.index === index + 1);
      return {
        text: run.text,
        tag: aiTag?.tag || undefined,
      };
    });
  } catch (error) {
    console.error("Error calling AI:", error);
    // Return untagged runs if AI fails
    return runs;
  }
}
