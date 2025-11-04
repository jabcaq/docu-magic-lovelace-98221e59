import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to safely find and replace text in HTML content only (not in tags)
function safeReplaceInHTML(html: string, searchText: string, replacement: string): { success: boolean; html: string } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    if (!doc || !doc.body) {
      return { success: false, html };
    }

    let found = false;

    // Recursively process text nodes
    function processNode(node: any): void {
      if (found) return; // Stop after first match
      
      if (node.nodeType === 3) { // Text node
        const text = node.textContent;
        if (text && text.includes(searchText)) {
          // Create a temporary div to parse the replacement HTML
          const tempDiv = doc!.createElement('div');
          tempDiv.innerHTML = text.replace(searchText, replacement);
          
          // Replace the text node with the new content
          const parent = node.parentNode;
          while (tempDiv.firstChild) {
            parent.insertBefore(tempDiv.firstChild, node);
          }
          parent.removeChild(node);
          found = true;
          return;
        }
      }
      
      // Skip style and script tags
      if (node.nodeType === 1 && (node.tagName === 'STYLE' || node.tagName === 'SCRIPT')) {
        return;
      }
      
      // Process child nodes
      if (node.childNodes) {
        // Create array copy since we might modify the tree
        const children = Array.from(node.childNodes);
        for (const child of children) {
          processNode(child);
          if (found) return;
        }
      }
    }

    processNode(doc.body);

    if (!found) {
      return { success: false, html };
    }

    return { success: true, html: doc.body.innerHTML };
  } catch (error) {
    console.error("Error in safeReplaceInHTML:", error);
    return { success: false, html };
  }
}

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
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
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
            content: `Analyze this document and identify all variable fields that should be tagged. Return suggestions as a JSON array.

Document content:
${textContent}

Return format:
{
  "suggestions": [
    {
      "text": "exact text from document (minimum 3 characters)",
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
    
    console.log(`Found ${filteredSuggestions.length} valid suggestions (filtered from ${suggestions.length})`);

    // Now automatically apply these suggestions to the HTML
    let html = document.html_content;
    let appliedCount = 0;

    for (const suggestion of filteredSuggestions) {
      const { text, variableName } = suggestion;
      
      const fieldId = crypto.randomUUID();
      const tag = `{{${variableName}}}`;
      
      const replacement = `<span class="doc-variable" data-field-id="${fieldId}" data-tag="${tag}">${text}<span class="doc-tag-badge">${tag}</span></span>`;
      
      const result = safeReplaceInHTML(html, text, replacement);
      
      if (result.success) {
        html = result.html;
        
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
        console.log(`Applied: ${variableName} = "${text}"`);
      } else {
        console.log(`Skipped: ${variableName} = "${text}" (not found in content)`);
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

    console.log(`Applied ${appliedCount} of ${filteredSuggestions.length} suggestions`);

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