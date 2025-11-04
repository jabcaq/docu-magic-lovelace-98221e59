const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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

    const runs = extractRuns(textContent);

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
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        success: false 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

function extractRuns(text: string): Array<{ text: string }> {
  const runs: Array<{ text: string }> = [];
  const paragraphs = text.split(/\n\n+/);
  
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    
    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (trimmedSentence) {
        runs.push({ text: trimmedSentence });
      }
    }
  }
  
  return runs;
}
