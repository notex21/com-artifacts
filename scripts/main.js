const MODULE_ID = "com-artifacts";

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

function computeArtifactMod(artifact) {
  if (!artifact) return 0;
  // unused in this new flow; RollDialog builds +/- from selection
  return 0;
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
    // Enable editor-only controls, but visibility is handled per-row by UI logic
    tab.find(".com-editor-only").prop("disabled", false);
    tab.find(".com-edit-tag").prop("disabled", false).show();

    // In edit mode, keep clickable tags visible (even if empty will be hidden by row UI)
    tab.find(".com-tag-pick").show();
  } else {
    // Hide ALL inputs/buttons that allow editing
    tab.find(".com-editor-only").prop("disabled", true).hide();
    tab.find(".com-edit-tag").prop("disabled", true).hide();

    // Hide empty labels when locked (only show written names)
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
    } catch (_) {}
  });

  obs.observe(root, { attributes: true, childList: true, subtree: true });
  app._comLockObserver = obs;
}

/* -------------------- Sheet UI: Add "Artifacts" tab -------------------- */

function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  // Inject minimal CSS once
  if (!document.getElementById("com-artifacts-inline-style")) {
    const style = document.createElement("style");
    style.id = "com-artifacts-inline-style";
    style.textContent = `
      .com-artifacts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .com-artifact { border: 1px solid var(--color-border-light-primary); border-radius: 8px; padding: 10px; }
      .com-artifact header { display:flex; gap:10px; align-items:center; }
      .com-artifact .img { width:64px; height:64px; border:1px solid var(--color-border-light-primary); border-radius:6px; background-size:cover; background-position:center; }
      .com-artifact .controls { display:flex; gap:8px; margin-top:8px; }
      .com-artifact .tag-row { display:flex; gap:8px; align-items:center; margin:6px 0; }
      .com-artifact .tag-row input[type="text"] { flex: 1; }

      .com-tag-pick { display:inline-block; padding:2px 6px; border-radius:4px; cursor:pointer; user-select:none; }
      .com-tag-pick.com-picked { background: #ffeb3b; }
      .com-tag-pick.com-weak.com-picked { background: #ffd54f; }

      .com-edit-tag {
        background: none;
        border: none;
        padding: 0 4px;
        cursor: pointer;
        opacity: .65;
        font-size: 12px;
        line-height: 1;
      }
      .com-edit-tag:hover { opacity: 1; }

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
    const $input = $row.find("input.com-editor-only");

    const name = ($pick.text() ?? "").trim();
    const editing = $row.data("editing") === 1;

    if (!editable) {
      // Locked: no inputs/edit buttons; show only non-empty pick
      $input.hide();
      $edit.hide();
      $pick.toggle(!!name);
      return;
    }

    // Editable:
    if (editing) {
      $pick.show(); // keep pick shown for click-to-highlight
      $edit.hide();
      $input.show();
      return;
    }

    if (name) {
      // Named: show pick + edit, hide input
      $pick.show();
      $edit.show();
      $input.hide();
    } else {
      // Empty: hide pick+edit, show input
      $pick.hide();
      $edit.hide();
      $input.show();
    }
  }

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);

    const renderTagRow = ({ idx, pickKey, isWeak, field, value, placeholder }) => {
      const label = ((value ?? "").trim());
      const hasValue = !!label;

      return `
        <div class="tag-row" data-field="${field}">
          <span class="com-tag-pick ${isWeak ? "com-weak" : ""}" data-pick="${pickKey}">${Handlebars.escapeExpression(label)}</span>
          <button type="button" class="com-edit-tag" title="Edit" ${hasValue ? "" : "style=\"display:none;\""}>✎</button>
          <input class="com-editor-only" type="text" data-field="${field}"
            value="${Handlebars.escapeExpression(value ?? "")}"
            placeholder="${Handlebars.escapeExpression(placeholder)}"
            ${hasValue ? "style=\"display:none;\"" : ""}/>
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

          ${renderTagRow({
            idx, pickKey: `a${idx}.p0`, isWeak: false,
            field: "power.0.name",
            value: a.power?.[0]?.name ?? "",
            placeholder: "Power tag 1"
          })}

          ${renderTagRow({
            idx, pickKey: `a${idx}.p1`, isWeak: false,
            field: "power.1.name",
            value: a.power?.[1]?.name ?? "",
            placeholder: "Power tag 2"
          })}

          <label style="margin-top:8px; display:block;">Weakness Tag (click to mark)</label>

          ${renderTagRow({
            idx, pickKey: `a${idx}.w`, isWeak: true,
            field: "weakness.name",
            value: a.weakness?.name ?? "",
            placeholder: "Weakness tag"
          })}
        </div>

        <div class="hint">
          Click tag names to highlight. Highlighted tags appear in Make Roll for MC approval.
        </div>
      </section>`;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // Restore highlight state
    const s = getSel(actor.id);
    grid.find(".com-tag-pick").each((_, el) => {
      const key = el.dataset.pick;
      if (s.has(key)) $(el).addClass("com-picked");
    });

    // Click-to-highlight (NO actor writes)
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pick", (ev) => {
      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $(ev.currentTarget).toggleClass("com-picked", set.has(key));
    });

    // Edit button: show input temporarily
    grid.off("click.comArtifactsEdit").on("click.comArtifactsEdit", ".com-edit-tag", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const editable = isSheetEditable(html);
      if (!editable) return;

      const $row = $(ev.currentTarget).closest(".tag-row");
      $row.data("editing", 1);

      const $input = $row.find("input.com-editor-only");
      $input.show().focus();
      syncTagRowUI($row, true);
    });

    // When leaving input (blur), stop editing + apply hide/show rules
    grid.off("blur.comArtifactsEdit", "input.com-editor-only").on("blur.comArtifactsEdit", "input.com-editor-only", (ev) => {
      const editable = isSheetEditable(html);
      const $row = $(ev.currentTarget).closest(".tag-row");
      $row.data("editing", 0);
      syncTagRowUI($row, editable);
    });

    // Save changes (name fields / tag text fields only)
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

      // Update visible clickable label immediately
      const $section = $(section);
      if (field === "power.0.name") $section.find(`.com-tag-pick[data-pick="a${idx}.p0"]`).text(ev.currentTarget.value.trim());
      if (field === "power.1.name") $section.find(`.com-tag-pick[data-pick="a${idx}.p1"]`).text(ev.currentTarget.value.trim());
      if (field === "weakness.name") $section.find(`.com-tag-pick[data-pick="a${idx}.w"]`).text(ev.currentTarget.value.trim());

      await setArtifacts(actor, artifacts2);
      forceActivateTab(app, app._comLastTab);

      // After saving, enforce the new "hide input if named" rule
      const editable = isSheetEditable(html);
      $section.find(".tag-row").each((_, rowEl) => syncTagRowUI($(rowEl), editable));

      // Re-apply lock behavior
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

    // Apply lock state to Artifacts tab + sync per-row UI
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
    const sel = getSel(actor.id);

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

    form.off("submit.comArtifacts").on("submit.comArtifacts", () => {
      clearSel(actor.id);
    });

  } catch (e) {
    console.error("com-artifacts | renderRollDialog failed", e);
  }
});

