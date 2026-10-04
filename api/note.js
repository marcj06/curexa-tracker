import { requireAuth } from "./_lib/auth.js";
import { addNoteRow, sendMail, notifyEnabled, todayStr } from "./_lib/graph.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { project, sku, author, note } = req.body || {};
  if (!project || !note) return res.status(400).json({ error: "Expected project and note" });
  try {
    await addNoteRow({
      date: todayStr(),
      project: String(project).slice(0, 120),
      sku: String(sku || "—").slice(0, 60),
      author: String(author || "Portal user").slice(0, 60),
      note: String(note).slice(0, 2000),
    });
    if (notifyEnabled("note")) {
      await sendMail(
        `[R&D Tracker] New note on ${project}`,
        `<p><b>${esc(author || "Someone")}</b> added a note on <b>${esc(project)}</b>${sku && sku !== "—" ? ` (${esc(sku)})` : ""}:</p>
         <blockquote>${esc(note)}</blockquote>`
      ).catch(() => {});
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

const esc = s => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
