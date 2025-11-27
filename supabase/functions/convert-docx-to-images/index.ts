import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Convert DOCX to images (pages) for visual verification
 * Strategy: DOCX → HTML (via mammoth) → Images (via external API)
 */
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
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { docxBase64 } = await req.json();

    if (!docxBase64) {
      throw new Error("docxBase64 is required");
    }

    console.log("=== Converting DOCX to Images ===");

    // Use CloudConvert API to convert DOCX directly to PNG images
    const cloudConvertApiKey = Deno.env.get("CLOUDCONVERT_API_KEY");
    
    if (cloudConvertApiKey) {
      // Convert DOCX directly to PNG via CloudConvert
      const jobResponse = await fetch("https://api.cloudconvert.com/v2/jobs", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cloudConvertApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tasks: {
            "import-1": {
              operation: "import/base64",
              file: docxBase64,
              filename: "document.docx",
            },
            "convert-1": {
              operation: "convert",
              input: "import-1",
              output_format: "png",
              pages: "1-",
            },
            "export-1": {
              operation: "export/url",
              input: "convert-1",
            },
          },
        }),
      });

      if (!jobResponse.ok) {
        throw new Error(`CloudConvert API error: ${jobResponse.status}`);
      }

      const job = await jobResponse.json();
      console.log("CloudConvert job created:", job.data.id);

      // Poll for job completion (simplified - in production use proper polling)
      // For now, return job ID and let caller poll
      return new Response(
        JSON.stringify({
          success: true,
          jobId: job.data.id,
          images: [], // Will be populated after polling
          pageCount: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fallback: For MVP, we can skip visual verification if no API key is set
    // In production, you'd want to use CloudConvert or similar service
    console.warn("⚠️ No image conversion service configured. Skipping visual verification.");
    return new Response(
      JSON.stringify({
        success: true,
        images: [],
        pageCount: 0,
        skipped: true,
        message: "Visual verification skipped - no conversion service configured",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("❌ Error converting DOCX to images:", error);
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

