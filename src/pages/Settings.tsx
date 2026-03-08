import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Eye, EyeOff, RotateCcw, Pencil, ChevronUp } from "lucide-react";
import { useSettings, DEFAULT_SETTINGS, DEFAULT_PROMPT_TEMPLATE, UserSettings } from "@/contexts/SettingsContext";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type FormState = Omit<UserSettings, "groq_api_key" | "custom_prompt"> & {
  groq_api_key: string;
  custom_prompt: string;
};

function validate(form: FormState): string | null {
  if (form.follow_limit < 1 || form.follow_limit > 100) return "Follow limit must be 1–100";
  if (form.dm_limit < 1 || form.dm_limit > 100) return "DM limit must be 1–100";
  if (form.followup_delay_hours < 1 || form.followup_delay_hours > 168) return "Follow-up delay must be 1–168 hours";
  if (form.flywheel_days < 7 || form.flywheel_days > 365) return "Flywheel window must be 7–365 days";
  if (form.skip_days < 1 || form.skip_days > 14) return "Skip offset must be 1–14 days";
  if (form.max_followups_a < 1 || form.max_followups_a > 10) return "Stage A cap must be 1–10";
  if (form.max_followups_b < 1 || form.max_followups_b > 20) return "Stage B cap must be 1–20";
  if (form.max_followups_c < 1 || form.max_followups_c > 20) return "Stage C cap must be 1–20";
  if (form.opener_option_a.trim().length < 5) return "Default opener text is too short (min 5 chars)";
  if (form.opener_option_a.trim().length > 200) return "Default opener text is too long (max 200 chars)";
  if (form.custom_prompt.trim() && !form.custom_prompt.includes("{{contacts}}"))
    return 'Custom prompt must include the {{contacts}} placeholder';
  const days = form.working_days.split(",").map(Number).filter(n => n >= 0 && n <= 6);
  if (days.length === 0) return "Select at least one working day";
  return null;
}

const Settings = ({ userId }: { userId: string }) => {
  const { settings, refreshSettings } = useSettings();

  const [form, setForm] = useState<FormState>({
    ...DEFAULT_SETTINGS,
    groq_api_key: "",
    custom_prompt: "",
  });

  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [keyDirty, setKeyDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiEditing, setAiEditing] = useState(false);

  useEffect(() => {
    setForm({
      follow_limit: settings.follow_limit,
      dm_limit: settings.dm_limit,
      followup_delay_hours: settings.followup_delay_hours,
      flywheel_days: settings.flywheel_days,
      skip_days: settings.skip_days,
      max_followups_a: settings.max_followups_a,
      max_followups_b: settings.max_followups_b,
      max_followups_c: settings.max_followups_c,
      opener_option_a: settings.opener_option_a,
      groq_api_key: "",
      custom_prompt: settings.custom_prompt ?? "",
      working_days: settings.working_days ?? "1,2,3,4,5",
    });
    setHasStoredKey(!!settings.groq_api_key);
    setKeyDirty(false);
  }, [settings]);

  const setNum = (field: keyof FormState, value: string) => {
    const n = parseInt(value, 10);
    setForm(prev => ({ ...prev, [field]: isNaN(n) ? 0 : n }));
  };

  const toggleDay = (dayIndex: number) => {
    const days = new Set(form.working_days.split(",").map(Number).filter(n => !isNaN(n)));
    if (days.has(dayIndex)) {
      days.delete(dayIndex);
    } else {
      days.add(dayIndex);
    }
    setForm(prev => ({ ...prev, working_days: [...days].sort((a, b) => a - b).join(",") }));
  };

  const activeDays = new Set(form.working_days.split(",").map(Number).filter(n => !isNaN(n)));

  const handleSave = async () => {
    const err = validate(form);
    if (err) { toast.error(err); return; }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        user_id: userId,
        follow_limit: form.follow_limit,
        dm_limit: form.dm_limit,
        followup_delay_hours: form.followup_delay_hours,
        flywheel_days: form.flywheel_days,
        skip_days: form.skip_days,
        max_followups_a: form.max_followups_a,
        max_followups_b: form.max_followups_b,
        max_followups_c: form.max_followups_c,
        opener_option_a: form.opener_option_a.trim(),
        custom_prompt: form.custom_prompt.trim() || null,
        working_days: form.working_days,
        updated_at: new Date().toISOString(),
      };

      if (keyDirty) {
        payload.groq_api_key = form.groq_api_key.trim() || null;
      }

      const { error } = await supabase
        .from("user_settings")
        .upsert(payload as any, { onConflict: "user_id" });

      if (error) throw error;

      toast.success("Settings saved");
      await refreshSettings();
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const isPromptCustomised = form.custom_prompt.trim() !== "";

  return (
    <div className="h-[calc(100vh-5rem)] md:h-[calc(100vh-2rem)] overflow-y-auto overflow-x-hidden scrollbar-hide pb-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold md:text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Customise your outreach behaviour</p>
      </div>

      <div className="space-y-3">

        {/* ── Daily Limits ── */}
        <section className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Daily Limits</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Follow goal</label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1} max={100} value={form.follow_limit} onChange={e => setNum("follow_limit", e.target.value)} className="h-8 text-sm" />
                <span className="text-xs text-muted-foreground shrink-0">/ day</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">DM goal</label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1} max={100} value={form.dm_limit} onChange={e => setNum("dm_limit", e.target.value)} className="h-8 text-sm" />
                <span className="text-xs text-muted-foreground shrink-0">/ day</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Working Days ── */}
        <section className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Working Days</p>
          <div className="flex gap-1.5">
            {DAY_LABELS.map((label, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleDay(i)}
                className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${
                  activeDays.has(i)
                    ? "bg-foreground text-background"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/60">App is active only on selected days. All other days show as blank.</p>
        </section>

        {/* ── Timing & Cadence ── */}
        <section className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Timing & Cadence</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Follow-up delay</label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1} max={168} value={form.followup_delay_hours} onChange={e => setNum("followup_delay_hours", e.target.value)} className="h-8 text-sm" />
                <span className="text-xs text-muted-foreground shrink-0">hrs</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Flywheel window</label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={7} max={365} value={form.flywheel_days} onChange={e => setNum("flywheel_days", e.target.value)} className="h-8 text-sm" />
                <span className="text-xs text-muted-foreground shrink-0">days</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Skip offset</label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={1} max={14} value={form.skip_days} onChange={e => setNum("skip_days", e.target.value)} className="h-8 text-sm" />
                <span className="text-xs text-muted-foreground shrink-0">days</span>
              </div>
            </div>
          </div>

          <div className="pt-1 border-t border-border space-y-2">
            <p className="text-[10px] text-muted-foreground/60">Follow-up stage caps</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Stage A</label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={1} max={10} value={form.max_followups_a} onChange={e => setNum("max_followups_a", e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Stage B</label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={1} max={20} value={form.max_followups_b} onChange={e => setNum("max_followups_b", e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Stage C</label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={1} max={20} value={form.max_followups_c} onChange={e => setNum("max_followups_c", e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── AI Configuration ── */}
        <section className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AI Configuration</p>
            <button
              type="button"
              onClick={() => setAiEditing(v => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {aiEditing ? <><ChevronUp className="h-3.5 w-3.5" /> Done</> : <><Pencil className="h-3 w-3" /> Edit</>}
            </button>
          </div>

          {/* Frozen summary */}
          {!aiEditing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">DM opener</span>
                <span className="text-xs text-right max-w-[60%] truncate">{form.opener_option_a || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Prompt</span>
                {isPromptCustomised
                  ? <span className="text-[10px] rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">Custom</span>
                  : <span className="text-xs text-muted-foreground">Default</span>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Groq API key</span>
                {hasStoredKey
                  ? <span className="text-[10px] rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 font-medium">Custom key set</span>
                  : <span className="text-xs text-muted-foreground">Server default</span>}
              </div>
            </div>
          )}

          {/* Edit mode */}
          {aiEditing && (
            <div className="space-y-4 pt-1 border-t border-border">

              {/* Default opener */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Your DM opener</label>
                  <span className="text-[10px] text-muted-foreground/60">{form.opener_option_a.length}/200</span>
                </div>
                <textarea
                  value={form.opener_option_a}
                  onChange={e => setForm(prev => ({ ...prev, opener_option_a: e.target.value }))}
                  maxLength={200}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Are you taking on more clients atm?"
                />
                <p className="text-[10px] text-muted-foreground/60">Used for most contacts. If someone's bio mentions a business they own, the AI automatically uses "Still running [their business]?" instead.</p>
              </div>

              {/* Custom prompt */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">AI Prompt</label>
                    {isPromptCustomised && (
                      <span className="text-[10px] rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">Custom</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, custom_prompt: "" }))}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" /> Reset
                  </button>
                </div>
                <textarea
                  value={form.custom_prompt || DEFAULT_PROMPT_TEMPLATE}
                  onChange={e => {
                    const val = e.target.value;
                    setForm(prev => ({ ...prev, custom_prompt: val === DEFAULT_PROMPT_TEMPLATE ? "" : val }));
                  }}
                  rows={12}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="text-[10px] text-muted-foreground/60">
                  Must include <span className="font-mono">{"{{contacts}}"}</span>. Use <span className="font-mono">{"{{option_a}}"}</span> to reference your opener above.
                </p>
              </div>

              {/* Groq API key */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Groq API key</label>
                {hasStoredKey && !keyDirty ? (
                  <div className="flex items-center gap-2">
                    <Input type="password" value="••••••••••••••••" disabled className="h-8 text-sm flex-1" />
                    <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={() => { setKeyDirty(true); setForm(prev => ({ ...prev, groq_api_key: "" })); }}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={form.groq_api_key}
                      onChange={e => setForm(prev => ({ ...prev, groq_api_key: e.target.value }))}
                      placeholder={keyDirty && hasStoredKey ? "Leave blank to remove key" : "gsk_... (optional)"}
                      className="h-8 text-sm pr-9"
                    />
                    <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60">Optional — falls back to server key if blank</p>
              </div>

            </div>
          )}
        </section>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? "Saving..." : "Save Settings"}
        </Button>

      </div>
    </div>
  );
};

export default Settings;
