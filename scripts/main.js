/* =====================================================================================
 * com-artifacts — Foundry v13 — SINGLE FILE (paste-ready)
 * Includes:
 *  - Artifacts tab (ActorSheet) from your original working code
 *  - RollDialog injection (artifact approve checklist)
 *  - NEW: GM approval gate (independent window) + hotbar macro + auto-pop
 *  - NO CoM review window hooks
 * ===================================================================================== */

const MODULE_ID = "com-artifacts";
const COMA_SOCKET = `module.${MODULE_ID}`;

// RequestId -> player RollDialog app
globalThis._comaOpenRollDialogs ??= new Map();

// GM pending requests
globalThis._comaGMRequests ??= new Map();
globalThis._comaGMApp ??= null;

function comaLog(...a) { console.log(`${MODULE_ID} |`, ...a); }
function esc(s) { return Handlebars.escapeExpression(String(s ?? "")); }

/* =====================================================================================
 * READY + SOCKET
 * ===================================================================================== */
Hooks.once("ready", () => {
  comaLog("READY", { user: game.user?.name, isGM: game.user?.isGM });

  game.socket.on(COMA_SOCKET, (msg) => {
    try {
      if (!msg?.type) return;

      // GM receives a gate request -> store -> auto-open approvals window
      if (msg.type === "coma-gate-request" && game.user.isGM) {
        const requestId = String(msg.requestId ?? "");
        if (!requestId) return;

        globalThis._comaGMRequests.set(requestId, {
          ...msg,
          requestId,
          createdAt: Date.now()
        });

        // auto-pop approvals window
        try { openGMApprovals(); } catch (_) {}
        return;
      }

      // Player receives GM decision -> apply -> unblock confirm
      if (msg.type === "coma-gate-result" && msg.toUserId === game.user.id) {
        const app = globalThis._comaOpenRollDialogs.get(msg.requestId);
        if (!app) return;

        app._comaGateApproved = !!msg.approved;

        // rejected -> keep blocked
        if (!msg.approved) {
          try {
            const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
            $root?.find?.(".coma-waitline")?.html?.(`<strong>GM rejected.</strong> Close and try again.`);
          } catch (_) {}
          return;
        }

        // apply GM toggles to artifact checkboxes (if present)
        try {
          const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
          const $panel = $root?.find?.(".com-artifacts-roll");
          if ($panel?.length) {
            const inputs = $panel.find("input.com-approve").toArray();
            const toggles = Array.isArray(msg.artifactEntries) ? msg.artifactEntries : [];

            for (let i = 0; i < inputs.length; i++) {
              const el = inputs[i];
              const t = toggles[i];
              if (!t) continue;
              const changed = el.checked !== !!t.checked;
              el.checked = !!t.checked;
              if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
            }

            try { app._comArtifactsRecompute?.(); } catch (_) {}
          }
        } catch (_) {}

        // unblock
        unblockConfirm(app);
        app._comaGateDone = true;
        app._comaGatePending = false;
        return;
      }

    } catch (e) {
      console.warn(`${MODULE_ID} | socket handler error`, e);
    }
  });

  // expose macro function for GM hotbar
  game.comaOpenApprovals = openGMApprovals;

  // Create and assign hotbar macro (GM only)
  if (game.user?.isGM) {
    (async () => {
      try {
        const name = "GM Approvals (com-artifacts)";
        let macro = game.macros?.find(m => m.name === name);
        if (!macro) {
          macro = await Macro.create({
            name,
            type: "script",
            scope: "global",
            command: `game.comaOpenApprovals?.();`
          });
        }

        // Find empty hotbar slot 1..10
        let slot = null;
        for (let i = 1; i <= 10; i++) {
          const existing = game.user.hotbar?.[i];
          if (!existing) { slot = i; break; }
        }
        if (!slot) slot = 10;

        await game.user.assignHotbarMacro(macro, slot);
        comaLog(`Hotbar macro ready in slot ${slot}`);
      } catch (e) {
        console.warn(`${MODULE_ID} | macro assign failed`, e);
      }
    })();
  }
});

/* =====================================================================================
 * SELECTION (per-user, persisted on user flags)
 * ===================================================================================== */
globalThis.comArtifactsSelection ??= new Map();

function loadSelectionFromUserFlag(actorId) {
  try {
    const all = game.user.getFlag(MODULE_ID, "selection") ?? {};
    const arr = Array.isArray(all?.[actorId]) ? all[actorId] : [];
    return new Set(arr.filter(Boolean));
  } catch (e) {
    console.warn(`${MODULE_ID} | failed to read selection flag`, e);
    return new Set();
  }
}

let _selSaveTimer = null;
function scheduleSaveSelection(actorId) {
  if (_selSaveTimer) clearTimeout(_selSaveTimer);
  _selSaveTimer = setTimeout(async () => {
    try {
      const all = game.user.getFlag(MODULE_ID, "selection") ?? {};
      const set = globalThis.comArtifactsSelection.get(actorId) ?? new Set();
      all[actorId] = Array.from(set);
      await game.user.setFlag(MODULE_ID, "selection", all);
    } catch (e) {
      console.warn(`${MODULE_ID} | failed to save selection flag`, e);
    }
  }, 150);
}

function getSel(actorId) {
  if (!globalThis.comArtifactsSelection.has(actorId)) {
    globalThis.comArtifactsSelection.set(actorId, loadSelectionFromUserFlag(actorId));
  }
  return globalThis.comArtifactsSelection.get(actorId);
}

function toggleSel(actorId, key) {
  const s = getSel(actorId);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  scheduleSaveSelection(actorId);
  return s;
}

function clearSel(actorId) {
  globalThis.comArtifactsSelection.delete(actorId);
  scheduleSaveSelection(actorId);
}

/** Clears selection AND immediately removes yellow highlight on the open sheet (if any). */
function clearSelAndUnhighlight(actorId) {
  try {
    clearSel(actorId);

    const actor = game.actors.get(actorId);
    const sheet = actor?.sheet;

    if (sheet?.rendered && sheet?.element) {
      const $el = sheet.element.jquery ? sheet.element : $(sheet.element);
      $el.find(".com-tag-pick.com-picked").removeClass("com-picked");
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | clearSelAndUnhighlight failed`, e);
  }
}

/* =====================================================================================
 * STORAGE
 * ===================================================================================== */
function defaultArtifacts() {
  return [
    {
      name: "Artifact 1",
      img: "",
      power: [{ name: "", active: false }, { name: "", active: false }],
      weakness: { name: "", active: false }
    },
    {
      name: "Artifact 2",
      img: "",
      power: [{ name: "", active: false }, { name: "", active: false }],
      weakness: { name: "", active: false }
    }
  ];
}

async function getArtifacts(actor) {
  const data = (await actor.getFlag(MODULE_ID, "artifacts")) ?? defaultArtifacts();
  if (!Array.isArray(data) || data.length !== 2) return defaultArtifacts();
  return data;
}

async function setArtifacts(actor, artifacts) {
  return actor.setFlag(MODULE_ID, "artifacts", artifacts);
}

/* =====================================================================================
 * TAB HELPERS
 * ===================================================================================== */
function getActiveTab(html) {
  return html.find('nav.sheet-tabs a.item.active, nav.tabs a.item.active').data("tab");
}

function forceActivateTab(app, tab) {
  const tabs = app?._tabs?.[0];
  if (!tabs || !tab) return;
  setTimeout(() => { try { tabs.activate(tab); } catch (_) {} }, 0);
}

/* =====================================================================================
 * LOCK-AWARE EDITING (original)
 * ===================================================================================== */
function isSheetEditable(html) {
  const ref = html
    .find(`.sheet-body .tab:not([data-tab="${MODULE_ID}"]) input, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) textarea, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) select`)
    .filter((_, el) => el.offsetParent !== null);

  if (ref.length) return ref.toArray().some(el => !el.disabled);
  return true;
}

function setArtifactsEditable(html, editable) {
  const tab = html.find(`.sheet-body .tab[data-tab="${MODULE_ID}"]`);
  if (!tab.length) return;

  tab.find("button.com-pick-img, button.com-clear-img").prop("disabled", !editable);

  if (editable) {
    tab.find(".com-editor-only").prop("disabled", false).show();
    tab.find(".com-edit-tag").prop("disabled", false).show();

    tab.find(".com-tag-pick").each((_, el) => {
      const $el = $(el);
      const txt = ($el.text() ?? "").trim();
      const editing = $el.hasClass("com-editing");
      $el.toggle(!!txt || editing);
    });
  } else {
    tab.find(".com-editor-only").prop("disabled", true).hide();
    tab.find(".com-edit-tag").prop("disabled", true).hide();

    tab.find(".com-tag-pick").each((_, el) => {
      el.contentEditable = "false";
      $(el).removeClass("com-editing");
      const $el = $(el);
      const txt = ($el.text() ?? "").trim();
      $el.toggle(!!txt);
    });
  }

  tab.find(".com-tag-pick").css("pointer-events", "auto");
  tab.css("opacity", editable ? "" : "0.85");
}

function installLockObserver(app, html) {
  if (app._comLockObserverInstalled) return;
  app._comLockObserverInstalled = true;

  const root = html?.[0];
  if (!root) return;

  const obs = new MutationObserver(() => {
    try {
      const $root = $(root);
      const editable = isSheetEditable($root);
      setArtifactsEditable($root, editable);
    } catch (_) {}
  });

  obs.observe(root, { attributes: true, childList: true, subtree: true });
  app._comLockObserver = obs;
}

/* =====================================================================================
 * SHEET UI: ARTIFACTS TAB (your original working tab code)
 * ===================================================================================== */
function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  if (!document.getElementById("com-artifacts-inline-style")) {
    const style = document.createElement("style");
    style.id = "com-artifacts-inline-style";
    style.textContent = `
      .com-artifacts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .com-artifact { border: 1px solid var(--color-border-light-primary); border-radius: 8px; padding: 10px; }
      .com-artifact header { display:flex; gap:10px; align-items:center; }
      .com-artifact .img { width:64px; height:64px; border:1px solid var(--color-border-light-primary); border-radius:6px; background-size:cover; background-position:center; }
      .com-artifact .controls { display:flex; gap:8px; margin-top:8px; }
      .com-artifact .tag-row{ display:flex; justify-content:center; align-items:center; gap:6px; margin:6px 0; }
      .com-tag-pick { display:inline-block; padding:2px 6px; border-radius:4px; cursor:pointer; user-select:none; }
      .com-tag-pick.com-picked { background: #ffeb3b; }
      .com-tag-pick.com-weak.com-picked { background: #ffd54f; }
      .com-edit-tag{
        background:none !important; border:none !important;
        width:14px !important; min-width:14px !important; max-width:14px !important;
        height:14px !important; min-height:14px !important;
        padding:0 !important; margin:0 !important;
        display:inline-flex !important; align-items:center !important; justify-content:center !important;
        cursor:pointer; opacity:.65; font-size:11px; line-height:1;
      }
      .com-edit-tag:hover { opacity: 1; }
      .com-tag-pick:not(:empty){
        border: 1px solid transparent; border-radius: 6px; padding: 2px 8px;
      }
      .com-tag-pick:not(:empty):hover{
        border-color: rgba(120, 80, 160, .45);
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .15);
      }
      .com-tag-pick.com-editing{
        border-color: rgba(120, 80, 160, .65) !important;
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .22) !important;
        background: rgba(120, 80, 160, .06);
        outline: none;
      }
      .com-hidden-store{ display:none !important; }
      .com-artifact .hint { opacity: .8; font-size: 12px; margin-top: 8px; }
    `;
    document.head.appendChild(style);
  }

  const nav = html.find("nav.sheet-tabs, nav.tabs");
  if (!nav.length) return;

  if (nav.find(`a.item[data-tab="${MODULE_ID}"]`).length === 0) {
    nav.append(`<a class="item" data-tab="${MODULE_ID}">Artifacts</a>`);
  }

  const body = html.find(".sheet-body");
  if (!body.length) return;

  if (!body.find(`.tab[data-tab="${MODULE_ID}"]`).length) {
    body.append(`
      <div class="tab" data-tab="${MODULE_ID}">
        <div class="com-artifacts-grid"></div>
      </div>
    `);
  }

  function syncTagRowUI($row, editable) {
    const $pick = $row.find(".com-tag-pick");
    const $edit = $row.find(".com-edit-tag");
    const name = ($pick.text() ?? "").trim();
    const editing = $pick.hasClass("com-editing");

    if (!editable) {
      $edit.hide();
      $pick.toggle(!!name);
      return;
    }

    $edit.show();
    $pick.toggle(!!name || editing);
  }

  function placeCaretAtEnd(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function startInlineEdit($row, editable) {
    if (!editable) return;

    const $pick = $row.find(".com-tag-pick");
    const $store = $row.find("input.com-hidden-store");

    $pick.show();
    $pick.addClass("com-editing");

    const el = $pick[0];
    el.contentEditable = "true";
    el.focus();
    if (!(($pick.text() ?? "").trim()) && ($store.val() ?? "")) {
      $pick.text(($store.val() ?? "").trim());
    }
    placeCaretAtEnd(el);
  }

  function cancelInlineEdit($row) {
    const $pick = $row.find(".com-tag-pick");
    const $store = $row.find("input.com-hidden-store");
    $pick.text(($store.val() ?? "").trim());
    $pick[0].contentEditable = "false";
    $pick.removeClass("com-editing");
  }

  function commitInlineEdit($row) {
    const $pick = $row.find(".com-tag-pick");
    const $store = $row.find("input.com-hidden-store");
    const newVal = (($pick.text() ?? "").trim());
    $store.val(newVal);
    $store.trigger("change");
    $pick[0].contentEditable = "false";
    $pick.removeClass("com-editing");
  }

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);

    const renderTagRow = ({ pickKey, isWeak, field, value }) => {
      const label = ((value ?? "").trim());
      const hasValue = !!label;

      return `
        <div class="tag-row" data-field="${field}">
          <span class="com-tag-pick ${isWeak ? "com-weak" : ""}" data-pick="${pickKey}" style="${hasValue ? "" : "display:none;"}">
            ${esc(label)}
          </span>
          <button type="button" class="com-edit-tag" title="${hasValue ? "Edit" : "Add"}">✎</button>
          <input class="com-editor-only com-hidden-store" type="text" data-field="${field}" value="${esc(value ?? "")}" />
        </div>
      `;
    };

    const renderSlot = (a, idx) => {
      const imgStyle = a.img ? `style="background-image:url('${a.img.replace(/'/g, "%27")}')"` : "";
      return `
        <section class="com-artifact" data-idx="${idx}">
          <header>
            <div class="img" ${imgStyle}></div>
            <div class="name" style="flex:1">
              <label>Artifact Name</label>
              <input class="com-editor-only" type="text" data-field="name" value="${esc(a.name ?? "")}" />
            </div>
          </header>

          <div class="controls">
            <button type="button" class="com-pick-img"><i class="fas fa-image"></i> Image</button>
            <button type="button" class="com-clear-img"><i class="fas fa-trash"></i> Clear</button>
          </div>

          <div class="tags">
            <label>Power Tags (click to mark)</label>
            ${renderTagRow({ pickKey: `a${idx}.p0`, isWeak: false, field: "power.0.name", value: a.power?.[0]?.name ?? "" })}
            ${renderTagRow({ pickKey: `a${idx}.p1`, isWeak: false, field: "power.1.name", value: a.power?.[1]?.name ?? "" })}

            <label style="margin-top:8px; display:block;">Weakness Tag (click to mark)</label>
            ${renderTagRow({ pickKey: `a${idx}.w`, isWeak: true, field: "weakness.name", value: a.weakness?.name ?? "" })}
          </div>

          <div class="hint">Click tag names to highlight. Highlighted tags appear in Make Roll for MC approval.</div>
        </section>
      `;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // restore highlight from selection
    const s = getSel(actor.id);
    grid.find(".com-tag-pick").each((_, el) => {
      const key = el.dataset.pick;
      if (s.has(key)) $(el).addClass("com-picked");
    });

    // click-to-highlight
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pick", (ev) => {
      if ($(ev.currentTarget).hasClass("com-editing")) return;
      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $(ev.currentTarget).toggleClass("com-picked", set.has(key));
    });

    // edit button
    grid.off("click.comArtifactsEdit").on("click.comArtifactsEdit", ".com-edit-tag", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const editable = isSheetEditable(html);
      if (!editable) return;

      const $row = $(ev.currentTarget).closest(".tag-row");
      startInlineEdit($row, editable);
      syncTagRowUI($row, true);
    });

    // key handling while editing
    grid.off("keydown.comArtifactsInline").on("keydown.comArtifactsInline", ".com-tag-pick.com-editing", (ev) => {
      const $row = $(ev.currentTarget).closest(".tag-row");

      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        commitInlineEdit($row);
        const editable = isSheetEditable(html);
        syncTagRowUI($row, editable);
        return;
      }

      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        cancelInlineEdit($row);
        const editable = isSheetEditable(html);
        syncTagRowUI($row, editable);
        return;
      }
    });

    // blur saves
    grid.off("blur.comArtifactsInline").on("blur.comArtifactsInline", ".com-tag-pick.com-editing", (ev) => {
      const $row = $(ev.currentTarget).closest(".tag-row");
      commitInlineEdit($row);
      const editable = isSheetEditable(html);
      syncTagRowUI($row, editable);
    });

    // save changes
    grid.off("change.comArtifacts").on("change.comArtifacts", "input", async (ev) => {
      const tab = getActiveTab(html) || MODULE_ID;
      app._comLastTab = tab;

      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const field = ev.currentTarget.dataset.field;
      if (!field) return;

      const artifacts2 = await getArtifacts(actor);
      const path = field.split(".");
      let ref = artifacts2[idx];
      for (let i = 0; i < path.length - 1; i++) ref = ref[path[i]];
      const lastKey = path[path.length - 1];
      ref[lastKey] = ev.currentTarget.value;

      const $section = $(section);
      if (field === "power.0.name") $section.find(`.com-tag-pick[data-pick="a${idx}.p0"]`).text(ev.currentTarget.value.trim());
      if (field === "power.1.name") $section.find(`.com-tag-pick[data-pick="a${idx}.p1"]`).text(ev.currentTarget.value.trim());
      if (field === "weakness.name") $section.find(`.com-tag-pick[data-pick="a${idx}.w"]`).text(ev.currentTarget.value.trim());

      await setArtifacts(actor, artifacts2);
      forceActivateTab(app, app._comLastTab);

      const editable = isSheetEditable(html);
      $section.find(".tag-row").each((_, rowEl) => syncTagRowUI($(rowEl), editable));
      setArtifactsEditable(html, editable);
    });

    // image pick/clear
    grid.off("click.comArtifactsImg").on("click.comArtifactsImg", ".com-pick-img", async (ev) => {
      const tab = getActiveTab(html) || MODULE_ID;
      app._comLastTab = tab;

      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const artifacts2 = await getArtifacts(actor);

      new FilePicker({
        type: "image",
        current: artifacts2[idx].img || "",
        callback: async (path) => {
          artifacts2[idx].img = path;
          await setArtifacts(actor, artifacts2);
          app.render(false);
          forceActivateTab(app, app._comLastTab);
        }
      }).browse();
    });

    grid.off("click.comArtifactsClear").on("click.comArtifactsClear", ".com-clear-img", async (ev) => {
      const tab = getActiveTab(html) || MODULE_ID;
      app._comLastTab = tab;

      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const artifacts2 = await getArtifacts(actor);
      artifacts2[idx].img = "";
      await setArtifacts(actor, artifacts2);
      app.render(false);
      forceActivateTab(app, app._comLastTab);
    });

    const editable = isSheetEditable(html);
    setArtifactsEditable(html, editable);
    installLockObserver(app, html);
    grid.find(".tag-row").each((_, rowEl) => syncTagRowUI($(rowEl), editable));
  })();
}

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app?.actor;
  if (!actor) return;

  const $html = html?.jquery ? html : $(html);

  const tab = getActiveTab($html);
  if (tab) app._comLastTab = tab;

  ensureArtifactsTab(app, $html, actor);

  forceActivateTab(app, app._comLastTab);

  const editable = isSheetEditable($html);
  setArtifactsEditable($html, editable);
  installLockObserver(app, $html);
});

/* =====================================================================================
 * ROLLDIALOG INJECTION + GM GATE
 * ===================================================================================== */
function findCustomModifierInput($root) {
  const labels = $root.find("label").toArray();
  for (const el of labels) {
    const txt = (el.textContent ?? "").trim().toLowerCase();
    if (txt === "custom modifier") {
      const $wrap = $(el).closest("div");
      const $input = $wrap.find("input").first();
      if ($input.length) return $input;
    }
  }
  const $cand = $root.find('input[type="number"], input[type="text"]').filter((_, i) => i.offsetParent !== null).first();
  return $cand.length ? $cand : null;
}

function buildArtifactEntriesForGM(artifacts, selSet) {
  const out = [];
  for (let a = 0; a < 2; a++) {
    const art = artifacts[a] ?? {};
    const p0 = (art.power?.[0]?.name ?? "").trim();
    const p1 = (art.power?.[1]?.name ?? "").trim();
    const w  = (art.weakness?.name ?? "").trim();

    if (selSet.has(`a${a}.p0`) && p0) out.push({ kind: "artifact-power", artifactIdx: a, label: p0, mod: +1, checked: true });
    if (selSet.has(`a${a}.p1`) && p1) out.push({ kind: "artifact-power", artifactIdx: a, label: p1, mod: +1, checked: true });

    // always include weakness as an option (default checked if player selected it)
    if (w) out.push({ kind: "artifact-weak", artifactIdx: a, label: w, mod: -1, checked: selSet.has(`a${a}.w`) });
  }
  return out;
}

function ensureBlockerStyles() {
  if (document.getElementById("coma-blocker-style")) return;
  const s = document.createElement("style");
  s.id = "coma-blocker-style";
  s.textContent = `
    .coma-confirm-blocker{
      position:absolute; inset:0;
      background:rgba(140,140,140,.35);
      border-radius:6px;
      cursor:not-allowed;
      display:flex;
      align-items:center;
      justify-content:center;
      pointer-events:auto;
      z-index:10;
    }
    .coma-confirm-blocker .inner{
      background:rgba(255,255,255,.70);
      padding:4px 8px;
      border-radius:6px;
      font-size:12px;
      opacity:.95;
      user-select:none;
    }
    .coma-waitline{
      margin-top:8px;
      opacity:.85;
      font-size:12px;
    }
  `;
  document.head.appendChild(s);
}

function blockConfirm(app, $root) {
  ensureBlockerStyles();
  const $confirmBtn =
    $root.find("button.dialog-button")
      .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
      .first();

  if (!$confirmBtn.length) return;

  const $wrap = $confirmBtn.parent();
  $wrap.css("position", "relative");
  if ($wrap.find(".coma-confirm-blocker").length) return;

  $wrap.append(`
    <div class="coma-confirm-blocker">
      <div class="inner">Waiting for GM approval…</div>
    </div>
  `);

  if (!$root.find(".coma-waitline").length) {
    $root.find("form").first().append(`<div class="coma-waitline"><strong>Waiting for GM approval…</strong></div>`);
  }

  app._comaConfirmBlocked = true;
}

function unblockConfirm(app) {
  try {
    const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
    if (!$root?.length) return;
    $root.find(".coma-confirm-blocker").remove();
    $root.find(".coma-waitline").remove();
    app._comaConfirmBlocked = false;
  } catch (_) {}
}

// Conservative normal tag scan (optional)
function scanNormalTagsFromRollDialog($root) {
  try {
    const out = [];
    const $rows = $root.find(".tag-name-block.tag, .tag-name-block.story-tag, .tag-name-block").filter((_, el) => el.offsetParent !== null);
    if (!$rows.length) return out;

    $rows.each((i, el) => {
      const name = ($(el).find(".flex-tag-name, .tag-name, .name").text() || el.textContent || "").trim();
      if (!name) return;
      const hasWeak = $(el).find(".fa-angle-double-down").length > 0;
      const mod = hasWeak ? -1 : +1;
      out.push({ label: name, mod, checked: true });
    });

    const seen = new Set();
    return out.filter(e => (seen.has(e.label) ? false : (seen.add(e.label), true)));
  } catch (_) {
    return [];
  }
}

/* -------------------------------- GM Approval App --------------------------------- */
class ComaGMApprovalApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "coma-gm-approvals",
      title: "Pending Roll Approvals",
      width: 460,
      height: "auto",
      resizable: true
    });
  }

  async _renderInner() {
    const reqs = Array.from(globalThis._comaGMRequests.values())
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    if (!reqs.length) {
      return `<div style="padding:10px; opacity:.85;">No pending approvals.</div>`;
    }

    const cards = reqs.map(r => {
      const art = Array.isArray(r.artifactEntries) ? r.artifactEntries : [];
      const norm = Array.isArray(r.normalEntries) ? r.normalEntries : [];

      const powerArtifacts = new Set(art.filter(e => e.kind === "artifact-power" && e.checked).map(e => Number(e.artifactIdx)));

      const weaknessOptions = (r.artifactsMeta ?? [])
        .filter(m => powerArtifacts.has(Number(m.artifactIdx)) && (m.weaknessLabel ?? "").trim())
        .map(m => `
          <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
            <input type="checkbox" class="coma-gm-add-weak" data-req="${esc(r.requestId)}" data-artifact-idx="${Number(m.artifactIdx)}">
            <span><strong>Add weakness:</strong> ${esc(m.weaknessLabel)}</span>
            <span style="margin-left:auto; opacity:.8;">-1</span>
          </label>
        `).join("");

      return `
        <section class="coma-card" style="border:1px solid var(--color-border-light-primary); border-radius:8px; padding:10px; margin:10px;">
          <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
            <div style="opacity:.9;">
              <div><strong>Player:</strong> ${esc(r.fromUserName)}</div>
              <div><strong>Actor:</strong> ${esc(r.actorName)}</div>
            </div>
            <div style="opacity:.7; font-size:12px; white-space:nowrap;">${esc(r.requestId)}</div>
          </div>

          <div style="margin-top:10px;">
            <fieldset style="padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
              <legend>Artifacts</legend>
              <div style="display:flex; flex-direction:column; gap:6px; max-height:220px; overflow:auto;">
                ${
                  art.length
                    ? art.map((e, idx) => `
                      <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox"
                               class="coma-gm-art"
                               data-req="${esc(r.requestId)}"
                               data-idx="${idx}"
                               ${e.checked ? "checked" : ""}>
                        <span>${esc(e.label)}</span>
                        <span style="margin-left:auto; opacity:.8;">${Number(e.mod) > 0 ? "+1" : "-1"}</span>
                      </label>
                    `).join("")
                    : `<div style="opacity:.75;">(no artifacts)</div>`
                }
              </div>

              ${weaknessOptions ? `<hr style="opacity:.35; margin:8px 0;">${weaknessOptions}` : ``}
            </fieldset>

            <fieldset style="padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px; margin-top:10px;">
              <legend>Normal Tags</legend>
              <div style="display:flex; flex-direction:column; gap:6px; max-height:180px; overflow:auto;">
                ${
                  norm.length
                    ? norm.map((e, idx) => `
                      <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox"
                               class="coma-gm-norm"
                               data-req="${esc(r.requestId)}"
                               data-idx="${idx}"
                               ${e.checked ? "checked" : ""}>
                        <span>${esc(e.label)}</span>
                        <span style="margin-left:auto; opacity:.8;">${Number(e.mod) > 0 ? "+1" : "-1"}</span>
                      </label>
                    `).join("")
                    : `<div style="opacity:.75;">(no normal tags detected)</div>`
                }
              </div>
            </fieldset>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
            <button type="button" class="coma-gm-reject" data-req="${esc(r.requestId)}">Reject</button>
            <button type="button" class="coma-gm-approve" data-req="${esc(r.requestId)}">Approve</button>
          </div>
        </section>
      `;
    }).join("");

    return `<div>${cards}</div>`;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.off("click.comaApprove").on("click.comaApprove", ".coma-gm-approve", (ev) => {
      ev.preventDefault();
      const requestId = ev.currentTarget.dataset.req;
      const r = globalThis._comaGMRequests.get(requestId);
      if (!r) return;

      const art = (r.artifactEntries ?? []).map(e => ({ ...e }));
      html.find(`input.coma-gm-art[data-req="${CSS.escape(requestId)}"]`).each((_, el) => {
        const idx = Number(el.dataset.idx);
        if (!Number.isFinite(idx) || !art[idx]) return;
        art[idx].checked = !!el.checked;
      });

      // Apply “add weakness”
      const addWeak = [];
      html.find(`input.coma-gm-add-weak[data-req="${CSS.escape(requestId)}"]`).each((_, el) => {
        if (el.checked) addWeak.push(Number(el.dataset.artifactIdx));
      });
      if (addWeak.length) {
        for (const aIdx of addWeak) {
          const wIdx = art.findIndex(x => x.kind === "artifact-weak" && Number(x.artifactIdx) === Number(aIdx));
          if (wIdx >= 0) art[wIdx].checked = true;
        }
      }

      const norm = (r.normalEntries ?? []).map(e => ({ ...e }));
      html.find(`input.coma-gm-norm[data-req="${CSS.escape(requestId)}"]`).each((_, el) => {
        const idx = Number(el.dataset.idx);
        if (!Number.isFinite(idx) || !norm[idx]) return;
        norm[idx].checked = !!el.checked;
      });

      game.socket.emit(COMA_SOCKET, {
        type: "coma-gate-result",
        requestId,
        toUserId: r.fromUserId,
        actorId: r.actorId,
        approved: true,
        artifactEntries: art,
        normalEntries: norm
      });

      globalThis._comaGMRequests.delete(requestId);
      this.render(false);
    });

    html.off("click.comaReject").on("click.comaReject", ".coma-gm-reject", (ev) => {
      ev.preventDefault();
      const requestId = ev.currentTarget.dataset.req;
      const r = globalThis._comaGMRequests.get(requestId);
      if (!r) return;

      game.socket.emit(COMA_SOCKET, {
        type: "coma-gate-result",
        requestId,
        toUserId: r.fromUserId,
        actorId: r.actorId,
        approved: false,
        artifactEntries: [],
        normalEntries: []
      });

      globalThis._comaGMRequests.delete(requestId);
      this.render(false);
    });
  }
}

function openGMApprovals() {
  if (!game.user?.isGM) return ui.notifications?.warn?.("GM only.");
  if (!globalThis._comaGMApp) globalThis._comaGMApp = new ComaGMApprovalApp();
  globalThis._comaGMApp.render(true);
}

/* -------------------------------- RollDialog Hook --------------------------------- */
Hooks.on("renderRollDialog", async (app, html) => {
  try {
    const $root =
      html?.jquery ? html :
      html ? $(html) :
      app?.element ? (app.element.jquery ? app.element : $(app.element)) :
      null;
    if (!$root || !$root.length) return;

    const actor =
      app.actor ??
      app.options?.actor ??
      (app.options?.actorId ? game.actors.get(app.options.actorId) : null) ??
      game.user.character;
    if (!actor) return;

    // Avoid double-inject
    if ($root.find(".com-artifacts-roll").length) {
      // still ensure confirm gate handler exists below
    }

    const $modInput = findCustomModifierInput($root);
    if (!$modInput || !$modInput.length) return;

    // Base mod per dialog instance
    if (!Number.isFinite(app._comArtifactsBaseMod)) {
      const base = Number($modInput.val() ?? 0);
      app._comArtifactsBaseMod = Number.isFinite(base) ? base : 0;
    }

    // inject artifact panel once
    if ($root.find(".com-artifacts-roll").length === 0) {
      const artifacts = await getArtifacts(actor);
      const sel = getSel(actor.id);
      const entries = buildArtifactEntriesForGM(artifacts, sel).filter(e => e.kind !== "artifact-weak" || e.checked || true);

      const $form = $root.find("form").first();
      const $mount = $form.length ? $form : $root;

      const $panel = $(`
        <fieldset class="com-artifacts-roll" style="margin-top:10px; padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
          <legend>Artifacts</legend>
          <div class="com-artifacts-approve" style="display:flex; flex-direction:column; gap:6px;">
            ${
              entries.length
                ? entries.map(e => `
                  <label style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" class="com-approve" data-mod="${e.mod}" ${e.checked ? "checked" : ""} />
                    <span>${esc(e.label)}</span>
                    <span style="margin-left:auto; opacity:.8;">${e.mod > 0 ? "+1" : "-1"}</span>
                  </label>
                `).join("")
                : `<div style="opacity:.8;">No highlighted artifact tags.</div>`
            }
          </div>
          <div class="form-group" style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <span>Artifact modifier:</span>
            <strong class="com-artifacts-mod">+0</strong>
          </div>
        </fieldset>
      `);

      $mount.append($panel);

      function recomputeAndApply() {
        let mod = 0;
        $panel.find("input.com-approve:checked").each((_, el) => {
          mod += Number(el.dataset.mod ?? 0);
        });

        $panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod}`);

        $modInput.val((app._comArtifactsBaseMod ?? 0) + mod);
        $modInput.trigger("input");
        $modInput.trigger("change");
      }

      app._comArtifactsRecompute = recomputeAndApply;
      recomputeAndApply();
      $panel.on("change", "input.com-approve", recomputeAndApply);
    }

    // ===== GM GATE on Confirm (player only) =====
    if (!game.user.isGM) {
      if (!app._comaRequestId) app._comaRequestId = foundry.utils.randomID();
      globalThis._comaOpenRollDialogs.set(app._comaRequestId, app);

      const $confirmBtn =
        $root.find("button.dialog-button")
          .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
          .first();

      if ($confirmBtn?.length) {
        $confirmBtn.off("click.comaGate").on("click.comaGate", async (ev) => {
          // If already approved -> let it pass
          if (app._comaGateDone && app._comaGateApproved) return;

          // Block until GM approves
          ev.preventDefault();
          ev.stopPropagation();

          // If already pending, keep blocked
          if (app._comaGatePending) {
            blockConfirm(app, $root);
            return false;
          }

          app._comaGatePending = true;
          blockConfirm(app, $root);

          const artifacts = await getArtifacts(actor);
          const sel = getSel(actor.id);

          const artifactEntries = buildArtifactEntriesForGM(artifacts, sel);

          const artifactsMeta = [0, 1].map(aIdx => ({
            artifactIdx: aIdx,
            weaknessLabel: (artifacts?.[aIdx]?.weakness?.name ?? "").trim()
          }));

          const normalEntries = scanNormalTagsFromRollDialog($root);

          game.socket.emit(COMA_SOCKET, {
            type: "coma-gate-request",
            requestId: app._comaRequestId,
            fromUserId: game.user.id,
            fromUserName: game.user.name,
            actorId: actor.id,
            actorName: actor.name,
            artifactEntries,
            artifactsMeta,
            normalEntries
          });

          return false;
        });
      }
    }

    // Clear artifact selection after real confirm (only if GM approved)
    app._comArtifactsActorId = actor.id;
    app._comArtifactsConfirmed = false;

    const $confirmBtn2 =
      $root.find("button.dialog-button")
        .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
        .first();

    if ($confirmBtn2?.length) {
      $confirmBtn2.off("click.comArtifactsClearOnConfirm").on("click.comArtifactsClearOnConfirm", () => {
        if (!(app._comaGateDone && app._comaGateApproved)) return;
        app._comArtifactsConfirmed = true;

        setTimeout(() => { try { clearSelAndUnhighlight(actor.id); } catch (_) {} }, 0);
        setTimeout(() => { try { clearSelAndUnhighlight(actor.id); } catch (_) {} }, 250);
      });
    }

  } catch (e) {
    console.error(`${MODULE_ID} | renderRollDialog failed`, e);
  }
});

/* =====================================================================================
 * CLEANUP
 * ===================================================================================== */
Hooks.on("closeApplication", (app) => {
  try {
    if (app?._comaRequestId) globalThis._comaOpenRollDialogs.delete(app._comaRequestId);

    if (app?._comArtifactsConfirmed && app?._comArtifactsActorId) {
      try { clearSelAndUnhighlight(app._comArtifactsActorId); } catch (_) {}
    }
  } catch (_) {}
});
