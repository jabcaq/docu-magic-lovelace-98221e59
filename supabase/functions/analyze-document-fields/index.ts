import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replace first occurrence of searchText inside <w:t> nodes only
function replaceInWT(xml: string, searchText: string, replacement: string): { success: boolean; xml: string } {
  let replaced = false;
  const wtRegex = /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  const newXml = xml.replace(wtRegex, (full, open, content, close) => {
    if (replaced) return full;
    const idx = content.indexOf(searchText);
    if (idx === -1) return full;
    replaced = true;
    const updated = content.slice(0, idx) + replacement + content.slice(idx + searchText.length);
    return `${open}${updated}${close}`;
  });
  return { success: replaced, xml: newXml };
}
// (HTML replacement helper removed - XML is handled via replaceInWT)

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { documentId } = await req.json();

    console.log("Analyzing document:", documentId);

    // Get document XML and type
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("xml_content, name, type, runs_metadata")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    if (!document.xml_content) {
      throw new Error("Document has no XML content");
    }

    // Extract text from XML runs for AI analysis
    let runsForAI: Array<{ text: string; formatting?: any }> = [];
    
    if (document.runs_metadata && Array.isArray(document.runs_metadata) && document.runs_metadata.length > 0) {
      console.log("Using OpenXML runs from metadata");
      runsForAI = document.runs_metadata;
    } else {
      // Extract plain text runs from XML by reading <w:t>
      const matches = Array.from(document.xml_content.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) as RegExpMatchArray[];
      const texts = matches
        .map(m => m[1]?.trim())
        .filter(Boolean) as string[];
      runsForAI = texts.map(t => ({ text: t }));
    }

    console.log(`Processing ${runsForAI.length} runs for AI analysis`);
    
    // Log first few runs with formatting for debugging
    console.log("Sample runs (first 5):");
    runsForAI.slice(0, 5).forEach((run, idx) => {
      console.log(`  Run ${idx + 1}:`, {
        text: run.text,
        formatting: run.formatting || 'none'
      });
    });

    // Call Lovable AI to analyze and suggest fields
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an AI assistant that analyzes documents and identifies variable fields that should be replaced with placeholders. 
            
Your task:
1. Identify dynamic content that changes between document instances (names, dates, numbers, addresses, IDs, VINs, plate numbers, etc.)
2. Suggest clear, descriptive variable names in English using camelCase
3. Return EXACT text fragments (at least 3 characters long) and their suggested variable names

Rules:
- Only identify content that would change between different document instances
- Don't tag static text, labels, or boilerplate content
- Don't tag single characters or very short fragments (minimum 3 characters)
- Variable names should be descriptive (e.g., "customerName", "invoiceDate", "totalAmount", "vinNumber")
- Return exact text as it appears in the document
- Prioritize longer, more specific text fragments over short generic ones`
          },
          {
            role: "user",
            content: `Analyze these text runs and identify which ones contain variable data that should be tagged. 
            
Runs:
${JSON.stringify(runsForAI, null, 2)}

Return format:
{
  "suggestions": [
    {
      "text": "exact text from run (minimum 3 characters)",
      "variableName": "suggestedVariableName",
      "category": "name|date|number|address|id|other"
    }
  ]
}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_document_fields",
              description: "Return suggested variable fields found in the document",
              parameters: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        text: { type: "string", description: "Exact text from document (minimum 3 characters)" },
                        variableName: { type: "string", description: "Suggested variable name in camelCase" },
                        category: { 
                          type: "string", 
                          enum: ["name", "date", "number", "address", "id", "other"],
                          description: "Category of the field"
                        }
                      },
                      required: ["text", "variableName", "category"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["suggestions"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "suggest_document_fields" } }
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }
      if (aiResponse.status === 402) {
        throw new Error("Payment required. Please add credits to your workspace.");
      }
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json();
    console.log("AI response:", JSON.stringify(aiData, null, 2));

    // Extract suggestions from tool call
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("AI did not return suggestions");
    }

    const suggestions = JSON.parse(toolCall.function.arguments).suggestions;
    
    // Filter out suggestions that are too short
    const filteredSuggestions = suggestions.filter((s: any) => s.text.length >= 3);
    
    console.log(`\n📊 AI ANALYSIS RESULTS:`);
    console.log(`   Total suggestions: ${suggestions.length}`);
    console.log(`   Valid suggestions (>= 3 chars): ${filteredSuggestions.length}`);
    console.log(`\n💡 AI SUGGESTIONS:`);
    filteredSuggestions.forEach((s: any, idx: number) => {
      console.log(`   ${idx + 1}. [${s.category}] "${s.text}" → {{${s.variableName}}}`);
    });

    // Now automatically apply these suggestions to the XML
    let xml = document.xml_content;
    let appliedCount = 0;
    const appliedFields: any[] = [];
    const skippedFields: any[] = [];

    console.log(`\n🔄 APPLYING SUGGESTIONS TO XML:`);

    for (const suggestion of filteredSuggestions) {
      const { text, variableName, category } = suggestion;
      
      // Find the matching run to get formatting
      const matchingRun = runsForAI.find(r => r.text.includes(text));
      const formatting = matchingRun?.formatting || {};
      
      const fieldId = crypto.randomUUID();
      const tag = `{{${variableName}}}`;
      
      console.log(`   Attempting: "${text}" → ${tag}`);
      
      const result = replaceInWT(xml, text, tag);
      
      if (result.success) {
        xml = result.xml;
        
        // Save to document_fields with formatting
        await supabase.from("document_fields").insert({
          document_id: documentId,
          field_name: variableName,
          field_value: text,
          field_tag: tag,
          position_in_html: appliedCount, // Sequential position
          run_formatting: formatting,
        });
        
        appliedCount++;
        appliedFields.push({ text, tag, formatting, category });
        console.log(`   ✅ Success! Applied with formatting:`, formatting);
      } else {
        skippedFields.push({ text, tag, category, reason: 'not found in XML' });
        console.log(`   ❌ Skipped: not found in XML content`);
      }
    }

    // Update document with tagged XML and clear HTML cache
    await supabase
      .from("documents")
      .update({ 
        xml_content: xml,
        html_cache: null, // Force regeneration
        status: "verified" // Mark as ready for verification
      })
      .eq("id", documentId);

    console.log(`\n📈 SUMMARY:`);
    console.log(`   ✅ Applied: ${appliedCount} fields`);
    console.log(`   ❌ Skipped: ${skippedFields.length} fields`);
    
    if (appliedFields.length > 0) {
      console.log(`\n✨ Successfully applied fields:`);
      appliedFields.forEach(f => {
        console.log(`   • ${f.tag} [${f.category}]`);
      });
    }
    
    if (skippedFields.length > 0) {
      console.log(`\n⚠️  Skipped fields:`);
      skippedFields.forEach(f => {
        console.log(`   • ${f.tag} [${f.category}] - ${f.reason}`);
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        suggestions: filteredSuggestions,
        appliedCount: appliedCount,
        totalSuggestions: filteredSuggestions.length
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in analyze-document-fields:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});