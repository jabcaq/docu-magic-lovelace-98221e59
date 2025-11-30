import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { XMLParser, XMLBuilder } from "https://esm.sh/fast-xml-parser@4.3.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedRun {
  id: string;
  text: string;
  toReplaceWith: string | null;
}

interface ExtractedParagraph {
  paragraph_id: string;
  debug_path: string;
  full_text_context: string;
  runs: ExtractedRun[];
}

interface RunChange {
  id: string;
  originalText: string;
  newText: string;
}

interface BatchPayload {
  system_message: string;
  user_message: string;
  paragraphIds: string[];
}

const BATCH_SIZE_TARGET = 1500;
const MODEL = "google/gemini-3-pro-preview";
const CONCURRENT_REQUESTS = 15;

const SYSTEM_PROMPT = `Jesteś ekspertem od analizy dokumentów DOCX.
Otrzymujesz JSON z listą paragrafów i runów.
Twoim zadaniem jest zidentyfikowanie ZMIENNYCH (np. Data, VIN, Nazwisko, Adres, Kwota) i przygotowanie listy zamian na tagi {{tag}}.

ZASADY:
1. Analizuj treść pod kątem zmiennych.
2. Nie zmieniaj stałych tekstów (etykiety, nagłówki, stałe formułki).
3. Jeśli zmienna jest rozbita na wiele runów:
   - Pierwszy run: "{{tag}}"
   - Kolejne runy: "" (pusty string)

FORMAT ODPOWIEDZI (JSON):
{
  "changes": [
    { "id": "ID_RUNA", "new": "{{tag}}" },
    { "id": "ID_RUNA_2", "new": "" }
  ]
}
Zwróć TYLKO runy, które wymagają zmiany. Pomiń te bez zmian.`;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type DeltaResponse = {
  changes?: Array<{ id: string; new?: string }>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://host.docker.internal:54321";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");

    if (!supabaseKey || !openRouterKey) {
      console.error("Missing configuration:", { 
        hasSupabaseUrl: !!supabaseUrl, 
        hasSupabaseKey: !!supabaseKey, 
        hasOpenRouterKey: !!openRouterKey 
      });
      throw new Error("Configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const body = await req.json();
    const documentId = body?.documentId;

    if (!documentId) throw new Error("documentId is required");

    // Return success immediately to avoid timeout
    // The actual processing happens in the background
    // Note: In Deno Deploy (Supabase Edge Functions), we must not await the background task
    // AND we must register it with EdgeRuntime.waitUntil if available, or just let it run
    // but typically the runtime might kill it if response is sent.
    // However, for long running tasks > 60s, we usually need a queue.
    // BUT, locally and on some plans, we can try EdgeRuntime.waitUntil.
    
    const processingPromise = processDocument(documentId, supabase, openRouterKey);
    
    // If EdgeRuntime is available, use it to keep the background task alive
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processingPromise);
    } else {
      // Fallback: just don't await it (might be killed)
      processingPromise.catch(err => console.error("Background process failed:", err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Processing started in background",
        status: "processing"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error starting pipeline:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processDocument(documentId: string, supabase: any, openRouterKey: string) {
  try {
    console.log(`[Background] Starting processing for ${documentId}`);
    
    // KROK 1: Ustaw status na "processing"
    console.log(`[Background] Setting status to processing...`);
    const { error: statusError } = await supabase.from("documents").update({ 
      processing_status: "processing",
      processing_result: null 
    }).eq("id", documentId);
    
    if (statusError) {
      console.error(`[Background] Failed to set processing status:`, statusError);
      throw new Error(`DB status update failed: ${statusError.message}`);
    }
    console.log(`[Background] Status set to processing - OK`);

    // KROK 2: Pobierz dokument z bazy
    console.log(`[Background] Fetching document metadata...`);
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("storage_path, name")
      .eq("id", documentId)
      .single();

    if (docError || !document) {
      console.error(`[Background] Failed to fetch document:`, docError);
      throw new Error(`Document fetch failed: ${docError?.message || "Document not found"}`);
    }
    console.log(`[Background] Document metadata fetched - OK (path: ${document.storage_path})`);

    // KROK 3: Pobierz plik ze storage
    console.log(`[Background] Downloading file from storage...`);
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError || !fileData) {
      console.error(`[Background] Failed to download file:`, downloadError);
      throw new Error(`File download failed: ${downloadError?.message || "No file data"}`);
    }
    console.log(`[Background] File downloaded - OK`);

    // KROK 4: Rozpakuj ZIP i wyciągnij XML
    console.log(`[Background] Parsing DOCX...`);
    const arrayBuffer = await fileData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xmlFile = zip.file("word/document.xml");
    
    if (!xmlFile) {
      throw new Error("word/document.xml not found in DOCX");
    }
    
    const documentXml = await xmlFile.async("string");
    console.log(`[Background] DOCX parsed - OK (XML length: ${documentXml.length})`);
    
    // KROK 5: Ekstrakcja paragrafów i przygotowanie batchy
    const paragraphs = extractParagraphs(documentXml);
    const batches = prepareBatches(paragraphs);
    console.log(`[Background] ${paragraphs.length} paragraphs, ${batches.length} batches`);

    // KROK 6: Przetwarzanie LLM
    console.log(`[Background] Starting LLM processing...`);
    const changes = await processBatchesWithLLM(batches, openRouterKey);
    console.log(`[Background] LLM processing complete - Found ${changes.length} changes`);

    // KROK 7: Zastosuj zmiany do XML
    console.log(`[Background] Applying changes to XML...`);
    const { newXml, appliedCount } = applyChangesToXml(documentXml, changes);
    console.log(`[Background] Changes applied - OK (${appliedCount} applied, newXml length: ${newXml.length})`);
    
    // KROK 8: Generuj nowy DOCX
    console.log(`[Background] Generating new DOCX...`);
    zip.file("word/document.xml", newXml);
    const outputBuffer = await zip.generateAsync({ type: "uint8array" });
    
    // New approach: Upload to Storage instead of Base64 to DB
    const outputFilename = buildTemplateFilename(document.name);
    const storagePath = `processed/${documentId}/${outputFilename}`;
    
    console.log(`[Background] Uploading result to storage: ${storagePath}...`);
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, outputBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true
      });

    if (uploadError) {
      console.error(`[Background] Storage upload failed:`, uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }
    console.log(`[Background] Upload complete - OK`);
    
    // KROK 9: Logowanie rozmiarów danych przed zapisem
    const processingResult = {
      templateBase64: null, // Deprecated
      storagePath: storagePath,
      templateFilename: outputFilename,
      stats: {
        paragraphs: paragraphs.length,
        runs: paragraphs.reduce((acc: any, p: any) => acc + p.runs.length, 0),
        batches: batches.length,
        changesApplied: appliedCount
      },
      replacements: changes
    };
    
    console.log(`[Background] Data sizes before save:`, {
      newXmlLength: newXml.length,
      changesCount: changes.length,
      processingResultSize: JSON.stringify(processingResult).length
    });
    
    // KROK 10: Zapisz wyniki do bazy - ROZDZIELONE NA MNIEJSZE OPERACJE
    console.log(`[Background] Saving to DB - Step 1: xml_content...`);
    const { error: xmlError } = await supabase.from("documents").update({
      xml_content: newXml,
      updated_at: new Date().toISOString()
    }).eq("id", documentId);
    
    if (xmlError) {
      console.error(`[Background] Failed to save xml_content:`, xmlError);
      throw new Error(`DB xml_content update failed: ${xmlError.message}`);
    }
    console.log(`[Background] xml_content saved - OK`);
    
    console.log(`[Background] Saving to DB - Step 2: processing_result...`);
    const { error: resultError } = await supabase.from("documents").update({
      processing_result: processingResult
    }).eq("id", documentId);
    
    if (resultError) {
      console.error(`[Background] Failed to save processing_result:`, resultError);
      throw new Error(`DB processing_result update failed: ${resultError.message}`);
    }
    console.log(`[Background] processing_result saved - OK`);
    
    console.log(`[Background] Saving to DB - Step 3: status fields...`);
    const { error: finalError } = await supabase.from("documents").update({
      processing_status: "completed",
      status: "templated"
    }).eq("id", documentId);
    
    if (finalError) {
      console.error(`[Background] Failed to save final status:`, finalError);
      throw new Error(`DB final status update failed: ${finalError.message}`);
    }
    console.log(`[Background] Final status saved - OK`);

    console.log(`[Background] ✅ COMPLETED ${documentId}`);

  } catch (error) {
    console.error(`[Background] ❌ ERROR processing ${documentId}:`, error);
    
    console.log(`[Background] Saving error status to DB...`);
    const { error: errorUpdateError } = await supabase.from("documents").update({
      processing_status: "error",
      processing_result: { error: error instanceof Error ? error.message : "Unknown error" }
    }).eq("id", documentId);
    
    if (errorUpdateError) {
      console.error(`[Background] Failed to save error status:`, errorUpdateError);
    } else {
      console.log(`[Background] Error status saved - OK`);
    }
  }
}

// ... Helper functions (extractParagraphs, prepareBatches, etc.) remain the same ...
// Copying them below to ensure file integrity

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
        toReplaceWith: null,
      });
    });

    if (paragraphData.runs.length > 0) {
      paragraphs.push(paragraphData);
    }
  };

  walkBody(body, handleParagraph);
  return paragraphs;
}

function prepareBatches(paragraphs: ExtractedParagraph[]): BatchPayload[] {
  const batches: BatchPayload[] = [];
  let current: ExtractedParagraph[] = [];
  let currentSize = 0;

  const pushBatch = () => {
    if (!current.length) return;
    batches.push({
      system_message: SYSTEM_PROMPT,
      user_message: JSON.stringify(current),
      paragraphIds: current.map((p) => p.paragraph_id),
    });
    current = [];
    currentSize = 0;
  };

  paragraphs.forEach((paragraph) => {
    const size = paragraph.full_text_context.length + JSON.stringify(paragraph).length;
    if (currentSize + size > BATCH_SIZE_TARGET && current.length > 0) {
      pushBatch();
    }
    current.push(paragraph);
    currentSize += size;
  });

  pushBatch();
  return batches;
}

async function processBatchesWithLLM(batches: BatchPayload[], apiKey: string): Promise<RunChange[]> {
  const allChanges: RunChange[] = [];

  for (let i = 0; i < batches.length; i += CONCURRENT_REQUESTS) {
    const chunk = batches.slice(i, i + CONCURRENT_REQUESTS);
    console.log(`[Background] Processing chunk ${Math.floor(i/CONCURRENT_REQUESTS) + 1}/${Math.ceil(batches.length/CONCURRENT_REQUESTS)}...`);
    
    const results = await Promise.all(
      chunk.map((batch, idx) =>
        processSingleBatch(batch, apiKey, i + idx).catch((err) => {
          console.warn("[Background] Batch failed", i + idx + 1, err?.message || err);
          return [] as RunChange[];
        })
      )
    );

    results.forEach((changes) => allChanges.push(...changes));
  }

  const uniqueMap = new Map<string, RunChange>();
  for (const change of allChanges) {
    if (!uniqueMap.has(change.id)) {
      uniqueMap.set(change.id, change);
    }
  }

  return Array.from(uniqueMap.values());
}

async function processSingleBatch(batch: BatchPayload, apiKey: string, batchIndex: number): Promise<RunChange[]> {
  console.log(`[Background] Sending batch ${batchIndex + 1} to LLM with apiKey length: ${apiKey?.length}`);
  
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://docu-magic.app",
      "X-Title": "DocuMagic Word Templater",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: batch.system_message },
        { role: "user", content: batch.user_message },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Background] LLM Error Details (Batch ${batchIndex + 1}):`, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: errorText
    });
    throw new Error(`LLM request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    console.error(`[Background] Empty content response for batch ${batchIndex + 1}. Full response:`, JSON.stringify(data, null, 2));
    throw new Error("Empty LLM response content");
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content);
  } catch {
    const cleaned = content.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const changes: RunChange[] = [];

  const responseObj = parsed as DeltaResponse;
  if (responseObj?.changes && Array.isArray(responseObj.changes)) {
    responseObj.changes.forEach((change) => {
      if (change && typeof change.id === "string" && typeof change.new === "string") {
        changes.push({
          id: change.id,
          originalText: "", // Original text not returned in Delta format to save tokens
          newText: change.new,
        });
      }
    });
  }

  return changes;
}

function applyChangesToXml(documentXml: string, changes: RunChange[]): { newXml: string; appliedCount: number } {
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

  const changesMap = new Map<string, RunChange>();
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

      const textElements = normalizeArray(run?.["w:t"]);
      if (textElements.length === 0) {
        run["w:t"] = change.newText;
        applied++;
        return;
      }

      if (typeof run["w:t"] === "string") {
        run["w:t"] = change.newText;
      } else if (Array.isArray(run["w:t"])) {
        run["w:t"] = [change.newText];
      } else if (run["w:t"] && typeof run["w:t"] === "object") {
        run["w:t"]["#text"] = change.newText;
      }
      applied++;
    });
  };

  walkBody(body, handleParagraph);

  const newXml = builder.build(parsed);
  return { newXml, appliedCount: applied };
}

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

function uint8ArrayToBase64(buffer: Uint8Array): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function buildTemplateFilename(originalName: string): string {
  const base = originalName.replace(/\.docx$/i, "");
  return `${base}_processed.docx`;
}
