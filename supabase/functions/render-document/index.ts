import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import mammoth from "https://esm.sh/mammoth@1.8.0";

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

    // Get document info
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError) throw downloadError;

    // Convert to ArrayBuffer
    const arrayBuffer = await fileData.arrayBuffer();

    // Convert docx to HTML using mammoth
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Title'] => h1.title:fresh",
          "b => strong",
          "i => em",
        ],
      }
    );

    // Get document runs to know which text fragments are tagged
    const { data: runs, error: runsError } = await supabase
      .from("document_runs")
      .select("id, text, tag, run_index")
      .eq("document_id", documentId)
      .order("run_index", { ascending: true });

    if (runsError) throw runsError;

    let html = result.value;

    // Create a mapping of text fragments to their tags
    const taggedFragments: Array<{ text: string; tag: string; tags: string; runId: string }> = [];
    
    runs?.forEach((run) => {
      if (run.tag && run.text) {
        const tags = run.tag.split(',').map((t: string) => `{{${t.trim()}}}`).join(', ');
        taggedFragments.push({
          text: run.text,
          tag: run.tag,
          tags: tags,
          runId: run.id
        });
      }
    });

    // Sort by length (longest first) to avoid partial replacements
    taggedFragments.sort((a, b) => b.text.length - a.text.length);

    // Replace each tagged text with highlighted version
    taggedFragments.forEach(({ text, tag, tags, runId }) => {
      // Create a more specific regex that matches whole words/phrases
      const escapedText = text
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+"); // Allow flexible whitespace
      
      const regex = new RegExp(`(?<!<[^>]*)${escapedText}(?![^<]*>)`, "g");
      
      // Create highlighted replacement with field ID for interactivity
      const replacement = `<span class="doc-variable" data-tag="${tag}" data-field-id="${runId}">${text}<span class="doc-tag-badge">${tags}</span></span>`;
      
      html = html.replace(regex, replacement);
    });

    // Add CSS styles for highlighting
    const styledHtml = `
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
        .doc-variable {
          background-color: #fef08a;
          border: 2px solid #facc15;
          padding: 2px 8px;
          border-radius: 4px;
          display: inline;
          font-weight: 500;
          white-space: pre-wrap;
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
      ${html}
    `;

    return new Response(
      JSON.stringify({ 
        html: styledHtml,
        warnings: result.messages 
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
