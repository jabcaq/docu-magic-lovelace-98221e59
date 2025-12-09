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

interface AiMatchResult {
  templateTag: string;
  ocrTag: string | null;
  ocrValue: string | null;
  reasoning: string;
}

async function matchFieldsWithAI(
  templateTags: string[], 
  tagMetadata: TemplateTagMetadata,
  ocrFields: OcrField[]
): Promise<AiMatchResult[]> {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  
  if (!openRouterApiKey) {
    console.log("OPENROUTER_API_KEY not set, falling back to basic matching");
    return [];
  }

  console.log("Using AI to match OCR fields to template tags...");
  
  // Build prompt with template tags and OCR fields
  const templateTagsDescription = templateTags.map(tag => {
    const description = tagMetadata[tag] || tag;
    return `- {{${tag}}}: ${description}`;
  }).join('\n');

  const ocrFieldsDescription = ocrFields.map(field => {
    return `- tag: "${field.tag}", label: "${field.label}", value: "${field.value}", category: "${field.category}", confidence: "${field.confidence}"`;
  }).join('\n');

  const systemPrompt = `Jesteś ekspertem od dopasowywania pól z dokumentów OCR do zmiennych w szablonach dokumentów.
Twoje zadanie to przeanalizować listę zmiennych szablonu i pól wyekstrahowanych z OCR, a następnie dopasować je semantycznie.

Zasady dopasowania:
1. Dopasuj pola OCR do zmiennych szablonu na podstawie znaczenia, nie tylko nazwy
2. Np. "vin" z OCR może pasować do "VIN", "VIN_Number", "numer_vin" itp.
3. "importer_name" może pasować do "Nadawca", "Nazwa_firmy", "Importer" itp.
4. Uwzględnij kontekst - np. "data_faktury" to data wystawienia, nie termin płatności
5. Jeśli nie ma dobrego dopasowania dla zmiennej, zwróć null
6. Każde pole OCR może być użyte tylko raz`;

  const userPrompt = `Dopasuj pola OCR do zmiennych szablonu.

ZMIENNE SZABLONU:
${templateTagsDescription}

POLA OCR:
${ocrFieldsDescription}

Zwróć JSON w formacie:
{
  "matches": [
    {
      "templateTag": "nazwa_zmiennej_szablonu",
      "ocrTag": "tag_z_ocr_lub_null",
      "ocrValue": "wartość_z_ocr_lub_null",
      "reasoning": "krótkie wyjaśnienie dopasowania"
    }
  ]
}

Dla KAŻDEJ zmiennej szablonu musisz zwrócić wpis - nawet jeśli nie ma dopasowania (wtedy ocrTag i ocrValue = null).`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lovable.dev",
        "X-Title": "OCR Template Matcher",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter API error:", response.status, errorText);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("No content in AI response");
      return [];
    }

    console.log("AI matching response received, length:", content.length);
    
    const parsed = JSON.parse(content);
    return parsed.matches || [];
  } catch (error) {
    console.error("Error in AI matching:", error);
    return [];
  }
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

    console.log("Template tags:", templateTags.length);

    // Use AI to match fields
    const aiMatches = await matchFieldsWithAI(templateTags, tagMetadata, ocrFields as OcrField[]);
    console.log("AI matches:", aiMatches.length);

    // Build matched fields from AI results
    const matchedFields: MatchedField[] = [];
    const unmatchedTags: string[] = [];

    if (aiMatches.length > 0) {
      // Use AI matches
      for (const match of aiMatches) {
        if (match.ocrTag && match.ocrValue) {
          const ocrField = (ocrFields as OcrField[]).find(f => f.tag === match.ocrTag);
          matchedFields.push({
            templateTag: match.templateTag,
            ocrTag: match.ocrTag,
            ocrValue: match.ocrValue,
            ocrLabel: ocrField?.label || match.ocrTag,
            confidence: ocrField?.confidence || 'medium',
            matchType: 'ai_matched',
          });
        } else {
          unmatchedTags.push(match.templateTag);
        }
      }
    } else {
      // Fallback to basic matching
      for (const templateTag of templateTags) {
        let matchedOcrField = (ocrFields as OcrField[]).find(
          f => f.tag.toLowerCase() === templateTag.toLowerCase()
        );

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
        modifiedXml = replaceTagWithHighlightedValue(modifiedXml, tagPattern, field.ocrValue);
        replacements.push({ tag: field.templateTag, value: field.ocrValue });
      } else {
        // Tag might be split across runs - try to find and replace
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

    // Save filled document to storage for preview
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
    const storagePath = `filled/${user.id}/${timestamp}_${template.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`;
    
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, new Uint8Array(newDocxBuffer), {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });

    if (uploadError) {
      console.error("Failed to save filled document:", uploadError);
      // Don't fail the whole operation, just log it
    } else {
      console.log("Filled document saved to:", storagePath);
    }

    // Create filename
    const filename = `wypelniony_${template.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${timestamp}.docx`;

    console.log("Generated filled document:", filename, "size:", newDocxBuffer.byteLength);

    return new Response(
      JSON.stringify({ 
        success: true,
        base64: base64Docx,
        filename,
        storagePath,
        templateName: template.name,
        stats: {
          totalTemplateTags: templateTags.length,
          matchedFields: matchedFields.length,
          unmatchedTags: unmatchedTags.length,
          replacementsMade: replacements.length,
          aiMatchingUsed: aiMatches.length > 0,
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
    .replace(/[\u0300-\u036f]/g, "");
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
  const highlightedRun = createHighlightedRun(value);
  return xml.split(tag).join(highlightedRun);
}

function createHighlightedRun(value: string): string {
  const escapedValue = escapeXml(value);
  return `</w:t></w:r><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">${escapedValue}</w:t></w:r><w:r><w:t xml:space="preserve">`;
}
