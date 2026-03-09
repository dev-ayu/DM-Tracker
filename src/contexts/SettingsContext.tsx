import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface OpenerTemplate {
  text: string;
  condition: string;
  order: number;
}

export interface UserSettings {
  follow_limit: number;
  dm_limit: number;
  followup_delay_hours: number;
  flywheel_days: number;
  skip_days: number;
  max_followups_a: number;
  max_followups_b: number;
  max_followups_c: number;
  opener_option_a: string;
  groq_api_key: string | null;
  custom_prompt: string | null;
  opener_templates: OpenerTemplate[] | null;
  working_days: string;
}

export const DEFAULT_TEMPLATES: OpenerTemplate[] = [
  { text: "[GREETING] [NAME], do you accept new clients for Botox right now?", condition: "A person's name is present", order: 0 },
  { text: "[GREETING], do you accept new clients for Botox right now?", condition: "No clear person name is present", order: 1 },
];

export function buildPromptFromTemplates(templates: OpenerTemplate[]): string {
  const optionLines = templates
    .map((t, i) => `Option ${i + 1}: "${t.text}"\n  → Use when: ${t.condition}`)
    .join("\n\n");

  // Detect bracket placeholders to add context-specific rules
  const allText = templates.map(t => t.text).join(" ");
  const hasGreeting = allText.includes("[GREETING]");
  const hasName = allText.includes("[NAME]");

  const rules: string[] = [];
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

// Legacy template kept for backward compatibility with users who have custom_prompt using {{option_a}}
export const DEFAULT_PROMPT_TEMPLATE = `You are a sales outreach assistant. For each contact below, generate the BEST opener using these options ONLY:

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

export const DEFAULT_SETTINGS: UserSettings = {
  follow_limit: 30,
  dm_limit: 30,
  followup_delay_hours: 24,
  flywheel_days: 90,
  skip_days: 2,
  max_followups_a: 1,
  max_followups_b: 8,
  max_followups_c: 8,
  opener_option_a: "Hey, do you accept new clients for Botox right now?",
  groq_api_key: null,
  custom_prompt: null,
  opener_templates: null,
  working_days: "1,2,3,4,5",
};

interface SettingsContextValue {
  settings: UserSettings;
  settingsLoading: boolean;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider = ({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) => {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    const { data } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    setSettings(data ? { ...DEFAULT_SETTINGS, ...data } : DEFAULT_SETTINGS);
    setSettingsLoading(false);
  }, [userId]);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  return (
    <SettingsContext.Provider value={{ settings, settingsLoading, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
};
