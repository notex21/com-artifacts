const MODULE_ID = "com-artifacts";
const SOCKET_NS = `module.${MODULE_ID}`;

/* -------------------- Client-side selection (per-user, NO actor updates) -------------------- */
/**
 * Per-client selection (NOT shared automatically)
 * Map<actorId, Set<key>>
 */
globalThis.comArtifactsSelection ??= new Map();

function getSel(actorId) {
  if (!globalThis.comArtifactsSelection.has(actorId)) {
    globalThis.comArtifactsSelection.set(actorId, new Set());
  }
  return globalThis.comArtifactsSelection.get(actorId);
}

function toggleSel(actorId, key) {
  const s = getSel(actorId);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  return s;
}

function clearSel(actorId) {
  globalThis.comArtifactsSelection.delete(actorId);
}

/* -------------------- GM-side: receive selections from players -------------------- */
/**
 * On GM: Map<actorId, Map<userId, string[]>>
 * Stores latest selection snapshot per player, per actor.
 */
globalThis.comArtifactsGMInbox ??= new Map();

function gmStoreSelection(actorId, userId, keys) {
  if (!game.user?.isGM) return;
  if (!globalThis.comArtifactsGMInbox.has(actorId)) {
    globalThis.comArtifactsGMInbox.set(actorId, new Map());
  }
  globalThis.comArtifactsGMInbox.get(actorId).set(userId, Array.isArray(keys) ? keys : []);
}

function gmGetMergedSelection(actorId) {
  // GM view: merge all players' selections for that actor into one Set
  const out = new Set();
  const byUser = globalThis.comArtifactsGMInbox.get(actorId);
  if (!byUser) return out;
  for (const keys of byUser.values()) {
    for (const k of keys ?? []) out.add(k);
  }
  return out;
}

function sendSelectionToGM(actorId) {
  // players + gm can emit; GM will ignore if not needed
  const keys = [...getSel(actorId)];
  try {
    game.socket.emit(SOCKET_NS, {
      t: "sel",
      actorId,
      userId: game.user?.id,
      keys
    });
  } catch (_) {}
}

Hooks.once("ready", () => {
  try {
    game.socket.on(SOCKET_NS, (msg) => {
      if (!msg || msg.t !== "sel") return;
      // Only GM stores inbox
      if (!game.user?.isGM) return;
      if (!msg.actorId || !msg.userId) return;
      gmStoreSelection(msg.actorId, msg.userId, msg.keys);
    });
  } catch (_) {}
});

/* -------------------- Storage -------------------- */

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

/* -------------------- Tab preservation helpers -------------------- */

function getActiveTab(html) {
  return html.find('nav.sheet-tabs a.item.active, nav.tabs a.item.active').data("tab");
}

function forceActivateTab(app, tab) {
  const tabs = app?._tabs?.[0];
  if (!tabs || !tab) return;
  setTimeout(() => {
    try { tabs.activate(tab); } catch (_) {}
  }, 0);
}

/* -------------------- Lock-aware editing (Artifacts tab matches sheet lock) -------------------- */

function isSheetEditable(html) {
  const ref = html
    .find(`.sheet-body .tab:not([data-tab="${MODULE_ID}"]) input, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) textarea, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) select`)
    .filter((_, el) => el.offsetParent !== null);

  if (ref.length) {
    const anyEnabled = ref.toArray().some(el => !el.disabled);
    return anyEnabled;
  }
  return true;
}

function setArtifactsEditable(html, editable) {
  const tab = html.find(`.sheet-body .tab[data-tab="${MODULE_ID}"]`);
  if (!tab.length) return;

  tab.find("button.com-pick-img, button.com-clear-img").prop("disabled", !editable);

  if (editable) {
    tab.find(".com-editor-only").prop("disabled", false).show();
    tab.find(".com-edit-tag").prop("disabled", false).show();
    tab.find(".com-tag-pick").show();
  } else {
    tab.find(".com-editor-only").prop("disabled", true).hide();
    tab.find(".com-edit-tag").prop("disabled", true).hide();

    tab.find(".com-tag-pick").each((_, el) => {
      const $el = $(el);
      const txt = ($el.text() ?? "").trim();
      $el.toggle(!!txt);
    });
  }

  // Tag picking stays active even when locked
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

      // Also re-sync per-row UI on lock flip
      $root.find(`.tab[data-tab="${MODULE_ID}"] .tag-row`).each((_, row) => {
        syncTagRowUI($(row), editable);
      });
    } catch (_) {}
  });

  obs.observe(root, { attributes: true, childList: true, subtree: true });
  app._comLockObserver = obs;
}

/* -------------------- Sheet UI: Add "Artifacts" tab -------------------- */

function syncTagRowUI($row, editable) {
  const $pick = $row.find(".com-tag-pick");
  const $edit = $row.find(".com-edit-tag");

  const name = ($pick.text() ?? "").trim();
  const editing = $row.data("editing") === 1;

  if (!editable) {
    // Locked: no edit buttons; show only non-empty pick
    $edit.hide();
    $pick
      .attr("contenteditable", "false")
      .removeClass("com-editing");
    $row.data("editing", 0);
    $pick.toggle(!!name);
    return;
  }

  // Editable:
  if (editing) {
    // In editing mode: show pick even if empty, hide edit button
    $pick.show().addClass("com-editing");
    $edit.hide();
    return;
  }

  // Not editing:
  $pick.removeClass("com-editing").attr("contenteditable", "false");

  if (name) {
    // Named: show pick + edit
    $pick.show();
    $edit.show();
  } else {
    // Empty: show ONLY edit button
    $pick.hide();
    $edit.show();
  }
}

async function writeFieldToActor(actor, idx, field, value) {
  const artifacts2 = await getArtifacts(actor);
  const path = field.split(".");
  let ref = artifacts2[idx];
  for (let i = 0; i < path.length - 1; i++) ref = ref[path[i]];
  const lastKey = path[path.length - 1];
  ref[lastKey] = value;
  await setArtifacts(actor, artifacts2);
}

function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  // Inject CSS once
  if (!document.getElementById("com-artifacts-inline-style")) {
    const style = document.createElement("style");
    style.id = "com-artifacts-inline-style";
    style.textContent = `
      .com-artifacts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .com-artifact { border: 1px solid var(--color-border-light-primary); border-radius: 8px; padding: 10px; }
      .com-artifact header { display:flex; gap:10px; align-items:center; }
      .com-artifact .img { width:64px; height:64px; border:1px solid var(--color-border-light-primary); border-radius:6px; background-size:cover; background-position:center; }

      .com-artifact .controls { display:flex; gap:8px; margin-top:8px; }

      /* Center tag rows in the artifact column */
      .com-artifact .tag-row{
        display:flex;
        justify-content:center;
        align-items:center;
        gap:6px;
        margin:6px 0;
      }

      .com-tag-pick{
        display:inline-block;
        cursor:pointer;
        user-select:none;
        padding:2px 8px;
        border-radius:6px;
        border:1px solid transparent;
      }
      .com-tag-pick.com-picked { background: #ffeb3b; }
      .com-tag-pick.com-weak.com-picked { background: #ffd54f; }

      /* faint purple hover outline (like CoM) */
      .com-tag-pick:not(:empty):hover{
        border-color: rgba(120, 80, 160, .45);
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .15);
      }

      /* when inline editing */
      .com-tag-pick.com-editing{
        border-color: rgba(120, 80, 160, .65) !important;
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .22) !important;
        background: rgba(120, 80, 160, .06);
        outline: none;
      }

      /* Small edit button */
      .com-edit-tag{
        background:none !important;
        border:none !important;

        width:14px !important;
        min-width:14px !important;
        max-width:14px !important;

        height:14px !important;
        min-height:14px !important;

        padding:0 !important;
        margin:0 !important;

        display:inline-flex !important;
        align-items:center !important;
        justify-content:center !important;

        cursor:pointer;
        opacity:.65;
        font-size:11px;
        line-height:1;
      }
      .com-edit-tag:hover { opacity: 1; }

      .com-artifact .hint { opacity: .8; font-size: 12px; margin-top: 8px; }

      /* Review Tags window injection */
      .com-artifacts-review-block{
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--color-border-light-primary);
      }
      .com-artifacts-review-block h3{
        margin: 0 0 6px 0;
        font-size: 13px;
      }
      .com-artifacts-review-item{
        display:flex;
        justify-content:space-between;
        gap:10px;
        margin: 4px 0;
      }
      .com-artifacts-review-item .mod{
        opacity:.8;
        min-width: 28px;
        text-align:right;
      }
    `;
    document.head.appendChild(style);
  }

  const nav = html.find('nav.sheet-tabs, nav.tabs');
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

  const renderTagRow = ({ pickKey, isWeak, field, value }) => {
    const label = ((value ?? "").trim());
    const hasValue = !!label;

    return `
      <div class="tag-row" data-field="${field}">
        <span
          class="com-tag-pick ${isWeak ? "com-weak" : ""}"
          data-pick="${pickKey}"
          data-field="${field}"
          style="${hasValue ? "" : "display:none;"}"
        >${Handlebars.escapeExpression(label)}</span>

        <button type="button"
          class="com-edit-tag"
          title="${hasValue ? "Edit" : "Add"}"
        >✎</button>
      </div>
    `;
  };

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);

    const renderSlot = (a, idx) => {
      const imgStyle = a.img ? `style="background-image:url('${a.img.replace(/'/g, "%27")}')"` : "";

      return `
      <section class="com-artifact" data-idx="${idx}">
        <header>
          <div class="img" ${imgStyle}></div>
          <div class="name" style="flex:1">
            <label>Artifact Name</label>
            <input class="com-editor-only" type="text" data-field="name" value="${Handlebars.escapeExpression(a.name ?? "")}" />
          </div>
        </header>

        <div class="controls">
          <button type="button" class="com-pick-img"><i class="fas fa-image"></i> Image</button>
          <button type="button" class="com-clear-img"><i class="fas fa-trash"></i> Clear</button>
        </div>

        <div class="tags">
          <label>Power Tags (click to mark)</label>

          ${renderTagRow({
            pickKey: `a${idx}.p0`,
            isWeak: false,
            field: "power.0.name",
            value: a.power?.[0]?.name ?? ""
          })}

          ${renderTagRow({
            pickKey: `a${idx}.p1`,
            isWeak: false,
            field: "power.1.name",
            value: a.power?.[1]?.name ?? ""
          })}

          <label style="margin-top:8px; display:block;">Weakness Tag (click to mark)</label>

          ${renderTagRow({
            pickKey: `a${idx}.w`,
            isWeak: true,
            field: "weakness.name",
            value: a.weakness?.name ?? ""
          })}
        </div>

        <div class="hint">
          Click tag names to highlight. Highlighted tags appear in Make Roll for MC approval.
        </div>
      </section>`;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // Restore highlight state for THIS client
    const s = getSel(actor.id);
    grid.find(".com-tag-pick").each((_, el) => {
      const key = el.dataset.pick;
      if (s.has(key)) $(el).addClass("com-picked");
    });

    // Click-to-highlight (NO actor writes)
    // IMPORTANT: do NOT block GM vs player; this is purely local and always allowed if tag exists.
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pick", (ev) => {
      const $pick = $(ev.currentTarget);
      // If currently editing name, don't toggle highlight on click (so editing is not painful)
      if ($pick.closest(".tag-row").data("editing") === 1) return;

      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $pick.toggleClass("com-picked", set.has(key));

      // Sync to GM so Review Tags can show it reliably
      sendSelectionToGM(actor.id);
    });

    // Edit button -> inline edit on the span (no input field)
    grid.off("click.comArtifactsEdit").on("click.comArtifactsEdit", ".com-edit-tag", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const editable = isSheetEditable(html);
      if (!editable) return;

      const $row = $(ev.currentTarget).closest(".tag-row");
      const $section = $row.closest(".com-artifact");
      const idx = Number($section.data("idx"));
      const field = $row.data("field");

      let $pick = $row.find(".com-tag-pick");
      if (!$pick.length) return;

      // If empty, temporarily show it for editing
      $row.data("editing", 1);
      $pick.show().addClass("com-editing").attr("contenteditable", "true");

      // Put caret at end
      const el = $pick[0];
      el.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}

      syncTagRowUI($row, true);

      // One-time handlers: Enter commits; Escape cancels; blur commits
      const commit = async (cancel = false) => {
        $pick.off("keydown.comArtifactsInline");
        $pick.off("blur.comArtifactsInline");

        const raw = ($pick.text() ?? "");
        const next = cancel ? raw : raw; // we still read, but cancel will revert below

        // Revert from actor if cancel
        if (cancel) {
          const currentArtifacts = await getArtifacts(actor);
          let current = "";
          if (field === "power.0.name") current = currentArtifacts[idx]?.power?.[0]?.name ?? "";
          if (field === "power.1.name") current = currentArtifacts[idx]?.power?.[1]?.name ?? "";
          if (field === "weakness.name") current = currentArtifacts[idx]?.weakness?.name ?? "";
          $pick.text((current ?? "").trim());
        } else {
          const trimmed = (next ?? "").trim();
          $pick.text(trimmed);

          // Save to actor
          await writeFieldToActor(actor, idx, field, trimmed);
        }

        $pick.attr("contenteditable", "false").removeClass("com-editing");
        $row.data("editing", 0);

        // If user erased the name, also clear highlight for that key on this client (optional but cleaner)
        const key = $pick.data("pick");
        if (!($pick.text() ?? "").trim()) {
          const set = getSel(actor.id);
          if (set.has(key)) {
            set.delete(key);
            $pick.removeClass("com-picked");
            sendSelectionToGM(actor.id);
          }
        }

        const editableNow = isSheetEditable(html);
        syncTagRowUI($row, editableNow);
      };

      $pick.off("keydown.comArtifactsInline").on("keydown.comArtifactsInline", async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await commit(false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          await commit(true);
        }
      });

      $pick.off("blur.comArtifactsInline").on("blur.comArtifactsInline", async () => {
        await commit(false);
      });
    });

    // Save artifact name field (still an input)
    grid.off("change.comArtifactsName").on("change.comArtifactsName", "input.com-editor-only", async (ev) => {
      const tab = getActiveTab(html) || MODULE_ID;
      app._comLastTab = tab;

      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const field = ev.currentTarget.dataset.field;
      if (!field) return;

      await writeFieldToActor(actor, idx, field, ev.currentTarget.value ?? "");
      forceActivateTab(app, app._comLastTab);

      const editable = isSheetEditable(html);
      setArtifactsEditable(html, editable);
    });

    // Image pick/clear
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

    grid.off("click.comArtifactsClr").on("click.comArtifactsClr", ".com-clear-img", async (ev) => {
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

    // Apply lock state + per-row UI
    const editable = isSheetEditable(html);
    setArtifactsEditable(html, editable);
    installLockObserver(app, html);

    grid.find(".tag-row").each((_, rowEl) => syncTagRowUI($(rowEl), editable));

    // Initial sync to GM (so GM sees current selection even before first roll)
    sendSelectionToGM(actor.id);
  })();
}

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app?.actor;
  if (!actor) return;

  const tab = getActiveTab(html);
  if (tab) app._comLastTab = tab;

  ensureArtifactsTab(app, html, actor);

  forceActivateTab(app, app._comLastTab);

  const editable = isSheetEditable(html);
  setArtifactsEditable(html, editable);
  installLockObserver(app, html);
});

/* -------------------- RollDialog: show highlighted artifact tags for approval -------------------- */

function findCustomModifierInput(html) {
  const labels = html.find("label");
  for (const el of labels) {
    const txt = (el.textContent ?? "").trim().toLowerCase();
    if (txt === "custom modifier") {
      const input = $(el).closest(".form-group, .form-fields, div").find("input").first();
      if (input?.length) return input;
    }
  }

  const inputs = html.find("input");
  for (const el of inputs) {
    const $el = $(el);
    const ph = ($el.attr("placeholder") ?? "").toLowerCase();
    const aria = ($el.attr("aria-label") ?? "").toLowerCase();
    if (ph.includes("modifier") || aria.includes("modifier")) return $el;
  }

  const any = html.find('input[type="number"], input[type="text"]').first();
  return any?.length ? any : null;
}

Hooks.on("renderRollDialog", async (app, html) => {
  try {
    const actor =
      app.actor ??
      app.options?.actor ??
      (app.options?.actorId ? game.actors.get(app.options.actorId) : null) ??
      game.user.character;

    if (!actor) return;

    const artifacts = await getArtifacts(actor);

    // IMPORTANT:
    // - Player uses their LOCAL selection
    // - GM uses merged selection (so they can test too)
    const sel = game.user?.isGM ? gmGetMergedSelection(actor.id) : getSel(actor.id);

    const form = html.find("form");
    if (!form.length) return;

    if (form.find(".com-artifacts-roll").length) return;

    const modInput = findCustomModifierInput(html);
    if (!modInput || !modInput.length) return;

    if (!Number.isFinite(app._comArtifactsBaseMod)) {
      const base = Number(modInput.val() ?? 0);
      app._comArtifactsBaseMod = Number.isFinite(base) ? base : 0;
    }

    function selectedEntries() {
      const out = [];
      for (let a = 0; a < 2; a++) {
        const art = artifacts[a];

        if (sel.has(`a${a}.p0`) && (art.power?.[0]?.name ?? "").trim())
          out.push({ label: art.power[0].name, mod: +1 });

        if (sel.has(`a${a}.p1`) && (art.power?.[1]?.name ?? "").trim())
          out.push({ label: art.power[1].name, mod: +1 });

        if (sel.has(`a${a}.w`) && (art.weakness?.name ?? "").trim())
          out.push({ label: art.weakness.name, mod: -1 });
      }
      return out;
    }

    const entries = selectedEntries();

    const panel = $(`
      <fieldset class="com-artifacts-roll" style="margin-top:10px; padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
        <legend>Artifacts</legend>

        <div class="com-artifacts-approve" style="display:flex; flex-direction:column; gap:6px;">
          ${
            entries.length
              ? entries.map(e => `
                <label style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" class="com-approve" data-mod="${e.mod}" checked />
                  <span>${Handlebars.escapeExpression(e.label)}</span>
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

    form.append(panel);

    function recomputeAndApply() {
      let mod = 0;
      panel.find("input.com-approve:checked").each((_, el) => {
        mod += Number(el.dataset.mod ?? 0);
      });

      panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod}`);

      modInput.val((app._comArtifactsBaseMod ?? 0) + mod);
      modInput.trigger("input");
      modInput.trigger("change");
    }

    recomputeAndApply();
    panel.on("change", "input.com-approve", recomputeAndApply);

    // Clear ONLY this client's selection after submitting the roll (so next roll works for players)
    form.off("submit.comArtifacts").on("submit.comArtifacts", () => {
      if (!game.user?.isGM) {
        clearSel(actor.id);
        sendSelectionToGM(actor.id);
      }
    });

  } catch (e) {
    console.error("com-artifacts | renderRollDialog failed", e);
  }
});

/* -------------------- GM Review Tags window: show artifact tags there too -------------------- */
/**
 * We do not try to “inject into system approval logic”.
 * We show a dedicated "Artifacts" section so the MC can see what the player highlighted.
 */
function tryResolveReviewActor(app) {
  return (
    app?.actor ??
    app?.object?.actor ??
    (app?.options?.actorId ? game.actors.get(app.options.actorId) : null) ??
    (app?.options?.actor ? app.options.actor : null) ??
    null
  );
}

Hooks.on("renderApplication", async (app, html) => {
  try {
    if (!game.user?.isGM) return;

    const title = (app?.title ?? "").toLowerCase();
    const id = (app?.id ?? "").toLowerCase();
    const cls = (app?.constructor?.name ?? "").toLowerCase();

    // Heuristic match for City of Mist “Review Tags” window
    const looksLikeReview =
      title.includes("review tags") ||
      cls.includes("storytag") ||
      id.includes("story-tag") ||
      id.includes("review");

    if (!looksLikeReview) return;

    const actor = tryResolveReviewActor(app);
    if (!actor?.id) return;

    // Avoid duplicate insertion on re-render
    if (html.find(".com-artifacts-review-block").length) return;

    const artifacts = await getArtifacts(actor);
    const sel = gmGetMergedSelection(actor.id);

    const entries = [];
    for (let a = 0; a < 2; a++) {
      const art = artifacts[a];
      const p0 = (art.power?.[0]?.name ?? "").trim();
      const p1 = (art.power?.[1]?.name ?? "").trim();
      const w = (art.weakness?.name ?? "").trim();

      if (sel.has(`a${a}.p0`) && p0) entries.push({ label: p0, mod: +1 });
      if (sel.has(`a${a}.p1`) && p1) entries.push({ label: p1, mod: +1 });
      if (sel.has(`a${a}.w`) && w) entries.push({ label: w, mod: -1 });
    }

    const block = $(`
      <div class="com-artifacts-review-block">
        <h3>Artifacts</h3>
        ${
          entries.length
            ? entries.map(e => `
              <div class="com-artifacts-review-item">
                <div class="label">${Handlebars.escapeExpression(e.label)}</div>
                <div class="mod">${e.mod > 0 ? "+1" : "-1"}</div>
              </div>
            `).join("")
            : `<div style="opacity:.8;">No highlighted artifact tags.</div>`
        }
      </div>
    `);

    // Insert near bottom of the dialog content
    const target =
      html.find(".window-content").first().length ? html.find(".window-content").first()
      : html;

    target.append(block);
  } catch (e) {
    console.error("com-artifacts | renderApplication review inject failed", e);
  }
});
