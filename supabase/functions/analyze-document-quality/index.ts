import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
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

    console.log("Analyzing document quality:", documentId);

    // Get document XML and fields
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("xml_content, name")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    if (!document.xml_content) {
      throw new Error("Document has no XML content");
    }

    // Get all existing fields
    const { data: fields, error: fieldsError } = await supabase
      .from("document_fields")
      .select("*")
      .eq("document_id", documentId);

    if (fieldsError) {
      throw new Error("Failed to fetch document fields");
    }

    // Extract all text from XML
    const matches = Array.from(document.xml_content.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) as RegExpMatchArray[];
    const allText = matches
      .map(m => m[1]?.trim())
      .filter(Boolean)
      .join(" ");

    console.log(`Analyzing ${fields?.length || 0} existing fields against document text`);

    // Call AI to analyze quality
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
            content: `You are a quality assurance expert for automotive document templates. Your task is to analyze existing variable mappings and identify issues.

CRITICAL ISSUES TO DETECT:

1. DUPLICATE VARIABLES (same value, different variable names):
   - Example: {{vinNumber}} = "ABC123" and {{vinNumberSecond}} = "ABC123"
   - Suggestion: Use only {{vinNumber}} in both places
   
2. INCOMPLETE VALUES (missing parts of data):
   - Example: {{agentStreet}} = "SMOORSTRAAT" but building number "24" is hardcoded
   - Suggestion: {{agentStreet}} should be "SMOORSTRAAT 24"
   
3. HARDCODED VALUES (data that should be variables):
   - Example: "BAUM ANDRZEJ" appears in text but no variable exists
   - Suggestion: Create {{importerName}} = "BAUM ANDRZEJ"
   
4. INCONSISTENT NAMING:
   - Example: {{date1}}, {{date2}} vs {{firstRegistrationDate}}
   - Suggestion: Use descriptive names consistently

Your response format:
{
  "issues": [
    {
      "type": "duplicate|incomplete|hardcoded|naming",
      "severity": "high|medium|low",
      "description": "Clear explanation of the issue",
      "currentState": "What exists now",
      "suggestion": "How to fix it",
      "affectedVariables": ["{{var1}}", "{{var2}}"]
    }
  ],
  "summary": {
    "totalIssues": 0,
    "highSeverity": 0,
    "mediumSeverity": 0,
    "lowSeverity": 0
  }
}`
          },
          {
            role: "user",
            content: `Analyze the quality of these variable mappings for an automotive document.

Document name: ${document.name}

Existing variables:
${JSON.stringify(fields?.map(f => ({
  tag: f.field_tag,
  name: f.field_name,
  value: f.field_value
})), null, 2)}

Document text sample (first 2000 chars):
${allText.substring(0, 2000)}

Identify:
1. Duplicate variables (same value with different names)
2. Incomplete values (e.g., address without building number)
3. Hardcoded values that should be variables
4. Naming inconsistencies`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "analyze_quality",
              description: "Return quality analysis of document variable mappings",
              parameters: {
                type: "object",
                properties: {
                  issues: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { 
                          type: "string", 
                          enum: ["duplicate", "incomplete", "hardcoded", "naming"],
                          description: "Type of issue found"
                        },
                        severity: { 
                          type: "string", 
                          enum: ["high", "medium", "low"],
                          description: "Impact severity"
                        },
                        description: { type: "string", description: "Clear explanation" },
                        currentState: { type: "string", description: "Current situation" },
                        suggestion: { type: "string", description: "How to fix" },
                        affectedVariables: { 
                          type: "array", 
                          items: { type: "string" },
                          description: "Variables involved"
                        }
                      },
                      required: ["type", "severity", "description", "currentState", "suggestion", "affectedVariables"],
                      additionalProperties: false
                    }
                  },
                  summary: {
                    type: "object",
                    properties: {
                      totalIssues: { type: "number" },
                      highSeverity: { type: "number" },
                      mediumSeverity: { type: "number" },
                      lowSeverity: { type: "number" }
                    },
                    required: ["totalIssues", "highSeverity", "mediumSeverity", "lowSeverity"],
                    additionalProperties: false
                  }
                },
                required: ["issues", "summary"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "analyze_quality" } }
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
    console.log("AI quality analysis response:", JSON.stringify(aiData, null, 2));

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("AI did not return quality analysis");
    }

    const analysis = JSON.parse(toolCall.function.arguments);
    
    console.log(`\n📊 QUALITY ANALYSIS RESULTS:`);
    console.log(`   Total issues found: ${analysis.summary.totalIssues}`);
    console.log(`   High severity: ${analysis.summary.highSeverity}`);
    console.log(`   Medium severity: ${analysis.summary.mediumSeverity}`);
    console.log(`   Low severity: ${analysis.summary.lowSeverity}`);
    
    if (analysis.issues.length > 0) {
      console.log(`\n⚠️  ISSUES DETECTED:`);
      analysis.issues.forEach((issue: any, idx: number) => {
        console.log(`   ${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.type}`);
        console.log(`      ${issue.description}`);
        console.log(`      Suggestion: ${issue.suggestion}`);
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in analyze-document-quality:", error);
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
