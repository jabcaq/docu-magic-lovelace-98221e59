import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to safely find and replace text in OpenXML document.xml
function safeReplaceInXML(
  xmlContent: string, 
  searchText: string, 
  fieldId: string, 
  tag: string
): { success: boolean; xml: string } {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/html");
    
    if (!xmlDoc) {
      return { success: false, xml: xmlContent };
    }

    let found = false;

    // Find all w:t elements and search for the text
    const textNodes = xmlDoc.getElementsByTagName("w:t");
    
    for (let i = 0; i < textNodes.length; i++) {
      const textNode = textNodes[i];
      const text = textNode.textContent || "";
      
      if (text.includes(searchText)) {
        // Mark this run with custom XML attributes for field tracking
        const run = textNode.parentElement; // w:r
        if (run) {
          // Add custom attributes to the run for field identification
          run.setAttribute("w:rsidRPr", fieldId);
          run.setAttribute("data-field-id", fieldId);
          run.setAttribute("data-tag", tag);
          
          // Replace text content with the tag
          textNode.textContent = tag;
          
          found = true;
          break;
        }
      }
    }

    if (!found) {
      return { success: false, xml: xmlContent };
    }

    // Serialize back to XML string
    const newXml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" + xmlDoc.documentElement!.outerHTML;

    return { success: true, xml: newXml };
  } catch (error) {
    console.error("Error in safeReplaceInXML:", error);
    return { success: false, xml: xmlContent };
  }
}

// Old HTML function - kept for backwards compatibility
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
      // Parse XML to extract text
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(document.xml_content, "text/html");
      
      if (!xmlDoc) {
        throw new Error("Failed to parse XML");
      }
      
      const textNodes = xmlDoc.getElementsByTagName("w:t");
      for (let i = 0; i < textNodes.length; i++) {
        const text = textNodes[i].textContent?.trim();
        if (text) {
          runsForAI.push({ text });
        }
      }
    }

    console.log(`Processing ${runsForAI.length} runs for AI analysis`);

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
    
    console.log(`Found ${filteredSuggestions.length} valid suggestions (filtered from ${suggestions.length})`);

    // Now automatically apply these suggestions to the XML
    let xml = document.xml_content;
    let appliedCount = 0;

    for (const suggestion of filteredSuggestions) {
      const { text, variableName } = suggestion;
      
      // Find the matching run to get formatting
      const matchingRun = runsForAI.find(r => r.text.includes(text));
      const formatting = matchingRun?.formatting || {};
      
      const fieldId = crypto.randomUUID();
      const tag = `{{${variableName}}}`;
      
      const result = safeReplaceInXML(xml, text, fieldId, tag);
      
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
        console.log(`Applied: ${variableName} = "${text}" with formatting:`, formatting);
      } else {
        console.log(`Skipped: ${variableName} = "${text}" (not found in content)`);
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