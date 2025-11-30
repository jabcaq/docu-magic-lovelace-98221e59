import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';

const XML_PATH = 'dokumentacja/dokumenty_doc/file-content/word/document.xml';
const OUTPUT_DIR = 'dokumentacja/ekstrakcja';
const OUTPUT_FILE = 'extracted_content.json';

function extractContent() {
  try {
    if (!fs.existsSync(XML_PATH)) {
       console.error(`Error: File not found at ${XML_PATH}`);
       return;
    }

    const xmlContent = fs.readFileSync(XML_PATH, 'utf8');
    console.log('Successfully read document.xml');

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      parseTagValue: false,
    });

    const parsed = parser.parse(xmlContent);
    const body = parsed["w:document"]?.["w:body"];

    if (!body) {
      console.error('Error: Could not find w:body in XML');
      return;
    }

    const outputParagraphs = [];

    // Helper function to process a single paragraph node
    // uniqueId here is a fallback if w14:paraId is missing or for debugging path
    const processParagraphNode = (p, debugPath) => {
      
      // Try to get stable paragraph ID from Word
      // w14:paraId is standard in newer docs
      let stableId = p["@_w14:paraId"];
      
      // Fallback if not present (e.g. older docs, or inside some structures)
      if (!stableId) {
          stableId = debugPath; 
      }

      const paragraphData = {
        paragraph_id: stableId, 
        debug_path: debugPath, // Keep for reference/debugging
        full_text_context: "",
        runs: []
      };
      
      // Get all children (runs)
      const runs = Array.isArray(p["w:r"]) 
        ? p["w:r"] 
        : (p["w:r"] ? [p["w:r"]] : []);

      runs.forEach((run, runIndex) => {
        // w:t (Text)
        const textElements = Array.isArray(run["w:t"]) 
          ? run["w:t"] 
          : (run["w:t"] ? [run["w:t"]] : []);
        
        // w:tab (Tabulator) - important for context
        const hasTab = !!run["w:tab"];
        
        // Extract raw text
        let text = textElements
          .map(t => {
             if (typeof t === 'string') return t;
             return t["#text"] || "";
          })
          .join("");

        // Add space to context if there was a tab (heuristic for readability)
        if (hasTab) {
            paragraphData.full_text_context += " "; 
        }

        if (text) {
          // We construct runId based on stableId + index
          const runId = `${stableId}-${runIndex}`;
          paragraphData.full_text_context += text;
          paragraphData.runs.push({
            id: runId,
            text: text,
            toReplaceWith: null // New field for LLM
          });
        }
      });

      if (paragraphData.full_text_context.trim().length > 0 || paragraphData.runs.length > 0) {
        outputParagraphs.push(paragraphData);
      }
    };

    // 1. Process main body paragraphs
    const mainParagraphs = Array.isArray(body["w:p"]) ? body["w:p"] : (body["w:p"] ? [body["w:p"]] : []);
    mainParagraphs.forEach((p, index) => {
      processParagraphNode(p, `P${index}`);
    });

    // 2. Process tables recursively
    const tables = Array.isArray(body["w:tbl"]) ? body["w:tbl"] : (body["w:tbl"] ? [body["w:tbl"]] : []);
    tables.forEach((tbl, tblIndex) => {
      const rows = Array.isArray(tbl["w:tr"]) ? tbl["w:tr"] : (tbl["w:tr"] ? [tbl["w:tr"]] : []);
      rows.forEach((tr, trIndex) => {
        const cells = Array.isArray(tr["w:tc"]) ? tr["w:tc"] : (tr["w:tc"] ? [tr["w:tc"]] : []);
        cells.forEach((tc, tcIndex) => {
          const cellParas = Array.isArray(tc["w:p"]) ? tc["w:p"] : (tc["w:p"] ? [tc["w:p"]] : []);
          cellParas.forEach((p, pIndex) => {
            processParagraphNode(p, `T${tblIndex}:R${trIndex}:C${tcIndex}:P${pIndex}`);
          });
        });
      });
    });

    // Create output directory if it doesn't exist
    if (!fs.existsSync(OUTPUT_DIR)){
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
    fs.writeFileSync(outputPath, JSON.stringify(outputParagraphs, null, 2), 'utf8');
    
    console.log(`\nExtracted ${outputParagraphs.length} paragraphs.`);
    console.log(`Results saved to: ${outputPath}`);

  } catch (error) {
    console.error('Error:', error);
  }
}

extractContent();
