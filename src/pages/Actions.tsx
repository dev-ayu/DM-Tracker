import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSettings } from "@/contexts/SettingsContext";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Zap, X, ThumbsDown, Clock, ChevronRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { format, subDays, addDays } from "date-fns";
import { todayIST, getDayIST, todayISTMidnight, futureDateIST } from "@/lib/time";

type Contact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  biography: string | null;
  dm_skip_count?: number;
};

type QueueItem = {
  id: string;
  contact_id: string;
  completed: boolean;
  queue_type: string;
  contacts: Contact;
};

type Opener = {
  contact_id: string;
  opener_text: string;
};

type FollowUpContact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  current_follow_up: string;
  last_follow_up_at: string;
  status: string;
};

/** Skip = +N calendar days. If that lands on a non-working day, bump forward. */
const getSkipDate = (d: Date, skipDays: number, workingDays: Set<number>): string => {
  let target = addDays(d, skipDays);
  for (let i = 0; i < 7; i++) {
    if (workingDays.has(getDayIST(target))) return target.toISOString().slice(0, 10);
    target = addDays(target, 1);
  }
  return target.toISOString().slice(0, 10);
};

const getPreviousWorkingDay = (d: Date, workingDays: Set<number>): string => {
  let target = subDays(d, 1);
  for (let i = 0; i < 7; i++) {
    if (workingDays.has(getDayIST(target))) return target.toISOString().slice(0, 10);
    target = subDays(target, 1);
  }
  return subDays(d, 1).toISOString().slice(0, 10);
};

const Actions = ({ userId }: { userId: string }) => {
  const { settings } = useSettings();
  const FOLLOW_LIMIT = settings.follow_limit;
  const DM_LIMIT = settings.dm_limit;
  const [followQueue, setFollowQueue] = useState<QueueItem[]>([]);
  const [dmQueue, setDmQueue] = useState<QueueItem[]>([]);
  const [openers, setOpeners] = useState<Record<string, string>>({});
  const [followUps, setFollowUps] = useState<FollowUpContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"follow" | "dm">("follow");
  const [autoQueueLoading, setAutoQueueLoading] = useState(false); // Fix #17: state instead of ref
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = "actions-scroll-pos";

  const now = new Date();
  const today = todayIST();
  const workingDays = new Set((settings.working_days || "1,2,3,4,5").split(",").map(Number));
  const isWeekdayToday = workingDays.has(getDayIST(now));

  const saveScroll = () => {
    if (scrollRef.current) sessionStorage.setItem(scrollKey, String(scrollRef.current.scrollTop));
  };
  const restoreScroll = () => {
    const saved = sessionStorage.getItem(scrollKey);
    if (saved && scrollRef.current) scrollRef.current.scrollTop = parseInt(saved, 10);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const twentyFourHoursAgo = new Date(Date.now() - settings.followup_delay_hours * 60 * 60 * 1000).toISOString();

    const [followRes, dmRes, openersRes, followUpsRes] = await Promise.all([
      supabase
        .from("daily_queues")
        .select("id, contact_id, completed, queue_type, contacts(id, full_name, username, profile_link, biography)")
        .eq("user_id", userId).eq("queue_date", today).eq("queue_type", "follow").order("created_at"),
      supabase
        .from("daily_queues")
        .select("id, contact_id, completed, queue_type, contacts(id, full_name, username, profile_link, biography, dm_skip_count)")
        .eq("user_id", userId).eq("queue_date", today).eq("queue_type", "dm").order("created_at"),
      supabase.from("openers").select("contact_id, opener_text").eq("user_id", userId),
      supabase
        .from("contacts")
        .select("id, full_name, username, profile_link, current_follow_up, last_follow_up_at, status")
        .eq("user_id", userId)
        .not("current_follow_up", "is", null)
        .lte("last_follow_up_at", twentyFourHoursAgo)
        .in("status", ["initiated", "engaged", "calendly_sent"])
        .order("last_follow_up_at"),
    ]);

    const dmData = ((dmRes.data || []) as unknown as QueueItem[]);
    setFollowQueue((followRes.data as any) || []);
    setDmQueue(dmData);
    const openerMap: Record<string, string> = {};
    (openersRes.data || []).forEach((o: Opener) => { openerMap[o.contact_id] = o.opener_text; });
    setOpeners(openerMap);
    setFollowUps((followUpsRes.data as FollowUpContact[]) || []);

    // Reconcile: fix any completed DM queue items whose contacts aren't marked 'dmed'
    const completedDmIds = dmData.filter(q => q.completed).map(q => q.contact_id);
    if (completedDmIds.length > 0) {
      const { data: dmedContacts } = await supabase
        .from("contacts")
        .select("id, status")
        .in("id", completedDmIds)
        .neq("status", "dmed");
      const needsFix = (dmedContacts || []).filter(c => c.status === "followed" || c.status === "not_started");
      for (const c of needsFix) {
        await supabase.from("contacts").update({ status: "dmed", dmed_at: new Date().toISOString() }).eq("id", c.id);
      }
    }

    // Purge ghost entries: delete any uncompleted DM queue entries (today + future) for contacts already DMed (any downstream status)
    const uncompletedDmIds = dmData.filter(q => !q.completed).map(q => q.contact_id);
    if (uncompletedDmIds.length > 0) {
      const { data: ghostDmed } = await supabase
        .from("contacts").select("id").in("id", uncompletedDmIds).in("status", ["dmed", "initiated", "engaged", "calendly_sent", "booked", "flywheel"]);
      const ghostIds = (ghostDmed || []).map(c => c.id);
      if (ghostIds.length > 0) {
        // Remove these ghost entries from today's queue
        const ghostQueueIds = dmData.filter(q => !q.completed && ghostIds.includes(q.contact_id)).map(q => q.id);
        if (ghostQueueIds.length > 0) {
          await supabase.from("daily_queues").delete().in("id", ghostQueueIds);
        }
        // Also purge any future ghost entries for these contacts
        await supabase.from("daily_queues").delete().eq("user_id", userId).eq("queue_type", "dm").eq("completed", false).gt("queue_date", today).in("contact_id", ghostIds);
        // Remove from local state
        const ghostSet = new Set(ghostIds);
        const cleanedDms = dmData.filter(q => q.completed || !ghostSet.has(q.contact_id));
        setDmQueue(cleanedDms);
      }
    }

    setLoading(false);
    requestAnimationFrame(() => restoreScroll());
  }, [userId, today]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") saveScroll();
      else if (document.visibilityState === "visible") fetchData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchData]);

  const sortedFollowQueue = useMemo(() => [...followQueue].sort((a, b) => Number(a.completed) - Number(b.completed)), [followQueue]);
  const sortedDmQueue = useMemo(() => [...dmQueue].sort((a, b) => Number(a.completed) - Number(b.completed)), [dmQueue]);

  const toggleComplete = async (queueId: string, completed: boolean, queueType: string, contactId: string) => {
    if (!isWeekdayToday) return;
    saveScroll();
    const nowIso = new Date().toISOString();

    // Optimistic update
    if (queueType === "follow") {
      setFollowQueue(prev => prev.map(item => item.id === queueId ? { ...item, completed: !completed } : item));
    } else {
      setDmQueue(prev => prev.map(item => item.id === queueId ? { ...item, completed: !completed } : item));
    }

    const { error: queueErr } = await supabase.from("daily_queues").update({ completed: !completed, completed_at: !completed ? nowIso : null }).eq("id", queueId);
    if (queueErr) {
      toast.error(`Queue update failed: ${queueErr.message}`);
      // Rollback optimistic update
      if (queueType === "follow") {
        setFollowQueue(prev => prev.map(item => item.id === queueId ? { ...item, completed } : item));
      } else {
        setDmQueue(prev => prev.map(item => item.id === queueId ? { ...item, completed } : item));
      }
      return;
    }

    // Fix #4: fetch current status before writing to avoid downgrading contacts
    if (!completed) {
      if (queueType === "follow") {
        const { data: c } = await supabase.from("contacts").select("status").eq("id", contactId).single();
        if (!c || c.status === "not_started") {
          const { error: contactErr } = await supabase.from("contacts").update({ status: "followed", followed_at: nowIso }).eq("id", contactId);
          if (contactErr) toast.error(`Contact update failed: ${contactErr.message}`);
        }
      } else {
        const { data: c } = await supabase.from("contacts").select("status").eq("id", contactId).single();
        if (!c || c.status === "followed") {
          const { error: contactErr } = await supabase.from("contacts").update({ status: "dmed", dmed_at: nowIso, dm_skip_count: 0 }).eq("id", contactId);
          if (contactErr) toast.error(`Contact update failed: ${contactErr.message}`);
        }
        // If contact has progressed past "followed", do NOT change their status
      }
    } else {
      // Unchecking: only revert if contact hasn't progressed past the expected stage
      const { data: currentContact } = await supabase.from("contacts").select("status").eq("id", contactId).single();
      const currentStatus = currentContact?.status;
      if (queueType === "follow" && currentStatus === "followed") {
        await supabase.from("contacts").update({ status: "not_started", followed_at: null }).eq("id", contactId);
      } else if (queueType === "dm" && currentStatus === "dmed") {
        await supabase.from("contacts").update({ status: "followed", dmed_at: null }).eq("id", contactId);
      }
      // If contact has progressed (initiated, engaged, etc.), do NOT revert their status
    }
    fetchData();
  };

  const handleProfileClick = (item: QueueItem) => {
    if (!isWeekdayToday) return;
    if (!item.completed) toggleComplete(item.id, item.completed, item.queue_type, item.contact_id);
  };

  const skipDm = async (queueId: string, contactId: string, currentSkipCount: number) => {
    if (!isWeekdayToday) return;
    saveScroll();
    // Optimistic removal
    setDmQueue(prev => prev.filter(item => item.id !== queueId));
    const skipDate = getSkipDate(now, settings.skip_days, workingDays);
    try {
      const { error: delErr } = await supabase.from("daily_queues").delete().eq("id", queueId);
      if (delErr) throw delErr;
      await supabase.from("daily_queues").delete().eq("user_id", userId).eq("contact_id", contactId).eq("queue_date", skipDate).eq("queue_type", "dm");
      const { error: insErr } = await supabase.from("daily_queues").insert({ user_id: userId, contact_id: contactId, queue_date: skipDate, queue_type: "dm" as const });
      if (insErr) throw insErr;
      const { error: updErr } = await supabase.from("contacts").update({ dm_skip_count: currentSkipCount + 1 } as any).eq("id", contactId);
      if (updErr) throw updErr;
      toast.success(`Skipped → ${skipDate}`);
    } catch (err: any) {
      toast.error(err.message || "Skip failed");
      fetchData();
    }
  };

  const removeFromQueue = async (queueId: string, contactId: string, queueType: string) => {
    if (!isWeekdayToday) return;
    const confirmed = window.confirm("Remove this contact from the queue and delete them permanently?");
    if (!confirmed) return;
    saveScroll();

    // Optimistic removal
    if (queueType === "follow") {
      setFollowQueue(prev => prev.filter(item => item.id !== queueId));
    } else {
      setDmQueue(prev => prev.filter(item => item.id !== queueId));
    }

    const { error: opErr } = await supabase.from("openers").delete().eq("contact_id", contactId);
    if (opErr) { toast.error(`Remove failed: ${opErr.message}`); fetchData(); return; }
    const { error: qDelErr } = await supabase.from("daily_queues").delete().eq("contact_id", contactId);
    if (qDelErr) { toast.error(`Remove failed: ${qDelErr.message}`); fetchData(); return; }
    const { error: cDelErr } = await supabase.from("contacts").delete().eq("id", contactId);
    if (cDelErr) { toast.error(`Remove failed: ${cDelErr.message}`); fetchData(); return; }

    if (queueType === "follow") {
      // Fix #13: check current queue size before backfilling
      const { data: currentQueue } = await supabase
        .from("daily_queues").select("contact_id").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "follow");
      const existingIds = new Set((currentQueue || []).map(q => q.contact_id));
      existingIds.add(contactId);
      const currentQueueSize = (currentQueue || []).length; // already reflects deletion
      if (currentQueueSize < FOLLOW_LIMIT) {
        const { data: replacement } = await supabase.from("contacts").select("id").eq("user_id", userId).eq("status", "not_started").limit(50);
        const available = (replacement || []).filter(c => !existingIds.has(c.id));
        if (available.length > 0) {
          await supabase.from("daily_queues").insert({ user_id: userId, contact_id: available[0].id, queue_date: today, queue_type: "follow" });
        }
      }
    }
    toast.success("Removed & replaced");
    fetchData();
  };

  /** Delete a Fresh DM contact and backfill with a replacement */
  const removeFromDmQueueWithBackfill = async (queueId: string, contactId: string, contactName: string) => {
    if (!isWeekdayToday) return;
    if (!window.confirm(`Remove "${contactName}" and replace?`)) return;
    saveScroll();
    setDmQueue(prev => prev.filter(item => item.id !== queueId));
    await supabase.from("openers").delete().eq("contact_id", contactId);
    await supabase.from("daily_queues").delete().eq("contact_id", contactId);
    // Only delete contact if they haven't been DMed yet — preserve metrics
    const { data: contactData } = await supabase.from("contacts").select("status, dmed_at").eq("id", contactId).single();
    const dmedStatuses = ["dmed", "initiated", "engaged", "calendly_sent", "booked"];
    if (!contactData || (!dmedStatuses.includes(contactData.status) && !contactData.dmed_at)) {
      await supabase.from("contacts").delete().eq("id", contactId);
    }
    // Backfill: find a followed contact not already in today's DM queue
    const { data: currentQueue } = await supabase
      .from("daily_queues").select("contact_id").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "dm");
    const existingIds = new Set((currentQueue || []).map(q => q.contact_id));
    existingIds.add(contactId);
    const { data: candidates } = await supabase
      .from("contacts").select("id").eq("user_id", userId).eq("status", "followed").lt("followed_at", todayISTMidnight()).is("dmed_at", null).or("dm_skip_count.eq.0,dm_skip_count.is.null").limit(50);
    const available = (candidates || []).filter(c => !existingIds.has(c.id));
    if (available.length > 0) {
      const newContactId = available[0].id;
      await supabase.from("daily_queues").insert({ user_id: userId, contact_id: newContactId, queue_date: today, queue_type: "dm" as const });
      // Auto-generate opener for the replacement contact
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await fetch("/api/generate-openers", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
          body: JSON.stringify({ userId }),
        });
      } catch (_) {}
    }
    toast.success("Removed & replaced");
    fetchData();
  };

  /** Delete a Skipped/Private DM contact permanently — no replacement */
  const removeFromDmQueue = async (queueId: string, contactId: string, contactName: string) => {
    if (!isWeekdayToday) return;
    if (!window.confirm(`Delete "${contactName}" permanently?`)) return;
    saveScroll();
    setDmQueue(prev => prev.filter(item => item.id !== queueId));
    const { error: opErr } = await supabase.from("openers").delete().eq("contact_id", contactId);
    if (opErr) { toast.error(`Remove failed: ${opErr.message}`); fetchData(); return; }
    const { error: qDelErr } = await supabase.from("daily_queues").delete().eq("contact_id", contactId);
    if (qDelErr) { toast.error(`Remove failed: ${qDelErr.message}`); fetchData(); return; }
    // Only delete contact if they haven't been DMed yet — preserve metrics
    const { data: contactData } = await supabase.from("contacts").select("status, dmed_at").eq("id", contactId).single();
    const dmedStatuses = ["dmed", "initiated", "engaged", "calendly_sent", "booked"];
    if (!contactData || (!dmedStatuses.includes(contactData.status) && !contactData.dmed_at)) {
      const { error: cDelErr } = await supabase.from("contacts").delete().eq("id", contactId);
      if (cDelErr) { toast.error(`Delete failed: ${cDelErr.message}`); fetchData(); return; }
      toast.success("Contact deleted");
    } else {
      toast.success("Removed from queue (contact preserved for metrics)");
    }
  };

  const autoQueue = async () => {
    if (!isWeekdayToday || autoQueueLoading) return;
    setAutoQueueLoading(true);
    try { await _autoQueueImpl(); } finally { setAutoQueueLoading(false); }
  };

  const _autoQueueImpl = async () => {

    const { data: existing } = await supabase
      .from("daily_queues").select("id, contact_id").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "follow");
    const existingCount = existing?.length || 0;

    if (existingCount > FOLLOW_LIMIT) {
      const excess = existing!.slice(FOLLOW_LIMIT);
      await supabase.from("daily_queues").delete().in("id", excess.map(e => e.id));
      toast.info(`Trimmed queue to ${FOLLOW_LIMIT}`);
    } else if (existingCount < FOLLOW_LIMIT) {
      const needed = FOLLOW_LIMIT - existingCount;
      const existingIds = new Set((existing || []).map(q => q.contact_id));
      const { data: unfollowed } = await supabase.from("contacts").select("id").eq("user_id", userId).eq("status", "not_started").limit(needed + 20);
      const available = (unfollowed || []).filter(c => !existingIds.has(c.id)).slice(0, needed);
      if (available.length > 0) {
        await supabase.from("daily_queues").insert(available.map(c => ({ user_id: userId, contact_id: c.id, queue_date: today, queue_type: "follow" as const })));
        toast.success(`Added ${available.length} to follow queue`);
      } else {
        toast.info("No more unfollowed contacts available.");
      }
    } else {
      toast.info(`Already have ${FOLLOW_LIMIT} in today's follow queue.`);
    }

    const { data: unsentDms } = await supabase
      .from("daily_queues").select("contact_id, queue_date").eq("user_id", userId).eq("queue_type", "dm").eq("completed", false).lt("queue_date", today).order("queue_date", { ascending: true });
    const prevWeekday = getPreviousWorkingDay(now, workingDays);
    const { data: yesterdayFollowed } = await supabase
      .from("daily_queues").select("contact_id").eq("user_id", userId).eq("queue_date", prevWeekday).eq("queue_type", "follow").eq("completed", true);
    const { data: existingDms } = await supabase
      .from("daily_queues").select("contact_id").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "dm");

    const existingDmIds = new Set((existingDms || []).map(q => q.contact_id));

    // Only count fresh (non-skipped) DMs toward the 30 cap
    const existingDmContactIds = (existingDms || []).map(q => q.contact_id);
    const { data: existingDmContacts } = await supabase
      .from("contacts").select("id, dm_skip_count").in("id", existingDmContactIds.length > 0 ? existingDmContactIds : ["__none__"]);
    const freshDmCount = (existingDmContacts || []).filter(c => (c.dm_skip_count || 0) === 0).length;

    const DOWNSTREAM = ["dmed", "initiated", "engaged", "calendly_sent", "booked", "flywheel"];
    const rawCarryoverIds = [...new Set((unsentDms || []).map(d => d.contact_id))].filter(id => !existingDmIds.has(id));
    // Filter out contacts already at any downstream status from carryovers
    let carryoverExcludeIds = new Set<string>();
    if (rawCarryoverIds.length > 0) {
      const { data: carryExclude } = await supabase
        .from("contacts").select("id").in("id", rawCarryoverIds).in("status", DOWNSTREAM);
      carryoverExcludeIds = new Set((carryExclude || []).map(c => c.id));
    }
    const carryoverContactIds = rawCarryoverIds.filter(id => !carryoverExcludeIds.has(id));

    // Filter out contacts no longer in "followed" status (already DMed, advanced, or deleted)
    const yesterdayIds = (yesterdayFollowed || []).map(f => f.contact_id);
    let validFollowedIds = new Set<string>();
    if (yesterdayIds.length > 0) {
      const { data: stillFollowed } = await supabase
        .from("contacts").select("id").in("id", yesterdayIds).eq("status", "followed");
      validFollowedIds = new Set((stillFollowed || []).map(c => c.id));
    }
    const newFollowContactIds = yesterdayIds.filter(id => validFollowedIds.has(id) && !existingDmIds.has(id) && !carryoverContactIds.includes(id));
    // Fresh 30-cap is independent of carryovers — skipped DMs don't steal fresh slots
    const freshNewFollows = newFollowContactIds.slice(0, DM_LIMIT - freshDmCount);
    const allNewDmContactIds = [...carryoverContactIds, ...freshNewFollows];

    if (allNewDmContactIds.length > 0) {
      await supabase.from("daily_queues").insert(allNewDmContactIds.map(contactId => ({ user_id: userId, contact_id: contactId, queue_date: today, queue_type: "dm" as const })));
    }

    if (unsentDms && unsentDms.length > 0) {
      const carriedOverIds = carryoverContactIds.slice(0, allNewDmContactIds.length);
      if (carriedOverIds.length > 0) {
        await supabase.from("daily_queues").delete().eq("user_id", userId).eq("queue_type", "dm").eq("completed", false).lt("queue_date", today).in("contact_id", carriedOverIds);
      }
    }

    // Auto-generate openers for all new DM contacts
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch("/api/generate-openers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ userId }),
      });
    } catch (_) {}

    fetchData();
  };

  const generateOpeners = async () => {
    if (!isWeekdayToday) return;
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/generate-openers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate openers");
      toast.success(data?.message || "Openers generated!");
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate openers");
    } finally {
      setGenerating(false);
    }
  };

  const copyOpener = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copied!"); };

  const markFollowUpSent = async (contact: FollowUpContact) => {
    setFollowUps(prev => prev.filter(f => f.id !== contact.id));

    const nowIso = new Date().toISOString();
    const fu = contact.current_follow_up;
    const letter = fu.slice(-1);
    const num = parseInt(fu.slice(0, -1));

    const maxA = settings.max_followups_a;
    const maxB = settings.max_followups_b;
    const maxC = settings.max_followups_c;

    if (letter === "A" && num >= maxA) {
      await sendToFlywheel(contact.id, "no_reply_1a");
    } else if (letter === "B" && num >= maxB) {
      await sendToFlywheel(contact.id, "no_reply_8b");
    } else if (letter === "C" && num >= maxC) {
      await sendToFlywheel(contact.id, "no_reply_8c");
    } else {
      const nextNum = num + 1;
      const nextFu = `${nextNum}${letter}`;
      const { error } = await supabase.from("contacts").update({
        current_follow_up: nextFu,
        last_follow_up_at: nowIso,
      }).eq("id", contact.id);
      if (error) {
        toast.error(`Follow-up update failed: ${error.message}`);
        setFollowUps(prev => [...prev, contact]);
        return;
      }
    }

    toast.success(`Follow-up ${fu} sent`);
    fetchData();
  };

  const advanceFromFollowUp = async (contact: FollowUpContact) => {
    setFollowUps(prev => prev.filter(f => f.id !== contact.id));

    const nowIso = new Date().toISOString();
    const letter = contact.current_follow_up.slice(-1);

    let updateObj: Record<string, any>;
    let successMsg: string;
    if (letter === "A") {
      updateObj = { status: "engaged", engaged_at: nowIso, current_follow_up: "1B", last_follow_up_at: nowIso };
      successMsg = "Moved to Engaged";
    } else if (letter === "B") {
      updateObj = { status: "calendly_sent", calendly_sent_at: nowIso, current_follow_up: "1C", last_follow_up_at: nowIso };
      successMsg = "Moved to Calendly";
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
    fetchData();
  };

  const sendToFlywheel = async (contactId: string, reason: string) => {
    const { error } = await supabase.from("contacts").update({
      status: "flywheel",
      flywheel_reason: reason,
      negative_reply: reason === "negative",
      requeue_after: futureDateIST(settings.flywheel_days),
      current_follow_up: null,
      last_follow_up_at: null,
    }).eq("id", contactId);
    if (error) { toast.error(`Flywheel update failed: ${error.message}`); return; }
    toast.success(`Sent to flywheel (${settings.flywheel_days} days)`);
    fetchData();
  };

  const negativeReply = async (contactId: string) => {
    setFollowUps(prev => prev.filter(f => f.id !== contactId));
    await sendToFlywheel(contactId, "negative");
  };

  const followCompleted = followQueue.filter(q => q.completed).length;
  const dmCompleted = dmQueue.filter(q => q.completed).length;
  const dmTotal = dmQueue.length;
  const freshDms = sortedDmQueue.filter(item => (item.contacts?.dm_skip_count || 0) === 0);
  const skippedDms = sortedDmQueue.filter(item => (item.contacts?.dm_skip_count || 0) > 0);

  const followUpsA = followUps.filter(f => f.current_follow_up?.endsWith("A"));
  const followUpsB = followUps.filter(f => f.current_follow_up?.endsWith("B"));
  const followUpsC = followUps.filter(f => f.current_follow_up?.endsWith("C"));

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>;
  }

  return (
    <div
      ref={scrollRef}
      className="h-[calc(100dvh-5rem)] md:h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden scrollbar-hide pb-4"
      onScroll={saveScroll}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5 md:mb-5">
        <div>
          <h1 className="text-2xl font-bold">Daily Actions</h1>
          <p className="text-sm text-muted-foreground">{format(now, "EEEE, MMM d")}</p>
        </div>
        <div className="flex gap-2">
          {followQueue.length === 0 && (
            <Button variant="outline" size="sm" onClick={autoQueue} disabled={autoQueueLoading}>
              {autoQueueLoading ? "Loading..." : "Load Queue"}
            </Button>
          )}
          <Button size="sm" onClick={generateOpeners} disabled={generating}>
            <Zap className="mr-1 h-3.5 w-3.5" />
            <span className="hidden sm:inline">{generating ? "..." : "Openers"}</span>
          </Button>
        </div>
      </div>

      {/* Section header with toggle */}
      <div className="flex items-center justify-between mb-3 md:mb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 md:text-sm md:tracking-wider md:text-muted-foreground">
          {activeTab === "follow"
            ? `Follow (${followCompleted}/${FOLLOW_LIMIT})`
            : `DM (${dmCompleted}/${freshDms.length})${skippedDms.length > 0 ? ` · Skipped ${skippedDms.length}` : ""}`}
        </h2>
        <div className="inline-flex items-center rounded-full border border-border p-0.5">
          <button
            onClick={() => setActiveTab("follow")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              activeTab === "follow"
                ? "bg-foreground text-background"
                : "text-muted-foreground"
            }`}
          >
            Follow
          </button>
          <button
            onClick={() => setActiveTab("dm")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              activeTab === "dm"
                ? "bg-foreground text-background"
                : "text-muted-foreground"
            }`}
          >
            DM
          </button>
        </div>
      </div>

      <Progress
        value={activeTab === "follow" ? (followCompleted / FOLLOW_LIMIT) * 100 : (dmTotal ? (dmCompleted / dmTotal) * 100 : 0)}
        className="h-1.5 mb-3 md:h-2 md:mb-3"
      />

      {/* Follow Queue */}
      {activeTab === "follow" && (
        <div className="space-y-3 md:space-y-2">
          {followQueue.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground/60 md:py-8 md:text-muted-foreground">No follows queued. Hit "Load Queue" to start.</p>
          )}
          {sortedFollowQueue.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 rounded-2xl bg-muted/50 px-4 py-4 transition-all md:rounded-lg md:border md:border-border md:bg-card md:px-3 md:py-3 ${
                item.completed ? "opacity-50" : ""
              }`}
            >
              <Checkbox
                checked={item.completed}
                onCheckedChange={() => toggleComplete(item.id, item.completed, "follow", item.contact_id)}
                className="h-5 w-5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${item.completed ? "line-through" : ""}`}>
                  {item.contacts?.full_name || "Unknown"}
                </p>
                {item.contacts?.username && (
                  <p className="text-xs text-muted-foreground">@{item.contacts.username}</p>
                )}
              </div>
              {!item.completed && (
                <button
                  onClick={() => removeFromQueue(item.id, item.contact_id, "follow")}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                  title="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <a
                href={item.contacts?.profile_link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleProfileClick(item)}
                className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          ))}
        </div>
      )}

      {/* DM Queue */}
      {activeTab === "dm" && (
        <div className="space-y-3 md:space-y-1.5">
          {dmQueue.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground/60 md:py-8 md:text-muted-foreground">No DMs queued. Yesterday's completed follows will appear here.</p>
          )}

          {/* Fresh DMs section */}
          {freshDms.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 md:text-muted-foreground">
                Fresh DMs ({freshDms.filter(i => i.completed).length}/{freshDms.length})
              </p>
              {freshDms.map((item) => {
                const opener = openers[item.contact_id];
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl bg-muted/50 px-4 py-3 transition-all md:rounded-lg md:border md:border-border md:bg-card md:px-3 md:py-2 ${
                      item.completed ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={item.completed}
                        onCheckedChange={() => toggleComplete(item.id, item.completed, "dm", item.contact_id)}
                        className="h-4 w-4 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium leading-tight ${item.completed ? "line-through" : ""}`}>
                          {item.contacts?.full_name || "Unknown"}
                        </p>
                        {item.contacts?.username && (
                          <p className="text-[11px] text-muted-foreground leading-tight">@{item.contacts.username}</p>
                        )}
                      </div>
                      {!item.completed && (
                        <button
                          onClick={() => skipDm(item.id, item.contact_id, item.contacts?.dm_skip_count || 0)}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-orange-500/15 hover:text-orange-500 transition-colors"
                          title="Skip → +2 days"
                        >
                          <Clock className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!item.completed && (
                        <button
                          onClick={() => removeFromDmQueueWithBackfill(item.id, item.contact_id, item.contacts?.full_name || "Unknown")}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                          title="Remove & replace"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <a
                        href={item.contacts?.profile_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => handleProfileClick(item)}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    {opener && !item.completed && (
                      <div className="mt-1 ml-6 flex items-center gap-1.5">
                        <p className="flex-1 min-w-0 rounded-xl bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground break-words md:rounded md:bg-secondary md:px-2 md:py-1 md:text-secondary-foreground">
                          {opener}
                        </p>
                        <button
                          onClick={() => copyOpener(opener)}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Skipped / Private section */}
          {skippedDms.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-orange-500/70 mt-3 pt-2 border-t border-border/50 md:text-orange-500 md:border-border">
                Skipped / Private ({skippedDms.length})
              </p>
              {skippedDms.map((item) => {
                const opener = openers[item.contact_id];
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl bg-orange-500/[0.08] px-4 py-3 transition-all md:rounded-lg md:border md:border-orange-500/20 md:bg-card md:px-3 md:py-2 ${
                      item.completed ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={item.completed}
                        onCheckedChange={() => toggleComplete(item.id, item.completed, "dm", item.contact_id)}
                        className="h-4 w-4 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium leading-tight ${item.completed ? "line-through" : ""}`}>
                          {item.contacts?.full_name || "Unknown"}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {item.contacts?.username && (
                            <span className="text-[11px] text-muted-foreground leading-tight">@{item.contacts.username}</span>
                          )}
                          <span className={`text-[9px] rounded px-1 py-px font-medium ${
                            (item.contacts?.dm_skip_count || 0) >= 7
                              ? "bg-destructive/15 text-destructive"
                              : "bg-orange-500/15 text-orange-500"
                          }`}>
                            {(item.contacts?.dm_skip_count || 0) >= 7 ? "7+" : `${item.contacts?.dm_skip_count}×`}
                          </span>
                        </div>
                      </div>
                      {!item.completed && (
                        <button
                          onClick={() => skipDm(item.id, item.contact_id, item.contacts?.dm_skip_count || 0)}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-orange-500/15 hover:text-orange-500 transition-colors"
                          title="Skip → +2 days"
                        >
                          <Clock className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!item.completed && (
                        <button
                          onClick={() => removeFromDmQueue(item.id, item.contact_id, item.contacts?.full_name || "Unknown")}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                          title="Delete contact"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <a
                        href={item.contacts?.profile_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    {opener && !item.completed && (
                      <div className="mt-1 ml-6 flex items-center gap-1.5">
                        <p className="flex-1 min-w-0 rounded-xl bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground break-words md:rounded md:bg-secondary md:px-2 md:py-1 md:text-secondary-foreground">
                          {opener}
                        </p>
                        <button
                          onClick={() => copyOpener(opener)}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Follow-ups Due Section */}
      {(followUpsA.length > 0 || followUpsB.length > 0 || followUpsC.length > 0) && (
        <section className="mt-10 space-y-4 border-t border-border/50 pt-6 md:mt-6 md:space-y-3 md:pt-4">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 md:text-sm md:tracking-wider md:text-muted-foreground">
              Follow-ups Due ({followUps.length})
            </h2>
          </div>

          {[
            { label: "Trojan Horse (A)", items: followUpsA, color: "text-orange-500", dotColor: "bg-orange-500" },
            { label: "VSL (B)", items: followUpsB, color: "text-yellow-500", dotColor: "bg-yellow-500" },
            { label: "Calendly (C)", items: followUpsC, color: "text-blue-500", dotColor: "bg-blue-500" },
          ].map(({ label, items, color, dotColor }) =>
            items.length > 0 ? (
              <div key={label} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                  <p className={`text-xs font-medium ${color}`}>{label} ({items.length})</p>
                </div>
                {items.map((contact) => (
                  <div key={contact.id} className="rounded-2xl bg-muted/50 px-4 py-3.5 space-y-2 md:rounded-lg md:border md:border-border md:bg-card md:px-3 md:py-3">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{contact.full_name}</p>
                          <span className="text-[10px] rounded-md bg-primary/10 text-primary px-1.5 py-0.5 font-medium shrink-0">{contact.current_follow_up}</span>
                        </div>
                        {contact.username && <p className="text-xs text-muted-foreground">@{contact.username}</p>}
                      </div>
                      <a href={contact.profile_link} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                    <div className="flex gap-1.5 items-center">
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1 flex-1 sm:flex-none" onClick={() => advanceFromFollowUp(contact)}>
                        <ChevronRight className="h-3 w-3" /> Replied
                      </Button>
                      <Button size="sm" variant="secondary" className="h-7 text-xs px-2.5 flex-1 sm:flex-none" onClick={() => markFollowUpSent(contact)}>
                        Sent
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 shrink-0" onClick={() => negativeReply(contact.id)} title="Negative reply → Flywheel">
                        <ThumbsDown className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null
          )}
        </section>
      )}
    </div>
  );
};

export default Actions;
