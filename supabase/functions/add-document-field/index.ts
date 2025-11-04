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

    const { documentId, selectedText, tagName } = await req.json();

    console.log("Adding field:", { documentId, selectedText, tagName });

    // Verify user owns the document
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found or access denied");
    }

    // Find the run that contains this text
    const { data: runs, error: runsError } = await supabase
      .from("document_runs")
      .select("*")
      .eq("document_id", documentId)
      .order("run_index", { ascending: true });

    if (runsError) throw runsError;

    // Find the run that contains the selected text
    const matchingRun = runs?.find(run => 
      run.text && run.text.includes(selectedText.trim())
    );

    if (!matchingRun) {
      console.error("Available runs:", runs?.map(r => ({ id: r.id, text: r.text?.substring(0, 50), hasTag: !!r.tag })));
      throw new Error(`Could not find text "${selectedText}" in document`);
    }

    console.log("Found matching run:", { id: matchingRun.id, text: matchingRun.text, currentTag: matchingRun.tag });

    // Check if this run already has a tag
    if (matchingRun.tag) {
      throw new Error("This text segment already has a tag");
    }

    // Update the run with the new tag
    const newTag = `{{${tagName}}}`;
    const { error: updateError } = await supabase
      .from("document_runs")
      .update({ tag: newTag })
      .eq("id", matchingRun.id);

    if (updateError) throw updateError;

    console.log("Successfully added tag to run:", matchingRun.id);

    // Return the updated run ID and tag
    return new Response(
      JSON.stringify({ 
        success: true,
        fieldId: matchingRun.id,
        tag: newTag,
        text: matchingRun.text
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in add-document-field:", error);
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
