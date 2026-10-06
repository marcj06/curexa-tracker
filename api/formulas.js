import { requireAuth } from "./_lib/auth.js";
import {
  ensureFormulasTable, readFormulas, addFormulaRow, ensureFolder, createUploadSession,
  getAccessToken, sendMail, notifyEnabled, todayStr,
} from "./_lib/graph.js";

const ROOT_FOLDER = "Formula Files";
const MAX_SIZE = 100 * 1024 * 1024;
const ITEM_ID = /^[A-Za-z0-9!_.-]+$/;

/* Formula file vault. The browser uploads file bytes straight to the
   pre-authenticated OneDrive uploadUrl (bypassing Vercel's ~4.5MB body limit);
   this endpoint only brokers the session and logs versions in FormulasTable.
     POST {action:"start"}    → {uploadUrl, version}
     POST {action:"complete"} → logs the version row + notifies
     GET  ?download=<itemId>  → 302 to a short-lived OneDrive download URL */
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === "GET") return await download(req, res);
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    const { action } = req.body || {};
    if (action === "start") return await start(req, res);
    if (action === "complete") return await complete(req, res);
    res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

async function start(req, res) {
  const { project, fileName, size } = req.body;
  const sku = cleanSku(req.body.sku);
  if (!project || !fileName || !sku) return res.status(400).json({ error: "Expected project, sku and fileName" });
  const bytes = Number(size);
  if (!(bytes > 0)) return res.status(400).json({ error: "File is empty" });
  if (bytes > MAX_SIZE) return res.status(413).json({ error: "File is larger than 100 MB" });

  const name = cleanFileName(fileName);
  await ensureFormulasTable();
  const projectName = String(project).slice(0, 120);
  // Caller may label the version (e.g. "3.1", "2-final"); otherwise auto-number
  // from the leading number of this SKU's existing labels (same rule as the browser's
  // prefill). Legacy blank-SKU rows never match, so they don't count.
  const version = cleanVersion(req.body.version) || 1 + Math.floor((await readFormulas())
    .filter(f => f.project === projectName && f.sku === sku)
    .map(f => parseFloat(f.version)).filter(Number.isFinite)
    .reduce((mx, n) => Math.max(mx, n), 0));

  // Formula Files/<project>/<sku>/ — single-formulation projects skip the SKU level.
  const folders = [ROOT_FOLDER, cleanFolderName(projectName, "Untitled project")];
  if (sku !== SINGLE) folders.push(cleanFolderName(sku, "Unnamed SKU"));
  await ensureFolder(...folders);
  const uploadUrl = await createUploadSession(...folders, `v${version} - ${name}`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ uploadUrl, version });
}

async function complete(req, res) {
  const { project, version, fileName, itemId, author, notes } = req.body;
  const v = cleanVersion(version);
  const sku = cleanSku(req.body.sku);
  if (!project || !fileName || !v || !sku) return res.status(400).json({ error: "Expected project, sku, version and fileName" });
  if (!itemId || !ITEM_ID.test(itemId)) return res.status(400).json({ error: "Invalid item id" });

  const row = {
    date: todayStr(),
    project: String(project).slice(0, 120),
    sku,
    version: v,
    fileName: String(fileName).slice(0, 200),
    itemId: String(itemId),
    uploadedBy: String(author || "Portal user").slice(0, 60),
    notes: String(notes || "").slice(0, 2000),
  };
  await ensureFormulasTable();
  await addFormulaRow(row);
  if (notifyEnabled("note")) {
    const label = row.project + (sku !== SINGLE ? ` — ${sku}` : "");
    await sendMail(
      `[R&D Tracker] New formula file for ${label} (v${v})`,
      `<p><b>${esc(row.uploadedBy)}</b> uploaded <b>v${v}</b> of the formula for <b>${esc(label)}</b>: ${esc(row.fileName)}</p>
       ${row.notes ? `<p>What changed:</p><blockquote>${esc(row.notes)}</blockquote>` : ""}`
    ).catch(() => {});
  }
  res.status(200).json({ ok: true, formula: row });
}

async function download(req, res) {
  const itemId = String(req.query.download || "");
  if (!ITEM_ID.test(itemId)) return res.status(400).json({ error: "Invalid item id" });
  // No $select: @microsoft.graph.downloadUrl is only reliably returned on an
  // unfiltered item fetch (its selectable alias is content.downloadUrl).
  const graphRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  const data = await graphRes.json().catch(() => ({}));
  res.setHeader("Cache-Control", "no-store");
  if (!graphRes.ok) {
    console.error(`Formula download: Graph GET item ${itemId} failed (${graphRes.status}):`, JSON.stringify(data));
    const msg = data?.error?.message || graphRes.statusText;
    const code = data?.error?.code ? ` [${data.error.code}]` : "";
    return res.status(graphRes.status === 404 ? 404 : 502)
      .json({ error: `OneDrive could not return this file: ${msg}${code}` });
  }
  const url = data["@microsoft.graph.downloadUrl"];
  if (!url) {
    console.error(`Formula download: item ${itemId} has no downloadUrl (folder or package?):`, JSON.stringify(data));
    return res.status(502).json({ error: "OneDrive did not provide a download link for this item" });
  }
  res.statusCode = 302;
  res.setHeader("Location", url);
  res.end();
}

/** Version label: letters, digits, dots and dashes only, max 20 chars ("" if nothing usable). */
const cleanVersion = raw => String(raw ?? "").replace(/[^A-Za-z0-9.-]/g, "").slice(0, 20);

// Characters OneDrive rejects in names, plus control chars.
const ILLEGAL = /[\u0000-\u001f"*:<>?|\\/#%]/g;

/** Strip any path, drop illegal chars, cap at 120 chars while keeping the extension. */
function cleanFileName(raw) {
  let name = String(raw).split(/[\\/]/).pop().replace(ILLEGAL, "_").trim().replace(/[. ]+$/, "");
  if (!name) name = "file";
  if (name.length > 120) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name;
}

/** Names like "Minoxidil/Finasteride" or "56/12 mg — White" become a single safe folder name. */
function cleanFolderName(raw, fallback) {
  const name = raw.replace(ILLEGAL, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return name || fallback;
}

/** Tracker's SKU value for single-formulation projects. */
const SINGLE = "—";

/** SKU as stored in the log: kept verbatim (minus control chars) so it matches the
    tracker row's SKU exactly; only its folder name is made path-safe. "" if missing. */
const cleanSku = raw => String(raw ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120);

const esc = s => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
