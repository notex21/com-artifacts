const MODULE_ID = "com-artifacts";
const SOCKET = `module.${MODULE_ID}`;

/* -------------------- Client-side selection (per-user, persisted) -------------------- */

/**
 * In-memory cache (fast), backed by game.user flags (stable across refresh).
 * Map<actorId, Set<string>>
 */
globalThis.comArtifactsSelection ??= new Map();

/**
 * GM cache of the latest selection snapshot received from each player
 * Map<key=userId:actorId, { userId, actorId, entries: Array<{id,label,mod,checked,kind,artifactIdx}>, ts }>
 */
globalThis.comArtifactsGMCache ??= new Map();

/**
 * Track open RollDialogs on the local client (used to apply GM approvals live)
 * Map<actorId, { app, $root, $modInput, baseMod, $panel }>
 */
globalThis.comArtifactsOpenRoll ??= new Map();

/** Read selection for this user+actor from user flag (object map) */
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

/** Save selection for this user+actor into user flag (object map) */
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

/* -------------------- Storage -------------------- */

function defaultArtifacts() {
  return [
    { name: "Artifact 1", img: "", power: [{ name: "", active: false }, { name: "", active: false }], weakness: { name: "", active: false } },
    { name: "Artifact 2", img: "", power: [{ name: "", active: false }, { name: "", active: false }], weakness: { name: "", active: false } }
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

/* -------------------- Tab helpers -------------------- */

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

/* -------------------- Lock-aware editing -------------------- */

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

/* -------------------- Sheet UI: Artifacts tab -------------------- */

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

      .com-artifact .tag-row{
        display:flex;
        justify-content:center;
        align-items:center;
        gap:6px;
        margin:6px 0;
      }

      .com-tag-pick { display:inline-block; padding:2px 6px; border-radius:4px; cursor:pointer; user-select:none; }
      .com-tag-pick.com-picked { background: #ffeb3b; }
      .com-tag-pick.com-weak.com-picked { background: #ffd54f; }

      .com-edit-tag{
        background:none !important;
        border:none !important;
        width:14px !important; min-width:14px !important; max-width:14px !important;
        height:14px !important; min-height:14px !important;
        padding:0 !important; margin:0 !important;
        display:inline-flex !important;
        align-items:center !important;
        justify-content:center !important;
        cursor:pointer;
        opacity:.65;
        font-size:11px;
        line-height:1;
      }
      .com-edit-tag:hover { opacity: 1; }

      .com-tag-pick:not(:empty){
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 2px 8px;
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
    const el = $pick[0];
    el.contentEditable = "false";
    $pick.removeClass("com-editing");
  }

  function commitInlineEdit($row) {
    const $pick = $row.find(".com-tag-pick");
    const $store = $row.find("input.com-hidden-store");
    const newVal = (($pick.text() ?? "").trim());
    $store.val(newVal);
    $store.trigger("change");
    const el = $pick[0];
    el.contentEditable = "false";
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
          <span
            class="com-tag-pick ${isWeak ? "com-weak" : ""}"
            data-pick="${pickKey}"
            style="${hasValue ? "" : "display:none;"}"
          >${Handlebars.escapeExpression(label)}</span>

          <button type="button"
            class="com-edit-tag"
            title="${hasValue ? "Edit" : "Add"}"
          >✎</button>

          <input class="com-editor-only com-hidden-store" type="text" data-field="${field}"
            value="${Handlebars.escapeExpression(value ?? "")}"
          />
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
            <input class="com-editor-only" type="text" data-field="name" value="${Handlebars.escapeExpression(a.name ?? "")}" />
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

        <div class="hint">
          Click tag names to highlight. Highlighted tags appear in Make Roll for MC approval.
        </div>
      </section>`;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // Restore highlight state (from persisted selection)
    const s = getSel(actor.id);
    grid.find(".com-tag-pick").each((_, el) => {
      const key = el.dataset.pick;
      if (s.has(key)) $(el).addClass("com-picked");
    });

    // Click-to-highlight
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pick", (ev) => {
      if ($(ev.currentTarget).hasClass("com-editing")) return;
      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $(ev.currentTarget).toggleClass("com-picked", set.has(key));
    });

    // Inline edit button
    grid.off("click.comArtifactsEdit").on("click.comArtifactsEdit", ".com-edit-tag", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const editable = isSheetEditable(html);
      if (!editable) return;

      const $row = $(ev.currentTarget).closest(".tag-row");
      startInlineEdit($row, editable);
      syncTagRowUI($row, true);
    });

    // Key handling
    grid.off("keydown.comArtifactsInline").on("keydown.comArtifactsInline", ".com-tag-pick.com-editing", (ev) => {
      const $row = $(ev.currentTarget).closest(".tag-row");
      if (ev.key === "Enter") {
        ev.preventDefault(); ev.stopPropagation();
        commitInlineEdit($row);
        syncTagRowUI($row, isSheetEditable(html));
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault(); ev.stopPropagation();
        cancelInlineEdit($row);
        syncTagRowUI($row, isSheetEditable(html));
        return;
      }
    });

    // Blur saves
    grid.off("blur.comArtifactsInline").on("blur.comArtifactsInline", ".com-tag-pick.com-editing", (ev) => {
      const $row = $(ev.currentTarget).closest(".tag-row");
      commitInlineEdit($row);
      syncTagRowUI($row, isSheetEditable(html));
    });

    // Save changes
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

    // Image pick/clear
    grid.off("click.comArtifacts").on("click.comArtifacts", ".com-pick-img", async (ev) => {
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

    grid.on("click.comArtifacts", ".com-clear-img", async (ev) => {
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

/* -------------------- Shared helpers: build entries + apply modifier -------------------- */

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

/**
 * Build entries from selection:
 * - Selected power tags -> checked +1 (or -1 if weakness selected explicitly, but we do NOT auto-check weakness here)
 * - For each artifact that has ANY selected power tag, add its weakness as UNCHECKED entry (GM may check).
 */
function buildArtifactEntriesForSelection(artifacts, selSet) {
  const out = [];
  const weaknessAdded = new Set();

  for (let a = 0; a < 2; a++) {
    const art = artifacts[a];
    const p0 = (art.power?.[0]?.name ?? "").trim();
    const p1 = (art.power?.[1]?.name ?? "").trim();
    const w  = (art.weakness?.name ?? "").trim();

    const hasP0 = selSet.has(`a${a}.p0`) && p0;
    const hasP1 = selSet.has(`a${a}.p1`) && p1;

    if (hasP0) out.push({ id: `a${a}.p0`, label: p0, mod: +1, checked: true, kind: "power", artifactIdx: a });
    if (hasP1) out.push({ id: `a${a}.p1`, label: p1, mod: +1, checked: true, kind: "power", artifactIdx: a });

    if ((hasP0 || hasP1) && w && !weaknessAdded.has(a)) {
      weaknessAdded.add(a);
      out.push({ id: `a${a}.weakness`, label: `Weakness: ${w}`, mod: -1, checked: false, kind: "weakness", artifactIdx: a });
    }
  }

  return out;
}

function renderArtifactsPanel(entries, { interactive }) {
  // interactive=false => player read-only, interactive=true => GM can toggle
  const disabledAttr = interactive ? "" : "disabled";
  const lockStyle = interactive ? "" : "opacity:.9;";

  return $(`
    <fieldset class="com-artifacts-roll" style="margin-top:10px; padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px; ${lockStyle}">
      <legend>Artifacts</legend>

      <div class="com-artifacts-approve" style="display:flex; flex-direction:column; gap:6px;">
        ${
          entries.length
            ? entries.map(e => `
              <label style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" class="com-approve" data-id="${Handlebars.escapeExpression(e.id)}" data-mod="${e.mod}" ${e.checked ? "checked" : ""} ${disabledAttr}/>
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

      ${interactive ? "" : `<div style="margin-top:6px; opacity:.75; font-size:12px;">Waiting for GM approval.</div>`}
    </fieldset>
  `);
}

function computePanelMod($panel) {
  let mod = 0;
  $panel.find("input.com-approve:checked").each((_, el) => {
    mod += Number(el.dataset.mod ?? 0);
  });
  return mod;
}

function setPanelModText($panel, mod) {
  $panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod}`);
}

function applyToCustomModifier({ $modInput, baseMod, mod }) {
  $modInput.val((baseMod ?? 0) + mod);
  $modInput.trigger("input");
  $modInput.trigger("change");
}

/* -------------------- Socket: sync selection -> GM, approvals -> player -------------------- */

Hooks.once("ready", () => {
  if (!game.socket) return;

  game.socket.on(SOCKET, async (msg) => {
    try {
      if (!msg?.type) return;

      // Player -> GM: selection snapshot
      if (msg.type === "selection" && game.user.isGM) {
        const key = `${msg.userId}:${msg.actorId}`;
        globalThis.comArtifactsGMCache.set(key, { ...msg, ts: Date.now() });
        return;
      }

      // GM -> Player: approval update
      if (msg.type === "approval" && msg.userId === game.user.id) {
        const actorId = msg.actorId;
        const state = msg.state ?? {}; // { entryId: boolean }
        const open = globalThis.comArtifactsOpenRoll.get(actorId);
        if (!open) return;

        const { $panel, $modInput, baseMod } = open;
        if (!$panel || !$panel.length) return;

        // Update checkbox states to match GM decision
        $panel.find("input.com-approve").each((_, el) => {
          const id = el.dataset.id;
          if (id in state) el.checked = !!state[id];
        });

        const mod = computePanelMod($panel);
        setPanelModText($panel, mod);
        applyToCustomModifier({ $modInput, baseMod, mod });
        return;
      }
    } catch (e) {
      console.error(`${MODULE_ID} | socket handler error`, e);
    }
  });
});

/* -------------------- RollDialog: player view (read-only panel + send selection to GM) -------------------- */

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

    if (!Number.isFinite(app._comArtifactsBaseMod)) {
      const base = Number($modInput.val() ?? 0);
      app._comArtifactsBaseMod = Number.isFinite(base) ? base : 0;
    }

    const artifacts = await getArtifacts(actor);
    const sel = getSel(actor.id);

    const entries = buildArtifactEntriesForSelection(artifacts, sel);

    // Mount into form if possible
    const $form = $root.find("form").first();
    const $mount = $form.length ? $form : $root;

    const $panel = renderArtifactsPanel(entries, { interactive: false });
    $mount.append($panel);

    // Compute initial mod from default checked state
    const mod = computePanelMod($panel);
    setPanelModText($panel, mod);
    applyToCustomModifier({ $modInput, baseMod: app._comArtifactsBaseMod, mod });

    // Track open dialog for live GM approvals
    globalThis.comArtifactsOpenRoll.set(actor.id, {
      app,
      $root,
      $modInput,
      baseMod: app._comArtifactsBaseMod,
      $panel
    });

    // Send selection snapshot to GM (only if this client is NOT GM)
    if (!game.user.isGM) {
      const payload = {
        type: "selection",
        userId: game.user.id,
        actorId: actor.id,
        entries: entries.map(e => ({ ...e })), // include checked defaults
      };
      game.socket.emit(SOCKET, payload);
    }

    // Clear selection on submit
    $mount.off("submit.comArtifacts").on("submit.comArtifacts", () => {
      clearSel(actor.id);
      globalThis.comArtifactsOpenRoll.delete(actor.id);
    });

  } catch (e) {
    console.error("com-artifacts | renderRollDialog failed", e);
  }
});

/* -------------------- TagReviewDialog: GM view (interactive approvals) -------------------- */

function pickLikelyRequestingUserId() {
  // Best-effort fallback: first active non-GM user
  const u = game.users?.find(x => !x.isGM && x.active);
  return u?.id ?? null;
}

function extractActorFromDialog(app) {
  // Best-effort extraction across CoM implementations
  const actorId =
    app?.options?.actorId ??
    app?.options?.actor?.id ??
    app?.actor?.id ??
    app?.object?.actor?.id ??
    app?.object?.id ??
    app?.data?.actorId ??
    app?.data?.object?.actorId ??
    null;

  const actor =
    (actorId ? game.actors.get(actorId) : null) ??
    app?.actor ??
    app?.options?.actor ??
    app?.object?.actor ??
    null;

  return actor ?? null;
}

Hooks.on("renderTagReviewDialog", async (app, html) => {
  try {
    if (!game.user.isGM) return;

    const $root = html?.jquery ? html : $(html);
    if (!$root || !$root.length) return;

    // Avoid double-inject
    if ($root.find(".com-artifacts-roll").length) return;

    const actor = extractActorFromDialog(app);
    if (!actor) return;

    // Identify requesting user (best effort)
    const userId =
      app?.options?.userId ??
      app?.data?.userId ??
      app?.data?.object?.userId ??
      pickLikelyRequestingUserId();

    if (!userId) return;

    const key = `${userId}:${actor.id}`;
    const snap = globalThis.comArtifactsGMCache.get(key);
    const entries = Array.isArray(snap?.entries) ? snap.entries : [];

    // If no artifact selections, don't show panel
    if (!entries.length) return;

    // Mount into dialog content
    const $mount = $root.find("form").first().length ? $root.find("form").first() : $root;

    const $panel = renderArtifactsPanel(entries, { interactive: true });
    $mount.append($panel);

    // Initial mod display (GM-side)
    setPanelModText($panel, computePanelMod($panel));

    function emitApproval() {
      const state = {};
      $panel.find("input.com-approve").each((_, el) => {
        state[el.dataset.id] = !!el.checked;
      });

      // Update GM-side label
      const mod = computePanelMod($panel);
      setPanelModText($panel, mod);

      // Send to that player so their RollDialog updates
      game.socket.emit(SOCKET, {
        type: "approval",
        userId,
        actorId: actor.id,
        state
      });
    }

    // Any change immediately pushes to player
    $panel.on("change", "input.com-approve", emitApproval);

    // Also emit once on render to “initialize” the player if needed
    emitApproval();

  } catch (e) {
    console.error("com-artifacts | renderTagReviewDialog failed", e);
  }
});
