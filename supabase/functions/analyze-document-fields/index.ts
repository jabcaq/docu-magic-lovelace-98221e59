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

    console.log(`\n🔍 STARTING RUN-BY-RUN ANALYSIS`);
    console.log(`   Total runs to analyze: ${runsForAI.length}`);
    console.log(`   This will make up to ${runsForAI.length} AI requests...\n`);

    // Process each run individually through AI
    let xml = document.xml_content;
    let appliedCount = 0;
    const appliedFields: any[] = [];
    const skippedFields: any[] = [];
    const seenValues = new Map<string, string>(); // Track values we've already tagged

    for (let i = 0; i < runsForAI.length; i++) {
      const run = runsForAI[i];
      const text = run.text.trim();
      
      // Skip empty or very short runs
      if (!text || text.length < 3) {
        continue;
      }

      // Skip if we've already tagged this exact value
      if (seenValues.has(text)) {
        console.log(`   ${i + 1}/${runsForAI.length}: "${text.slice(0, 30)}..." - ⏭️  SKIP (duplicate of {{${seenValues.get(text)}}})`);
        continue;
      }

      console.log(`   ${i + 1}/${runsForAI.length}: 🔎 "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);

      try {
        // Ask AI about this specific run
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `You are analyzing a SINGLE text fragment from an automotive document (registration certificate, title, invoice, customs declaration). Decide if this fragment contains VARIABLE data that should be tagged as a template field.

AUTOMOTIVE-SPECIFIC CATEGORIES:
- vin: Vehicle Identification Numbers (17-character codes)
- registration_plate: License plate numbers, registration numbers
- vehicle_data: Make, model, year, engine capacity, fuel type, color, body type
- vehicle_ids: Homologation codes, type approval numbers, chassis numbers
- owner_data: Owner names, addresses, ID numbers, contact information
- financial_data: Purchase prices, taxes, fees, currency amounts
- dates: Registration dates, purchase dates, manufacture dates, validity dates
- location_data: Cities, countries, postal codes, dealership locations
- transaction_ids: Invoice numbers, document numbers, reference codes

WHAT TO TAG AS VARIABLE:
✅ Specific vehicle data (VIN, plate, make/model, engine specs)
✅ Owner information (names, addresses with street numbers)
✅ Dates, amounts, transaction IDs
✅ Any data specific to THIS vehicle/owner/transaction
✅ Complete addresses with building numbers (e.g., "SMOORSTRAAT 24")

WHAT NOT TO TAG:
❌ Form labels ("Marka:", "VIN:", "Owner:", "Date:")
❌ Column headers ("Make", "Model", "Description")
❌ Legal text, disclaimers, instructions
❌ Static formatting text, punctuation marks
❌ Incomplete addresses without numbers (e.g., just "SMOORSTRAAT")
❌ Single letters or numbers without context

RESPONSE FORMAT (valid JSON only):
{
  "isVariable": true/false,
  "variableName": "camelCaseEnglishName",
  "category": "one_of_categories_above",
  "reason": "brief explanation why this is/isn't a variable"
}

Examples:
- "WBA12345678901234" → {"isVariable": true, "variableName": "vinNumber", "category": "vin", "reason": "17-character VIN"}
- "Marka:" → {"isVariable": false, "reason": "Form label"}
- "Jan Kowalski" → {"isVariable": true, "variableName": "ownerName", "category": "owner_data", "reason": "Person name"}
- "SMOORSTRAAT" → {"isVariable": false, "reason": "Incomplete address - missing building number"}
- "SMOORSTRAAT 24" → {"isVariable": true, "variableName": "agentStreet", "category": "location_data", "reason": "Complete street address"}`
              },
              {
                role: "user",
                content: `Analyze this text fragment:

Text: "${text}"
${run.formatting ? `Formatting: ${JSON.stringify(run.formatting, null, 2)}` : ''}

Is this variable data that should be tagged? Respond with valid JSON only.`
              }
            ],
          }),
        });

        if (!aiResponse.ok) {
          if (aiResponse.status === 429) {
            console.log(`      ⚠️  Rate limit hit - waiting 2s...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          console.log(`      ❌ AI API error: ${aiResponse.status}`);
          continue;
        }

        const aiData = await aiResponse.json();
        const aiContent = aiData.choices?.[0]?.message?.content;
        
        if (!aiContent) {
          console.log(`      ❌ No AI response content`);
          continue;
        }

        // Parse AI response
        let analysis;
        try {
          // Try to extract JSON from markdown code blocks if present
          const jsonMatch = aiContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                           aiContent.match(/(\{[\s\S]*\})/);
          const jsonStr = jsonMatch ? jsonMatch[1] : aiContent;
          analysis = JSON.parse(jsonStr);
        } catch (e) {
          console.log(`      ❌ Failed to parse AI JSON: ${aiContent.slice(0, 100)}`);
          continue;
        }

        // Check if AI says this is a variable
        if (!analysis.isVariable) {
          console.log(`      ℹ️  NOT variable - ${analysis.reason || 'static content'}`);
          continue;
        }

        // AI identified this as a variable - apply it!
        const variableName = analysis.variableName;
        const category = analysis.category || 'other';
        const tag = `{{${variableName}}}`;

        console.log(`      ✨ VARIABLE: ${tag} [${category}]`);
        console.log(`         ${analysis.reason}`);

        const result = replaceInWT(xml, text, tag);

        if (result.success) {
          xml = result.xml;
          
          // Save to document_fields with formatting
          await supabase.from("document_fields").insert({
            document_id: documentId,
            field_name: variableName,
            field_value: text,
            field_tag: tag,
            position_in_html: appliedCount,
            run_formatting: run.formatting || {},
          });
          
          appliedCount++;
          appliedFields.push({ text, tag, category, formatting: run.formatting });
          seenValues.set(text, variableName); // Remember we tagged this value
          
          console.log(`      ✅ Applied successfully!\n`);
        } else {
          skippedFields.push({ text, tag, category, reason: 'not found in XML' });
          console.log(`      ❌ Failed - text not found in XML\n`);
        }

      } catch (error) {
        console.log(`      ❌ Error: ${error instanceof Error ? error.message : 'unknown'}\n`);
        continue;
      }
    }

    // Update document with tagged XML and clear HTML cache
    await supabase
      .from("documents")
      .update({ 
        xml_content: xml,
        html_cache: null, // Force regeneration
        status: "verified" // Mark as ready for verification
      })
      .eq("id", documentId);

    console.log(`\n📊 ANALYSIS COMPLETE:`);
    console.log(`   ✅ Successfully applied: ${appliedCount} fields`);
    console.log(`   ⏭️  Skipped (duplicates): ${seenValues.size - appliedCount}`);
    console.log(`   ❌ Failed to apply: ${skippedFields.length}`);
    
    if (appliedFields.length > 0) {
      console.log(`\n✨ Applied fields by category:`);
      const byCategory = appliedFields.reduce((acc, f) => {
        acc[f.category] = (acc[f.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      Object.entries(byCategory).forEach(([cat, count]) => {
        console.log(`   • ${cat}: ${count}`);
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        appliedCount: appliedCount,
        totalRuns: runsForAI.length,
        skippedDuplicates: seenValues.size - appliedCount,
        failedToApply: skippedFields.length,
        fields: appliedFields
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in analyze-document-fields:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
