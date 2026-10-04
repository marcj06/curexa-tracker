import { requireAuth } from "./_lib/auth.js";
import { updateTrackerCells, sendMail, notifyEnabled, todayStr, STAGE_HEADERS } from "./_lib/graph.js";

const STATUSES = ["Not Started", "In Progress", "Blocked", "Completed", "N/A"];

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { rowId, stage, status, author } = req.body || {};
  if (!rowId || !STAGE_HEADERS.includes(stage) || !STATUSES.includes(status)) {
    return res.status(400).json({ error: "Expected rowId, a valid stage, and a valid status" });
  }
  try {
    await updateTrackerCells(rowId, {
      [stage]: status,
      "Last Updated": todayStr(),
      "Updated By": String(author || "Portal user").slice(0, 60),
    });
    if (notifyEnabled("status")) {
      await sendMail(
        `[R&D Tracker] ${rowId}: ${stage} → ${status}`,
        `<p><b>${esc(author || "Someone")}</b> updated <b>${esc(rowId)}</b>:</p>
         <p>${esc(stage)} → <b>${esc(status)}</b></p>
         <p>Open the tracker to see the full pipeline.</p>`
      ).catch(() => {}); // notification failure shouldn't fail the update
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

const esc = s => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
