import { requireAuth } from "./_lib/auth.js";
import { readTrackerData } from "./_lib/graph.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    const data = await readTrackerData();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
