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

    console.log("Total runs found:", runs?.length);
    console.log("First 5 runs:", runs?.slice(0, 5).map(r => ({ 
      id: r.id.substring(0, 8), 
      text: r.text?.substring(0, 60), 
      hasTag: !!r.tag,
      type: r.type
    })));

    // Normalize whitespace in selected text for comparison
    const normalizedSelection = selectedText.trim().replace(/\s+/g, ' ');
    
    // Find the run that contains the selected text (with flexible whitespace matching)
    const matchingRun = runs?.find(run => {
      if (!run.text) return false;
      
      // Normalize whitespace in run text for comparison
      const normalizedRunText = run.text.trim().replace(/\s+/g, ' ');
      
      // Check if run text contains the selection
      const contains = normalizedRunText.includes(normalizedSelection);
      
      // Also check if selection contains the run text (for smaller fragments)
      const isContained = normalizedSelection.includes(normalizedRunText);
      
      return contains || isContained;
    });

    console.log("Searching for:", normalizedSelection);
    console.log("Match found:", matchingRun ? {
      id: matchingRun.id.substring(0, 8),
      text: matchingRun.text?.substring(0, 100),
      hasTag: !!matchingRun.tag
    } : "NO MATCH");

    if (!matchingRun) {
      // Log all runs for debugging
      console.error("Could not find match. All runs:");
      runs?.forEach((run, idx) => {
        console.error(`Run ${idx}:`, {
          text: run.text?.substring(0, 100),
          hasTag: !!run.tag,
          type: run.type
        });
      });
      throw new Error(`Could not find text "${selectedText}" in document. The text might be part of a larger segment or generated during rendering.`);
    }

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
