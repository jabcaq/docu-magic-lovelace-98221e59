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

    // Get document HTML
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("html_content")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found or access denied");
    }

    let html = document.html_content;
    if (!html) {
      throw new Error("Document has no HTML content");
    }

    // Normalize whitespace in selected text
    const normalizedSelection = selectedText.trim().replace(/\s+/g, ' ');
    
    // Find the text in HTML (outside of existing tags)
    // Use regex to find text that's not already wrapped in doc-variable
    const escapedText = normalizedSelection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<!<span[^>]*>)${escapedText}(?![^<]*<\\/span>)`, 'i');
    
    if (!regex.test(html)) {
      console.error("Could not find text in HTML:", normalizedSelection);
      throw new Error(`Could not find text "${selectedText}" in document. Make sure it's not already tagged.`);
    }

    // Generate unique field ID
    const fieldId = crypto.randomUUID();
    const tag = `{{${tagName}}}`;

    // Wrap the selected text in a span with field ID
    const replacement = `<span class="doc-variable" data-field-id="${fieldId}" data-tag="${tag}">${normalizedSelection}<span class="doc-tag-badge">${tag}</span></span>`;
    
    html = html.replace(regex, replacement);

    // Update document HTML
    const { error: updateError } = await supabase
      .from("documents")
      .update({ html_content: html })
      .eq("id", documentId);

    if (updateError) throw updateError;

    // Create field record
    const position = html.indexOf(replacement);
    const { error: fieldError } = await supabase
      .from("document_fields")
      .insert({
        document_id: documentId,
        field_name: tagName,
        field_value: selectedText,
        field_tag: tag,
        position_in_html: position,
      });

    if (fieldError) throw fieldError;

    console.log("Successfully added field:", fieldId);

    return new Response(
      JSON.stringify({ 
        success: true,
        fieldId: fieldId,
        tag: tag,
        text: selectedText
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
