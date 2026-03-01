import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) throw new Error("GROQ_API_KEY not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get userId from body or use service role for cron
    let userId: string | null = null;
    try {
      const body = await req.json();
      userId = body.userId;
    } catch {
      // Cron call - process all users
    }

    // Get contacts that are followed but don't have openers yet
    let query = supabase
      .from("contacts")
      .select("id, user_id, full_name, biography")
      .eq("status", "followed")
      .is("dmed_at", null);

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data: contacts, error: fetchError } = await query.limit(100);
    if (fetchError) throw fetchError;

    if (!contacts || contacts.length === 0) {
      return new Response(
        JSON.stringify({ message: "No contacts need openers" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check which already have openers
    const contactIds = contacts.map((c) => c.id);
    const { data: existingOpeners } = await supabase
      .from("openers")
      .select("contact_id")
      .in("contact_id", contactIds);

    const existingIds = new Set((existingOpeners || []).map((o) => o.contact_id));
    const needOpeners = contacts.filter((c) => !existingIds.has(c.id));

    if (needOpeners.length === 0) {
      return new Response(
        JSON.stringify({ message: "All contacts already have openers" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate openers using Groq with openai/gpt-oss-120b
    const openers: { user_id: string; contact_id: string; opener_text: string }[] = [];

    // Process in batches of 5 to avoid rate limits
    for (let i = 0; i < needOpeners.length; i += 5) {
      const batch = needOpeners.slice(i, i + 5);

      const prompt = `You are a sales outreach assistant. For each contact below, pick the BEST opener from these two options ONLY:

Option A: "Are you taking on more clients atm?"
Option B: "Still running [BUSINESS NAME]?" (use this ONLY if their bio clearly mentions a business, brand, company, or clinic they own/founded - extract the actual business name)

Rules:
- If the bio mentions they are a founder, owner, CEO, or co-founder of a specific business/brand, use Option B with that business name
- Otherwise, always default to Option A
- Return ONLY the opener text, nothing else
- One line per contact

Contacts:
${batch.map((c, idx) => `${idx + 1}. Name: ${c.full_name}, Bio: ${c.biography || "No bio"}`).join("\n")}

Return exactly ${batch.length} lines, one opener per contact:`;

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
        }),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        console.error(`Groq API error on batch ${i}: ${errText}`);
        // If rate limited, wait and retry
        if (groqRes.status === 429) {
          console.log("Rate limited, waiting 10s...");
          await new Promise((r) => setTimeout(r, 10000));
          i -= 5; // retry this batch
          continue;
        }
        throw new Error(`Groq API error: ${errText}`);
      }

      const groqData = await groqRes.json();
      const lines = groqData.choices[0].message.content
        .trim()
        .split("\n")
        .map((l: string) => l.replace(/^\d+\.\s*/, "").trim())
        .filter((l: string) => l.length > 0);

      batch.forEach((contact, idx) => {
        openers.push({
          user_id: contact.user_id,
          contact_id: contact.id,
          opener_text: lines[idx] || "Are you taking on more clients atm?",
        });
      });

      // Small delay between batches to avoid rate limits
      if (i + 5 < needOpeners.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Insert openers
    if (openers.length > 0) {
      const { error: insertError } = await supabase.from("openers").insert(openers);
      if (insertError) throw insertError;
    }

    return new Response(
      JSON.stringify({ message: `Generated ${openers.length} openers` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-openers error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
