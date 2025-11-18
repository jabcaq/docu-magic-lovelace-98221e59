import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Get API key from header (optional - for additional security)
    const apiKey = req.headers.get("x-api-key");
    
    // Parse request body
    const { 
      fileName, 
      fileContent, // base64 encoded file content
      documentName,
      documentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      autoAnalyze = true,
      userId,
      analysisApproach = "runs" // "runs" or "xml_ai"
    } = await req.json();

    console.log("API Upload request:", { fileName, documentName, documentType, autoAnalyze, userId, analysisApproach });

    if (!fileName || !fileContent || !documentName || !userId) {
      throw new Error("Missing required fields: fileName, fileContent, documentName, userId");
    }

    // Decode base64 file content
    const fileBuffer = Uint8Array.from(atob(fileContent), c => c.charCodeAt(0));
    
    // Generate storage path
    const timestamp = new Date().getTime();
    const storagePath = `${userId}/${timestamp}_${fileName}`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, fileBuffer, {
        contentType: documentType,
        upsert: false
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error(`Failed to upload file: ${uploadError.message}`);
    }

    console.log("File uploaded to storage:", storagePath);

    // Convert document to HTML if it's a Word document
    let htmlContent = null;
    
    if (documentType.includes("wordprocessingml") || documentType.includes("msword")) {
      try {
        // Import mammoth for Word to HTML conversion
        const mammoth = await import("https://esm.sh/mammoth@1.8.0");
        
        const result = await mammoth.convertToHtml(
          { arrayBuffer: fileBuffer.buffer },
          {
            styleMap: [
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Title'] => h1.title:fresh",
            ],
          }
        );

        // Add CSS styling
        const styledHtml = `
          <style>
            body { font-family: 'Calibri', sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { color: #2c3e50; margin-top: 20px; }
            h2 { color: #34495e; margin-top: 15px; }
            p { margin-bottom: 10px; }
            table { border-collapse: collapse; width: 100%; margin: 20px 0; }
            td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }
          </style>
          ${result.value}
        `;

        htmlContent = styledHtml;
        console.log("Document converted to HTML");
      } catch (conversionError) {
        console.error("HTML conversion error:", conversionError);
        // Continue without HTML content
      }
    }

    // Determine document type category
    const isWordDocument = documentType.includes("wordprocessingml") || documentType.includes("msword");
    const docType = isWordDocument ? "word" : "other";

    // Insert document record with auto_analyze flag and analysis approach
    const { data: document, error: dbError } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        name: documentName,
        type: docType,
        storage_path: storagePath,
        html_content: htmlContent,
        status: "pending",
        auto_analyze: false, // We'll trigger analysis manually after extracting runs
        analysis_approach: analysisApproach
      })
      .select()
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);
      throw new Error(`Failed to create document record: ${dbError.message}`);
    }

    console.log("Document record created:", document.id);

    // For Word documents, choose analysis approach
    if (isWordDocument && autoAnalyze) {
      if (analysisApproach === 'xml_ai') {
        console.log("Using XML + AI analysis approach...");
        try {
          const { error: xmlAiError } = await supabase.functions.invoke('analyze-document-xml-ai', {
            body: { documentId: document.id }
          });

          if (xmlAiError) {
            console.error('Failed to analyze with XML AI:', xmlAiError);
          }
        } catch (xmlAiError) {
          console.error('Error during XML AI analysis:', xmlAiError);
        }
      } else {
        // Default: runs approach
        console.log("Using runs extraction approach...");
        
        try {
          const { error: runsError } = await supabase.functions.invoke('extract-openxml-runs', {
            body: { documentId: document.id }
          });

          if (runsError) {
            console.error('Failed to extract runs:', runsError);
          }
        } catch (runsExtractError) {
          console.error('Error during run extraction:', runsExtractError);
        }

        // Now trigger analysis
        try {
          const { error: analyzeError } = await supabase.functions.invoke('analyze-document-fields', {
            body: { documentId: document.id }
          });

          if (analyzeError) {
            console.error('Failed to analyze document:', analyzeError);
          }
        } catch (analyzeError) {
          console.error('Error during analysis:', analyzeError);
        }
      }
    } else if (autoAnalyze) {
      // For non-Word documents, trigger analysis directly via database trigger
      await supabase
        .from("documents")
        .update({ auto_analyze: true })
        .eq("id", document.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: document.id,
          name: document.name,
          status: document.status,
          autoAnalyze: document.auto_analyze
        },
        message: autoAnalyze 
          ? "Document uploaded successfully. Analysis will start automatically." 
          : "Document uploaded successfully."
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    console.error("Error in api-upload-document:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
