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
      power: [{ name: "" }, { name: "" }],
      weakness: { name: "" }
    },
    {
      name: "Artifact 2",
      img: "",
      power: [{ name: "" }, { name: "" }],
      weakness: { name: "" }
    }
  ];
}

async function getArtifacts(actor) {
  const data = (await actor.getFlag(MODULE_ID, "artifacts")) ?? defaultArtifacts();
  if (!Array.isArray(data) || data.length !== 2) return defaultArtifacts();

  // Normalize older/bad data
  for (let i = 0; i < 2; i++) {
    data[i] ??= defaultArtifacts()[i];
    data[i].name ??= `Artifact ${i + 1}`;
    data[i].img ??= "";
    data[i].power ??= [{ name: "" }, { name: "" }];
    data[i].power[0] ??= { name: "" };
    data[i].power[1] ??= { name: "" };
    data[i].weakness ??= { name: "" };
  }
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
 * LOCK-AWARE EDITING (FIXED FOR CoM)
 * CoM lock state is form.locked
 * ===================================================================================== */
function findSheetForm($root) {
  // $root is app root DIV; form is inside it.
  const $form = $root.is("form") ? $root : $root.find("form").first();
  return $form?.length ? $form[0] : null;
}

function isSheetEditable($root) {
  const form = findSheetForm($root);
  if (!form) return false;
  return !form.classList.contains("locked");
}

function setArtifactsEditable($root, editable) {
  const tab = $root.find(`.sheet-body .tab[data-tab="${MODULE_ID}"]`);
  if (!tab.length) return;

  // In unlocked mode: enable inline editing + placeholders.
  // In locked mode: disable editing, hide empty tags.
  tab.toggleClass("com-editable", !!editable);

  tab.find(".com-tag-pick").each((_, el) => {
    const $el = $(el);
    const txt = ($el.text() ?? "").trim();

    el.contentEditable = editable ? "true" : "false";
    $el.toggleClass("com-inline-editable", !!editable);

    if (!editable) {
      // locked: empty tags hidden and never selectable
      $el.toggle(!!txt);
      $el.removeClass("com-editing");
    } else {
      // unlocked: show all lines (placeholder handles empties)
      $el.show();
    }
  });

  // Name input show/hide
  tab.find(".com-name-input").prop("disabled", !editable).toggle(!!editable);
  tab.find(".com-name-display").toggle(!editable);

  // Image clickable only when editable
  tab.find(".com-artifact-img").toggleClass("com-img-disabled", !editable);

  // Always allow pointer events; logic gates in handlers
  tab.find(".com-tag-pick").css("pointer-events", "auto");
}

function installLockObserver(app, $root) {
  if (app._comLockObserverInstalled) return;
  app._comLockObserverInstalled = true;

  const rootEl = $root?.[0];
  if (!rootEl) return;

  const obs = new MutationObserver(() => {
    try {
      const $r = $(rootEl);
      const editable = isSheetEditable($r);
      setArtifactsEditable($r, editable);
    } catch (e) {
      console.warn(`${MODULE_ID} | lock observer error`, e);
    }
  });

  obs.observe(rootEl, { attributes: true, childList: true, subtree: true });
  app._comLockObserver = obs;
}

/* =====================================================================================
 * SHEET UI: ARTIFACTS TAB (INLINE EDIT TAG LINES, NO EDIT BUTTONS)
 * ===================================================================================== */
function ensureArtifactsTab(app, $root, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  if (!document.getElementById("com-artifacts-inline-style")) {
    const style = document.createElement("style");
    style.id = "com-artifacts-inline-style";
    style.textContent = `
      .com-artifacts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .com-artifact { border: 1px solid var(--color-border-light-primary); border-radius: 10px; padding: 12px; }
      .com-artifact-inner { display:flex; flex-direction:column; align-items:center; gap:10px; }

      /* Name */
      .com-name-display{
        font-family: "Roboto";
        font-size: 1.5em;
        color: var(--color-text-hyperlink);
        text-align:center;
        margin-top: 2px;
      }
      .com-name-input{
        width: 100%;
        font-family: "Roboto";
        font-size: 1.15em;
        display:none;
      }

      /* Image */
      .com-artifact-img{
        width: 192px;
        height: 192px;   /* square */
        border: 1px solid var(--color-border-light-primary);
        border-radius: 10px;
        background-size: cover;
        background-position: center;
        background-repeat:no-repeat;
        cursor: pointer;
        position: relative;
        overflow:hidden;
      }
      .com-artifact-img.com-img-disabled{ cursor: default; }
      .com-artifact-img .com-img-icon{
        position:absolute;
        inset:0;
        display:flex;
        align-items:center;
        justify-content:center;
        opacity:.55;
        pointer-events:none;
        font-size: 48px;
      }
      .com-artifact-img.has-image .com-img-icon{ display:none; }

      /* Tag blocks (same width as image) */
      .com-tags { width: 192px; display:flex; flex-direction:column; gap:10px; }
      .com-tag-block{
        border: 1px solid var(--color-border-light-primary);
        border-radius: 8px;
        padding: 8px;
        background: rgba(120,80,160,.06);
      }
      .com-tag-block-title{
        font-weight: 700;
        opacity:.9;
        margin-bottom: 6px;
        display:flex;
        align-items:center;
        gap:6px;
      }

      .com-tag-row{ display:flex; align-items:center; gap:8px; margin:6px 0; }
      .com-tag-icon { width: 14px; text-align:center; opacity:.9; }

      .com-tag-pick{
        display:inline-block;
        padding:2px 8px;
        border-radius:6px;
        user-select:none;
        min-height: 20px;
        flex: 1;
      }

      /* Placeholder (only visible in unlocked mode because locked mode hides empties) */
      .tab[data-tab="${MODULE_ID}"].com-editable .com-tag-pick:empty::before{
        content: attr(data-placeholder);
        opacity: .55;
      }

      /* Editable styling */
      .tab[data-tab="${MODULE_ID}"].com-editable .com-tag-pick{
        cursor: text;
        border: 1px solid rgba(120, 80, 160, .25);
        background: rgba(120, 80, 160, .03);
      }
      .tab[data-tab="${MODULE_ID}"]:not(.com-editable) .com-tag-pick{
        cursor: pointer;
        border: 1px solid transparent;
      }
      .tab[data-tab="${MODULE_ID}"]:not(.com-editable) .com-tag-pick:hover{
        border-color: rgba(120, 80, 160, .45);
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .15);
      }

      .com-tag-pick.com-picked { background:#ffeb3b; }
      .com-tag-pick.com-weak.com-picked { background:#ffd54f; }

      .com-hint{
        opacity:.8;
        font-size:12px;
        margin-top: 2px;
        text-align:center;
      }
    `;
    document.head.appendChild(style);
  }

  const nav = $root.find("nav.sheet-tabs, nav.tabs");
  if (!nav.length) return;

  if (nav.find(`a.item[data-tab="${MODULE_ID}"]`).length === 0) {
    nav.append(`<a class="item" data-tab="${MODULE_ID}">Artifacts</a>`);
  }

  const body = $root.find(".sheet-body");
  if (!body.length) return;

  if (!body.find(`.tab[data-tab="${MODULE_ID}"]`).length) {
    body.append(`
      <div class="tab" data-tab="${MODULE_ID}">
        <div class="com-artifacts-grid"></div>
      </div>
    `);
  }

  function esc(s) { return Handlebars.escapeExpression(s ?? ""); }

  // caret helper
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

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);

    const renderSlot = (a, idx) => {
      const img = (a.img ?? "").trim();
      const hasImage = !!img;
      const imgStyle = hasImage ? `background-image:url('${img.replace(/'/g, "%27")}');` : "";

      return `
        <section class="com-artifact" data-idx="${idx}">
          <div class="com-artifact-inner">
            <div class="com-name-display">${esc(a.name ?? "")}</div>
            <input class="com-name-input" type="text" data-field="name" value="${esc(a.name ?? "")}" />

            <div class="com-artifact-img ${hasImage ? "has-image" : ""}" style="${imgStyle}">
              <div class="com-img-icon"><i class="fas fa-image"></i></div>
            </div>

            <div class="com-tags">
              <div class="com-tag-block">
                <div class="com-tag-block-title"><i class="fas fa-bolt"></i> Power Tags</div>

                <div class="com-tag-row">
                  <span class="com-tag-icon"><i class="fas fa-bolt"></i></span>
                  <span class="com-tag-pick"
                        data-pick="a${idx}.p0"
                        data-field="power.0.name"
                        data-placeholder="Power Tag 1">${esc(a.power?.[0]?.name ?? "")}</span>
                </div>

                <div class="com-tag-row">
                  <span class="com-tag-icon"><i class="fas fa-bolt"></i></span>
                  <span class="com-tag-pick"
                        data-pick="a${idx}.p1"
                        data-field="power.1.name"
                        data-placeholder="Power Tag 2">${esc(a.power?.[1]?.name ?? "")}</span>
                </div>
              </div>

              <div class="com-tag-block">
                <div class="com-tag-block-title"><i class="fas fa-angle-double-down"></i> Weakness Tag</div>

                <div class="com-tag-row">
                  <span class="com-tag-icon"><i class="fas fa-angle-double-down"></i></span>
                  <span class="com-tag-pick com-weak"
                        data-pick="a${idx}.w"
                        data-field="weakness.name"
                        data-placeholder="Weakness Tag">${esc(a.weakness?.name ?? "")}</span>
                </div>
              </div>

              <div class="com-hint">Locked: select/deselect tags. Unlocked: click tag text to edit.</div>
            </div>
          </div>
        </section>
      `;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // restore highlight from selection
    const selSet = getSel(actor.id);
    grid.find(".com-tag-pick").each((_, el) => {
      const key = el.dataset.pick;
      const txt = (el.textContent ?? "").trim();
      if (key && txt && selSet.has(key)) $(el).addClass("com-picked");
    });

    // CLICK behavior depends on lock state:
    // - LOCKED: click toggles selection
    // - UNLOCKED: click focuses for editing (NOT selectable)
    grid.off("click.comArtifactsTag").on("click.comArtifactsTag", ".com-tag-pick", (ev) => {
      const $appRoot = $root;
      const editable = isSheetEditable($appRoot);
      const el = ev.currentTarget;

      if (editable) {
        // edit mode: just focus, do not select/deselect
        el.focus();
        placeCaretAtEnd(el);
        return;
      }

      // locked mode: only if has text
      const txt = (el.textContent ?? "").trim();
      if (!txt) return;

      const key = el.dataset.pick;
      const set = toggleSel(actor.id, key);
      $(el).toggleClass("com-picked", set.has(key));
    });

    // Inline edit commit (Enter/blur), cancel (Escape)
    grid.off("keydown.comArtifactsEdit").on("keydown.comArtifactsEdit", ".com-tag-pick", (ev) => {
      const editable = isSheetEditable($root);
      if (!editable) return;

      const el = ev.currentTarget;

      if (ev.key === "Enter") {
        ev.preventDefault();
        el.blur();
        return;
      }

      if (ev.key === "Escape") {
        ev.preventDefault();
        // revert from stored actor data
        const section = el.closest(".com-artifact");
        const idx = Number(section.dataset.idx);
        const field = el.dataset.field;

        getArtifacts(actor).then((arts) => {
          const path = field.split(".");
          let ref = arts[idx];
          for (let i = 0; i < path.length - 1; i++) ref = ref[path[i]];
          const lastKey = path[path.length - 1];
          const val = (ref?.[lastKey] ?? "").toString();
          el.textContent = val;
          el.blur();
        }).catch(() => { el.blur(); });
      }
    });

    grid.off("blur.comArtifactsEdit").on("blur.comArtifactsEdit", ".com-tag-pick", async (ev) => {
      const editable = isSheetEditable($root);
      if (!editable) return;

      const el = ev.currentTarget;
      const section = el.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const field = el.dataset.field;
      if (!field) return;

      const newVal = (el.textContent ?? "").trim();

      const arts = await getArtifacts(actor);
      const path = field.split(".");
      let ref = arts[idx];
      for (let i = 0; i < path.length - 1; i++) ref = ref[path[i]];
      const lastKey = path[path.length - 1];
      ref[lastKey] = newVal;

      await setArtifacts(actor, arts);

      // If this tag was selected but cleared, unselect it
      const key = el.dataset.pick;
      const s = getSel(actor.id);
      if (key && !newVal && s.has(key)) {
        s.delete(key);
        scheduleSaveSelection(actor.id);
        $(el).removeClass("com-picked");
      }
    });

    // Name edit input (only shown when unlocked)
    grid.off("change.comArtifactsName").on("change.comArtifactsName", ".com-name-input", async (ev) => {
      const editable = isSheetEditable($root);
      if (!editable) return;

      const input = ev.currentTarget;
      const section = input.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const newVal = (input.value ?? "").trim();

      const arts = await getArtifacts(actor);
      arts[idx].name = newVal;
      await setArtifacts(actor, arts);

      $(section).find(".com-name-display").text(newVal);
    });

    // Image pick ONLY when unlocked
    grid.off("click.comArtifactsImg").on("click.comArtifactsImg", ".com-artifact-img", async (ev) => {
      const editable = isSheetEditable($root);
      if (!editable) return;

      const tab = getActiveTab($root) || MODULE_ID;
      app._comLastTab = tab;

      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const arts = await getArtifacts(actor);

      new FilePicker({
        type: "image",
        current: arts[idx].img || "",
        callback: async (path) => {
          arts[idx].img = path;
          await setArtifacts(actor, arts);
          app.render(false);
          forceActivateTab(app, app._comLastTab);
        }
      }).browse();
    });

    // Apply lock state now + observe changes
    const editableNow = isSheetEditable($root);
    setArtifactsEditable($root, editableNow);
    installLockObserver(app, $root);
  })();
}

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app?.actor;
  if (!actor) return;

  const $root = html?.jquery ? html : $(html);

  const tab = getActiveTab($root);
  if (tab) app._comLastTab = tab;

  ensureArtifactsTab(app, $root, actor);

  forceActivateTab(app, app._comLastTab);

  const editable = isSheetEditable($root);
  setArtifactsEditable($root, editable);
  installLockObserver(app, $root);
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

        // Defer to next tick (and a short follow-up) to survive CoM re-render cycles.
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
 * ALSO disconnect MutationObserver to prevent crashes on rerender/close.
 * ===================================================================================== */
Hooks.on("closeApplication", (app) => {
  try {
    // GM mirror cleanup map
    if (app?._comaRequestId) globalThis._comaOpenRollDialogs.delete(app._comaRequestId);

    // Disconnect lock observer (prevents crashes on close / rerender)
    if (app?._comLockObserver) {
      try { app._comLockObserver.disconnect(); } catch (_) {}
      app._comLockObserver = null;
      app._comLockObserverInstalled = false;
    }

    // If this was a RollDialog and player confirmed, clear again (final guarantee)
    if (app?._comArtifactsConfirmed && app?._comArtifactsActorId) {
      try { clearSelAndUnhighlight(app._comArtifactsActorId); } catch (_) {}
    }
  } catch (_) {}
});
