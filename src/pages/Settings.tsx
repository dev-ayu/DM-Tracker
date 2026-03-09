import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Eye, EyeOff, RotateCcw, Pencil, ChevronUp, Plus, Trash2, ChevronDown } from "lucide-react";
import { useSettings, DEFAULT_SETTINGS, DEFAULT_PROMPT_TEMPLATE, DEFAULT_TEMPLATES, buildPromptFromTemplates, UserSettings, OpenerTemplate } from "@/contexts/SettingsContext";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type FormState = Omit<UserSettings, "groq_api_key" | "custom_prompt" | "opener_templates"> & {
  groq_api_key: string;
  custom_prompt: string;
  opener_templates: OpenerTemplate[];
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
  if (form.opener_templates.length === 0) return "Add at least one opener template";
  for (let i = 0; i < form.opener_templates.length; i++) {
    const t = form.opener_templates[i];
    if (t.text.trim().length < 5) return `Template ${i + 1}: opener text is too short (min 5 chars)`;
    if (t.text.trim().length > 200) return `Template ${i + 1}: opener text is too long (max 200 chars)`;
    if (t.condition.trim().length < 5) return `Template ${i + 1}: condition is too short (min 5 chars)`;
    if (t.condition.trim().length > 500) return `Template ${i + 1}: condition is too long (max 500 chars)`;
  }
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
    opener_templates: [...DEFAULT_TEMPLATES],
  });

  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [keyDirty, setKeyDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiEditing, setAiEditing] = useState(false);
  const [promptEditing, setPromptEditing] = useState(false);

  useEffect(() => {
    const templates: OpenerTemplate[] = (settings.opener_templates as OpenerTemplate[] | null) ?? [...DEFAULT_TEMPLATES];
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
      opener_templates: templates,
      working_days: settings.working_days ?? "1,2,3,4,5",
    });
    setHasStoredKey(!!settings.groq_api_key);
    setKeyDirty(false);
    setPromptEditing(!!settings.custom_prompt);
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
        opener_option_a: form.opener_templates[0]?.text.trim() || form.opener_option_a.trim(),
        opener_templates: form.opener_templates.map((t, i) => ({ text: t.text.trim(), condition: t.condition.trim(), order: i })),
        custom_prompt: promptEditing && form.custom_prompt.trim() ? form.custom_prompt.trim() : null,
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

  const isPromptCustomised = promptEditing && form.custom_prompt.trim() !== "";
  const autoPrompt = buildPromptFromTemplates(form.opener_templates);

  const updateTemplate = (index: number, field: "text" | "condition", value: string) => {
    setForm(prev => ({
      ...prev,
      opener_templates: prev.opener_templates.map((t, i) => i === index ? { ...t, [field]: value } : t),
    }));
  };

  const addTemplate = () => {
    if (form.opener_templates.length >= 5) return;
    setForm(prev => ({
      ...prev,
      opener_templates: [...prev.opener_templates, { text: "", condition: "", order: prev.opener_templates.length }],
    }));
  };

  const removeTemplate = (index: number) => {
    if (form.opener_templates.length <= 1) return;
    setForm(prev => ({
      ...prev,
      opener_templates: prev.opener_templates.filter((_, i) => i !== index).map((t, i) => ({ ...t, order: i })),
    }));
  };

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
                <span className="text-xs text-muted-foreground">Opener templates</span>
                <span className="text-xs">{form.opener_templates.length} template{form.opener_templates.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Prompt</span>
                {isPromptCustomised
                  ? <span className="text-[10px] rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">Custom</span>
                  : <span className="text-xs text-muted-foreground">Auto-generated</span>}
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

              {/* Opener templates */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Opener templates</label>
                  <span className="text-[10px] text-muted-foreground/60">{form.opener_templates.length}/5</span>
                </div>

                {form.opener_templates.map((template, index) => (
                  <div key={index} className="rounded-md border border-border bg-background p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-muted-foreground">Option {index + 1}</span>
                      {form.opener_templates.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTemplate(index)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground/60">Opener text</label>
                        <span className="text-[10px] text-muted-foreground/60">{template.text.length}/200</span>
                      </div>
                      <textarea
                        value={template.text}
                        onChange={e => updateTemplate(index, "text", e.target.value)}
                        maxLength={200}
                        rows={2}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder='e.g. "Are you taking on more clients atm?"'
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground/60">When to use</label>
                      <input
                        value={template.condition}
                        onChange={e => updateTemplate(index, "condition", e.target.value)}
                        maxLength={500}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder='e.g. "Use when bio mentions they own a business"'
                      />
                    </div>
                  </div>
                ))}

                {form.opener_templates.length < 5 && (
                  <button
                    type="button"
                    onClick={addTemplate}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center rounded-md border border-dashed border-border py-2"
                  >
                    <Plus className="h-3 w-3" /> Add template
                  </button>
                )}

                <p className="text-[10px] text-muted-foreground/60">
                  Use [BRACKETS] for values the AI should extract from the bio, e.g. "Still running [BUSINESS NAME]?"
                </p>
              </div>

              {/* AI Prompt — preview/edit */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">AI Prompt</label>
                    {isPromptCustomised && (
                      <span className="text-[10px] rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">Custom</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {promptEditing && (
                      <button
                        type="button"
                        onClick={() => { setPromptEditing(false); setForm(prev => ({ ...prev, custom_prompt: "" })); }}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" /> Reset
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPromptEditing(v => !v)}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {promptEditing ? <><ChevronUp className="h-3 w-3" /> Preview</> : <><Pencil className="h-3 w-3" /> Edit</>}
                    </button>
                  </div>
                </div>

                {promptEditing ? (
                  <>
                    <textarea
                      value={form.custom_prompt || autoPrompt}
                      onChange={e => setForm(prev => ({ ...prev, custom_prompt: e.target.value }))}
                      rows={12}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                      Custom edits won't auto-update when you change templates above.
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      Must include <span className="font-mono">{"{{contacts}}"}</span>.
                    </p>
                  </>
                ) : (
                  <>
                    <textarea
                      value={autoPrompt}
                      readOnly
                      rows={10}
                      className="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-xs font-mono resize-none cursor-default opacity-70"
                    />
                    <p className="text-[10px] text-muted-foreground/60">
                      Auto-generated from your templates. Click Edit to customise.
                    </p>
                  </>
                )}
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
