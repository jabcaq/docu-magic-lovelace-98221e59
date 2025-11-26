/**
 * Analyze multiple DOCX files to find patterns:
 * - CONSTANT values (appear in multiple documents identically)
 * - VARIABLE values (differ between documents)
 * 
 * Run with: node analyze-patterns.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract all text from <w:t> tags
 */
function extractAllText(xml) {
  const texts = [];
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match;
  
  while ((match = regex.exec(xml)) !== null) {
    let text = match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .trim();
    
    if (text && text.length > 1) {
      texts.push(text);
    }
  }
  
  return texts;
}

/**
 * Categorize a text value
 */
function categorizeValue(text) {
  const trimmed = text.trim();
  
  // VIN (17 chars)
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(trimmed)) {
    return { type: 'VIN', value: trimmed };
  }
  
  // Date patterns
  if (/^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(trimmed) ||
      /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(trimmed)) {
    return { type: 'DATE', value: trimmed };
  }
  
  // Money with currency
  if (/^\d{1,3}([., ]\d{3})*([.,]\d{2})?\s*(EUR|PLN|USD)$/i.test(trimmed)) {
    return { type: 'MONEY', value: trimmed };
  }
  
  // Reference numbers (long alphanumeric with dashes)
  if (/^[A-Z0-9]{2,}[-][A-Z0-9-]+$/i.test(trimmed) && trimmed.length > 10) {
    return { type: 'REFERENCE', value: trimmed };
  }
  
  // MRN (customs)
  if (/^\d{2}[A-Z]{2}[A-Z0-9]{10,}$/i.test(trimmed)) {
    return { type: 'MRN', value: trimmed };
  }
  
  // Long numbers (tariff codes, etc)
  if (/^\d{8,}$/.test(trimmed)) {
    return { type: 'CODE', value: trimmed };
  }
  
  // VAT numbers
  if (/^[A-Z]{2}\d{8,12}$/i.test(trimmed)) {
    return { type: 'VAT_NUMBER', value: trimmed };
  }
  
  // Postal codes
  if (/^\d{2}-\d{3}$/.test(trimmed) || /^\d{4}\s?[A-Z]{2}$/i.test(trimmed)) {
    return { type: 'POSTAL_CODE', value: trimmed };
  }
  
  // Person names (2-3 capitalized words)
  if (/^[A-ZÄÖÜĘĄŚĆŻŹŃŁ][a-zäöüęąśćżźńł]+(\s+[A-ZÄÖÜĘĄŚĆŻŹŃŁ][a-zäöüęąśćżźńł]+){1,2}$/u.test(trimmed)) {
    return { type: 'PERSON_NAME', value: trimmed };
  }
  
  // All caps names (companies, cities)
  if (/^[A-ZÄÖÜĘĄŚĆŻŹŃŁ\s\-\.]{3,}$/u.test(trimmed) && trimmed.length > 3) {
    return { type: 'CAPS_NAME', value: trimmed };
  }
  
  // Addresses with numbers
  if (/\d+/.test(trimmed) && /[A-Za-z]/.test(trimmed) && trimmed.length > 5) {
    return { type: 'ADDRESS', value: trimmed };
  }
  
  return { type: 'TEXT', value: trimmed };
}

async function analyzeFile(filePath) {
  const fileName = path.basename(filePath);
  
  try {
    const zip = new AdmZip(filePath);
    const documentXml = zip.readAsText('word/document.xml');
    
    if (!documentXml) {
      return { fileName, error: 'No document.xml' };
    }
    
    const texts = extractAllText(documentXml);
    const categorized = texts.map(t => ({
      ...categorizeValue(t),
      original: t
    }));
    
    return {
      fileName,
      xmlLength: documentXml.length,
      textCount: texts.length,
      texts,
      categorized
    };
    
  } catch (error) {
    return { fileName, error: error.message };
  }
}

async function main() {
  console.log('\n' + '╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(20) + '🔍 DOCX Pattern Analyzer' + ' '.repeat(34) + '║');
  console.log('║' + ' '.repeat(10) + 'Finding CONSTANT vs VARIABLE data across documents' + ' '.repeat(17) + '║');
  console.log('╚' + '═'.repeat(78) + '╝\n');
  
  const docDir = path.join(__dirname, 'dokumentacja');
  const files = fs.readdirSync(docDir)
    .filter(f => f.endsWith('.docx') && !f.includes('_szablon'));
  
  console.log(`📁 Found ${files.length} DOCX files to analyze\n`);
  
  // Analyze all files
  const results = [];
  for (const file of files) {
    const result = await analyzeFile(path.join(docDir, file));
    results.push(result);
    console.log(`   ✓ ${file} (${result.textCount || 0} texts)`);
  }
  
  // Count occurrences of each unique text value across ALL documents
  const valueOccurrences = new Map(); // value -> { count, files: Set, type }
  
  for (const result of results) {
    if (result.error) continue;
    
    const seenInThisFile = new Set();
    
    for (const item of result.categorized) {
      const key = item.value;
      
      if (!seenInThisFile.has(key)) {
        seenInThisFile.add(key);
        
        if (!valueOccurrences.has(key)) {
          valueOccurrences.set(key, { 
            count: 0, 
            files: new Set(), 
            type: item.type,
            original: item.original
          });
        }
        
        const entry = valueOccurrences.get(key);
        entry.count++;
        entry.files.add(result.fileName);
      }
    }
  }
  
  // Separate into CONSTANT (appears in 3+ files) vs VARIABLE (unique or rare)
  const constants = [];
  const variables = [];
  const totalFiles = results.filter(r => !r.error).length;
  
  for (const [value, data] of valueOccurrences) {
    const entry = {
      value,
      type: data.type,
      occurrences: data.count,
      percentage: Math.round((data.count / totalFiles) * 100),
      files: Array.from(data.files)
    };
    
    // Consider CONSTANT if appears in 30%+ of documents
    if (data.count >= 3 || (data.count / totalFiles) >= 0.3) {
      constants.push(entry);
    } else if (data.count === 1 && data.type !== 'TEXT') {
      variables.push(entry);
    }
  }
  
  // Sort
  constants.sort((a, b) => b.occurrences - a.occurrences);
  variables.sort((a, b) => a.type.localeCompare(b.type));
  
  // Report CONSTANTS
  console.log('\n' + '═'.repeat(80));
  console.log('📌 CONSTANT VALUES (appear in 3+ documents - should NOT be variables)');
  console.log('═'.repeat(80));
  
  const constantsByType = {};
  for (const c of constants) {
    if (!constantsByType[c.type]) constantsByType[c.type] = [];
    constantsByType[c.type].push(c);
  }
  
  for (const [type, items] of Object.entries(constantsByType)) {
    console.log(`\n   [${type}] - ${items.length} constant values:`);
    items.slice(0, 15).forEach(item => {
      const display = item.value.length > 50 ? item.value.substring(0, 50) + '...' : item.value;
      console.log(`      • "${display}" (${item.occurrences} docs, ${item.percentage}%)`);
    });
    if (items.length > 15) {
      console.log(`      ... and ${items.length - 15} more`);
    }
  }
  
  // Report VARIABLES
  console.log('\n' + '═'.repeat(80));
  console.log('🔄 VARIABLE VALUES (unique per document - SHOULD be {{variables}})');
  console.log('═'.repeat(80));
  
  const variablesByType = {};
  for (const v of variables) {
    if (!variablesByType[v.type]) variablesByType[v.type] = [];
    variablesByType[v.type].push(v);
  }
  
  for (const [type, items] of Object.entries(variablesByType)) {
    console.log(`\n   [${type}] - ${items.length} variable values (examples):`);
    items.slice(0, 10).forEach(item => {
      const display = item.value.length > 45 ? item.value.substring(0, 45) + '...' : item.value;
      console.log(`      • "${display}"`);
    });
    if (items.length > 10) {
      console.log(`      ... and ${items.length - 10} more unique values`);
    }
  }
  
  // Generate exclusion list for AI prompt
  console.log('\n' + '═'.repeat(80));
  console.log('📋 EXCLUSION LIST FOR AI PROMPT (constants to ignore)');
  console.log('═'.repeat(80));
  
  const exclusions = constants
    .filter(c => c.percentage >= 30 && c.value.length > 2)
    .map(c => c.value);
  
  console.log('\nconst CONSTANT_VALUES_TO_IGNORE = [');
  exclusions.slice(0, 50).forEach(v => {
    console.log(`  "${v.replace(/"/g, '\\"')}",`);
  });
  console.log('];');
  
  // Save analysis to file
  const analysisResult = {
    analyzedFiles: files.length,
    totalConstants: constants.length,
    totalVariables: variables.length,
    constants: constants.slice(0, 100),
    variableTypes: Object.fromEntries(
      Object.entries(variablesByType).map(([k, v]) => [k, v.length])
    ),
    exclusionList: exclusions
  };
  
  const outputPath = path.join(__dirname, 'dokumentacja', 'analysis-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(analysisResult, null, 2));
  console.log(`\n✅ Full analysis saved to: analysis-result.json`);
  
  // Summary
  console.log('\n' + '╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(30) + '📊 SUMMARY' + ' '.repeat(38) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
  console.log(`
   📁 Files analyzed:      ${files.length}
   📌 Constant values:     ${constants.length} (appear in 3+ documents)
   🔄 Variable values:     ${variables.length} (unique per document)
   📋 Exclusion list:      ${exclusions.length} items for AI prompt
  `);
}

main().catch(console.error);

