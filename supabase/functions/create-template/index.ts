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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Invalid token");
    }

    const { documentId, templateName } = await req.json();

    if (!documentId) {
      throw new Error("Missing documentId");
    }

    console.log(`Creating template from document ${documentId}`);

    // Get document
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    // Build tag metadata from processing_result (Word Templater Pipeline) or document_fields
    const tagMetadata: { [key: string]: string } = {};
    
    // Check if this is a Word Templater Pipeline document
    const processingResult = document.processing_result as any;
    if (processingResult?.replacements && Array.isArray(processingResult.replacements)) {
      // Extract unique tags from replacements (format: {{TagName}})
      processingResult.replacements.forEach((replacement: any) => {
        const newText = replacement.newText || replacement.new || "";
        const match = newText.match(/\{\{([^}]+)\}\}/);
        if (match) {
          const tagName = match[1];
          tagMetadata[tagName] = replacement.originalText || "";
        }
      });
      console.log(`Extracted ${Object.keys(tagMetadata).length} tags from Word Templater Pipeline`);
    } else {
      // Fallback: try document_fields table
      const { data: fields } = await supabase
        .from("document_fields")
        .select("*")
        .eq("document_id", documentId);
      
      fields?.forEach((field: any) => {
        if (field.field_tag) {
          tagMetadata[field.field_tag] = field.field_value || "";
        }
      });
      console.log(`Extracted ${Object.keys(tagMetadata).length} tags from document_fields`);
    }

    // Determine storage path - use processed path for Word Templater Pipeline
    let storagePath = document.storage_path;
    if (processingResult?.storagePath) {
      storagePath = processingResult.storagePath;
    } else {
      storagePath = document.storage_path.replace(".docx", "_template.docx");
    }

    // Create template record
    const { data: template, error: templateError } = await supabase
      .from("templates")
      .insert({
        user_id: user.id,
        name: templateName || `${document.name} - Template`,
        original_document_id: documentId,
        storage_path: storagePath,
        tag_metadata: tagMetadata,
      })
      .select()
      .single();

    if (templateError) {
      throw templateError;
    }

    // Update document with template reference
    await supabase
      .from("documents")
      .update({ 
        template_id: template.id,
        status: "verified"
      })
      .eq("id", documentId);

    console.log(`Template created: ${template.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          tagCount: Object.keys(tagMetadata).length,
          tags: Object.keys(tagMetadata),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in create-template:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
