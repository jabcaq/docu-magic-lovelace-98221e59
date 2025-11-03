import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Invalid token");
    }

    const { documentId, templateName } = await req.json();

    if (!documentId) {
      throw new Error("Missing documentId");
    }

    console.log(`Creating template from document ${documentId}`);

    // Get document
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    // Get all runs for this document
    const { data: runs, error: runsError } = await supabase
      .from("document_runs")
      .select("*")
      .eq("document_id", documentId)
      .order("run_index");

    if (runsError) {
      throw runsError;
    }

    // Build tag metadata
    const tagMetadata: { [key: string]: string } = {};
    runs?.forEach((run) => {
      if (run.tag) {
        tagMetadata[run.tag] = run.text;
      }
    });

    // Create template record
    const { data: template, error: templateError } = await supabase
      .from("templates")
      .insert({
        user_id: user.id,
        name: templateName || `${document.name} - Template`,
        original_document_id: documentId,
        storage_path: document.storage_path.replace(".docx", "_template.docx"),
        tag_metadata: tagMetadata,
      })
      .select()
      .single();

    if (templateError) {
      throw templateError;
    }

    // Update document with template reference
    await supabase
      .from("documents")
      .update({ 
        template_id: template.id,
        status: "verified"
      })
      .eq("id", documentId);

    console.log(`Template created: ${template.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          tagCount: Object.keys(tagMetadata).length,
          tags: Object.keys(tagMetadata),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in create-template:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
