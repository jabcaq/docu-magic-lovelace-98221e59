import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
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

    // Get all document fields to get field IDs for tags + check which are new
    const { data: fields, error: fieldsError } = await supabase
      .from("document_fields")
      .select("id, field_tag, created_at")
      .eq("document_id", documentId);

    if (fieldsError) throw fieldsError;

    // Check for recently created fields (within last 5 minutes)
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const newFieldTags = new Set(
      (fields || [])
        .filter(f => new Date(f.created_at) > fiveMinutesAgo)
        .map(f => f.field_tag)
    );

    console.log("Document runs count:", document.runs_metadata.length);
    console.log("Found fields:", fields?.length || 0);
    console.log("New fields (last 5 min):", newFieldTags.size);

    // Generate HTML from runs
    let html = convertRunsToHTML(document.runs_metadata, fields || [], newFieldTags);

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
  paragraphIndex?: number;
}

// Convert runs to HTML with formatting
function convertRunsToHTML(
  runs: ProcessedRun[], 
  fields: Array<{id: string; field_tag: string; created_at: string}>,
  newFieldTags: Set<string>
): string {
  const styles = `
    <style>
      body { font-family: 'Calibri', 'Arial', sans-serif; line-height: 1.6; padding: 20px; max-width: 100%; margin: 0 auto; }
      p { margin: 12px 0; text-align: justify; word-wrap: break-word; }
      .doc-variable { background-color: #fef08a; border: 2px solid #facc15; padding: 2px 8px; border-radius: 4px; display: inline; font-weight: 500; white-space: pre-wrap; cursor: pointer; transition: all 0.2s ease; }
      .doc-variable:hover { background-color: #fde047; transform: scale(1.01); }
      .doc-variable-new { background-color: #bbf7d0; border: 2px solid #4ade80; padding: 2px 8px; border-radius: 4px; display: inline; font-weight: 500; white-space: pre-wrap; cursor: pointer; transition: all 0.2s ease; }
      .doc-variable-new:hover { background-color: #86efac; transform: scale(1.01); }
      .doc-tag-badge { display: inline-block; background-color: #3b82f6; color: white; font-size: 9px; padding: 2px 5px; border-radius: 3px; margin-left: 4px; font-family: 'Courier New', monospace; font-weight: normal; white-space: nowrap; }
      .doc-tag-badge-new { display: inline-block; background-color: #10b981; color: white; font-size: 9px; padding: 2px 5px; border-radius: 3px; margin-left: 4px; font-family: 'Courier New', monospace; font-weight: normal; white-space: nowrap; }
    </style>
  `;

  console.log("Converting", runs.length, "runs to HTML");

  // Create tag map
  const tagMap = new Map<string, string>();
  fields.forEach(f => tagMap.set(f.field_tag, f.id));

  // Group runs by paragraph index to preserve layout
  const paragraphs = new Map<number, ProcessedRun[]>();
  for (const run of runs) {
    const p = run.paragraphIndex ?? 0;
    if (!paragraphs.has(p)) paragraphs.set(p, []);
    paragraphs.get(p)!.push(run);
  }

  const sorted = Array.from(paragraphs.entries()).sort((a, b) => a[0] - b[0]);
  let html = styles;

  for (const [pIndex, paraRuns] of sorted) {
    html += '<p>';
    for (const run of paraRuns) {
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

      // Tags within the text
      const tagMatch = text.match(/\{\{[^}]+\}\}/g);
      if (tagMatch) {
        let styledText = text;
        for (const tag of tagMatch) {
          const unescapedTag = tag.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          const fieldId = tagMap.get(unescapedTag);
          const isNew = newFieldTags.has(unescapedTag);
          const variableClass = isNew ? 'doc-variable-new' : 'doc-variable';
          const badgeClass = isNew ? 'doc-tag-badge-new' : 'doc-tag-badge';

          if (fieldId) {
            styledText = styledText.replace(
              tag,
              `<span class="${variableClass}" data-field-id="${fieldId}" data-tag="${unescapedTag}" style="${style}">${tag}<span class="${badgeClass}">${unescapedTag}</span></span>`
            );
          } else {
            styledText = styledText.replace(
              tag,
              `<span class="${variableClass}" data-tag="${unescapedTag}" style="${style}">${tag}</span>`
            );
          }
        }
        html += styledText;
      } else {
        html += style ? `<span style="${style}">${text}</span>` : text;
      }
    }
    html += '</p>';
  }

  console.log("Generated HTML length:", html.length);
  return html;
}
