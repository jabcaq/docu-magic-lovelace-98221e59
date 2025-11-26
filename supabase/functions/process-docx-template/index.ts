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
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { documentId, aiProvider = "lovable" } = await req.json();

    if (!documentId) {
      throw new Error("documentId is required");
    }

    console.log("=== Processing DOCX Template ===");
    console.log("Document ID:", documentId);
    console.log("AI Provider:", aiProvider);

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

    // Extract all text nodes from <w:t> tags
    const textNodes = extractTextNodes(originalXml);
    console.log("✓ Extracted", textNodes.length, "text nodes");

    if (textNodes.length === 0) {
      throw new Error("No text content found in document");
    }

    // Prepare texts for AI analysis
    const texts = textNodes.map(node => node.text);
    
    // Call AI to identify variables
    console.log("→ Sending to AI for variable identification...");
    const processedTexts = await analyzeWithAI(
      texts, 
      aiProvider, 
      openRouterApiKey, 
      lovableApiKey
    );
    console.log("✓ AI analysis complete");

    // Identify which texts were converted to variables
    const variables: ProcessedVariable[] = [];
    const textToTagMap: Map<number, string> = new Map();

    for (let i = 0; i < texts.length; i++) {
      const original = texts[i];
      const processed = processedTexts[i];
      
      if (original !== processed && processed.includes("{{") && processed.includes("}}")) {
        const tagMatch = processed.match(/\{\{(\w+)\}\}/);
        if (tagMatch) {
          variables.push({
            originalText: original,
            tag: processed,
            variableName: tagMatch[1],
            index: i
          });
          textToTagMap.set(i, processed);
        }
      }
    }

    console.log("✓ Found", variables.length, "variables");

    // Modify XML - replace only the text content in <w:t> tags
    // This preserves ALL formatting, styles, tables, etc.
    const modifiedXml = replaceTextInXml(originalXml, textNodes, textToTagMap);
    console.log("✓ XML modified, new length:", modifiedXml.length);

    // Update the document.xml in the ZIP (preserving everything else)
    zip.file("word/document.xml", modifiedXml);

    // Generate the new DOCX
    const newDocxBase64 = await zip.generateAsync({ type: "base64" });
    console.log("✓ New DOCX generated");

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

    // Save fields to database
    if (variables.length > 0) {
      // First, delete existing fields
      await supabase
        .from("document_fields")
        .delete()
        .eq("document_id", documentId);

      // Insert new fields
      const fieldsToInsert = variables.map((v, i) => ({
        document_id: documentId,
        field_name: v.variableName,
        field_value: v.originalText,
        field_tag: v.tag,
        position_in_html: v.index
      }));

      const { error: insertError } = await supabase
        .from("document_fields")
        .insert(fieldsToInsert);

      if (insertError) {
        console.error("Error saving fields:", insertError);
      } else {
        console.log("✓ Saved", variables.length, "fields to database");
      }
    }

    // Prepare filename
    const originalName = document.name || "document.docx";
    const nameWithoutExt = originalName.replace(/\.docx$/i, '');
    const templateFilename = `${nameWithoutExt}_szablon.docx`;

    return new Response(
      JSON.stringify({
        success: true,
        templateBase64: newDocxBase64,
        templateFilename,
        variables: variables.map(v => ({
          name: v.variableName,
          tag: v.tag,
          originalValue: v.originalText
        })),
        variableCount: variables.length,
        totalTextNodes: textNodes.length
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
 * Extract all text nodes from <w:t> tags in the XML
 */
function extractTextNodes(xml: string): ExtractedTextNode[] {
  const nodes: ExtractedTextNode[] = [];
  
  // Match all <w:t> tags with their content
  // This regex handles both <w:t>text</w:t> and <w:t xml:space="preserve">text</w:t>
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  let index = 0;
  
  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[1]);
    if (text) { // Include even whitespace-only text for position accuracy
      nodes.push({
        index,
        text,
        xpath: `w:t[${index}]` // Simple position marker
      });
    }
    index++;
  }
  
  return nodes;
}

/**
 * Replace text content in <w:t> tags based on the mapping
 * This is the CRITICAL function - it preserves ALL XML structure
 */
function replaceTextInXml(
  xml: string, 
  textNodes: ExtractedTextNode[], 
  replacements: Map<number, string>
): string {
  let result = xml;
  let offset = 0;
  
  // Match all <w:t> tags
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  let nodeIndex = 0;
  
  // Collect all matches first
  const matches: { start: number; end: number; fullMatch: string; textContent: string; openTag: string }[] = [];
  
  while ((match = regex.exec(xml)) !== null) {
    const fullMatch = match[0];
    const textContent = match[1];
    
    // Extract the opening tag (with or without attributes)
    const openTagMatch = fullMatch.match(/<w:t(?:\s[^>]*)?>/) as RegExpMatchArray;
    const openTag = openTagMatch[0];
    
    matches.push({
      start: match.index,
      end: match.index + fullMatch.length,
      fullMatch,
      textContent,
      openTag
    });
  }
  
  // Process matches in reverse order to preserve positions
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const replacement = replacements.get(i);
    
    if (replacement !== undefined) {
      // Build new <w:t> tag with replaced content
      const newText = encodeXmlEntities(replacement);
      const newTag = `${m.openTag}${newText}</w:t>`;
      
      // Replace in the result string
      result = result.substring(0, m.start) + newTag + result.substring(m.end);
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
 * Call AI to analyze texts and identify variables
 */
async function analyzeWithAI(
  texts: string[],
  provider: string,
  openRouterKey: string | undefined,
  lovableKey: string | undefined
): Promise<string[]> {
  
  const systemPrompt = `Jesteś ekspertem od analizy dokumentów celnych, samochodowych i administracyjnych.

ZADANIE: Zwróć DOKŁADNIE ten sam array tekstów, ale zamień TYLKO dane zmienne na placeholdery {{nazwaZmiennej}}.

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

15. NUMERY POZWOLEŃ (różne od stałych) → {{permitNumber}}

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

PRZYKŁADY:
Input: ["Data akceptacji:", "09-07-2025", "MARLOG CAR HANDLING BV", "KUBICZ DANIEL"]
Output: ["Data akceptacji:", "{{acceptanceDate}}", "MARLOG CAR HANDLING BV", "{{declarantName}}"]

Input: ["VIN:", "WMZ83BR06P3R14626", "Wartość:", "9.775,81 EUR", "NL006223527"]
Output: ["VIN:", "{{vinNumber}}", "Wartość:", "{{customsValue}}", "NL006223527"]`;

  const userPrompt = `Przeanalizuj te ${texts.length} tekstów z dokumentu i zwróć JSON array z placeholderami:

${JSON.stringify(texts, null, 2)}`;

  let apiUrl: string;
  let apiKey: string;
  let model: string;
  let headers: Record<string, string>;

  if (provider === "openrouter" && openRouterKey) {
    apiUrl = "https://openrouter.ai/api/v1/chat/completions";
    apiKey = openRouterKey;
    model = "google/gemini-2.0-flash-001"; // lub inny model dostępny na OpenRouter
    headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://docu-magic.app",
      "X-Title": "DocuMagic Template Processor"
    };
  } else if (lovableKey) {
    apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
    apiKey = lovableKey;
    model = "google/gemini-2.5-flash";
    headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    };
  } else {
    throw new Error("No AI API key configured. Set OPEN_ROUTER_API_KEY or LOVABLE_API_KEY");
  }

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
      max_tokens: 16000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`AI API error (${provider}):`, response.status, errorText);
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
    // Clean up potential markdown formatting
    const cleaned = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    processedTexts = JSON.parse(cleaned);
  } catch (parseError) {
    console.error("Failed to parse AI response:", content.substring(0, 500));
    throw new Error("AI returned invalid JSON");
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

  return processedTexts;
}

