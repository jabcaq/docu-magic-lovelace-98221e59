import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import * as JSZip from "https://esm.sh/jszip@3.10.1";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

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
      throw new Error("Invalid .docx file: missing document.xml");
    }

    const xmlContent = await documentXml.async("text");
    
    // Parse XML and extract runs
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");

    if (!xmlDoc) {
      throw new Error("Failed to parse XML document");
    }

    // Find all <w:r> (run) elements
    const runElements = xmlDoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "r");

    for (let i = 0; i < runElements.length; i++) {
      const runElement = runElements[i];
      const run = parseRun(runElement);
      
      if (run && run.text.trim()) {
        runs.push(run);
      }
    }

    return runs;
  } catch (error) {
    console.error("Error parsing OpenXML:", error);
    throw new Error("Failed to parse Word document OpenXML");
  }
}

function parseRun(runElement: Element): ExtractedRun | null {
  const formatting: RunFormatting = {};
  let text = "";

  // Parse formatting properties (w:rPr)
  const rPr = runElement.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "rPr")[0];
  
  if (rPr) {
    // Bold
    const bold = rPr.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "b")[0];
    if (bold) {
      formatting.bold = true;
    }

    // Italic
    const italic = rPr.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "i")[0];
    if (italic) {
      formatting.italic = true;
    }

    // Underline
    const underline = rPr.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "u")[0];
    if (underline) {
      formatting.underline = true;
    }

    // Font size (w:sz)
    const sz = rPr.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "sz")[0];
    if (sz) {
      const val = sz.getAttribute("w:val");
      if (val) {
        formatting.fontSize = parseInt(val) / 2; // Half-points to points
      }
    }

    // Font family (w:rFonts)
    const rFonts = rPr.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "rFonts")[0];
    if (rFonts) {
      const ascii = rFonts.getAttribute("w:ascii");
      if (ascii) {
        formatting.fontFamily = ascii;
      }
    }

    // Color (w:color)
    const color = rPr.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "color")[0];
    if (color) {
      const val = color.getAttribute("w:val");
      if (val && val !== "auto") {
        formatting.color = `#${val}`;
      }
    }
  }

  // Extract text content (w:t elements)
  const textElements = runElement.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "t");
  
  for (let i = 0; i < textElements.length; i++) {
    text += textElements[i].textContent || "";
  }

  if (!text.trim()) {
    return null;
  }

  return { text, formatting };
}
