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
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { templateId } = await req.json();
    console.log("Rendering template:", templateId);

    // Get template data
    const { data: template, error: templateError } = await supabase
      .from("templates")
      .select("id, name, storage_path, tag_metadata")
      .eq("id", templateId)
      .eq("user_id", user.id)
      .single();

    if (templateError) throw templateError;
    if (!template) throw new Error("Template not found");

    // Download DOCX file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(template.storage_path);

    if (downloadError) throw downloadError;

    // Convert DOCX to HTML using mammoth-like approach
    const arrayBuffer = await fileData.arrayBuffer();
    const html = await convertDocxToHtml(new Uint8Array(arrayBuffer), template.tag_metadata);

    console.log("Generated HTML length:", html.length);

    return new Response(
      JSON.stringify({ 
        html,
        name: template.name,
        tagCount: getTagCount(template.tag_metadata),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in render-template:", error);
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

function getTagCount(tagMetadata: any): number {
  if (Array.isArray(tagMetadata)) {
    return tagMetadata.length;
  } else if (tagMetadata && typeof tagMetadata === 'object') {
    return tagMetadata.tags?.length || tagMetadata.count || Object.keys(tagMetadata).length || 0;
  }
  return 0;
}

async function convertDocxToHtml(docxData: Uint8Array, tagMetadata: any): Promise<string> {
  // Use JSZip to extract document.xml from DOCX
  const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
  
  const zip = await JSZip.loadAsync(docxData);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  
  if (!documentXml) {
    throw new Error("Could not extract document.xml from DOCX");
  }

  // Parse XML and extract text with formatting
  const paragraphs = extractParagraphsFromXml(documentXml);
  
  // Build HTML
  const styles = `
    <style>
      .template-preview { font-family: 'Calibri', 'Arial', sans-serif; line-height: 1.6; padding: 20px; }
      .template-preview p { margin: 8px 0; text-align: justify; word-wrap: break-word; }
      .template-variable { 
        background-color: hsl(48 96% 89%); 
        border: 1px solid hsl(45 93% 47%); 
        padding: 1px 6px; 
        border-radius: 4px; 
        font-weight: 500; 
        font-family: 'Courier New', monospace;
        font-size: 0.9em;
        color: hsl(28 73% 26%);
      }
      .bold { font-weight: bold; }
      .italic { font-style: italic; }
      .underline { text-decoration: underline; }
    </style>
  `;

  let html = styles + '<div class="template-preview">';
  
  for (const para of paragraphs) {
    if (para.trim()) {
      // Highlight {{variables}}
      const highlighted = para.replace(
        /\{\{([^}]+)\}\}/g,
        '<span class="template-variable">{{$1}}</span>'
      );
      html += `<p>${escapeHtml(para).replace(/\{\{([^}]+)\}\}/g, '<span class="template-variable">{{$1}}</span>')}</p>`;
    }
  }
  
  html += '</div>';
  return html;
}

function extractParagraphsFromXml(xml: string): string[] {
  const paragraphs: string[] = [];
  
  // Match all w:p elements (paragraphs)
  const paragraphMatches = xml.matchAll(/<w:p[^>]*>([\s\S]*?)<\/w:p>/g);
  
  for (const pMatch of paragraphMatches) {
    const paragraphXml = pMatch[1];
    const texts: string[] = [];
    
    // Extract text from w:t elements
    const textMatches = paragraphXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    for (const tMatch of textMatches) {
      if (tMatch[1]) {
        texts.push(tMatch[1]);
      }
    }
    
    if (texts.length > 0) {
      paragraphs.push(texts.join(''));
    }
  }
  
  return paragraphs;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
