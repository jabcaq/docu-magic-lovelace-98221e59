import fs from 'fs';
import path from 'path';

const INPUT_FILE = 'dokumentacja/ekstrakcja/extracted_content.json';
const OUTPUT_FILE = 'dokumentacja/ekstrakcja/llm_batches.json';

const BATCH_SIZE_TARGET = 1500; // Characters target

const SYSTEM_PROMPT = `Jesteś ekspertem od analizy i strukturyzacji dokumentów XML (DOCX).
Twoim zadaniem jest przygotowanie dokumentu do podstawienia dynamicznych danych.

Otrzymujesz fragment dokumentu w formacie JSON. Każdy element to paragraf zawierający:
- id: unikalny identyfikator paragrafu
- full_text_context: pełny tekst paragrafu (dla zrozumienia kontekstu)
- runs: tablica fragmentów tekstu (runs), które składają się na ten paragraf.

ZASADY:
1. Twoim celem jest wypełnienie pola "toReplaceWith" w tablicy "runs". Wartość null oznacza brak zmiany.
2. Szukasz miejsc, które są ZMIENNYMI (np. VIN, Data, Nazwisko, Adres, Kwota) i powinny być zastąpione tagami w formacie {{NazwaZmiennej}}.
3. Nie zamieniaj stałych tekstów (tytuły sekcji, etykiety "Data:", "Podpis:", nazwy urzędów, stałe formułki prawne).
4. Jeśli paragraf nie zawiera zmiennych -> zostaw toReplaceWith: null.

ZASADY EDYCJI RUNÓW:
I. Jeśli zmienna jest w całości w jednym runie (np. "12.05.2023") -> ustaw toReplaceWith: "{{issueDate}}".
II. Jeśli zmienna jest poszatkowana na wiele runów (np. run1:"12.", run2:"05.", run3:"2023") ->
    - W PIERWSZYM runie (run1) ustaw toReplaceWith: "{{issueDate}}" (cały tag).
    - W POZOSTAŁYCH runach (run2, run3) ustaw toReplaceWith: "" (pusty ciąg).
    Dzięki temu po podstawieniu "skleimy" te runy w jeden logiczny tag, a resztę wyczyścimy.

Zwróć DOKŁADNIE taką samą strukturę JSON, ale z wypełnionymi polami "toReplaceWith".`;

function prepareBatches() {
  try {
    if (!fs.existsSync(INPUT_FILE)) {
      console.error(`Input file not found: ${INPUT_FILE}`);
      return;
    }

    const args = process.argv.slice(2);
    const useRawJson = args.includes('json');

    const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
    const paragraphs = JSON.parse(rawData);

    const batches = [];
    let currentBatch = [];
    let currentBatchSize = 0;

    paragraphs.forEach((para) => {
      // Calculate approximate size of this paragraph (context + json overhead estimate)
      const paraSize = para.full_text_context.length + JSON.stringify(para).length;

      // Check if adding this paragraph exceeds target size
      // But ensuring we have at least one para in a batch if it's huge
      if (currentBatchSize + paraSize > BATCH_SIZE_TARGET && currentBatch.length > 0) {
        // Push current batch and start new
        batches.push({
          system_message: SYSTEM_PROMPT,
          user_message: useRawJson ? currentBatch : JSON.stringify(currentBatch)
        });
        currentBatch = [];
        currentBatchSize = 0;
      }

      currentBatch.push(para);
      currentBatchSize += paraSize;
    });

    // Push last batch if exists
    if (currentBatch.length > 0) {
      batches.push({
        system_message: SYSTEM_PROMPT,
        user_message: useRawJson ? currentBatch : JSON.stringify(currentBatch)
      });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(batches, null, 2), 'utf8');
    console.log(`Successfully created ${batches.length} batches.`);
    console.log(`Saved to: ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('Error preparing batches:', error);
  }
}

prepareBatches();

