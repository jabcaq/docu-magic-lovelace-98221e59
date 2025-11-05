import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replace first occurrence of selected text inside <w:t>
function replaceInWT(xml: string, searchText: string, replacement: string): { success: boolean; xml: string } {
  let replaced = false;
  const wtRegex = /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  const newXml = xml.replace(wtRegex, (full, open, content, close) => {
    if (replaced) return full;
    const idx = content.indexOf(searchText);
    if (idx === -1) return full;
    replaced = true;
    const updated = content.slice(0, idx) + replacement + content.slice(idx + searchText.length);
    return `${open}${updated}${close}`;
  });
  return { success: replaced, xml: newXml };
}

// (HTML helper removed; XML edits are done with replaceInWT)

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

    // Get document XML
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("xml_content")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found or access denied");
    }

    let xml = document.xml_content;
    if (!xml) {
      throw new Error("Document has no XML content");
    }

    // Normalize whitespace in selected text
    const normalizedSelection = selectedText.trim();

    // Generate unique field ID
    const fieldId = crypto.randomUUID();
    const tag = `{{${tagName}}}`;

    // Use safe XML text replacement within <w:t>
    const result = replaceInWT(xml, normalizedSelection, tag);
    
    if (!result.success) {
      throw new Error(`Could not find text "${selectedText}" in document content. It may already be tagged.`);
    }

    xml = result.xml;

    // Update document XML and clear HTML cache
    const { error: updateError } = await supabase
      .from("documents")
      .update({ 
        xml_content: xml,
        html_cache: null // Force regeneration
      })
      .eq("id", documentId);

    if (updateError) throw updateError;

    // Create field record
    const { error: fieldError } = await supabase
      .from("document_fields")
      .insert({
        document_id: documentId,
        field_name: tagName,
        field_value: selectedText,
        field_tag: tag,
        position_in_html: 0, // Will be recalculated
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