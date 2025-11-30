import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const BATCHES_FILE = 'dokumentacja/ekstrakcja/llm_batches.json';
const OUTPUT_FILE = 'dokumentacja/ekstrakcja/llm_responses.json';
const MODEL = 'google/gemini-3-pro-preview'; 
const CONCURRENT_REQUESTS = 5; // Limit concurrency for safety
const MAX_BATCHES = 5; // TEST LIMIT: Only process first 5 batches

async function processBatch(batch, index, openai) {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: batch.system_message },
        { role: 'user', content: typeof batch.user_message === 'string' ? batch.user_message : JSON.stringify(batch.user_message) }
      ],
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0].message.content;
    let parsedContent;
    try {
       parsedContent = JSON.parse(content);
    } catch (e) {
       console.warn(`Warning: Could not parse JSON from batch ${index + 1}.`);
       return [];
    }

    // Extract runs from paragraphs
    const extractedRuns = [];
    
    // The LLM returns an array of Paragraphs, each containing runs
    // We need to traverse this to find runs with non-null toReplaceWith
    if (Array.isArray(parsedContent)) {
        parsedContent.forEach(paragraph => {
            if (paragraph.runs && Array.isArray(paragraph.runs)) {
                paragraph.runs.forEach(run => {
                    // Only keep runs that have a replacement value (and it's not null)
                    if (run.toReplaceWith !== null && run.toReplaceWith !== undefined) {
                        extractedRuns.push({
                            id: run.id,
                            text: run.text, // Keep original text for verification
                            toReplaceWith: run.toReplaceWith
                        });
                    }
                });
            }
        });
    } else if (parsedContent && parsedContent.runs) {
         // Fallback if LLM returned just a flat list of runs or wrapped in object
         parsedContent.runs.forEach(run => {
            if (run.toReplaceWith !== null) {
                extractedRuns.push(run);
            }
         });
    }

    console.log(`✅ Batch ${index + 1} completed. Found ${extractedRuns.length} changes.`);
    return extractedRuns;
  } catch (err) {
    console.error(`❌ Error processing batch ${index + 1}:`, err.message);
    return [];
  }
}

async function processBatches() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENROUTER_API_KEY not found.');
    return;
  }

  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: apiKey,
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'DocuMagic',
    },
  });

  try {
    if (!fs.existsSync(BATCHES_FILE)) {
      console.error(`Batches file not found: ${BATCHES_FILE}`);
      return;
    }

    const allBatches = JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8'));
    const batchesToProcess = allBatches.slice(0, MAX_BATCHES); // Limit to 5
    
    console.log(`Loaded ${allBatches.length} batches. Processing first ${MAX_BATCHES} batches (${CONCURRENT_REQUESTS} concurrent) with model ${MODEL}...`);

    const allResponses = [];
    
    // Process in chunks/pools
    for (let i = 0; i < batchesToProcess.length; i += CONCURRENT_REQUESTS) {
        const chunk = batchesToProcess.slice(i, i + CONCURRENT_REQUESTS);
        const promises = chunk.map((batch, chunkIndex) => 
            processBatch(batch, i + chunkIndex, openai)
        );
        
        const results = await Promise.all(promises);
        results.forEach(res => allResponses.push(...res));
    }

    // Deduplicate
    const uniqueResponses = new Map();
    allResponses.forEach(item => {
        if (item && item.id) {
            uniqueResponses.set(item.id, item);
        }
    });
    
    const finalOutput = Array.from(uniqueResponses.values());

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2), 'utf8');
    console.log(`\nProcessing complete.`);
    console.log(`Aggregated ${finalOutput.length} changes.`);
    console.log(`Saved to: ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('Fatal error:', error);
  }
}

processBatches();
