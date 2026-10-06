import crypto from "node:crypto";

const COOKIE = "pp_session";
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days
const REFRESH_AFTER = 60 * 60 * 24; // re-issue once a session is older than 24h

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

/** Expiry (ms epoch) of the presented session if valid, else 0. */
function sessionExpiry(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return 0;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return 0;
  const expect = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return 0;
  const exp = Number(payload);
  return exp > Date.now() ? exp : 0;
}

export function verifyRequest(req) {
  return sessionExpiry(req) > 0;
}

/** Rolling sessions: a valid session issued more than 24h ago gets a fresh cookie
    (same attributes as login), so active users never reach expiry. Age is derived
    from exp, so older 30-day cookies count as old and are upgraded on first use. */
export function requireAuth(req, res) {
  const exp = sessionExpiry(req);
  if (exp) {
    const issued = exp - MAX_AGE * 1000;
    if (Date.now() - issued > REFRESH_AFTER * 1000) res.setHeader("Set-Cookie", sessionCookie(makeSession()));
    return true;
  }
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
