import { requireAuth } from "./_lib/auth.js";
import { updateTrackerCells, updateProjectStatus, sendMail, notifyEnabled, todayStr, STAGE_HEADERS } from "./_lib/graph.js";

const STATUSES = ["Not Started", "In Progress", "Blocked", "Completed", "N/A"];
const PROJECT_STATUSES = ["Active", "Paused", "Licensed", "Not Feasible"];

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { rowId, stage, status, author, project, projectStatus } = req.body || {};

  // Mode 2: change a whole project's section (Active / Paused / Licensed / Not Feasible)
  if (project && projectStatus) {
    if (!PROJECT_STATUSES.includes(projectStatus)) {
      return res.status(400).json({ error: "Invalid project status" });
    }
    try {
      const n = await updateProjectStatus(project, projectStatus, String(author || "Portal user").slice(0, 60), todayStr());
      if (notifyEnabled("status")) {
        await sendMail(`[R&D Tracker] ${project} → ${projectStatus}`,
          `<p><b>${esc(author || "Someone")}</b> moved <b>${esc(project)}</b> to <b>${esc(projectStatus)}</b> (${n} row${n > 1 ? "s" : ""}).</p>`).catch(() => {});
      }
      return res.status(200).json({ ok: true, rows: n });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  if (!rowId || !STAGE_HEADERS.includes(stage) || !STATUSES.includes(status)) {
    return res.status(400).json({ error: "Expected rowId, a valid stage, and a valid status" });
  }
  try {
    await updateTrackerCells(rowId, {
      [stage]: status,
      [stage + " Date"]: todayStr(),
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
