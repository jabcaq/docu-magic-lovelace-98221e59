import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { storagePath, newRunTexts } = await req.json();

    console.log("Rebuilding DOCX with variables:", { storagePath, textsCount: newRunTexts.length });

    // Download original DOCX from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(storagePath);

    if (downloadError) {
      console.error("Download error:", downloadError);
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    // Import JSZip dynamically
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    
    const zip = await JSZip.loadAsync(fileData);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    
    if (!documentXml) {
      throw new Error("Could not find word/document.xml in the DOCX file");
    }

    console.log("Original XML length:", documentXml.length);

    // Replace text in runs while preserving formatting
    const modifiedXml = replaceRunTexts(documentXml, newRunTexts);

    console.log("Modified XML length:", modifiedXml.length);

    // Update the document.xml in the zip
    zip.file("word/document.xml", modifiedXml);

    // Generate new DOCX
    const newDocxBuffer = await zip.generateAsync({ type: "arraybuffer" });
    const base64Docx = btoa(
      new Uint8Array(newDocxBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ""
      )
    );

    console.log("New DOCX generated, size:", newDocxBuffer.byteLength);

    return new Response(
      JSON.stringify({ 
        success: true,
        base64: base64Docx,
        filename: "document_with_variables.docx"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in rebuild-docx-with-variables:", error);
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

function replaceRunTexts(xml: string, newTexts: string[]): string {
  let textIndex = 0;
  let result = xml;
  
  // Find all <w:t> elements and replace their content
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  result = result.replace(regex, (match, oldText) => {
    if (textIndex >= newTexts.length) {
      return match; // Keep original if we run out of new texts
    }
    
    const newText = newTexts[textIndex];
    textIndex++;
    
    // Preserve the w:t attributes (like xml:space="preserve")
    const openTag = match.substring(0, match.indexOf('>') + 1);
    const closeTag = '</w:t>';
    
    // Escape XML special characters
    const escapedText = escapeXml(newText);
    
    return `${openTag}${escapedText}${closeTag}`;
  });
  
  console.log(`Replaced ${textIndex} text elements`);
  
  return result;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
