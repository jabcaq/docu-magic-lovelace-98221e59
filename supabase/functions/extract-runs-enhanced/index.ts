import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RunFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: string;
  fontFamily?: string;
  color?: string;
}

interface ExtractedRun {
  text: string;
  formatting: RunFormatting;
  paragraphIndex: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { storagePath } = await req.json();
    console.log(`Extracting runs from: ${storagePath}`);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (downloadError) throw downloadError;

    const runs = await extractRunsFromDocx(fileData);

    console.log(`Extracted ${runs.length} runs`);

    return new Response(
      JSON.stringify({ success: true, runs, count: runs.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error extracting runs:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function extractRunsFromDocx(file: Blob): Promise<ExtractedRun[]> {
  const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
  const zip = new JSZip();
  const content = await zip.loadAsync(await file.arrayBuffer());
  
  const documentXml = await content.file("word/document.xml")?.async("text");
  if (!documentXml) throw new Error("No document.xml found");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });

  const parsed = parser.parse(documentXml);
  const body = parsed["w:document"]?.["w:body"];
  if (!body) throw new Error("No body found in document");

  const runs: ExtractedRun[] = [];
  const paragraphs = Array.isArray(body["w:p"]) ? body["w:p"] : [body["w:p"]];

  paragraphs.forEach((paragraph: any, paraIndex: number) => {
    if (!paragraph) return;

    const paraRuns = Array.isArray(paragraph["w:r"]) 
      ? paragraph["w:r"] 
      : paragraph["w:r"] ? [paragraph["w:r"]] : [];

    paraRuns.forEach((run: any) => {
      if (!run) return;

      // Extract text
      const textElements = Array.isArray(run["w:t"]) 
        ? run["w:t"] 
        : run["w:t"] ? [run["w:t"]] : [];
      
      const text = textElements
        .map((t: any) => typeof t === 'string' ? t : t["#text"] || "")
        .join("");

      // Extract formatting
      const rPr = run["w:rPr"];
      const formatting: RunFormatting = {};

      if (rPr) {
        formatting.bold = !!rPr["w:b"];
        formatting.italic = !!rPr["w:i"];
        formatting.underline = !!rPr["w:u"];

        // Font size (in half-points)
        const sz = rPr["w:sz"];
        if (sz) {
          const sizeVal = sz["@_w:val"];
          if (sizeVal) {
            formatting.fontSize = `${parseInt(sizeVal) / 2}pt`;
          }
        }

        // Font family
        const rFonts = rPr["w:rFonts"];
        if (rFonts) {
          formatting.fontFamily = rFonts["@_w:ascii"] || rFonts["@_w:cs"];
        }

        // Color
        const color = rPr["w:color"];
        if (color) {
          const colorVal = color["@_w:val"];
          if (colorVal && colorVal !== "auto") {
            formatting.color = `#${colorVal}`;
          }
        }
      }

      runs.push({
        text,
        formatting,
        paragraphIndex: paraIndex,
      });
    });
  });

  return runs;
}
