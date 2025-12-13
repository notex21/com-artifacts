const MODULE_ID = "com-artifacts";

/* =====================================================================================
 * SOCKET: GM MIRROR (optional approval UI)
 * ===================================================================================== */
const COMA_SOCKET = `module.${MODULE_ID}`;
globalThis._comaOpenRollDialogs ??= new Map();

function comaLog(...a) {
  console.log(`${MODULE_ID} |`, ...a);
}

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
                    ? entries
                        .map(
                          (e) => `
                      <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" class="coma-approve" data-idx="${Number(e.idx)}" ${e.checked ? "checked" : ""}/>
                        <span>${Handlebars.escapeExpression(e.label ?? "")}</span>
                        <span style="margin-left:auto; opacity:.8;">${Number(e.mod) > 0 ? "+1" : "-1"}</span>
                      </label>
                    `
                        )
                        .join("")
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
                  const c = checks.find((x) => Number(x.getAttribute("data-idx")) === idx);
                  return { ...e, checked: c ? c.checked : !!e.checked };
                });

                game.socket.emit(COMA_SOCKET, {
                  type: "coma-mirror-result",
                  requestId: msg.requestId,
                  toUserId: msg.fromUserId,
                  toggles,
                });
              },
            },
            close: { label: "Close" },
          },
          default: "apply",
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
        for (const t of msg.toggles ?? []) {
          const el = inputs[Number(t.idx)];
          if (!el) continue;
          const changed = el.checked !== !!t.checked;
          el.checked = !!t.checked;
          if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        if (typeof app._comArtifactsRecompute === "function") {
          try {
            app._comArtifactsRecompute();
          } catch (_) {}
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
      weakness: { name: "", active: false },
    },
    {
      name: "Artifact 2",
      img: "",
      power: [{ name: "", active: false }, { name: "", active: false }],
      weakness: { name: "", active: false },
    },
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
  setTimeout(() => {
    try {
      tabs.activate(tab);
    } catch (_) {}
  }, 0);
}

/* =====================================================================================
 * LOCK-AWARE EDITING
 * ===================================================================================== */
function isSheetEditable(html) {
  const ref = html
    .find(
      `.sheet-body .tab:not([data-tab="${MODULE_ID}"]) input, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) textarea, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) select`
    )
    .filter((_, el) => el.offsetParent !== null);

  if (ref.length) return ref.toArray().some((el) => !el.disabled);
  return true;
}

function setArtifactsEditable(html, editable) {
  const tab = html.find(`.sheet-body .tab[data-tab="${MODULE_ID}"]`);
  if (!tab.length) return;

  // toggle editable fields
  tab.find(".com-editor-only").prop("disabled", !editable).toggle(editable);
  tab.find(".com-view-only").toggle(!editable);

  // in locked mode: tags are only selectable/deselectable
  tab.toggleClass("com-locked", !editable);

  // hide empty tag rows when locked
  tab.find(".com-tag-row").each((_, rowEl) => {
    const $row = $(rowEl);
    const $pick = $row.find(".com-tag-pick").first();
    const txt = ($pick.text() ?? "").trim();
    if (!editable) $row.toggle(!!txt);
    else $row.show();
  });

  tab.css("opacity", editable ? "" : "0.9");
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
 * SHEET UI: ARTIFACTS TAB
 * ===================================================================================== */
function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  if (!document.getElementById("com-artifacts-inline-style")) {
    const style = document.createElement("style");
    style.id = "com-artifacts-inline-style";
    style.textContent = `
      .com-artifacts-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .com-artifact { border: 1px solid var(--color-border-light-primary); border-radius: 10px; padding: 12px; }
      .com-artifact-inner { max-width: 520px; }
      .com-artifact-name-view{
        font-size: 1.5em;
        margin: 0 0 10px 0;
        font-weight: 700;
        color: var(--color-text-hyperlink); /* close to CoM purple accents */
      }
      .com-artifact-name-input{ width:100%; font-size: 1.15em; }
      .com-artifact-image {
        width: 100%;
        aspect-ratio: 3 / 1; /* wide banner feel */
        border: 1px solid var(--color-border-light-primary);
        border-radius: 8px;
        display:flex;
        align-items:center;
        justify-content:center;
        background-size: cover;
        background-position: center;
        cursor: pointer;
        margin-bottom: 10px;
        position: relative;
        overflow: hidden;
      }
      .com-artifact-image .com-img-icon {
        font-size: 48px; /* ~3x */
        opacity: .7;
      }
      .com-artifact-image.com-has-img .com-img-icon { display:none; }

      .com-box {
        width: 100%;
        border-radius: 8px;
        border: 1px solid rgba(90, 60, 120, .45);
        background: rgba(90, 60, 120, .08);
        padding: 10px;
        margin-top: 10px;
      }
      .com-box-title {
        display:flex;
        align-items:center;
        gap:8px;
        font-weight: 700;
        margin-bottom: 8px;
        opacity: .95;
      }

      .com-tag-row { display:flex; align-items:center; gap:8px; margin: 8px 0; }
      .com-tag-icon { width:16px; min-width:16px; opacity:.9; display:inline-flex; justify-content:center; }
      .com-tag-pick {
        display:inline-block;
        padding: 3px 10px;
        border-radius: 6px;
        border: 1px solid transparent;
        user-select:none;
        cursor:pointer;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .com-tag-pick.com-picked { background: #ffeb3b; }
      .com-tag-pick.com-weak.com-picked { background: #ffd54f; }
      .com-tag-pick:hover{
        border-color: rgba(120, 80, 160, .45);
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .15);
      }

      /* editing */
      .com-tag-pick.com-editing{
        border-color: rgba(120, 80, 160, .75) !important;
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .22) !important;
        background: rgba(120, 80, 160, .06);
        outline: none;
      }
      .com-tag-pick.com-empty::before{ content:"(empty)"; opacity:.55; }
      .com-hidden-store{ display:none !important; }

      /* locked behavior */
      .tab[data-tab="${MODULE_ID}"].com-locked .com-tag-pick { cursor: pointer; }
      .tab[data-tab="${MODULE_ID}"].com-locked .com-artifact-image { cursor: default; }
      .tab[data-tab="${MODULE_ID}"] .com-hint { opacity: .8; font-size: 12px; margin-top: 10px; }
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

  function beginTagEdit($pick) {
    $pick.addClass("com-editing");
    const el = $pick[0];
    el.contentEditable = "true";
    el.focus();
    placeCaretAtEnd(el);
  }

  function cancelTagEdit($row) {
    const $pick = $row.find(".com-tag-pick").first();
    const $store = $row.find("input.com-hidden-store").first();
    $pick.text(($store.val() ?? "").trim());
    $pick.removeClass("com-editing");
    $pick[0].contentEditable = "false";
    const txt = ($pick.text() ?? "").trim();
    $pick.toggleClass("com-empty", !txt);
  }

  function commitTagEdit($row) {
    const $pick = $row.find(".com-tag-pick").first();
    const $store = $row.find("input.com-hidden-store").first();

    const val = ($pick.text() ?? "").trim();
    $store.val(val);
    $store.trigger("change");

    $pick.removeClass("com-editing");
    $pick[0].contentEditable = "false";
    $pick.toggleClass("com-empty", !val);

    // if tag emptied, remove selection highlight too
    if (!val) {
      const actorId = $row.closest(".com-artifact").data("actorId");
      const pickKey = $pick[0]?.dataset?.pick;
      if (actorId && pickKey) {
        const s = getSel(actorId);
        if (s.has(pickKey)) {
          s.delete(pickKey);
          scheduleSaveSelection(actorId);
        }
        $pick.removeClass("com-picked");
      }
    }
  }

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);

    const renderTagRow = ({ pickKey, isWeak, field, value, iconClass }) => {
      const label = ((value ?? "").trim());
      const emptyClass = label ? "" : "com-empty";
      return `
        <div class="com-tag-row" data-field="${field}">
          <span class="com-tag-icon"><i class="${iconClass}"></i></span>
          <span class="com-tag-pick ${isWeak ? "com-weak" : ""} ${emptyClass}" data-pick="${pickKey}">
            ${Handlebars.escapeExpression(label)}
          </span>
          <input class="com-editor-only com-hidden-store" type="text" data-field="${field}" value="${Handlebars.escapeExpression(value ?? "")}" />
        </div>
      `;
    };

    const renderSlot = (a, idx) => {
      const safeImg = (a.img ?? "").replace(/'/g, "%27");
      const hasImg = !!(a.img ?? "").trim();
      const imgStyle = hasImg ? `style="background-image:url('${safeImg}')"` : "";
      const name = (a.name ?? "").trim() || `Artifact ${idx + 1}`;

      return `
        <section class="com-artifact" data-idx="${idx}" data-actor-id="${actor.id}">
          <div class="com-artifact-inner">
            <div class="com-view-only com-artifact-name-view">${Handlebars.escapeExpression(name)}</div>
            <input class="com-editor-only com-artifact-name-input" type="text" data-field="name" value="${Handlebars.escapeExpression(a.name ?? "")}" />

            <div class="com-artifact-image ${hasImg ? "com-has-img" : ""}" data-field="img" ${imgStyle} title="Click to set image (edit mode). Shift+Click to clear.">
              <i class="fas fa-image com-img-icon"></i>
            </div>

            <div class="com-box com-box-power">
              <div class="com-box-title"><i class="fas fa-bolt"></i><span>Power Tags (click to mark)</span></div>
              ${renderTagRow({ pickKey: `a${idx}.p0`, isWeak: false, field: "power.0.name", value: a.power?.[0]?.name ?? "", iconClass: "fas fa-bolt" })}
              ${renderTagRow({ pickKey: `a${idx}.p1`, isWeak: false, field: "power.1.name", value: a.power?.[1]?.name ?? "", iconClass: "fas fa-bolt" })}
            </div>

            <div class="com-box com-box-weak">
              <div class="com-box-title"><i class="fas fa-angle-double-down"></i><span>Weakness Tag (click to mark)</span></div>
              ${renderTagRow({ pickKey: `a${idx}.w`, isWeak: true, field: "weakness.name", value: a.weakness?.name ?? "", iconClass: "fas fa-angle-double-down" })}
            </div>

            <div class="com-hint">Locked: click tags to select/deselect. Unlocked: click tag text to edit. Highlighted tags appear in Make Roll for MC approval.</div>
          </div>
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

    function currentEditable() {
      return isSheetEditable(html);
    }

    // LOCKED: click-to-highlight (only locked)
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pick", (ev) => {
      const editable = currentEditable();
      const $pick = $(ev.currentTarget);

      // Unlocked: clicking edits, not selects
      if (editable) {
        // ignore while editing
        if ($pick.hasClass("com-editing")) return;
        beginTagEdit($pick);
        return;
      }

      // Locked: select/deselect
      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $pick.toggleClass("com-picked", set.has(key));
    });

    // Unlocked: editing key handling
    grid.off("keydown.comArtifactsInline").on("keydown.comArtifactsInline", ".com-tag-pick", (ev) => {
      const $pick = $(ev.currentTarget);
      if (!$pick.hasClass("com-editing")) return;

      const $row = $pick.closest(".com-tag-row");

      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        commitTagEdit($row);
        return;
      }

      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        cancelTagEdit($row);
        return;
      }
    });

    // Unlocked: blur commits
    grid.off("blur.comArtifactsInline").on("blur.comArtifactsInline", ".com-tag-pick", (ev) => {
      const $pick = $(ev.currentTarget);
      if (!$pick.hasClass("com-editing")) return;
      const $row = $pick.closest(".com-tag-row");
      commitTagEdit($row);
    });

    // Click outside: if unlocked, clicking a different place should commit any active edits
    grid.off("mousedown.comArtifactsCommit").on("mousedown.comArtifactsCommit", (ev) => {
      const editable = currentEditable();
      if (!editable) return;

      const active = grid.find(".com-tag-pick.com-editing").first();
      if (!active.length) return;

      // if click is inside the active pick, ignore
      if (active[0] === ev.target || active[0].contains(ev.target)) return;

      commitTagEdit(active.closest(".com-tag-row"));
    });

    // Save changes from inputs (name + tag hidden stores)
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

      await setArtifacts(actor, artifacts2);

      // Update view-only name immediately without re-render
      if (field === "name") {
        const name = (ev.currentTarget.value ?? "").trim() || `Artifact ${idx + 1}`;
        $(section).find(".com-artifact-name-view").text(name);
      }

      forceActivateTab(app, app._comLastTab);

      // If locked, hide empty rows
      const editable = currentEditable();
      setArtifactsEditable(html, editable);
    });

    // Image click: only in edit mode (unlocked). Shift+Click clears.
    grid.off("click.comArtifactsImg").on("click.comArtifactsImg", ".com-artifact-image", async (ev) => {
      const editable = currentEditable();
      if (!editable) return;

      const tab = getActiveTab(html) || MODULE_ID;
      app._comLastTab = tab;

      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const artifacts2 = await getArtifacts(actor);

      // Shift+Click clears
      if (ev.shiftKey) {
        artifacts2[idx].img = "";
        await setArtifacts(actor, artifacts2);
        app.render(false);
        forceActivateTab(app, app._comLastTab);
        return;
      }

      new FilePicker({
        type: "image",
        current: artifacts2[idx].img || "",
        callback: async (path) => {
          artifacts2[idx].img = path;
          await setArtifacts(actor, artifacts2);
          app.render(false);
          forceActivateTab(app, app._comLastTab);
        },
      }).browse();
    });

    // Initial editable/locked pass
    const editable = currentEditable();
    setArtifactsEditable(html, editable);
    installLockObserver(app, html);

    // Also ensure empty rows hidden in locked state on first render
    setArtifactsEditable(html, editable);
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
  const $cand = $root
    .find('input[type="number"], input[type="text"]')
    .filter((_, i) => i.offsetParent !== null)
    .first();
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
      html?.jquery
        ? html
        : html
        ? $(html)
        : app?.element
        ? app.element.jquery
          ? app.element
          : $(app.element)
        : null;
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
              ? entries
                  .map(
                    (e) => `
                <label style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" class="com-approve" data-mod="${e.mod}" checked />
                  <span>${Handlebars.escapeExpression(e.label)}</span>
                  <span style="margin-left:auto; opacity:.8;">${e.mod > 0 ? "+1" : "-1"}</span>
                </label>
              `
                  )
                  .join("")
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
        entries: entries.map((e, idx) => ({ idx, label: e.label, mod: e.mod, checked: true })),
      });
    }

    // ===== CLEAR ARTIFACT SELECTION AFTER CONFIRM (DEFERRED + CLOSE-SAFE) =====
    app._comArtifactsActorId = actor.id;
    app._comArtifactsConfirmed = false;

    const $confirmBtn = $root
      .find("button.dialog-button")
      .filter((_, el) => (el.textContent ?? "").trim().toLowerCase() === "confirm")
      .first();

    if ($confirmBtn?.length) {
      $confirmBtn.off("click.comArtifactsClearOnConfirm").on("click.comArtifactsClearOnConfirm", () => {
        app._comArtifactsConfirmed = true;

        setTimeout(() => {
          try {
            clearSelAndUnhighlight(actor.id);
          } catch (_) {}
        }, 0);

        setTimeout(() => {
          try {
            clearSelAndUnhighlight(actor.id);
          } catch (_) {}
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
    if (app?._comaRequestId) globalThis._comaOpenRollDialogs.delete(app._comaRequestId);

    if (app?._comArtifactsConfirmed && app?._comArtifactsActorId) {
      try {
        clearSelAndUnhighlight(app._comArtifactsActorId);
      } catch (_) {}
    }
  } catch (_) {}
});
