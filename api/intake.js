import { requireAuth } from "./_lib/auth.js";
import { addTrackerRows, addNoteRow, sendMail, notifyEnabled, todayStr } from "./_lib/graph.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { project, dosageForm, requester, notes, skus } = req.body || {};
  if (!project || !Array.isArray(skus) || !skus.length) {
    return res.status(400).json({ error: "Expected project and at least one SKU" });
  }
  try {
    const date = todayStr();
    const ids = await addTrackerRows(skus.slice(0, 20).map(s => ({
      project: String(project).slice(0, 120),
      sku: String(s.sku || "—").slice(0, 60),
      apis: String(s.apis || "").slice(0, 300),
      strengths: String(s.strengths || "").slice(0, 300),
      dosageForm: String(dosageForm || "").slice(0, 80),
      requester: String(requester || "Portal user").slice(0, 60),
      date,
    })));
    if (notes) {
      await addNoteRow({
        date, project: String(project).slice(0, 120), sku: "—",
        author: String(requester || "Portal user").slice(0, 60),
        note: "Intake request: " + String(notes).slice(0, 2000),
      });
    }
    if (notifyEnabled("intake")) {
      await sendMail(
        `[R&D Tracker] New project intake: ${project}`,
        `<p><b>${esc(requester || "Someone")}</b> submitted a new project: <b>${esc(project)}</b> (${esc(dosageForm || "form TBD")})</p>
         <ul>${skus.map(s => `<li>${esc(s.sku || "—")}: ${esc(s.apis || "APIs TBD")} — ${esc(s.strengths || "")}</li>`).join("")}</ul>
         ${notes ? `<p>Notes: ${esc(notes)}</p>` : ""}
         <p>Rows added: ${ids.join(", ")}</p>`
      ).catch(() => {});
    }
    res.status(200).json({ ok: true, ids });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

const esc = s => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
