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
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
      },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { documentId } = await req.json();

    console.log("Rendering document:", documentId);

    // Get document with HTML content
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("html_content")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    if (!document.html_content) {
      throw new Error("Document has no HTML content");
    }

    // Get all document fields to replace values with tags for preview
    const { data: fields, error: fieldsError } = await supabase
      .from("document_fields")
      .select("id, field_tag")
      .eq("document_id", documentId);

    if (fieldsError) throw fieldsError;

    console.log("Document HTML length:", document.html_content.length);
    console.log("Found fields:", fields?.length || 0);

    // Replace field spans with their tags in {{}} format for preview
    let previewHtml = document.html_content;
    
    if (fields && fields.length > 0) {
      for (const field of fields) {
        // Find and replace the span content with the tag
        const spanPattern = new RegExp(
          `(<span[^>]*data-field-id="${field.id}"[^>]*>)[^<]*(</span>)`,
          "gi"
        );
        previewHtml = previewHtml.replace(spanPattern, `$1${field.field_tag}$2`);
        
        console.log(`Replaced field ${field.id} content with tag: ${field.field_tag}`);
      }
    }

    return new Response(
      JSON.stringify({ 
        html: previewHtml
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in render-document:", error);
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
