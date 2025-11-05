import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to convert HTML to Word XML
function convertHtmlToWordXml(html: string): string {
  // Remove HTML tags and convert to Word XML paragraphs
  // This is a simplified conversion - preserves text and basic structure
  const cleanText = html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const paragraphs = cleanText.split(/\n+/).filter(p => p.trim());
  
  return paragraphs.map(para => `
    <w:p>
      <w:r>
        <w:t xml:space="preserve">${escapeXml(para)}</w:t>
      </w:r>
    </w:p>
  `).join('\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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

    // Get document with HTML content and fields
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("html_content, name, storage_path")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError) throw docError;

    if (!document.html_content) {
      throw new Error("Document has no HTML content");
    }

    // Get all document fields with their values
    const { data: fields, error: fieldsError } = await supabase
      .from("document_fields")
      .select("id, field_value")
      .eq("document_id", documentId);

    if (fieldsError) throw fieldsError;

    console.log("Found fields:", fields?.length || 0);

    // Replace all field tags with their values in HTML
    let processedHtml = document.html_content;
    
    if (fields && fields.length > 0) {
      for (const field of fields) {
        // Find and replace the span tag with just the field value
        const spanPattern = new RegExp(
          `<span[^>]*data-field-id="${field.id}"[^>]*>.*?</span>`,
          "gi"
        );
        processedHtml = processedHtml.replace(spanPattern, field.field_value || "");
      }
    }

    console.log("HTML processed with field values");

    // Use mammoth-like conversion to create DOCX from HTML
    // For now, we'll use a simple approach with proper DOCX structure
    const docxContent = `
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${convertHtmlToWordXml(processedHtml)}
  </w:body>
</w:document>`;

    // Create a minimal DOCX package
    const encoder = new TextEncoder();
    const docxBytes = encoder.encode(docxContent);
    const base64 = btoa(String.fromCharCode(...docxBytes));

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
