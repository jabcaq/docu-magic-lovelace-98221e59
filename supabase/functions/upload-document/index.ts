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

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const documentName = formData.get("name") as string;
    const documentType = formData.get("type") as string;

    if (!file) {
      throw new Error("No file provided");
    }

    console.log("Processing file:", file.name, "size:", file.size);

    // Upload file to storage
    const filePath = `${user.id}/${Date.now()}_${file.name}`;
    const fileBuffer = await file.arrayBuffer();
    
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw uploadError;
    }

    // Extract XML from DOCX
    console.log("Extracting XML from DOCX...");
    const zip = await JSZip.loadAsync(fileBuffer);
    const xmlFile = zip.file("word/document.xml");
    
    if (!xmlFile) {
      throw new Error("Could not find document.xml in DOCX file");
    }
    
    const xmlContent = await xmlFile.async("string");
    console.log("XML extraction complete, length:", xmlContent.length);

    // Create document record with XML content
    const { data: document, error: docError } = await supabase
      .from("documents")
      .insert({
        user_id: user.id,
        name: documentName || file.name,
        type: documentType || "word",
        storage_path: filePath,
        xml_content: xmlContent,
        html_cache: null, // Will be generated on-demand by render-document
        status: "pending",
        auto_analyze: false // Prevent DB trigger from firing; we'll run analysis manually
      })
      .select()
      .single();

    if (docError) {
      console.error("Document creation error:", docError);
      throw docError;
    }

    console.log("Document created successfully:", document.id);

    // For Word documents, extract OpenXML runs first
    try {
      console.log("Extracting OpenXML runs for Word document...");
      
      const { error: runsError } = await supabase.functions.invoke('extract-openxml-runs', {
        body: { documentId: document.id },
        headers: { Authorization: authHeader }
      });

      if (runsError) {
        console.error('Failed to extract runs:', runsError);
      }
    } catch (runsExtractError) {
      console.error('Error during run extraction:', runsExtractError);
    }

    // Now trigger AI analysis
    try {
      console.log("Starting AI analysis...");
      
      const { error: analyzeError } = await supabase.functions.invoke('analyze-document-fields', {
        body: { documentId: document.id },
        headers: { Authorization: authHeader }
      });

      if (analyzeError) {
        console.error('Failed to analyze document:', analyzeError);
      } else {
        console.log('AI analysis completed successfully');
      }
    } catch (analyzeError) {
      console.error('Error during analysis:', analyzeError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: document.id,
          name: document.name,
          type: document.type,
          status: document.status,
        }
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in upload-document:", error);
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
