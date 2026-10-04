# Pete Pharma × Curexa — R&D Project Tracker

A password-protected portal on Vercel where Pete Pharma and Curexa track R&D
projects through the pipeline (Intake → APIs → Formula Dev → Samples → Feedback
→ Formula Finalized → SOP → Production).

**The Excel workbook is the database.** The site reads and writes
`Pete_Pharma_x_Curexa_RD_Tracker_v2.xlsx` on your OneDrive through Microsoft
Graph — so you can keep editing the workbook directly in Excel, and the site
always shows the same data. Same idea as the Rev Pharma sourcing portal, but:

- Visitors don't need Microsoft accounts. They enter one shared site password;
  a Vercel serverless function talks to Graph **as you** behind the scenes.
- All secrets live in Vercel environment variables — nothing sensitive is in
  the deployed files.

## What's in here

```
index.html, styles.css, app.js   the site (static, no build step)
config.js                        public config: stage names, titles
demo-data.js                     snapshot used only when the API is unreachable
api/                             Vercel serverless functions
  login.js                       password → session cookie
  tracker.js                     GET workbook data
  update.js                      change a stage status
  note.js                        add a note
  intake.js                      add a new project (one row per SKU)
  _lib/                          auth, Graph, notification helpers
scripts/get-refresh-token.mjs    one-time sign-in to mint the refresh token
```

## Setup (one time, ~20 minutes)

### 1. Put the workbook on your OneDrive

Upload `Pete_Pharma_x_Curexa_RD_Tracker_v2.xlsx` to your personal OneDrive,
e.g. into a folder called `CurexaTracker`. Don't rename the sheets
(`Tracker`, `Notes`), the tables (`TrackerTable`, `NotesTable`), or the column
headers — the site finds everything by those names.

### 2. Register an Azure app (free, no subscription needed)

1. Go to https://portal.azure.com and sign in **with the same personal
   Microsoft account** that holds the workbook.
2. Microsoft Entra ID → App registrations → **New registration**.
   - Name: `Curexa Tracker`
   - Supported account types: **Personal Microsoft accounts only**
   - Redirect URI: leave empty.
3. On the app's Overview page, copy the **Application (client) ID**.
4. Authentication → Advanced settings → **Allow public client flows: Yes** → Save.
5. API permissions → Add a permission → Microsoft Graph → Delegated:
   `Files.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access` → Add.
   (No admin consent needed — you consent at sign-in.)

### 3. Mint the refresh token

On any machine with Node 18+:

```bash
node scripts/get-refresh-token.mjs <your-client-id>
```

Follow the device-code sign-in prompts with your personal account. The script
prints `MS_REFRESH_TOKEN`. Treat it like a password.

### 4. Deploy to Vercel

1. Push this folder to a GitHub repo (or `vercel deploy` from the folder).
2. In the Vercel project → Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `SITE_PASSWORD` | the shared password you'll give Curexa & Pete Pharma |
| `SESSION_SECRET` | any long random string (e.g. `openssl rand -hex 32`) |
| `MS_CLIENT_ID` | from step 2 |
| `MS_REFRESH_TOKEN` | from step 3 |
| `WORKBOOK_PATH` | e.g. `/CurexaTracker/Pete_Pharma_x_Curexa_RD_Tracker_v2.xlsx` |
| `NOTIFY_EMAIL` | who gets emailed on changes (comma-separated is fine) |
| `NOTIFY_ON` | optional — any of `intake,status,note` (default: all three) |
| `MS_TENANT` | optional — omit for a personal Microsoft account; set to the tenant ID or domain (e.g. `petepharma.com`) if the workbook lives in an M365 work account |

3. Redeploy so the env vars take effect. Done — share the URL + password.

### 5. (Recommended) Keep the token fresh automatically

Personal-account refresh tokens expire after ~90 days of no use, and Microsoft
rotates them on every refresh. Out of the box the site uses the env-var token;
if the site goes unused for 90+ days you'd re-run step 3. To avoid that
entirely, add the free Upstash Redis integration (Vercel → Marketplace →
Upstash → add to this project). It injects `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`, and the site then stores each rotated token
automatically. Nothing else to configure.

## Day-to-day

- **Sections**: each project has a Project Status (Active / Paused / Licensed /
  Not Feasible) — column G in the workbook, or the "Section" dropdown in a
  project's detail panel. The board groups projects by it.
- **Stage dates**: when a stage status changes on the site, the date is stamped
  into the matching "...Date" column (S–Z) and shows under the timeline nodes.
- **Everyone**: open the site, enter the password, see the pipeline. Click any
  SKU row for details, change stage statuses, add notes, submit new projects.
- **You**: keep editing the workbook in Excel whenever you like — the site
  reflects it on next refresh. Status cells must use the dropdown values.
- **Notifications**: every intake, status change, and note emails
  `NOTIFY_EMAIL` from your own mailbox.

## Troubleshooting

- **"Token refresh failed"** in the sync area → re-run step 3 and update
  `MS_REFRESH_TOKEN` in Vercel (then redeploy). Happens if the token expired
  (90+ days unused) or the account password changed.
- **"Row not found" after reordering** → someone sorted the Tracker table;
  that's fine, the site looks rows up by Row ID — just refresh.
- **Demo banner showing** → the browser couldn't reach `/api/*`. On Vercel
  that means env vars are missing or a function crashed — check the Vercel
  function logs.
- **Someone renamed a column** → the API maps columns by header name; restore
  the original headers (see the workbook's ReadMe sheet).
