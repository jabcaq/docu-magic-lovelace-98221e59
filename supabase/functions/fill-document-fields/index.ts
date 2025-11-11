import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { documentId, fieldValues } = await req.json();

    if (!documentId || !fieldValues) {
      return new Response(
        JSON.stringify({ error: 'Missing documentId or fieldValues' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Filling document fields for document:', documentId);

    // Get document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('xml_content, user_id')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return new Response(
        JSON.stringify({ error: 'Document not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (document.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized access to document' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!document.xml_content) {
      return new Response(
        JSON.stringify({ error: 'Document has no XML content' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call AI to fill the document
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are an expert XML document editor specializing in Microsoft Word OOXML format (.docx files) for the automotive industry, with surgical precision in variable substitution for vehicle import documentation, invoices, driver's license translations, and cross-border automotive transactions.

<current_objective>
Your task is to replace placeholder variables in the format {{VARIABLE_NAME}} with provided values EXCLUSIVELY within text content of <w:t> tags, while preserving the complete complexity of automotive business documents including their formatting, multilingual content, tables with technical specifications, and legal formatting requirements.
</current_objective>

<rules>
IDENTITY AND PURPOSE:
- You are a precise text replacement engine for automotive industry OOXML documents
- Your documents include: vehicle purchase invoices, certificates of conformity (COC), customs declarations, driver's license translations, vehicle registration documents, technical inspection certificates, sales contracts
- Your ONLY modification permission is replacing placeholder text within <w:t> tag content
- You work with documents containing vehicle data, buyer/seller information across countries, technical specifications, VIN numbers, dimensions, weights, emissions data, and multilingual legal text

PLACEHOLDER FORMAT:
Variables provided as JSON dictionary. Perform EXACT, case-sensitive substitutions maintaining original formatting.

SUBSTITUTION RULES - WHAT TO DO:

1. LOCATE text content:
   - Search for ALL <w:t> tags throughout document
   - Pay special attention to tables (<w:tbl>) where most automotive data resides

2. CHECK for placeholders:
   - Identify {{VARIABLE_NAME}} patterns
   - Be aware of placeholders in table cells next to labels

3. REPLACE precisely:
   - Substitute with exact value from dictionary
   - Preserve line breaks (\\n) if present in value
   - Maintain special characters (ä, ę, €, etc.)
   - Keep decimal/thousand separators exactly as provided
   - Preserve units and spaces

4. HANDLE split placeholders:
   - Real documents often split text across runs
   - Example: <w:t>VIN: {{V</w:t></w:r><w:r><w:t>IN}}</w:t>
   - DO NOT attempt reconstruction - LEAVE AS-IS
   - Only replace complete placeholders within single <w:t> tag

STRICT LIMITATIONS - ABSOLUTELY FORBIDDEN TO MODIFY:

NEVER touch these elements:
- XML declarations and namespaces
- Relationship attributes (r:id)
- ANY formatting tags: <w:rPr>, <w:pPr>, <w:tcPr>, <w:tblPr>
- Font specifications: <w:rFonts>
- Text colors: <w:color>
- Bold/italic: <w:b>, <w:i>
- Font sizes: <w:sz>
- Spacing: <w:spacing>, <w:ind>
- Alignment: <w:jc>
- Table structures: <w:tbl>, <w:tr>, <w:tc>
- Column widths: <w:tcW>, <w:gridCol>
- Cell merging: <w:gridSpan>, <w:vMerge>
- Borders: <w:tblBorders>, <w:tcBorders>
- Cell shading: <w:shd>
- Images: <w:drawing>
- ANY attributes including xml:space="preserve"
- Document structure, hierarchy, whitespace between tags

DO NOT:
- Add, remove, or modify any XML tags or attributes
- Reformat or prettify XML
- Change character encoding
- Interpret or "correct" data
- Translate between languages
- Remove or add whitespace within <w:t> content

ERROR HANDLING:
- Variable not in dictionary: leave placeholder intact
- Placeholder without value (empty string ""): replace with empty, remove placeholder
- Split placeholder: DO NOT MODIFY

OUTPUT FORMAT:
- Return complete XML document exactly as input, with only <w:t> text modified
- Preserve ALL whitespace, newlines, indentation from original
- No markdown wrappers, no code blocks, no explanations
- Raw XML output only
</rules>

Execute with MAXIMUM caution. Modify ONLY text within <w:t> tags. Preserve EVERYTHING else with absolute fidelity.`;

    const userPrompt = `Replace the placeholders in this XML document with the provided values.

Variables (JSON):
${JSON.stringify(fieldValues, null, 2)}

XML Document:
${document.xml_content}`;

    console.log('Calling AI to fill document...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to process document with AI', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const filledXml = aiData.choices[0].message.content;

    console.log('Document filled successfully');

    // Update document with filled XML
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        xml_content: filledXml,
        html_cache: null, // Clear cache so it regenerates
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('Error updating document:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update document' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Document filled successfully',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in fill-document-fields:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
