import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

    console.log("Rebuilding XML for document:", documentId);

    // Get document with runs_metadata
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("runs_metadata")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    if (!document.runs_metadata || !Array.isArray(document.runs_metadata)) {
      throw new Error("Document has no runs_metadata");
    }

    console.log("Building XML from", document.runs_metadata.length, "runs");

    // Build new XML from runs
    const xml = buildDocumentXML(document.runs_metadata);

    // Update document with new XML
    const { error: updateError } = await supabase
      .from("documents")
      .update({ xml_content: xml })
      .eq("id", documentId);

    if (updateError) throw updateError;

    console.log("XML rebuilt successfully, length:", xml.length);

    return new Response(
      JSON.stringify({ 
        success: true,
        xmlLength: xml.length
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in rebuild-document-xml:", error);
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

function buildDocumentXML(runs: ProcessedRun[]): string {
  // Group runs by paragraph
  const paragraphs: Map<number, ProcessedRun[]> = new Map();
  
  for (const run of runs) {
    const pIndex = run.paragraphIndex ?? 0;
    if (!paragraphs.has(pIndex)) {
      paragraphs.set(pIndex, []);
    }
    paragraphs.get(pIndex)!.push(run);
  }
  
  // Build paragraphs XML
  let paragraphsXML = '';
  const sortedParagraphs = Array.from(paragraphs.entries()).sort((a, b) => a[0] - b[0]);
  
  for (const [_, paragraphRuns] of sortedParagraphs) {
    let runsXML = '';
    for (const run of paragraphRuns) {
      runsXML += buildRunXML(run);
    }
    paragraphsXML += `    <w:p>\n      ${runsXML}\n    </w:p>\n`;
  }

  // Wrap in basic document structure
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" 
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
${paragraphsXML}    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  return xml;
}

function buildRunXML(run: ProcessedRun): string {
  const formatting = run.formatting || {};
  
  // Build formatting properties
  let rPr = '';
  
  if (formatting.bold) {
    rPr += '<w:b/>';
  }
  
  if (formatting.italic) {
    rPr += '<w:i/>';
  }
  
  if (formatting.underline) {
    rPr += '<w:u w:val="single"/>';
  }
  
  if (formatting.fontSize) {
    // Word uses half-points (fontSize * 2)
    rPr += `<w:sz w:val="${formatting.fontSize * 2}"/>`;
    rPr += `<w:szCs w:val="${formatting.fontSize * 2}"/>`;
  }
  
  if (formatting.fontFamily) {
    rPr += `<w:rFonts w:ascii="${escapeXml(formatting.fontFamily)}" w:hAnsi="${escapeXml(formatting.fontFamily)}"/>`;
  }
  
  if (formatting.color) {
    // Remove # from color if present
    const color = formatting.color.replace('#', '');
    rPr += `<w:color w:val="${color}"/>`;
  }

  // Escape text for XML
  const escapedText = escapeXml(run.text);

  // Build run element
  let runXML = '<w:r>';
  
  if (rPr) {
    runXML += `<w:rPr>${rPr}</w:rPr>`;
  }
  
  runXML += `<w:t xml:space="preserve">${escapedText}</w:t>`;
  runXML += '</w:r>';

  return runXML;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
