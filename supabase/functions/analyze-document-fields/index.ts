import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// No longer needed - we don't modify XML directly

Deno.serve(async (req) => {
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

    console.log("🔍 Starting document analysis:", documentId);

    // Get document
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

    // Extract runs
    let runs: Array<{ text: string; formatting?: any; paragraphIndex?: number }> = [];
    
    if (document.runs_metadata && Array.isArray(document.runs_metadata) && document.runs_metadata.length > 0) {
      runs = document.runs_metadata;
    } else {
      throw new Error("Document has no runs metadata");
      // const matches = Array.from(document.xml_content.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) as RegExpMatchArray[];
      // const texts = matches.map(m => m[1]?.trim()).filter(Boolean) as string[];
      // runs = texts.map((t, i) => ({ text: t, paragraphIndex: 0 }));
    }

    console.log(`   Found ${runs.length} text runs`);

    // Extract just the text array for AI
    const originalTexts = runs.map(r => r.text);
    
    console.log(`   Sending ${originalTexts.length} texts to AI...`);
    console.log("   Original runs have formatting:", runs.some(r => r.formatting));

    // AI Prompt - zwróć te same teksty, ale zmień zmienne na {{tags}}
    const systemPrompt = `You are analyzing text fragments from customs/automotive documents.

TASK: Return EXACTLY THE SAME array of texts, but replace ONLY VARIABLE data with {{tagName}} placeholders.

═══════════════════════════════════════════════════════════════════════
⚠️ CRITICAL: CONSTANT VALUES - NEVER REPLACE (identical across all documents):
═══════════════════════════════════════════════════════════════════════

CONSTANT COMPANIES/REPRESENTATIVES:
- "MARLOG CAR HANDLING BV", "MARLOG CAR HANDLING", "SMOORSTRAAT 24", "ROOSENDAAL"
- "NL006223527", "006223527" (customs number - always same)
- "LEAN CUSTOMS B.V.", "MLG INTERNATIONAL S.A."

CONSTANT CODES AND NUMBERS:
- "87032490", "87032490000000000000", "8703239000" (tariff codes)
- "N935", "N821", "Y923", "792", "160" (form codes)
- "10", "21" (VAT/duty rates)
- "IM", "A", "IM-A" (declaration types)
- "EUR", "PL", "NL", "DE", "BE", "US" (country/currency codes)
- "NL000396" (customs office)
- "[kod kreskowy]"

CONSTANT HEADERS/LABELS:
- Any text ending with ":"
- "Zgłaszający", "Przedstawiciel", "WSPÓLNOTA EUROPEJSKA"

CONSTANT ADDRESSES:
- "Skrytka pocztowa 3070", "6401 DN Heerlen"
- "NL-4705 AA ROOSENDAAL", "4705 AA"

═══════════════════════════════════════════════════════════════════════
✅ VARIABLE DATA - REPLACE with {{tags}} (differs between documents):
═══════════════════════════════════════════════════════════════════════

1. VIN (17 chars) → {{vinNumber}}
2. MRN (customs ref, e.g. "25NL7PU1EYHFR8FDR4") → {{mrnNumber}}
3. Dates → {{issueDate}}, {{acceptanceDate}}
4. Money amounts → {{customsValue}}, {{vatAmount}}, {{dutyAmount}}
5. Client names → {{declarantName}}, {{ownerName}}
6. Client addresses → {{declarantAddress}}
7. Client cities → {{declarantCity}}
8. Postal codes → {{postalCode}}
9. Reference numbers (unique) → {{referenceNumber}}
10. Vehicle description (with year, make, VIN) → {{vehicleDescription}}
11. Container numbers (4 letters + 7 digits) → {{containerNumber}}
    Examples: "BEAU5658460", "TCNU7942617", "MSMU5801360"
12. Vessel/ship names → {{vesselName}}
    Examples: "MSC CORUNA", "COSCO HOPE", "EVER FOREVER"
13. Shipment numbers → {{shipmentNumber}}
    Examples: "MCH-SI-062127", "687665"
14. Booking/BL numbers → {{bookingNumber}}
    Examples: "EGLV400500241810", "MEDUOJ809542"

RULES:
1. Return JSON array: ["text or {{tag}}", "text or {{tag}}", ...]
2. MUST be EXACTLY same length as input
3. MUST be EXACTLY same order
4. If text is CONSTANT (from list above) → return UNCHANGED
5. If text is VARIABLE → return {{camelCaseTag}}
6. Single chars/digits, labels with ":" → return UNCHANGED

Example:
Input: ["Data:", "09-07-2025", "MARLOG CAR HANDLING BV", "KUBICZ DANIEL", "NL006223527"]
Output: ["Data:", "{{issueDate}}", "MARLOG CAR HANDLING BV", "{{declarantName}}", "NL006223527"]`;

    const userPrompt = `Analyze these ${originalTexts.length} texts:\n${JSON.stringify(originalTexts)}`;

    // Call AI
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
        temperature: 0.1,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI request failed: ${aiRes.status} - ${errText}`);
    }

    const aiResponse = await aiRes.json();
    const content = aiResponse?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No AI response");

    console.log("   ✓ AI response received, parsing...");

    // Parse AI response
    let processedTexts: string[];
    try {
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      processedTexts = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", content);
      throw new Error("AI returned invalid JSON");
    }

    // Validate
    if (!Array.isArray(processedTexts)) {
      throw new Error("AI response is not an array");
    }

    // Normalize length if AI response doesn't match input
    if (processedTexts.length !== originalTexts.length) {
      console.error(`Length mismatch! Expected: ${originalTexts.length}, Got: ${processedTexts.length} - normalizing instead of failing`);
      const normalized: string[] = [];
      for (let i = 0; i < originalTexts.length; i++) {
        const v = processedTexts[i];
        normalized.push(typeof v === 'string' ? v : originalTexts[i]);
      }
      processedTexts = normalized;
    }

    console.log(`   ✓ Proceeding with ${processedTexts.length} texts after validation/normalization\n`);

    // Create new runs with processed texts
    const processedRuns = runs.map((run, i) => ({
      text: processedTexts[i],
      formatting: run.formatting,
      paragraphIndex: run.paragraphIndex
    }));

    console.log("   Analyzing processed texts for variables...\n");

    // ✅ NIE modyfikujemy xml_content tutaj - to zrobi rebuild-document-xml później
    
    // Extract fields from processed texts
    const appliedFields: any[] = [];
    const seenTags = new Set<string>();

    for (let i = 0; i < originalTexts.length; i++) {
      const originalText = originalTexts[i];
      const processedText = processedTexts[i];

      // Check if AI changed the text (found a variable)
      if (originalText !== processedText && processedText.includes('{{') && processedText.includes('}}')) {
        // Extract tag name from {{tagName}}
        const tagMatch = processedText.match(/\{\{(\w+)\}\}/);
        if (!tagMatch) continue;

        const tag = processedText;
        const varName = tagMatch[1];

        // Skip duplicates
        if (seenTags.has(tag)) {
          console.log(`   ${i + 1}: ⏭️  "${originalText.slice(0, 40)}" - duplicate tag`);
          continue;
        }

        seenTags.add(tag);

        // Determine category based on variable name
        let category = 'other';
        const lowerVar = varName.toLowerCase();
        if (lowerVar.includes('vin')) category = 'vin';
        else if (lowerVar.includes('owner') || lowerVar.includes('name') || lowerVar.includes('address')) category = 'owner_data';
        else if (lowerVar.includes('vehicle') || lowerVar.includes('make') || lowerVar.includes('model') || lowerVar.includes('year')) category = 'vehicle_details';
        else if (lowerVar.includes('date')) category = 'dates';
        else if (lowerVar.includes('price') || lowerVar.includes('amount') || lowerVar.includes('tax')) category = 'financial';
        else if (lowerVar.includes('city') || lowerVar.includes('country') || lowerVar.includes('location')) category = 'location';

        appliedFields.push({
          field_name: varName,
          field_value: originalText,
          field_tag: tag,
          category,
          run_formatting: runs[i].formatting || null,
          position_in_html: i,
        });

        console.log(`   ${i + 1}: ✅ "${originalText.slice(0, 40)}" → ${tag}`);
      }
    }

    console.log(`\n📊 Analysis complete: ${appliedFields.length} variables found`);

    // Save to database
    if (appliedFields.length > 0) {
      const fieldsToInsert = appliedFields.map((f) => ({
        document_id: documentId,
        field_name: f.field_name,
        field_value: f.field_value,
        field_tag: f.field_tag,
        run_formatting: f.run_formatting,
        position_in_html: f.position_in_html,
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

    // Update document with processed runs (xml_content will be rebuilt later by rebuild-document-xml)
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        runs_metadata: processedRuns, // ✅ Runy z formatowaniem i {{tags}}
        html_cache: null,
        status: "verified",
        // ❌ NIE aktualizujemy xml_content tutaj
      })
      .eq("id", documentId);

    if (updateError) {
      console.error("Error updating document:", updateError);
      throw updateError;
    }

    console.log(`   ✓ Document updated with processed runs\n`);

    return new Response(
      JSON.stringify({
        success: true,
        appliedCount: appliedFields.length,
        totalAnalyzed: originalTexts.length,
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
    console.error("❌ Error analyzing document:", error);
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
