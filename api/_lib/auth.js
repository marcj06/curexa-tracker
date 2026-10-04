import crypto from "node:crypto";

const COOKIE = "pp_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET env var is not set");
  return s;
}

export function makeSession() {
  const exp = Date.now() + MAX_AGE * 1000;
  const payload = String(exp);
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function sessionCookie(value) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function verifyRequest(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return false;
  const expect = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  return Number(payload) > Date.now();
}

export function requireAuth(req, res) {
  if (verifyRequest(req)) return true;
  res.status(401).json({ error: "Not signed in" });
  return false;
}

export function passwordMatches(given) {
  const expected = process.env.SITE_PASSWORD || "";
  if (!expected) return false;
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(expected);
  // timingSafeEqual needs equal lengths; hash both to normalize
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
