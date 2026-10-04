import { requireAuth } from "./_lib/auth.js";
import { readTrackerData, readFormulas } from "./_lib/graph.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    const [data, formulas] = await Promise.all([readTrackerData(), readFormulas()]);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ...data, formulas });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
