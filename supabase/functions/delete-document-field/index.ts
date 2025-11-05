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

    const { fieldId, documentId } = await req.json();

    console.log("Deleting field:", fieldId, "from document:", documentId);

    // Get the field details before deletion
    const { data: field, error: fieldError } = await supabase
      .from("document_fields")
      .select("field_tag")
      .eq("id", fieldId)
      .single();

    if (fieldError) throw fieldError;

    // Delete the field from database
    const { error: deleteError } = await supabase
      .from("document_fields")
      .delete()
      .eq("id", fieldId);

    if (deleteError) throw deleteError;

    // Get document HTML to remove the tag
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("html_content")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    // Remove the span tag and keep just the text content
    const tagPattern = new RegExp(
      `<span[^>]*data-field-id=\\"${fieldId}\\"[^>]*>(.*?)</span>`,
      "gi"
    );
    const updatedHtml = document.html_content.replace(tagPattern, "$1");

    // Update document HTML
    const { error: updateError } = await supabase
      .from("documents")
      .update({ html_content: updatedHtml })
      .eq("id", documentId);

    if (updateError) throw updateError;

    console.log("Field deleted successfully");

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in delete-document-field:", error);
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
