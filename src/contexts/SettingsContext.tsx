import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  working_days: string;
}

export const DEFAULT_PROMPT_TEMPLATE = `You are a sales outreach assistant. For each contact below, pick the BEST opener from these two options ONLY:

Option A: "{{option_a}}"
Option B: "Still running [BUSINESS NAME]?" (use this ONLY if their bio clearly mentions a business, brand, company, or clinic they own/founded - extract the actual business name)

Rules:
- If the bio mentions they are a founder, owner, CEO, or co-founder of a specific business/brand, use Option B with that business name
- Otherwise, always default to Option A ("{{option_a}}")
- Return ONLY the opener text, nothing else
- One line per contact

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
  opener_option_a: "Are you taking on more clients atm?",
  groq_api_key: null,
  custom_prompt: null,
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
