import { passwordMatches, makeSession, sessionCookie } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { password } = req.body || {};
  if (!passwordMatches(password)) {
    return res.status(401).json({ error: "Wrong password" });
  }
  res.setHeader("Set-Cookie", sessionCookie(makeSession()));
  res.status(200).json({ ok: true });
}
