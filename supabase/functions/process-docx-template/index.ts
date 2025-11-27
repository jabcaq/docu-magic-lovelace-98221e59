import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedTextNode {
  index: number;
  text: string;
  xpath: string; // Position marker for reconstruction
}

interface RunFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: string;
  fontFamily?: string;
  color?: string;
}

interface ExtractedRun {
  index: number;
  text: string;
  formatting: RunFormatting;
  paragraphIndex: number;
  runXml: string; // Full XML of the run for later replacement
  textNodeStartIndex: number; // Position in original XML
  textNodeEndIndex: number;
}

interface ProcessedVariable {
  originalText: string;
  tag: string;
  variableName: string;
  index: number;
}

Deno.serve(async (req) => {
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
    const openRouterApiKey = Deno.env.get("OPEN_ROUTER_API_KEY");
    
    if (!openRouterApiKey) {
      throw new Error("OPEN_ROUTER_API_KEY not configured");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

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

    console.log("=== Processing DOCX Template ===");
    console.log("Document ID:", documentId);
    console.log("AI Provider: OpenRouter (automatic)");

    // Get document info
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("storage_path, name, type")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    // Download original DOCX from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError || !fileData) {
      throw new Error("Failed to download document");
    }

    console.log("✓ File downloaded:", document.name);

    // Load DOCX as ZIP
    const arrayBuffer = await fileData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // Extract document.xml
    const documentXmlFile = zip.file("word/document.xml");
    if (!documentXmlFile) {
      throw new Error("Invalid DOCX: document.xml not found");
    }
    
    const originalXml = await documentXmlFile.async("text");
    console.log("✓ XML extracted, length:", originalXml.length);

    // Extract runs with formatting (optimized approach)
    const runs = extractRuns(originalXml);
    console.log("✓ Extracted", runs.length, "runs with formatting");

    if (runs.length === 0) {
      throw new Error("No text content found in document");
    }

    // Step 1: Call AI to identify variables (run-based analysis with formatting context)
    console.log("→ Step 1: Run-based AI analysis with formatting context...");
    const { processedRuns, aiResponse } = await analyzeWithAI(
      runs, 
      openRouterApiKey
    );
    console.log("✓ Step 1 complete: Run-based analysis done");

    // Identify which runs were converted to variables
    const variables: ProcessedVariable[] = [];
    const runToTagMap: Map<number, string> = new Map();

    for (let i = 0; i < runs.length; i++) {
      const original = runs[i].text;
      const processed = processedRuns[i].text;
      
      if (original !== processed && processed.includes("{{") && processed.includes("}}")) {
        const tagMatch = processed.match(/\{\{(\w+)\}\}/);
        if (tagMatch) {
          variables.push({
            originalText: original,
            tag: processed,
            variableName: tagMatch[1],
            index: i
          });
          runToTagMap.set(i, processed);
        }
      }
    }

    console.log("✓ Found", variables.length, "variables");

    // Step 2: Modify XML with first round of variables (preserving run structure)
    console.log("→ Step 2: Applying run-based variables to XML (preserving formatting)...");
    let modifiedXml = replaceTextInRuns(originalXml, runs, runToTagMap);
    console.log("✓ Step 2 complete: XML modified with run-based variables");

    // Update the document.xml in the ZIP temporarily
    zip.file("word/document.xml", modifiedXml);

    // Generate intermediate DOCX for visual verification
    const intermediateDocxBase64 = await zip.generateAsync({ type: "base64" });
    console.log("✓ Intermediate DOCX generated for visual verification");

    // Step 3: Visual verification with Gemini 2.5 Pro
    console.log("→ Step 3: Visual verification with Gemini 2.5 Pro...");
    let visualVariables: Array<{ text: string; tag: string }> = [];
    
    try {
      // Convert DOCX to images
      const { data: convertData, error: convertError } = await supabase.functions.invoke("convert-docx-to-images", {
        body: { docxBase64: intermediateDocxBase64 },
        headers: { Authorization: authHeader }
      });

      if (convertError) {
        console.warn("⚠️ Convert to images error:", convertError);
        throw convertError;
      }

      if (convertData?.success && convertData.images?.length > 0) {
        console.log(`✓ Converted to ${convertData.images.length} page images`);

        // Verify visually
        const { data: verifyData, error: verifyError } = await supabase.functions.invoke("verify-document-visually", {
          body: { 
            documentId,
            pageImages: convertData.images 
          },
          headers: { Authorization: authHeader }
        });

        if (verifyError) {
          console.warn("⚠️ Visual verification error:", verifyError);
          throw verifyError;
        }

        if (verifyData?.success && verifyData.variables?.length > 0) {
          visualVariables = verifyData.variables;
          console.log(`✓ Step 3 complete: Found ${visualVariables.length} additional variables via visual analysis`);
          
          // Apply visual variables to XML
          // Find and replace the visual variables in the XML
          for (const vVar of visualVariables) {
            // Search for the text in XML and replace with tag
            const escapedText = encodeXmlEntities(vVar.text);
            const escapedTag = encodeXmlEntities(vVar.tag);
            
            // Replace in XML (simple text replacement for now)
            modifiedXml = modifiedXml.replace(
              new RegExp(escapedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
              escapedTag
            );
          }
          
          console.log("✓ Applied visual variables to XML");
        } else {
          console.log("✓ Step 3 complete: No additional variables found via visual analysis");
        }
      } else if (convertData?.skipped) {
        console.log("⚠️ Step 3 skipped: Image conversion service not configured");
      } else {
        console.log("⚠️ Step 3 skipped: Could not convert DOCX to images");
      }
    } catch (visualError) {
      console.warn("⚠️ Visual verification failed, continuing with run-based analysis only:", visualError);
      // Continue without visual verification
    }

    // Update the document.xml in the ZIP with final version (including visual variables)
    zip.file("word/document.xml", modifiedXml);

    // Generate the final DOCX
    const finalDocxBase64 = await zip.generateAsync({ type: "base64" });
    console.log("✓ Final DOCX generated");

    // Store the modified XML in database
    const { error: updateError } = await supabase
      .from("documents")
      .update({ 
        xml_content: modifiedXml,
        status: "verified",
        html_cache: null
      })
      .eq("id", documentId);

    if (updateError) {
      console.error("Error updating document:", updateError);
    }

    // Merge visual variables with text-based variables
    const allVariables = [...variables];
    
    // Add visual variables (avoid duplicates)
    const existingTags = new Set(variables.map(v => v.tag));
    for (const vVar of visualVariables) {
      if (!existingTags.has(vVar.tag)) {
        const tagMatch = vVar.tag.match(/\{\{(\w+)\}\}/);
        if (tagMatch) {
          allVariables.push({
            originalText: vVar.text,
            tag: vVar.tag,
            variableName: tagMatch[1],
            index: -1 // Visual variables don't have text node index
          });
          existingTags.add(vVar.tag);
        }
      }
    }

    // Save all fields to database
    if (allVariables.length > 0) {
      // First, delete existing fields
      await supabase
        .from("document_fields")
        .delete()
        .eq("document_id", documentId);

      // Insert new fields
      const fieldsToInsert = allVariables
        .filter(v => v.index >= 0) // Only text-based for now (visual need different handling)
        .map((v, i) => ({
          document_id: documentId,
          field_name: v.variableName,
          field_value: v.originalText,
          field_tag: v.tag,
          position_in_html: v.index >= 0 ? v.index : i + variables.length
        }));

      const { error: insertError } = await supabase
        .from("document_fields")
        .insert(fieldsToInsert);

      if (insertError) {
        console.error("Error saving fields:", insertError);
      } else {
        console.log("✓ Saved", fieldsToInsert.length, "fields to database");
      }
    }

    // Prepare filename
    const originalName = document.name || "document.docx";
    const nameWithoutExt = originalName.replace(/\.docx$/i, '');
    const templateFilename = `${nameWithoutExt}_szablon.docx`;

    return new Response(
      JSON.stringify({
        success: true,
        templateBase64: finalDocxBase64,
        templateFilename,
        variables: allVariables.map(v => ({
          name: v.variableName,
          tag: v.tag,
          originalValue: v.originalText,
          source: v.index >= 0 ? "text" : "visual"
        })),
        variableCount: allVariables.length,
        textBasedCount: variables.length,
        visualCount: visualVariables.length,
        totalRuns: runs.length,
        aiResponse: aiResponse // Dodajemy odpowiedź z Gemini
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("❌ Error processing template:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage, success: false }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Extract all runs (<w:r>) with formatting from the XML
 * This preserves formatting information for better AI analysis
 */
function extractRuns(xml: string): ExtractedRun[] {
  const runs: ExtractedRun[] = [];
  
  // Regex patterns
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  let paragraphIndex = 0;
  let runIndex = 0;
  let match: RegExpExecArray | null;
  
  // Extract all paragraphs
  const paragraphMatches = [...xml.matchAll(paragraphRegex)];
  
  for (const paraMatch of paragraphMatches) {
    const paraContent = paraMatch[1];
    const runMatches = [...paraContent.matchAll(runRegex)];
    
    for (const runMatch of runMatches) {
      const runXml = runMatch[0];
      const runContent = runMatch[1];
      
      // Extract all text nodes from this run
      const textMatches = [...runContent.matchAll(textRegex)];
      let fullText = '';
      
      for (const textMatch of textMatches) {
        const text = decodeXmlEntities(textMatch[1]);
        fullText += text;
      }
      
      // Skip empty runs
      if (!fullText.trim()) continue;
      
      // Extract formatting
      const formatting = extractFormatting(runXml);
      
      // Find position of first text node in original XML
      const runStartInPara = paraContent.indexOf(runXml);
      const paraStart = paraMatch.index!;
      const runStart = paraStart + paraMatch[0].indexOf(runXml);
      
      runs.push({
        index: runIndex++,
        text: fullText,
        formatting,
        paragraphIndex,
        runXml,
        textNodeStartIndex: runStart,
        textNodeEndIndex: runStart + runXml.length
      });
    }
    
    paragraphIndex++;
  }
  
  return runs;
}

/**
 * Extract formatting information from a run XML
 */
function extractFormatting(runXml: string): RunFormatting {
  const formatting: RunFormatting = {};
  
  // Bold
  if (/<w:b\b[^>]*\/>|<w:b\b[^>]*>/.test(runXml)) {
    formatting.bold = true;
  }
  
  // Italic
  if (/<w:i\b[^>]*\/>|<w:i\b[^>]*>/.test(runXml)) {
    formatting.italic = true;
  }
  
  // Underline
  if (/<w:u\b[^>]*\/>|<w:u\b[^>]*>/.test(runXml)) {
    formatting.underline = true;
  }
  
  // Font size (in half-points, convert to points)
  const szMatch = runXml.match(/<w:sz[^>]*w:val="(\d+)"/);
  if (szMatch) {
    formatting.fontSize = `${parseInt(szMatch[1]) / 2}pt`;
  }
  
  // Font family
  const fontMatch = runXml.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/);
  if (fontMatch) {
    formatting.fontFamily = fontMatch[1];
  }
  
  // Color
  const colorMatch = runXml.match(/<w:color[^>]*w:val="([^"]+)"/);
  if (colorMatch && colorMatch[1] !== 'auto') {
    formatting.color = `#${colorMatch[1]}`;
  }
  
  return formatting;
}

/**
 * Replace text content in <w:t> tags within runs, preserving run structure and formatting
 * This is the CRITICAL function - it preserves ALL XML structure including formatting
 */
function replaceTextInRuns(
  xml: string,
  runs: ExtractedRun[],
  replacements: Map<number, string>
): string {
  let result = xml;
  
  // Process runs in reverse order to preserve positions
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    const replacement = replacements.get(i);
    
    if (replacement !== undefined) {
      // Replace only the text content in <w:t> tags, preserve the entire run structure
      const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
      const newRunXml = run.runXml.replace(textRegex, (match, textContent) => {
        // Only replace if this text matches the run's text
        const decodedText = decodeXmlEntities(textContent);
        if (decodedText === run.text || run.text.includes(decodedText)) {
          const newText = encodeXmlEntities(replacement);
          // Preserve the opening tag attributes
          const openTagMatch = match.match(/<w:t(?:\s[^>]*)?>/) as RegExpMatchArray;
          const openTag = openTagMatch[0];
          return `${openTag}${newText}</w:t>`;
        }
        return match;
      });
      
      // Replace the entire run in the XML
      result = result.substring(0, run.textNodeStartIndex) + 
               newRunXml + 
               result.substring(run.textNodeEndIndex);
    }
  }
  
  return result;
}

/**
 * Decode XML entities to normal characters
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Encode special characters to XML entities
 */
function encodeXmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Call AI to analyze runs with formatting context and identify variables
 * Uses OpenRouter with Gemini 2.5 Pro
 */
async function analyzeWithAI(
  runs: ExtractedRun[],
  openRouterKey: string
): Promise<{ processedRuns: ExtractedRun[]; aiResponse: string }> {
  
  // Prepare texts with formatting context for AI
  const textsWithContext = runs.map((run, idx) => {
    const formatInfo: string[] = [];
    if (run.formatting.bold) formatInfo.push('bold');
    if (run.formatting.italic) formatInfo.push('italic');
    if (run.formatting.underline) formatInfo.push('underline');
    if (run.formatting.fontSize) formatInfo.push(`size:${run.formatting.fontSize}`);
    if (run.formatting.fontFamily) formatInfo.push(`font:${run.formatting.fontFamily}`);
    if (run.formatting.color) formatInfo.push(`color:${run.formatting.color}`);
    
    const context = formatInfo.length > 0 ? ` [${formatInfo.join(',')}]` : '';
    return run.text + context;
  });
  
  // Extract just texts for output (without context)
  const texts = runs.map(r => r.text);
  
  const systemPrompt = `Jesteś ekspertem od analizy dokumentów celnych, samochodowych i administracyjnych.

ZADANIE: Zwróć DOKŁADNIE ten sam array tekstów, ale zamień TYLKO dane zmienne na placeholdery {{nazwaZmiennej}}.

⚠️ UWAGA: Teksty mogą mieć kontekst formatowania w formacie [bold,italic,size:12pt,font:Arial,color:#000000] - użyj tego do lepszej identyfikacji zmiennych.
Na przykład: nagłówki są często bold, daty w określonym formacie, ważne informacje mogą być podkreślone, itp.
KONTEKST FORMATOWANIA POMAGA ROZPOZNAĆ ZMIENNE - ale w output zwróć TYLKO tekst lub {{tag}} (bez kontekstu formatowania).

═══════════════════════════════════════════════════════════════════════
⚠️ KRYTYCZNE: WARTOŚCI STAŁE - NIGDY NIE ZAMIENIAJ (powtarzają się identycznie we wszystkich dokumentach):
═══════════════════════════════════════════════════════════════════════

STAŁE FIRMY/PRZEDSTAWICIELE (występują w każdym dokumencie):
- "MARLOG CAR HANDLING BV", "MARLOG CAR HANDLING"
- "SMOORSTRAAT 24", "SMOORSTRAAT"
- "ROOSENDAAL", "NL-4705 AA ROOSENDAAL"
- "NL006223527", "006223527" (numer celny przedstawiciela)
- "LEAN CUSTOMS B.V."
- "MLG INTERNATIONAL S.A."

STAŁE NAGŁÓWKI/ETYKIETY (formularze):
- "Data:", "Nazwa:", "Adres:", "Miejscowość:", "Numer celny:"
- "Zgłaszający", "Przedstawiciel", "Nadawca/Eksporter"
- "VIN:", "MRN:", "Numer deklaracji:", "Artykuł:"
- "WSPÓLNOTA EUROPEJSKA", "EGZEMPLARZ TRANSPORTOWY IMPORTU"
- "KONTROLA PRZEZ URZĄD WYJŚCIA", "KONTROLA PO WYŁADOWANIU"
- "Należne", "Do zapłaty", "Zabezpieczenie", "Łącznie"

STAŁE KODY I NUMERY (identyczne we wszystkich dokumentach):
- "87032490", "87032490000000000000", "8703239000", "87032390000000000000" (kody towarowe)
- "N935", "N821", "Y923", "792", "160" (kody formularzy)
- "EUR", "PL", "NL", "DE", "BE" (kody krajów/walut)
- "10", "21" (stawki VAT/cła)
- "IM", "A", "IM-A" (typy deklaracji)
- "[kod kreskowy]"

STAŁE ADRESY URZĘDÓW:
- "Skrytka pocztowa 3070", "6401 DN Heerlen"
- "Urząd Skarbowy/Urząd Celny"

═══════════════════════════════════════════════════════════════════════
✅ DANE ZMIENNE - ZAMIENIAJ NA {{tagi}} (różnią się między dokumentami):
═══════════════════════════════════════════════════════════════════════

1. VIN (17 znaków, unikalne) → {{vinNumber}}
   Przykłady: "WAUENCF57JA005040", "1C4SDJH91PC687665", "WMZ83BR06P3R14626"

2. MRN (numer celny, format: 2cyfry+2litery+reszta) → {{mrnNumber}}
   Przykłady: "25NL7PU1EYHFR8FDR4", "25BE000000709313J0"

3. DATY (różne formaty) → {{issueDate}}, {{acceptanceDate}}
   Przykłady: "09-07-2025", "2025-04-21", "14.01.2025"

4. KWOTY Z WALUTĄ → {{customsValue}}, {{vatAmount}}, {{dutyAmount}}, {{totalAmount}}
   Przykłady: "9.775,81 EUR", "2.258,21 EUR", "977,58 EUR"

5. IMIONA I NAZWISKA KLIENTÓW → {{declarantName}}, {{ownerName}}, {{buyerName}}
   Przykłady: "KUBICZ DANIEL", "Jan Kowalski", "TOMASZ DUDA"

6. ADRESY KLIENTÓW → {{declarantAddress}}, {{ownerAddress}}
   Przykłady: "DOROTOWSKA 2/20", "ul. Zielona 15", "WOLKA KLUCKA 233"

7. MIASTA KLIENTÓW → {{declarantCity}}, {{ownerCity}}
   Przykłady: "WARSZAWA", "MNIOW", "WADOWICE GORNE"

8. KODY POCZTOWE KLIENTÓW → {{postalCode}}
   Przykłady: "00-123", "26-080", "28-210"

9. NUMERY REFERENCYJNE (unikalne) → {{referenceNumber}}, {{shipmentNumber}}
   Przykłady: "MCH-SI-078956", "687665"

10. OPIS POJAZDU → {{vehicleDescription}}
    Przykłady: "2023 DODGE DURANGO VIN: 1C4SDJH91PC687665", "2018 AUDI A5 VIN: WAUENCF57JA005040"

11. NUMERY KONTENERÓW (4 litery + 7 cyfr) → {{containerNumber}}
    Przykłady: "BEAU5658460", "TCNU7942617", "MSMU5801360", "EISU9394456"

    KOMBINACJA KONTENER / VIN → {{containerVin}}
    Przykłady: "BEAU5658460 / WAUENCF57JA005040", "MSMU5801360 / 3C6RR7KT6EG245165"

12. NAZWY STATKÓW → {{vesselName}}
    Przykłady: "MSC CORUNA", "MSC BHAVYA V", "COSCO HOPE", "EVER FOREVER", "MAERSK SEVILLE"

13. NUMERY PRZESYŁEK → {{shipmentNumber}}
    Przykłady: "MCH-SI-062127", "MCH-SI-078956", "687665"

14. NUMERY BOOKING/BL → {{bookingNumber}}
    Przykłady: "EGLV400500241810", "MEDUOJ809542"

15. EKSPORTERZY/NADAWCY (firmy zagraniczne) → {{exporterName}}
    Przykłady: "MANHATTAN AUTO SALES LLC", "SPEED CANADA", "COPART INC"
    
16. ŚRODEK TRANSPORTU → {{transportType}}
    Przykłady: "TRUCK", "TRAILER"

17. MASA BRUTTO (kg) → {{grossWeight}}
    Przykłady: "1.650,000", "2.100,000"

18. WARTOŚĆ STATYSTYCZNA → {{statisticalValue}}
    Przykłady: "9.775,81", "12.500,00"

19. NUMERY POZWOLEŃ (różne od stałych) → {{permitNumber}}

═══════════════════════════════════════════════════════════════════════
ZASADY:
═══════════════════════════════════════════════════════════════════════
1. Zwróć JSON array: ["tekst lub {{tag}}", "tekst lub {{tag}}", ...]
2. MUSI być DOKŁADNIE tyle samo elementów co input
3. MUSI być w TEJ SAMEJ kolejności
4. Jeśli tekst jest STAŁY (z listy powyżej) → zwróć BEZ ZMIAN
5. Jeśli tekst jest ZMIENNY → zwróć {{camelCaseTag}}
6. Używaj angielskich nazw tagów w camelCase
7. NIE zamieniaj pojedynczych liter, cyfr 1-2 znakowych, etykiet z dwukropkiem
8. IGNORUJ kontekst formatowania w output - zwróć tylko czysty tekst lub {{tag}}
9. Użyj kontekstu formatowania TYLKO do lepszego rozpoznania zmiennych (np. bold = nagłówek, może być stały)

PRZYKŁADY:
Input: ["Data akceptacji:", "09-07-2025", "MARLOG CAR HANDLING BV", "KUBICZ DANIEL"]
Output: ["Data akceptacji:", "{{acceptanceDate}}", "MARLOG CAR HANDLING BV", "{{declarantName}}"]

Input: ["VIN:", "WMZ83BR06P3R14626", "Wartość:", "9.775,81 EUR", "NL006223527"]
Output: ["VIN:", "{{vinNumber}}", "Wartość:", "{{customsValue}}", "NL006223527"]

Input: ["WSPÓLNOTA EUROPEJSKA [bold,size:14pt]", "25NL7PU1EYHFR8FDR4", "Data: [bold]", "09-07-2025"]
Output: ["WSPÓLNOTA EUROPEJSKA", "{{mrnNumber}}", "Data:", "{{issueDate}}"]`;

  const userPrompt = `Przeanalizuj te ${runs.length} runów z dokumentu (z kontekstem formatowania) i zwróć JSON array z placeholderami (BEZ kontekstu formatowania w output):

${JSON.stringify(textsWithContext, null, 2)}`;

  const apiUrl = "https://openrouter.ai/api/v1/chat/completions";
  const apiKey = openRouterKey;
  const model = "google/gemini-2.5-pro"; // Gemini 2.5 Pro model
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://docu-magic.app",
    "X-Title": "DocuMagic Template Processor"
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 64000 // Increased for large documents
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`AI API error (OpenRouter):`, response.status, errorText);
    throw new Error(`AI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error("No content in AI response");
  }

  // Parse the JSON response
  let processedTexts: string[];
  try {
    console.log("Raw AI response length:", content.length);
    console.log("AI response preview:", content.substring(0, 300));
    console.log("AI response end:", content.substring(Math.max(0, content.length - 200)));
    
    // Clean up potential markdown formatting more robustly
    let cleaned = content.trim();
    
    // Remove markdown code blocks (multiple patterns)
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
    cleaned = cleaned.replace(/\n?```\s*$/i, '');
    cleaned = cleaned.trim();
    
    // Try to find JSON array in the content
    const jsonArrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonArrayMatch) {
      cleaned = jsonArrayMatch[0];
    } else {
      // JSON might be truncated - try to repair it
      console.warn("⚠️ JSON array appears truncated, attempting repair...");
      const arrayStart = cleaned.indexOf('[');
      if (arrayStart !== -1) {
        cleaned = cleaned.substring(arrayStart);
        // Count unclosed strings and close them
        const lastQuoteIndex = cleaned.lastIndexOf('"');
        const lastCommaIndex = cleaned.lastIndexOf(',');
        
        // If ends in middle of string (odd number of quotes after last comma)
        if (lastQuoteIndex > lastCommaIndex) {
          // Count quotes after last comma
          const afterComma = cleaned.substring(lastCommaIndex + 1);
          const quoteCount = (afterComma.match(/"/g) || []).length;
          
          if (quoteCount % 2 === 1) {
            // Odd quotes - string is unclosed, remove incomplete element
            cleaned = cleaned.substring(0, lastCommaIndex);
          }
        }
        
        // Remove trailing comma if present
        cleaned = cleaned.replace(/,\s*$/, '');
        
        // Close the array
        if (!cleaned.endsWith(']')) {
          cleaned = cleaned + ']';
          console.log("✓ Repaired truncated JSON by closing array");
        }
      }
    }
    
    console.log("Cleaned content preview:", cleaned.substring(0, 200));
    console.log("Cleaned content end:", cleaned.substring(Math.max(0, cleaned.length - 100)));
    
    processedTexts = JSON.parse(cleaned);
  } catch (parseError) {
    console.error("Failed to parse AI response:", content.substring(0, 1000));
    console.error("Parse error:", parseError);
    
    // Fallback: try to extract valid JSON elements and reconstruct
    try {
      console.log("Attempting fallback JSON reconstruction...");
      
      // Find all quoted strings in the array
      let cleaned = content.trim();
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
      cleaned = cleaned.replace(/\n?```\s*$/i, '');
      
      const arrayStart = cleaned.indexOf('[');
      if (arrayStart !== -1) {
        cleaned = cleaned.substring(arrayStart + 1);
        
        // Extract all complete string elements
        const elements: string[] = [];
        const stringRegex = /"(?:[^"\\]|\\.)*"/g;
        let match;
        
        while ((match = stringRegex.exec(cleaned)) !== null) {
          try {
            // Parse each string to unescape it properly
            const parsed = JSON.parse(match[0]);
            elements.push(parsed);
          } catch {
            // Skip malformed strings
          }
        }
        
        if (elements.length > 0) {
          console.log(`✓ Fallback reconstruction: extracted ${elements.length} elements from truncated response`);
          processedTexts = elements;
        } else {
          throw new Error("No valid JSON elements found in response");
        }
      } else {
        throw new Error("No JSON array found in response");
      }
    } catch (fallbackError) {
      // Last resort: return original texts unchanged
      console.warn("⚠️ All parsing failed, returning original texts");
      processedTexts = texts;
    }
  }

  // Validate and normalize
  if (!Array.isArray(processedTexts)) {
    throw new Error("AI response is not an array");
  }

  // Ensure same length
  if (processedTexts.length !== texts.length) {
    console.warn(`Length mismatch: expected ${texts.length}, got ${processedTexts.length}`);
    // Pad or truncate to match
    const normalized: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      normalized.push(
        i < processedTexts.length && typeof processedTexts[i] === 'string'
          ? processedTexts[i]
          : texts[i]
      );
    }
    processedTexts = normalized;
  }

  // Map processed texts back to runs (preserving formatting)
  const processedRuns = runs.map((run, idx) => ({
    ...run,
    text: processedTexts[idx] || run.text
  }));

  return { processedRuns, aiResponse: content };
}

