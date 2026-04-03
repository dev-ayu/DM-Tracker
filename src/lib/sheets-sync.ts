import { supabase } from "@/integrations/supabase/client";

export type SheetSyncEvent =
  | "dm_sent"
  | "initiated"
  | "engaged"
  | "calendly_sent"
  | "booked"
  | "media_seen"
  | "follow_up_sent";

export type SheetSyncPayload = {
  userId: string;
  contactId: string;
  event: SheetSyncEvent;
  followUp?: string;
  actionDate?: string;
  sheetTab?: string;
};

export const syncSheet = async (payload: SheetSyncPayload) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const res = await fetch("/api/sheets-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn("Sheets sync failed:", res.status, text.slice(0, 200));
    }
  } catch (err) {
    console.warn("Sheets sync error:", err);
  }
};
