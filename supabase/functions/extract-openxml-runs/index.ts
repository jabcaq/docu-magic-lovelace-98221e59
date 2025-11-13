import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RunFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
}

interface ExtractedRun {
  text: string;
  formatting: RunFormatting;
  paragraphIndex: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { documentId } = await req.json();

    if (!documentId) {
      throw new Error("documentId is required");
    }

    console.log("Extracting runs for document:", documentId);

    // Fetch document from database
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("storage_path, type")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    if (document.type !== "word") {
      throw new Error("Only Word documents are supported for OpenXML run extraction");
    }

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError || !fileData) {
      throw new Error("Failed to download document");
    }

    console.log("File downloaded, extracting runs...");

    // Extract runs from docx
    const runs = await extractOpenXMLRuns(fileData);

    console.log(`Extracted ${runs.length} runs with formatting`);

    // Update document with runs metadata
    const { error: updateError } = await supabase
      .from("documents")
      .update({ runs_metadata: runs })
      .eq("id", documentId);

    if (updateError) {
      console.error("Failed to update document with runs:", updateError);
      throw updateError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        runs,
        count: runs.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error extracting runs:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({
        error: errorMessage,
        success: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function extractOpenXMLRuns(file: Blob): Promise<ExtractedRun[]> {
  const runs: ExtractedRun[] = [];

  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Extract document.xml which contains the main content
    const documentXml = zip.file("word/document.xml");
    if (!documentXml) {
      throw new Error("document.xml not found in the Word file");
    }

    const xmlContent = await documentXml.async("text");

    // Regex to extract paragraphs and runs
    const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    const runsRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;

    const decodeXml = (s: string) => {
      // First decode XML entities
      let decoded = s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
      
      // Remove any XML tags that might have leaked through
      decoded = decoded.replace(/<\/?w:[^>]*>/g, '');
      decoded = decoded.replace(/<[^>]+>/g, '');
      
      return decoded;
    };

    // Extract paragraphs
    const paragraphMatches = [...xmlContent.matchAll(paragraphRegex)];
    
    for (let paragraphIndex = 0; paragraphIndex < paragraphMatches.length; paragraphIndex++) {
      const paragraphContent = paragraphMatches[paragraphIndex][1];
      
      // Extract runs within this paragraph
      const runMatches = [...paragraphContent.matchAll(runsRegex)];

      for (const runMatch of runMatches) {
        const runXml = runMatch[0];
        
        // Extract formatting flags
        const formatting: RunFormatting = {};
        if (/<w:b\b[^>]*\/>|<w:b\b[^>]*>/.test(runXml)) formatting.bold = true;
        if (/<w:i\b[^>]*\/>|<w:i\b[^>]*>/.test(runXml)) formatting.italic = true;
        if (/<w:u\b[^>]*\/>|<w:u\b[^>]*>/.test(runXml)) formatting.underline = true;

        const szMatch = runXml.match(/<w:sz[^>]*w:val="(\d+)"/);
        if (szMatch) formatting.fontSize = parseInt(szMatch[1]) / 2; // half-points

        const fontMatch = runXml.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/);
        if (fontMatch) formatting.fontFamily = fontMatch[1];

        const colorMatch = runXml.match(/<w:color[^>]*w:val="([^"]+)"/);
        if (colorMatch && colorMatch[1] !== 'auto') formatting.color = `#${colorMatch[1]}`;

        // Extract all text pieces in this run
        let text = '';
        const tMatches = [...runXml.matchAll(tRegex)];
        for (const m of tMatches) {
          text += decodeXml(m[1] || '');
        }

        if (text.trim()) {
          runs.push({ 
            text, 
            formatting,
            paragraphIndex 
          });
        }
      }
    }

    return runs;
  } catch (error) {
    console.error("Error parsing OpenXML:", error);
    throw new Error("Failed to parse Word document OpenXML");
  }
}

