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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Brak autoryzacji' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');

    if (!openRouterKey) {
      return new Response(JSON.stringify({ error: 'Brak klucza OpenRouter' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Nieprawidłowy token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { query, limit = 10 } = await req.json();

    if (!query || query.trim().length < 2) {
      return new Response(JSON.stringify({ error: 'Zapytanie musi mieć min. 2 znaki' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[search-templates] User ${user.id} searching for: "${query}"`);

    // Step 1: Fetch all templates for this user
    const { data: templates, error: templatesError } = await supabase
      .from('templates')
      .select('id, name, storage_path, tag_metadata, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (templatesError) {
      console.error('[search-templates] Error fetching templates:', templatesError);
      throw templatesError;
    }

    // Step 2: Fetch documents that could become templates (completed processing)
    const { data: documents, error: documentsError } = await supabase
      .from('documents')
      .select('id, name, storage_path, processing_result, processing_status, template_id, created_at')
      .eq('user_id', user.id)
      .eq('processing_status', 'completed')
      .order('created_at', { ascending: false });

    if (documentsError) {
      console.error('[search-templates] Error fetching documents:', documentsError);
      throw documentsError;
    }

    console.log(`[search-templates] Found ${templates?.length || 0} templates, ${documents?.length || 0} documents`);

    // Step 3: Prepare content for LLM
    const candidates: Array<{
      type: 'template' | 'document';
      id: string;
      name: string;
      storagePath: string;
      tags: string[];
      hasTemplate: boolean;
      templateId?: string;
      createdAt: string;
    }> = [];

    // Add templates
    for (const template of templates || []) {
      const tagMeta = template.tag_metadata as any;
      const tags = tagMeta?.tags?.map((t: any) => t.tag_name || t.name || t) || [];
      
      candidates.push({
        type: 'template',
        id: template.id,
        name: template.name,
        storagePath: template.storage_path,
        tags,
        hasTemplate: true,
        createdAt: template.created_at,
      });
    }

    // Add documents without templates
    for (const doc of documents || []) {
      if (doc.template_id) continue; // Skip if already has template
      
      const result = doc.processing_result as any;
      const tags = result?.tags?.map((t: any) => t.tag_name || t.name || t) || [];
      
      candidates.push({
        type: 'document',
        id: doc.id,
        name: doc.name,
        storagePath: doc.storage_path,
        tags,
        hasTemplate: false,
        createdAt: doc.created_at,
      });
    }

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ 
        results: [],
        message: 'Brak szablonów ani dokumentów do przeszukania'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 4: Use LLM to rank candidates
    const candidatesText = candidates.map((c, i) => 
      `[${i}] ${c.name} | Tagi: ${c.tags.join(', ') || 'brak'} | Typ: ${c.type === 'template' ? 'szablon' : 'dokument'}`
    ).join('\n');

    const llmPrompt = `Jesteś asystentem wyszukiwania dokumentów celnych/firmowych.

Użytkownik szuka: "${query}"

Dostępne dokumenty/szablony:
${candidatesText}

Wybierz MAKSYMALNIE ${limit} dokumentów, które najlepiej pasują do zapytania użytkownika.
Oceń dopasowanie na podstawie:
- Nazwy dokumentu
- Tagów/zmiennych w dokumencie
- Kontekstu semantycznego (np. "faktura" pasuje do "rachunków", "VIN" pasuje do "samochód")

Odpowiedz TYLKO w formacie JSON (bez markdown):
{
  "matches": [
    {"index": 0, "score": 0.95, "reason": "Krótkie uzasadnienie"},
    {"index": 2, "score": 0.82, "reason": "Krótkie uzasadnienie"}
  ]
}

Jeśli ŻADEN dokument nie pasuje, zwróć: {"matches": []}
Sortuj od najlepszego dopasowania (score 0-1).`;

    console.log('[search-templates] Calling LLM for ranking...');

    const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': supabaseUrl,
        'X-Title': 'DocuAI Template Search',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'user', content: llmPrompt }
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('[search-templates] LLM error:', errText);
      throw new Error(`LLM error: ${llmResponse.status}`);
    }

    const llmData = await llmResponse.json();
    const llmContent = llmData.choices?.[0]?.message?.content || '{"matches": []}';
    
    console.log('[search-templates] LLM response:', llmContent);

    // Parse LLM response
    let matches: Array<{ index: number; score: number; reason: string }> = [];
    try {
      const cleaned = llmContent.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      matches = parsed.matches || [];
    } catch (e) {
      console.error('[search-templates] Failed to parse LLM response:', e);
      matches = [];
    }

    // Step 5: Build results
    const results = matches
      .filter(m => m.index >= 0 && m.index < candidates.length)
      .map(m => {
        const candidate = candidates[m.index];
        return {
          id: candidate.id,
          type: candidate.type,
          name: candidate.name,
          storagePath: candidate.storagePath,
          tags: candidate.tags,
          hasTemplate: candidate.hasTemplate,
          templateId: candidate.templateId,
          score: m.score,
          reason: m.reason,
          createdAt: candidate.createdAt,
        };
      });

    console.log(`[search-templates] Returning ${results.length} results`);

    return new Response(JSON.stringify({ 
      results,
      query,
      totalCandidates: candidates.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[search-templates] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Błąd wyszukiwania' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
