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
// NOWE PODEJŚCIE (merged) - łączenie sąsiednich fragmentów
// ============================================================================

function extractMergedTextGroups(xml) {
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
    
    let currentGroup = {
      index: groupIndex++,
      textNodes: [textNodesInPara[0]],
      mergedText: textNodesInPara[0].text
    };
    
    for (let i = 1; i < textNodesInPara.length; i++) {
      const prev = textNodesInPara[i - 1];
      const curr = textNodesInPara[i];
      const shouldMerge = shouldMergeBasic(prev, curr, currentGroup.mergedText);
      
      if (shouldMerge) {
        currentGroup.textNodes.push(curr);
        currentGroup.mergedText += curr.text;
      } else {
        if (currentGroup.mergedText.trim()) groups.push(currentGroup);
        currentGroup = {
          index: groupIndex++,
          textNodes: [curr],
          mergedText: curr.text
        };
      }
    }
    
    if (currentGroup.mergedText.trim()) groups.push(currentGroup);
  }
  
  return groups;
}

function shouldMergeBasic(prev, curr, mergedSoFar) {
  const prevText = prev.text;
  const currText = curr.text;
  const combined = mergedSoFar + currText;
  
  if (prevText.trim().endsWith(':')) return false;
  if (/^[A-ZŻŹĆĄŚĘŁÓŃ]/.test(currText.trim()) && prevText.length > 5 && !isPartOfPattern(combined)) {
    return false;
  }
  if (isPartOfPattern(combined)) return true;
  if (prevText.length <= 4 || currText.length <= 4) return true;
  if (/[-/]$/.test(prevText.trim())) return true;
  if (/^[-/]/.test(currText.trim())) return true;
  if (/^\d+$/.test(prevText) && /^\d+$/.test(currText)) return true;
  if (/^[A-Z]+$/.test(prevText) && /^[A-Z0-9]+$/.test(currText)) return true;
  
  return false;
}

// ============================================================================
// ZAAWANSOWANE PODEJŚCIE - z kontekstem etykiet
// ============================================================================

function extractAdvancedGroups(xml) {
  const groups = [];
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  
  let groupIndex = 0;
  const paragraphMatches = [...xml.matchAll(paragraphRegex)];
  
  // Zbierz wszystkie text nodes z całego dokumentu z pozycjami paragrafów
  const allTextNodes = [];
  
  for (let paraIdx = 0; paraIdx < paragraphMatches.length; paraIdx++) {
    const paraContent = paragraphMatches[paraIdx][1];
    const runMatches = [...paraContent.matchAll(runRegex)];
    
    for (const runMatch of runMatches) {
      const runXml = runMatch[0];
      const runContent = runMatch[1];
      const formatting = extractFormatting(runXml);
      
      const textMatches = [...runContent.matchAll(textRegex)];
      
      for (const textMatch of textMatches) {
        const text = decodeXmlEntities(textMatch[1]);
        if (text && text.trim()) {
          allTextNodes.push({ 
            text, 
            formatting, 
            paragraphIndex: paraIdx,
            isLabel: isLabelText(text)
          });
        }
      }
    }
  }
  
  // Teraz łączymy z kontekstem etykiet
  let i = 0;
  while (i < allTextNodes.length) {
    const node = allTextNodes[i];
    
    // Jeśli to etykieta, zbierz wartość po niej
    if (node.isLabel) {
      const labelText = node.text;
      let valueText = '';
      let valueNodes = [];
      let j = i + 1;
      
      // Zbierz wszystko po etykiecie aż do następnej etykiety lub końca paragrafu
      while (j < allTextNodes.length) {
        const nextNode = allTextNodes[j];
        
        // Stop jeśli to następna etykieta lub inny paragraf z etykietą
        if (nextNode.isLabel) break;
        if (nextNode.paragraphIndex !== node.paragraphIndex && 
            allTextNodes.slice(j).some(n => n.paragraphIndex === nextNode.paragraphIndex && n.isLabel)) {
          break;
        }
        
        valueText += nextNode.text;
        valueNodes.push(nextNode);
        j++;
        
        // Sprawdź czy mamy kompletny wzorzec
        if (isCompletePattern(valueText.trim())) break;
      }
      
      if (valueText.trim()) {
        groups.push({
          index: groupIndex++,
          label: labelText.trim(),
          mergedText: valueText.trim(),
          textNodes: valueNodes,
          hasLabel: true
        });
      }
      
      i = j;
    } else {
      // Brak etykiety - łącz jak w podstawowym podejściu
      let currentGroup = {
        index: groupIndex++,
        label: null,
        mergedText: node.text,
        textNodes: [node],
        hasLabel: false
      };
      
      let j = i + 1;
      while (j < allTextNodes.length) {
        const nextNode = allTextNodes[j];
        if (nextNode.isLabel) break;
        if (nextNode.paragraphIndex !== node.paragraphIndex) break;
        
        const combined = currentGroup.mergedText + nextNode.text;
        if (!shouldMergeAdvanced(currentGroup.mergedText, nextNode.text, combined)) break;
        
        currentGroup.mergedText += nextNode.text;
        currentGroup.textNodes.push(nextNode);
        j++;
      }
      
      if (currentGroup.mergedText.trim()) {
        groups.push(currentGroup);
      }
      
      i = j;
    }
  }
  
  return groups;
}

function isLabelText(text) {
  const trimmed = text.trim();
  
  // Kończy się dwukropkiem
  if (trimmed.endsWith(':')) return true;
  
  // Znane etykiety (bez dwukropka)
  const knownLabels = [
    'MRN', 'VIN', 'Data', 'Numer', 'Typ', 'Kod', 'Wartość', 'Kwota',
    'Nadawca', 'Odbiorca', 'Eksporter', 'Importer', 'Nazwa', 'Adres',
    'Kraj', 'Miasto', 'Ulica', 'NIP', 'REGON', 'EORI', 'Kontener',
    'Container', 'Date', 'Number', 'Value', 'Amount', 'Sender', 'Receiver'
  ];
  
  for (const label of knownLabels) {
    if (trimmed.toUpperCase().includes(label.toUpperCase()) && trimmed.length < 30) {
      return true;
    }
  }
  
  // Numer z etykietą (np. "8 Odbiorca")
  if (/^\d+\s+[A-ZŻŹĆĄŚĘŁÓŃ]/.test(trimmed) && trimmed.length < 25) {
    return true;
  }
  
  return false;
}

function isCompletePattern(text) {
  // MRN - 18 znaków
  if (/^\d{2}[A-Z]{2}[A-Z0-9]{14}$/.test(text)) return true;
  
  // VIN - 17 znaków
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(text)) return true;
  
  // Data
  if (/^\d{2}[-./]\d{2}[-./]\d{4}$/.test(text)) return true;
  if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(text)) return true;
  
  // Kontener
  if (/^[A-Z]{4}\d{7}$/.test(text)) return true;
  
  // Kod pocztowy
  if (/^\d{2}-\d{3}$/.test(text)) return true;
  
  return false;
}

function shouldMergeAdvanced(prevText, currText, combined) {
  // Nie łącz jeśli poprzedni to etykieta
  if (isLabelText(prevText)) return false;
  
  // Łącz jeśli razem tworzą wzorzec
  if (isPartOfPattern(combined)) return true;
  
  // Łącz krótkie fragmenty
  if (prevText.length <= 4 || currText.length <= 4) return true;
  
  // Łącz z łącznikami
  if (/[-/]$/.test(prevText.trim()) || /^[-/]/.test(currText.trim())) return true;
  
  return false;
}

function isPartOfPattern(text) {
  if (/^\d{2}[A-Z]{2}[A-Z0-9]*$/.test(text)) return true;
  if (/^[A-HJ-NPR-Z0-9]{1,17}$/.test(text) && text.length <= 17) return true;
  if (/^\d{1,2}[-./]?\d{0,2}[-./]?\d{0,4}$/.test(text)) return true;
  if (/^[A-Z]{1,4}\d{0,7}$/.test(text)) return true;
  if (/^[A-Z]{2,4}[-]?[A-Z0-9]*$/.test(text)) return true;
  return false;
}

// ============================================================================
// SYMULACJA AI z kontekstem etykiet
// ============================================================================

function simulateAIBasic(texts) {
  return texts.map(text => detectVariable(text, null));
}

function simulateAIAdvanced(groups) {
  return groups.map(group => {
    const detected = detectVariable(group.mergedText, group.label);
    return {
      ...group,
      detected,
      isVariable: detected !== group.mergedText
    };
  });
}

function detectVariable(text, label) {
  // VIN
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(text)) return '{{vinNumber}}';
  if (label && /VIN|pojazd|vehicle/i.test(label) && /^[A-HJ-NPR-Z0-9]{17}$/.test(text)) {
    return '{{vinNumber}}';
  }
  
  // MRN
  if (/^\d{2}[A-Z]{2}[A-Z0-9]+$/.test(text) && text.length >= 18) return '{{mrnNumber}}';
  if (label && /MRN|numer.*zgłoszenia|reference/i.test(label)) return '{{mrnNumber}}';
  
  // Data
  if (/^\d{2}[-./]\d{2}[-./]\d{4}$/.test(text) || /^\d{4}[-./]\d{2}[-./]\d{2}$/.test(text)) {
    return '{{issueDate}}';
  }
  if (label && /data|date/i.test(label) && /\d/.test(text)) return '{{issueDate}}';
  
  // Kwota
  if (/^\d{1,3}(\.\d{3})*,\d{2}\s*(EUR|PLN|USD)?$/.test(text)) return '{{amount}}';
  if (label && /wartość|kwota|value|amount/i.test(label) && /\d/.test(text)) return '{{amount}}';
  
  // Kod pocztowy
  if (/^\d{2}-\d{3}$/.test(text)) return '{{postalCode}}';
  
  // Kontener + VIN
  if (/^[A-Z]{4}\d{7}\s*\/\s*[A-HJ-NPR-Z0-9]{17}$/.test(text)) return '{{containerVin}}';
  
  // Kontener
  if (/^[A-Z]{4}\d{7}$/.test(text)) return '{{containerNumber}}';
  if (label && /kontener|container/i.test(label) && /^[A-Z]{4}\d{7}$/.test(text)) {
    return '{{containerNumber}}';
  }
  
  // EORI
  if (label && /EORI/i.test(label)) return '{{eoriNumber}}';
  if (/^[A-Z]{2}\d{10,15}$/.test(text)) return '{{eoriNumber}}';
  
  // Osoba
  if (/^[A-ZŻŹĆĄŚĘŁÓŃ]{2,}\s+[A-ZŻŹĆĄŚĘŁÓŃ]{2,}$/.test(text) && 
      !['WSPÓLNOTA EUROPEJSKA', 'MARLOG CAR', 'LEAN CUSTOMS', 'MANHATTAN AUTO', 'STANY ZJEDNOCZONE'].some(s => text.includes(s))) {
    return '{{personName}}';
  }
  if (label && /nadawca|odbiorca|importer|eksporter|sender|receiver/i.test(label) &&
      /^[A-ZŻŹĆĄŚĘŁÓŃ]{2,}/.test(text)) {
    return '{{personName}}';
  }
  
  // Adres
  if (/^(ul\.|UL\.)?\s*[A-ZŻŹĆĄŚĘŁÓŃ][a-zżźćąśęłóń]+\s+\d+/.test(text) ||
      /^[A-ZŻŹĆĄŚĘŁÓŃ]+\s+\d+[A-Z]?$/.test(text)) {
    return '{{address}}';
  }
  if (label && /adres|address|ulica|street/i.test(label)) return '{{address}}';
  
  // Waga
  if (label && /waga|masa|weight/i.test(label) && /\d/.test(text)) return '{{weight}}';
  
  // Ilość
  if (label && /ilość|sztuk|quantity|pieces/i.test(label) && /^\d+$/.test(text)) return '{{quantity}}';
  
  return text;
}

// ============================================================================
// TESTY
// ============================================================================

async function testAllApproaches(documentXml, fileName) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📂 ${fileName}`);
  console.log('═'.repeat(70));
  
  // STARE PODEJŚCIE
  const textNodes = extractTextNodes(documentXml);
  const oldResults = simulateAIBasic(textNodes.map(n => n.text));
  const oldVariables = textNodes.filter((n, i) => n.text !== oldResults[i])
    .map((n, i) => ({ original: n.text, tag: oldResults[textNodes.indexOf(n)] }));
  
  console.log(`\n📊 STARE PODEJŚCIE:`);
  console.log(`   Text nodes: ${textNodes.length}`);
  console.log(`   Zmienne: ${oldVariables.length}`);
  
  // MERGED PODEJŚCIE
  const mergedGroups = extractMergedTextGroups(documentXml);
  const mergedResults = simulateAIBasic(mergedGroups.map(g => g.mergedText));
  const mergedVariables = mergedGroups.filter((g, i) => g.mergedText !== mergedResults[i])
    .map((g, i) => ({ 
      original: g.mergedText, 
      tag: mergedResults[mergedGroups.indexOf(g)],
      nodeCount: g.textNodes.length
    }));
  
  console.log(`\n📊 MERGED PODEJŚCIE:`);
  console.log(`   Grupy: ${mergedGroups.length}`);
  console.log(`   Zmienne: ${mergedVariables.length}`);
  
  // ZAAWANSOWANE PODEJŚCIE
  const advancedGroups = extractAdvancedGroups(documentXml);
  const advancedResults = simulateAIAdvanced(advancedGroups);
  const advancedVariables = advancedResults.filter(r => r.isVariable);
  
  console.log(`\n📊 ZAAWANSOWANE PODEJŚCIE (z etykietami):`);
  console.log(`   Grupy: ${advancedGroups.length}`);
  console.log(`   Zmienne: ${advancedVariables.length}`);
  
  if (advancedVariables.length > 0) {
    console.log(`   Przykłady:`);
    advancedVariables.slice(0, 10).forEach((v, i) => {
      const labelInfo = v.label ? ` [po: "${v.label}"]` : '';
      const nodeInfo = v.textNodes.length > 1 ? ` (z ${v.textNodes.length} fragmentów)` : '';
      console.log(`      ${i + 1}. ${v.detected} ← "${v.mergedText.substring(0, 35)}${v.mergedText.length > 35 ? '...' : ''}"${labelInfo}${nodeInfo}`);
    });
  }
  
  // Nowe zmienne znalezione przez zaawansowane podejście
  const advancedTags = new Set(advancedVariables.map(v => v.detected + ':' + v.mergedText));
  const mergedTags = new Set(mergedVariables.map(v => v.tag + ':' + v.original));
  
  const newInAdvanced = advancedVariables.filter(v => !mergedTags.has(v.detected + ':' + v.mergedText));
  
  if (newInAdvanced.length > 0) {
    console.log(`\n   🆕 Nowe dzięki kontekstowi etykiet:`);
    newInAdvanced.slice(0, 5).forEach((v, i) => {
      const labelInfo = v.label ? ` [po: "${v.label}"]` : '';
      console.log(`      ${i + 1}. ${v.detected} ← "${v.mergedText.substring(0, 30)}..."${labelInfo}`);
    });
  }
  
  return {
    fileName,
    old: oldVariables.length,
    merged: mergedVariables.length,
    advanced: advancedVariables.length
  };
}

async function main() {
  const docxDir = './dokumentacja/dokumenty_doc';
  const files = fs.readdirSync(docxDir)
    .filter(f => f.endsWith('.docx') && !f.includes('szablon'))
    .slice(0, 5);
  
  console.log('\n' + '═'.repeat(70));
  console.log('🧪 TEST: STARE vs MERGED vs ZAAWANSOWANE (z kontekstem etykiet)');
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
  console.log('📊 PODSUMOWANIE WYNIKÓW');
  console.log('═'.repeat(70));
  
  console.log('\n| Plik | Stare | Merged | Zaawansowane |');
  console.log('|------|-------|--------|--------------|');
  
  let totalOld = 0, totalMerged = 0, totalAdvanced = 0;
  
  for (const r of results) {
    const shortName = r.fileName.substring(0, 25) + (r.fileName.length > 25 ? '...' : '');
    console.log(`| ${shortName.padEnd(25)} | ${String(r.old).padStart(5)} | ${String(r.merged).padStart(6)} | ${String(r.advanced).padStart(12)} |`);
    totalOld += r.old;
    totalMerged += r.merged;
    totalAdvanced += r.advanced;
  }
  
  console.log('|------|-------|--------|--------------|');
  console.log(`| ${'RAZEM'.padEnd(25)} | ${String(totalOld).padStart(5)} | ${String(totalMerged).padStart(6)} | ${String(totalAdvanced).padStart(12)} |`);
  
  console.log(`\n📈 Poprawa względem starego:`);
  console.log(`   Merged:       +${totalMerged - totalOld} (${((totalMerged - totalOld) / totalOld * 100).toFixed(0)}%)`);
  console.log(`   Zaawansowane: +${totalAdvanced - totalOld} (${((totalAdvanced - totalOld) / totalOld * 100).toFixed(0)}%)`);
  
  console.log(`\n📈 Poprawa Zaawansowane vs Merged: +${totalAdvanced - totalMerged}`);
}

main().catch(console.error);

