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

    // Get document with runs_metadata and xml_content
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("runs_metadata, html_cache, xml_content")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

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

    let html: string;

    // Check if we have runs_metadata to render from
    if (document.runs_metadata && Array.isArray(document.runs_metadata) && document.runs_metadata.length > 0) {
      console.log("Document runs count:", document.runs_metadata.length);
      console.log("Found fields:", fields?.length || 0);
      console.log("New fields (last 5 min):", newFieldTags.size);

      // Generate HTML from runs
      html = convertRunsToHTML(document.runs_metadata, fields || [], newFieldTags);
    } else if (document.xml_content) {
      // Fall back to rendering from XML content
      console.log("No runs_metadata, rendering from xml_content");
      console.log("XML content length:", document.xml_content.length);
      console.log("Found fields:", fields?.length || 0);

      html = convertXmlToHTML(document.xml_content, fields || [], newFieldTags);
    } else {
      throw new Error("Document has no runs_metadata or xml_content to render");
    }

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

// Convert XML content to HTML
function convertXmlToHTML(
  xmlContent: string,
  fields: Array<{id: string; field_tag: string; created_at: string}>,
  newFieldTags: Set<string>
): string {
  const styles = getStyles();

  // Create tag map
  const tagMap = new Map<string, string>();
  fields.forEach(f => tagMap.set(f.field_tag, f.id));

  // Extract text from XML using regex (simple approach for Word XML)
  const textParts: string[] = [];
  
  // Match all w:t elements (text runs in Word XML)
  const textMatches = xmlContent.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
  for (const match of textMatches) {
    if (match[1]) {
      textParts.push(match[1]);
    }
  }

  // Join all text and split by paragraph markers
  let fullText = textParts.join('');
  
  // Process text to identify paragraphs (split on common patterns)
  // Word XML uses <w:p> for paragraphs, but we extracted just text
  // So we'll look for natural paragraph breaks
  
  let html = styles;
  
  // If we have no text extracted, try a different approach
  if (fullText.trim().length === 0) {
    // Try to extract paragraph by paragraph
    const paragraphMatches = xmlContent.matchAll(/<w:p[^>]*>([\s\S]*?)<\/w:p>/g);
    const paragraphs: string[] = [];
    
    for (const pMatch of paragraphMatches) {
      const paragraphXml = pMatch[1];
      const texts: string[] = [];
      const textInPara = paragraphXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      for (const tMatch of textInPara) {
        if (tMatch[1]) {
          texts.push(tMatch[1]);
        }
      }
      if (texts.length > 0) {
        paragraphs.push(texts.join(''));
      }
    }
    
    console.log("Extracted paragraphs:", paragraphs.length);
    
    for (const paraText of paragraphs) {
      html += '<p>';
      html += processTextWithVariables(escapeHtml(paraText), tagMap, newFieldTags);
      html += '</p>';
    }
  } else {
    // Single paragraph approach
    html += '<p>';
    html += processTextWithVariables(escapeHtml(fullText), tagMap, newFieldTags);
    html += '</p>';
  }

  console.log("Generated HTML from XML, length:", html.length);
  return html;
}

// Process text to highlight variables
function processTextWithVariables(
  text: string,
  tagMap: Map<string, string>,
  newFieldTags: Set<string>
): string {
  // Find all {{variable}} patterns
  const tagMatch = text.match(/\{\{[^}]+\}\}/g);
  
  if (!tagMatch) {
    return text;
  }

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
        `<span class="${variableClass}" data-field-id="${fieldId}" data-tag="${unescapedTag}">${tag}<span class="${badgeClass}">${unescapedTag}</span></span>`
      );
    } else {
      styledText = styledText.replace(
        tag,
        `<span class="${variableClass}" data-tag="${unescapedTag}">${tag}</span>`
      );
    }
  }
  
  return styledText;
}

// Get common styles
function getStyles(): string {
  return `
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
}

// Convert runs to HTML with formatting
function convertRunsToHTML(
  runs: ProcessedRun[], 
  fields: Array<{id: string; field_tag: string; created_at: string}>,
  newFieldTags: Set<string>
): string {
  const styles = getStyles();

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
