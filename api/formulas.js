import { requireAuth } from "./_lib/auth.js";
import {
  ensureFormulasTable, readFormulas, addFormulaRow, ensureFolder, createUploadSession,
  getDownloadUrl, sendMail, notifyEnabled, todayStr,
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
  if (!project || !fileName) return res.status(400).json({ error: "Expected project and fileName" });
  const bytes = Number(size);
  if (!(bytes > 0)) return res.status(400).json({ error: "File is empty" });
  if (bytes > MAX_SIZE) return res.status(413).json({ error: "File is larger than 100 MB" });

  const name = cleanFileName(fileName);
  await ensureFormulasTable();
  const projectName = String(project).slice(0, 120);
  // Caller may label the version (e.g. "3.1", "2-final"); otherwise auto-number.
  const version = cleanVersion(req.body.version) || 1 + (await readFormulas())
    .filter(f => f.project === projectName)
    .reduce((mx, f) => Math.max(mx, f.version), 0);

  const folder = cleanFolderName(projectName);
  await ensureFolder(ROOT_FOLDER, folder);
  const uploadUrl = await createUploadSession(ROOT_FOLDER, folder, `v${version} - ${name}`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ uploadUrl, version });
}

async function complete(req, res) {
  const { project, version, fileName, itemId, author, notes } = req.body;
  const v = cleanVersion(version);
  if (!project || !fileName || !v) return res.status(400).json({ error: "Expected project, version and fileName" });
  if (!itemId || !ITEM_ID.test(itemId)) return res.status(400).json({ error: "Invalid item id" });

  const row = {
    date: todayStr(),
    project: String(project).slice(0, 120),
    version: v,
    fileName: String(fileName).slice(0, 200),
    itemId: String(itemId),
    uploadedBy: String(author || "Portal user").slice(0, 60),
    notes: String(notes || "").slice(0, 2000),
  };
  await ensureFormulasTable();
  await addFormulaRow(row);
  if (notifyEnabled("note")) {
    await sendMail(
      `[R&D Tracker] New formula file for ${row.project} (v${v})`,
      `<p><b>${esc(row.uploadedBy)}</b> uploaded <b>v${v}</b> of the formula for <b>${esc(row.project)}</b>: ${esc(row.fileName)}</p>
       ${row.notes ? `<p>What changed:</p><blockquote>${esc(row.notes)}</blockquote>` : ""}`
    ).catch(() => {});
  }
  res.status(200).json({ ok: true, formula: row });
}

async function download(req, res) {
  const itemId = String(req.query.download || "");
  if (!ITEM_ID.test(itemId)) return res.status(400).json({ error: "Invalid item id" });
  const url = await getDownloadUrl(itemId);
  if (!url) return res.status(404).json({ error: "File not found" });
  res.setHeader("Cache-Control", "no-store");
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

/** Project names like "Minoxidil/Finasteride" become a single safe folder name. */
function cleanFolderName(project) {
  const name = project.replace(ILLEGAL, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return name || "Untitled project";
}

const esc = s => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
