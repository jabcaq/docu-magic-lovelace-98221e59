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

    const { fileData: base64FileData, fileName } = await req.json();

    console.log("Extracting XML from DOCX:", { fileName });

    if (!base64FileData) {
      throw new Error("No file data provided");
    }

    // Decode base64 to binary
    const binaryString = atob(base64FileData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log("File decoded, size:", bytes.length);

    // Import JSZip dynamically
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    
    console.log("Loading ZIP from bytes");

    const zip = await JSZip.loadAsync(bytes.buffer);
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
        fileName: fileName,
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
