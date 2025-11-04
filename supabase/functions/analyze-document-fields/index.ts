import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Get document HTML
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("html_content, name")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    // Strip HTML tags for AI analysis
    const textContent = document.html_content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log("Text content length:", textContent.length);

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
1. Identify dynamic content that changes between document instances (names, dates, numbers, addresses, IDs, etc.)
2. Suggest clear, descriptive variable names in English using camelCase
3. Return EXACT text fragments and their suggested variable names

Rules:
- Only identify content that would change between different document instances
- Don't tag static text, labels, or boilerplate content
- Variable names should be descriptive (e.g., "customerName", "invoiceDate", "totalAmount")
- Return exact text as it appears in the document`
          },
          {
            role: "user",
            content: `Analyze this document and identify all variable fields that should be tagged. Return suggestions as a JSON array.

Document content:
${textContent}

Return format:
{
  "suggestions": [
    {
      "text": "exact text from document",
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
                        text: { type: "string", description: "Exact text from document" },
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
    
    console.log(`Found ${suggestions.length} suggestions`);

    // Now automatically apply these suggestions to the HTML
    let html = document.html_content;
    let appliedCount = 0;

    for (const suggestion of suggestions) {
      const { text, variableName } = suggestion;
      
      // Escape special regex characters
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Find text that's not already wrapped
      const regex = new RegExp(`(?<!<span[^>]*>)${escapedText}(?![^<]*<\\/span>)`, 'gi');
      
      if (regex.test(html)) {
        const fieldId = crypto.randomUUID();
        const tag = `{{${variableName}}}`;
        
        const replacement = `<span class="doc-variable" data-field-id="${fieldId}" data-tag="${tag}">${text}<span class="doc-tag-badge">${tag}</span></span>`;
        
        html = html.replace(regex, replacement);
        
        // Save to document_fields
        const position = html.indexOf(replacement);
        await supabase.from("document_fields").insert({
          document_id: documentId,
          field_name: variableName,
          field_value: text,
          field_tag: tag,
          position_in_html: position,
        });
        
        appliedCount++;
      }
    }

    // Update document with tagged HTML
    await supabase
      .from("documents")
      .update({ 
        html_content: html,
        status: "verified" // Mark as ready for verification
      })
      .eq("id", documentId);

    console.log(`Applied ${appliedCount} of ${suggestions.length} suggestions`);

    return new Response(
      JSON.stringify({
        success: true,
        suggestions: suggestions,
        appliedCount: appliedCount,
        totalSuggestions: suggestions.length
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
