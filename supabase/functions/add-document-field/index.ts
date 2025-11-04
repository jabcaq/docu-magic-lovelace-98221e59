import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to safely find and replace text in HTML content only (not in tags)
function safeReplaceInHTML(html: string, searchText: string, replacement: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  if (!doc || !doc.body) {
    throw new Error("Could not parse HTML");
  }

  let found = false;

  // Recursively process text nodes
  function processNode(node: any): void {
    if (node.nodeType === 3) { // Text node
      const text = node.textContent;
      if (text && text.includes(searchText)) {
        // Create a temporary div to parse the replacement HTML
        const tempDiv = doc!.createElement('div');
        tempDiv.innerHTML = text.replace(searchText, replacement);
        
        // Replace the text node with the new content
        const parent = node.parentNode;
        while (tempDiv.firstChild) {
          parent.insertBefore(tempDiv.firstChild, node);
        }
        parent.removeChild(node);
        found = true;
        return;
      }
    }
    
    // Skip style and script tags
    if (node.nodeType === 1 && (node.tagName === 'STYLE' || node.tagName === 'SCRIPT')) {
      return;
    }
    
    // Process child nodes
    if (node.childNodes) {
      // Create array copy since we might modify the tree
      const children = Array.from(node.childNodes);
      for (const child of children) {
        processNode(child);
        if (found) return; // Stop after first replacement
      }
    }
  }

  processNode(doc.body);

  if (!found) {
    throw new Error(`Could not find text "${searchText}" in document content`);
  }

  return doc.body.innerHTML;
}

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
    const normalizedSelection = selectedText.trim();

    // Generate unique field ID
    const fieldId = crypto.randomUUID();
    const tag = `{{${tagName}}}`;

    // Wrap the selected text in a span with field ID
    const replacement = `<span class="doc-variable" data-field-id="${fieldId}" data-tag="${tag}">${normalizedSelection}<span class="doc-tag-badge">${tag}</span></span>`;
    
    // Use safe replacement function
    try {
      html = safeReplaceInHTML(html, normalizedSelection, replacement);
    } catch (error) {
      console.error("Safe replace error:", error);
      throw new Error(`Could not find text "${selectedText}" in visible document content. It may already be tagged or located in a non-editable area.`);
    }

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