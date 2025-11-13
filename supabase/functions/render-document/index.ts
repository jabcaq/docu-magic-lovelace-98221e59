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

    // Get document with runs_metadata
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("runs_metadata, html_cache")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    if (!document.runs_metadata || !Array.isArray(document.runs_metadata)) {
      throw new Error("Document has no runs_metadata");
    }

    // Get all document fields to get field IDs for tags
    const { data: fields, error: fieldsError } = await supabase
      .from("document_fields")
      .select("id, field_tag")
      .eq("document_id", documentId);

    if (fieldsError) throw fieldsError;

    console.log("Document runs count:", document.runs_metadata.length);
    console.log("Found fields:", fields?.length || 0);

    // Generate HTML from runs
    let html = convertRunsToHTML(document.runs_metadata, fields || []);

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

interface RunFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
}

interface ProcessedRun {
  text: string;
  formatting?: RunFormatting;
}

// Convert runs to HTML with formatting
function convertRunsToHTML(runs: ProcessedRun[], fields: Array<{id: string; field_tag: string}>): string {
  const styles = `
    <style>
      body { font-family: 'Calibri', 'Arial', sans-serif; line-height: 1.6; padding: 20px; max-width: 100%; margin: 0 auto; }
      p { margin: 12px 0; text-align: justify; word-wrap: break-word; }
      .doc-variable { background-color: #fef08a; border: 2px solid #facc15; padding: 2px 8px; border-radius: 4px; display: inline; font-weight: 500; white-space: pre-wrap; cursor: pointer; transition: all 0.2s ease; }
      .doc-variable:hover { background-color: #fde047; transform: scale(1.01); }
      .doc-tag-badge { display: inline-block; background-color: #3b82f6; color: white; font-size: 9px; padding: 2px 5px; border-radius: 3px; margin-left: 4px; font-family: 'Courier New', monospace; font-weight: normal; white-space: nowrap; }
    </style>
  `;

  console.log("Converting", runs.length, "runs to HTML");

  // Create tag map
  const tagMap = new Map<string, string>();
  fields.forEach(f => tagMap.set(f.field_tag, f.id));

  let html = styles + '<p>';
  
  for (const run of runs) {
    const text = escapeHtml(run.text);
    const formatting = run.formatting || {};
    
    // Build inline style from formatting
    let style = '';
    if (formatting.bold) style += 'font-weight: bold;';
    if (formatting.italic) style += 'font-style: italic;';
    if (formatting.underline) style += 'text-decoration: underline;';
    if (formatting.fontSize) style += `font-size: ${formatting.fontSize}pt;`;
    if (formatting.fontFamily) style += `font-family: ${formatting.fontFamily};`;
    if (formatting.color) style += `color: ${formatting.color};`;
    
    // Check if text contains {{tag}}
    const tagMatch = text.match(/\{\{[^}]+\}\}/g);
    
    if (tagMatch) {
      // Replace each tag with styled span
      let styledText = text;
      for (const tag of tagMatch) {
        const unescapedTag = tag.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const fieldId = tagMap.get(unescapedTag);
        
        if (fieldId) {
          styledText = styledText.replace(
            tag,
            `<span class="doc-variable" data-field-id="${fieldId}" data-tag="${unescapedTag}" style="${style}">${tag}<span class="doc-tag-badge">${unescapedTag}</span></span>`
          );
        } else {
          styledText = styledText.replace(
            tag,
            `<span class="doc-variable" data-tag="${unescapedTag}" style="${style}">${tag}</span>`
          );
        }
      }
      html += styledText;
    } else {
      // Regular text with formatting
      if (style) {
        html += `<span style="${style}">${text}</span>`;
      } else {
        html += text;
      }
    }
  }
  
  html += '</p>';

  console.log("Generated HTML length:", html.length);
  return html;
}
