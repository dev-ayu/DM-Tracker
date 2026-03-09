import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // CORS — Fix #14: restrict to ALLOWED_ORIGIN in production
  const origin = req.headers.origin || "";
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowed === "*" ? "*" : (origin === allowed ? origin : ""));
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) throw new Error("Supabase env vars not set");

    // Fix #1: require userId — prevents querying all users
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });

    // Fix #7: validate Bearer JWT before doing any DB work
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user || user.id !== userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Service-role client is used only after auth is confirmed
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch user settings to resolve Groq key, opener templates, and custom prompt
    const { data: userSettings } = await supabase
      .from("user_settings")
      .select("groq_api_key, opener_option_a, custom_prompt, opener_templates")
      .eq("user_id", userId)
      .maybeSingle();

    const groqApiKey = userSettings?.groq_api_key || process.env.GROQ_API_KEY;
    if (!groqApiKey) throw new Error("No Groq API key configured — set GROQ_API_KEY or add your own in Settings");

    const openerOptionA = userSettings?.opener_option_a || "Hey, do you accept new clients for Botox right now?";

    // Build prompt from templates (new system) or fall back to legacy
    function buildPromptFromTemplates(templates) {
      const optionLines = templates
        .map((t, i) => `Option ${i + 1}: "${t.text}"\n  → Use when: ${t.condition}`)
        .join("\n\n");

      // Detect bracket placeholders to add context-specific rules
      const allText = templates.map(t => t.text).join(" ");
      const hasGreeting = allText.includes("[GREETING]");
      const hasName = allText.includes("[NAME]");

      const rules = [];
      if (hasGreeting) {
        rules.push('- [GREETING] must be one of: "Hi", "Hey", or "Hello" (vary it, don\'t always use the same one)');
      }
      if (hasName) {
        rules.push('- For [NAME], use the name field as given, but do NOT add titles like "Dr"');
        rules.push('- If you are unsure whether it\'s a real name, use the option without [NAME]');
      }
      rules.push("- For any other bracket placeholders like [BUSINESS NAME], extract the actual value from the contact's bio");
      rules.push("- Return ONLY the opener text, nothing else");
      rules.push("- One line per contact, in the same order");

      return `You are a sales outreach assistant. For each contact below, generate the BEST opener using these options ONLY:

${optionLines}

Rules:
${rules.join("\n")}

Contacts:
{{contacts}}`;
    }

    const DEFAULT_PROMPT_TEMPLATE = `You are a sales outreach assistant. For each contact below, generate the BEST opener using these options ONLY:

Option 1: "[GREETING] [NAME], do you accept new clients for Botox right now?"
  → Use when: A person's name is present

Option 2: "[GREETING], do you accept new clients for Botox right now?"
  → Use when: No clear person name is present

Rules:
- [GREETING] must be one of: "Hi", "Hey", or "Hello" (vary it, don't always use the same one)
- For [NAME], use the name field as given, but do NOT add titles like "Dr"
- If you are unsure whether it's a real name, use Option 2
- Return ONLY the opener text, nothing else
- One line per contact, in the same order

Contacts:
{{contacts}}`;

    // Resolve prompt template: custom_prompt > opener_templates > legacy default
    let promptTemplate;
    const templates = userSettings?.opener_templates;
    if (userSettings?.custom_prompt) {
      // Power user has a custom prompt — use it directly
      promptTemplate = userSettings.custom_prompt;
    } else if (Array.isArray(templates) && templates.length > 0) {
      // New templates system — auto-generate prompt
      promptTemplate = buildPromptFromTemplates(templates);
    } else {
      // Legacy fallback — use old default with {{option_a}} substitution
      promptTemplate = DEFAULT_PROMPT_TEMPLATE;
    }

    // Fallback opener for failed generations
    const fallbackOpener = (Array.isArray(templates) && templates.length > 0)
      ? templates[0].text
      : openerOptionA;

    // Get contacts in today's DM queue + any followed contacts needing openers
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const today = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
    const { data: dmQueueEntries } = await supabase
      .from("daily_queues")
      .select("contact_id")
      .eq("queue_date", today)
      .eq("queue_type", "dm")
      .eq("user_id", userId);
    const dmContactIds = (dmQueueEntries || []).map((q) => q.contact_id);

    // Get DM queue contacts
    let dmContacts = [];
    if (dmContactIds.length > 0) {
      const { data } = await supabase
        .from("contacts")
        .select("id, user_id, full_name, biography")
        .in("id", dmContactIds);
      dmContacts = data || [];
    }

    // Also get followed contacts as fallback
    const { data: followedContacts } = await supabase
      .from("contacts")
      .select("id, user_id, full_name, biography")
      .eq("status", "followed")
      .is("dmed_at", null)
      .eq("user_id", userId)
      .limit(100);

    // Merge and deduplicate
    const seenIds = new Set();
    const contacts = [];
    for (const c of [...dmContacts, ...(followedContacts || [])]) {
      if (!seenIds.has(c.id)) { seenIds.add(c.id); contacts.push(c); }
    }

    if (!contacts || contacts.length === 0) {
      return res.status(200).json({ message: "No contacts need openers" });
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
      return res.status(200).json({ message: "All contacts already have openers" });
    }

    // Generate openers using Groq
    const openers = [];
    let retryCount = 0;

    for (let i = 0; i < needOpeners.length; i += 5) {
      const batch = needOpeners.slice(i, i + 5);

      const contactsList = batch.map((c, idx) => `${idx + 1}. Name: ${c.full_name}, Bio: ${c.biography || "No bio"}`).join("\n");
      const prompt = promptTemplate
        .replace(/\{\{option_a\}\}/g, openerOptionA)
        .replace(/\{\{contacts\}\}/g, contactsList)
        + `\n\nReturn exactly ${batch.length} lines, one opener per contact:`;

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
        }),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        if (groqRes.status === 429) {
          // Fix #11: cap retries at 3 per batch — skip instead of looping forever
          if (retryCount >= 3) {
            retryCount = 0;
            continue; // skip this batch
          }
          retryCount++;
          await new Promise((r) => setTimeout(r, 10000));
          i -= 5; // retry same batch (for loop will add 5 back)
          continue;
        }
        throw new Error(`Groq API error: ${errText}`);
      }

      retryCount = 0;

      const groqData = await groqRes.json();
      const lines = groqData.choices[0].message.content
        .trim()
        .split("\n")
        .map((l) => l.replace(/^\d+\.\s*/, "").trim())
        .filter((l) => l.length > 0);

      batch.forEach((contact, idx) => {
        openers.push({
          user_id: contact.user_id,
          contact_id: contact.id,
          opener_text: lines[idx] || fallbackOpener,
        });
      });

      // Delay between batches
      if (i + 5 < needOpeners.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Insert openers
    if (openers.length > 0) {
      const { error: insertError } = await supabase.from("openers").insert(openers);
      if (insertError) throw insertError;
    }

    return res.status(200).json({ message: `Generated ${openers.length} openers` });
  } catch (error) {
    console.error("generate-openers error:", error);
    return res.status(500).json({ error: error.message });
  }
}
