import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard, Users, BarChart3, LogOut, GitBranch, ListChecks,
  ChevronsLeft, ChevronsRight, Settings, User, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeSwitcher, { applyTheme, getStoredTheme } from "./ThemeSwitcher";
import PwaInstallPrompt from "./PwaInstallPrompt";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/actions", icon: ListChecks, label: "Daily Actions" },
  { to: "/pipeline", icon: GitBranch, label: "Pipeline" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

// Only Dashboard, Daily Actions, Pipeline shown in mobile bottom nav
// Profile button is the 4th slot (custom)
const mobileMainNav = [
  { to: "/", icon: LayoutDashboard },
  { to: "/actions", icon: ListChecks },
  { to: "/pipeline", icon: GitBranch },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => { applyTheme(getStoredTheme()); }, []);

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const handleSwitchAccount = async () => {
    setProfileMenuOpen(false);
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* ─── Mobile bottom nav (PWA / phone only) ─── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/90 backdrop-blur-sm md:hidden safe-area-bottom">
        <nav className="flex items-center justify-around py-2">
          {mobileMainNav.map(({ to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )
              }
            >
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </NavLink>
          ))}

          {/* Profile button */}
          <button
            onClick={() => setProfileMenuOpen(prev => !prev)}
            className={cn(
              "flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl transition-colors",
              profileMenuOpen ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <User className="h-[22px] w-[22px]" strokeWidth={1.8} />
          </button>
        </nav>
      </div>

      {/* Profile popup menu (mobile only) */}
      {profileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setProfileMenuOpen(false)}
          />
          {/* Card */}
          <div className="fixed bottom-[68px] right-3 z-50 md:hidden rounded-2xl border border-border bg-card shadow-xl overflow-hidden min-w-[180px]">
            <div className="px-4 pt-3 pb-2 border-b border-border/50">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Account</p>
            </div>
            <div className="py-1">
              <NavLink
                to="/settings"
                onClick={() => setProfileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                Settings
              </NavLink>
              <NavLink
                to="/contacts"
                onClick={() => setProfileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <Users className="h-4 w-4 text-muted-foreground" />
                Contacts
              </NavLink>
              <NavLink
                to="/analytics"
                onClick={() => setProfileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                Analytics
              </NavLink>
            </div>
            <div className="border-t border-border/50 py-1">
              <button
                onClick={handleSwitchAccount}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                Switch account
              </button>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/5 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          </div>
        </>
      )}

      {/* ─── Desktop sidebar ─── */}
      <aside
        className={cn(
          "fixed left-0 top-0 hidden h-full border-r border-border bg-[hsl(var(--sidebar-background))] md:flex flex-col transition-all duration-200 z-40",
          collapsed ? "w-[52px]" : "w-[240px]"
        )}
      >
        {/* Workspace header */}
        <div className="flex items-center justify-between px-3 py-3 min-h-[52px]">
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-foreground text-background text-[11px] font-bold shrink-0">
                R
              </div>
              <span className="text-sm font-semibold text-foreground truncate">DM Ritual</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-[hsl(var(--sidebar-accent))] text-muted-foreground transition-colors"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 px-2 flex-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-[6px] text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-[hsl(var(--sidebar-accent))] text-foreground"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))]",
                  collapsed && "justify-center px-0"
                )
              }
              title={collapsed ? label : undefined}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="px-2 pb-3 space-y-0.5">
          <ThemeSwitcher collapsed={collapsed} />
          <button
            onClick={handleLogout}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-[6px] text-[13px] font-medium text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] transition-colors",
              collapsed && "justify-center px-0"
            )}
            title={collapsed ? "Logout" : undefined}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        className={cn(
          "flex-1 pb-20 md:pb-0 transition-all duration-200",
          collapsed ? "md:pl-[52px]" : "md:pl-[240px]"
        )}
      >
        <div className="mx-auto max-w-[1400px] px-4 pt-3 pb-4 md:px-10 md:pt-6 md:pb-6 overflow-x-hidden">{children}</div>
      </main>

      <PwaInstallPrompt />
    </div>
  );
};

export default AppLayout;
