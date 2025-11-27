import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTextNodes(xml) {
  const nodes = [];
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match;
  let index = 0;
  
  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[1]);
    if (text) {
      nodes.push({ index, text, xpath: `w:t[${index}]` });
    }
    index++;
  }
  
  return nodes;
}

function extractFormatting(runXml) {
  const formatting = {};
  if (/<w:b\b[^>]*\/>|<w:b\b[^>]*>/.test(runXml)) formatting.bold = true;
  if (/<w:i\b[^>]*\/>|<w:i\b[^>]*>/.test(runXml)) formatting.italic = true;
  const szMatch = runXml.match(/<w:sz[^>]*w:val="(\d+)"/);
  if (szMatch) formatting.fontSize = `${parseInt(szMatch[1]) / 2}pt`;
  const fontMatch = runXml.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/);
  if (fontMatch) formatting.fontFamily = fontMatch[1];
  return formatting;
}

function extractRuns(xml) {
  const runs = [];
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  let paragraphIndex = 0;
  let runIndex = 0;
  
  const paragraphMatches = [...xml.matchAll(paragraphRegex)];
  
  for (const paraMatch of paragraphMatches) {
    const paraContent = paraMatch[1];
    const runMatches = [...paraContent.matchAll(runRegex)];
    
    for (const runMatch of runMatches) {
      const runXml = runMatch[0];
      const runContent = runMatch[1];
      
      const textMatches = [...runContent.matchAll(textRegex)];
      let fullText = '';
      
      for (const textMatch of textMatches) {
        const text = decodeXmlEntities(textMatch[1]);
        fullText += text;
      }
      
      if (!fullText.trim()) continue;
      
      const formatting = extractFormatting(runXml);
      
      runs.push({
        index: runIndex++,
        text: fullText,
        formatting,
        paragraphIndex,
        runXml
      });
    }
    
    paragraphIndex++;
  }
  
  return runs;
}

function buildFormattingContext(runs) {
  const context = new Map();
  
  for (const run of runs) {
    if (run.text && Object.keys(run.formatting).length > 0) {
      context.set(run.text, run.formatting);
    }
  }
  
  return context;
}

// Simulate AI processing
function simulateAIProcessing(texts) {
  return texts.map(text => {
    // VIN patterns (17 characters, alphanumeric)
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(text)) {
      return '{{vinNumber}}';
    }
    // MRN patterns (starts with 2 digits, 2 letters, rest alphanumeric)
    if (/^\d{2}[A-Z]{2}[A-Z0-9]+$/.test(text) && text.length >= 18) {
      return '{{mrnNumber}}';
    }
    // Date patterns
    if (/^\d{2}[-./]\d{2}[-./]\d{4}$/.test(text) || /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(text)) {
      return '{{issueDate}}';
    }
    // Amount with currency
    if (/^\d{1,3}(\.\d{3})*,\d{2}\s*(EUR|PLN|USD)?$/.test(text)) {
      return '{{amount}}';
    }
    // Polish postal code
    if (/^\d{2}-\d{3}$/.test(text)) {
      return '{{postalCode}}';
    }
    // Container + VIN combination
    if (/^[A-Z]{4}\d{7}\s*\/\s*[A-HJ-NPR-Z0-9]{17}$/.test(text)) {
      return '{{containerVin}}';
    }
    return text;
  });
}

async function testHybridApproach(filePath) {
  console.log('\n' + '='.repeat(80));
  console.log(`📂 Testing HYBRID APPROACH: ${path.basename(filePath)}`);
  console.log('='.repeat(80));
  
  const zip = new AdmZip(filePath);
  const documentXml = zip.readAsText('word/document.xml');
  
  // Step 1: Extract text nodes (PRIMARY)
  const textNodes = extractTextNodes(documentXml);
  console.log(`\n✓ Step 1: Extracted ${textNodes.length} text nodes`);
  
  // Step 2: Extract runs for formatting context
  const runs = extractRuns(documentXml);
  console.log(`✓ Step 2: Extracted ${runs.length} runs with formatting`);
  
  // Step 3: Build formatting context
  const formattingContext = buildFormattingContext(runs);
  console.log(`✓ Step 3: Built formatting context for ${formattingContext.size} unique texts`);
  
  // Step 4: Prepare texts with context for AI
  const texts = textNodes.map(node => node.text);
  const textsWithContext = texts.map(text => {
    const formatting = formattingContext.get(text);
    if (!formatting) return text;
    
    const formatInfo = [];
    if (formatting.bold) formatInfo.push('bold');
    if (formatting.italic) formatInfo.push('italic');
    if (formatting.fontSize) formatInfo.push(`size:${formatting.fontSize}`);
    if (formatting.fontFamily) formatInfo.push(`font:${formatting.fontFamily}`);
    
    const context = formatInfo.length > 0 ? ` [${formatInfo.join(',')}]` : '';
    return text + context;
  });
  
  console.log(`\n📤 Sample input for AI (first 25 texts with formatting context):`);
  textsWithContext.slice(0, 25).forEach((text, i) => {
    console.log(`   ${i + 1}. "${text}"`);
  });
  
  // Step 5: Simulate AI processing
  const processedTexts = simulateAIProcessing(texts);
  
  // Step 6: Identify variables
  const variables = [];
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] !== processedTexts[i]) {
      variables.push({
        original: texts[i],
        tag: processedTexts[i],
        index: i
      });
    }
  }
  
  console.log(`\n✅ Found ${variables.length} variables:`);
  variables.forEach((v, i) => {
    const formatting = formattingContext.get(v.original);
    const formatStr = formatting ? ` [${Object.keys(formatting).join(',')}]` : '';
    console.log(`   ${i + 1}. ${v.tag} ← "${v.original}"${formatStr}`);
  });
  
  return { textNodes: textNodes.length, runs: runs.length, variables: variables.length };
}

async function main() {
  const docxDir = './dokumentacja/dokumenty_doc';
  const files = fs.readdirSync(docxDir)
    .filter(f => f.endsWith('.docx') && !f.includes('szablon'))
    .slice(0, 3);
  
  console.log(`\n🔍 Testing HYBRID APPROACH on ${files.length} DOCX files...\n`);
  
  let totalVariables = 0;
  for (const file of files) {
    const result = await testHybridApproach(path.join(docxDir, file));
    totalVariables += result.variables;
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 TOTAL VARIABLES FOUND: ${totalVariables}`);
  console.log('='.repeat(80));
}

main().catch(console.error);

