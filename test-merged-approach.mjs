import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

// ============================================================================
// STARE PODEJŚCIE - pojedyncze text nodes
// ============================================================================

function extractTextNodes(xml) {
  const nodes = [];
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match;
  let index = 0;
  
  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[1]);
    if (text) {
      nodes.push({ index, text, position: match.index });
    }
    index++;
  }
  
  return nodes;
}

// ============================================================================
// NOWE PODEJŚCIE - łączenie sąsiednich text nodes w grupy paragrafowe
// ============================================================================

function extractMergedTextGroups(xml) {
  const groups = [];
  
  // Regex patterns
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  let groupIndex = 0;
  const paragraphMatches = [...xml.matchAll(paragraphRegex)];
  
  for (const paraMatch of paragraphMatches) {
    const paraContent = paraMatch[1];
    const runMatches = [...paraContent.matchAll(runRegex)];
    
    // Zbierz wszystkie text nodes w tym paragrafie z informacją o runie
    const textNodesInPara = [];
    
    for (const runMatch of runMatches) {
      const runXml = runMatch[0];
      const runContent = runMatch[1];
      const formatting = extractFormatting(runXml);
      
      const textMatches = [...runContent.matchAll(textRegex)];
      
      for (const textMatch of textMatches) {
        const text = decodeXmlEntities(textMatch[1]);
        if (text && text.trim()) {
          textNodesInPara.push({
            text,
            formatting,
            runXml
          });
        }
      }
    }
    
    if (textNodesInPara.length === 0) continue;
    
    // Łącz sąsiednie text nodes w grupy
    // Strategia: łącz jeśli razem tworzą sensowną całość (np. data, MRN, VIN)
    let currentGroup = {
      index: groupIndex++,
      textNodes: [textNodesInPara[0]],
      mergedText: textNodesInPara[0].text
    };
    
    for (let i = 1; i < textNodesInPara.length; i++) {
      const prev = textNodesInPara[i - 1];
      const curr = textNodesInPara[i];
      
      // Sprawdź czy powinniśmy łączyć
      const shouldMerge = shouldMergeTextNodes(prev, curr, currentGroup.mergedText);
      
      if (shouldMerge) {
        currentGroup.textNodes.push(curr);
        currentGroup.mergedText += curr.text;
      } else {
        // Zapisz bieżącą grupę i zacznij nową
        if (currentGroup.mergedText.trim()) {
          groups.push(currentGroup);
        }
        currentGroup = {
          index: groupIndex++,
          textNodes: [curr],
          mergedText: curr.text
        };
      }
    }
    
    // Zapisz ostatnią grupę
    if (currentGroup.mergedText.trim()) {
      groups.push(currentGroup);
    }
  }
  
  return groups;
}

function shouldMergeTextNodes(prev, curr, mergedSoFar) {
  const prevText = prev.text;
  const currText = curr.text;
  const combined = mergedSoFar + currText;
  
  // Nie łącz jeśli poprzedni kończy się dwukropkiem (etykieta)
  if (prevText.trim().endsWith(':')) return false;
  
  // Nie łącz jeśli bieżący zaczyna się od wielkiej litery i poprzedni nie był krótki
  if (/^[A-ZŻŹĆĄŚĘŁÓŃ]/.test(currText.trim()) && prevText.length > 5 && !isPartOfPattern(combined)) {
    return false;
  }
  
  // Łącz jeśli razem tworzą znany wzorzec
  if (isPartOfPattern(combined)) return true;
  
  // Łącz krótkie fragmenty (prawdopodobnie podzielony tekst)
  if (prevText.length <= 4 || currText.length <= 4) return true;
  
  // Łącz jeśli poprzedni kończy się myślnikiem lub ukośnikiem
  if (/[-/]$/.test(prevText.trim())) return true;
  
  // Łącz jeśli bieżący zaczyna się myślnikiem lub ukośnikiem
  if (/^[-/]/.test(currText.trim())) return true;
  
  // Łącz jeśli to wygląda na kontynuację (same cyfry lub same litery)
  if (/^\d+$/.test(prevText) && /^\d+$/.test(currText)) return true;
  if (/^[A-Z]+$/.test(prevText) && /^[A-Z0-9]+$/.test(currText)) return true;
  
  return false;
}

function isPartOfPattern(text) {
  // MRN pattern (2 cyfry + 2 litery + reszta)
  if (/^\d{2}[A-Z]{2}[A-Z0-9]*$/.test(text)) return true;
  
  // VIN pattern (17 znaków alfanumerycznych)
  if (/^[A-HJ-NPR-Z0-9]{1,17}$/.test(text) && text.length <= 17) return true;
  
  // Date pattern fragments
  if (/^\d{1,2}[-./]?\d{0,2}[-./]?\d{0,4}$/.test(text)) return true;
  
  // Container number (4 letters + up to 7 digits)
  if (/^[A-Z]{1,4}\d{0,7}$/.test(text)) return true;
  
  // Reference number fragments
  if (/^[A-Z]{2,4}[-]?[A-Z0-9]*$/.test(text)) return true;
  
  return false;
}

// ============================================================================
// SYMULACJA AI
// ============================================================================

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
    // Date patterns (various formats)
    if (/^\d{2}[-./]\d{2}[-./]\d{4}$/.test(text) || /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(text)) {
      return '{{issueDate}}';
    }
    // Date with dashes separated
    if (/^\d{2}-\d{2}-\d{4}$/.test(text)) {
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
    // Container number alone
    if (/^[A-Z]{4}\d{7}$/.test(text)) {
      return '{{containerNumber}}';
    }
    // Person name (UPPERCASE with space)
    if (/^[A-ZŻŹĆĄŚĘŁÓŃ]{2,}\s+[A-ZŻŹĆĄŚĘŁÓŃ]{2,}$/.test(text) && 
        !['WSPÓLNOTA EUROPEJSKA', 'MARLOG CAR', 'LEAN CUSTOMS', 'MANHATTAN AUTO', 'STANY ZJEDNOCZONE'].some(s => text.includes(s))) {
      return '{{personName}}';
    }
    // Street address
    if (/^(ul\.|UL\.)?\s*[A-ZŻŹĆĄŚĘŁÓŃ][a-zżźćąśęłóń]+\s+\d+/.test(text) ||
        /^[A-ZŻŹĆĄŚĘŁÓŃ]+\s+\d+[A-Z]?$/.test(text)) {
      return '{{address}}';
    }
    return text;
  });
}

// ============================================================================
// TESTY
// ============================================================================

async function testOldApproach(documentXml, fileName) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📊 STARE PODEJŚCIE: ${fileName}`);
  console.log('─'.repeat(60));
  
  const textNodes = extractTextNodes(documentXml);
  const texts = textNodes.map(n => n.text);
  const processedTexts = simulateAIProcessing(texts);
  
  const variables = [];
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] !== processedTexts[i]) {
      variables.push({ original: texts[i], tag: processedTexts[i] });
    }
  }
  
  console.log(`   Text nodes: ${textNodes.length}`);
  console.log(`   Zmienne: ${variables.length}`);
  
  if (variables.length > 0) {
    console.log(`   Przykłady:`);
    variables.slice(0, 5).forEach((v, i) => {
      console.log(`      ${i + 1}. ${v.tag} ← "${v.original.substring(0, 40)}${v.original.length > 40 ? '...' : ''}"`);
    });
  }
  
  return { textNodes: textNodes.length, variables: variables.length, details: variables };
}

async function testNewApproach(documentXml, fileName) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📊 NOWE PODEJŚCIE (merged): ${fileName}`);
  console.log('─'.repeat(60));
  
  const groups = extractMergedTextGroups(documentXml);
  const texts = groups.map(g => g.mergedText);
  const processedTexts = simulateAIProcessing(texts);
  
  const variables = [];
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] !== processedTexts[i]) {
      variables.push({ 
        original: texts[i], 
        tag: processedTexts[i],
        nodeCount: groups[i].textNodes.length
      });
    }
  }
  
  console.log(`   Grupy (merged): ${groups.length}`);
  console.log(`   Zmienne: ${variables.length}`);
  
  if (variables.length > 0) {
    console.log(`   Przykłady:`);
    variables.slice(0, 8).forEach((v, i) => {
      const nodeInfo = v.nodeCount > 1 ? ` (z ${v.nodeCount} fragmentów)` : '';
      console.log(`      ${i + 1}. ${v.tag} ← "${v.original.substring(0, 40)}${v.original.length > 40 ? '...' : ''}"${nodeInfo}`);
    });
  }
  
  // Pokaż przykłady połączonych fragmentów
  const mergedExamples = groups.filter(g => g.textNodes.length > 1).slice(0, 5);
  if (mergedExamples.length > 0) {
    console.log(`\n   🔗 Przykłady połączonych fragmentów:`);
    mergedExamples.forEach((g, i) => {
      const fragments = g.textNodes.map(n => `"${n.text}"`).join(' + ');
      console.log(`      ${i + 1}. ${fragments} → "${g.mergedText}"`);
    });
  }
  
  return { groups: groups.length, variables: variables.length, details: variables };
}

async function runComparison(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📂 ${fileName}`);
  console.log('═'.repeat(70));
  
  const zip = new AdmZip(filePath);
  const documentXml = zip.readAsText('word/document.xml');
  
  const oldResult = await testOldApproach(documentXml, fileName);
  const newResult = await testNewApproach(documentXml, fileName);
  
  // Porównanie
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📈 PORÓWNANIE:`);
  console.log('─'.repeat(60));
  
  const improvement = newResult.variables - oldResult.variables;
  const improvementPct = oldResult.variables > 0 
    ? ((improvement / oldResult.variables) * 100).toFixed(0) 
    : (newResult.variables > 0 ? '+∞' : '0');
  
  console.log(`   Stare: ${oldResult.variables} zmiennych (z ${oldResult.textNodes} text nodes)`);
  console.log(`   Nowe:  ${newResult.variables} zmiennych (z ${newResult.groups} grup)`);
  console.log(`   Poprawa: ${improvement >= 0 ? '+' : ''}${improvement} (${improvement >= 0 ? '+' : ''}${improvementPct}%)`);
  
  return {
    fileName,
    old: oldResult,
    new: newResult,
    improvement
  };
}

async function main() {
  const docxDir = './dokumentacja/dokumenty_doc';
  const files = fs.readdirSync(docxDir)
    .filter(f => f.endsWith('.docx') && !f.includes('szablon'))
    .slice(0, 5); // Test 5 plików
  
  console.log('\n' + '═'.repeat(70));
  console.log('🧪 TEST PORÓWNAWCZY: STARE vs NOWE PODEJŚCIE (merged text nodes)');
  console.log('═'.repeat(70));
  
  const results = [];
  for (const file of files) {
    const result = await runComparison(path.join(docxDir, file));
    results.push(result);
  }
  
  // Podsumowanie
  console.log('\n\n' + '═'.repeat(70));
  console.log('📊 PODSUMOWANIE WYNIKÓW');
  console.log('═'.repeat(70));
  
  console.log('\n| Plik | Stare | Nowe | Poprawa |');
  console.log('|------|-------|------|---------|');
  
  let totalOld = 0;
  let totalNew = 0;
  
  for (const r of results) {
    const shortName = r.fileName.substring(0, 30) + (r.fileName.length > 30 ? '...' : '');
    const improvement = r.improvement >= 0 ? `+${r.improvement}` : r.improvement;
    console.log(`| ${shortName.padEnd(30)} | ${String(r.old.variables).padStart(5)} | ${String(r.new.variables).padStart(4)} | ${improvement.padStart(7)} |`);
    totalOld += r.old.variables;
    totalNew += r.new.variables;
  }
  
  console.log('|------|-------|------|---------|');
  const totalImprovement = totalNew - totalOld;
  console.log(`| ${'RAZEM'.padEnd(30)} | ${String(totalOld).padStart(5)} | ${String(totalNew).padStart(4)} | ${(totalImprovement >= 0 ? '+' : '') + totalImprovement} |`);
  
  const totalImprovementPct = totalOld > 0 ? ((totalImprovement / totalOld) * 100).toFixed(0) : '∞';
  console.log(`\n✅ Całkowita poprawa: ${totalImprovement >= 0 ? '+' : ''}${totalImprovement} zmiennych (${totalImprovement >= 0 ? '+' : ''}${totalImprovementPct}%)`);
}

main().catch(console.error);

