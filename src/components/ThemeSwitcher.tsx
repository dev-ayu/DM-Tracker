import { useState, useEffect } from "react";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";

export const THEMES = [
  { id: "snow",      label: "Snow",      dot: "bg-white border border-neutral-300" },
  { id: "moonlight", label: "Moonlight",  dot: "bg-[hsl(230,15%,15%)]" },
  { id: "rose",      label: "Rosé",      dot: "bg-[hsl(350,60%,70%)]" },
  { id: "sage",      label: "Sage",       dot: "bg-[hsl(150,30%,50%)]" },
  { id: "lavender",  label: "Lavender",   dot: "bg-[hsl(270,50%,65%)]" },
  { id: "sand",      label: "Sand",       dot: "bg-[hsl(35,40%,65%)]" },
  { id: "ocean",     label: "Ocean",      dot: "bg-[hsl(210,65%,55%)]" },
  { id: "ember",     label: "Ember",      dot: "bg-[hsl(25,85%,55%)]" },
  { id: "graphite",  label: "Graphite",   dot: "bg-[hsl(0,0%,25%)]" },
  { id: "mint",      label: "Mint",       dot: "bg-[hsl(172,55%,50%)]" },
] as const;

export type ThemeId = typeof THEMES[number]["id"];

const STORAGE_KEY = "dm-ritual-theme";

export function getStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some(t => t.id === stored)) return stored as ThemeId;
  } catch {}
  return "snow";
}

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
  try { localStorage.setItem(STORAGE_KEY, id); } catch {}
}

const ThemeSwitcher = ({ collapsed = false }: { collapsed?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ThemeId>(getStoredTheme);

  useEffect(() => {
    applyTheme(current);
  }, [current]);

  // Initialize on mount
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  const selectTheme = (id: ThemeId) => {
    setCurrent(id);
    applyTheme(id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-[6px] text-[13px] font-medium text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] transition-colors",
          collapsed && "justify-center px-0"
        )}
        title={collapsed ? "Theme" : undefined}
      >
        <Palette className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
        {!collapsed && <span>Theme</span>}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />

          {/* Popover */}
          <div
            className={cn(
              "absolute z-50 w-[200px] rounded-lg border border-border bg-popover p-1.5 shadow-lg",
              collapsed ? "left-[52px] bottom-0" : "left-0 bottom-full mb-1"
            )}
          >
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Color Theme
            </p>
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                onClick={() => selectTheme(theme.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                  current === theme.id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-popover-foreground hover:bg-accent"
                )}
              >
                <span className={cn("h-3.5 w-3.5 rounded-full shrink-0", theme.dot)} />
                <span>{theme.label}</span>
                {current === theme.id && (
                  <span className="ml-auto text-[10px] text-muted-foreground">✓</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ThemeSwitcher;
