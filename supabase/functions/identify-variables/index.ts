import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { runTexts } = await req.json();
    console.log(`Identifying variables in ${runTexts.length} runs`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Prepare the prompt
    const inputText = runTexts.join('\n');
    const systemPrompt = `Jesteś ekspertem od wykrywania dynamicznych danych w tekstach. 
Twoim zadaniem jest zamiana wszystkich dynamicznych danych (daty, imiona, nazwiska, miasta, ulice, numery, etc.) na zmienne w formacie {{nazwa_zmiennej}}.

ZASADY:
- NIE zmieniaj tekstów statycznych (pojedyncze znaki jak "-", komunikaty stałe)
- Zamieniaj TYLKO dane dynamiczne
- Zwróć DOKŁADNIE tyle samo linii co w inputcie
- Format zmiennych: {{nazwa_zmiennej}} (małe litery, podkreślenia zamiast spacji)
- Nie dodawaj nowych linii ani nie łącz istniejących
- Zachowaj puste linie jako puste linie

PRZYKŁADY ZAMIAN:
"KUBICZ DANIEL" → "{{imie_nazwisko}}"
"09-07-2025" → "{{data}}"
"ul. Zielona 12" → "{{ulica}}"
"WARSZAWA" → "{{miasto}}"
"123-456-789" → "{{telefon}}"
"-" → "-" (nie zmieniaj)
"" → "" (pusta linia pozostaje pusta)`;

    const userPrompt = `Oto teksty do przetworzenia (każdy w osobnej linii):\n\n${inputText}\n\nZwróć DOKŁADNIE tyle samo linii z podmienionymi zmiennymi:`;

    // Call Lovable AI
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiData = await response.json();
    const aiOutput = aiData.choices[0].message.content;
    
    console.log('AI Output:', aiOutput);

    // Parse the output back into array
    const processedTexts = aiOutput
      .split('\n')
      .map((line: string) => line.trim());

    // Ensure we have the same number of lines
    if (processedTexts.length !== runTexts.length) {
      console.warn(`Line count mismatch: input=${runTexts.length}, output=${processedTexts.length}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        processedTexts,
        original: runTexts,
        count: processedTexts.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error identifying variables:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
