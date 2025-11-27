import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

/**
 * Decode XML entities to normal characters
 */
function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extract formatting information from a run XML
 */
function extractFormatting(runXml) {
  const formatting = {};
  
  // Bold
  if (/<w:b\b[^>]*\/>|<w:b\b[^>]*>/.test(runXml)) {
    formatting.bold = true;
  }
  
  // Italic
  if (/<w:i\b[^>]*\/>|<w:i\b[^>]*>/.test(runXml)) {
    formatting.italic = true;
  }
  
  // Underline
  if (/<w:u\b[^>]*\/>|<w:u\b[^>]*>/.test(runXml)) {
    formatting.underline = true;
  }
  
  // Font size (in half-points, convert to points)
  const szMatch = runXml.match(/<w:sz[^>]*w:val="(\d+)"/);
  if (szMatch) {
    formatting.fontSize = `${parseInt(szMatch[1]) / 2}pt`;
  }
  
  // Font family
  const fontMatch = runXml.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/);
  if (fontMatch) {
    formatting.fontFamily = fontMatch[1];
  }
  
  // Color
  const colorMatch = runXml.match(/<w:color[^>]*w:val="([^"]+)"/);
  if (colorMatch && colorMatch[1] !== 'auto') {
    formatting.color = `#${colorMatch[1]}`;
  }
  
  return formatting;
}

/**
 * Extract all runs (<w:r>) with formatting from the XML
 */
function extractRuns(xml) {
  const runs = [];
  
  // Regex patterns
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  let paragraphIndex = 0;
  let runIndex = 0;
  
  // Extract all paragraphs
  const paragraphMatches = [...xml.matchAll(paragraphRegex)];
  
  console.log(`\n📄 Found ${paragraphMatches.length} paragraphs in XML`);
  
  for (const paraMatch of paragraphMatches) {
    const paraContent = paraMatch[1];
    const runMatches = [...paraContent.matchAll(runRegex)];
    
    for (const runMatch of runMatches) {
      const runXml = runMatch[0];
      const runContent = runMatch[1];
      
      // Extract all text nodes from this run
      const textMatches = [...runContent.matchAll(textRegex)];
      let fullText = '';
      
      for (const textMatch of textMatches) {
        const text = decodeXmlEntities(textMatch[1]);
        fullText += text;
      }
      
      // Skip empty runs
      if (!fullText.trim()) continue;
      
      // Extract formatting
      const formatting = extractFormatting(runXml);
      
      // Find position of first text node in original XML
      const paraStart = paraMatch.index;
      const runStart = paraStart + paraMatch[0].indexOf(runXml);
      
      runs.push({
        index: runIndex++,
        text: fullText,
        formatting,
        paragraphIndex,
        runXml,
        textNodeStartIndex: runStart,
        textNodeEndIndex: runStart + runXml.length
      });
    }
    
    paragraphIndex++;
  }
  
  return runs;
}

/**
 * Simulate AI processing - identify variables
 */
function simulateAIProcessing(runs) {
  const processedRuns = runs.map(run => {
    let newText = run.text;
    
    // VIN patterns (17 characters, alphanumeric)
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(run.text)) {
      newText = '{{vinNumber}}';
    }
    // MRN patterns (starts with 2 digits, 2 letters, rest alphanumeric)
    else if (/^\d{2}[A-Z]{2}[A-Z0-9]+$/.test(run.text) && run.text.length >= 18) {
      newText = '{{mrnNumber}}';
    }
    // Date patterns
    else if (/^\d{2}[-./]\d{2}[-./]\d{4}$/.test(run.text) || /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(run.text)) {
      newText = '{{issueDate}}';
    }
    // Amount with currency
    else if (/^\d{1,3}(\.\d{3})*,\d{2}\s*(EUR|PLN|USD)?$/.test(run.text)) {
      newText = '{{amount}}';
    }
    // Polish postal code
    else if (/^\d{2}-\d{3}$/.test(run.text)) {
      newText = '{{postalCode}}';
    }
    // Names (UPPERCASE with space)
    else if (/^[A-ZŻŹĆĄŚĘŁÓŃ]{2,}\s+[A-ZŻŹĆĄŚĘŁÓŃ]{2,}$/.test(run.text) && 
             !['WSPÓLNOTA EUROPEJSKA', 'MARLOG CAR', 'LEAN CUSTOMS'].some(s => run.text.includes(s))) {
      newText = '{{personName}}';
    }
    
    return {
      ...run,
      text: newText
    };
  });
  
  return processedRuns;
}

async function testFile(filePath) {
  console.log('\n' + '='.repeat(80));
  console.log(`📂 Testing: ${path.basename(filePath)}`);
  console.log('='.repeat(80));
  
  try {
    // Load DOCX
    const zip = new AdmZip(filePath);
    const documentXml = zip.readAsText('word/document.xml');
    
    if (!documentXml) {
      throw new Error('document.xml not found in DOCX');
    }
    
    console.log(`✓ XML extracted (${documentXml.length} characters)`);
    
    // Extract runs
    const runs = extractRuns(documentXml);
    console.log(`✓ Extracted ${runs.length} runs with text content`);
    
    // Show sample runs
    console.log('\n📝 Sample runs (first 30):');
    runs.slice(0, 30).forEach((run, i) => {
      const formatInfo = [];
      if (run.formatting.bold) formatInfo.push('bold');
      if (run.formatting.italic) formatInfo.push('italic');
      if (run.formatting.fontSize) formatInfo.push(`size:${run.formatting.fontSize}`);
      if (run.formatting.fontFamily) formatInfo.push(`font:${run.formatting.fontFamily}`);
      
      const format = formatInfo.length > 0 ? ` [${formatInfo.join(',')}]` : '';
      const display = run.text.length > 40 ? run.text.substring(0, 40) + '...' : run.text;
      console.log(`   ${i + 1}. "${display}"${format}`);
    });
    
    // Simulate AI processing
    console.log('\n🤖 Simulating AI variable detection...');
    const processedRuns = simulateAIProcessing(runs);
    
    // Find variables
    const variables = [];
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].text !== processedRuns[i].text) {
        variables.push({
          original: runs[i].text,
          tag: processedRuns[i].text,
          index: i
        });
      }
    }
    
    console.log(`\n✅ Found ${variables.length} variables:`);
    variables.forEach((v, i) => {
      console.log(`   ${i + 1}. ${v.tag} ← "${v.original}"`);
    });
    
    // Show what AI would receive
    console.log('\n📤 Sample input for AI (texts with formatting context):');
    const textsWithContext = runs.slice(0, 20).map(run => {
      const formatInfo = [];
      if (run.formatting.bold) formatInfo.push('bold');
      if (run.formatting.italic) formatInfo.push('italic');
      if (run.formatting.fontSize) formatInfo.push(`size:${run.formatting.fontSize}`);
      if (run.formatting.fontFamily) formatInfo.push(`font:${run.formatting.fontFamily}`);
      
      const context = formatInfo.length > 0 ? ` [${formatInfo.join(',')}]` : '';
      return run.text + context;
    });
    
    console.log(JSON.stringify(textsWithContext, null, 2));
    
    return { runs: runs.length, variables: variables.length };
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return { runs: 0, variables: 0, error: error.message };
  }
}

async function main() {
  const docxDir = './dokumentacja/dokumenty_doc';
  
  // Find all DOCX files (not templates)
  const files = fs.readdirSync(docxDir)
    .filter(f => f.endsWith('.docx') && !f.includes('szablon'))
    .slice(0, 3); // Test first 3 files
  
  console.log(`\n🔍 Testing ${files.length} DOCX files...\n`);
  
  for (const file of files) {
    await testFile(path.join(docxDir, file));
  }
}

main().catch(console.error);

