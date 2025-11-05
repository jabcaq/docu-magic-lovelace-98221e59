import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

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
    let html = convertXMLToHTML(document.xml_content, fields);

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

// Helper function to convert OpenXML to HTML
function convertXMLToHTML(xmlContent: string, fields: any[]): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
  
  if (!xmlDoc) {
    throw new Error("Failed to parse XML");
  }

  let html = `
    <style>
      body {
        font-family: 'Times New Roman', serif;
        line-height: 1.6;
        padding: 0;
        width: 100%;
      }
      h1, h2, h3 {
        color: #1a1a1a;
        margin-top: 20px;
        margin-bottom: 10px;
      }
      p {
        margin: 10px 0;
        text-align: justify;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        margin: 10px 0;
      }
      td, th {
        border: 1px solid #ddd;
        padding: 8px;
      }
      .doc-variable {
        background-color: #fef08a;
        border: 2px solid #facc15;
        padding: 2px 8px;
        border-radius: 4px;
        display: inline;
        font-weight: 500;
        white-space: pre-wrap;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .doc-variable:hover {
        background-color: #fde047;
        transform: scale(1.01);
      }
      .doc-tag-badge {
        display: inline-block;
        background-color: #3b82f6;
        color: white;
        font-size: 9px;
        padding: 2px 5px;
        border-radius: 3px;
        margin-left: 4px;
        font-family: 'Courier New', monospace;
        font-weight: normal;
        white-space: nowrap;
      }
      strong {
        font-weight: bold;
      }
      em {
        font-style: italic;
      }
    </style>
  `;

  // Get all paragraphs from XML
  const paragraphs = xmlDoc.getElementsByTagName("w:p");
  
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const runs = para.getElementsByTagName("w:r");
    
    let paraHtml = "<p>";
    
    for (let j = 0; j < runs.length; j++) {
      const run = runs[j];
      const textNodes = run.getElementsByTagName("w:t");
      
      if (textNodes.length === 0) continue;
      
      const text = textNodes[0].textContent || "";
      
      // Check if this run has formatting
      const rPr = run.getElementsByTagName("w:rPr")[0];
      let isBold = false;
      let isItalic = false;
      
      if (rPr) {
        isBold = rPr.getElementsByTagName("w:b").length > 0;
        isItalic = rPr.getElementsByTagName("w:i").length > 0;
      }
      
      // Check if this text is a field
      const matchingField = fields?.find(f => text.includes(f.field_tag));
      
      if (matchingField) {
        paraHtml += `<span class="doc-variable" data-field-id="${matchingField.id}" data-tag="${matchingField.field_tag}">${matchingField.field_tag}</span>`;
      } else {
        let formattedText = text;
        if (isBold) formattedText = `<strong>${formattedText}</strong>`;
        if (isItalic) formattedText = `<em>${formattedText}</em>`;
        paraHtml += formattedText;
      }
    }
    
    paraHtml += "</p>";
    html += paraHtml;
  }
  
  return html;
}
