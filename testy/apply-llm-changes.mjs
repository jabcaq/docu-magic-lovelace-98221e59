import fs from 'fs';
import path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import JSZip from 'jszip';

const DOCX_PATH = 'dokumentacja/dokumenty_doc/Citroen Berlingo Dokument_szablon_v2.docx';
const LLM_RESPONSES_PATH = 'dokumentacja/ekstrakcja/llm_responses.json';
const OUTPUT_DOCX_PATH = 'dokumentacja/ekstrakcja/processed_output.docx';

async function applyChanges() {
  try {
    if (!fs.existsSync(DOCX_PATH)) {
      console.error(`DOCX file not found: ${DOCX_PATH}`);
      return;
    }
    if (!fs.existsSync(LLM_RESPONSES_PATH)) {
      console.error(`LLM responses file not found: ${LLM_RESPONSES_PATH}`);
      return;
    }

    console.log('Reading inputs...');
    const docxBuffer = fs.readFileSync(DOCX_PATH);
    const changes = JSON.parse(fs.readFileSync(LLM_RESPONSES_PATH, 'utf8'));

    // Create a Map for faster lookups: RunID -> replacement text
    // Key: "paraId-runIndex", Value: new text
    const changesMap = new Map();
    changes.forEach(change => {
      if (change.toReplaceWith !== null && change.toReplaceWith !== undefined) {
          changesMap.set(change.id, { 
              originalText: change.text,
              newText: change.toReplaceWith 
          });
      }
    });

    console.log(`Loaded ${changesMap.size} changes to apply.`);

    // Load DOCX
    const zip = new JSZip();
    await zip.loadAsync(docxBuffer);

    // Get document.xml
    let documentXmlContent = await zip.file("word/document.xml").async("string");

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      parseTagValue: false,
    });

    const parsed = parser.parse(documentXmlContent);
    const body = parsed["w:document"]?.["w:body"];

    if (!body) {
      console.error('Could not find w:body in document.xml');
      return;
    }

    let modifiedCount = 0;

    // Helper to process a paragraph node
    const processParagraphNode = (p) => {
      // Get paraId
      const paraId = p["@_w14:paraId"];
      if (!paraId) return;

      const runs = Array.isArray(p["w:r"]) 
        ? p["w:r"] 
        : (p["w:r"] ? [p["w:r"]] : []);

      runs.forEach((run, runIndex) => {
        const runId = `${paraId}-${runIndex}`;
        
        if (changesMap.has(runId)) {
          const change = changesMap.get(runId);
          
          // Find w:t and replace its content
          const textElements = Array.isArray(run["w:t"]) 
            ? run["w:t"] 
            : (run["w:t"] ? [run["w:t"]] : []);
          
          if (textElements.length > 0) {
            // Replace the text content
            // w:t can be string or object with #text
            if (typeof run["w:t"] === 'string') {
              run["w:t"] = change.newText;
            } else if (Array.isArray(run["w:t"])) {
              // Replace first text element, clear others
              run["w:t"] = [change.newText];
            } else if (run["w:t"] && typeof run["w:t"] === 'object') {
              run["w:t"]["#text"] = change.newText;
            }
            modifiedCount++;
            console.log(`  ✓ ${runId}: "${change.originalText}" → "${change.newText}"`);
          }
        }
      });
    };

    // Process main body paragraphs
    const mainParagraphs = Array.isArray(body["w:p"]) ? body["w:p"] : (body["w:p"] ? [body["w:p"]] : []);
    mainParagraphs.forEach(p => processParagraphNode(p));

    // Process tables
    const tables = Array.isArray(body["w:tbl"]) ? body["w:tbl"] : (body["w:tbl"] ? [body["w:tbl"]] : []);
    tables.forEach(tbl => {
      const rows = Array.isArray(tbl["w:tr"]) ? tbl["w:tr"] : (tbl["w:tr"] ? [tbl["w:tr"]] : []);
      rows.forEach(tr => {
        const cells = Array.isArray(tr["w:tc"]) ? tr["w:tc"] : (tr["w:tc"] ? [tr["w:tc"]] : []);
        cells.forEach(tc => {
          const cellParas = Array.isArray(tc["w:p"]) ? tc["w:p"] : (tc["w:p"] ? [tc["w:p"]] : []);
          cellParas.forEach(p => processParagraphNode(p));
        });
      });
    });

    console.log(`\nApplied ${modifiedCount} changes.`);

    // Rebuild XML
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      format: false,
      suppressEmptyNode: false
    });

    const newXmlContent = builder.build(parsed);

    // Update zip
    zip.file("word/document.xml", newXmlContent);

    // Generate output
    const outputBuffer = await zip.generateAsync({ type: "nodebuffer" });
    fs.writeFileSync(OUTPUT_DOCX_PATH, outputBuffer);

    console.log(`Saved processed DOCX to: ${OUTPUT_DOCX_PATH}`);

  } catch (error) {
    console.error('Error applying changes:', error);
  }
}

applyChanges();
