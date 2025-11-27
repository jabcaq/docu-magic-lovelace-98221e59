import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

// ============================================================================
// FINALNE PODEJŚCIE: MERGED + KONTEKST ETYKIET
// Łączy najlepsze cechy obu podejść:
// 1. Merged extraction - dobre łączenie fragmentów
// 2. Kontekst etykiet - AI wie co jest przed wartością
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
  return formatting;
}

// ============================================================================
// STARE PODEJŚCIE
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
// FINALNE PODEJŚCIE - MERGED + LABEL CONTEXT
// ============================================================================

function extractFinalGroups(xml) {
  const groups = [];
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  let groupIndex = 0;
  const paragraphMatches = [...xml.matchAll(paragraphRegex)];
  
  for (const paraMatch of paragraphMatches) {
    const paraContent = paraMatch[1];
    const runMatches = [...paraContent.matchAll(runRegex)];
    
    const textNodesInPara = [];
    
    for (const runMatch of runMatches) {
      const runXml = runMatch[0];
      const runContent = runMatch[1];
      const formatting = extractFormatting(runXml);
      
      const textMatches = [...runContent.matchAll(textRegex)];
      
      for (const textMatch of textMatches) {
        const text = decodeXmlEntities(textMatch[1]);
        if (text && text.trim()) {
          textNodesInPara.push({ text, formatting, runXml });
        }
      }
    }
    
    if (textNodesInPara.length === 0) continue;
    
    // Łączenie fragmentów z zachowaniem kontekstu poprzedniego elementu
    let currentGroup = {
      index: groupIndex++,
      textNodes: [textNodesInPara[0]],
      mergedText: textNodesInPara[0].text,
      precedingText: null // Kontekst - co było przed tą grupą
    };
    
    let lastLabel = null;
    if (isLabelText(textNodesInPara[0].text)) {
      lastLabel = textNodesInPara[0].text;
    }
    
    for (let i = 1; i < textNodesInPara.length; i++) {
      const prev = textNodesInPara[i - 1];
      const curr = textNodesInPara[i];
      const shouldMerge = shouldMergeFinal(prev, curr, currentGroup.mergedText);
      
      if (shouldMerge) {
        currentGroup.textNodes.push(curr);
        currentGroup.mergedText += curr.text;
      } else {
        // Zapisz grupę z kontekstem
        if (currentGroup.mergedText.trim()) {
          currentGroup.precedingText = lastLabel;
          groups.push(currentGroup);
        }
        
        // Aktualizuj ostatnią etykietę
        if (isLabelText(currentGroup.mergedText)) {
          lastLabel = currentGroup.mergedText.trim();
        }
        
        currentGroup = {
          index: groupIndex++,
          textNodes: [curr],
          mergedText: curr.text,
          precedingText: lastLabel
        };
      }
    }
    
    // Zapisz ostatnią grupę
    if (currentGroup.mergedText.trim()) {
      currentGroup.precedingText = lastLabel;
      groups.push(currentGroup);
    }
  }
  
  return groups;
}

function isLabelText(text) {
  const trimmed = text.trim();
  
  // Kończy się dwukropkiem
  if (trimmed.endsWith(':')) return true;
  
  // Znane etykiety bez dwukropka
  const knownLabels = [
    'MRN', 'VIN', 'Data', 'Numer', 'Typ', 'Kod', 'Wartość', 'Kwota',
    'Nadawca', 'Odbiorca', 'Eksporter', 'Importer', 'Nazwa', 'Adres',
    'Kraj', 'Miasto', 'Ulica', 'NIP', 'REGON', 'EORI', 'Kontener',
    'Container', 'Date', 'Number', 'Value', 'Amount', 'Masa', 'Waga'
  ];
  
  for (const label of knownLabels) {
    if (trimmed.toUpperCase() === label.toUpperCase() || 
        trimmed.toUpperCase().endsWith(label.toUpperCase() + ':')) {
      return true;
    }
  }
  
  // Numer pola + nazwa (np. "8 Odbiorca", "35 Masa brutto")
  if (/^\d+\s+[A-ZŻŹĆĄŚĘŁÓŃ][a-zżźćąśęłóń]*/.test(trimmed) && trimmed.length < 30) {
    return true;
  }
  
  return false;
}

function shouldMergeFinal(prev, curr, mergedSoFar) {
  const prevText = prev.text;
  const currText = curr.text;
  const combined = mergedSoFar + currText;
  
  // Nie łącz po etykiecie
  if (prevText.trim().endsWith(':')) return false;
  
  // Łącz jeśli razem tworzą znany wzorzec
  if (isPartOfPattern(combined)) return true;
  
  // Łącz krótkie fragmenty (prawdopodobnie podzielony tekst)
  if (prevText.length <= 4 || currText.length <= 4) return true;
  
  // Łącz jeśli poprzedni kończy się myślnikiem lub ukośnikiem
  if (/[-/]$/.test(prevText.trim())) return true;
  
  // Łącz jeśli bieżący zaczyna się myślnikiem lub ukośnikiem
  if (/^[-/]/.test(currText.trim())) return true;
  
  // Łącz ciągi cyfr lub liter
  if (/^\d+$/.test(prevText) && /^\d+$/.test(currText)) return true;
  if (/^[A-Z]+$/.test(prevText) && /^[A-Z0-9]+$/.test(currText)) return true;
  
  // Nie łącz jeśli nowy tekst to nowe słowo z wielkiej litery i poprzedni był długi
  if (/^[A-ZŻŹĆĄŚĘŁÓŃ]/.test(currText.trim()) && prevText.length > 5 && !isPartOfPattern(combined)) {
    return false;
  }
  
  return false;
}

function isPartOfPattern(text) {
  // MRN pattern
  if (/^\d{2}[A-Z]{2}[A-Z0-9]*$/.test(text)) return true;
  // VIN pattern
  if (/^[A-HJ-NPR-Z0-9]{1,17}$/.test(text) && text.length <= 17) return true;
  // Date pattern
  if (/^\d{1,2}[-./]?\d{0,2}[-./]?\d{0,4}$/.test(text)) return true;
  // Container
  if (/^[A-Z]{1,4}\d{0,7}$/.test(text)) return true;
  // Reference
  if (/^[A-Z]{2,4}[-]?[A-Z0-9]*$/.test(text)) return true;
  return false;
}

// ============================================================================
// SYMULACJA AI Z KONTEKSTEM ETYKIET
// ============================================================================

function simulateAIBasic(texts) {
  return texts.map(text => detectVariable(text, null));
}

function simulateAIFinal(groups) {
  return groups.map(group => {
    const detected = detectVariable(group.mergedText, group.precedingText);
    return {
      ...group,
      detected,
      isVariable: detected !== group.mergedText
    };
  });
}

function detectVariable(text, label) {
  const trimmed = text.trim();
  
  // ===== WZORCE BEZPOŚREDNIE (bez etykiety) =====
  
  // VIN - dokładnie 17 znaków alfanumerycznych (bez I, O, Q)
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(trimmed)) return '{{vinNumber}}';
  
  // MRN - 2 cyfry + 2 litery + reszta (18+ znaków)
  if (/^\d{2}[A-Z]{2}[A-Z0-9]+$/.test(trimmed) && trimmed.length >= 18) return '{{mrnNumber}}';
  
  // Data w różnych formatach
  if (/^\d{2}[-./]\d{2}[-./]\d{4}$/.test(trimmed)) return '{{issueDate}}';
  if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(trimmed)) return '{{issueDate}}';
  
  // Kwota z walutą
  if (/^\d{1,3}(\.\d{3})*,\d{2}\s*(EUR|PLN|USD)?$/.test(trimmed)) return '{{amount}}';
  if (/^(EUR|PLN|USD)\s*\d/.test(trimmed)) return '{{amount}}';
  
  // Kod pocztowy PL
  if (/^\d{2}-\d{3}$/.test(trimmed)) return '{{postalCode}}';
  
  // Kontener + VIN
  if (/^[A-Z]{4}\d{7}\s*\/\s*[A-HJ-NPR-Z0-9]{17}$/.test(trimmed)) return '{{containerVin}}';
  
  // Kontener (4 litery + 7 cyfr)
  if (/^[A-Z]{4}\d{7}$/.test(trimmed)) return '{{containerNumber}}';
  
  // EORI (2 litery + 10-15 cyfr)
  if (/^[A-Z]{2}\d{10,15}$/.test(trimmed)) return '{{eoriNumber}}';
  
  // Osoba (dwa słowa UPPERCASE)
  if (/^[A-ZŻŹĆĄŚĘŁÓŃ]{2,}\s+[A-ZŻŹĆĄŚĘŁÓŃ]{2,}$/.test(trimmed)) {
    const excluded = ['WSPÓLNOTA EUROPEJSKA', 'MARLOG CAR', 'LEAN CUSTOMS', 
                      'MANHATTAN AUTO', 'STANY ZJEDNOCZONE', 'NEW YORK',
                      'EGZEMPLARZ TRANSPORTOWY', 'NIE OPAKOWANY'];
    if (!excluded.some(e => trimmed.includes(e))) {
      return '{{personName}}';
    }
  }
  
  // Adres (ul. XXX lub SŁOWO NUMER)
  if (/^(ul\.|UL\.)?\s*[A-ZŻŹĆĄŚĘŁÓŃ][a-zżźćąśęłóń]+\s+\d+/.test(trimmed)) {
    return '{{address}}';
  }
  if (/^[A-ZŻŹĆĄŚĘŁÓŃ]+\s+\d+[A-Z]?\/?\d*$/.test(trimmed) && trimmed.length < 25) {
    return '{{address}}';
  }
  
  // ===== ROZPOZNAWANIE NA PODSTAWIE ETYKIET =====
  
  if (label) {
    const labelLower = label.toLowerCase();
    
    // VIN po etykiecie z rokiem i marką (np. "2018 VOLVO", "2016 DODGE")
    if (/\d{4}\s+[A-Z]+/.test(label) && /^[A-HJ-NPR-Z0-9]{17}$/.test(trimmed)) {
      return '{{vinNumber}}';
    }
    
    // VIN po etykiecie "VIN:"
    if (labelLower.includes('vin') && /^[A-HJ-NPR-Z0-9]{17}$/.test(trimmed)) {
      return '{{vinNumber}}';
    }
    
    // MRN po etykiecie
    if ((labelLower.includes('mrn') || labelLower.includes('numer zgłoszenia') || 
         labelLower.includes('numer deklaracji') || labelLower.includes('referencje')) &&
        /[A-Z0-9]{10,}/.test(trimmed)) {
      return '{{mrnNumber}}';
    }
    
    // Data po etykiecie
    if ((labelLower.includes('data') || labelLower.includes('date')) && /\d/.test(trimmed)) {
      return '{{issueDate}}';
    }
    
    // Wartość/kwota po etykiecie
    if ((labelLower.includes('wartość') || labelLower.includes('kwota') || 
         labelLower.includes('value') || labelLower.includes('amount') ||
         labelLower.includes('należne') || labelLower.includes('łącznie')) &&
        /\d/.test(trimmed)) {
      return '{{amount}}';
    }
    
    // Waga po etykiecie
    if ((labelLower.includes('masa') || labelLower.includes('waga') || labelLower.includes('weight')) &&
        /\d/.test(trimmed)) {
      return '{{weight}}';
    }
    
    // Adres po etykiecie
    if (labelLower.includes('adres') || labelLower.includes('address') || labelLower.includes('ulica')) {
      return '{{address}}';
    }
    
    // Nazwa/osoba po etykiecie nadawca/odbiorca
    if ((labelLower.includes('nadawca') || labelLower.includes('odbiorca') || 
         labelLower.includes('importer') || labelLower.includes('eksporter') ||
         labelLower.includes('nazwa')) && /^[A-ZŻŹĆĄŚĘŁÓŃ]/.test(trimmed)) {
      return '{{personName}}';
    }
    
    // Kontener po etykiecie
    if (labelLower.includes('kontener') || labelLower.includes('container')) {
      return '{{containerNumber}}';
    }
    
    // EORI po etykiecie
    if (labelLower.includes('eori') && /^[A-Z]{2}\d+$/.test(trimmed)) {
      return '{{eoriNumber}}';
    }
  }
  
  return text;
}

// ============================================================================
// TESTY PORÓWNAWCZE
// ============================================================================

async function testAllApproaches(documentXml, fileName) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📂 ${fileName}`);
  console.log('═'.repeat(70));
  
  // STARE
  const textNodes = extractTextNodes(documentXml);
  const oldResults = simulateAIBasic(textNodes.map(n => n.text));
  const oldVariables = textNodes.filter((n, i) => n.text !== oldResults[i]);
  
  console.log(`\n📊 STARE PODEJŚCIE: ${oldVariables.length} zmiennych`);
  
  // FINALNE
  const finalGroups = extractFinalGroups(documentXml);
  const finalResults = simulateAIFinal(finalGroups);
  const finalVariables = finalResults.filter(r => r.isVariable);
  
  console.log(`📊 FINALNE PODEJŚCIE: ${finalVariables.length} zmiennych`);
  
  // Szczegóły
  if (finalVariables.length > 0) {
    console.log(`\n   Znalezione zmienne:`);
    
    // Grupuj po typie
    const byType = {};
    for (const v of finalVariables) {
      if (!byType[v.detected]) byType[v.detected] = [];
      byType[v.detected].push(v);
    }
    
    for (const [tag, vars] of Object.entries(byType)) {
      console.log(`\n   ${tag} (${vars.length}x):`);
      vars.slice(0, 3).forEach((v, i) => {
        const labelInfo = v.precedingText ? ` [po: "${v.precedingText.substring(0, 20)}..."]` : '';
        const nodeInfo = v.textNodes.length > 1 ? ` (z ${v.textNodes.length} fragmentów)` : '';
        console.log(`      • "${v.mergedText.substring(0, 35)}${v.mergedText.length > 35 ? '...' : ''}"${labelInfo}${nodeInfo}`);
      });
      if (vars.length > 3) {
        console.log(`      ... i ${vars.length - 3} więcej`);
      }
    }
  }
  
  return {
    fileName,
    old: oldVariables.length,
    final: finalVariables.length
  };
}

async function main() {
  const docxDir = './dokumentacja/dokumenty_doc';
  const files = fs.readdirSync(docxDir)
    .filter(f => f.endsWith('.docx') && !f.includes('szablon'))
    .slice(0, 5);
  
  console.log('\n' + '═'.repeat(70));
  console.log('🧪 TEST FINALNY: STARE vs MERGED + KONTEKST ETYKIET');
  console.log('═'.repeat(70));
  
  const results = [];
  for (const file of files) {
    const zip = new AdmZip(path.join(docxDir, file));
    const documentXml = zip.readAsText('word/document.xml');
    const result = await testAllApproaches(documentXml, file);
    results.push(result);
  }
  
  // Podsumowanie
  console.log('\n\n' + '═'.repeat(70));
  console.log('📊 PODSUMOWANIE FINALNE');
  console.log('═'.repeat(70));
  
  console.log('\n| Plik                          | Stare | Finalne | Poprawa |');
  console.log('|-------------------------------|-------|---------|---------|');
  
  let totalOld = 0, totalFinal = 0;
  
  for (const r of results) {
    const shortName = r.fileName.substring(0, 28) + (r.fileName.length > 28 ? '...' : '');
    const improvement = r.final - r.old;
    const improvementStr = improvement >= 0 ? `+${improvement}` : String(improvement);
    console.log(`| ${shortName.padEnd(29)} | ${String(r.old).padStart(5)} | ${String(r.final).padStart(7)} | ${improvementStr.padStart(7)} |`);
    totalOld += r.old;
    totalFinal += r.final;
  }
  
  console.log('|-------------------------------|-------|---------|---------|');
  const totalImprovement = totalFinal - totalOld;
  const totalImprovementStr = totalImprovement >= 0 ? `+${totalImprovement}` : String(totalImprovement);
  console.log(`| ${'RAZEM'.padEnd(29)} | ${String(totalOld).padStart(5)} | ${String(totalFinal).padStart(7)} | ${totalImprovementStr.padStart(7)} |`);
  
  const pctImprovement = ((totalFinal - totalOld) / totalOld * 100).toFixed(0);
  console.log(`\n✅ Całkowita poprawa: ${totalImprovementStr} zmiennych (${pctImprovement}%)`);
  
  console.log(`\n📈 Kluczowe ulepszenia finalnego podejścia:`);
  console.log(`   1. Łączenie fragmentów (merged) - MRN, daty, VIN podzielone na części`);
  console.log(`   2. Kontekst etykiet - AI wie co było przed wartością`);
  console.log(`   3. Rozpoznawanie po etykiecie - np. VIN po "2018 VOLVO"`);
}

main().catch(console.error);

