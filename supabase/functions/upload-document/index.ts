import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import mammoth from "https://esm.sh/mammoth@1.8.0";

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

    // Convert Word document to HTML
    const result = await mammoth.convertToHtml(
      { arrayBuffer: fileBuffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Title'] => h1.title:fresh",
          "b => strong",
          "i => em",
        ],
      }
    );

    console.log("HTML conversion complete, length:", result.value.length);

    // Add CSS styles to the HTML
    const styledHtml = `
      <style>
        body {
          font-family: 'Times New Roman', serif;
          line-height: 1.6;
          padding: 0;
          width: 100%;
        }
        h1, h2, h3 {
          color: #1a1a1a;
          margin-top: 20px;
          margin-bottom: 10px;
        }
        p {
          margin: 10px 0;
          text-align: justify;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          margin: 10px 0;
        }
        td, th {
          border: 1px solid #ddd;
          padding: 8px;
        }
        .doc-variable {
          background-color: #fef08a;
          border: 2px solid #facc15;
          padding: 2px 8px;
          border-radius: 4px;
          display: inline;
          font-weight: 500;
          white-space: pre-wrap;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .doc-variable:hover {
          background-color: #fde047;
          transform: scale(1.01);
        }
        .doc-tag-badge {
          display: inline-block;
          background-color: #3b82f6;
          color: white;
          font-size: 9px;
          padding: 2px 5px;
          border-radius: 3px;
          margin-left: 4px;
          font-family: 'Courier New', monospace;
          font-weight: normal;
          white-space: nowrap;
        }
        strong {
          font-weight: bold;
        }
        em {
          font-style: italic;
        }
      </style>
      ${result.value}
    `;

    // Create document record with HTML content
    const { data: document, error: docError } = await supabase
      .from("documents")
      .insert({
        user_id: user.id,
        name: documentName || file.name,
        type: documentType || "Dokument Word",
        storage_path: filePath,
        html_content: styledHtml,
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
        body: { documentId: document.id }
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
        body: { documentId: document.id }
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
        },
        warnings: result.messages,
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
