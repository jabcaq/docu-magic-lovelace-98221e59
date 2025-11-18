import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { documentId } = await req.json();

    console.log('Extracting data from PDF for document:', documentId);

    // Fetch document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('storage_path, name, type')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(document.storage_path);

    if (downloadError || !fileData) {
      throw new Error('Failed to download file');
    }

    // Convert file to base64
    const buffer = await fileData.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    // Call Lovable AI with vision model to extract data from PDF
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Jesteś ekspertem od analizy dokumentów celnych i motoryzacyjnych. 
Twoim zadaniem jest wyciągnięcie kluczowych danych z dokumentu.

Zwróć dane w formacie JSON z następującymi polami:
- vin: numer VIN pojazdu
- vehicle_make: marka pojazdu (np. DODGE)
- vehicle_model: model pojazdu (np. DURANGO)
- vehicle_year: rok produkcji
- owner_name: imię i nazwisko właściciela/importera
- owner_address: adres właściciela
- owner_city: miasto właściciela
- owner_postal_code: kod pocztowy
- owner_country: kraj (kod dwuliterowy)
- reference_number: numer referencyjny dokumentu
- declaration_date: data złożenia deklaracji
- mrn: numer MRN jeśli dostępny
- customs_value: wartość celna
- import_duty: cło importowe
- vat_amount: kwota VAT

Jeśli jakiejś informacji nie ma w dokumencie, zwróć null dla tego pola.
Zwróć TYLKO czysty JSON, bez żadnego dodatkowego tekstu.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Przeanalizuj ten dokument i wyciągnij wszystkie dane zgodnie z instrukcjami.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/pdf;base64,${base64}`
                }
              }
            ]
          }
        ],
        max_tokens: 2000
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const extractedText = aiData.choices?.[0]?.message?.content;

    if (!extractedText) {
      throw new Error('No response from AI');
    }

    console.log('AI extracted text:', extractedText);

    // Parse JSON from AI response
    let extractedData;
    try {
      // Remove markdown code blocks if present
      const jsonText = extractedText.replace(/```json\n?|\n?```/g, '').trim();
      extractedData = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse AI response:', extractedText);
      throw new Error('Failed to parse extracted data');
    }

    // Create document fields from extracted data
    const fieldsToCreate = [];
    const fieldMapping = {
      'vin': { label: 'VIN', category: 'vehicle_data' },
      'vehicle_make': { label: 'Marka pojazdu', category: 'vehicle_data' },
      'vehicle_model': { label: 'Model pojazdu', category: 'vehicle_data' },
      'vehicle_year': { label: 'Rok produkcji', category: 'vehicle_data' },
      'owner_name': { label: 'Imię i nazwisko właściciela', category: 'owner_data' },
      'owner_address': { label: 'Adres', category: 'owner_data' },
      'owner_city': { label: 'Miasto', category: 'owner_data' },
      'owner_postal_code': { label: 'Kod pocztowy', category: 'owner_data' },
      'owner_country': { label: 'Kraj', category: 'owner_data' },
      'reference_number': { label: 'Numer referencyjny', category: 'document_info' },
      'declaration_date': { label: 'Data deklaracji', category: 'dates' },
      'mrn': { label: 'MRN', category: 'document_info' },
      'customs_value': { label: 'Wartość celna', category: 'financial' },
      'import_duty': { label: 'Cło importowe', category: 'financial' },
      'vat_amount': { label: 'VAT', category: 'financial' }
    };

    let position = 0;
    for (const [key, value] of Object.entries(extractedData)) {
      const fieldKey = key as keyof typeof fieldMapping;
      if (value && value !== null && fieldMapping[fieldKey]) {
        const mapping = fieldMapping[fieldKey];
        fieldsToCreate.push({
          document_id: documentId,
          field_name: mapping.label,
          field_tag: `{{${key}}}`,
          field_value: String(value),
          position_in_html: position++
        });
      }
    }

    // Insert fields into database
    if (fieldsToCreate.length > 0) {
      const { error: insertError } = await supabase
        .from('document_fields')
        .insert(fieldsToCreate);

      if (insertError) {
        console.error('Error inserting fields:', insertError);
        throw insertError;
      }
    }

    // Update document status
    const { error: updateError } = await supabase
      .from('documents')
      .update({ status: 'verified' })
      .eq('id', documentId);

    if (updateError) {
      console.error('Error updating document:', updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        extractedData,
        fieldsCreated: fieldsToCreate.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in extract-pdf-data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});