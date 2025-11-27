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

// STARA METODA - tylko <w:t> bez runów
function extractTextNodes(xml) {
  const nodes = [];
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match;
  let index = 0;
  
  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[1]);
    if (text) {
      nodes.push({
        index,
        text,
        position: match.index
      });
    }
    index++;
  }
  
  return nodes;
}

async function compareExtractionMethods(filePath) {
  console.log('\n' + '='.repeat(80));
  console.log(`📂 Comparing: ${path.basename(filePath)}`);
  console.log('='.repeat(80));
  
  const zip = new AdmZip(filePath);
  const documentXml = zip.readAsText('word/document.xml');
  
  // NOWA METODA - runy
  const runs = extractRuns(documentXml);
  
  // STARA METODA - teksty
  const textNodes = extractTextNodes(documentXml);
  
  console.log(`\n📊 Comparison:`);
  console.log(`   Runs extracted: ${runs.length}`);
  console.log(`   Text nodes extracted: ${textNodes.length}`);
  
  // Znajdź potencjalne zmienne w text nodes
  const potentialVariables = textNodes.filter(node => {
    const text = node.text;
    // VIN
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(text)) return true;
    // MRN
    if (/^\d{2}[A-Z]{2}[A-Z0-9]+$/.test(text) && text.length >= 18) return true;
    // Date
    if (/^\d{2}[-./]\d{2}[-./]\d{4}$/.test(text) || /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(text)) return true;
    // Amount
    if (/^\d{1,3}(\.\d{3})*,\d{2}\s*(EUR|PLN|USD)?$/.test(text)) return true;
    // Postal code
    if (/^\d{2}-\d{3}$/.test(text)) return true;
    return false;
  });
  
  console.log(`\n🔍 Potential variables found in text nodes: ${potentialVariables.length}`);
  potentialVariables.forEach((node, i) => {
    console.log(`   ${i + 1}. "${node.text}"`);
  });
  
  // Znajdź potencjalne zmienne w runach
  const potentialRunVariables = runs.filter(run => {
    const text = run.text;
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(text)) return true;
    if (/^\d{2}[A-Z]{2}[A-Z0-9]+$/.test(text) && text.length >= 18) return true;
    if (/^\d{2}[-./]\d{2}[-./]\d{4}$/.test(text) || /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(text)) return true;
    if (/^\d{1,3}(\.\d{3})*,\d{2}\s*(EUR|PLN|USD)?$/.test(text)) return true;
    if (/^\d{2}-\d{3}$/.test(text)) return true;
    return false;
  });
  
  console.log(`\n🔍 Potential variables found in runs: ${potentialRunVariables.length}`);
  potentialRunVariables.forEach((run, i) => {
    console.log(`   ${i + 1}. "${run.text}"`);
  });
  
  // Szukaj VIN w pełnym tekście dokumentu
  const allText = textNodes.map(n => n.text).join('');
  const vinMatches = allText.match(/[A-HJ-NPR-Z0-9]{17}/g) || [];
  console.log(`\n🚗 VIN numbers in full text: ${vinMatches.length}`);
  vinMatches.forEach((vin, i) => {
    console.log(`   ${i + 1}. ${vin}`);
  });
  
  // Pokaż gdzie VIN jest podzielone
  if (vinMatches.length > 0) {
    const vin = vinMatches[0];
    console.log(`\n🔬 Analyzing how VIN "${vin}" is split across text nodes:`);
    
    let position = 0;
    let found = false;
    for (let i = 0; i < textNodes.length && !found; i++) {
      const node = textNodes[i];
      if (vin.includes(node.text) || node.text.includes(vin.substring(0, 5))) {
        console.log(`   Node ${i}: "${node.text}"`);
        // Pokaż kolejne węzły
        for (let j = i; j < Math.min(i + 10, textNodes.length); j++) {
          console.log(`   Node ${j}: "${textNodes[j].text}"`);
          if (textNodes[j].text.includes(vin.substring(vin.length - 5))) {
            found = true;
            break;
          }
        }
      }
    }
  }
  
  // Analiza: czy runy łączą tekst który nie powinien być łączony?
  console.log(`\n📝 Sample runs with their text content:`);
  runs.slice(0, 50).forEach((run, i) => {
    if (run.text.length > 3) {
      console.log(`   ${i}. [${run.text.length} chars] "${run.text}"`);
    }
  });
}

async function main() {
  const docxDir = './dokumentacja/dokumenty_doc';
  const files = fs.readdirSync(docxDir)
    .filter(f => f.endsWith('.docx') && !f.includes('szablon'))
    .slice(0, 2);
  
  for (const file of files) {
    await compareExtractionMethods(path.join(docxDir, file));
  }
}

main().catch(console.error);

