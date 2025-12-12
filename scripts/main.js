const MODULE_ID = "com-artifacts";

/* -------------------- Socket (player -> GM) -------------------- */

globalThis.comArtifactsPendingForGM ??= new Map(); 
// Map<actorId, { entries: Array<{label:string, mod:number}>, total:number, fromUserId:string, ts:number }>

function socketChannel() {
  return `module.${MODULE_ID}`;
}

function isGM() {
  return game.user?.isGM;
}

Hooks.once("ready", () => {
  game.socket.on(socketChannel(), (msg) => {
    try {
      if (!msg || msg.type !== "artifactSelection") return;
      if (!isGM()) return;

      const { actorId, entries, total, fromUserId, ts } = msg;
      if (!actorId) return;

      globalThis.comArtifactsPendingForGM.set(actorId, {
        entries: Array.isArray(entries) ? entries : [],
        total: Number(total ?? 0) || 0,
        fromUserId: String(fromUserId ?? ""),
        ts: Number(ts ?? Date.now())
      });

      // Optional: debug
      // console.log("com-artifacts | received selection", actorId, entries, total);
    } catch (e) {
      console.error("com-artifacts | socket handler failed", e);
    }
  });
});

function sendSelectionToGM(actorId, entries, total) {
  try {
    game.socket.emit(socketChannel(), {
      type: "artifactSelection",
      actorId,
      entries,
      total,
      fromUserId: game.user?.id,
      ts: Date.now()
    });
  } catch (e) {
    console.error("com-artifacts | sendSelectionToGM failed", e);
  }
}

/* -------------------- Client-side selection (NO actor updates) -------------------- */

globalThis.comArtifactsSelection ??= new Map(); // Map<actorId, Set<string>>

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

/* -------------------- Sheet UI: Add "Artifacts" tab -------------------- */

function ensureArtifactsTab(app, html, actor) {
  // Allow everyone who can open the sheet to at least SEE the tab;
  // editing controls still respect lock & permissions.
  if (!actor) return;

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
          <span
            class="com-tag-pick ${isWeak ? "com-weak" : ""}"
            data-pick="${pickKey}"
            style="${hasValue ? "" : "display:none;"}"
          >${Handlebars.escapeExpression(label)}</span>

          <button type="button" class="com-edit-tag" title="${hasValue ? "Edit" : "Add"}">✎</button>

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

    // Restore highlight state (client-side)
    const s = getSel(actor.id);
    grid.find(".com-tag-pick").each((_, el) => {
      const key = el.dataset.pick;
      if (s.has(key)) $(el).addClass("com-picked");
    });

    // Click-to-highlight (NO actor writes)
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pick", (ev) => {
      if ($(ev.currentTarget).hasClass("com-editing")) return;
      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $(ev.currentTarget).toggleClass("com-picked", set.has(key));
    });

    // Edit button: inline edit
    grid.off("click.comArtifactsEdit").on("click.comArtifactsEdit", ".com-edit-tag", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const editable = isSheetEditable(html);
      if (!editable) return;
      const $row = $(ev.currentTarget).closest(".tag-row");
      startInlineEdit($row, editable);
      syncTagRowUI($row, true);
    });

    // Enter/Escape while editing
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

    // Blur saves
    grid.off("blur.comArtifactsInline").on("blur.comArtifactsInline", ".com-tag-pick.com-editing", (ev) => {
      const $row = $(ev.currentTarget).closest(".tag-row");
      commitInlineEdit($row);
      const editable = isSheetEditable(html);
      syncTagRowUI($row, editable);
    });

    // Save changes (artifact name + hidden tag storage)
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

      // Update visible clickable label immediately (for tag edits)
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

  const tab = getActiveTab(html);
  if (tab) app._comLastTab = tab;

  ensureArtifactsTab(app, html, actor);

  forceActivateTab(app, app._comLastTab);

  const editable = isSheetEditable(html);
  setArtifactsEditable(html, editable);
  installLockObserver(app, html);
});

/* -------------------- RollDialog: apply +1/-1 and send to GM -------------------- */

function findCustomModifierInput(html) {
  const labels = html.find("label");
  for (const el of labels) {
    const txt = (el.textContent ?? "").trim().toLowerCase();
    if (txt === "custom modifier") {
      // IMPORTANT: CoM wraps this oddly sometimes; check multiple scopes
      let input = $(el).closest(".form-group, .form-fields, div, label").find("input").first();
      if (input?.length) return input;

      input = $(el).parent().find("input").first();
      if (input?.length) return input;

      input = $(el).nextAll("input").first();
      if (input?.length) return input;

      input = $(el).closest(".roll-dialog").find("input").first();
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
    const sel = getSel(actor.id);

    const form = html.find("form");
    // If CoM changes structure: fallback to root
    const root = form.length ? form : html.find(".roll-dialog").first();
    if (!root.length) return;

    if (root.find(".com-artifacts-roll").length) return;

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

    root.append(panel);

    function recomputeAndApply() {
      let mod = 0;
      panel.find("input.com-approve:checked").each((_, el) => {
        mod += Number(el.dataset.mod ?? 0);
      });

      panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod}`);

      modInput.val((app._comArtifactsBaseMod ?? 0) + mod);
      modInput.trigger("input");
      modInput.trigger("change");

      return mod;
    }

    const totalNow = recomputeAndApply();
    panel.on("change", "input.com-approve", recomputeAndApply);

    // When the player confirms the roll, send selection to GM for review window display
    // We do it on submit AND also on clicking confirm buttons (CoM sometimes bypasses submit handlers).
    const sendNow = () => {
      const approvedEntries = [];
      panel.find("input.com-approve:checked").each((_, el) => {
        const $row = $(el).closest("label");
        const label = ($row.find("span").first().text() ?? "").trim();
        const mod = Number(el.dataset.mod ?? 0);
        if (label) approvedEntries.push({ label, mod });
      });
      const total = approvedEntries.reduce((s, e) => s + (Number(e.mod) || 0), 0);
      sendSelectionToGM(actor.id, approvedEntries, total);
      return { approvedEntries, total };
    };

    root.off("submit.comArtifacts").on("submit.comArtifacts", () => {
      sendNow();
      clearSel(actor.id);
    });

    // Also catch button clicks (Confirm / Waiting / etc.)
    root.off("click.comArtifactsConfirm").on("click.comArtifactsConfirm", 'button, a', (ev) => {
      const txt = ($(ev.currentTarget).text() ?? "").trim().toLowerCase();
      if (txt.includes("confirm") || txt.includes("execute") || txt.includes("roll")) {
        sendNow();
      }
    });

  } catch (e) {
    console.error("com-artifacts | renderRollDialog failed", e);
  }
});

/* -------------------- GM TagReviewDialog: inject artifact tags -------------------- */

Hooks.on("renderApplication", (app, html) => {
  try {
    if (!isGM()) return;

    const name = app?.constructor?.name ?? "";
    if (name !== "TagReviewDialog") return;

    const $html = (html?.jquery ? html : $(html));

    if ($html.find(".com-artifacts-review").length) return;

    // Try to resolve actor from app (works in CoM often), else fallback to last pending by name is not safe
    const actor =
      app?.actor ??
      app?.options?.actor ??
      (app?.options?.actorId ? game.actors.get(app.options.actorId) : null) ??
      null;

    if (!actor) return;

    const pending = globalThis.comArtifactsPendingForGM.get(actor.id);
    if (!pending || !pending.entries?.length) return;

    const items = pending.entries.map(e => {
      const sign = e.mod > 0 ? "+1" : "-1";
      return `
        <div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
          <i class="fas ${e.mod > 0 ? "fa-bolt" : "fa-skull"}" style="opacity:.85;"></i>
          <span style="font-weight:600;">${Handlebars.escapeExpression(e.label)}</span>
          <span style="opacity:.75;">(${sign})</span>
        </div>`;
    }).join("");

    const host =
      $html.find("*").filter((_, el) => (el.textContent || "").trim() === "SelectedItems").first().closest("div").length
        ? $html.find("*").filter((_, el) => (el.textContent || "").trim() === "SelectedItems").first().closest("div")
        : $html.find(".dialog-content, form").first();

    if (!host.length) return;

    host.append(`
      <div class="com-artifacts-review" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12);">
        <div style="font-weight:700;margin-bottom:4px;">Artifact Tags</div>
        ${items}
        <div style="margin-top:4px;opacity:.9;">Artifact modifier total: <b>${pending.total}</b></div>
      </div>
    `);

  } catch (e) {
    console.error("com-artifacts | renderApplication(TagReviewDialog) failed", e);
  }
});
