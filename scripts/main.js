const MODULE_ID = "com-artifacts";

/* =====================================================================================
 * SOCKET: GM MIRROR (optional approval UI)
 * ===================================================================================== */
const COMA_SOCKET = `module.${MODULE_ID}`;
globalThis._comaOpenRollDialogs ??= new Map();

function comaLog(...a) { console.log(`${MODULE_ID} |`, ...a); }

Hooks.once("ready", () => {
  comaLog("READY", { user: game.user?.name, isGM: game.user?.isGM });

  game.socket.on(COMA_SOCKET, (msg) => {
    try {
      if (!msg?.type) return;

      // GM receives request -> show mirror dialog
      if (msg.type === "coma-mirror-request" && game.user.isGM) {
        const entries = Array.isArray(msg.entries) ? msg.entries : [];

        const content = `
          <div>
            <div style="opacity:.85; margin-bottom:6px;">
              <div><strong>From:</strong> ${Handlebars.escapeExpression(msg.fromUserName ?? "")}</div>
              <div><strong>Actor:</strong> ${Handlebars.escapeExpression(msg.actorName ?? "")}</div>
            </div>

            <fieldset style="padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
              <legend>Artifacts (Mirror)</legend>
              <div style="display:flex; flex-direction:column; gap:6px; max-height:320px; overflow:auto;">
                ${
                  entries.length
                    ? entries.map((e) => `
                      <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" class="coma-approve" data-idx="${Number(e.idx)}" ${e.checked ? "checked" : ""}/>
                        <span>${Handlebars.escapeExpression(e.label ?? "")}</span>
                        <span style="margin-left:auto; opacity:.8;">${Number(e.mod) > 0 ? "+1" : "-1"}</span>
                      </label>
                    `).join("")
                    : `<div style="opacity:.8;">No highlighted artifact tags.</div>`
                }
              </div>
            </fieldset>
          </div>
        `;

        new Dialog({
          title: "Review Tags",
          content,
          buttons: {
            apply: {
              label: "Approve",
              callback: (html) => {
                const root = html?.[0];
                const checks = Array.from(root.querySelectorAll("input.coma-approve[data-idx]"));
                const toggles = entries.map((e) => {
                  const idx = Number(e.idx);
                  const c = checks.find(x => Number(x.getAttribute("data-idx")) === idx);
                  return { ...e, checked: c ? c.checked : !!e.checked };
                });

                game.socket.emit(COMA_SOCKET, {
                  type: "coma-mirror-result",
                  requestId: msg.requestId,
                  toUserId: msg.fromUserId,
                  toggles
                });
              }
            },
            close: { label: "Close" }
          },
          default: "apply"
        }).render(true);

        return;
      }

      // Player receives result -> apply to their open RollDialog
      if (msg.type === "coma-mirror-result" && msg.toUserId === game.user.id) {
        const app = globalThis._comaOpenRollDialogs.get(msg.requestId);
        if (!app) return;

        const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
        if (!$root?.length) return;

        const $panel = $root.find(".com-artifacts-roll");
        if (!$panel.length) return;

        const inputs = $panel.find("input.com-approve").toArray();
        for (const t of (msg.toggles ?? [])) {
          const el = inputs[Number(t.idx)];
          if (!el) continue;
          const changed = el.checked !== !!t.checked;
          el.checked = !!t.checked;
          if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        if (typeof app._comArtifactsRecompute === "function") {
          try { app._comArtifactsRecompute(); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | socket handler error`, e);
    }
  });
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
 * LOCK DETECTION (system sheet lock)
 * ===================================================================================== */
function isSheetUnlocked(html) {
  // Your existing robust method: if other tabs have enabled inputs -> unlocked
  const ref = html
    .find(`.sheet-body .tab:not([data-tab="${MODULE_ID}"]) input, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) textarea, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) select`)
    .filter((_, el) => el.offsetParent !== null);

  if (ref.length) return ref.toArray().some(el => !el.disabled);
  return true;
}

/* =====================================================================================
 * SHEET UI: ARTIFACTS TAB
 * ===================================================================================== */
function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  // per-sheet edit state: one button per artifact card
  app._comArtifactEdit ??= [false, false];

  if (!document.getElementById("com-artifacts-inline-style")) {
    const style = document.createElement("style");
    style.id = "com-artifacts-inline-style";
    style.textContent = `
      .com-artifacts-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .com-artifact {
        border: 1px solid var(--color-border-light-primary);
        border-radius: 10px;
        padding: 12px;
      }

      .com-artifact .com-topbar{
        display:flex;
        align-items:center;
        justify-content:flex-end;
        margin-bottom: 6px;
      }

      .com-artifact .com-edit-toggle{
        background: rgba(120, 80, 160, .12);
        border: 1px solid rgba(120, 80, 160, .55);
        border-radius: 8px;
        padding: 3px 10px;
        cursor:pointer;
        font-size: 12px;
        color: var(--color-text-hyperlink);
        display:inline-flex;
        align-items:center;
        gap:6px;
      }
      .com-artifact .com-edit-toggle[disabled]{ opacity:.55; cursor:default; }

      .com-center { display:flex; flex-direction:column; align-items:center; gap:10px; }

      /* Name */
      .com-name-display{
        font-size: 1.5em;
        font-weight: 600;
        color: var(--color-text-hyperlink);
        text-align:center;
        line-height: 1.1;
        max-width: 100%;
        word-break: break-word;
        margin-top: 2px;
      }

      .com-name-input{
        width: 100%;
        max-width: 320px;
      }

      /* Big square image (3x) */
      .com-artifact-img{
        width: 192px;
        height: 192px;
        border: 1px solid var(--color-border-light-primary);
        border-radius: 10px;
        background-size: cover;
        background-position: center;
        background-repeat:no-repeat;
        display:flex;
        align-items:center;
        justify-content:center;
        user-select:none;
      }
      .com-artifact-img.com-img-clickable{ cursor:pointer; }
      .com-artifact-img.com-img-disabled{ cursor:default; opacity:.85; }

      .com-artifact-img .com-img-ph{
        font-size: 42px;
        opacity: .85;
        color: var(--color-text-hyperlink);
      }

      /* Purple areas */
      .com-tag-box{
        width: 192px;
        border-radius: 10px;
        padding: 8px 10px;
        margin-top: 8px;
        border: 1px solid rgba(120, 80, 160, .55);
        background: rgba(120, 80, 160, .10);
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .08);
      }

      .com-tag-box-title{
        font-size: 12px;
        opacity: .85;
        margin-bottom: 6px;
        text-align:center;
      }

      .com-tag-row{
        display:flex;
        justify-content:center;
        align-items:center;
        margin: 6px 0;
      }

      .com-tag-pick{
        display:inline-flex;
        align-items:center;
        gap: 8px;
        padding: 4px 10px;
        border-radius: 10px;
        user-select:none;
        border: 1px solid transparent;
        max-width: 100%;
      }

      /* Non-edit mode: clickable for select/deselect */
      .com-tag-pick.com-pickable{ cursor:pointer; }
      .com-tag-pick.com-pickable:hover{
        border-color: rgba(120, 80, 160, .45);
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .12);
      }

      /* Edit mode: editable text UI */
      .com-tag-pick.com-editable{
        cursor:text;
        border-color: rgba(120, 80, 160, .35);
        background: rgba(255,255,255,.35);
      }

      .com-tag-pick .com-tag-icon{ opacity: .9; }
      .com-tag-pick .com-tag-text{ display:inline-block; outline:none; }

      .com-tag-pick.com-picked { background: #ffeb3b; }
      .com-tag-pick.com-weak.com-picked { background: #ffd54f; }

      .com-hidden-store{ display:none !important; }

      .com-artifact .hint { opacity: .8; font-size: 12px; margin-top: 10px; text-align:center; }
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

  function applyCardMode($section, { sheetUnlocked, editOn }) {
    // Name
    $section.find(".com-name-display").toggle(!editOn);
    $section.find(".com-name-input").toggle(editOn).prop("disabled", !editOn);

    // Tags: show only filled in non-edit; show all in edit with (empty)
    $section.find(".com-tag-pick").each((_, el) => {
      const $tag = $(el);
      const key = el.dataset.pick;
      const isEmpty = (($tag.find(".com-tag-text").text() ?? "").trim() === "" || ($tag.find(".com-tag-text").text() ?? "").trim() === "(empty)");
      $tag.toggle(editOn || !isEmpty);

      $tag.toggleClass("com-pickable", !editOn);
      $tag.toggleClass("com-editable", editOn);

      // disable contenteditable when not editing
      const txtEl = $tag.find(".com-tag-text")[0];
      if (txtEl) txtEl.contentEditable = editOn ? "true" : "false";
      if (!editOn) $tag.removeClass("com-editing");
    });

    // Image clickable only when sheet is unlocked AND editOn
    const $img = $section.find(".com-artifact-img");
    $img.toggleClass("com-img-clickable", !!(sheetUnlocked && editOn));
    $img.toggleClass("com-img-disabled", !(sheetUnlocked && editOn));

    // Edit button only usable if sheet unlocked
    const $btn = $section.find("button.com-edit-toggle");
    $btn.prop("disabled", !sheetUnlocked);
    $btn.attr("aria-pressed", editOn ? "true" : "false");
    $btn.find(".com-edit-label").text(editOn ? "Done" : "Edit");
  }

  function syncAllCardModes($grid) {
    const sheetUnlocked = isSheetUnlocked(html);
    $grid.find(".com-artifact").each((_, sec) => {
      const idx = Number(sec.dataset.idx);
      const editOn = !!app._comArtifactEdit?.[idx];
      applyCardMode($(sec), { sheetUnlocked, editOn });
    });
  }

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);

    const renderTagRow = ({ pickKey, isWeak, field, value, iconClass }) => {
      const label = ((value ?? "").trim());
      const shown = label || "(empty)";
      return `
        <div class="tag-row" data-field="${field}">
          <span class="com-tag-pick ${isWeak ? "com-weak" : ""}" data-pick="${pickKey}">
            <i class="fas ${iconClass} com-tag-icon"></i>
            <span class="com-tag-text">${Handlebars.escapeExpression(shown)}</span>
          </span>
          <input class="com-hidden-store" type="text" data-field="${field}" value="${Handlebars.escapeExpression(label)}" />
        </div>
      `;
    };

    const renderSlot = (a, idx) => {
      const name = ((a.name ?? "").trim()) || `Artifact ${idx + 1}`;
      const imgStyle = a.img ? `style="background-image:url('${a.img.replace(/'/g, "%27")}')"` : "";
      const hasImg = !!(a.img ?? "").trim();

      return `
        <section class="com-artifact" data-idx="${idx}">
          <div class="com-topbar">
            <button type="button" class="com-edit-toggle" data-idx="${idx}">
              <i class="fas fa-pen"></i> <span class="com-edit-label">Edit</span>
            </button>
          </div>

          <div class="com-center">
            <div class="com-name-display">${Handlebars.escapeExpression(name)}</div>
            <input class="com-name-input" type="text" data-field="name" value="${Handlebars.escapeExpression(a.name ?? "")}" />

            <div class="com-artifact-img" data-action="pick-image" ${imgStyle}>
              ${hasImg ? "" : `<i class="fas fa-image com-img-ph"></i>`}
            </div>

            <div class="com-tag-box">
              <div class="com-tag-box-title">Power Tags</div>
              ${renderTagRow({ pickKey: `a${idx}.p0`, isWeak: false, field: "power.0.name", value: a.power?.[0]?.name ?? "", iconClass: "fa-bolt" })}
              ${renderTagRow({ pickKey: `a${idx}.p1`, isWeak: false, field: "power.1.name", value: a.power?.[1]?.name ?? "", iconClass: "fa-bolt" })}
            </div>

            <div class="com-tag-box">
              <div class="com-tag-box-title">Weakness Tag</div>
              ${renderTagRow({ pickKey: `a${idx}.w`, isWeak: true, field: "weakness.name", value: a.weakness?.name ?? "", iconClass: "fa-angle-double-down" })}
            </div>

            <div class="hint">Select tags when not editing. Edit tag text only in Edit mode.</div>
          </div>
        </section>
      `;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // Restore highlight from selection
    const s = getSel(actor.id);
    grid.find(".com-tag-pick").each((_, el) => {
      const key = el.dataset.pick;
      if (s.has(key)) $(el).addClass("com-picked");
    });

    // Initial mode application
    syncAllCardModes(grid);

    // Keep modes in sync when sheet lock changes
    if (!app._comLockObserverInstalled) {
      app._comLockObserverInstalled = true;
      const root = html?.[0];
      if (root) {
        const obs = new MutationObserver(() => {
          try { syncAllCardModes(grid); } catch (_) {}
        });
        obs.observe(root, { attributes: true, childList: true, subtree: true });
        app._comLockObserver = obs;
      }
    }

    // Toggle edit per artifact (one button per card)
    grid.off("click.comArtifactsToggleEdit").on("click.comArtifactsToggleEdit", "button.com-edit-toggle", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const sheetUnlocked = isSheetUnlocked(html);
      if (!sheetUnlocked) return;

      const idx = Number(ev.currentTarget.dataset.idx);
      app._comArtifactEdit[idx] = !app._comArtifactEdit[idx];

      // If turning OFF edit, commit name + tags by triggering change
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      if (!app._comArtifactEdit[idx]) {
        // commit name
        const $name = $sec.find('input.com-name-input[data-field="name"]');
        if ($name.length) $name.trigger("change");

        // commit all tag stores
        $sec.find("input.com-hidden-store[data-field]").each((_, inp) => $(inp).trigger("change"));
      }

      syncAllCardModes(grid);
    });

    // In non-edit mode: click tags to select/deselect. In edit mode: do nothing (no selecting).
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pick", (ev) => {
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      const idx = Number($sec[0]?.dataset?.idx ?? -1);
      const editOn = !!app._comArtifactEdit?.[idx];

      if (editOn) return; // selection only when NOT editing

      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $(ev.currentTarget).toggleClass("com-picked", set.has(key));
    });

    // Edit mode: typing directly edits the visible span; we mirror into hidden input on blur/enter.
    function mirrorTagToStore($tag) {
      const $sec = $tag.closest(".com-artifact");
      const field = $tag.closest(".tag-row")?.attr("data-field");
      if (!field) return;

      const text = (($tag.find(".com-tag-text").text() ?? "").trim());
      const val = (text === "(empty)") ? "" : text;

      const $store = $sec.find(`input.com-hidden-store[data-field="${field}"]`);
      if ($store.length) {
        $store.val(val);
        $store.trigger("change");
      }
    }

    grid.off("keydown.comArtifactsTagEdit").on("keydown.comArtifactsTagEdit", ".com-tag-pick.com-editable .com-tag-text", (ev) => {
      // Only in edit mode
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      const idx = Number($sec[0]?.dataset?.idx ?? -1);
      const editOn = !!app._comArtifactEdit?.[idx];
      if (!editOn) return;

      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        ev.currentTarget.blur();
      }
    });

    grid.off("blur.comArtifactsTagEdit").on("blur.comArtifactsTagEdit", ".com-tag-pick.com-editable .com-tag-text", (ev) => {
      const $tag = $(ev.currentTarget).closest(".com-tag-pick");
      mirrorTagToStore($tag);
    });

    // Save changes (name + tag stores)
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

      // update visible name display immediately
      if (field === "name") {
        const v = (ev.currentTarget.value ?? "").trim();
        $(section).find(".com-name-display").text(v || `Artifact ${idx + 1}`);
      }

      await setArtifacts(actor, artifacts2);
      forceActivateTab(app, app._comLastTab);
      syncAllCardModes(grid);
    });

    // Image pick: click big square ONLY when sheet unlocked AND edit mode for that card
    grid.off("click.comArtifactsImg").on("click.comArtifactsImg", ".com-artifact-img[data-action='pick-image']", async (ev) => {
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      const idx = Number($sec[0]?.dataset?.idx ?? -1);

      const sheetUnlocked = isSheetUnlocked(html);
      const editOn = !!app._comArtifactEdit?.[idx];
      if (!sheetUnlocked || !editOn) return;

      const tab = getActiveTab(html) || MODULE_ID;
      app._comLastTab = tab;

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
});

/* =====================================================================================
 * ROLLDIALOG INJECTION + DESELECT ON CONFIRM (DEFERRED + ON CLOSE)
 * ===================================================================================== */
function findCustomModifierInput($root) {
  // Prefer label match
  const labels = $root.find("label").toArray();
  for (const el of labels) {
    const txt = (el.textContent ?? "").trim().toLowerCase();
    if (txt === "custom modifier") {
      const $wrap = $(el).closest("div");
      const $input = $wrap.find("input").first();
      if ($input.length) return $input;
    }
  }
  // fallback
  const $cand = $root.find('input[type="number"], input[type="text"]').filter((_, i) => i.offsetParent !== null).first();
  return $cand.length ? $cand : null;
}

function buildSelectedEntries(artifacts, selSet) {
  const out = [];
  for (let a = 0; a < 2; a++) {
    const art = artifacts[a];
    if (selSet.has(`a${a}.p0`) && (art.power?.[0]?.name ?? "").trim()) out.push({ label: art.power[0].name, mod: +1 });
    if (selSet.has(`a${a}.p1`) && (art.power?.[1]?.name ?? "").trim()) out.push({ label: art.power[1].name, mod: +1 });
    if (selSet.has(`a${a}.w`) && (art.weakness?.name ?? "").trim()) out.push({ label: art.weakness.name, mod: -1 });
  }
  return out;
}

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
    if ($root.find(".com-artifacts-roll").length) return;

    const $modInput = findCustomModifierInput($root);
    if (!$modInput || !$modInput.length) return;

    // Base mod per dialog instance
    if (!Number.isFinite(app._comArtifactsBaseMod)) {
      const base = Number($modInput.val() ?? 0);
      app._comArtifactsBaseMod = Number.isFinite(base) ? base : 0;
    }

    const artifacts = await getArtifacts(actor);
    const sel = getSel(actor.id);
    const entries = buildSelectedEntries(artifacts, sel);

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

    // Player -> GM mirror request
    if (!game.user.isGM) {
      if (!app._comaRequestId) app._comaRequestId = foundry.utils.randomID();
      globalThis._comaOpenRollDialogs.set(app._comaRequestId, app);

      game.socket.emit(COMA_SOCKET, {
        type: "coma-mirror-request",
        requestId: app._comaRequestId,
        fromUserId: game.user.id,
        fromUserName: game.user.name,
        actorId: actor.id,
        actorName: actor.name,
        entries: entries.map((e, idx) => ({ idx, label: e.label, mod: e.mod, checked: true }))
      });
    }

    // ===== CLEAR ARTIFACT SELECTION AFTER CONFIRM (DEFERRED + CLOSE-SAFE) =====
    app._comArtifactsActorId = actor.id;
    app._comArtifactsConfirmed = false;

    const $confirmBtn =
      $root.find("button.dialog-button")
        .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
        .first();

    if ($confirmBtn?.length) {
      $confirmBtn.off("click.comArtifactsClearOnConfirm").on("click.comArtifactsClearOnConfirm", () => {
        app._comArtifactsConfirmed = true;

        setTimeout(() => {
          try { clearSelAndUnhighlight(actor.id); } catch (_) {}
        }, 0);

        setTimeout(() => {
          try { clearSelAndUnhighlight(actor.id); } catch (_) {}
        }, 250);
      });
    }
    // ========================================================================

  } catch (e) {
    console.error(`${MODULE_ID} | renderRollDialog failed`, e);
  }
});

/* =====================================================================================
 * CLEANUP + FINAL CLEAR ON DIALOG CLOSE (only if confirmed)
 * ===================================================================================== */
Hooks.on("closeApplication", (app) => {
  try {
    // GM mirror cleanup map
    if (app?._comaRequestId) globalThis._comaOpenRollDialogs.delete(app._comaRequestId);

    // If this was a RollDialog and player confirmed, clear again (final guarantee)
    if (app?._comArtifactsConfirmed && app?._comArtifactsActorId) {
      try { clearSelAndUnhighlight(app._comArtifactsActorId); } catch (_) {}
    }
  } catch (_) {}
});
