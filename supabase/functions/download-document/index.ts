import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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

    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    const url = new URL(req.url);

    try {
      if (contentType.includes("application/json")) {
        const json = await req.json();
        documentId = json?.documentId ?? null;
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const bodyText = await req.text();
        const params = new URLSearchParams(bodyText);
        documentId = params.get("documentId");
      } else {
        // Try query param first
        documentId = url.searchParams.get("documentId");
        if (!documentId) {
          // As a last resort, try to parse text as JSON
          const bodyText = await req.text().catch(() => null);
          if (bodyText) {
            try {
              const parsed = JSON.parse(bodyText);
              documentId = parsed?.documentId ?? null;
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

    // Get document with HTML content
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("html_content, name, storage_path")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    if (!document.storage_path) {
      throw new Error("Document has no storage path");
    }

    console.log("Fetching original document from storage:", document.storage_path);

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

    // Convert blob to base64
    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const base64 = btoa(String.fromCharCode(...uint8Array));

    return new Response(
      JSON.stringify({ 
        base64,
        filename: document.name || "document.docx"
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
