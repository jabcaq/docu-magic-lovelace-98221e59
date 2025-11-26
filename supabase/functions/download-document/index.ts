import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Safely replace variable tags with values in XML
 * Preserves XML structure by properly escaping values
 */
function safeReplaceInXml(xml: string, tag: string, value: string): string {
  // Escape the value for XML
  const escapedValue = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  
  // Escape the tag for regex
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Replace all occurrences (case-insensitive)
  return xml.replace(new RegExp(escapedTag, 'gi'), escapedValue);
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
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
      },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    // Parse request body or query
    let documentId: string | null = null;
    let mode: string = "filled"; // "filled" or "template"

    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    const url = new URL(req.url);

    try {
      if (contentType.includes("application/json")) {
        const json = await req.json();
        documentId = json?.documentId ?? null;
        mode = json?.mode ?? "filled";
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const bodyText = await req.text();
        const params = new URLSearchParams(bodyText);
        documentId = params.get("documentId");
        mode = params.get("mode") || "filled";
      } else {
        documentId = url.searchParams.get("documentId");
        mode = url.searchParams.get("mode") || "filled";
        if (!documentId) {
          const bodyText = await req.text().catch(() => null);
          if (bodyText) {
            try {
              const parsed = JSON.parse(bodyText);
              documentId = parsed?.documentId ?? null;
              mode = parsed?.mode ?? "filled";
            } catch (_) {
              // ignore
            }
          }
        }
      }
    } catch (e) {
      console.error("Body parse error:", e);
    }

    if (!documentId) {
      throw new Error("documentId is required");
    }

    console.log("=== Download Document ===");
    console.log("Document ID:", documentId);
    console.log("Mode:", mode);

    // Get document data with XML content
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("name, storage_path, xml_content")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    if (!document.storage_path) {
      throw new Error("Document has no storage path");
    }

    // Get all document fields with their values
    const { data: fields, error: fieldsError } = await supabase
      .from("document_fields")
      .select("id, field_value, field_tag")
      .eq("document_id", documentId);

    if (fieldsError) throw fieldsError;

    console.log("✓ Found", fields?.length || 0, "fields");

    // Download the original DOCX file from storage
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError) {
      console.error("Storage download error:", downloadError);
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    if (!fileData) {
      throw new Error("No file data received");
    }

    console.log("✓ Original file downloaded, size:", fileData.size);

    // Load DOCX as ZIP from storage (preserves all styles, media, etc.)
    const arrayBuffer = await fileData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Determine which XML to use as base
    let baseXml: string;
    
    if (document.xml_content) {
      // Use the processed XML from database (has {{tags}})
      baseXml = document.xml_content;
      console.log("✓ Using processed XML from database");
    } else {
      // Fallback: extract from original DOCX
      const docXml = zip.file("word/document.xml");
      if (!docXml) {
        throw new Error("Invalid DOCX: document.xml not found");
      }
      baseXml = await docXml.async("text");
      console.log("✓ Using XML from original DOCX");
    }

    let finalXml = baseXml;
    
    if (mode === "filled" && fields && fields.length > 0) {
      // Replace {{tags}} with actual values
      console.log("→ Replacing tags with values...");
      
      for (const field of fields) {
        if (!field.field_tag) continue;
        
        const value = field.field_value || "";
        finalXml = safeReplaceInXml(finalXml, field.field_tag, value);
        console.log(`   ${field.field_tag} → "${value.substring(0, 30)}${value.length > 30 ? '...' : ''}"`);
      }
      
      console.log("✓ All replacements complete");
    } else if (mode === "template") {
      // Keep tags as-is - already in the XML
      console.log("✓ Template mode - keeping {{tags}} intact");
    }

    console.log("→ Generating DOCX file...");

    // Update the document.xml in the ZIP (preserves everything else)
    zip.file("word/document.xml", finalXml);

    // Generate new DOCX file
    const modifiedDocx = await zip.generateAsync({ 
      type: "base64",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    // Create filename based on mode
    const originalName = document.name || "document.docx";
    const nameWithoutExt = originalName.replace(/\.docx$/i, '');
    const suffix = mode === "template" ? "_szablon" : "_wypelniony";
    const filename = `${nameWithoutExt}${suffix}.docx`;

    console.log("✓ Generated:", filename);

    return new Response(
      JSON.stringify({ 
        base64: modifiedDocx,
        filename,
        fieldsReplaced: mode === "filled" ? (fields?.length || 0) : 0
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("❌ Error in download-document:", error);
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
