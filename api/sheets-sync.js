import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";

export const config = { maxDuration: 60 };

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const MONTH_TABS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const normalizeHeader = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const normalizeLink = (value) => String(value || "").trim().toLowerCase().replace(/\/+$/, "");

const formatDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = String(d.getUTCFullYear());
  return `${day}/${month}/${year}`;
};

const colToA1 = (index) => {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
};

const findHeaderIndex = (row, label) => {
  const target = normalizeHeader(label);
  return row.findIndex((cell) => normalizeHeader(cell) === target);
};

const findHeaderInRange = (row, labels, start, end) => {
  const targets = labels.map(normalizeHeader);
  for (let i = start; i < end; i++) {
    if (targets.includes(normalizeHeader(row[i]))) return i;
  }
  return -1;
};

const findHeaderRow = (rows) => {
  for (let i = 0; i < rows.length; i++) {
    if (findHeaderIndex(rows[i] || [], "Name (Initiate) (A1)") !== -1) return i;
  }
  return -1;
};

const buildSectionMap = (rows) => {
  const headerRowIdx = findHeaderRow(rows);
  if (headerRowIdx === -1) throw new Error("Header row not found");

  const header = rows[headerRowIdx] || [];
  const a1Start = findHeaderIndex(header, "Name (Initiate) (A1)");
  const a2Start = findHeaderIndex(header, "Name (Initiate) (A2)");
  const bStart = findHeaderIndex(header, "Name (Engaged) (B)");
  const cStart = findHeaderIndex(header, "Name (C)");
  const dStart = findHeaderIndex(header, "Name (D)");
  if ([a1Start, a2Start, bStart, cStart, dStart].some((i) => i === -1)) {
    throw new Error("Missing one or more section headers");
  }

  const a1 = {
    nameCol: a1Start,
    linkCol: findHeaderInRange(header, ["Prof. link", "Profile Link", "Prof. Link"], a1Start, a2Start),
    dateCol: findHeaderInRange(header, ["Date (A1)"], a1Start, a2Start),
    mediaCol: findHeaderInRange(header, ["Media Seen (MS)"], a1Start, a2Start),
  };

  const a2 = {
    nameCol: a2Start,
    linkCol: findHeaderInRange(header, ["Prof. Link", "Profile Link", "Prof. link"], a2Start, bStart),
    dateCol: findHeaderInRange(header, ["Date Initiated"], a2Start, bStart),
    followUps: {
      "1A": findHeaderInRange(header, ["1A"], a2Start, bStart),
    },
  };

  const b = {
    nameCol: bStart,
    linkCol: findHeaderInRange(header, ["Profile Link", "Prof. Link", "Prof. link"], bStart, cStart),
    dateCol: findHeaderInRange(header, ["Date Engaged"], bStart, cStart),
    followUps: {},
  };
  for (let n = 1; n <= 8; n++) {
    b.followUps[`${n}B`] = findHeaderInRange(header, [`${n}B`], bStart, cStart);
  }

  const c = {
    nameCol: cStart,
    linkCol: findHeaderInRange(header, ["Profile Link", "Prof. Link", "Prof. link"], cStart, dStart),
    dateCol: findHeaderInRange(header, ["Date (C)"], cStart, dStart),
    followUps: {},
  };
  for (let n = 1; n <= 8; n++) {
    const label = `${n}C`;
    let idx = findHeaderInRange(header, [label], cStart, dStart);
    if (idx === -1 && n === 8) idx = findHeaderInRange(header, ["8B"], cStart, dStart);
    c.followUps[label] = idx;
  }

  const d = {
    nameCol: dStart,
    dateCol: findHeaderInRange(header, ["Date (D)"], dStart, header.length),
  };

  return { headerRowIdx, a1, a2, b, c, d };
};

const findRowByLink = (rows, colIndex, profileLink, startRow) => {
  if (colIndex === -1 || !profileLink) return -1;
  const target = normalizeLink(profileLink);
  for (let r = startRow; r < rows.length; r++) {
    const cell = rows[r]?.[colIndex];
    if (!cell) continue;
    if (normalizeLink(cell) === target) return r;
  }
  return -1;
};

const findRowByName = (rows, colIndex, name, startRow) => {
  if (colIndex === -1 || !name) return -1;
  const target = normalizeHeader(name);
  for (let r = startRow; r < rows.length; r++) {
    const cell = rows[r]?.[colIndex];
    if (!cell) continue;
    if (normalizeHeader(cell) === target) return r;
  }
  return -1;
};

const findFirstEmptyRow = (rows, colIndex, startRow) => {
  for (let r = startRow; r < rows.length; r++) {
    const cell = rows[r]?.[colIndex];
    if (!cell || String(cell).trim() === "") return r;
  }
  return rows.length;
};

const getCellValue = (rows, rowIndex, colIndex) => {
  if (rowIndex < 0 || colIndex < 0) return "";
  return rows[rowIndex]?.[colIndex] ?? "";
};

const parseSheetDate = (value) => {
  if (!value) return null;
  if (typeof value === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + value * 24 * 60 * 60 * 1000);
    return d.toISOString();
  }
  const text = String(value).trim();
  if (!text) return null;

  const ddmmyy = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (ddmmyy) {
    const day = parseInt(ddmmyy[1], 10);
    const month = parseInt(ddmmyy[2], 10) - 1;
    let year = ddmmyy[3] ? parseInt(ddmmyy[3], 10) : new Date().getUTCFullYear();
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month, day));
    return d.toISOString();
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
};

const getAccessToken = async () => {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) throw new Error("Google Sheets credentials not set");
  const jwt = new JWT({ email: clientEmail, key: privateKey, scopes: [SHEETS_SCOPE] });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Failed to acquire Google Sheets token");
  return token;
};

const getSheetValues = async (sheetId, sheetTab, range) => {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${sheetTab}!${range}`)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API read failed: ${res.status}`);
  const data = await res.json();
  return data.values || [];
};

const batchUpdate = async (sheetId, updates) => {
  if (updates.length === 0) return;
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API write failed: ${res.status} ${text.slice(0, 200)}`);
  }
};

const addUpdate = (rows, updates, sheetTab, rowIndex, colIndex, value) => {
  if (rowIndex < 0 || colIndex < 0) return;
  if (value === null || value === undefined) return;
  const existing = String(getCellValue(rows, rowIndex, colIndex) ?? "").trim();
  const nextValue = String(value);
  if (existing === nextValue) return;

  updates.push({
    range: `${sheetTab}!${colToA1(colIndex)}${rowIndex + 1}`,
    values: [[nextValue]],
  });
};

const resolveSheetTab = (requestTab, envTab, actionDate) => {
  if (requestTab) return requestTab;
  if (envTab) return envTab;
  const base = actionDate ? new Date(actionDate) : new Date();
  const idx = Number.isNaN(base.getTime()) ? new Date().getMonth() : base.getMonth();
  return MONTH_TABS[idx] || "Jan";
};

export default async function handler(req, res) {
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

    const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID;
    const envSheetTab = process.env.GOOGLE_SHEETS_TAB;
    if (!sheetId) throw new Error("Sheet ID not set");

    const { userId, contactId, event, followUp, actionDate, mode, sheetTab: requestTab } = req.body || {};
    const sheetTab = resolveSheetTab(requestTab, envSheetTab, actionDate);
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (mode !== "pull" && !contactId) return res.status(400).json({ error: "contactId is required" });

    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user || user.id !== userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const rows = await getSheetValues(sheetId, sheetTab, "A:AZ");
    const sections = buildSectionMap(rows);

    if (mode === "pull") {
      const { data: contacts, error } = await supabase
        .from("contacts")
        .select("id, user_id, status, profile_link, dmed_at, initiated_at, engaged_at, calendly_sent_at, booked_at, media_seen")
        .eq("user_id", userId);
      if (error) throw error;

      const contactMap = new Map();
      (contacts || []).forEach((c) => { contactMap.set(normalizeLink(c.profile_link), c); });

      const updates = new Map();
      const startRow = sections.headerRowIdx + 1;
      for (let r = startRow; r < rows.length; r++) {
        const row = rows[r] || [];

        const a1Link = row[sections.a1.linkCol];
        const a1Contact = contactMap.get(normalizeLink(a1Link));
        if (a1Contact) {
          const dmedValue = parseSheetDate(row[sections.a1.dateCol]);
          const mediaValue = String(row[sections.a1.mediaCol] || "").trim().toLowerCase();
          const patch = updates.get(a1Contact.id) || {};
          if (!a1Contact.dmed_at && dmedValue) patch.dmed_at = dmedValue;
          if (!a1Contact.media_seen && mediaValue === "yes") {
            patch.media_seen = true;
            patch.media_seen_at = new Date().toISOString();
          }
          if (Object.keys(patch).length > 0) updates.set(a1Contact.id, patch);
        }

        const a2Link = row[sections.a2.linkCol];
        const a2Contact = contactMap.get(normalizeLink(a2Link));
        if (a2Contact) {
          const initiatedValue = parseSheetDate(row[sections.a2.dateCol]);
          const patch = updates.get(a2Contact.id) || {};
          if (!a2Contact.initiated_at && initiatedValue) patch.initiated_at = initiatedValue;
          if (Object.keys(patch).length > 0) updates.set(a2Contact.id, patch);
        }

        const bLink = row[sections.b.linkCol];
        const bContact = contactMap.get(normalizeLink(bLink));
        if (bContact) {
          const engagedValue = parseSheetDate(row[sections.b.dateCol]);
          const patch = updates.get(bContact.id) || {};
          if (!bContact.engaged_at && engagedValue) patch.engaged_at = engagedValue;
          if (Object.keys(patch).length > 0) updates.set(bContact.id, patch);
        }

        const cLink = row[sections.c.linkCol];
        const cContact = contactMap.get(normalizeLink(cLink));
        if (cContact) {
          const calendlyValue = parseSheetDate(row[sections.c.dateCol]);
          const patch = updates.get(cContact.id) || {};
          if (!cContact.calendly_sent_at && calendlyValue) patch.calendly_sent_at = calendlyValue;
          if (Object.keys(patch).length > 0) updates.set(cContact.id, patch);
        }

        const dName = row[sections.d.nameCol];
        const dDate = row[sections.d.dateCol];
        if (dName && dDate) {
          // No profile link in D section; skip automated matching
        }
      }

      let updated = 0;
      for (const [contactIdKey, patch] of updates.entries()) {
        const { error: updErr } = await supabase.from("contacts").update(patch).eq("id", contactIdKey).eq("user_id", userId);
        if (updErr) throw updErr;
        updated++;
      }

      return res.status(200).json({ message: `Pulled ${updated} contacts from sheet` });
    }

    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("id, user_id, full_name, profile_link, dmed_at, initiated_at, engaged_at, calendly_sent_at, booked_at, media_seen")
      .eq("id", contactId)
      .eq("user_id", userId)
      .maybeSingle();
    if (contactErr) throw contactErr;
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const updates = [];
    const startRow = sections.headerRowIdx + 1;

    const ensureRowInSection = (section) => {
      let rowIndex = findRowByLink(rows, section.linkCol, contact.profile_link, startRow);
      if (rowIndex === -1) rowIndex = findFirstEmptyRow(rows, section.nameCol, startRow);
      addUpdate(rows, updates, sheetTab, rowIndex, section.nameCol, contact.full_name);
      addUpdate(rows, updates, sheetTab, rowIndex, section.linkCol, contact.profile_link);
      return rowIndex;
    };

    const ensureRowInSectionByName = (section) => {
      let rowIndex = findRowByName(rows, section.nameCol, contact.full_name, startRow);
      if (rowIndex === -1) rowIndex = findFirstEmptyRow(rows, section.nameCol, startRow);
      addUpdate(rows, updates, sheetTab, rowIndex, section.nameCol, contact.full_name);
      return rowIndex;
    };

    if (event === "dm_sent") {
      const rowIndex = ensureRowInSection(sections.a1);
      addUpdate(rows, updates, sheetTab, rowIndex, sections.a1.dateCol, formatDate(actionDate || contact.dmed_at));
      if (sections.a1.mediaCol !== -1) {
        addUpdate(rows, updates, sheetTab, rowIndex, sections.a1.mediaCol, contact.media_seen ? "YES" : "");
      }
    } else if (event === "media_seen") {
      const rowIndex = ensureRowInSection(sections.a1);
      if (sections.a1.mediaCol !== -1) {
        addUpdate(rows, updates, sheetTab, rowIndex, sections.a1.mediaCol, contact.media_seen ? "YES" : "");
      }
    } else if (event === "initiated") {
      const rowIndex = ensureRowInSection(sections.a2);
      addUpdate(rows, updates, sheetTab, rowIndex, sections.a2.dateCol, formatDate(actionDate || contact.initiated_at));
    } else if (event === "engaged") {
      const rowIndex = ensureRowInSection(sections.b);
      addUpdate(rows, updates, sheetTab, rowIndex, sections.b.dateCol, formatDate(actionDate || contact.engaged_at));
    } else if (event === "calendly_sent") {
      const rowIndex = ensureRowInSection(sections.c);
      addUpdate(rows, updates, sheetTab, rowIndex, sections.c.dateCol, formatDate(actionDate || contact.calendly_sent_at));
    } else if (event === "booked") {
      const rowIndex = ensureRowInSectionByName(sections.d);
      addUpdate(rows, updates, sheetTab, rowIndex, sections.d.dateCol, formatDate(actionDate || contact.booked_at));
    } else if (event === "follow_up_sent") {
      if (!followUp) return res.status(400).json({ error: "followUp is required" });
      const letter = followUp.slice(-1).toUpperCase();
      const section = letter === "A" ? sections.a2 : letter === "B" ? sections.b : sections.c;
      const rowIndex = ensureRowInSection(section);
      const colIndex = section.followUps?.[followUp];
      if (colIndex === -1 || colIndex === undefined) {
        return res.status(400).json({ error: `Column for ${followUp} not found` });
      }
      addUpdate(rows, updates, sheetTab, rowIndex, colIndex, formatDate(actionDate || new Date().toISOString()));
    } else {
      return res.status(400).json({ error: "Unknown event" });
    }

    await batchUpdate(sheetId, updates);
    return res.status(200).json({ message: "Sheet synced", updates: updates.length });
  } catch (error) {
    console.error("sheets-sync error:", error);
    return res.status(500).json({ error: error.message || "Unknown error" });
  }
}
