import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import JSZip from "https://esm.sh/jszip@3.10.1";

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
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { documentId } = await req.json();

    if (!documentId) {
      throw new Error("documentId is required");
    }

    console.log("Analyzing document with XML AI approach:", documentId);

    // Fetch document from database
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("storage_path, type")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError || !fileData) {
      throw new Error("Failed to download document");
    }

    console.log("File downloaded, extracting XML...");

    // Extract document.xml from docx
    const arrayBuffer = await fileData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const documentXml = zip.file("word/document.xml");
    
    if (!documentXml) {
      throw new Error("document.xml not found in the Word file");
    }

    const xmlContent = await documentXml.async("text");
    console.log("XML extracted, length:", xmlContent.length);

    // Send XML to AI for analysis
    console.log("Sending XML to Lovable AI for analysis...");
    
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a document analysis assistant. Your task is to analyze Word document XML and identify all template fields (marked with {{...}} notation). 
            
Extract each field with:
- The exact tag name (what's inside {{}})
- The surrounding text context
- Position information

Return a JSON object with an array of fields, each containing:
{
  "tag": "fieldName",
  "label": "Descriptive label for this field",
  "context": "Surrounding text for context",
  "suggestedValue": ""
}

Focus on finding all {{...}} patterns in the XML text content.`
          },
          {
            role: "user",
            content: `Analyze this Word document XML and extract all template fields:\n\n${xmlContent.slice(0, 50000)}` // Limit to first 50k chars
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content;
    
    if (!aiContent) {
      throw new Error("No content returned from AI");
    }

    console.log("AI analysis completed, parsing results...");

    // Parse AI response (expecting JSON)
    let fields;
    try {
      // Try to extract JSON from the response (AI might wrap it in markdown)
      const jsonMatch = aiContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                        aiContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : aiContent;
      const parsed = JSON.parse(jsonStr);
      fields = Array.isArray(parsed) ? parsed : (parsed.fields || []);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", parseError);
      console.log("AI response:", aiContent);
      throw new Error("Failed to parse AI analysis results");
    }

    console.log(`Extracted ${fields.length} fields from AI analysis`);

    // Store XML content in document
    const { error: updateError } = await supabase
      .from("documents")
      .update({ 
        xml_content: xmlContent,
        analysis_approach: 'xml_ai'
      })
      .eq("id", documentId);

    if (updateError) {
      console.error("Failed to update document with XML:", updateError);
      throw updateError;
    }

    // Insert fields into document_fields table
    if (fields.length > 0) {
      const fieldsToInsert = fields.map((field: any, index: number) => ({
        document_id: documentId,
        field_tag: field.tag,
        field_name: field.label || field.tag,
        field_value: field.suggestedValue || "",
        position_in_html: index,
      }));

      const { error: fieldsError } = await supabase
        .from("document_fields")
        .insert(fieldsToInsert);

      if (fieldsError) {
        console.error("Failed to insert fields:", fieldsError);
        throw fieldsError;
      }
    }

    // Render document HTML
    console.log("Rendering document HTML...");
    const renderResponse = await supabase.functions.invoke("render-document", {
      body: { documentId },
    });

    if (renderResponse.error) {
      console.error("Failed to render document:", renderResponse.error);
    }

    return new Response(
      JSON.stringify({
        success: true,
        fields,
        count: fields.length,
        approach: 'xml_ai'
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error analyzing document with XML AI:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({
        error: errorMessage,
        success: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
