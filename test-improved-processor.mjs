/**
 * Improved DOCX Template Processor Test
 * Uses exclusion list from pattern analysis
 * 
 * Run with: node test-improved-processor.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════
// EXCLUSION LIST - Constants that appear in multiple documents
// Generated from pattern analysis of 14 documents
// ═══════════════════════════════════════════════════════════════════════

const CONSTANTS_TO_IGNORE = new Set([
  // Companies/Representatives (same in every doc)
  "MARLOG CAR HANDLING BV", "MARLOG CAR HANDLING", "SMOORSTRAAT 24", "SMOORSTRAAT",
  "ROOSENDAAL", "NL-4705 AA ROOSENDAAL", "4705 AA",
  "NL006223527", "006223527",
  "LEAN CUSTOMS B.V.", "MLG INTERNATIONAL S.A.", "Panama City",
  "NCLE MCH-TI", "SPEED CANADA",
  
  // Tariff codes
  "87032490", "87032490000000000000", "8703239000", "87032390000000000000",
  "8703249000",
  
  // Form codes
  "N935", "N821", "Y923", "792", "160",
  
  // Fixed rates/codes
  "10", "21", "IM", "A", "IM-A", "IM A",
  "EUR", "PL", "NL", "DE", "BE", "US",
  "NL000396", "NL000396/",
  "[kod kreskowy]",
  
  // Fixed addresses
  "Skrytka pocztowa 3070", "6401 DN Heerlen",
  
  // Fixed permits (same across docs)
  "NLDPONL000566-2021-D-ZIA82479",
  
  // Form labels/headers
  "WSPÓLNOTA EUROPEJSKA", "EGZEMPLARZ  TRANSPORTOWY  IMPORTU",
  "KONTROLA PRZEZ URZĄD  WYJŚCIA", "KONTROLA PO WYŁADOWANIU",
  "POZWOLENIE NA WPROWADZENIE", "PODPIS ZGŁASZAJĄCEGO",
  "Urząd Skarbowy", "Urząd Skarbowy/Urząd Celny",
  "UNIA EUROPEJSKA", "UNIA EUROPEJSKA  ",
  "KRÓLESTWO BELGII", "KRÓLESTWO BELGII  ",
  "CZĘŚĆ I", "CZĘŚĆ II",
  
  // Countries
  "STANY ZJEDNOCZONE", "KANADA", "DAMAGED", "KONIEC",
  
  // Common form text
  "OPŁATA CELNA", "VAT", "Należne", "Do zapłaty", "Zabezpieczenie",
  "Łącznie", "opakowanie", "artykuł", "Artykuł:",
  
  // Partial labels that shouldn't be variables
  "MRN", "MRN ", "PL-", "MCH-SI-", "MCH-S", "IMD",
  
  // Partial text fragments
  "Data 1-wszej rejestracji: B. ", "MACIEJ ", "MACIEJ",
  "PRZESTRZELSKI", "PRZESTRZELSKI ", "TAXCODE VAT",
]);

// Labels that end with colon should never be replaced
const isLabel = (text) => text.trim().endsWith(':');

// Single characters or very short text
const isTooShort = (text) => text.trim().length <= 2;

/**
 * Extract all text from <w:t> tags
 */
function extractAllText(xml) {
  const texts = [];
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match;
  let index = 0;
  
  while ((match = regex.exec(xml)) !== null) {
    let text = match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    
    texts.push({ index: index++, text, start: match.index });
  }
  
  return texts;
}

/**
 * Improved variable detection with exclusion list
 */
function detectVariables(texts) {
  const seenTags = new Map();
  
  return texts.map((item, idx) => {
    const text = item.text;
    const trimmed = text.trim();
    
    // Skip empty, too short, or labels
    if (!trimmed || isTooShort(trimmed) || isLabel(trimmed)) {
      return text;
    }
    
    // Skip constants
    if (CONSTANTS_TO_IGNORE.has(trimmed) || CONSTANTS_TO_IGNORE.has(trimmed.toUpperCase())) {
      return text;
    }
    
    let tag = null;
    
    // ══════════════════════════════════════════════════════════════
    // HIGH PRIORITY - Must be checked BEFORE generic patterns
    // ══════════════════════════════════════════════════════════════
    
    // Container + VIN combo (e.g., "BEAU5658460 / WAUENCF57JA005040")
    if (/^[A-Z]{4}\d{6,7}\s*\/\s*[A-HJ-NPR-Z0-9]{17}$/i.test(trimmed)) {
      tag = '{{containerVin}}';
    }
    
    // Container numbers (4 letters + 6-7 digits) - e.g., BEAU5658460, TCNU7942617
    else if (/^[A-Z]{4}\d{6,7}$/i.test(trimmed)) {
      tag = '{{containerNumber}}';
    }
    
    // Vessel/ship names (MSC, MAERSK, COSCO, CMA, HAPAG, EVER, ONE)
    else if (/^(MSC|MAERSK|COSCO|CMA|HAPAG|EVER|ONE)\s+[A-Z\s]+$/i.test(trimmed)) {
      tag = '{{vesselName}}';
    }
    
    // Booking/BL numbers (4 letters + 10+ digits) - e.g., EGLV400500241810
    else if (/^[A-Z]{4}\d{10,}$/i.test(trimmed)) {
      tag = '{{bookingNumber}}';
    }
    
    // VIN (17 chars, excluding I, O, Q)
    else if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(trimmed)) {
      tag = '{{vinNumber}}';
    }
    
    // MRN (customs ref)
    else if (/^\d{2}[A-Z]{2}[A-Z0-9]{10,}$/i.test(trimmed)) {
      tag = '{{mrnNumber}}';
    }
    
    // Dates
    else if (/^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(trimmed) ||
             /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(trimmed)) {
      tag = '{{issueDate}}';
    }
    
    // Money with EUR
    else if (/^\d{1,3}([., ]\d{3})*([.,]\d{2})?\s*EUR$/i.test(trimmed)) {
      tag = '{{amount}}';
    }
    
    // ══════════════════════════════════════════════════════════════
    // GENERIC patterns - checked after specific ones
    // ══════════════════════════════════════════════════════════════
    
    // Person names (CAPS or Title Case, 2-3 words)
    else if (/^[A-ZÄÖÜĘĄŚĆŻŹŃŁ][A-ZÄÖÜĘĄŚĆŻŹŃŁ\s]{2,}$/u.test(trimmed) && 
             trimmed.split(/\s+/).length >= 2 && trimmed.split(/\s+/).length <= 3 &&
             !CONSTANTS_TO_IGNORE.has(trimmed)) {
      tag = '{{personName}}';
    }
    
    // Addresses with street numbers
    else if (/^[A-ZÄÖÜĘĄŚĆŻŹŃŁ][a-zäöüęąśćżźńł\s]+\s+\d+/u.test(trimmed) ||
             /^[A-ZÄÖÜĘĄŚĆŻŹŃŁ]+\s+\d+\/?\d*/u.test(trimmed)) {
      if (!CONSTANTS_TO_IGNORE.has(trimmed)) {
        tag = '{{streetAddress}}';
      }
    }
    
    // Postal codes (Polish, Dutch, German)
    else if (/^\d{2}-\d{3}$/.test(trimmed) || 
             /^\d{4}\s?[A-Z]{2}$/i.test(trimmed) ||
             /^\d{5}$/.test(trimmed)) {
      tag = '{{postalCode}}';
    }
    
    // Cities (ALL CAPS, single word or with hyphen, not in constants)
    else if (/^[A-ZÄÖÜĘĄŚĆŻŹŃŁ][A-ZÄÖÜĘĄŚĆŻŹŃŁ\-\s]{2,}$/u.test(trimmed) &&
             trimmed.split(/\s+/).length === 1 &&
             !CONSTANTS_TO_IGNORE.has(trimmed)) {
      // Could be a city name
      tag = '{{city}}';
    }
    
    // Reference numbers (unique format)
    else if (/^MCH-[A-Z]{2}-\d+$/i.test(trimmed) ||
             /^[A-Z]{4}\d{7,}/i.test(trimmed)) {
      tag = '{{referenceNumber}}';
    }
    
    // Vehicle description with VIN
    else if (/\d{4}\s+[A-Z]+.*VIN/i.test(trimmed)) {
      tag = '{{vehicleDescription}}';
    }
    
    // Shipment numbers (6 digits alone, likely reference)
    else if (/^\d{6}$/.test(trimmed) && !CONSTANTS_TO_IGNORE.has(trimmed)) {
      tag = '{{shipmentNumber}}';
    }
    
    // Handle duplicates
    if (tag) {
      const count = seenTags.get(tag) || 0;
      seenTags.set(tag, count + 1);
      if (count > 0) {
        tag = tag.replace('}}', `_${count + 1}}}`);
      }
      return tag;
    }
    
    return text;
  });
}

function encodeXmlEntities(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Replace text in XML
 */
function replaceTextInXml(xml, originalTexts, processedTexts) {
  let result = xml;
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  const matches = [];
  let match;
  
  while ((match = regex.exec(xml)) !== null) {
    const fullMatch = match[0];
    const openTagMatch = fullMatch.match(/<w:t(?:\s[^>]*)?>/);
    matches.push({
      start: match.index,
      end: match.index + fullMatch.length,
      openTag: openTagMatch[0]
    });
  }
  
  // Process in reverse order
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (i < processedTexts.length && originalTexts[i].text !== processedTexts[i]) {
      const newText = encodeXmlEntities(processedTexts[i]);
      const newTag = `${m.openTag}${newText}</w:t>`;
      result = result.substring(0, m.start) + newTag + result.substring(m.end);
    }
  }
  
  return result;
}

async function processFile(filePath) {
  const fileName = path.basename(filePath);
  
  try {
    const zip = new AdmZip(filePath);
    const documentXml = zip.readAsText('word/document.xml');
    
    if (!documentXml) {
      return { fileName, error: 'No document.xml' };
    }
    
    const textNodes = extractAllText(documentXml);
    const processedTexts = detectVariables(textNodes);
    
    // Find variables
    const variables = [];
    for (let i = 0; i < textNodes.length; i++) {
      if (textNodes[i].text !== processedTexts[i] && processedTexts[i].includes('{{')) {
        variables.push({
          original: textNodes[i].text,
          tag: processedTexts[i]
        });
      }
    }
    
    // Generate modified XML
    const modifiedXml = replaceTextInXml(documentXml, textNodes, processedTexts);
    
    // Save template
    const outputPath = filePath.replace('.docx', '_szablon_v2.docx');
    zip.updateFile('word/document.xml', Buffer.from(modifiedXml, 'utf-8'));
    zip.writeZip(outputPath);
    
    return {
      fileName,
      textNodes: textNodes.length,
      variables,
      variableCount: variables.length,
      outputPath
    };
    
  } catch (error) {
    return { fileName, error: error.message };
  }
}

async function main() {
  console.log('\n' + '╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(15) + '🚀 Improved DOCX Template Processor' + ' '.repeat(27) + '║');
  console.log('║' + ' '.repeat(15) + 'With Exclusion List from Pattern Analysis' + ' '.repeat(20) + '║');
  console.log('╚' + '═'.repeat(78) + '╝\n');
  
  const docDir = path.join(__dirname, 'dokumentacja');
  const files = fs.readdirSync(docDir)
    .filter(f => f.endsWith('.docx') && !f.includes('_szablon'));
  
  console.log(`📁 Processing ${files.length} DOCX files...\n`);
  
  const results = [];
  
  for (const file of files) {
    const result = await processFile(path.join(docDir, file));
    results.push(result);
    
    if (result.error) {
      console.log(`   ❌ ${file}: ${result.error}`);
    } else {
      console.log(`   ✓ ${file}`);
      console.log(`     └─ ${result.textNodes} texts → ${result.variableCount} variables`);
      
      if (result.variables.length > 0) {
        result.variables.slice(0, 5).forEach(v => {
          const orig = v.original.length > 30 ? v.original.substring(0, 30) + '...' : v.original;
          console.log(`        ${v.tag.padEnd(25)} ← "${orig}"`);
        });
        if (result.variables.length > 5) {
          console.log(`        ... and ${result.variables.length - 5} more`);
        }
      }
      console.log('');
    }
  }
  
  // Summary
  console.log('═'.repeat(80));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(80));
  
  const successful = results.filter(r => !r.error);
  const totalVars = successful.reduce((sum, r) => sum + r.variableCount, 0);
  const totalTexts = successful.reduce((sum, r) => sum + r.textNodes, 0);
  
  console.log(`
   Files processed:     ${files.length}
   Total text nodes:    ${totalTexts}
   Variables detected:  ${totalVars}
   Avg per document:    ${(totalVars / successful.length).toFixed(1)}
   
   Templates saved with suffix: _szablon_v2.docx
  `);
  
  // Variable type breakdown
  const varTypes = {};
  for (const r of successful) {
    for (const v of r.variables) {
      const type = v.tag.replace(/\{\{|\}\}/g, '').replace(/_\d+$/, '');
      varTypes[type] = (varTypes[type] || 0) + 1;
    }
  }
  
  console.log('   Variable types found:');
  Object.entries(varTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`      {{${type}}}: ${count}`);
    });
  
  console.log('\n' + '═'.repeat(80) + '\n');
}

main().catch(console.error);

