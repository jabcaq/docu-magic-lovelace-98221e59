import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Layout Parsing API configuration
const LAYOUT_API_URL = "https://y3wbd501q8k5g506.aistudio-app.com/layout-parsing";
const LAYOUT_API_TOKEN = "32d74a752461f7b08a1434a233022e75b2a5a8af";

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

// Funkcja do ekstrakcji zmiennych z markdown
function extractVariablesFromMarkdown(markdown: string): any[] {
  const fields: any[] = [];
  
  // Wzorce do wyciągania danych
  const patterns = [
    // VIN
    { pattern: /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/gi, tag: 'vinNumber', label: 'Numer VIN', category: 'vehicle' },
    // MRN
    { pattern: /MRN[:\s]*(\d{2}[A-Z]{2}[A-Z0-9]{14,18})/gi, tag: 'mrnNumber', label: 'Numer MRN', category: 'documents' },
    // Daty w różnych formatach
    { pattern: /(\d{2}[-/.]\d{2}[-/.]\d{4})/g, tag: 'date', label: 'Data', category: 'dates' },
    { pattern: /(\d{4}[-/.]\d{2}[-/.]\d{2})/g, tag: 'date', label: 'Data', category: 'dates' },
    // Kwoty EUR
    { pattern: /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*EUR/gi, tag: 'amount', label: 'Kwota EUR', category: 'financial' },
    { pattern: /EUR\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/gi, tag: 'amount', label: 'Kwota EUR', category: 'financial' },
    // EORI
    { pattern: /EORI[:\s]*([A-Z]{2}\d{9,15})/gi, tag: 'eori', label: 'Numer EORI', category: 'person' },
    // Kody pocztowe
    { pattern: /\b(\d{2}-\d{3})\b/g, tag: 'postalCode', label: 'Kod pocztowy', category: 'address' },
    { pattern: /\b([A-Z]{2}-\d{4,5}\s*[A-Z]{0,2})\b/g, tag: 'postalCode', label: 'Kod pocztowy', category: 'address' },
    // Numer kontenera
    { pattern: /([A-Z]{4}\d{7})/g, tag: 'containerNumber', label: 'Numer kontenera', category: 'transport' },
    // Masa
    { pattern: /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,3})?)\s*kg/gi, tag: 'weight', label: 'Masa (kg)', category: 'transport' },
    // Numer referencyjny MCH
    { pattern: /(MCH-[A-Z]{2}-\d{6})/gi, tag: 'referenceNumber', label: 'Numer referencyjny', category: 'documents' },
    // Kod towaru
    { pattern: /\b(8703\d{10,16})\b/g, tag: 'commodityCode', label: 'Kod towaru', category: 'customs' },
  ];
  
  const seenValues = new Set<string>();
  
  for (const { pattern, tag, label, category } of patterns) {
    let match;
    pattern.lastIndex = 0; // Reset regex
    while ((match = pattern.exec(markdown)) !== null) {
      const value = match[1] || match[0];
      const normalizedValue = value.trim();
      
      if (!seenValues.has(`${tag}:${normalizedValue}`)) {
        seenValues.add(`${tag}:${normalizedValue}`);
        fields.push({
          tag: fields.filter(f => f.tag.startsWith(tag)).length > 0 
            ? `${tag}${fields.filter(f => f.tag.startsWith(tag)).length + 1}` 
            : tag,
          label,
          value: normalizedValue,
          category,
          confidence: 'high'
        });
      }
    }
  }
  
  // Wyciągnij tabele z markdown i przeanalizuj
  const tableRows = markdown.match(/\|[^|]+\|[^|]+\|/g);
  if (tableRows) {
    for (const row of tableRows) {
      const cells = row.split('|').filter(c => c.trim());
      if (cells.length >= 2) {
        const key = cells[0].trim().toLowerCase();
        const value = cells[1].trim();
        
        // Mapowanie kluczy na tagi
        const keyMappings: Record<string, { tag: string; label: string; category: string }> = {
          'naam': { tag: 'ownerName', label: 'Nazwa/Imię', category: 'person' },
          'name': { tag: 'ownerName', label: 'Nazwa/Imię', category: 'person' },
          'adres': { tag: 'streetAddress', label: 'Adres', category: 'address' },
          'address': { tag: 'streetAddress', label: 'Adres', category: 'address' },
          'woonplaats': { tag: 'city', label: 'Miasto', category: 'address' },
          'city': { tag: 'city', label: 'Miasto', category: 'address' },
          'datum': { tag: 'issueDate', label: 'Data', category: 'dates' },
          'date': { tag: 'issueDate', label: 'Data', category: 'dates' },
          'aangiftenummer': { tag: 'declarationNumber', label: 'Numer zgłoszenia', category: 'documents' },
          'referentie': { tag: 'referenceNumber', label: 'Numer referencyjny', category: 'documents' },
          'reference': { tag: 'referenceNumber', label: 'Numer referencyjny', category: 'documents' },
        };
        
        for (const [mapKey, mapping] of Object.entries(keyMappings)) {
          if (key.includes(mapKey) && value && !seenValues.has(`${mapping.tag}:${value}`)) {
            seenValues.add(`${mapping.tag}:${value}`);
            fields.push({
              tag: mapping.tag,
              label: mapping.label,
              value,
              category: mapping.category,
              confidence: 'medium'
            });
          }
        }
      }
    }
  }
  
  return fields;
}

async function extractTextFromDocx(buffer: ArrayBuffer): Promise<{ text: string; base64: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = zip.file("word/document.xml");
  
  if (!documentXml) {
    throw new Error("document.xml not found in DOCX");
  }
  
  const xmlContent = await documentXml.async("text");
  
  // Wyciągnij tekst z tagów <w:t>
  const textMatches = xmlContent.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
  const text = textMatches 
    ? textMatches
        .map(match => match.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
    
  // Konwertuj do base64 dla API
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  
  return { text, base64 };
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

    // Obsługa FormData lub JSON
    let fileBuffer: ArrayBuffer;
    let fileName: string;
    let mimeType: string;
    let documentId: string | null = null;
    let saveToDatabase = false;

    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      saveToDatabase = formData.get('saveToDatabase') === 'true';
      
      if (!file) {
        throw new Error('No file provided');
      }
      
      fileName = file.name;
      mimeType = file.type || getMimeType(fileName);
      fileBuffer = await file.arrayBuffer();
      
      console.log(`[Layout API] Processing uploaded file: ${fileName}, type: ${mimeType}`);
    } else {
      const body = await req.json();
      documentId = body.documentId;
      saveToDatabase = body.saveToDatabase !== false;
      
      if (!documentId) {
        throw new Error('documentId is required');
      }
      
      const { data: document, error: docError } = await supabase
        .from('documents')
        .select('storage_path, name, type')
        .eq('id', documentId)
        .single();

      if (docError || !document) {
        throw new Error('Document not found');
      }

      const { data: fileData, error: downloadError } = await supabase.storage
        .from('documents')
        .download(document.storage_path);

      if (downloadError || !fileData) {
        throw new Error('Failed to download file');
      }

      fileName = document.name;
      mimeType = getMimeType(fileName);
      fileBuffer = await fileData.arrayBuffer();
      
      console.log(`[Layout API] Processing stored document: ${fileName}`);
    }

    // Określ typ pliku dla API (0 = PDF, 1 = image)
    let fileType: number;
    let fileBase64: string;
    
    if (isPdfFile(mimeType)) {
      fileType = 0;
      fileBase64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
    } else if (isImageFile(mimeType)) {
      fileType = 1;
      fileBase64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
    } else if (isDocxFile(mimeType)) {
      // Dla DOCX - użyj ekstrakcji tekstu jako fallback
      const { text, base64 } = await extractTextFromDocx(fileBuffer);
      console.log('[Layout API] DOCX not directly supported, using text extraction');
      
      // Wyciągnij zmienne z tekstu
      const extractedFields = extractVariablesFromMarkdown(text);
      
      return new Response(
        JSON.stringify({
          success: true,
          provider: 'layout-parsing',
          fileName,
          fileType: mimeType,
          documentType: 'Word Document',
          documentLanguage: 'unknown',
          summary: 'Dokument Word przetworzony przez ekstrakcję tekstu',
          extractedFields,
          rawText: text,
          markdown: text,
          fieldsCount: extractedFields.length,
          documentId
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    console.log(`[Layout API] Calling Layout Parsing API, fileType: ${fileType}`);

    // Wywołaj Layout Parsing API
    const apiResponse = await fetch(LAYOUT_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `token ${LAYOUT_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: fileBase64,
        fileType,
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useChartRecognition: false,
      }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('[Layout API] Error:', apiResponse.status, errorText);
      throw new Error(`Layout API error: ${apiResponse.status}`);
    }

    const apiData = await apiResponse.json();
    console.log('[Layout API] Response received');

    if (!apiData.result || !apiData.result.layoutParsingResults) {
      throw new Error('Invalid response from Layout API');
    }

    // Połącz wszystkie strony markdown
    const allMarkdown = apiData.result.layoutParsingResults
      .map((res: any) => res.markdown?.text || '')
      .join('\n\n---\n\n');

    console.log(`[Layout API] Extracted markdown length: ${allMarkdown.length}`);

    // Wyciągnij zmienne z markdown
    const extractedFields = extractVariablesFromMarkdown(allMarkdown);
    console.log(`[Layout API] Extracted ${extractedFields.length} fields`);

    // Zapisz do bazy jeśli potrzeba
    if (saveToDatabase && documentId && extractedFields.length > 0) {
      const fieldsToCreate = extractedFields.map((field: any, index: number) => ({
        document_id: documentId,
        field_name: field.label,
        field_tag: `{{${field.tag}}}`,
        field_value: String(field.value || ''),
        position_in_html: index,
        run_formatting: {
          category: field.category,
          confidence: field.confidence,
          provider: 'layout-parsing'
        }
      }));

      await supabase.from('document_fields').insert(fieldsToCreate);
      await supabase
        .from('documents')
        .update({ 
          status: 'verified',
          analysis_approach: 'ocr_layout_parsing'
        })
        .eq('id', documentId);
    }

    // Zapisz nowy plik jeśli potrzeba
    if (saveToDatabase && !documentId && contentType.includes('multipart/form-data')) {
      const filePath = `${user.id}/${Date.now()}_${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, fileBuffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (!uploadError) {
        const { data: document, error: docError } = await supabase
          .from('documents')
          .insert({
            user_id: user.id,
            name: fileName,
            type: isPdfFile(mimeType) ? 'pdf' : 'image',
            storage_path: filePath,
            status: 'verified',
            analysis_approach: 'ocr_layout_parsing',
            auto_analyze: false
          })
          .select()
          .single();

        if (!docError && document && extractedFields.length > 0) {
          const fieldsToCreate = extractedFields.map((field: any, index: number) => ({
            document_id: document.id,
            field_name: field.label,
            field_tag: `{{${field.tag}}}`,
            field_value: String(field.value || ''),
            position_in_html: index,
            run_formatting: {
              category: field.category,
              confidence: field.confidence,
              provider: 'layout-parsing'
            }
          }));

          await supabase.from('document_fields').insert(fieldsToCreate);
          documentId = document.id;
        }
      }
    }

    // Zwróć wyniki
    return new Response(
      JSON.stringify({
        success: true,
        provider: 'layout-parsing',
        fileName,
        fileType: mimeType,
        documentType: isPdfFile(mimeType) ? 'PDF Document' : 'Image',
        documentLanguage: 'auto-detected',
        summary: `Dokument przetworzony przez Layout Parsing API. Wykryto ${extractedFields.length} pól.`,
        extractedFields,
        rawText: allMarkdown.slice(0, 5000), // Pierwsze 5000 znaków
        markdown: allMarkdown,
        fieldsCount: extractedFields.length,
        documentId,
        layoutResults: apiData.result.layoutParsingResults.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Layout API] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false,
        provider: 'layout-parsing',
        error: errorMessage 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

