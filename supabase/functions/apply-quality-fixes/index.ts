import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { documentId, qualityIssues } = await req.json();

    console.log("🔧 Applying quality fixes to document:", documentId);
    console.log("📋 Issues to fix:", qualityIssues.length);

    // Get document and current fields
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("runs_metadata")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      throw new Error("Document not found");
    }

    const { data: existingFields } = await supabase
      .from("document_fields")
      .select("*")
      .eq("document_id", documentId);

    const runs = document.runs_metadata || [];
    const originalTexts = runs.map((r: any) => r.text);

    console.log(`   Found ${runs.length} runs, ${existingFields?.length || 0} existing fields`);

    // Build AI prompt with current state and fixes
    const existingVariables = (existingFields || []).map(f => ({
      tag: f.field_tag,
      value: f.field_value,
      name: f.field_name
    }));

    const systemPrompt = `You are improving document field mapping based on quality analysis feedback.

CURRENT STATE:
- Document has ${originalTexts.length} text runs
- Already mapped variables: ${JSON.stringify(existingVariables, null, 2)}

ISSUES TO FIX:
${qualityIssues.map((issue: any, i: number) => `
${i + 1}. [${issue.severity.toUpperCase()}] ${issue.type}
   Problem: ${issue.description}
   Current: ${issue.currentState}
   Suggestion: ${issue.suggestion}
   ${issue.affectedVariables.length > 0 ? `Affected: ${issue.affectedVariables.join(', ')}` : ''}
`).join('\n')}

TASK: 
Return the SAME array of ${originalTexts.length} texts, but with ADDITIONAL variables replaced based on the issues above.
Keep ALL existing {{tags}} that are already there.
Add NEW {{tags}} only for issues identified above.

RULES:
1. Return JSON array: ["text or {{tag}}", "text or {{tag}}", ...]
2. MUST be EXACTLY ${originalTexts.length} items (same length as input)
3. MUST be EXACTLY same order
4. Keep existing {{tags}} unchanged
5. Add new {{tags}} for hardcoded values mentioned in issues
6. Use clear, descriptive English camelCase names for new tags

Example:
Input: ["Owner:", "Jan Kowalski", "Document type: Invoice"]
Existing: [{"tag": "{{ownerName}}", "value": "Jan Kowalski"}]
Issue: "Hardcoded text: 'Document type: Invoice' should be variable"
Output: ["Owner:", "{{ownerName}}", "{{documentType}}: {{documentTypeValue}}"]`;

    const userPrompt = `Current texts:\n${JSON.stringify(originalTexts, null, 2)}`;

    console.log("   Sending to AI for quality fixes...");

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
    let improvedTexts: string[];
    try {
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      improvedTexts = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", content);
      throw new Error("AI returned invalid JSON");
    }

    // Normalize length if needed
    if (improvedTexts.length !== originalTexts.length) {
      console.error(`Length mismatch! Expected: ${originalTexts.length}, Got: ${improvedTexts.length}`);
      const normalized: string[] = [];
      for (let i = 0; i < originalTexts.length; i++) {
        const v = improvedTexts[i];
        normalized.push(typeof v === 'string' ? v : originalTexts[i]);
      }
      improvedTexts = normalized;
    }

    console.log(`   ✓ Processing ${improvedTexts.length} improved texts\n`);

    // Find NEW fields (not in existing)
    const existingTags = new Set((existingFields || []).map(f => f.field_tag));
    const newFields: any[] = [];

    for (let i = 0; i < improvedTexts.length; i++) {
      const improvedText = improvedTexts[i];
      const originalText = originalTexts[i];

      // Check if this text now has a variable that wasn't there before
      if (improvedText !== originalText && improvedText.includes('{{') && improvedText.includes('}}')) {
        const tagMatch = improvedText.match(/\{\{(\w+)\}\}/);
        if (!tagMatch) continue;

        const tag = improvedText;
        const varName = tagMatch[1];

        // Only add if this is a NEW tag
        if (!existingTags.has(tag)) {
          // Determine category
          let category = 'other';
          const lowerVar = varName.toLowerCase();
          if (lowerVar.includes('vin')) category = 'vin';
          else if (lowerVar.includes('owner') || lowerVar.includes('name') || lowerVar.includes('address')) category = 'owner_data';
          else if (lowerVar.includes('vehicle') || lowerVar.includes('make') || lowerVar.includes('model') || lowerVar.includes('year')) category = 'vehicle_details';
          else if (lowerVar.includes('date')) category = 'dates';
          else if (lowerVar.includes('price') || lowerVar.includes('amount') || lowerVar.includes('tax')) category = 'financial';
          else if (lowerVar.includes('city') || lowerVar.includes('country') || lowerVar.includes('location')) category = 'location';

          newFields.push({
            field_name: varName,
            field_value: originalText,
            field_tag: tag,
            category,
            run_formatting: runs[i].formatting || null,
            position_in_html: i,
            is_suggestion: true, // Mark as suggestion
          });

          console.log(`   ✅ NEW: "${originalText.slice(0, 40)}" → ${tag}`);
        }
      }
    }

    console.log(`\n📊 Found ${newFields.length} new suggested fields`);

    // Save new fields to database with is_suggestion flag
    if (newFields.length > 0) {
      // First, mark them in a way we can distinguish (we'll add metadata)
      const fieldsToInsert = newFields.map((f) => ({
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
        console.error("Error saving new fields:", insertError);
        throw insertError;
      }

      console.log(`   ✓ Saved ${newFields.length} new suggested fields`);
    }

    // Update runs_metadata with improved texts
    const improvedRuns = runs.map((run: any, i: number) => ({
      text: improvedTexts[i],
      formatting: run.formatting,
      paragraphIndex: run.paragraphIndex
    }));

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        runs_metadata: improvedRuns,
        html_cache: null, // Force re-render
      })
      .eq("id", documentId);

    if (updateError) {
      console.error("Error updating document:", updateError);
      throw updateError;
    }

    console.log(`   ✓ Document updated with improved runs\n`);

    // Rebuild XML
    console.log("   Rebuilding XML...");
    await fetch(`${supabaseUrl}/functions/v1/rebuild-document-xml`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ documentId }),
    });

    return new Response(
      JSON.stringify({
        success: true,
        newFieldsCount: newFields.length,
        newFields: newFields.map(f => ({
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
    console.error("❌ Error applying quality fixes:", error);
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
