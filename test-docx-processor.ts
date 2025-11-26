/**
 * Test script for DOCX template processor
 * Run with: npx ts-node test-docx-processor.ts
 * Or: deno run --allow-read --allow-write test-docx-processor.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Simple JSZip-like implementation for Node.js
const AdmZip = require('adm-zip');

interface ExtractedTextNode {
  index: number;
  text: string;
}

interface ProcessedVariable {
  originalText: string;
  tag: string;
  variableName: string;
  index: number;
}

/**
 * Extract all text nodes from <w:t> tags in the XML
 */
function extractTextNodes(xml: string): ExtractedTextNode[] {
  const nodes: ExtractedTextNode[] = [];
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
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

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeXmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Simple heuristic-based variable detection (without AI)
 * This simulates what AI would do
 */
function detectVariables(texts: string[]): string[] {
  return texts.map(text => {
    const trimmed = text.trim();
    
    // Skip empty or very short texts
    if (!trimmed || trimmed.length < 2) return text;
    
    // Skip common labels/headers
    const labels = [':', 'nr', 'numer', 'data', 'nazwa', 'adres', 'vin', 'marka', 'model', 
                    'rok', 'cena', 'kwota', 'wartość', 'suma', 'razem', 'brutto', 'netto',
                    'vat', 'podatek', 'faktura', 'dokument', 'strona', 'str.', 'uwagi'];
    const lowerText = trimmed.toLowerCase();
    if (labels.some(l => lowerText === l || lowerText.endsWith(':'))) return text;
    
    // Detect VIN numbers (17 alphanumeric characters)
    if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(trimmed)) {
      return '{{vinNumber}}';
    }
    
    // Detect dates (various formats)
    if (/^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(trimmed) ||
        /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(trimmed)) {
      return '{{issueDate}}';
    }
    
    // Detect money amounts with currency
    if (/^\d{1,3}([., ]\d{3})*([.,]\d{2})?\s*(EUR|PLN|USD|zł|€|\$)$/i.test(trimmed) ||
        /^(EUR|PLN|USD)\s*\d/i.test(trimmed)) {
      return '{{amount}}';
    }
    
    // Detect reference numbers (alphanumeric with dashes)
    if (/^[A-Z0-9]{2,}[-][A-Z0-9-]+$/i.test(trimmed) && trimmed.length > 8) {
      return '{{referenceNumber}}';
    }
    
    // Detect MRN numbers (customs)
    if (/^\d{2}[A-Z]{2}[A-Z0-9]{14,}$/i.test(trimmed)) {
      return '{{mrnNumber}}';
    }
    
    // Detect postal codes
    if (/^\d{2}-\d{3}$/.test(trimmed) || // Polish
        /^\d{4}\s?[A-Z]{2}$/i.test(trimmed) || // Dutch
        /^\d{5}$/.test(trimmed)) { // German
      return '{{postalCode}}';
    }
    
    // Detect license plates
    if (/^[A-Z]{1,3}\s?[A-Z0-9]{2,5}$/i.test(trimmed) && trimmed.length <= 10) {
      return '{{plateNumber}}';
    }
    
    // Keep original text if no pattern matched
    return text;
  });
}

/**
 * Replace text content in <w:t> tags
 */
function replaceTextInXml(
  xml: string, 
  textNodes: ExtractedTextNode[], 
  replacements: Map<number, string>
): string {
  let result = xml;
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  const matches: { start: number; end: number; fullMatch: string; openTag: string }[] = [];
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(xml)) !== null) {
    const fullMatch = match[0];
    const openTagMatch = fullMatch.match(/<w:t(?:\s[^>]*)?>/) as RegExpMatchArray;
    matches.push({
      start: match.index,
      end: match.index + fullMatch.length,
      fullMatch,
      openTag: openTagMatch[0]
    });
  }
  
  // Process in reverse order
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

async function processDocxFile(filePath: string): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`📄 Processing: ${path.basename(filePath)}`);
  console.log('='.repeat(60));
  
  try {
    // Load DOCX file
    const zip = new AdmZip(filePath);
    const documentXml = zip.readAsText('word/document.xml');
    
    if (!documentXml) {
      throw new Error('document.xml not found in DOCX');
    }
    
    console.log(`✓ XML extracted (${documentXml.length} characters)`);
    
    // Extract text nodes
    const textNodes = extractTextNodes(documentXml);
    console.log(`✓ Found ${textNodes.length} text nodes`);
    
    // Show first 20 text nodes
    console.log('\n📝 Sample text nodes:');
    textNodes.slice(0, 30).forEach((node, i) => {
      const display = node.text.length > 50 ? node.text.substring(0, 50) + '...' : node.text;
      console.log(`   ${i + 1}. "${display}"`);
    });
    
    // Detect variables (simulating AI)
    const texts = textNodes.map(n => n.text);
    const processedTexts = detectVariables(texts);
    
    // Find changes
    const variables: ProcessedVariable[] = [];
    const textToTagMap = new Map<number, string>();
    
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
    
    console.log(`\n🔍 Detected ${variables.length} variables:`);
    variables.forEach(v => {
      console.log(`   ${v.tag} ← "${v.originalText}"`);
    });
    
    // Generate modified XML
    const modifiedXml = replaceTextInXml(documentXml, textNodes, textToTagMap);
    
    // Save new DOCX
    const outputPath = filePath.replace('.docx', '_szablon.docx');
    zip.updateFile('word/document.xml', Buffer.from(modifiedXml, 'utf-8'));
    zip.writeZip(outputPath);
    
    console.log(`\n✅ Template saved: ${path.basename(outputPath)}`);
    
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function main() {
  console.log('🚀 DOCX Template Processor Test');
  console.log('================================\n');
  
  const docDir = path.join(__dirname, 'dokumentacja');
  const files = fs.readdirSync(docDir).filter(f => f.endsWith('.docx'));
  
  console.log(`Found ${files.length} DOCX files to process:`);
  files.forEach(f => console.log(`  - ${f}`));
  
  for (const file of files) {
    await processDocxFile(path.join(docDir, file));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✨ Processing complete!');
  console.log('='.repeat(60));
}

main().catch(console.error);

