import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replace first occurrence of searchText inside <w:t> nodes only
function replaceInWT(xml: string, searchText: string, replacement: string): { success: boolean; xml: string } {
  let replaced = false;
  const wtRegex = /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  const newXml = xml.replace(wtRegex, (full, open, content, close) => {
    if (replaced) return full;
    const idx = content.indexOf(searchText);
    if (idx === -1) return full;
    replaced = true;
    const updated = content.slice(0, idx) + replacement + content.slice(idx + searchText.length);
    return `${open}${updated}${close}`;
  });
  return { success: replaced, xml: newXml };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { documentId } = await req.json();

    console.log("Analyzing document:", documentId);

    // Get document XML and type
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("xml_content, name, type, runs_metadata")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    if (!document.xml_content) {
      throw new Error("Document has no XML content");
    }

    // Extract text from XML runs for AI analysis
    let runsForAI: Array<{ text: string; formatting?: any }> = [];
    
    if (document.runs_metadata && Array.isArray(document.runs_metadata) && document.runs_metadata.length > 0) {
      console.log("Using OpenXML runs from metadata");
      runsForAI = document.runs_metadata;
    } else {
      // Extract plain text runs from XML by reading <w:t>
      const matches = Array.from(document.xml_content.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) as RegExpMatchArray[];
      const texts = matches
        .map(m => m[1]?.trim())
        .filter(Boolean) as string[];
      runsForAI = texts.map(t => ({ text: t }));
    }

    // Prepare texts array for batch AI analysis
    const textsToAnalyze = runsForAI
      .map((run, index) => ({
        index,
        text: run.text.trim(),
        formatting: run.formatting
      }))
      .filter(item => item.text.length >= 3); // Skip very short texts

    console.log(`\n🔍 BATCH ANALYSIS WITH CHUNKING`);
    console.log(`   Total runs: ${runsForAI.length}`);
    console.log(`   Texts to analyze: ${textsToAnalyze.length}`);

    // Split into batches of 80 to avoid timeout
    const BATCH_SIZE = 80;
    const batches: typeof textsToAnalyze[] = [];
    for (let i = 0; i < textsToAnalyze.length; i += BATCH_SIZE) {
      batches.push(textsToAnalyze.slice(i, i + BATCH_SIZE));
    }

    console.log(`   Split into ${batches.length} batches of max ${BATCH_SIZE} texts\n`);

    // Process batches sequentially
    const systemPrompt = `You are analyzing text fragments from automotive documents (insurance policies, contracts, registration certificates).

Your task: Return the SAME array of texts, but replace variable fields with template tags {{variableName}}.

VARIABLE examples (replace with {{variableName}}):
- Owner names, addresses, phone numbers → {{ownerName}}, {{ownerAddress}}, {{ownerPhone}}
- VIN numbers, registration numbers → {{vinNumber}}, {{registrationNumber}}
- Dates → {{issueDate}}, {{birthDate}}, {{expiryDate}}
- Vehicle details → {{vehicleMake}}, {{vehicleModel}}, {{vehicleYear}}
- Insurance details → {{policyNumber}}, {{premiumAmount}}, {{insurerName}}

STATIC TEXT (keep unchanged):
- Section headers, titles, labels
- Instructions, descriptions
- Company names, standard clauses

Rules:
1. Return JSON array with same length as input
2. Each item: { text: string (original OR with {{tag}}), isVariable: boolean, variableName?: string, category?: string }
3. Variable names MUST be English camelCase
4. Categories: vin, owner_data, vehicle_details, insurance_data, dates, contract_terms, other
5. Keep static text unchanged

Example input: ["John Smith", "Insurance Policy", "VIN: ABC123"]
Example output: [
  { "text": "{{ownerName}}", "isVariable": true, "variableName": "ownerName", "category": "owner_data" },
  { "text": "Insurance Policy", "isVariable": false },
  { "text": "{{vinNumber}}", "isVariable": true, "variableName": "vinNumber", "category": "vin" }
]`;

    // Process each batch
    let allAnalysisResults: Array<{ text: string; isVariable: boolean; variableName?: string; category?: string; originalIndex: number }> = [];

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      console.log(`\n   📦 Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} texts)...`);

      const userPrompt = `Analyze these ${batch.length} text fragments and return JSON array:\n\n${JSON.stringify(batch.map(t => t.text))}`;

      let aiResponse;
      try {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
          }),
        });

        if (!aiRes.ok) {
          const errText = await aiRes.text();
          throw new Error(`AI request failed: ${aiRes.status} - ${errText}`);
        }

        aiResponse = await aiRes.json();
      } catch (err) {
        console.error(`❌ Batch ${batchIdx + 1} AI request error:`, err);
        throw err;
      }

      const content = aiResponse?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(`No AI response for batch ${batchIdx + 1}`);
      }

      // Parse AI response
      let batchResults: Array<{ text: string; isVariable: boolean; variableName?: string; category?: string }>;
      try {
        const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        batchResults = JSON.parse(cleaned);
      } catch (parseErr) {
        console.error(`Could not parse AI response for batch ${batchIdx + 1}:`, content);
        throw new Error(`Failed to parse AI response for batch ${batchIdx + 1}`);
      }

      if (!Array.isArray(batchResults) || batchResults.length !== batch.length) {
        throw new Error(`Batch ${batchIdx + 1}: AI returned invalid array (expected ${batch.length}, got ${batchResults?.length || 0})`);
      }

      // Add original index to results
      const resultsWithIndex = batchResults.map((result, idx) => ({
        ...result,
        originalIndex: batch[idx].index
      }));

      allAnalysisResults.push(...resultsWithIndex);
      console.log(`   ✓ Batch ${batchIdx + 1} complete: ${batchResults.length} results`);
    }

    console.log(`\n   ✓ All ${batches.length} batches processed: ${allAnalysisResults.length} total results\n`);
    console.log(`   Processing replacements...\n`);

    // Apply replacements to XML
    let xml = document.xml_content;
    let appliedCount = 0;
    const appliedFields: any[] = [];
    const seenValues = new Map<string, string>();

    for (let i = 0; i < allAnalysisResults.length; i++) {
      const analysis = allAnalysisResults[i];
      const originalItem = textsToAnalyze.find(t => t.index === analysis.originalIndex);
      if (!originalItem) continue;
      
      const originalText = originalItem.text;

      if (!analysis.isVariable) {
        console.log(`   ${i + 1}/${allAnalysisResults.length}: "${originalText.slice(0, 40)}" - Static text`);
        continue;
      }

      const varName = analysis.variableName || `field_${i}`;
      const tag = `{{${varName}}}`;

      // Skip duplicates
      if (seenValues.has(originalText)) {
        console.log(`   ${i + 1}/${allAnalysisResults.length}: "${originalText.slice(0, 40)}" - ⏭️  SKIP (duplicate)`);
        continue;
      }

      // Replace in XML
      const result = replaceInWT(xml, originalText, tag);
      if (result.success) {
        xml = result.xml;
        appliedCount++;
        seenValues.set(originalText, varName);

        appliedFields.push({
          field_name: varName,
          field_value: originalText,
          field_tag: tag,
          category: analysis.category || 'other',
          run_formatting: originalItem.formatting || null,
        });

        console.log(`   ${i + 1}/${allAnalysisResults.length}: ✅ "${originalText.slice(0, 40)}" → ${tag}`);
      } else {
        console.log(`   ${i + 1}/${allAnalysisResults.length}: ⚠️  "${originalText.slice(0, 40)}" - Not found in XML`);
      }
    }

    console.log(`\n📊 ANALYSIS COMPLETE`);
    console.log(`   Applied: ${appliedCount} fields`);
    console.log(`   Total analyzed: ${allAnalysisResults.length}`);

    // Save fields to database
    if (appliedFields.length > 0) {
      const fieldsToInsert = appliedFields.map((f) => ({
        document_id: documentId,
        field_name: f.field_name,
        field_value: f.field_value,
        field_tag: f.field_tag,
        run_formatting: f.run_formatting,
      }));

      const { error: insertError } = await supabase
        .from("document_fields")
        .insert(fieldsToInsert);

      if (insertError) {
        console.error("Error saving fields:", insertError);
        throw insertError;
      }

      console.log(`   ✓ Saved ${appliedFields.length} fields to database`);
    }

    // Update document with tagged XML
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        xml_content: xml,
        html_cache: null,
        status: "verified",
      })
      .eq("id", documentId);

    if (updateError) {
      console.error("Error updating document:", updateError);
      throw updateError;
    }

    console.log(`   ✓ Document updated\n`);

    return new Response(
      JSON.stringify({
        success: true,
        appliedCount,
        totalAnalyzed: allAnalysisResults.length,
        batchesProcessed: batches.length,
        fields: appliedFields.map(f => ({
          name: f.field_name,
          value: f.field_value,
          tag: f.field_tag,
          category: f.category,
        })),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error analyzing document:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
