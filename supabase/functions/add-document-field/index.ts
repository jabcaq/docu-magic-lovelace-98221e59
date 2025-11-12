import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replace first occurrence of selected text, handling text that spans multiple <w:t> tags
function replaceInWT(xml: string, searchText: string, replacement: string): { success: boolean; xml: string } {
  const wtRegex = /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  
  // Extract all <w:t> tags with their positions
  const tags: Array<{ start: number; end: number; open: string; content: string; close: string; full: string }> = [];
  let match;
  
  while ((match = wtRegex.exec(xml)) !== null) {
    tags.push({
      start: match.index,
      end: match.index + match[0].length,
      open: match[1],
      content: match[2],
      close: match[3],
      full: match[0]
    });
  }
  
  // Build combined text from all tags
  const combinedText = tags.map(t => t.content).join('');
  
  // Find the search text in combined content
  const searchIdx = combinedText.indexOf(searchText);
  if (searchIdx === -1) {
    return { success: false, xml };
  }
  
  // Find which tags contain the search text
  let currentPos = 0;
  let startTagIdx = -1;
  let endTagIdx = -1;
  let startOffset = 0;
  let endOffset = 0;
  
  for (let i = 0; i < tags.length; i++) {
    const tagLen = tags[i].content.length;
    const tagStart = currentPos;
    const tagEnd = currentPos + tagLen;
    
    if (searchIdx >= tagStart && searchIdx < tagEnd) {
      startTagIdx = i;
      startOffset = searchIdx - tagStart;
    }
    
    if (searchIdx + searchText.length > tagStart && searchIdx + searchText.length <= tagEnd) {
      endTagIdx = i;
      endOffset = searchIdx + searchText.length - tagStart;
    }
    
    currentPos += tagLen;
  }
  
  if (startTagIdx === -1 || endTagIdx === -1) {
    return { success: false, xml };
  }
  
  // Build the modified XML
  let result = xml;
  let offset = 0;
  
  if (startTagIdx === endTagIdx) {
    // Text is within a single tag
    const tag = tags[startTagIdx];
    const newContent = tag.content.slice(0, startOffset) + replacement + tag.content.slice(endOffset);
    const newTag = tag.open + newContent + tag.close;
    result = xml.slice(0, tag.start + offset) + newTag + xml.slice(tag.end + offset);
  } else {
    // Text spans multiple tags - replace in first tag, remove from middle tags, clean up last tag
    for (let i = startTagIdx; i <= endTagIdx; i++) {
      const tag = tags[i];
      let newTag: string;
      
      if (i === startTagIdx) {
        // First tag: keep content before search text + add replacement
        const newContent = tag.content.slice(0, startOffset) + replacement;
        newTag = tag.open + newContent + tag.close;
      } else if (i === endTagIdx) {
        // Last tag: keep content after search text
        const newContent = tag.content.slice(endOffset);
        newTag = newContent ? (tag.open + newContent + tag.close) : '';
      } else {
        // Middle tags: remove completely
        newTag = '';
      }
      
      const oldLen = tag.end - tag.start;
      result = result.slice(0, tag.start + offset) + newTag + result.slice(tag.end + offset);
      offset += newTag.length - oldLen;
    }
  }
  
  return { success: true, xml: result };
}

// (HTML helper removed; XML edits are done with replaceInWT)

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

    const { documentId, selectedText, tagName } = await req.json();

    console.log("Adding field:", { documentId, selectedText, tagName });

    // Get document XML
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("xml_content")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found or access denied");
    }

    let xml = document.xml_content;
    if (!xml) {
      throw new Error("Document has no XML content");
    }

    // Normalize whitespace in selected text
    const normalizedSelection = selectedText.trim();

    // Generate unique field ID
    const fieldId = crypto.randomUUID();
    const tag = `{{${tagName}}}`;

    // Use safe XML text replacement within <w:t>
    const result = replaceInWT(xml, normalizedSelection, tag);
    
    if (!result.success) {
      throw new Error(`Could not find text "${selectedText}" in document content. It may already be tagged.`);
    }

    xml = result.xml;

    // Update document XML and clear HTML cache
    const { error: updateError } = await supabase
      .from("documents")
      .update({ 
        xml_content: xml,
        html_cache: null // Force regeneration
      })
      .eq("id", documentId);

    if (updateError) throw updateError;

    // Create field record
    const { error: fieldError } = await supabase
      .from("document_fields")
      .insert({
        document_id: documentId,
        field_name: tagName,
        field_value: selectedText,
        field_tag: tag,
        position_in_html: 0, // Will be recalculated
      });

    if (fieldError) throw fieldError;

    console.log("Successfully added field:", fieldId);

    return new Response(
      JSON.stringify({ 
        success: true,
        fieldId: fieldId,
        tag: tag,
        text: selectedText
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in add-document-field:", error);
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