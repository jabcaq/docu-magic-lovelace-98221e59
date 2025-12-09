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

    // Convert DOCX to HTML
    const arrayBuffer = await fileData.arrayBuffer();
    const html = await convertDocxToHtml(new Uint8Array(arrayBuffer));

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

async function convertDocxToHtml(docxData: Uint8Array): Promise<string> {
  const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
  
  const zip = await JSZip.loadAsync(docxData);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  
  if (!documentXml) {
    throw new Error("Could not extract document.xml from DOCX");
  }

  // Parse and render the document
  const bodyContent = parseDocumentBody(documentXml);
  
  return bodyContent;
}

function parseDocumentBody(xml: string): string {
  // Extract body content
  const bodyMatch = xml.match(/<w:body>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return "<p>Nie można odczytać dokumentu</p>";
  
  const bodyXml = bodyMatch[1];
  let html = "";
  
  // Process elements in order (tables and paragraphs)
  const elements = extractElements(bodyXml);
  
  for (const element of elements) {
    if (element.type === "table") {
      html += renderTable(element.content);
    } else if (element.type === "paragraph") {
      const text = extractParagraphText(element.content);
      if (text.trim()) {
        html += `<p>${highlightVariables(escapeHtml(text))}</p>`;
      }
    }
  }
  
  return html;
}

interface DocElement {
  type: "table" | "paragraph";
  content: string;
  index: number;
}

function extractElements(bodyXml: string): DocElement[] {
  const elements: DocElement[] = [];
  
  // Find all tables
  const tableRegex = /<w:tbl>([\s\S]*?)<\/w:tbl>/g;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(bodyXml)) !== null) {
    elements.push({
      type: "table",
      content: tableMatch[0],
      index: tableMatch.index
    });
  }
  
  // Find all paragraphs (not inside tables)
  const paragraphRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = paragraphRegex.exec(bodyXml)) !== null) {
    const pIndex = pMatch.index;
    // Check if this paragraph is inside a table
    const isInTable = elements.some(el => 
      el.type === "table" && 
      pIndex > el.index && 
      pIndex < el.index + el.content.length
    );
    
    if (!isInTable) {
      elements.push({
        type: "paragraph",
        content: pMatch[0],
        index: pIndex
      });
    }
  }
  
  // Sort by position in document
  elements.sort((a, b) => a.index - b.index);
  
  return elements;
}

function renderTable(tableXml: string): string {
  const rows: string[] = [];
  
  // Extract rows
  const rowRegex = /<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g;
  let rowMatch;
  
  while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
    const rowXml = rowMatch[1];
    const cells: string[] = [];
    
    // Extract cells
    const cellRegex = /<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g;
    let cellMatch;
    
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const cellXml = cellMatch[1];
      
      // Get cell properties (colspan, width, etc.)
      const gridSpanMatch = cellXml.match(/<w:gridSpan\s+w:val="(\d+)"/);
      const colspan = gridSpanMatch ? parseInt(gridSpanMatch[1]) : 1;
      
      // Get cell text
      const cellParagraphs: string[] = [];
      const pRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
      let pMatch;
      
      while ((pMatch = pRegex.exec(cellXml)) !== null) {
        const text = extractParagraphText(pMatch[0]);
        if (text.trim()) {
          cellParagraphs.push(highlightVariables(escapeHtml(text)));
        }
      }
      
      const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : "";
      cells.push(`<td${colspanAttr}>${cellParagraphs.join("<br>")}</td>`);
    }
    
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  
  return `<table>${rows.join("")}</table>`;
}

function extractParagraphText(paragraphXml: string): string {
  const texts: string[] = [];
  
  // Extract text from w:t elements
  const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match;
  
  while ((match = textRegex.exec(paragraphXml)) !== null) {
    if (match[1]) {
      texts.push(match[1]);
    }
  }
  
  return texts.join("");
}

function highlightVariables(text: string): string {
  return text.replace(
    /\{\{([^}]+)\}\}/g,
    '<span class="var">{{$1}}</span>'
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
