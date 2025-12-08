import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PreliminaryData {
  companyName: string | null;
  companyNameNormalized: string | null;
  officeName: string | null;
  officeNameNormalized: string | null;
  documentType: string | null;
  characteristicNumbers: { type: string; value: string }[];
}

interface MatchResult {
  clientMatch: {
    id: string;
    name: string;
    normalized_name: string;
    eori: string | null;
    address: string | null;
    country: string | null;
    similarity_score: number;
  } | null;
  officeMatch: {
    id: string;
    name: string;
    normalized_name: string;
    office_type: string;
    country: string | null;
    address: string | null;
    similarity_score: number;
  } | null;
  clientCandidates: Array<{
    id: string;
    name: string;
    similarity_score: number;
  }>;
  officeCandidates: Array<{
    id: string;
    name: string;
    similarity_score: number;
  }>;
  matchConfidence: number;
  llmVerified: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openRouterApiKey = Deno.env.get("OPEN_ROUTER_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { preliminaryData, userId, ocrDocumentId, verifyWithLlm = true } = await req.json();

    if (!preliminaryData) {
      throw new Error("preliminaryData is required");
    }
    if (!userId) {
      throw new Error("userId is required");
    }

    const data = preliminaryData as PreliminaryData;
    console.log("Matching preliminary data:", JSON.stringify(data, null, 2));

    let result: MatchResult = {
      clientMatch: null,
      officeMatch: null,
      clientCandidates: [],
      officeCandidates: [],
      matchConfidence: 0,
      llmVerified: false,
    };

    // Search for client matches
    if (data.companyNameNormalized || data.companyName) {
      const searchTerm = data.companyNameNormalized || data.companyName || "";
      console.log("Searching clients with term:", searchTerm);

      const { data: clientResults, error: clientError } = await supabase.rpc(
        "search_clients_fuzzy",
        {
          search_term: searchTerm,
          p_user_id: userId,
          similarity_threshold: 0.2,
          max_results: 5,
        }
      );

      if (clientError) {
        console.error("Client search error:", clientError);
      } else if (clientResults && clientResults.length > 0) {
        console.log("Found client candidates:", clientResults.length);
        
        result.clientCandidates = clientResults.map((c: any) => ({
          id: c.id,
          name: c.name,
          similarity_score: c.similarity_score,
        }));

        // Take best match if similarity is high enough
        if (clientResults[0].similarity_score >= 0.5) {
          result.clientMatch = clientResults[0];
        }
      }
    }

    // Search for office matches
    if (data.officeNameNormalized || data.officeName) {
      const searchTerm = data.officeNameNormalized || data.officeName || "";
      console.log("Searching offices with term:", searchTerm);

      const { data: officeResults, error: officeError } = await supabase.rpc(
        "search_offices_fuzzy",
        {
          search_term: searchTerm,
          p_user_id: userId,
          similarity_threshold: 0.2,
          max_results: 5,
        }
      );

      if (officeError) {
        console.error("Office search error:", officeError);
      } else if (officeResults && officeResults.length > 0) {
        console.log("Found office candidates:", officeResults.length);
        
        result.officeCandidates = officeResults.map((o: any) => ({
          id: o.id,
          name: o.name,
          similarity_score: o.similarity_score,
        }));

        // Take best match if similarity is high enough
        if (officeResults[0].similarity_score >= 0.5) {
          result.officeMatch = officeResults[0];
        }
      }
    }

    // LLM verification if we have candidates but aren't sure
    if (verifyWithLlm && openRouterApiKey && 
        (result.clientCandidates.length > 0 || result.officeCandidates.length > 0)) {
      
      const needsVerification = 
        (result.clientCandidates.length > 0 && (!result.clientMatch || result.clientMatch.similarity_score < 0.8)) ||
        (result.officeCandidates.length > 0 && (!result.officeMatch || result.officeMatch.similarity_score < 0.8));

      if (needsVerification) {
        console.log("Verifying matches with LLM...");

        const verificationPrompt = `Porównaj dane wyciągnięte z dokumentu z kandydatami z bazy danych i wybierz najlepsze dopasowania.

DANE Z DOKUMENTU:
- Nazwa firmy: ${data.companyName || "brak"}
- Nazwa firmy (znormalizowana): ${data.companyNameNormalized || "brak"}
- Nazwa urzędu: ${data.officeName || "brak"}
- Nazwa urzędu (znormalizowana): ${data.officeNameNormalized || "brak"}

KANDYDACI - FIRMY:
${result.clientCandidates.map((c, i) => `${i + 1}. "${c.name}" (podobieństwo: ${(c.similarity_score * 100).toFixed(1)}%)`).join("\n") || "Brak kandydatów"}

KANDYDACI - URZĘDY:
${result.officeCandidates.map((o, i) => `${i + 1}. "${o.name}" (podobieństwo: ${(o.similarity_score * 100).toFixed(1)}%)`).join("\n") || "Brak kandydatów"}

Odpowiedz w formacie JSON:
{
  "bestClientIndex": null lub numer (1-5) najlepszego dopasowania firmy,
  "clientConfidence": 0.0-1.0 pewność dopasowania firmy,
  "bestOfficeIndex": null lub numer (1-5) najlepszego dopasowania urzędu,
  "officeConfidence": 0.0-1.0 pewność dopasowania urzędu,
  "reasoning": "krótkie uzasadnienie"
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

              // Update matches based on LLM verification
              if (verification.bestClientIndex && verification.clientConfidence >= 0.6) {
                const idx = verification.bestClientIndex - 1;
                if (idx >= 0 && idx < result.clientCandidates.length) {
                  const candidate = result.clientCandidates[idx];
                  // Fetch full client data
                  const { data: fullClient } = await supabase
                    .from("clients")
                    .select("*")
                    .eq("id", candidate.id)
                    .single();
                  
                  if (fullClient) {
                    result.clientMatch = {
                      ...fullClient,
                      similarity_score: candidate.similarity_score,
                    };
                  }
                }
              }

              if (verification.bestOfficeIndex && verification.officeConfidence >= 0.6) {
                const idx = verification.bestOfficeIndex - 1;
                if (idx >= 0 && idx < result.officeCandidates.length) {
                  const candidate = result.officeCandidates[idx];
                  // Fetch full office data
                  const { data: fullOffice } = await supabase
                    .from("offices")
                    .select("*")
                    .eq("id", candidate.id)
                    .single();
                  
                  if (fullOffice) {
                    result.officeMatch = {
                      ...fullOffice,
                      similarity_score: candidate.similarity_score,
                    };
                  }
                }
              }

              result.llmVerified = true;
            }
          }
        } catch (llmError) {
          console.error("LLM verification error:", llmError);
        }
      }
    }

    // Calculate overall match confidence
    const clientScore = result.clientMatch?.similarity_score || 0;
    const officeScore = result.officeMatch?.similarity_score || 0;
    const hasClient = result.clientMatch !== null;
    const hasOffice = result.officeMatch !== null;
    
    if (hasClient && hasOffice) {
      result.matchConfidence = (clientScore + officeScore) / 2;
    } else if (hasClient) {
      result.matchConfidence = clientScore * 0.7;
    } else if (hasOffice) {
      result.matchConfidence = officeScore * 0.5;
    }

    // Update ocr_documents if ID provided
    if (ocrDocumentId) {
      console.log("Updating ocr_documents with match results:", ocrDocumentId);

      const updateData: any = {
        status: "matching",
        confidence_score: result.matchConfidence,
        updated_at: new Date().toISOString(),
      };

      if (result.clientMatch) {
        updateData.matched_client_id = result.clientMatch.id;
      }
      if (result.officeMatch) {
        updateData.matched_office_id = result.officeMatch.id;
      }

      const { error: updateError } = await supabase
        .from("ocr_documents")
        .update(updateData)
        .eq("id", ocrDocumentId);

      if (updateError) {
        console.error("Failed to update ocr_documents:", updateError);
      }
    }

    console.log("Match completed. Client:", result.clientMatch?.name, "Office:", result.officeMatch?.name);

    return new Response(JSON.stringify({
      success: true,
      data: result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in ocr-match-database function:', error);
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
