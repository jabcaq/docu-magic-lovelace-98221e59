import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { storagePath } = await req.json();

    console.log("Extracting XML from DOCX:", { storagePath });

    // Download DOCX from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(storagePath);

    if (downloadError) {
      console.error("Download error:", downloadError);
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    if (!fileData || fileData.size === 0) {
      throw new Error("Downloaded file is empty or invalid");
    }

    console.log("File downloaded, size:", fileData.size);

    // Import JSZip dynamically
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    
    const arrayBuffer = await fileData.arrayBuffer();
    console.log("ArrayBuffer size:", arrayBuffer.byteLength);

    const zip = await JSZip.loadAsync(arrayBuffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    
    if (!documentXml) {
      throw new Error("Could not find word/document.xml in the DOCX file");
    }

    console.log("XML extracted, length:", documentXml.length);

    // Send XML to webhook
    const webhookUrl = "https://kamil109-20109.wykr.es/webhook/5facd64d-a48f-41b3-ad07-a52fd32f60f1";
    
    console.log("Sending XML to webhook:", webhookUrl);

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        xml: documentXml,
        fileName: storagePath.split('/').pop(),
        timestamp: new Date().toISOString()
      }),
    });

    const webhookResponseText = await webhookResponse.text();
    console.log("Webhook response status:", webhookResponse.status);
    console.log("Webhook response:", webhookResponseText);

    if (!webhookResponse.ok) {
      throw new Error(`Webhook returned status ${webhookResponse.status}: ${webhookResponseText}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        xmlLength: documentXml.length,
        webhookStatus: webhookResponse.status,
        webhookResponse: webhookResponseText
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in extract-and-send-xml:", error);
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
