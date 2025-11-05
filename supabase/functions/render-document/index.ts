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

    // Get document with XML content
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("xml_content, html_cache")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    if (!document.xml_content) {
      throw new Error("Document has no XML content");
    }

    // Get all document fields to replace values with tags for preview
    const { data: fields, error: fieldsError } = await supabase
      .from("document_fields")
      .select("id, field_tag, position_in_html")
      .eq("document_id", documentId)
      .order("position_in_html", { ascending: true });

    if (fieldsError) throw fieldsError;

    console.log("Document XML length:", document.xml_content.length);
    console.log("Found fields:", fields?.length || 0);

    // Generate HTML from XML
    let html = convertXMLToHTML(document.xml_content, fields || []);

    // Cache the HTML for faster future loads
    await supabase
      .from("documents")
      .update({ html_cache: html })
      .eq("id", documentId);

    return new Response(
      JSON.stringify({ 
        html: html
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

// Helper: escape HTML
function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Convert minimal OpenXML (word/document.xml) to simple HTML paragraphs
function convertXMLToHTML(xmlContent: string, fields: Array<{id: string; field_tag: string}>): string {
  const styles = `
    <style>
      body { font-family: 'Calibri', 'Arial', sans-serif; line-height: 1.6; padding: 20px; max-width: 100%; margin: 0 auto; }
      p { margin: 12px 0; text-align: justify; word-wrap: break-word; }
      .doc-variable { background-color: #fef08a; border: 2px solid #facc15; padding: 2px 8px; border-radius: 4px; display: inline; font-weight: 500; white-space: pre-wrap; cursor: pointer; transition: all 0.2s ease; }
      .doc-variable:hover { background-color: #fde047; transform: scale(1.01); }
      .doc-tag-badge { display: inline-block; background-color: #3b82f6; color: white; font-size: 9px; padding: 2px 5px; border-radius: 3px; margin-left: 4px; font-family: 'Courier New', monospace; font-weight: normal; white-space: nowrap; }
    </style>
  `;

  console.log("Converting XML to HTML, XML length:", xmlContent.length);

  // Extract all text from <w:t> tags
  const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  const matches = Array.from(xmlContent.matchAll(textRegex));
  
  console.log("Found", matches.length, "text runs");

  if (matches.length === 0) {
    console.warn("No text runs found in XML");
    return styles + `<p>Brak tekstu w dokumencie</p>`;
  }

  // Group text by paragraphs (detect <w:p> boundaries)
  const paraRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const paragraphs = Array.from(xmlContent.matchAll(paraRegex));
  
  console.log("Found", paragraphs.length, "paragraphs");

  const tagMap = new Map<string, string>();
  fields.forEach(f => tagMap.set(f.field_tag, f.id));

  const renderText = (text: string) => {
    // First unescape XML entities
    text = text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');

    // Then escape for HTML display
    text = escapeHtml(text);

    // Wrap {{tag}} tokens
    return text.replace(/\{\{[^}]+\}\}/g, (m) => {
      const unescaped = m.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const id = tagMap.get(unescaped);
      if (!id) return `<span class="doc-variable" data-tag="${unescaped}">${m}</span>`;
      return `<span class="doc-variable" data-field-id="${id}" data-tag="${unescaped}">${m}<span class="doc-tag-badge">${unescaped}</span></span>`;
    });
  };

  let html = styles;
  
  if (paragraphs.length > 0) {
    // Process each paragraph
    for (const paraMatch of paragraphs) {
      const paraContent = paraMatch[1];
      const textMatches = Array.from(paraContent.matchAll(textRegex));
      
      if (textMatches.length === 0) {
        // Empty paragraph - add line break
        html += `<p>&nbsp;</p>`;
        continue;
      }

      let paragraphText = '';
      for (const textMatch of textMatches) {
        const content = textMatch[1] || '';
        paragraphText += content;
      }

      if (paragraphText.trim()) {
        html += `<p>${renderText(paragraphText)}</p>`;
      } else {
        html += `<p>&nbsp;</p>`;
      }
    }
  } else {
    // Fallback: no paragraphs found, join all text
    console.warn("No paragraphs found, using fallback");
    let allText = '';
    for (const match of matches) {
      allText += match[1] || '';
    }
    html += `<p>${renderText(allText)}</p>`;
  }

  console.log("Generated HTML length:", html.length);
  return html;
}
