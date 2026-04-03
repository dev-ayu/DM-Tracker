import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEET_RANGE = "A:AZ";
const BATCH_SIZE = 500;

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

const requireCol = (value, label) => {
  if (value === -1) throw new Error(`Missing column: ${label}`);
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
  };

  const b = {
    nameCol: bStart,
    linkCol: findHeaderInRange(header, ["Profile Link", "Prof. Link", "Prof. link"], bStart, cStart),
    dateCol: findHeaderInRange(header, ["Date Engaged"], bStart, cStart),
  };

  const c = {
    nameCol: cStart,
    linkCol: findHeaderInRange(header, ["Profile Link", "Prof. Link", "Prof. link"], cStart, dStart),
    dateCol: findHeaderInRange(header, ["Date (C)"], cStart, dStart),
  };

  const d = {
    nameCol: dStart,
    dateCol: findHeaderInRange(header, ["Date (D)"], dStart, header.length),
  };

  requireCol(a1.linkCol, "A1 profile link");
  requireCol(a1.dateCol, "A1 date");
  requireCol(a1.mediaCol, "A1 media seen");
  requireCol(a2.linkCol, "A2 profile link");
  requireCol(a2.dateCol, "A2 date");
  requireCol(b.linkCol, "B profile link");
  requireCol(b.dateCol, "B date");
  requireCol(c.linkCol, "C profile link");
  requireCol(c.dateCol, "C date");
  requireCol(d.nameCol, "D name");
  requireCol(d.dateCol, "D date");

  return { headerRowIdx, a1, a2, b, c, d };
};

const isCellEmpty = (rows, rowIndex, colIndex) => {
  if (rowIndex < 0 || colIndex < 0) return true;
  const value = rows[rowIndex]?.[colIndex];
  return value === undefined || value === null || String(value).trim() === "";
};

const setCellValue = (rows, rowIndex, colIndex, value) => {
  while (rows.length <= rowIndex) rows.push([]);
  const row = rows[rowIndex] || [];
  while (row.length <= colIndex) row.push("");
  row[colIndex] = value;
  rows[rowIndex] = row;
};

const addUpdateIfEmpty = (rows, updates, sheetTab, rowIndex, colIndex, value) => {
  if (rowIndex < 0 || colIndex < 0) return false;
  if (value === null || value === undefined || String(value).trim() === "") return false;
  if (!isCellEmpty(rows, rowIndex, colIndex)) return false;

  updates.push({
    range: `${sheetTab}!${colToA1(colIndex)}${rowIndex + 1}`,
    values: [[String(value)]],
  });
  setCellValue(rows, rowIndex, colIndex, String(value));
  return true;
};

const safeFetch = async (url, options, label) => {
  try {
    return await fetch(url, options);
  } catch (error) {
    console.error(`[sheets-migrate] fetch failed (${label})`);
    console.error(error);
    if (error?.cause) console.error("cause:", error.cause);
    throw error;
  }
};

const safeSupabaseFetch = async (url, options) => {
  try {
    return await fetch(url, options);
  } catch (error) {
    console.error("[sheets-migrate] supabase fetch failed");
    console.error(error);
    if (error?.cause) console.error("cause:", error.cause);
    throw error;
  }
};

const getAccessToken = async () => {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\n/g, "\n");
  if (!clientEmail || !privateKey) throw new Error("Google Sheets credentials not set");
  const jwt = new JWT({ email: clientEmail, key: privateKey, scopes: [SHEETS_SCOPE] });
  let token;
  try {
    ({ token } = await jwt.getAccessToken());
  } catch (error) {
    console.error("[sheets-migrate] failed to get access token");
    console.error(error);
    if (error?.cause) console.error("cause:", error.cause);
    throw error;
  }
  if (!token) throw new Error("Failed to acquire Google Sheets token");
  return token;
};

const getSheetValues = async (sheetId, sheetTab, range) => {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${sheetTab}!${range}`)}`;
  const res = await safeFetch(url, { headers: { Authorization: `Bearer ${token}` } }, "getSheetValues");
  if (!res.ok) throw new Error(`Sheets API read failed: ${res.status}`);
  const data = await res.json();
  return data.values || [];
};

const batchUpdate = async (sheetId, updates) => {
  if (updates.length === 0) return;
  const token = await getAccessToken();
  const res = await safeFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates,
    }),
  }, "batchUpdate");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API write failed: ${res.status} ${text.slice(0, 200)}`);
  }
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

const getSectionColumns = (section) => {
  const cols = [section.nameCol, section.linkCol, section.dateCol, section.mediaCol];
  return [...new Set(cols.filter((col) => col !== undefined && col !== -1))];
};

const isRowEmptyForSection = (rows, rowIndex, cols) => cols.every((col) => isCellEmpty(rows, rowIndex, col));

const findFirstEmptyRowForSection = (rows, section, startRow) => {
  const cols = getSectionColumns(section);
  for (let r = startRow; r < rows.length; r++) {
    if (isRowEmptyForSection(rows, r, cols)) return r;
  }
  return rows.length;
};

const ensureRowForSection = (rows, section, contact, startRow, requireLink) => {
  let rowIndex = -1;

  if (section.linkCol !== -1 && contact.profile_link) {
    rowIndex = findRowByLink(rows, section.linkCol, contact.profile_link, startRow);
  }

  if (rowIndex === -1 && contact.full_name) {
    rowIndex = findRowByName(rows, section.nameCol, contact.full_name, startRow);
    if (rowIndex !== -1 && section.linkCol !== -1) {
      const existingLink = rows[rowIndex]?.[section.linkCol];
      if (existingLink && contact.profile_link) {
        if (normalizeLink(existingLink) !== normalizeLink(contact.profile_link)) return -1;
      }
    }
  }

  if (rowIndex === -1) {
    if (requireLink && (!contact.profile_link || section.linkCol === -1)) return -1;
    rowIndex = findFirstEmptyRowForSection(rows, section, startRow);
  }

  return rowIndex;
};

const fetchAllContacts = async (supabase) => {
  const pageSize = 1000;
  const all = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, full_name, profile_link, dmed_at, initiated_at, engaged_at, calendly_sent_at, booked_at, media_seen")
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
};

const main = async () => {
  const isDryRun = process.argv.includes("--dry-run") || process.env.SHEETS_DRY_RUN === "1";
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID;
  const sheetTab = process.env.GOOGLE_SHEETS_TAB || "Feb";

  if (!supabaseUrl || !supabaseServiceKey) throw new Error("Supabase env vars not set");
  if (!sheetId) throw new Error("Sheet ID not set");

  console.log(`[sheets-migrate] tab=${sheetTab} dryRun=${isDryRun ? "yes" : "no"}`);

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    global: { fetch: safeSupabaseFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const contacts = await fetchAllContacts(supabase);
  console.log(`[sheets-migrate] loaded ${contacts.length} contacts`);

  const rows = await getSheetValues(sheetId, sheetTab, SHEET_RANGE);
  console.log(`[sheets-migrate] sheet rows=${rows.length}`);

  const sections = buildSectionMap(rows);
  const startRow = sections.headerRowIdx + 1;

  const updates = [];
  let a1Count = 0;
  let a2Count = 0;
  let bCount = 0;
  let cCount = 0;
  let dCount = 0;
  let mediaCount = 0;

  for (const contact of contacts) {
    if (!contact || (!contact.full_name && !contact.profile_link)) continue;

    if (contact.dmed_at) {
      const rowIndex = ensureRowForSection(rows, sections.a1, contact, startRow, true);
      if (rowIndex !== -1) {
        if (addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.a1.nameCol, contact.full_name)) a1Count++;
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.a1.linkCol, contact.profile_link);
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.a1.dateCol, formatDate(contact.dmed_at));
        if (contact.media_seen) {
          if (addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.a1.mediaCol, "YES")) mediaCount++;
        }
      }
    }

    if (contact.initiated_at) {
      const rowIndex = ensureRowForSection(rows, sections.a2, contact, startRow, true);
      if (rowIndex !== -1) {
        if (addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.a2.nameCol, contact.full_name)) a2Count++;
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.a2.linkCol, contact.profile_link);
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.a2.dateCol, formatDate(contact.initiated_at));
      }
    }

    if (contact.engaged_at) {
      const rowIndex = ensureRowForSection(rows, sections.b, contact, startRow, true);
      if (rowIndex !== -1) {
        if (addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.b.nameCol, contact.full_name)) bCount++;
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.b.linkCol, contact.profile_link);
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.b.dateCol, formatDate(contact.engaged_at));
      }
    }

    if (contact.calendly_sent_at) {
      const rowIndex = ensureRowForSection(rows, sections.c, contact, startRow, true);
      if (rowIndex !== -1) {
        if (addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.c.nameCol, contact.full_name)) cCount++;
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.c.linkCol, contact.profile_link);
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.c.dateCol, formatDate(contact.calendly_sent_at));
      }
    }

    if (contact.booked_at && contact.full_name) {
      const rowIndex = ensureRowForSection(rows, sections.d, contact, startRow, false);
      if (rowIndex !== -1) {
        if (addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.d.nameCol, contact.full_name)) dCount++;
        addUpdateIfEmpty(rows, updates, sheetTab, rowIndex, sections.d.dateCol, formatDate(contact.booked_at));
      }
    }
  }

  console.log(
    `[sheets-migrate] updates: A1=${a1Count} A2=${a2Count} B=${bCount} C=${cCount} D=${dCount} Media=${mediaCount} total=${updates.length}`
  );

  if (isDryRun) {
    console.log("[sheets-migrate] dry-run enabled, no writes performed");
    return;
  }

  let sent = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await batchUpdate(sheetId, batch);
    sent += batch.length;
    console.log(`[sheets-migrate] wrote ${sent}/${updates.length}`);
  }

  console.log("[sheets-migrate] done");
};

main().catch((error) => {
  console.error("sheets-migrate error:", error?.message || error);
  process.exit(1);
});
