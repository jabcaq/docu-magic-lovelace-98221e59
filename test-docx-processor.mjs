/**
 * Test script for DOCX template processor
 * Run with: node test-docx-processor.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract all text nodes from <w:t> tags in the XML
 */
function extractTextNodes(xml) {
  const nodes = [];
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match;
  let index = 0;
  
  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[1]);
    if (text) {
      nodes.push({ index, text });
    }
    index++;
  }
  
  return nodes;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
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
 * Simple heuristic-based variable detection (without AI)
 * This simulates what AI would do for automotive/customs documents
 */
function detectVariables(texts) {
  const seenTags = new Map(); // Track seen tags to avoid duplicates
  
  return texts.map((text, idx) => {
    const trimmed = text.trim();
    
    // Skip empty or very short texts
    if (!trimmed || trimmed.length < 2) return text;
    
    // Skip common labels/headers (Polish, German, Dutch, English)
    const lowerText = trimmed.toLowerCase();
    const labels = [
      // Polish
      'nr', 'numer', 'data', 'nazwa', 'adres', 'vin', 'marka', 'model', 
      'rok', 'cena', 'kwota', 'wartość', 'suma', 'razem', 'brutto', 'netto',
      'vat', 'podatek', 'faktura', 'dokument', 'strona', 'str.', 'uwagi',
      'odbiorca', 'nadawca', 'przedstawiciel', 'kraj', 'urząd',
      // German
      'datum', 'name', 'anschrift', 'preis', 'betrag', 'summe', 'steuer',
      'rechnung', 'seite', 'empfänger', 'absender', 'land', 'amt',
      // Dutch
      'nummer', 'naam', 'adres', 'bedrag', 'totaal', 'belasting',
      'factuur', 'pagina', 'ontvanger', 'afzender',
      // English
      'number', 'date', 'name', 'address', 'price', 'amount', 'total',
      'invoice', 'page', 'recipient', 'sender', 'country', 'office'
    ];
    
    if (labels.some(l => lowerText === l || lowerText.endsWith(':'))) return text;
    if (trimmed.endsWith(':')) return text;
    if (trimmed.length === 1) return text;
    
    // Skip single numbers that are likely page numbers or counts
    if (/^\d{1,2}$/.test(trimmed)) return text;
    
    // Skip common fixed values
    const fixedValues = ['im', 'a', 'eur', 'pln', 'pl', 'nl', 'de', '-', '/', '|'];
    if (fixedValues.includes(lowerText)) return text;
    
    let tag = null;
    
    // Detect VIN numbers (17 alphanumeric characters, excluding I, O, Q)
    if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(trimmed)) {
      tag = '{{vinNumber}}';
    }
    
    // Detect MRN numbers (customs reference - starts with year + country code)
    else if (/^\d{2}[A-Z]{2}[A-Z0-9]{14,}$/i.test(trimmed)) {
      tag = '{{mrnNumber}}';
    }
    
    // Detect dates (various formats)
    else if (/^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(trimmed) ||
        /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(trimmed)) {
      tag = '{{issueDate}}';
    }
    
    // Detect money amounts with currency
    else if (/^\d{1,3}([., ]\d{3})*([.,]\d{2})?\s*(EUR|PLN|USD|zł|€|\$)$/i.test(trimmed) ||
        /^(EUR|PLN|USD)\s*\d/i.test(trimmed) ||
        /^\d{1,3}([.,]\d{3})*[.,]\d{2}$/.test(trimmed)) {
      tag = '{{amount}}';
    }
    
    // Detect reference numbers (alphanumeric with dashes, longer format)
    else if (/^[A-Z0-9]{2,}[-][A-Z0-9-]+$/i.test(trimmed) && trimmed.length > 10) {
      tag = '{{referenceNumber}}';
    }
    
    // Detect customs tariff codes (long numbers)
    else if (/^\d{8,20}$/.test(trimmed) && trimmed.length >= 8) {
      tag = '{{tariffCode}}';
    }
    
    // Detect postal codes
    else if (/^\d{2}-\d{3}$/.test(trimmed) || // Polish
        /^\d{4}\s?[A-Z]{2}$/i.test(trimmed) || // Dutch
        /^\d{5}$/.test(trimmed)) { // German
      tag = '{{postalCode}}';
    }
    
    // Detect tax/VAT numbers
    else if (/^[A-Z]{2}\d{9,12}$/i.test(trimmed) ||
             /^NL\d{9}B\d{2}$/i.test(trimmed)) {
      tag = '{{vatNumber}}';
    }
    
    // Detect percentages
    else if (/^\d{1,3}([.,]\d+)?\s*%$/.test(trimmed)) {
      tag = '{{percentage}}';
    }
    
    // Detect weight/mass values
    else if (/^\d+([.,]\d+)?\s*(kg|g|ton|t)$/i.test(trimmed)) {
      tag = '{{weight}}';
    }
    
    // If tag was detected, check for duplicates
    if (tag) {
      const count = seenTags.get(tag) || 0;
      seenTags.set(tag, count + 1);
      
      // Add suffix for duplicates
      if (count > 0) {
        tag = tag.replace('}}', `_${count + 1}}}`);
      }
      
      return tag;
    }
    
    // Keep original text if no pattern matched
    return text;
  });
}

/**
 * Replace text content in <w:t> tags
 */
function replaceTextInXml(xml, textNodes, replacements) {
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
      fullMatch,
      openTag: openTagMatch[0]
    });
  }
  
  // Process in reverse order to preserve positions
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const replacement = replacements.get(i);
    
    if (replacement !== undefined) {
      const newText = encodeXmlEntities(replacement);
      const newTag = `${m.openTag}${newText}</w:t>`;
      result = result.substring(0, m.start) + newTag + result.substring(m.end);
    }
  }
  
  return result;
}

async function processDocxFile(filePath) {
  console.log('\n' + '='.repeat(70));
  console.log(`📄 Processing: ${path.basename(filePath)}`);
  console.log('='.repeat(70));
  
  try {
    // Load DOCX file
    const zip = new AdmZip(filePath);
    const documentXml = zip.readAsText('word/document.xml');
    
    if (!documentXml) {
      throw new Error('document.xml not found in DOCX');
    }
    
    console.log(`✓ XML extracted (${documentXml.length.toLocaleString()} characters)`);
    
    // Extract text nodes
    const textNodes = extractTextNodes(documentXml);
    console.log(`✓ Found ${textNodes.length} text nodes`);
    
    // Show first 30 text nodes
    console.log('\n📝 Sample text nodes (first 30):');
    console.log('-'.repeat(50));
    textNodes.slice(0, 30).forEach((node, i) => {
      const display = node.text.length > 45 ? node.text.substring(0, 45) + '...' : node.text;
      console.log(`   ${String(i + 1).padStart(3)}. "${display}"`);
    });
    
    // Detect variables (simulating AI)
    const texts = textNodes.map(n => n.text);
    const processedTexts = detectVariables(texts);
    
    // Find changes
    const variables = [];
    const textToTagMap = new Map();
    
    for (let i = 0; i < texts.length; i++) {
      if (texts[i] !== processedTexts[i]) {
        const tagMatch = processedTexts[i].match(/\{\{(\w+)\}\}/);
        if (tagMatch) {
          variables.push({
            originalText: texts[i],
            tag: processedTexts[i],
            variableName: tagMatch[1],
            index: i
          });
          textToTagMap.set(i, processedTexts[i]);
        }
      }
    }
    
    console.log('\n' + '-'.repeat(50));
    console.log(`🔍 Detected ${variables.length} variables:`);
    console.log('-'.repeat(50));
    
    if (variables.length === 0) {
      console.log('   (No variables detected with heuristic rules)');
      console.log('   Note: Full AI analysis will detect more variables');
    } else {
      variables.forEach(v => {
        const originalDisplay = v.originalText.length > 35 
          ? v.originalText.substring(0, 35) + '...' 
          : v.originalText;
        console.log(`   ${v.tag.padEnd(25)} ← "${originalDisplay}"`);
      });
    }
    
    // Generate modified XML
    const modifiedXml = replaceTextInXml(documentXml, textNodes, textToTagMap);
    
    // Save new DOCX
    const outputPath = filePath.replace('.docx', '_szablon.docx');
    zip.updateFile('word/document.xml', Buffer.from(modifiedXml, 'utf-8'));
    zip.writeZip(outputPath);
    
    console.log('\n' + '-'.repeat(50));
    console.log(`✅ Template saved: ${path.basename(outputPath)}`);
    console.log(`   Original XML: ${documentXml.length.toLocaleString()} chars`);
    console.log(`   Modified XML: ${modifiedXml.length.toLocaleString()} chars`);
    
    return { 
      success: true, 
      variables, 
      totalNodes: textNodes.length,
      outputPath 
    };
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('\n' + '╔' + '═'.repeat(68) + '╗');
  console.log('║' + ' '.repeat(15) + '🚀 DOCX Template Processor Test' + ' '.repeat(21) + '║');
  console.log('║' + ' '.repeat(10) + '(Heuristic detection - AI will find more)' + ' '.repeat(16) + '║');
  console.log('╚' + '═'.repeat(68) + '╝');
  
  const docDir = path.join(__dirname, 'dokumentacja');
  
  if (!fs.existsSync(docDir)) {
    console.error(`❌ Directory not found: ${docDir}`);
    return;
  }
  
  const files = fs.readdirSync(docDir)
    .filter(f => f.endsWith('.docx') && !f.includes('_szablon'));
  
  console.log(`\n📁 Found ${files.length} DOCX files to process:`);
  files.forEach(f => console.log(`   • ${f}`));
  
  const results = [];
  
  for (const file of files) {
    const result = await processDocxFile(path.join(docDir, file));
    results.push({ file, ...result });
  }
  
  // Summary
  console.log('\n' + '╔' + '═'.repeat(68) + '╗');
  console.log('║' + ' '.repeat(25) + '📊 SUMMARY' + ' '.repeat(33) + '║');
  console.log('╚' + '═'.repeat(68) + '╝');
  
  let totalVars = 0;
  let totalNodes = 0;
  
  results.forEach(r => {
    if (r.success) {
      console.log(`\n   ${r.file}:`);
      console.log(`      • Text nodes: ${r.totalNodes}`);
      console.log(`      • Variables detected: ${r.variables.length}`);
      totalVars += r.variables.length;
      totalNodes += r.totalNodes;
    } else {
      console.log(`\n   ${r.file}: ❌ ${r.error}`);
    }
  });
  
  console.log('\n' + '-'.repeat(70));
  console.log(`   TOTAL: ${totalNodes} text nodes, ${totalVars} variables detected`);
  console.log('-'.repeat(70));
  
  console.log('\n💡 Note: This test uses simple pattern matching.');
  console.log('   The actual AI (OpenRouter/Lovable) will detect many more variables');
  console.log('   including names, addresses, and context-specific data.\n');
}

main().catch(console.error);

