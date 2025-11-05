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
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { fieldId, documentId, newLabel, newTag } = await req.json();

    console.log("Updating field:", fieldId, "with label:", newLabel, "and tag:", newTag);

    // Get the current field data
    const { data: field, error: fieldError } = await supabase
      .from("document_fields")
      .select("field_tag")
      .eq("id", fieldId)
      .single();

    if (fieldError) throw fieldError;

    const oldTag = field.field_tag;

    // Update the field in database
    const { error: updateFieldError } = await supabase
      .from("document_fields")
      .update({
        field_name: newLabel,
        field_tag: newTag,
      })
      .eq("id", fieldId);

    if (updateFieldError) throw updateFieldError;

    // Get document HTML to update the tag
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("html_content")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    // Update the tag in the HTML
    const tagPattern = new RegExp(
      `(<span[^>]*data-field-id="${fieldId}"[^>]*data-tag=")[^"]*(".*?>)`,
      "gi"
    );
    const updatedHtml = document.html_content.replace(tagPattern, `$1${newTag}$2`);

    // Update document HTML
    const { error: updateDocError } = await supabase
      .from("documents")
      .update({ html_content: updatedHtml })
      .eq("id", documentId);

    if (updateDocError) throw updateDocError;

    console.log("Field updated successfully");

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in update-document-field:", error);
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
