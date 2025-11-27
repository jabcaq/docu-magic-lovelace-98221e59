import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Typy zmiennych wyciąganych z dokumentów celnych i samochodowych
const DOCUMENT_VARIABLES = {
  // Dane pojazdu
  vehicle: {
    vin: { label: 'Numer VIN', pattern: /[A-HJ-NPR-Z0-9]{17}/ },
    make: { label: 'Marka pojazdu', examples: ['AUDI', 'BMW', 'DODGE', 'MASERATI'] },
    model: { label: 'Model pojazdu', examples: ['DURANGO', 'GHIBLI', 'A4'] },
    year: { label: 'Rok produkcji', pattern: /\b(19|20)\d{2}\b/ },
    engineCapacity: { label: 'Pojemność silnika' },
    enginePower: { label: 'Moc silnika' },
    vehicleWeight: { label: 'Masa pojazdu' },
    plateNumber: { label: 'Numer rejestracyjny' },
  },
  // Dane osobowe/importera
  person: {
    ownerName: { label: 'Imię i nazwisko właściciela' },
    buyerName: { label: 'Imię i nazwisko kupującego' },
    importerName: { label: 'Nazwa importera' },
    eori: { label: 'Numer EORI', pattern: /[A-Z]{2}\d{9,15}/ },
  },
  // Adresy
  address: {
    streetAddress: { label: 'Adres ulicy' },
    city: { label: 'Miasto' },
    postalCode: { label: 'Kod pocztowy' },
    country: { label: 'Kraj (kod)' },
  },
  // Dokumenty i numery referencyjne
  documents: {
    mrnNumber: { label: 'Numer MRN', pattern: /\d{2}[A-Z]{2}[A-Z0-9]{14,18}/ },
    referenceNumber: { label: 'Numer referencyjny' },
    shipmentNumber: { label: 'Numer przesyłki' },
    invoiceNumber: { label: 'Numer faktury' },
    declarationNumber: { label: 'Numer zgłoszenia celnego' },
    containerNumber: { label: 'Numer kontenera' },
    bookingNumber: { label: 'Numer rezerwacji' },
  },
  // Daty
  dates: {
    issueDate: { label: 'Data wydania' },
    declarationDate: { label: 'Data deklaracji' },
    acceptanceDate: { label: 'Data akceptacji' },
    expiryDate: { label: 'Data ważności' },
  },
  // Dane finansowe
  financial: {
    customsValue: { label: 'Wartość celna' },
    invoiceValue: { label: 'Wartość faktury' },
    importDuty: { label: 'Cło importowe' },
    vatAmount: { label: 'Kwota VAT' },
    totalAmount: { label: 'Kwota całkowita' },
    grossPrice: { label: 'Cena brutto' },
    netPrice: { label: 'Cena netto' },
  },
  // Transport/Logistyka
  transport: {
    vesselName: { label: 'Nazwa statku' },
    transportType: { label: 'Typ transportu' },
    grossWeight: { label: 'Masa brutto (kg)' },
  },
  // Eksporter
  exporter: {
    exporterName: { label: 'Nazwa eksportera' },
    exporterAddress: { label: 'Adres eksportera' },
    exporterCountry: { label: 'Kraj eksportera' },
  },
  // Kody celne
  customs: {
    commodityCode: { label: 'Kod towaru' },
    tariffCode: { label: 'Kod taryfy' },
    customsOffice: { label: 'Urząd celny' },
    procedureCode: { label: 'Kod procedury' },
  }
};

function getMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isPdfFile(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

function isDocxFile(mimeType: string): boolean {
  return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
         mimeType === 'application/msword';
}

async function extractTextFromDocx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = zip.file("word/document.xml");
  
  if (!documentXml) {
    throw new Error("document.xml not found in DOCX");
  }
  
  const xmlContent = await documentXml.async("text");
  
  // Wyciągnij tekst z tagów <w:t>
  const textMatches = xmlContent.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
  if (!textMatches) return '';
  
  return textMatches
    .map(match => {
      const textContent = match.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, '');
      return textContent;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

    // Obsługa FormData (upload pliku) lub JSON (analiza istniejącego dokumentu)
    let fileBuffer: ArrayBuffer;
    let fileName: string;
    let mimeType: string;
    let documentId: string | null = null;
    let saveToDatabase = false;

    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      // Upload nowego pliku
      const formData = await req.formData();
      const file = formData.get('file') as File;
      saveToDatabase = formData.get('saveToDatabase') === 'true';
      
      if (!file) {
        throw new Error('No file provided');
      }
      
      fileName = file.name;
      mimeType = file.type || getMimeType(fileName);
      fileBuffer = await file.arrayBuffer();
      
      console.log(`Processing uploaded file: ${fileName}, type: ${mimeType}, size: ${fileBuffer.byteLength}`);
    } else {
      // Analiza istniejącego dokumentu z bazy
      const body = await req.json();
      documentId = body.documentId;
      saveToDatabase = body.saveToDatabase !== false;
      
      if (!documentId) {
        throw new Error('documentId is required');
      }
      
      // Pobierz dokument z bazy
      const { data: document, error: docError } = await supabase
        .from('documents')
        .select('storage_path, name, type')
        .eq('id', documentId)
        .single();

      if (docError || !document) {
        throw new Error('Document not found');
      }

      // Pobierz plik z storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('documents')
        .download(document.storage_path);

      if (downloadError || !fileData) {
        throw new Error('Failed to download file');
      }

      fileName = document.name;
      mimeType = getMimeType(fileName);
      fileBuffer = await fileData.arrayBuffer();
      
      console.log(`Processing stored document: ${fileName}, type: ${mimeType}`);
    }

    // Przygotuj zawartość dla Gemini
    let contentForAi: any[];
    
    if (isImageFile(mimeType) || isPdfFile(mimeType)) {
      // Dla obrazów i PDF - użyj vision
      const base64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
      
      contentForAi = [
        {
          type: 'text',
          text: 'Przeanalizuj dokładnie ten dokument i wyciągnij WSZYSTKIE widoczne dane. Zwróć wynik w formacie JSON.'
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64}`
          }
        }
      ];
    } else if (isDocxFile(mimeType)) {
      // Dla DOCX - wyciągnij tekst i analizuj
      const textContent = await extractTextFromDocx(fileBuffer);
      console.log('Extracted DOCX text length:', textContent.length);
      
      contentForAi = [
        {
          type: 'text',
          text: `Przeanalizuj dokładnie ten dokument i wyciągnij WSZYSTKIE widoczne dane. Zwróć wynik w formacie JSON.\n\nTreść dokumentu:\n${textContent.slice(0, 50000)}`
        }
      ];
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Przygotuj listę kategorii zmiennych do promptu
    const variableCategories = Object.entries(DOCUMENT_VARIABLES)
      .map(([category, fields]) => {
        const fieldList = Object.entries(fields)
          .map(([key, info]) => `  - ${key}: ${info.label}`)
          .join('\n');
        return `${category}:\n${fieldList}`;
      })
      .join('\n\n');

    // Wywołaj Gemini 2.5 Pro przez Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log('Calling Gemini 2.5 Pro for OCR analysis...');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: `Jesteś ekspertem OCR specjalizującym się w analizie dokumentów celnych, motoryzacyjnych i urzędowych.

Twoim zadaniem jest wyciągnięcie WSZYSTKICH widocznych danych z dokumentu i zwrócenie ich w ustrukturyzowanym formacie JSON.

KATEGORIE ZMIENNYCH DO WYKRYCIA:

${variableCategories}

ZASADY:
1. Wyciągnij WSZYSTKIE widoczne dane, nawet jeśli nie pasują do powyższych kategorii
2. Dla każdej znalezionej wartości określ:
   - tag: nazwa zmiennej w camelCase (np. vinNumber, ownerName)
   - label: czytelna nazwa po polsku
   - value: wyciągnięta wartość
   - category: kategoria (vehicle, person, address, documents, dates, financial, transport, exporter, customs, other)
   - confidence: pewność wykrycia (high, medium, low)
3. Jeśli znajdziesz wartość, która nie pasuje do predefiniowanych kategorii, użyj category: "other"
4. Zwróć TYLKO czysty JSON, bez markdown, bez komentarzy

FORMAT ODPOWIEDZI:
{
  "documentType": "typ dokumentu np. 'Deklaracja celna', 'Faktura', 'Dowód rejestracyjny'",
  "documentLanguage": "język dokumentu np. 'nl', 'pl', 'en', 'de'",
  "extractedFields": [
    {
      "tag": "vinNumber",
      "label": "Numer VIN",
      "value": "WAUENCF57JA005040",
      "category": "vehicle",
      "confidence": "high"
    }
  ],
  "rawText": "Pełny rozpoznany tekst z dokumentu",
  "summary": "Krótkie podsumowanie zawartości dokumentu"
}`
          },
          {
            role: 'user',
            content: contentForAi
          }
        ],
        max_tokens: 8000,
        temperature: 0.1 // Niska temperatura dla precyzyjnej ekstrakcji
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Gemini API error:', aiResponse.status, errorText);
      throw new Error(`Gemini API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const extractedText = aiData.choices?.[0]?.message?.content;

    if (!extractedText) {
      throw new Error('No response from Gemini');
    }

    console.log('Gemini response received, parsing...');

    // Parsuj odpowiedź JSON
    let ocrResult;
    try {
      // Usuń markdown jeśli obecny
      const jsonText = extractedText
        .replace(/```json\n?/g, '')
        .replace(/\n?```/g, '')
        .trim();
      ocrResult = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', extractedText);
      
      // Próba ekstrakcji JSON z odpowiedzi
      const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          ocrResult = JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error('Failed to parse OCR results');
        }
      } else {
        throw new Error('Failed to parse OCR results');
      }
    }

    console.log(`Extracted ${ocrResult.extractedFields?.length || 0} fields`);

    // Zapisz wyniki do bazy jeśli potrzeba
    if (saveToDatabase && documentId && ocrResult.extractedFields?.length > 0) {
      // Utwórz pola dokumentu
      const fieldsToCreate = ocrResult.extractedFields.map((field: any, index: number) => ({
        document_id: documentId,
        field_name: field.label,
        field_tag: `{{${field.tag}}}`,
        field_value: String(field.value || ''),
        position_in_html: index,
        run_formatting: {
          category: field.category,
          confidence: field.confidence
        }
      }));

      const { error: insertError } = await supabase
        .from('document_fields')
        .insert(fieldsToCreate);

      if (insertError) {
        console.error('Error inserting fields:', insertError);
        // Nie rzucaj błędu, zwróć wyniki mimo to
      } else {
        console.log(`Saved ${fieldsToCreate.length} fields to database`);
      }

      // Zaktualizuj status dokumentu
      await supabase
        .from('documents')
        .update({ 
          status: 'verified',
          analysis_approach: 'ocr_gemini_pro'
        })
        .eq('id', documentId);
    }

    // Jeśli to nowy plik i chcemy zapisać do bazy
    if (saveToDatabase && !documentId && contentType.includes('multipart/form-data')) {
      // Zapisz plik do storage
      const filePath = `${user.id}/${Date.now()}_${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, fileBuffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (!uploadError) {
        // Utwórz rekord dokumentu
        const { data: document, error: docError } = await supabase
          .from('documents')
          .insert({
            user_id: user.id,
            name: fileName,
            type: isPdfFile(mimeType) ? 'pdf' : isImageFile(mimeType) ? 'image' : 'word',
            storage_path: filePath,
            status: 'verified',
            analysis_approach: 'ocr_gemini_pro',
            auto_analyze: false
          })
          .select()
          .single();

        if (!docError && document && ocrResult.extractedFields?.length > 0) {
          const fieldsToCreate = ocrResult.extractedFields.map((field: any, index: number) => ({
            document_id: document.id,
            field_name: field.label,
            field_tag: `{{${field.tag}}}`,
            field_value: String(field.value || ''),
            position_in_html: index,
            run_formatting: {
              category: field.category,
              confidence: field.confidence
            }
          }));

          await supabase.from('document_fields').insert(fieldsToCreate);
          
          ocrResult.documentId = document.id;
        }
      }
    }

    // Zwróć wyniki OCR
    return new Response(
      JSON.stringify({
        success: true,
        fileName,
        fileType: mimeType,
        documentType: ocrResult.documentType,
        documentLanguage: ocrResult.documentLanguage,
        summary: ocrResult.summary,
        extractedFields: ocrResult.extractedFields || [],
        rawText: ocrResult.rawText,
        fieldsCount: ocrResult.extractedFields?.length || 0,
        documentId: ocrResult.documentId || documentId
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in ocr-analyze-document:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

