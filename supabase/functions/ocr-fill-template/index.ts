import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OcrField {
  tag: string;
  label: string;
  value: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
}

interface TemplateTagMetadata {
  [tagName: string]: string;
}

interface MatchedField {
  templateTag: string;
  ocrTag: string;
  ocrValue: string;
  ocrLabel: string;
  confidence: string;
  matchType: 'exact' | 'similar' | 'ai_matched';
}

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
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { templateId, ocrFields } = await req.json();

    console.log("Filling template:", { templateId, fieldsCount: ocrFields?.length });

    if (!templateId || !ocrFields) {
      throw new Error("templateId and ocrFields are required");
    }

    // Fetch template
    const { data: template, error: templateError } = await supabase
      .from("templates")
      .select("*")
      .eq("id", templateId)
      .single();

    if (templateError || !template) {
      throw new Error(`Template not found: ${templateError?.message}`);
    }

    console.log("Template found:", template.name, "path:", template.storage_path);

    const tagMetadata: TemplateTagMetadata = template.tag_metadata || {};
    const templateTags = Object.keys(tagMetadata);

    console.log("Template tags:", templateTags);

    // Match OCR fields to template tags
    const matchedFields: MatchedField[] = [];
    const unmatchedTags: string[] = [];

    for (const templateTag of templateTags) {
      // Try exact match first
      let matchedOcrField = (ocrFields as OcrField[]).find(
        f => f.tag.toLowerCase() === templateTag.toLowerCase()
      );

      // If no exact match, try similar names
      if (!matchedOcrField) {
        matchedOcrField = (ocrFields as OcrField[]).find(f => {
          const normalizedTemplateTag = normalizeTag(templateTag);
          const normalizedOcrTag = normalizeTag(f.tag);
          return normalizedTemplateTag === normalizedOcrTag ||
            normalizedTemplateTag.includes(normalizedOcrTag) ||
            normalizedOcrTag.includes(normalizedTemplateTag);
        });
      }

      if (matchedOcrField) {
        matchedFields.push({
          templateTag,
          ocrTag: matchedOcrField.tag,
          ocrValue: matchedOcrField.value,
          ocrLabel: matchedOcrField.label,
          confidence: matchedOcrField.confidence,
          matchType: matchedOcrField.tag.toLowerCase() === templateTag.toLowerCase() 
            ? 'exact' 
            : 'similar',
        });
      } else {
        unmatchedTags.push(templateTag);
      }
    }

    console.log("Matched fields:", matchedFields.length);
    console.log("Unmatched tags:", unmatchedTags.length);

    // Download template DOCX
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(template.storage_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download template: ${downloadError?.message}`);
    }

    // Import JSZip
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    
    const zip = await JSZip.loadAsync(fileData);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    
    if (!documentXml) {
      throw new Error("Could not find word/document.xml in the template");
    }

    console.log("Template XML loaded, length:", documentXml.length);

    // Replace template tags with OCR values and add yellow highlighting
    let modifiedXml = documentXml;
    const replacements: Array<{tag: string; value: string}> = [];

    for (const field of matchedFields) {
      const tagPattern = `{{${field.templateTag}}}`;
      
      if (modifiedXml.includes(tagPattern)) {
        // Replace the tag with highlighted value
        modifiedXml = replaceTagWithHighlightedValue(modifiedXml, tagPattern, field.ocrValue);
        replacements.push({ tag: field.templateTag, value: field.ocrValue });
      } else {
        // Tag might be split across runs - try to find and replace
        const escaped = escapeRegExp(tagPattern);
        const splitPattern = new RegExp(escaped.split('').join('[^<]*'), 'g');
        
        // Also try simple pattern matching
        const simpleTagRegex = new RegExp(`\\{\\{\\s*${escapeRegExp(field.templateTag)}\\s*\\}\\}`, 'gi');
        if (simpleTagRegex.test(modifiedXml)) {
          modifiedXml = modifiedXml.replace(simpleTagRegex, () => {
            replacements.push({ tag: field.templateTag, value: field.ocrValue });
            return createHighlightedRun(field.ocrValue);
          });
        }
      }
    }

    console.log("Replacements made:", replacements.length);

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

    // Create filename
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `wypelniony_${template.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${timestamp}.docx`;

    console.log("Generated filled document:", filename, "size:", newDocxBuffer.byteLength);

    return new Response(
      JSON.stringify({ 
        success: true,
        base64: base64Docx,
        filename,
        stats: {
          totalTemplateTags: templateTags.length,
          matchedFields: matchedFields.length,
          unmatchedTags: unmatchedTags.length,
          replacementsMade: replacements.length,
        },
        matchedFields,
        unmatchedTags,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in ocr-fill-template:", error);
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

function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/-/g, '')
    .replace(/\s+/g, '')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Remove diacritics
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function replaceTagWithHighlightedValue(xml: string, tag: string, value: string): string {
  // Replace the tag wherever it appears with a highlighted run
  const highlightedRun = createHighlightedRun(value);
  return xml.split(tag).join(highlightedRun);
}

function createHighlightedRun(value: string): string {
  // Create an OpenXML run with yellow highlighting
  // Yellow highlight color in Word is "yellow" or RGB value
  const escapedValue = escapeXml(value);
  
  // Just return the value with inline highlighting markup
  // The highlighting will be applied when this text is rendered
  return `</w:t></w:r><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">${escapedValue}</w:t></w:r><w:r><w:t xml:space="preserve">`;
}
