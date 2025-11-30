# Word Templater - Specyfikacja Techniczna Pipeline'u

## 1. Przegląd Rozwiązania

Rozwiązanie umożliwia automatyczną transformację dokumentów Word (DOCX) w szablony z dynamicznymi zmiennymi. System wykorzystuje ekstrakcję struktury XML dokumentu, przetwarzanie przez LLM (Gemini 3 Pro) oraz deterministyczne podstawianie tagów.

### Kluczowe Osiągnięcia
- **Deterministyczna ekstrakcja** tekstu z zachowaniem struktury paragrafów (`w:p`) i runów (`w:r`/`w:t`)
- **Paragraph-centric approach** - grupowanie runów w kontekst paragrafu dla lepszego zrozumienia przez LLM
- **Stabilne ID** oparte na `w14:paraId` z XML Word'a
- **Batch processing** z równoległym przetwarzaniem zapytań do LLM
- **Precyzyjny Find & Replace** z zachowaniem formatowania dokumentu

---

## 2. Architektura Pipeline'u

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  analyze-runs   │ ──► │ prepare-llm-    │ ──► │ process-llm-    │ ──► │ apply-llm-      │
│     .mjs        │     │   batches.mjs   │     │   batches.mjs   │     │   changes.mjs   │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │                       │
        ▼                       ▼                       ▼                       ▼
 extracted_content.json  llm_batches.json      llm_responses.json    processed_output.docx
```

---

## 3. Fundamenty Techniczne - DOCX i WordprocessingML

### 3.1 Czym jest DOCX?

DOCX to **archiwum ZIP** zawierające pliki XML zgodne ze standardem Office Open XML (OOXML).

```
dokument.docx (ZIP)
├── [Content_Types].xml        # Typy MIME
├── _rels/
│   └── .rels                  # Relacje główne
├── word/
│   ├── document.xml           # ⭐ GŁÓWNA TREŚĆ DOKUMENTU
│   ├── styles.xml             # Style (fonty, kolory, rozmiary)
│   ├── settings.xml           # Ustawienia dokumentu
│   ├── fontTable.xml          # Tabela fontów
│   ├── header1.xml            # Nagłówki
│   ├── footer1.xml            # Stopki
│   ├── _rels/
│   │   └── document.xml.rels  # Relacje dokumentu
│   └── media/                 # Obrazy i multimedia
└── docProps/
    ├── core.xml               # Metadane (autor, tytuł)
    └── app.xml                # Właściwości aplikacji
```

**Kluczowa informacja:** Modyfikujemy TYLKO `word/document.xml`. Reszta pozostaje nietknięta, co zachowuje formatowanie, style i obrazy.

### 3.2 Hierarchia Elementów XML w document.xml

```
w:document
└── w:body
    ├── w:p (Paragraph)                    ← "Atom znaczenia"
    │   ├── @w14:paraId="044526E9"         ← Stabilne ID paragrafu
    │   ├── w:pPr (Paragraph Properties)   ← Właściwości paragrafu
    │   └── w:r (Run)                      ← "Atom formatowania"
    │       ├── w:rPr (Run Properties)     ← Właściwości formatowania
    │       └── w:t (Text)                 ← "Atom treści" ⭐
    │           └── "Tekst do wyciągnięcia"
    │
    └── w:tbl (Table)
        └── w:tr (Table Row)
            └── w:tc (Table Cell)
                └── w:p (Paragraph)        ← Tabele zawierają paragrafy
```

### 3.3 Problem "Shredding" (Poszatkowania Tekstu)

Word często dzieli logicznie ciągły tekst na wiele elementów `w:r`:

**Przykład - numer rejestracyjny "1XHK300" w XML:**
```xml
<w:p w14:paraId="044526E9">
  <w:r w:rsidR="008B34B2">
    <w:t>1</w:t>           <!-- Run 0 -->
  </w:r>
  <w:r w:rsidR="008C595D">
    <w:t>XHK300</w:t>      <!-- Run 1 -->
  </w:r>
</w:p>
```

**Przyczyny poszatkowania:**
- Różne sesje edycji (`rsidR` - Revision Save ID)
- Zmiany formatowania (nawet niewidoczne)
- Sprawdzanie pisowni
- Kopiuj-wklej z różnych źródeł

**Nasze rozwiązanie:** Grupujemy runy w `full_text_context` paragrafu, aby LLM widział pełny kontekst.

---

## 4. Mechanizm Find & Replace - Szczegółowy Opis

### 4.1 Przepływ Danych przy Aplikacji Zmian

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ORYGINALNY DOCX (Citroen Berlingo Dokument_szablon_v2.docx)            │
│  (to jest plik ZIP zawierający XML-e)                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  JSZip.loadAsync(docxBuffer)                                            │
│  → Wczytanie DOCX do pamięci jako archiwum ZIP                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  zip.file("word/document.xml").async("string")                          │
│  → Wyciągnięcie TYLKO document.xml (główna treść dokumentu)             │
│  → Reszta plików (style, fonty, obrazy, relacje) zostaje nietknięta     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  XMLParser.parse(documentXmlContent)                                    │
│  → Parsowanie XML do obiektu JavaScript                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  FIND & REPLACE (w pamięci, na sparsowanym obiekcie)                    │
│  → Szukanie po runId (np. "044526E9-0")                                 │
│  → Modyfikacja wartości w:t wewnątrz odpowiednich w:r                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  XMLBuilder.build(parsed)                                               │
│  → Serializacja zmodyfikowanego obiektu z powrotem do XML string        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  zip.file("word/document.xml", newXmlContent)                           │
│  → Podmiana document.xml w archiwum ZIP (w pamięci)                     │
│  → Wszystkie inne pliki pozostają NIEZMIENIONE                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  zip.generateAsync({ type: "nodebuffer" })                              │
│  → Wygenerowanie nowego pliku ZIP/DOCX                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  WYNIKOWY DOCX (processed_output.docx)                                  │
│  → Identyczna struktura jak oryginał                                    │
│  → Zmieniony TYLKO document.xml (treść)                                 │
│  → Zachowane: style, formatowanie, obrazy, nagłówki, stopki             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Kontekstowy Find & Replace (Kluczowa Innowacja)

**Problem bez kontekstu paragrafu:**
Gdybyśmy robili globalny Find & Replace na tekst "1", zamienilibyśmy WSZYSTKIE jedynki w dokumencie!

**Nasze rozwiązanie - identyfikacja po `runId`:**

```javascript
// Pseudokod logiki Find & Replace
const processParagraphNode = (p) => {
  // 1. Pobierz ID paragrafu z atrybutu XML
  const paraId = p["@_w14:paraId"];  // np. "044526E9"
  if (!paraId) return;

  // 2. Iteruj po runach W TYM KONKRETNYM PARAGRAFIE
  const runs = p["w:r"];

  runs.forEach((run, runIndex) => {
    // 3. Zbuduj unikalne ID runa: paraId + indeks
    const runId = `${paraId}-${runIndex}`;  // np. "044526E9-0"
    
    // 4. Sprawdź czy ten konkretny run ma być zmieniony
    if (changesMap.has(runId)) {
      const change = changesMap.get(runId);
      // 5. Podmień tekst w w:t
      run["w:t"] = change.newText;  // np. "{{registrationNumber}}"
    }
  });
};
```

**Gwarancja precyzji:**
- Szukamy konkretnego runa o ID `044526E9-0`
- Ten run istnieje TYLKO w paragrafie `044526E9`
- Zamieniamy TYLKO ten jeden run, nie dotykając innych "1" w dokumencie

### 4.3 Strategia Scalania Poszatkowanych Zmiennych

**Przed (w document.xml):**
```xml
<w:p w14:paraId="044526E9">
  <w:r><w:t>1</w:t></w:r>           <!-- runId="044526E9-0" -->
  <w:r><w:t>XHK300</w:t></w:r>      <!-- runId="044526E9-1" -->
</w:p>
```

**Zmiany z LLM:**
```json
[
  { "id": "044526E9-0", "toReplaceWith": "{{registrationNumber}}" },
  { "id": "044526E9-1", "toReplaceWith": "" }
]
```

**Po (w document.xml):**
```xml
<w:p w14:paraId="044526E9">
  <w:r><w:t>{{registrationNumber}}</w:t></w:r>  <!-- ZMIENIONE -->
  <w:r><w:t></w:t></w:r>                         <!-- PUSTE -->
</w:p>
```

**Efekt w Wordzie:** `{{registrationNumber}}` (runy się "sklejają" wizualnie)

### 4.4 Co się dzieje z resztą dokumentu?

| Element | Co się dzieje |
|---------|---------------|
| `word/document.xml` | **MODYFIKOWANY** - tylko `w:t` w wybranych runach |
| `word/styles.xml` | Niezmieniony - style zachowane |
| `word/settings.xml` | Niezmieniony |
| `word/fontTable.xml` | Niezmieniony - fonty zachowane |
| `word/header1.xml` | Niezmieniony - nagłówki zachowane |
| `word/footer1.xml` | Niezmieniony - stopki zachowane |
| `word/media/*` | Niezmienione - obrazy zachowane |
| `[Content_Types].xml` | Niezmieniony |
| `_rels/.rels` | Niezmieniony |

---

## 5. System Identyfikatorów (ID)

### 5.1 Generowanie ID (Ekstrakcja)

```javascript
// W analyze-runs.mjs
const processParagraphNode = (p, debugPath) => {
  // Priorytet 1: Stabilne ID z XML Word'a
  let stableId = p["@_w14:paraId"];  // np. "044526E9"
  
  // Priorytet 2: Fallback dla starszych dokumentów
  if (!stableId) {
    stableId = debugPath;  // np. "P6" lub "T0:R1:C2:P0"
  }

  runs.forEach((run, runIndex) => {
    if (run ma tekst) {
      const runId = `${stableId}-${runIndex}`;  // np. "044526E9-0"
      // Zapisz do JSON
    }
  });
};
```

### 5.2 Odtwarzanie ID (Aplikacja)

```javascript
// W apply-llm-changes.mjs - IDENTYCZNA logika!
const processParagraphNode = (p) => {
  const paraId = p["@_w14:paraId"];  // np. "044526E9"

  runs.forEach((run, runIndex) => {
    const runId = `${paraId}-${runIndex}`;  // np. "044526E9-0"
    // Szukaj w mapie zmian
  });
};
```

### 5.3 Krytyczna Zależność

⚠️ **UWAGA:** Obie strony (ekstrakcja i aplikacja) MUSZĄ:
1. Używać tego samego pliku źródłowego DOCX
2. Generować ID w identyczny sposób
3. Liczyć indeksy runów w tej samej kolejności

---

## 6. Skrypty i Ich Odpowiedzialności

### 6.1 `analyze-runs.mjs` - Ekstrakcja Tekstu

**Cel:** Wyciągnięcie tekstu z DOCX do struktury JSON z zachowaniem kontekstu paragrafów.

**Wejście:** `dokumentacja/dokumenty_doc/file-content/word/document.xml` (rozpakowany DOCX)

**Wyjście:** `dokumentacja/ekstrakcja/extracted_content.json`

**Kluczowe Decyzje Projektowe:**
1. **Paragraph jako atom kontekstu** - `w:p` (paragraf) jest jednostką logiczną tekstu
2. **Run jako atom formatowania** - `w:r` zawiera tekst z jednolitym formatowaniem
3. **`w:t` jako atom treści** - najniższy poziom, zawiera surowy tekst
4. **`parseTagValue: false`** - traktowanie wszystkich wartości jako stringi (zapobiega konwersji "1" na liczbę)

**Struktura Wyjściowa:**
```json
{
  "paragraph_id": "044526E9",      // w14:paraId z XML (stabilne ID)
  "debug_path": "P6",              // Ścieżka debugowa (P=paragraf, T=tabela)
  "full_text_context": "1XHK300", // Pełny tekst paragrafu (dla LLM)
  "runs": [
    { "id": "044526E9-0", "text": "1", "toReplaceWith": null },
    { "id": "044526E9-1", "text": "XHK300", "toReplaceWith": null }
  ]
}
```

**Obsługa Tabel:**
- Tabele (`w:tbl`) są przetwarzane rekurencyjnie
- ID dla komórek: `T{tblIndex}:R{rowIndex}:C{cellIndex}:P{paraIndex}`

---

### 6.2 `prepare-llm-batches.mjs` - Przygotowanie Zapytań

**Cel:** Podział dokumentu na batche i wygenerowanie promptów dla LLM.

**Wejście:** `dokumentacja/ekstrakcja/extracted_content.json`

**Wyjście:** `dokumentacja/ekstrakcja/llm_batches.json`

**Parametry:**
- `BATCH_SIZE_TARGET = 1500` znaków (nie przecina paragrafów)
- Flaga `json` - output jako surowy JSON (nie stringify)

**Prompt Systemowy (kluczowe zasady):**
1. Szukaj ZMIENNYCH (VIN, Data, Nazwisko, Adres, Kwota)
2. Nie zamieniaj stałych tekstów (tytuły, etykiety, nazwy urzędów)
3. **Zasada I:** Zmienna w jednym runie → zamień cały run na `{{tag}}`
4. **Zasada II:** Zmienna poszatkowana → pierwszy run = `{{tag}}`, pozostałe = `""`
5. Format tagów: `{{camelCaseVariableName}}`

**Uruchomienie:**
```bash
node prepare-llm-batches.mjs json
```

---

### 6.3 `process-llm-batches.mjs` - Komunikacja z LLM

**Cel:** Wysłanie batchy do OpenRouter (Gemini 3 Pro) i agregacja odpowiedzi.

**Wejście:** `dokumentacja/ekstrakcja/llm_batches.json`

**Wyjście:** `dokumentacja/ekstrakcja/llm_responses.json`

**Konfiguracja:**
- `MODEL = 'google/gemini-3-pro-preview'`
- `CONCURRENT_REQUESTS = 5` (równoległe zapytania)
- `MAX_BATCHES = 5` (limit testowy, do usunięcia w produkcji)

**Wymagane Zmienne Środowiskowe:**
```env
OPENROUTER_API_KEY=sk-or-v1-...
```

**Logika Ekstrakcji Odpowiedzi:**
- LLM zwraca pełną strukturę paragrafów z wypełnionymi `toReplaceWith`
- Skrypt wyciąga tylko runy z `toReplaceWith !== null`
- Deduplikacja po `id`

**Struktura Wyjściowa:**
```json
[
  { "id": "044526E9-0", "text": "1", "toReplaceWith": "{{registrationNumber}}" },
  { "id": "044526E9-1", "text": "XHK300", "toReplaceWith": "" }
]
```

---

### 6.4 `apply-llm-changes.mjs` - Aplikacja Zmian

**Cel:** Podstawienie tagów w oryginalnym DOCX.

**Wejście:** 
- Oryginalny DOCX: `dokumentacja/dokumenty_doc/Citroen Berlingo Dokument_szablon_v2.docx`
- Zmiany: `dokumentacja/ekstrakcja/llm_responses.json`

**Wyjście:** `dokumentacja/ekstrakcja/processed_output.docx`

**Algorytm:**
1. Wczytaj DOCX jako ZIP (JSZip)
2. Wyciągnij `word/document.xml`
3. Sparsuj XML do obiektu JS (fast-xml-parser)
4. Dla każdego paragrafu z `w14:paraId`:
   - Iteruj po runach (`w:r`)
   - Jeśli `runId` jest w mapie zmian → podmień `w:t`
5. Zbuduj nowy XML (XMLBuilder)
6. Podmień `document.xml` w archiwum ZIP
7. Zapisz nowy DOCX

**Kluczowe:** ID musi być zgodne między ekstrakcją a aplikacją (ten sam plik źródłowy!)

---

## 7. Struktura Plików

### 7.1 Skrypty lokalne (development/debugging)

```
docu-magic-lovelace-98221e59/
├── analyze-runs.mjs              # Ekstrakcja tekstu z DOCX (standalone)
├── prepare-llm-batches.mjs       # Przygotowanie batchy dla LLM
├── process-llm-batches.mjs       # Komunikacja z OpenRouter/Gemini
├── apply-llm-changes.mjs         # Aplikacja zmian do DOCX
├── test-openrouter-key.ts        # Test klucza API OpenRouter
├── .env                          # OPENROUTER_API_KEY, SUPABASE_*
├── dokumentacja/
│   ├── WORD_TEMPLATER_SPECIFICATION.md  # Ta specyfikacja
│   ├── dokumenty_doc/
│   │   ├── Citroen Berlingo Dokument_szablon_v2.docx  # Źródło
│   │   └── file-content/         # Rozpakowany DOCX (do analizy)
│   │       └── word/
│   │           └── document.xml  # XML dokumentu
│   └── ekstrakcja/
│       ├── extracted_content.json   # Wyekstrahowane paragrafy
│       ├── llm_batches.json         # Batche do LLM
│       ├── llm_responses.json       # Odpowiedzi LLM (zmiany)
│       └── processed_output.docx    # Wynikowy szablon
└── .cursor/
    └── rules/
        └── project_structure.mdc    # Dokumentacja struktury projektu
```

### 7.2 Integracja produkcyjna (Supabase)

```
supabase/
├── config.toml                   # Konfiguracja funkcji (porty, JWT)
├── functions/
│   ├── word-templater-pipeline/  # ⭐ GŁÓWNA FUNKCJA PIPELINE'U
│   │   └── index.ts              # Cała logika w jednym pliku
│   └── upload-document/
│       └── index.ts              # Zmodyfikowany: pomija auto-processing
└── migrations/
    ├── 20251129142947_add_templater_pipeline_approach.sql
    ├── 20251129144817_add_word_templater_processing_status.sql
    └── 20251129160100_add_templated_status.sql
```

### 7.3 Frontend (React)

```
src/
└── components/
    └── WordTemplater.tsx         # UI: upload, polling, wyniki, pobieranie
```

---

## 8. Uruchomienie Pipeline'u

### Pełny Przepływ (krok po kroku):

```bash
# 1. Rozpakuj DOCX (jednorazowo, do analizy)
unzip "dokumentacja/dokumenty_doc/Citroen Berlingo Dokument_szablon_v2.docx" -d dokumentacja/dokumenty_doc/file-content

# 2. Ekstrakcja tekstu
node analyze-runs.mjs

# 3. Przygotowanie batchy
node prepare-llm-batches.mjs json

# 4. Przetwarzanie przez LLM (wymaga .env z OPENROUTER_API_KEY)
node process-llm-batches.mjs

# 5. Aplikacja zmian
node apply-llm-changes.mjs

# Wynik: dokumentacja/ekstrakcja/processed_output.docx
```

---

## 9. Ograniczenia i Znane Problemy

1. **Zgodność plików:** Plik do aplikacji zmian MUSI być tym samym, z którego wykonano ekstrakcję (te same `w14:paraId`)
2. **Limit testowy:** `MAX_BATCHES = 5` w `process-llm-batches.mjs` (do usunięcia w produkcji)
3. **Tabele zagnieżdżone:** Nie testowane głęboko zagnieżdżone tabele
4. **Obrazy/Kształty:** Tekst w obiektach graficznych nie jest ekstraowany
5. **Starsze dokumenty:** Dokumenty bez `w14:paraId` używają fallbackowego ID (mniej stabilne)

---

## 10. Integracja z Supabase Edge Functions (Produkcja)

### 10.1 Architektura Produkcyjna

Cały pipeline został zintegrowany jako pojedyncza **Supabase Edge Function** działająca asynchronicznie:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │ ──► │  Edge Function  │ ──► │    Database     │
│ WordTemplater   │     │ word-templater  │     │   documents     │
│    .tsx         │     │   -pipeline     │     │    (status)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │   1. Upload file      │                       │
        │──────────────────────►│                       │
        │   2. Trigger pipeline │                       │
        │──────────────────────►│                       │
        │   3. Immediate 200 OK │                       │
        │◄──────────────────────│                       │
        │                       │   4. Background       │
        │                       │      processing       │
        │                       │──────────────────────►│
        │   5. Poll status      │                       │
        │──────────────────────────────────────────────►│
        │   6. Get results      │                       │
        │◄──────────────────────────────────────────────│
```

### 10.2 Konfiguracja Supabase

**Plik:** `supabase/config.toml`

Funkcja musi być zarejestrowana w konfiguracji:
```toml
[functions.word-templater-pipeline]
verify_jwt = true
```

**Plik:** `supabase/functions/upload-document/index.ts`

Dodano warunek pomijający automatyczne przetwarzanie dla `templater_pipeline`:
```typescript
// Skip if manual mode or if handled by dedicated Word Templater pipeline
const shouldAutoProcess = analysisApproach !== 'manual' && analysisApproach !== 'templater_pipeline';
if (shouldAutoProcess) {
  // ... existing auto-processing logic
} else {
  console.log('Custom/Manual mode - skipping automatic analysis pipeline for approach:', analysisApproach);
}
```

### 10.3 Edge Function: `word-templater-pipeline`

**Lokalizacja:** `supabase/functions/word-templater-pipeline/index.ts`

**Kluczowe cechy:**
- **Asynchroniczne przetwarzanie** - funkcja zwraca 200 OK natychmiast, przetwarza w tle
- **EdgeRuntime.waitUntil** - rejestruje Promise w runtime, aby nie został ubity po wysłaniu odpowiedzi
- **Rozdzielone zapisy do DB** - duże dane zapisywane w 3 krokach (unikamy timeoutów)
- **Szczegółowe logowanie** - każdy krok logowany z prefiksem `[Background]`

**Parametry konfiguracyjne:**
```typescript
const BATCH_SIZE_TARGET = 1500;           // Max znaków na batch
const MODEL = "google/gemini-3-pro-preview"; // Model LLM
const CONCURRENT_REQUESTS = 15;           // Równoległe zapytania do LLM
```

**Przepływ w funkcji:**
```
1. Odbierz documentId z request body
2. Zwróć natychmiast { status: "processing" }
3. W tle (EdgeRuntime.waitUntil):
   a. Ustaw processing_status = "processing"
   b. Pobierz plik ze Storage
   c. Rozpakuj DOCX, wyciągnij document.xml
   d. extractParagraphs() → prepareBatches()
   e. processBatchesWithLLM() → równoległe zapytania
   f. applyChangesToXml() → deterministyczny Find & Replace
   g. Wygeneruj nowy DOCX (base64)
   h. Zapisz do DB: xml_content, processing_result, status
   i. Ustaw processing_status = "completed"
```

**Struktura `processing_result` (JSONB):**
```json
{
  "templateBase64": "UEsDBBQAAAAI...",
  "templateFilename": "Dokument_processed.docx",
  "stats": {
    "paragraphs": 110,
    "runs": 303,
    "batches": 27,
    "changesApplied": 95
  },
  "replacements": [
    { "id": "044526E9-0", "originalText": "12.05.2023", "newText": "{{issueDate}}" },
    ...
  ]
}
```

### 10.4 Schemat Bazy Danych

**Tabela `documents` - dodane kolumny:**
```sql
-- Migration: 20251129144817_add_word_templater_processing_status.sql
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS processing_result jsonb DEFAULT NULL;

-- Migration: 20251129160100_add_templated_status.sql
ALTER TABLE public.documents
DROP CONSTRAINT documents_status_check;

ALTER TABLE public.documents
ADD CONSTRAINT documents_status_check
CHECK (status IN ('pending', 'processing', 'verified', 'rejected', 'templated'));

-- Migration: 20251129142947_add_templater_pipeline_approach.sql
ALTER TABLE public.documents
ADD CONSTRAINT documents_analysis_approach_check
CHECK (analysis_approach = ANY (ARRAY['runs', 'xml_ai', 'manual', 'templater_pipeline']));
```

**Stany `processing_status`:**
| Status | Opis |
|--------|------|
| `pending` | Dokument wgrany, czeka na przetwarzanie |
| `processing` | Pipeline w trakcie działania |
| `completed` | Sukces - wyniki w `processing_result` |
| `error` | Błąd - szczegóły w `processing_result.error` |

### 10.5 Frontend: `WordTemplater.tsx`

**Lokalizacja:** `src/components/WordTemplater.tsx`

**Mechanizm pollingu:**
```typescript
const pollForStatus = async (docId: string, fileName: string) => {
  pollingInterval.current = setInterval(async () => {
    const { data: doc } = await supabase
      .from("documents")
      .select("processing_status, processing_result")
      .eq("id", docId)
      .single();

    if (doc.processing_status === "completed") {
      clearInterval(pollingInterval.current);
      // Wyświetl wyniki, włącz przycisk pobierania
    } else if (doc.processing_status === "error") {
      clearInterval(pollingInterval.current);
      // Pokaż błąd
    }
    // Jeśli "processing" - kontynuuj polling
  }, 2000); // Co 2 sekundy
};
```

**UI dla pipeline'u:**
- Radio button "Word Templater pipeline"
- Progress dialog z krokami: Upload → Analiza AI → Generowanie DOCX
- Karta wyników ze statystykami i listą zamian
- Przycisk "Pobierz DOCX" (dekoduje base64 do pliku)

### 10.6 Limity i Timeouty

| Parametr | Wartość | Uwagi |
|----------|---------|-------|
| Wall clock limit (Supabase Free) | 150s | Funkcja ubijana po tym czasie |
| Wall clock limit (Supabase Pro) | 400s | Wystarczające dla większości dokumentów |
| CPU time limit | 50ms (Free) / 2s (Pro) | Limit aktywnego CPU |
| Polling interval | 2000ms | Frontend odpytuje bazę |
| LLM timeout per batch | ~30-60s | Zależy od modelu i obciążenia |

**Optymalizacje dla długich dokumentów:**
1. `CONCURRENT_REQUESTS = 15` - równoległe zapytania do LLM
2. Rozdzielone zapisy do DB (3 kroki zamiast 1)
3. Deduplikacja zmian po ID runa

### 10.7 Narzędzia Diagnostyczne

**Skrypt testowy API:** `test-openrouter-key.ts`

Służy do weryfikacji klucza OpenRouter przed uruchomieniem pipeline'u:
```bash
npx tsx test-openrouter-key.ts
```

**Wynik sukcesu:**
```
🔑 Testing API Key: sk-or-v1-4...3a0f (Length: 73)
✅ Success! Response: API Works!
```

**Wynik błędu 401:**
```
❌ Request failed with status 401:
{"error":{"message":"User not found.","code":401}}
```

---

## 11. Dalszy Rozwój

### Zrealizowane (v1.0):
- ✅ Integracja z Supabase Edge Functions
- ✅ Asynchroniczne przetwarzanie z pollingiem
- ✅ UI do uploadu i pobierania wyników
- ✅ Szczegółowe logowanie i obsługa błędów

### Rekomendowane Usprawnienia (v2.0):
1. **Delta Output z LLM** - zwracanie tylko zmian (mniejszy output, mniej błędów)
2. **Słownik Zmiennych** - predefiniowana lista dozwolonych nazw tagów
3. **Walidacja Schematu** - JSON Schema dla odpowiedzi LLM
4. **UI do weryfikacji** - interfejs do przeglądania i akceptacji zmian przed aplikacją
5. **Obsługa nagłówków/stopek** - ekstrakcja z `header1.xml`, `footer1.xml`
6. **Kolejka zadań** - dla dokumentów przekraczających limity Edge Functions
7. **Streaming postępu** - WebSocket zamiast pollingu

---

## 12. Zależności

### Skrypty lokalne (Node.js) - dodane do package.json:
```json
{
  "dependencies": {
    "dotenv": "^17.2.3",
    "fast-xml-parser": "^5.3.2",
    "openai": "^6.9.1"
  }
}
```

**Instalacja:**
```bash
npm install dotenv fast-xml-parser openai
```

### Supabase Edge Function (Deno) - ESM imports:
```typescript
// W supabase/functions/word-templater-pipeline/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { XMLParser, XMLBuilder } from "https://esm.sh/fast-xml-parser@4.3.2";
```

### Frontend (React) - istniejące w projekcie:
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.x",
    "react": "^18.x",
    "react-router-dom": "^6.x"
  }
}
```

---

## 13. Autorzy i Historia

- **Data utworzenia specyfikacji:** 29 listopada 2025
- **Czas implementacji skryptów lokalnych:** ~2 godziny
- **Czas integracji z Supabase:** ~4 godziny (w tym debugging timeoutów i constraint'ów DB)
- **Poprzedni czas rozwoju (przez zespół):** ~3 tygodnie (bez sukcesu)

**Klucz do sukcesu:** 
1. Deterministyczna ekstrakcja oparta na strukturze XML Worda
2. Asynchroniczne przetwarzanie z pollingiem (unikamy timeoutów API Gateway)
3. Szczegółowe logowanie każdego kroku (szybka diagnostyka błędów)

---

## 14. Słownik Pojęć

| Termin | Znaczenie |
|--------|-----------|
| **DOCX** | Format dokumentu Word (archiwum ZIP z plikami XML) |
| **OOXML** | Office Open XML - standard formatów Office |
| **`w:p`** | Paragraph - element XML reprezentujący paragraf |
| **`w:r`** | Run - element XML reprezentujący ciąg tekstu z jednolitym formatowaniem |
| **`w:t`** | Text - element XML zawierający surowy tekst |
| **`w14:paraId`** | Unikalny identyfikator paragrafu (hex, np. "044526E9") |
| **Shredding** | Poszatkowanie - dzielenie tekstu na wiele runów przez Word |
| **Batch** | Paczka paragrafów wysyłana do LLM w jednym zapytaniu |
| **Tag** | Zmienna w formacie `{{nazwaZmiennej}}` |
| **Edge Function** | Funkcja serverless w Supabase (Deno runtime) |
| **Polling** | Cykliczne odpytywanie bazy o status przetwarzania |
| **Wall clock limit** | Maksymalny czas działania funkcji (150s Free / 400s Pro) |
| **processing_status** | Kolumna w DB śledząca stan pipeline'u (pending/processing/completed/error) |
| **processing_result** | Kolumna JSONB z wynikami (base64 DOCX, statystyki, lista zamian) |
