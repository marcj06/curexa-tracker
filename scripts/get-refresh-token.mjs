#!/usr/bin/env node
/* One-time setup: sign in with the personal Microsoft account that holds the
   tracker workbook, and print the refresh token for Vercel env vars.

   Usage:  node scripts/get-refresh-token.mjs <MS_CLIENT_ID>
   (Node 18+. Requires the Azure app registration to have
   "Allow public client flows" = Yes.)
*/

const clientId = process.argv[2] || process.env.MS_CLIENT_ID;
const tenant = process.argv[3] || process.env.MS_TENANT || "consumers";
if (!clientId) {
  console.error("Usage: node scripts/get-refresh-token.mjs <MS_CLIENT_ID> [tenant]");
  console.error("  tenant: omit for a personal Microsoft account; use the tenant ID or");
  console.error("  domain (e.g. petepharma.com) for an M365 work account.");
  process.exit(1);
}

const AUTH = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
const SCOPE = "offline_access Files.ReadWrite Mail.Send User.Read";

const dc = await (await fetch(`${AUTH}/devicecode`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: clientId, scope: SCOPE }),
})).json();

if (!dc.user_code) {
  console.error("Could not start sign-in:", dc.error_description || dc);
  process.exit(1);
}

console.log("\n1. Open:   " + dc.verification_uri);
console.log("2. Enter:  " + dc.user_code);
console.log("3. Sign in with the Microsoft account that holds the tracker workbook.\n");
console.log("Waiting for you to finish signing in…");

const started = Date.now();
while (Date.now() - started < (dc.expires_in || 900) * 1000) {
  await new Promise(r => setTimeout(r, (dc.interval || 5) * 1000));
  const res = await fetch(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: dc.device_code,
    }),
  });
  const tok = await res.json();
  if (tok.error === "authorization_pending") continue;
  if (tok.error) { console.error("Sign-in failed:", tok.error_description || tok.error); process.exit(1); }

  const me = await (await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  })).json();

  console.log(`\nSigned in as: ${me.displayName || ""} <${me.userPrincipalName || me.mail || ""}>\n`);
  console.log("Add these to your Vercel project (Settings → Environment Variables):\n");
  console.log("  MS_CLIENT_ID     = " + clientId);
  console.log("  MS_REFRESH_TOKEN = " + tok.refresh_token);
  console.log("\nKeep the refresh token secret — it grants access to this account's OneDrive and mail.");
  process.exit(0);
}
console.error("Timed out. Run the script again.");
process.exit(1);
