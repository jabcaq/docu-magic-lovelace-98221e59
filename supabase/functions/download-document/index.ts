import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import JSZip from "https://esm.sh/jszip@3.10.1";

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

    console.log("Downloading document:", documentId);

    // Get document data
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("name, storage_path")
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

    console.log("Found fields:", fields?.length || 0);

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

    console.log("File downloaded successfully, size:", fileData.size);

    // Load DOCX as ZIP
    const arrayBuffer = await fileData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Get document.xml
    const documentXml = await zip.file("word/document.xml")?.async("string");
    
    if (!documentXml) {
      throw new Error("Invalid DOCX file - no document.xml found");
    }

    console.log("Original document.xml length:", documentXml.length);
    console.log("Mode:", mode);

    // Replace field spans based on mode
    let modifiedXml = documentXml;
    
    if (fields && fields.length > 0) {
      for (const field of fields) {
        // Find the span tag pattern
        const spanPattern = new RegExp(
          `<span[^>]*data-field-id="${field.id}"[^>]*>.*?</span>`,
          "gi"
        );
        
        // Replace with either value (filled mode) or tag template (template mode)
        const replacement = mode === "template" ? field.field_tag : (field.field_value || "");
        modifiedXml = modifiedXml.replace(spanPattern, replacement);
        
        console.log(`Replaced field ${field.id} (${field.field_tag}) with: ${replacement}`);
      }
    }

    console.log("Modified document.xml length:", modifiedXml.length);

    // Update the document.xml in the ZIP
    zip.file("word/document.xml", modifiedXml);

    // Generate new DOCX file
    const modifiedDocx = await zip.generateAsync({ 
      type: "uint8array",
      compression: "DEFLATE"
    });

    // Convert to base64
    const base64 = btoa(String.fromCharCode(...modifiedDocx));

    // Create filename based on mode
    const originalName = document.name || "document.docx";
    const nameWithoutExt = originalName.replace(/\.docx$/i, '');
    const suffix = mode === "template" ? "_szablon" : "_wypelniony";
    const filename = `${nameWithoutExt}${suffix}.docx`;

    return new Response(
      JSON.stringify({ 
        base64,
        filename
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in download-document:", error);
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
