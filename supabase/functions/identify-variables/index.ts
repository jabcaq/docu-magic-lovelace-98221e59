const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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
    const systemPrompt = `Jesteś ekspertem od wykrywania dynamicznych danych w dokumentach celnych, podatkowych i administracyjnych. 
Twoim zadaniem jest zamiana wszystkich dynamicznych danych na zmienne w formacie {{nazwa_zmiennej}}.

KRYTYCZNE ZASADY:
- NIE zmieniaj tekstów statycznych (pojedyncze znaki jak "-", ":", etykiety jak "Data:", "Nazwa:", "VIN:")
- Zamieniaj TYLKO wartości dynamiczne
- Zwróć DOKŁADNIE tyle samo linii co w inputcie (każda linia → jedna linia)
- Format zmiennych: {{nazwa_zmiennej}} (małe litery, podkreślenia zamiast spacji)
- Nie dodawaj ŻADNYCH dodatkowych wyjaśnień, komentarzy ani tekstu przed/po wyniku
- Zachowaj puste linie jako puste linie
- Jeśli linia zawiera tylko etykietę (np. "Data:"), zostaw ją bez zmians

❌ NIGDY NIE ZAMIENIAJ TYCH WARTOŚCI STAŁYCH (są identyczne we wszystkich dokumentach):
- "MLG INTERNATIONAL S.A." / "Panama City" (nadawca/eksporter)
- "MARLOG CAR HANDLING BV" / "SMOORSTRAAT 24" / "NL-4705 AA ROOSENDAAL" (przedstawiciel)
- "NL006223527" (numer celny przedstawiciela)
- "IM" / "A" (rodzaj deklaracji)
- "NL000396" (urząd celny)
- "1" (jako liczba artykułów/pozycji)
- "87032490000000000000" lub "87032390000000000000" (kod towarowy CN)
- "PL" (jako kod kraju przeznaczenia)
- "10" (jako stawka cła)
- "21" (jako stawka VAT)
- "Skrytka pocztowa 3070" / "6401 DN Heerlen" (adres sprzeciwu)
- "EUR" (symbol waluty, ale zamieniaj kwoty)

✅ KATEGORIE DANYCH DO ZAMIANY:

1. NUMERY REFERENCYJNE I CELNE (alfanumeryczne, często z myślnikami):
   "25NL7PU1EYHFR8FDR4" → "{{numer_referencyjny}}"
   "NL-2025-123456" → "{{numer_celny}}"
   "NLDPONL000566-2021-D-ZIA82479" → "{{numer_pozwolenia}}"
   
2. NUMERY VIN (17 znaków, wielkie litery i cyfry):
   "WMZ83BR06P3R14626" → "{{numer_vin}}"
   "1HGBH41JXMN109186" → "{{numer_vin}}"

3. KODY TOWAROWE (długie ciągi cyfr):
   "87032390000000000000" → "{{kod_towarowy}}"
   "8703239000" → "{{kod_cn}}"

4. KWOTY I WALUTY (liczby z kropkami/przecinkami i oznaczeniem waluty):
   "2.572,86 EUR" → "{{kwota_eur}}"
   "1.234,56" → "{{kwota}}"
   "123456.78" → "{{kwota}}"

5. DATY (różne formaty):
   "09-07-2025" → "{{data}}"
   "2025-07-09" → "{{data}}"
   "09.07.2025" → "{{data}}"

6. NAZWY FIRM I ORGANIZACJI (wielkie litery, często z przerywakami):
   "MARLOG CAR HANDLING BV" → "{{nazwa_firmy}}"
   "TRANSPORT-LOGISTIK GMBH" → "{{nazwa_firmy}}"

7. OSOBY (imię i nazwisko):
   "KUBICZ DANIEL" → "{{imie_nazwisko}}"
   "Jan Kowalski" → "{{imie_nazwisko}}"

8. ADRESY (ulice z numerami):
   "ul. Zielona 12" → "{{ulica_numer}}"
   "Hoofdstraat 123" → "{{ulica_numer}}"
   "P.O. Box 12345" → "{{skrytka_pocztowa}}"

9. MIASTA I KODY POCZTOWE:
   "WARSZAWA" → "{{miasto}}"
   "00-123" → "{{kod_pocztowy}}"
   "1234 AB" → "{{kod_pocztowy}}"

10. NUMERY KONTAKTOWE:
    "123-456-789" → "{{telefon}}"
    "+48 123 456 789" → "{{telefon}}"

11. PROCENTOWE STAWKI:
    "23%" → "{{stawka_procentowa}}"
    "10.5%" → "{{stawka_procentowa}}"

PRZYKŁADY KOMPLEKSOWE:

Input: "Numer deklaracji:"
Output: "Numer deklaracji:"

Input: "25NL7PU1EYHFR8FDR4"
Output: "{{numer_deklaracji}}"

Input: "MARLOG CAR HANDLING BV"
Output: "{{nazwa_firmy}}"

Input: "WMZ83BR06P3R14626"
Output: "{{numer_vin}}"

Input: "Data akceptacji:"
Output: "Data akceptacji:"

Input: "09-07-2025"
Output: "{{data}}"

Input: "2.572,86 EUR"
Output: "{{kwota_eur}}"

Input: "-"
Output: "-"

Input: ""
Output: ""

Input: "Strona:"
Output: "Strona:"

Input: "1"
Output: "{{numer_strony}}"

WAŻNE: Zwróć TYLKO przetworzone linie, bez żadnego dodatkowego tekstu, nagłówków czy wyjaśnień!`;

    const userPrompt = `Przetwórz poniższe teksty (każdy w osobnej linii). Zwróć DOKŁADNIE tyle samo linii z podmienionymi zmiennymi, bez dodatkowych komentarzy:

${inputText}

Wynik:`;

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
    const aiOutput = aiData.choices[0].message.content.trim();
    
    console.log('AI Raw Output:', aiOutput);
    console.log('Expected line count:', runTexts.length);

    // Clean AI output - remove potential headers, explanations, or markdown formatting
    let cleanedOutput = aiOutput;
    
    // Remove common AI prefixes/suffixes
    cleanedOutput = cleanedOutput.replace(/^(Wynik:|Oto przetworzone teksty:|Przetworzone linie:)\s*/i, '');
    cleanedOutput = cleanedOutput.replace(/```[\s\S]*?```/g, (match: string) => {
      // Extract content from code blocks
      return match.replace(/```[^\n]*\n?/g, '').replace(/```$/g, '');
    });
    
    // Parse the output back into array
    const processedTexts = cleanedOutput
      .split('\n')
      .map((line: string) => line.trim());

    console.log('Processed line count:', processedTexts.length);
    console.log('First 5 processed lines:', processedTexts.slice(0, 5));
    console.log('Last 5 processed lines:', processedTexts.slice(-5));

    // Ensure we have the same number of lines
    if (processedTexts.length !== runTexts.length) {
      console.warn(`⚠️ Line count mismatch: input=${runTexts.length}, output=${processedTexts.length}`);
      console.warn('Attempting to align...');
      
      // If AI added extra lines at the start/end, try to find the matching section
      if (processedTexts.length > runTexts.length) {
        console.warn('AI returned more lines than expected - trimming excess');
      }
    }

    // Return the number of lines matching input, padding with originals if needed
    const finalTexts = processedTexts.slice(0, runTexts.length);
    while (finalTexts.length < runTexts.length) {
      console.warn(`Padding missing line ${finalTexts.length} with original`);
      finalTexts.push(runTexts[finalTexts.length]);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        processedTexts: finalTexts,
        original: runTexts,
        count: finalTexts.length,
        aiReturnedCount: processedTexts.length
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
