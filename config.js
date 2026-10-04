// ============================================================================
// Pete Pharma x Curexa — R&D Tracker configuration (PUBLIC values only).
// Secrets (passwords, tokens, client IDs) live in Vercel env vars, never here.
// Edit and redeploy (or just re-upload) — no rebuild needed.
// ============================================================================
window.TRACKER_CONFIG = {
  SITE_TITLE: "R&D Project Tracker",
  SITE_SUBTITLE: "Pete Pharma × Curexa Pharmacy",

  // Pipeline stages, in order. Must match the Tracker sheet's column headers.
  STAGES: [
    { key: "Initial Intake",       short: "IN"  },
    { key: "APIs to Pete Pharma",  short: "API" },
    { key: "Formula Development",  short: "FD"  },
    { key: "Samples to Curexa",    short: "SMP" },
    { key: "Sample Feedback",      short: "FB"  },
    { key: "Formula Finalized",    short: "FF"  },
    { key: "SOP Finalized",        short: "SOP" },
    { key: "Production",           short: "PRD" },
  ],

  // Allowed status values. Must match the workbook's dropdown list.
  STATUSES: ["Not Started", "In Progress", "Blocked", "Completed", "N/A"],

  // Project sections, in display order. Must match the workbook's Project Status dropdown.
  PROJECT_STATUSES: ["Active", "Paused", "Licensed", "Not Feasible"],
};
