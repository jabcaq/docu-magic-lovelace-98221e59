import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, content } = await req.json();
    const textContent = text || content;

    if (!textContent) {
      return new Response(
        JSON.stringify({ error: 'Text content is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Extracting runs from text, length:', textContent.length);

    // Extract runs from text
    const runs = extractRuns(textContent);

    console.log('Successfully extracted runs:', runs.length);

    return new Response(
      JSON.stringify({ 
        success: true, 
        runs,
        count: runs.length 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in word-extract-runs:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error',
        success: false 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

/**
 * Extracts runs (paragraphs and sentences) from text content
 */
function extractRuns(text: string): Array<{ text: string }> {
  const runs: Array<{ text: string }> = [];
  
  // Split by double newlines for paragraphs
  const paragraphs = text.split(/\n\n+/);
  
  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) continue;
    
    // Split paragraph into sentences
    const sentences = trimmedParagraph.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (trimmedSentence) {
        runs.push({ text: trimmedSentence });
      }
    }
  }
  
  return runs;
}
