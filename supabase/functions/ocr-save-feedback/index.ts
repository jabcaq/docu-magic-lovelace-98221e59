import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FeedbackData {
  templateId: string;
  ocrDocumentId?: string;
  matchedFields: Array<{
    templateTag: string;
    ocrTag: string;
    ocrValue: string;
  }>;
  manualCorrections: Record<string, string>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const body: FeedbackData = await req.json();
    const { templateId, ocrDocumentId, matchedFields, manualCorrections } = body;

    if (!templateId) {
      throw new Error("templateId is required");
    }

    console.log("Saving feedback for template:", templateId);
    console.log("Matched fields:", matchedFields?.length || 0);
    console.log("Manual corrections:", Object.keys(manualCorrections || {}).length);

    // Build tag_value_map from matched fields and manual corrections
    const tagValueMap: Record<string, string> = {};
    
    // Add auto-matched fields
    for (const field of matchedFields || []) {
      if (field.templateTag && field.ocrValue) {
        tagValueMap[field.templateTag] = field.ocrValue;
      }
    }
    
    // Add/override with manual corrections
    for (const [tag, value] of Object.entries(manualCorrections || {})) {
      if (value && value.trim()) {
        tagValueMap[tag] = value.trim();
      }
    }

    // Only save if we have actual data
    if (Object.keys(tagValueMap).length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No data to save",
          saved: false 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if example already exists for this template + OCR document
    let existingExample = null;
    if (ocrDocumentId) {
      const { data: existing } = await supabase
        .from("template_examples")
        .select("id, tag_value_map, corrections_applied")
        .eq("template_id", templateId)
        .eq("source_ocr_document_id", ocrDocumentId)
        .maybeSingle();
      
      existingExample = existing;
    }

    if (existingExample) {
      // Update existing example
      const existingTagValueMap = existingExample.tag_value_map as Record<string, string> || {};
      const existingCorrections = existingExample.corrections_applied as Record<string, string> || {};
      
      const { error: updateError } = await supabase
        .from("template_examples")
        .update({
          tag_value_map: { ...existingTagValueMap, ...tagValueMap },
          corrections_applied: { ...existingCorrections, ...manualCorrections },
        })
        .eq("id", existingExample.id);

      if (updateError) {
        console.error("Error updating template_example:", updateError);
        throw updateError;
      }

      console.log("Updated existing template_example:", existingExample.id);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Feedback updated",
          exampleId: existingExample.id,
          saved: true,
          updated: true,
          fieldsCount: Object.keys(tagValueMap).length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert new example
    const { data: newExample, error: insertError } = await supabase
      .from("template_examples")
      .insert({
        template_id: templateId,
        source_ocr_document_id: ocrDocumentId || null,
        tag_value_map: tagValueMap,
        corrections_applied: manualCorrections || {},
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Error inserting template_example:", insertError);
      throw insertError;
    }

    console.log("Created new template_example:", newExample.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Feedback saved",
        exampleId: newExample.id,
        saved: true,
        updated: false,
        fieldsCount: Object.keys(tagValueMap).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in ocr-save-feedback:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
