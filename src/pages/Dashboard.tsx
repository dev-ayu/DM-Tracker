import { useEffect, useState, useCallback, useRef } from "react";
import { useSettings } from "@/contexts/SettingsContext";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, ChevronRight, ThumbsDown, ExternalLink, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { todayIST, futureDateIST } from "@/lib/time";
import { useNavigate } from "react-router-dom";
import { usePullRefresh } from "@/hooks/use-pull-refresh";

/* ─── Types ─── */
type FollowUpContact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  current_follow_up: string;
  last_follow_up_at: string;
  status: string;
};

type ColumnDef = {
  key: string;
  label: string;
  sublabel: string;
  color: string;
  dotColor: string;
};

const ALL_COLUMNS: ColumnDef[] = [
  { key: "A", label: "Trojan Horse", sublabel: "Stage A", color: "text-orange-600", dotColor: "bg-orange-500" },
  { key: "B", label: "VSL", sublabel: "Stage B", color: "text-amber-600", dotColor: "bg-amber-500" },
  { key: "C", label: "Calendly", sublabel: "Stage C", color: "text-blue-600", dotColor: "bg-blue-500" },
];

const COLUMN_ORDER_KEY = "dashboard-followup-col-order";

const Dashboard = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const now = new Date();
  const today = todayIST();

  // Fix #18: time-of-day greeting
  const getGreeting = () => {
    const h = now.getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  const [followCount, setFollowCount] = useState({ done: 0, total: 0 });
  const [dmCount, setDmCount] = useState({ done: 0, total: 0 });
  const [followUps, setFollowUps] = useState<FollowUpContact[]>([]);
  const [pipelineCounts, setPipelineCounts] = useState({ dmed: 0, initiated: 0, engaged: 0, calendly: 0, booked: 0 });
  const [loading, setLoading] = useState(true);

  // Column order (draggable)
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_ORDER_KEY);
      if (saved) { const p = JSON.parse(saved); if (Array.isArray(p)) return p; }
    } catch {}
    return ALL_COLUMNS.map(c => c.key);
  });

  const dragCol = useRef<string | null>(null);
  const dragOverCol = useRef<string | null>(null);

  /* ─── Pull-to-refresh hook ─── */
  const { containerRef, pullDistance, refreshing } = usePullRefresh({
    onRefresh: async () => { await fetchData(true); },
  });

  /* ─── Data fetch ─── */
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const twentyFourHoursAgo = new Date(Date.now() - settings.followup_delay_hours * 60 * 60 * 1000).toISOString();

    const [followRes, dmRes, followUpsRes, pipelineRes] = await Promise.all([
      supabase.from("daily_queues").select("id, completed").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "follow"),
      supabase.from("daily_queues").select("id, completed").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "dm"),
      supabase.from("contacts").select("id, full_name, username, profile_link, current_follow_up, last_follow_up_at, status")
        .eq("user_id", userId).not("current_follow_up", "is", null).lte("last_follow_up_at", twentyFourHoursAgo)
        .in("status", ["initiated", "engaged", "calendly_sent"]).order("last_follow_up_at"),
      supabase.from("contacts").select("id, dmed_at, initiated_at, engaged_at, calendly_sent_at, booked_at").eq("user_id", userId).not("dmed_at", "is", null),
    ]);

    const follows = followRes.data || [];
    setFollowCount({ done: follows.filter(f => f.completed).length, total: follows.length });
    const dms = dmRes.data || [];
    setDmCount({ done: dms.filter(d => d.completed).length, total: dms.length });
    setFollowUps((followUpsRes.data as FollowUpContact[]) || []);
    const pipeline = pipelineRes.data || [];
    setPipelineCounts({
      dmed:      pipeline.filter(p => p.dmed_at != null).length,
      initiated: pipeline.filter(p => p.initiated_at != null).length,
      engaged:   pipeline.filter(p => p.engaged_at != null).length,
      calendly:  pipeline.filter(p => p.calendly_sent_at != null).length,
      booked:    pipeline.filter(p => p.booked_at != null).length,
    });
    setLoading(false);
  }, [userId, today]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ─── Optimistic helper: remove contact from local list instantly ─── */
  const removeContactOptimistic = (contactId: string) => {
    setFollowUps(prev => prev.filter(c => c.id !== contactId));
  };

  /* ─── Follow-up actions — optimistic (remove card immediately, fire DB in background) ─── */
  const markFollowUpSent = async (contact: FollowUpContact) => {
    const fu = contact.current_follow_up;
    const letter = fu.slice(-1);
    const num = parseInt(fu.slice(0, -1));
    const maxA = settings.max_followups_a;
    const maxB = settings.max_followups_b;
    const maxC = settings.max_followups_c;

    removeContactOptimistic(contact.id);

    const nowIso = new Date().toISOString();
    let updateError: any = null;
    if ((letter === "A" && num >= maxA) || (letter === "B" && num >= maxB) || (letter === "C" && num >= maxC)) {
      const reason = letter === "A" ? "no_reply_1a" : letter === "B" ? "no_reply_8b" : "no_reply_8c";
      const { error } = await supabase.from("contacts").update({
        status: "flywheel", flywheel_reason: reason, negative_reply: false,
        requeue_after: futureDateIST(settings.flywheel_days), current_follow_up: null, last_follow_up_at: null,
      }).eq("id", contact.id);
      updateError = error;
    } else {
      const nextFu = `${num + 1}${letter}`;
      const { error } = await supabase.from("contacts").update({ current_follow_up: nextFu, last_follow_up_at: nowIso }).eq("id", contact.id);
      updateError = error;
    }
    if (updateError) {
      toast.error(`Update failed: ${updateError.message}`);
      setFollowUps(prev => [...prev, contact]);
      return;
    }
    toast.success(`Follow-up ${fu} sent`);
    fetchData(true);
  };

  const advanceFromFollowUp = async (contact: FollowUpContact) => {
    const letter = contact.current_follow_up.slice(-1);
    removeContactOptimistic(contact.id);

    const nowIso = new Date().toISOString();
    let updateObj: Record<string, any>;
    let successMsg: string;
    if (letter === "A") {
      updateObj = { status: "engaged", engaged_at: nowIso, current_follow_up: "1B", last_follow_up_at: nowIso };
      successMsg = "Moved to Engaged → VSL sent";
    } else if (letter === "B") {
      updateObj = { status: "calendly_sent", calendly_sent_at: nowIso, current_follow_up: "1C", last_follow_up_at: nowIso };
      successMsg = "Moved to Calendly → Link sent";
    } else {
      updateObj = { status: "booked", booked_at: nowIso, current_follow_up: null, last_follow_up_at: null };
      successMsg = "Booked!";
    }
    const { error } = await supabase.from("contacts").update(updateObj).eq("id", contact.id);
    if (error) {
      toast.error(`Update failed: ${error.message}`);
      setFollowUps(prev => [...prev, contact]);
      return;
    }
    toast.success(successMsg);
    fetchData(true);
  };

  const sendToFlywheel = async (contactId: string, reason: string) => {
    removeContactOptimistic(contactId);

    const { error } = await supabase.from("contacts").update({
      status: "flywheel", flywheel_reason: reason, negative_reply: reason === "negative",
      requeue_after: futureDateIST(settings.flywheel_days), current_follow_up: null, last_follow_up_at: null,
    }).eq("id", contactId);
    if (error) {
      toast.error(`Flywheel update failed: ${error.message}`);
      return;
    }
    toast.success(`Sent to flywheel (${settings.flywheel_days} days)`);
    fetchData(true);
  };

  /* ─── Drag reorder ─── */
  const handleDragStart = (colKey: string) => { dragCol.current = colKey; };
  const handleDragOver = (e: React.DragEvent, colKey: string) => { e.preventDefault(); dragOverCol.current = colKey; };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragCol.current || !dragOverCol.current || dragCol.current === dragOverCol.current) return;
    const newOrder = [...columnOrder];
    const from = newOrder.indexOf(dragCol.current);
    const to = newOrder.indexOf(dragOverCol.current);
    newOrder.splice(from, 1);
    newOrder.splice(to, 0, dragCol.current);
    setColumnOrder(newOrder);
    localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(newOrder));
    dragCol.current = null; dragOverCol.current = null;
  };
  const handleDragEnd = () => { dragCol.current = null; dragOverCol.current = null; };

  /* ─── Derived ─── */
  const followUpsByLetter: Record<string, FollowUpContact[]> = {
    A: followUps.filter(f => f.current_follow_up?.endsWith("A")),
    B: followUps.filter(f => f.current_follow_up?.endsWith("B")),
    C: followUps.filter(f => f.current_follow_up?.endsWith("C")),
  };
  const totalFollowUpsDue = followUps.length;

  // Only show columns that have contacts — empty ones are hidden, remaining ones expand
  const visibleColumns = columnOrder
    .map(key => ALL_COLUMNS.find(c => c.key === key)!)
    .filter(col => (followUpsByLetter[col.key] || []).length > 0);


  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  /* ─── Pull-to-refresh (mobile) ─── */
  const PullIndicator = () => (
    <div
      className="flex items-center justify-center transition-all duration-200 overflow-hidden pointer-events-none"
      style={{ height: pullDistance > 0 || refreshing ? `${Math.max(pullDistance, refreshing ? 40 : 0)}px` : "0px" }}
    >
      <RefreshCw
        className={`h-5 w-5 text-muted-foreground transition-transform ${refreshing ? "animate-spin" : ""}`}
        style={{ transform: `rotate(${pullDistance * 3}deg)`, opacity: Math.min(pullDistance / 60, 1) }}
      />
    </div>
  );

  return (
    <div ref={containerRef} className="space-y-5 pull-to-refresh md:space-y-6">
      <PullIndicator />
      {/* ── Header ── */}
      <div className="space-y-4 md:space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-xl md:font-semibold">{getGreeting()}</h1>
          <p className="text-sm text-muted-foreground mt-1 md:text-xs md:mt-0.5">{format(now, "EEEE, MMMM d")}</p>
        </div>

        {/* Stat row — compact, only metrics with values */}
        <div className="flex flex-wrap gap-2.5 md:gap-1.5">
          {pipelineCounts.dmed > 0 && (
            <button onClick={() => navigate("/pipeline")} className="rounded-2xl bg-muted/50 hover:bg-muted/70 px-4 py-2.5 text-left transition-colors md:rounded-md md:border md:border-border md:bg-card md:px-3 md:py-1.5 md:hover:bg-accent/40">
              <span className="text-base font-bold md:text-sm md:font-semibold">{pipelineCounts.dmed}</span>
              <span className="text-xs text-muted-foreground ml-1.5">dm'd</span>
            </button>
          )}
          {pipelineCounts.initiated > 0 && (
            <button onClick={() => navigate("/pipeline")} className="rounded-2xl bg-muted/50 hover:bg-muted/70 px-4 py-2.5 text-left transition-colors md:rounded-md md:border md:border-border md:bg-card md:px-3 md:py-1.5 md:hover:bg-accent/40">
              <span className="text-base font-bold md:text-sm md:font-semibold">{pipelineCounts.initiated}</span>
              <span className="text-xs text-muted-foreground ml-1.5">replied</span>
            </button>
          )}
          {pipelineCounts.engaged > 0 && (
            <button onClick={() => navigate("/pipeline")} className="rounded-2xl bg-muted/50 hover:bg-muted/70 px-4 py-2.5 text-left transition-colors md:rounded-md md:border md:border-border md:bg-card md:px-3 md:py-1.5 md:hover:bg-accent/40">
              <span className="text-base font-bold md:text-sm md:font-semibold">{pipelineCounts.engaged}</span>
              <span className="text-xs text-muted-foreground ml-1.5">engaged</span>
            </button>
          )}
          {pipelineCounts.calendly > 0 && (
            <button onClick={() => navigate("/pipeline")} className="rounded-2xl bg-muted/50 hover:bg-muted/70 px-4 py-2.5 text-left transition-colors md:rounded-md md:border md:border-border md:bg-card md:px-3 md:py-1.5 md:hover:bg-accent/40">
              <span className="text-base font-bold md:text-sm md:font-semibold">{pipelineCounts.calendly}</span>
              <span className="text-xs text-muted-foreground ml-1.5">calendly</span>
            </button>
          )}
          {pipelineCounts.booked > 0 && (
            <button onClick={() => navigate("/pipeline")} className="rounded-2xl bg-muted/50 hover:bg-muted/70 px-4 py-2.5 text-left transition-colors md:rounded-md md:border md:border-border md:bg-card md:px-3 md:py-1.5 md:hover:bg-accent/40">
              <span className="text-base font-bold md:text-sm md:font-semibold">{pipelineCounts.booked}</span>
              <span className="text-xs text-muted-foreground ml-1.5">booked</span>
            </button>
          )}
          {followCount.total > 0 && (
            <button onClick={() => navigate("/actions")} className="rounded-2xl bg-muted/50 hover:bg-muted/70 px-4 py-2.5 text-left transition-colors md:rounded-md md:border md:border-border md:bg-card md:px-3 md:py-1.5 md:hover:bg-accent/40">
              <span className="text-base font-bold md:text-sm md:font-semibold">{followCount.done}/{followCount.total}</span>
              <span className="text-xs text-muted-foreground ml-1.5">follows</span>
            </button>
          )}
          {dmCount.total > 0 && (
            <button onClick={() => navigate("/actions")} className="rounded-2xl bg-muted/50 hover:bg-muted/70 px-4 py-2.5 text-left transition-colors md:rounded-md md:border md:border-border md:bg-card md:px-3 md:py-1.5 md:hover:bg-accent/40">
              <span className="text-base font-bold md:text-sm md:font-semibold">{dmCount.done}/{dmCount.total}</span>
              <span className="text-xs text-muted-foreground ml-1.5">dms today</span>
            </button>
          )}
          {totalFollowUpsDue > 0 && (
            <button onClick={() => navigate("/actions")} className="rounded-2xl bg-muted/50 hover:bg-muted/70 px-4 py-2.5 text-left transition-colors md:rounded-md md:border md:border-border md:bg-card md:px-3 md:py-1.5 md:hover:bg-accent/40">
              <span className="text-base font-bold md:text-sm md:font-semibold">{totalFollowUpsDue}</span>
              <span className="text-xs text-muted-foreground ml-1.5">due</span>
            </button>
          )}
        </div>
      </div>


      {/* ════════════════════════════════════════════════════════
          FOLLOW-UPS BOARD — takes up the full remaining space
          Only columns with contacts are shown; they expand to fill
         ════════════════════════════════════════════════════════ */}
      {totalFollowUpsDue > 0 && (
        <div>
          <div className="flex items-center justify-between mb-5 md:mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Follow-ups — {totalFollowUpsDue} due
            </h2>
            {visibleColumns.length > 1 && (
              <span className="text-[10px] text-muted-foreground/60">drag to reorder</span>
            )}
          </div>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 md:gap-3">
            {visibleColumns.map((col) => {
              const items = followUpsByLetter[col.key] || [];
              return (
                <div
                  key={col.key}
                  draggable={visibleColumns.length > 1}
                  onDragStart={() => handleDragStart(col.key)}
                  onDragOver={e => handleDragOver(e, col.key)}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  className="group/col rounded-2xl bg-muted/30 flex flex-col transition-shadow md:rounded-lg md:border md:border-border md:bg-muted/20"
                >
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border cursor-grab active:cursor-grabbing select-none">
                    {visibleColumns.length > 1 && (
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 opacity-0 group-hover/col:opacity-100 transition-opacity" />
                    )}
                    <span className={`h-2.5 w-2.5 rounded-full ${col.dotColor}`} />
                    <span className={`text-sm font-semibold ${col.color}`}>{col.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground font-medium">{items.length}</span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[calc(100vh-320px)] scrollbar-thin">
                    {items.map((contact) => (
                      <div key={contact.id} className="rounded-2xl bg-muted/50 p-3 notion-hover group/card transition-all md:rounded-lg md:border md:border-border md:bg-card">
                        <div className="flex items-start gap-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-tight truncate">{contact.full_name}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              {contact.username && <span className="text-xs text-muted-foreground">@{contact.username}</span>}
                              <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-muted-foreground">{contact.current_follow_up}</span>
                            </div>
                          </div>
                          <a href={contact.profile_link} target="_blank" rel="noopener noreferrer"
                            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover/card:opacity-100">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                        {/* Actions */}
                        <div className="flex gap-1.5 mt-3 pt-2.5 border-t border-border">
                          <button
                            onClick={() => advanceFromFollowUp(contact)}
                            className="flex-1 rounded-md bg-foreground/5 px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-foreground/10 active:scale-[0.97] transition-all"
                          >
                            Replied ✓
                          </button>
                          <button
                            onClick={() => markFollowUpSent(contact)}
                            className="flex-1 rounded-md bg-muted px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground active:scale-[0.97] transition-all"
                          >
                            Sent
                          </button>
                          <button
                            onClick={() => sendToFlywheel(contact.id, "negative")}
                            className="rounded-md bg-muted px-2 py-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:scale-[0.97] transition-all"
                            title="Negative → flywheel"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All caught up */}
      {totalFollowUpsDue === 0 && (
        <div className="py-16 text-center md:rounded-lg md:border md:border-dashed md:border-border md:py-12">
          <p className="text-sm text-muted-foreground/60 md:text-muted-foreground">No follow-ups due right now — you're all caught up ✓</p>
        </div>
      )}

      {/* Flywheel — managed on Analytics page */}
    </div>
  );
};

export default Dashboard;
