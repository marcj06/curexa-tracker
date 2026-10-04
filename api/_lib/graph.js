/* Microsoft Graph helpers: token refresh against a personal Microsoft account
   (consumers endpoint) + Excel workbook table access on OneDrive.

   Required env vars:
     MS_CLIENT_ID      — Azure app registration (public client, device-code enabled)
     MS_REFRESH_TOKEN  — seed refresh token from scripts/get-refresh-token.mjs
     WORKBOOK_PATH     — OneDrive path, e.g. /CurexaTracker/Pete_Pharma_x_Curexa_RD_Tracker_v2.xlsx
   Optional (keeps the rotating refresh token fresh across deployments):
     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
*/

// MS_TENANT: "consumers" for a personal Microsoft account (default), or a
// tenant ID / domain (e.g. petepharma.com) for an M365 work account.
const TENANT = process.env.MS_TENANT || "consumers";
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const SCOPE = "offline_access Files.ReadWrite Mail.Send User.Read";
const GRAPH = "https://graph.microsoft.com/v1.0";

const TRACKER_TABLE = "TrackerTable";
const NOTES_TABLE = "NotesTable";
export const STAGE_HEADERS = [
  "Initial Intake", "APIs to Pete Pharma", "Formula Development",
  "Samples to Curexa", "Sample Feedback", "Formula Finalized",
  "SOP Finalized", "Production",
];

// Warm-instance cache
let cached = { accessToken: null, exp: 0 };

async function kv(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url}/${cmd.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()).result;
}

async function currentRefreshToken() {
  return (await kv(["GET", "ms_refresh_token"])) || process.env.MS_REFRESH_TOKEN;
}

export async function getAccessToken() {
  if (cached.accessToken && Date.now() < cached.exp - 60_000) return cached.accessToken;
  const refresh = await currentRefreshToken();
  if (!refresh) throw new Error("No refresh token configured (MS_REFRESH_TOKEN)");
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refresh,
    scope: SCOPE,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh failed (${data.error}): ${data.error_description || ""}. ` +
      "If this persists, re-run scripts/get-refresh-token.mjs and update MS_REFRESH_TOKEN.");
  }
  cached = { accessToken: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  if (data.refresh_token) await kv(["SET", "ms_refresh_token", data.refresh_token]);
  return cached.accessToken;
}

async function g(path, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(GRAPH + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`Graph ${opts.method || "GET"} ${path} failed: ${msg}`);
  }
  return data;
}

function workbookBase() {
  const path = process.env.WORKBOOK_PATH;
  if (!path) throw new Error("WORKBOOK_PATH env var is not set");
  // Encode each path segment so spaces, '&', '#' etc. in folder names are safe
  const enc = path.split("/").map(encodeURIComponent).join("/");
  return `/me/drive/root:${enc}:/workbook`;
}

/** Full grid of a table (header + data) and its top-left sheet position. */
export async function readTable(tableName) {
  const data = await g(`${workbookBase()}/tables('${tableName}')/range?$select=address,values`);
  const values = data.values;
  const headers = values[0].map(String);
  // address like "Tracker!A1:S23"
  const m = data.address.match(/!([A-Z]+)(\d+):/);
  const startCol = colToNum(m[1]);
  const startRow = parseInt(m[2], 10);
  return { headers, rows: values.slice(1), startCol, startRow, sheet: data.address.split("!")[0].replace(/'/g, "") };
}

export async function readTrackerData() {
  const t = await readTable(TRACKER_TABLE);
  const idx = Object.fromEntries(t.headers.map((h, i) => [h, i]));
  const rows = t.rows
    .filter(r => r[idx["Row ID"]])
    .map(r => ({
      id: String(r[idx["Row ID"]]),
      project: str(r[idx["Project"]]),
      sku: str(r[idx["SKU / Variant"]]),
      apis: str(r[idx["APIs"]]),
      strengths: str(r[idx["Strengths"]]),
      dosageForm: str(r[idx["Dosage Form"]]),
      stages: Object.fromEntries(STAGE_HEADERS.map(s => [s, str(r[idx[s]]) || "Not Started"])),
      lastUpdated: str(r[idx["Last Updated"]]),
      updatedBy: str(r[idx["Updated By"]]),
    }));
  const n = await readTable(NOTES_TABLE);
  const ni = Object.fromEntries(n.headers.map((h, i) => [h, i]));
  const notes = n.rows
    .filter(r => r[ni["Note"]])
    .map(r => ({
      date: str(r[ni["Date"]]), project: str(r[ni["Project"]]),
      sku: str(r[ni["SKU / Variant"]]), author: str(r[ni["Author"]]), note: str(r[ni["Note"]]),
    }));
  return { rows, notes };
}

/** Write one or more header->value cells on a tracker row found by Row ID. */
export async function updateTrackerCells(rowId, updates) {
  const t = await readTable(TRACKER_TABLE);
  const idx = Object.fromEntries(t.headers.map((h, i) => [h, i]));
  const rowOffset = t.rows.findIndex(r => String(r[idx["Row ID"]]) === String(rowId));
  if (rowOffset === -1) throw new Error(`Row ${rowId} not found in tracker`);
  const sheetRow = t.startRow + 1 + rowOffset;
  for (const [header, value] of Object.entries(updates)) {
    if (!(header in idx)) throw new Error(`Unknown column: ${header}`);
    const addr = `${numToCol(t.startCol + idx[header])}${sheetRow}`;
    await g(`${workbookBase()}/worksheets('${t.sheet}')/range(address='${addr}')`, {
      method: "PATCH",
      body: { values: [[value]] },
    });
  }
}

/** Append rows to the tracker; returns the new Row IDs. */
export async function addTrackerRows(entries) {
  const t = await readTable(TRACKER_TABLE);
  const idx = Object.fromEntries(t.headers.map((h, i) => [h, i]));
  const maxId = t.rows.reduce((mx, r) => {
    const m = String(r[idx["Row ID"]] || "").match(/^R(\d+)$/);
    return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
  }, 0);
  const width = t.headers.length;
  const ids = [];
  const values = entries.map((e, i) => {
    const id = `R${String(maxId + 1 + i).padStart(3, "0")}`;
    ids.push(id);
    const row = new Array(width).fill("");
    row[idx["Row ID"]] = id;
    row[idx["Project"]] = e.project;
    row[idx["SKU / Variant"]] = e.sku || "—";
    row[idx["APIs"]] = e.apis || "";
    row[idx["Strengths"]] = e.strengths || "";
    row[idx["Dosage Form"]] = e.dosageForm || "";
    for (const s of STAGE_HEADERS) row[idx[s]] = s === "Initial Intake" ? "In Progress" : "Not Started";
    row[idx["Last Updated"]] = e.date;
    row[idx["Updated By"]] = e.requester;
    return row;
  });
  const added = await g(`${workbookBase()}/tables('${TRACKER_TABLE}')/rows`, {
    method: "POST",
    body: { values },
  });
  // Restore the Progress formula on the new rows (writing the row overwrote it)
  const firstIndex = added.index; // 0-based data-row index of first added row
  for (let i = 0; i < values.length; i++) {
    const sheetRow = t.startRow + 1 + firstIndex + i;
    const gCol = numToCol(t.startCol + idx[STAGE_HEADERS[0]]);
    const nCol = numToCol(t.startCol + idx[STAGE_HEADERS[STAGE_HEADERS.length - 1]]);
    const pCol = numToCol(t.startCol + idx["Progress"]);
    const rng = `${gCol}${sheetRow}:${nCol}${sheetRow}`;
    await g(`${workbookBase()}/worksheets('${t.sheet}')/range(address='${pCol}${sheetRow}')`, {
      method: "PATCH",
      body: { values: [[`=IF(8-COUNTIF(${rng},"N/A")=0,"",COUNTIF(${rng},"Completed")/(8-COUNTIF(${rng},"N/A")))`]] },
    });
  }
  return ids;
}

export async function addNoteRow({ date, project, sku, author, note }) {
  await g(`${workbookBase()}/tables('${NOTES_TABLE}')/rows`, {
    method: "POST",
    body: { values: [[date, project, sku || "—", author, note]] },
  });
}

export async function sendMail(subject, html) {
  const to = (process.env.NOTIFY_EMAIL || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!to.length) return;
  await g(`/me/sendMail`, {
    method: "POST",
    body: {
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: to.map(address => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    },
  });
}

export function notifyEnabled(kind) {
  const on = (process.env.NOTIFY_ON || "intake,status,note").split(",").map(s => s.trim());
  return on.includes(kind);
}

export const todayStr = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());

const str = v => (v == null ? "" : String(v));
function colToNum(col) { return [...col].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1; }
function numToCol(n) { let s = ""; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
