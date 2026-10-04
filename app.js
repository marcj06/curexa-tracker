/* Pete Pharma x Curexa R&D Tracker — frontend.
   Talks to /api/* (Vercel functions). If the API is unreachable (e.g. opened
   as a static preview), falls back to the demo snapshot in demo-data.js. */
(() => {
  const CFG = window.TRACKER_CONFIG;
  const STAGES = CFG.STAGES.map(s => s.key);
  const SHORT = Object.fromEntries(CFG.STAGES.map(s => [s.key, s.short]));

  const state = {
    rows: [], notes: [], demo: false,
    view: "board", search: "", filter: "",
    openRowId: null,
  };

  const storeGet = k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const $ = (sel, el = document) => el.querySelector(sel);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "dataset") Object.assign(n.dataset, v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return n;
  };
  const esc = s => String(s ?? "");

  // ---------- data access ----------
  async function api(path, opts = {}) {
    const res = await fetch("/api/" + path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { showGate(); throw new Error("auth"); }
    if (!res.ok) {
      let msg = "Request failed";
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  async function loadData() {
    setSync("loading");
    try {
      const data = await api("tracker");
      state.rows = data.rows; state.notes = data.notes; state.demo = false;
      setSync("live");
    } catch (e) {
      if (e.message === "auth") return;
      // API unreachable → demo snapshot
      if (window.DEMO_DATA) {
        state.rows = structuredClone(window.DEMO_DATA.rows);
        state.notes = structuredClone(window.DEMO_DATA.notes);
        state.demo = true;
        setSync("demo");
        $("#demo-banner").hidden = false;
      } else {
        toast("Couldn't load the tracker: " + e.message, true);
      }
    }
    render();
  }

  function setSync(mode) {
    const s = $("#sync-status");
    s.className = "sync" + (mode === "live" ? " live" : mode === "demo" ? " demo" : "");
    s.textContent = mode === "live" ? "Live — synced to workbook"
      : mode === "demo" ? "Demo snapshot" : "Loading…";
  }

  // ---------- derived ----------
  const rowProgress = r => {
    const vals = STAGES.map(s => r.stages[s]);
    const applicable = vals.filter(v => v !== "N/A").length;
    if (!applicable) return 0;
    return Math.round(100 * vals.filter(v => v === "Completed").length / applicable);
  };

  function groupedProjects() {
    const q = state.search.trim().toLowerCase();
    const match = r => !q ||
      [r.project, r.sku, r.apis, r.dosageForm, r.id].join(" ").toLowerCase().includes(q);
    const pass = r => {
      if (!match(r)) return false;
      const vals = STAGES.map(s => r.stages[s]);
      if (state.filter === "Blocked") return vals.includes("Blocked");
      if (state.filter === "In Progress") return vals.includes("In Progress");
      if (state.filter === "active") return r.stages["Production"] !== "Completed";
      return true;
    };
    const map = new Map();
    for (const r of state.rows) {
      if (!pass(r)) continue;
      if (!map.has(r.project)) map.set(r.project, []);
      map.get(r.project).push(r);
    }
    return map;
  }

  // ---------- rendering ----------
  function render() {
    renderSummary();
    $("#view-board").hidden = state.view !== "board";
    $("#view-table").hidden = state.view !== "table";
    $("#view-notes").hidden = state.view !== "notes";
    if (state.view === "board") renderBoard();
    if (state.view === "table") renderTable();
    if (state.view === "notes") renderNotes();
    if (state.openRowId) renderDrawer();
  }

  function renderSummary() {
    const rows = state.rows;
    const projects = new Set(rows.map(r => r.project)).size;
    const blocked = rows.filter(r => STAGES.some(s => r.stages[s] === "Blocked"));
    const inProd = rows.filter(r => ["In Progress", "Completed"].includes(r.stages["Production"])).length;
    const awaitingFb = rows.filter(r => r.stages["Sample Feedback"] === "In Progress").length;
    const root = $("#summary");
    root.replaceChildren(
      el("div", { class: "stat" }, el("b", {}, String(projects)), el("span", {}, "projects")),
      el("div", { class: "stat" }, el("b", {}, String(rows.length)), el("span", {}, "SKUs / variants")),
      el("div", { class: "stat" + (blocked.length ? " alert" : "") },
        el("b", {}, String(blocked.length)), el("span", {}, "blocked — need material or info")),
      el("div", { class: "stat" }, el("b", {}, String(awaitingFb)), el("span", {}, "awaiting sample feedback")),
      el("div", { class: "stat" }, el("b", {}, String(inProd)), el("span", {}, "in or through production")),
    );
  }

  // The stage the project is "at": leftmost In Progress/Blocked (covers rework
  // where Formula Dev reopens after samples), else the first Not Started.
  const currentStage = r => {
    for (const s of STAGES) if (["In Progress", "Blocked"].includes(r.stages[s])) return s;
    for (const s of STAGES) if ((r.stages[s] || "Not Started") === "Not Started") return s;
    return null; // everything completed or N/A
  };

  const fmtDate = d => {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m[2]-1]} ${+m[3]}` : String(d);
  };

  const timelineFor = r => {
    const cur = currentStage(r);
    return el("div", { class: "timeline", role: "img",
      "aria-label": STAGES.map(s => `${s}: ${r.stages[s]}`).join("; ") },
      STAGES.map((s, i) => {
        const st = r.stages[s] || "Not Started";
        const prev = i > 0 ? (r.stages[STAGES[i - 1]] || "Not Started") : null;
        const cls = ["tl-stage"];
        if (i > 0 && (prev === "Completed" || prev === "N/A")) cls.push("li-fill");
        if (st === "Completed" || st === "N/A") cls.push("lo-fill");
        const node = el("span", { class: "tl-node", dataset: { s: st, cur: s === cur } });
        return el("span", { class: cls.join(" "), title: `${s} — ${st}${r.stageDates?.[s] ? " (" + r.stageDates[s] + ")" : ""}` },
          node,
          el("span", { class: "tl-label" + (s === cur ? " cur" : "") }, SHORT[s]),
          el("span", { class: "tl-date" }, fmtDate(r.stageDates?.[s])));
      }));
  };

  const railFor = (r, mini = false) =>
    el("div", { class: "rail" + (mini ? " mini" : ""), role: "img",
      "aria-label": STAGES.map(s => `${s}: ${r.stages[s]}`).join("; ") },
      STAGES.map(s => el("span", { class: "seg", dataset: { s: r.stages[s] || "Not Started" }, title: `${s} — ${r.stages[s] || "Not Started"}` }, SHORT[s])));

  function projectCard(project, rows) {
    const head = el("div", { class: "project-head" },
      el("h2", {}, project),
      el("span", { class: "project-meta" },
        `${rows[0].dosageForm || ""}${rows.length > 1 ? ` · ${rows.length} SKUs` : ""}`));
    const card = el("article", { class: "project-card" }, head);
    for (const r of rows) {
      card.append(el("button", { class: "sku-row", type: "button", onclick: () => openDrawer(r.id) },
        el("span", { class: "sku-top" },
          el("span", { class: "row-id" }, r.id),
          el("span", { class: "sku-name" }, r.sku && r.sku !== "—" ? r.sku : "Single formulation",
            el("span", { class: "sku-sub" }, esc(r.apis))),
          el("span", { class: "progress-pct" }, rowProgress(r) + "%")),
        timelineFor(r),
      ));
    }
    return card;
  }

  function renderBoard() {
    const root = $("#view-board");
    const groups = groupedProjects();
    root.replaceChildren();
    if (!groups.size) { root.append(el("p", { class: "empty" }, "No projects match. Clear the search or filter to see everything.")); return; }

    const sections = new Map(CFG.PROJECT_STATUSES.map(s => [s, []]));
    for (const [project, rows] of groups) {
      const ps = CFG.PROJECT_STATUSES.includes(rows[0].projectStatus) ? rows[0].projectStatus : "Active";
      sections.get(ps).push([project, rows]);
    }
    const onlyActive = CFG.PROJECT_STATUSES.every(s => s === "Active" || !sections.get(s).length);
    for (const status of CFG.PROJECT_STATUSES) {
      const list = sections.get(status);
      if (!list.length) continue;
      if (status === "Active") {
        if (!onlyActive) root.append(el("div", { class: "section-head" }, "Active", el("span", { class: "section-count" }, String(list.length))));
        list.forEach(([p, rows]) => root.append(projectCard(p, rows)));
      } else {
        const details = el("details", { class: "section" },
          el("summary", { class: "section-head" }, status, el("span", { class: "section-count" }, String(list.length))));
        list.forEach(([p, rows]) => details.append(projectCard(p, rows)));
        root.append(details);
      }
    }
  }

  function renderTable() {
    const root = $("#view-table");
    const groups = groupedProjects();
    const rows = [...groups.values()].flat();
    const thead = el("tr", {},
      ["ID", "Project", "SKU", "APIs", "Strengths", "Form", ...STAGES.map(s => SHORT[s]), "%"].map(h => el("th", {}, h)));
    const tbody = rows.map(r => el("tr", { onclick: () => openDrawer(r.id) },
      el("td", { class: "row-id" }, r.id),
      el("td", {}, r.project), el("td", {}, r.sku || "—"),
      el("td", {}, r.apis || ""), el("td", {}, r.strengths || ""), el("td", {}, r.dosageForm || ""),
      ...STAGES.map(s => el("td", {}, el("span", { class: "chip", dataset: { s: r.stages[s] || "Not Started" }, title: s }, r.stages[s] || "Not Started"))),
      el("td", {}, rowProgress(r) + "%"),
    ));
    root.replaceChildren(el("div", { class: "table-wrap" },
      el("table", { class: "data-table" }, el("thead", {}, thead), el("tbody", {}, tbody))));
  }

  function renderNotes() {
    const root = $("#view-notes");
    const q = state.search.trim().toLowerCase();
    const notes = [...state.notes].reverse()
      .filter(n => !q || [n.project, n.sku, n.note, n.author].join(" ").toLowerCase().includes(q));
    root.replaceChildren(...(notes.length ? notes.map(noteCard) :
      [el("p", { class: "empty" }, "No notes yet. Open a project and add the first one.")]));
  }

  const noteCard = n => el("div", { class: "note-card" },
    el("div", { class: "note-head" },
      el("span", {}, n.date), el("b", {}, n.project + (n.sku && n.sku !== "—" ? ` · ${n.sku}` : "")),
      el("span", {}, n.author)),
    el("div", { class: "note-body" }, n.note));

  // ---------- drawer ----------
  function openDrawer(rowId) { state.openRowId = rowId; renderDrawer(); }
  function closeDrawer() {
    state.openRowId = null;
    $("#drawer").hidden = true; $("#drawer-backdrop").hidden = true;
  }

  function renderDrawer() {
    const r = state.rows.find(x => x.id === state.openRowId);
    if (!r) return closeDrawer();
    const d = $("#drawer");
    const notes = state.notes.filter(n => n.project === r.project).slice().reverse();

    const stageList = el("div", { class: "stage-list" }, STAGES.map(s => {
      const sel = el("select", {
        "aria-label": `Status for ${s}`,
        onchange: ev => updateStage(r, s, ev.target.value, ev.target.closest(".stage-item")),
      }, CFG.STATUSES.map(v => el("option", { value: v, selected: (r.stages[s] || "Not Started") === v }, v)));
      return el("div", { class: "stage-item" },
        el("span", { class: "seg", dataset: { s: r.stages[s] || "Not Started" } }, SHORT[s]),
        el("label", {}, s, r.stageDates?.[s] ? el("span", { class: "stage-date" }, fmtDate(r.stageDates[s])) : null),
        sel);
    }));

    const psSel = el("select", { "aria-label": "Project section",
      onchange: ev => updateProjectSection(r, ev.target.value) },
      CFG.PROJECT_STATUSES.map(v => el("option", { value: v, selected: (r.projectStatus || "Active") === v }, v)));
    const sectionRow = el("p", { class: "fact section-row" }, el("b", {}, "Section: "), psSel);

    const samplesTouched = ["Samples to Curexa", "Sample Feedback"].some(s => (r.stages[s] || "Not Started") !== "Not Started");
    const reworkBtn = (r.stages["Formula Development"] === "Completed" && samplesTouched)
      ? el("button", { class: "btn quiet rework-btn", type: "button", onclick: () => returnToFormulaDev(r) },
          "Return to Formula Development")
      : null;

    const ta = el("textarea", { placeholder: "Add a note — feedback, blockers, decisions…" });
    const author = el("input", { placeholder: "Your name", value: storeGet("tracker.author") || "" });
    const noteForm = el("div", { class: "note-form" }, ta,
      el("div", { class: "note-controls" }, author,
        el("button", { class: "btn quiet", type: "button", onclick: () => submitNote(r, ta, author) }, "Add note")));

    d.replaceChildren(
      el("div", { class: "drawer-head" },
        el("div", {},
          el("span", { class: "row-id" }, r.id + (r.sku && r.sku !== "—" ? ` · ${r.sku}` : "")),
          el("h2", {}, r.project)),
        el("button", { class: "drawer-close", "aria-label": "Close", onclick: closeDrawer }, "×")),
      el("div", { class: "drawer-body" },
        el("h3", {}, "Formulation"),
        el("p", { class: "fact" }, el("b", {}, "APIs: "), esc(r.apis || "—")),
        el("p", { class: "fact" }, el("b", {}, "Strengths: "), esc(r.strengths || "—")),
        el("p", { class: "fact" }, el("b", {}, "Dosage form: "), esc(r.dosageForm || "—")),
        el("p", { class: "fact" }, el("b", {}, "Last updated: "), `${esc(r.lastUpdated || "—")} by ${esc(r.updatedBy || "—")}`),
        sectionRow,
        el("h3", {}, "Pipeline stages"), stageList, reworkBtn,
        el("h3", {}, `Notes — ${r.project}`), noteForm,
        ...notes.map(noteCard),
      ));
    d.hidden = false;
    $("#drawer-backdrop").hidden = false;
  }

  // ---------- actions ----------
  async function updateStage(r, stage, status, itemEl) {
    const prev = r.stages[stage];
    r.stages[stage] = status;
    itemEl?.classList.add("saving");
    if (state.demo) {
      itemEl?.classList.remove("saving");
      render(); toast("Demo mode — change not saved to the workbook");
      return;
    }
    try {
      const author = storeGet("tracker.author") || "Portal user";
      await api("update", { method: "POST", body: { rowId: r.id, stage, status, author } });
      r.lastUpdated = todayStr(); r.updatedBy = author;
      if (!r.stageDates) r.stageDates = {};
      r.stageDates[stage] = todayStr();
      toast(`${stage} → ${status}`);
    } catch (e) {
      r.stages[stage] = prev;
      toast("Couldn't save: " + e.message, true);
    }
    itemEl?.classList.remove("saving");
    render();
  }

  async function updateProjectSection(r, status) {
    const prev = r.projectStatus;
    const affected = state.rows.filter(x => x.project === r.project);
    affected.forEach(x => (x.projectStatus = status));
    if (state.demo) { render(); toast("Demo mode — change not saved to the workbook"); return; }
    try {
      const author = storeGet("tracker.author") || "Portal user";
      await api("update", { method: "POST", body: { project: r.project, projectStatus: status, author } });
      toast(`${r.project} → ${status}`);
    } catch (e) {
      affected.forEach(x => (x.projectStatus = prev));
      toast("Couldn't save: " + e.message, true);
    }
    render();
  }

  async function returnToFormulaDev(r) {
    await updateStage(r, "Formula Development", "In Progress");
    const author = storeGet("tracker.author") || "Portal user";
    const n = { date: todayStr(), project: r.project, sku: r.sku || "—", author,
      note: "Returned to Formula Development after sample review." };
    if (state.demo) { state.notes.push(n); render(); return; }
    try { await api("note", { method: "POST", body: n }); state.notes.push(n); render(); } catch {}
  }

  async function submitNote(r, ta, authorInput) {
    const note = ta.value.trim();
    const author = authorInput.value.trim() || "Portal user";
    if (!note) { ta.focus(); return; }
    storeSet("tracker.author", author);
    const n = { date: todayStr(), project: r.project, sku: r.sku || "—", author, note };
    if (state.demo) {
      state.notes.push(n); render(); toast("Demo mode — note not saved to the workbook");
      return;
    }
    try {
      await api("note", { method: "POST", body: n });
      state.notes.push(n); ta.value = "";
      render(); toast("Note added");
    } catch (e) { toast("Couldn't save the note: " + e.message, true); }
  }

  // ---------- intake modal ----------
  function openIntake() {
    const root = $("#modal-root");
    const skus = [];
    const skuWrap = el("div", {});
    const addSku = () => {
      const block = el("div", { class: "sku-block" });
      const fields = {
        sku: el("input", { placeholder: skus.length ? `SKU ${skus.length + 1}` : "e.g. SKU 1, 50 mg, — " }),
        apis: el("input", { placeholder: "APIs, separated by ; " }),
        strengths: el("input", { placeholder: "Strengths, separated by ; " }),
      };
      block.append(
        el("button", { class: "remove-sku", type: "button", "aria-label": "Remove SKU", onclick: () => { skus.splice(skus.indexOf(fields), 1); block.remove(); } }, "×"),
        el("div", { class: "field" }, el("label", {}, "SKU / variant label"), fields.sku),
        el("div", { class: "grid-2" },
          el("div", { class: "field" }, el("label", {}, "APIs"), fields.apis),
          el("div", { class: "field" }, el("label", {}, "Strengths"), fields.strengths)));
      skus.push(fields); skuWrap.append(block);
    };
    addSku();

    const f = {
      project: el("input", { placeholder: "e.g. Minoxidil/Finasteride Topical Solution", required: true }),
      dosageForm: el("input", { placeholder: "e.g. ODT, Topical Anhydrous, Sachet" }),
      requester: el("input", { placeholder: "Your name", value: storeGet("tracker.author") || "" }),
      notes: el("textarea", { rows: 3, placeholder: "Anything Pete Pharma needs to know — targets, references, timelines…" }),
    };

    const backdrop = el("div", { class: "modal-backdrop", onclick: ev => { if (ev.target === backdrop) close(); } },
      el("form", { class: "modal", onsubmit: ev => { ev.preventDefault(); submit(); } },
        el("h2", {}, "New project intake"),
        el("p", { class: "hint" }, "Adds the project to the tracker workbook and notifies Pete Pharma."),
        el("div", { class: "field" }, el("label", {}, "Project name"), f.project),
        el("div", { class: "grid-2" },
          el("div", { class: "field" }, el("label", {}, "Dosage form"), f.dosageForm),
          el("div", { class: "field" }, el("label", {}, "Requested by"), f.requester)),
        skuWrap,
        el("button", { class: "btn quiet", type: "button", onclick: addSku }, "Add another SKU"),
        el("div", { class: "field", style: "margin-top:12px" }, el("label", {}, "Notes"), f.notes),
        el("div", { class: "modal-actions" },
          el("button", { class: "btn quiet", type: "button", onclick: () => close() }, "Cancel"),
          el("button", { class: "btn primary", type: "submit", style: "background:var(--brand);border-color:var(--brand);color:#fff" }, "Submit project"))));
    const close = () => backdrop.remove();

    async function submit() {
      const project = f.project.value.trim();
      if (!project) { f.project.focus(); return; }
      const requester = f.requester.value.trim() || "Portal user";
      storeSet("tracker.author", requester);
      const payload = {
        project, dosageForm: f.dosageForm.value.trim(), requester,
        notes: f.notes.value.trim(),
        skus: skus.map(s => ({ sku: s.sku.value.trim() || "—", apis: s.apis.value.trim(), strengths: s.strengths.value.trim() }))
          .filter((s, i) => i === 0 || s.sku !== "—" || s.apis || s.strengths),
      };
      if (state.demo) {
        payload.skus.forEach((s, i) => state.rows.push({
          id: "R9" + String(state.rows.length + i).padStart(2, "0"), project, sku: s.sku,
          apis: s.apis, strengths: s.strengths, dosageForm: payload.dosageForm,
          stages: Object.fromEntries(STAGES.map(k => [k, k === "Initial Intake" ? "In Progress" : "Not Started"])),
          stageDates: { "Initial Intake": todayStr() }, projectStatus: "Active",
          lastUpdated: todayStr(), updatedBy: requester,
        }));
        close(); render(); toast("Demo mode — intake not saved to the workbook");
        return;
      }
      try {
        await api("intake", { method: "POST", body: payload });
        close(); toast("Project submitted — Pete Pharma has been notified");
        loadData();
      } catch (e) { toast("Couldn't submit: " + e.message, true); }
    }
    root.replaceChildren(backdrop);
  }

  // ---------- auth gate ----------
  function showGate() {
    $("#app").hidden = true; $("#gate").hidden = false;
    $("#gate-pass").focus();
  }
  async function tryLogin(ev) {
    ev.preventDefault();
    $("#gate-error").hidden = true;
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password: $("#gate-pass").value }),
      });
      if (!res.ok) throw new Error();
      $("#gate").hidden = true; $("#app").hidden = false;
      loadData();
    } catch { $("#gate-error").hidden = false; }
  }

  // ---------- misc ----------
  let toastTimer;
  function toast(msg, isError = false) {
    const t = $("#toast");
    t.textContent = msg; t.className = "toast" + (isError ? " error" : ""); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }
  const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());

  // ---------- boot ----------
  function boot() {
    $("#site-title").textContent = CFG.SITE_TITLE;
    $("#site-subtitle").textContent = CFG.SITE_SUBTITLE;
    document.querySelectorAll(".view-btn").forEach(b => b.addEventListener("click", () => {
      state.view = b.dataset.view;
      document.querySelectorAll(".view-btn").forEach(x => {
        x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b);
      });
      render();
    }));
    $("#search").addEventListener("input", ev => { state.search = ev.target.value; render(); });
    $("#filter-status").addEventListener("change", ev => { state.filter = ev.target.value; render(); });
    $("#btn-refresh").addEventListener("click", loadData);
    $("#btn-new").addEventListener("click", openIntake);
    $("#gate-form").addEventListener("submit", tryLogin);
    $("#drawer-backdrop").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", ev => { if (ev.key === "Escape") closeDrawer(); });

    $("#app").hidden = false;
    loadData();
  }
  boot();
})();
