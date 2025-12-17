import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { XMLParser, XMLBuilder } from "https://esm.sh/fast-xml-parser@5.3.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============= Interfaces =============

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

interface ExtractedRun {
  id: string;
  text: string;
}

interface ExtractedParagraph {
  paragraph_id: string;
  debug_path: string;
  full_text_context: string;
  runs: ExtractedRun[];
}

interface TagMapping {
  tag: string;           // np. "VIN"
  runId: string;         // np. "044526E9-0"
  originalText: string;  // "{{VIN}}" lub "{{VIN}}" z otaczającym tekstem
  fullRunText: string;   // Pełny tekst runa
}

interface RunChangeWithHighlight {
  id: string;
  originalText: string;
  newText: string;
  highlight: boolean;
}

// ============= XML Helper Functions (from Word Templater) =============

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function walkBody(body: any, cb: (paragraph: any, path: string) => void) {
  const paragraphs = normalizeArray(body["w:p"]);
  paragraphs.forEach((p, idx) => cb(p, `P${idx}`));

  const tables = normalizeArray(body["w:tbl"]);
  tables.forEach((tbl, tblIdx) => walkTable(tbl, `T${tblIdx}`, cb));
}

function walkTable(tbl: any, prefix: string, cb: (paragraph: any, path: string) => void) {
  const rows = normalizeArray(tbl?.["w:tr"]);
  rows.forEach((row, rowIdx) => {
    const cells = normalizeArray(row?.["w:tc"]);
    cells.forEach((cell, cellIdx) => {
      const cellParas = normalizeArray(cell?.["w:p"]);
      cellParas.forEach((p, pIdx) => cb(p, `${prefix}:R${rowIdx}:C${cellIdx}:P${pIdx}`));

      const nestedTables = normalizeArray(cell?.["w:tbl"]);
      nestedTables.forEach((nested, nestedIdx) =>
        walkTable(nested, `${prefix}:R${rowIdx}:C${cellIdx}:T${nestedIdx}`, cb)
      );
    });
  });
}

function extractParagraphs(documentXml: string): ExtractedParagraph[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseTagValue: false,
  });

  const parsed = parser.parse(documentXml);
  const body = parsed["w:document"]?.["w:body"];

  if (!body) return [];

  const paragraphs: ExtractedParagraph[] = [];

  const handleParagraph = (p: any, debugPath: string) => {
    if (!p) return;
    const stableId = p["@_w14:paraId"] || debugPath;
    const runs = normalizeArray(p["w:r"]);

    const paragraphData: ExtractedParagraph = {
      paragraph_id: stableId,
      debug_path: debugPath,
      full_text_context: "",
      runs: [],
    };

    runs.forEach((run: any, runIndex: number) => {
      const textElements = normalizeArray(run?.["w:t"]);
      let text = textElements
        .map((t: any) => {
          if (typeof t === "string") return t;
          if (t && typeof t === "object") return t["#text"] || "";
          return "";
        })
        .join("");

      if (!text) return;

      if (run["w:tab"]) {
        paragraphData.full_text_context += " ";
      }

      paragraphData.full_text_context += text;
      paragraphData.runs.push({
        id: `${stableId}-${runIndex}`,
        text,
      });
    });

    if (paragraphData.runs.length > 0) {
      paragraphs.push(paragraphData);
    }
  };

  walkBody(body, handleParagraph);
  return paragraphs;
}

// ============= Tag Mapping Functions =============

function mapTagsToRunIds(documentXml: string): TagMapping[] {
  const paragraphs = extractParagraphs(documentXml);
  const mappings: TagMapping[] = [];
  
  // Regex to find {{tag}} patterns
  const tagRegex = /\{\{([^}]+)\}\}/g;
  
  for (const para of paragraphs) {
    // First check if paragraph contains any tags
    const fullText = para.full_text_context;
    const tagsInParagraph: string[] = [];
    let match;
    
    while ((match = tagRegex.exec(fullText)) !== null) {
      tagsInParagraph.push(match[1]);
    }
    tagRegex.lastIndex = 0; // Reset regex
    
    if (tagsInParagraph.length === 0) continue;
    
    // Now find which runs contain these tags
    for (const run of para.runs) {
      const runTagMatch = run.text.match(/\{\{([^}]+)\}\}/);
      if (runTagMatch) {
        mappings.push({
          tag: runTagMatch[1],
          runId: run.id,
          originalText: runTagMatch[0], // {{tag}}
          fullRunText: run.text,
        });
      }
    }
    
    // Handle split tags across runs (tag split into multiple runs)
    // Check if concatenated runs form a complete tag
    let concatenated = "";
    let startRunIndex = -1;
    
    for (let i = 0; i < para.runs.length; i++) {
      const run = para.runs[i];
      
      // Check if this run starts a potential tag
      if (run.text.includes("{{") && !run.text.includes("}}")) {
        concatenated = run.text;
        startRunIndex = i;
      } else if (startRunIndex >= 0) {
        concatenated += run.text;
        
        // Check if we now have a complete tag
        const completeTagMatch = concatenated.match(/\{\{([^}]+)\}\}/);
        if (completeTagMatch) {
          // Tag was split - map to the first run containing {{
          const existingMapping = mappings.find(m => m.tag === completeTagMatch[1]);
          if (!existingMapping) {
            mappings.push({
              tag: completeTagMatch[1],
              runId: para.runs[startRunIndex].id,
              originalText: completeTagMatch[0],
              fullRunText: concatenated,
            });
          }
          
          // Mark subsequent runs as needing to be cleared
          for (let j = startRunIndex + 1; j <= i; j++) {
            const existingClearMapping = mappings.find(m => m.runId === para.runs[j].id);
            if (!existingClearMapping) {
              mappings.push({
                tag: `__CLEAR_${completeTagMatch[1]}_${j}`,
                runId: para.runs[j].id,
                originalText: para.runs[j].text,
                fullRunText: para.runs[j].text,
              });
            }
          }
          
          concatenated = "";
          startRunIndex = -1;
        }
      }
    }
  }
  
  console.log(`Found ${mappings.length} tag mappings in template`);
  return mappings;
}

// ============= Apply Changes with Highlighting =============

function applyChangesToXmlWithHighlight(
  documentXml: string, 
  changes: RunChangeWithHighlight[]
): { newXml: string; appliedCount: number } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseTagValue: false,
  });

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    format: false,
    suppressEmptyNode: false,
  });

  const parsed = parser.parse(documentXml);
  const body = parsed["w:document"]?.["w:body"];
  if (!body) throw new Error("Document body missing");

  const changesMap = new Map<string, RunChangeWithHighlight>();
  changes.forEach((change) => changesMap.set(change.id, change));

  let applied = 0;

  const handleParagraph = (p: any, debugPath: string) => {
    if (!p) return;
    const stableId = p["@_w14:paraId"] || debugPath;
    const runs = normalizeArray(p["w:r"]);

    runs.forEach((run: any, runIndex: number) => {
      const runId = `${stableId}-${runIndex}`;
      const change = changesMap.get(runId);
      if (!change) return;

      // Add yellow highlight to run properties if needed
      if (change.highlight && change.newText !== "") {
        if (!run["w:rPr"]) {
          run["w:rPr"] = {};
        }
        run["w:rPr"]["w:highlight"] = { "@_w:val": "yellow" };
      }

      // Update text content
      const textElements = normalizeArray(run?.["w:t"]);
      if (textElements.length === 0) {
        if (change.newText !== "") {
          run["w:t"] = { "#text": change.newText, "@_xml:space": "preserve" };
        }
        applied++;
        return;
      }

      if (typeof run["w:t"] === "string") {
        run["w:t"] = change.newText;
      } else if (Array.isArray(run["w:t"])) {
        if (change.newText === "") {
          run["w:t"] = [];
        } else {
          run["w:t"] = [{ "#text": change.newText, "@_xml:space": "preserve" }];
        }
      } else if (run["w:t"] && typeof run["w:t"] === "object") {
        run["w:t"]["#text"] = change.newText;
        if (change.newText !== "") {
          run["w:t"]["@_xml:space"] = "preserve";
        }
      }
      applied++;
    });
  };

  walkBody(body, handleParagraph);

  const newXml = builder.build(parsed);
  return { newXml, appliedCount: applied };
}

// ============= AI Matching Function =============

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

// ============= Helper Functions =============

function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/-/g, '')
    .replace(/\s+/g, '')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ============= Main Handler =============

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

    const zip = await JSZip.loadAsync(fileData);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    
    if (!documentXml) {
      throw new Error("Could not find word/document.xml in the template");
    }

    console.log("Template XML loaded, length:", documentXml.length);

    // ========== NEW: Precise runId-based replacement ==========
    
    // Step 1: Map all {{tags}} to their runIds
    const tagMappings = mapTagsToRunIds(documentXml);
    console.log("Tag mappings found:", tagMappings.length);
    
    // Step 2: Build changes array based on matched fields
    const changes: RunChangeWithHighlight[] = [];
    const replacements: Array<{tag: string; value: string; runId: string}> = [];
    
    for (const field of matchedFields) {
      // Find mapping for this template tag
      const mapping = tagMappings.find(m => m.tag === field.templateTag);
      
      if (mapping) {
        // Calculate new text - replace only the {{tag}} portion
        let newText: string;
        if (mapping.fullRunText === mapping.originalText) {
          // Run contains only the tag
          newText = field.ocrValue;
        } else {
          // Run contains tag + other text - replace just the tag
          newText = mapping.fullRunText.replace(mapping.originalText, field.ocrValue);
        }
        
        changes.push({
          id: mapping.runId,
          originalText: mapping.fullRunText,
          newText: newText,
          highlight: true,
        });
        
        replacements.push({ 
          tag: field.templateTag, 
          value: field.ocrValue, 
          runId: mapping.runId 
        });
        
        // Handle split tags - clear subsequent runs
        const clearMappings = tagMappings.filter(m => 
          m.tag.startsWith(`__CLEAR_${field.templateTag}_`)
        );
        for (const clearMapping of clearMappings) {
          changes.push({
            id: clearMapping.runId,
            originalText: clearMapping.fullRunText,
            newText: "",
            highlight: false,
          });
        }
      } else {
        console.log(`No runId mapping found for tag: ${field.templateTag}`);
      }
    }

    console.log("Changes to apply:", changes.length);

    // Step 3: Apply changes with highlighting
    let newXml: string;
    let appliedCount: number;
    
    if (changes.length > 0) {
      const result = applyChangesToXmlWithHighlight(documentXml, changes);
      newXml = result.newXml;
      appliedCount = result.appliedCount;
    } else {
      newXml = documentXml;
      appliedCount = 0;
    }

    console.log("Replacements applied:", appliedCount);

    // Update the document.xml in the zip
    zip.file("word/document.xml", newXml);

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
          replacementsMade: appliedCount,
          aiMatchingUsed: aiMatches.length > 0,
          runIdMappingsFound: tagMappings.length,
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
