const MODULE_ID = "com-artifacts";

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
  let mod = 0;
  for (const p of artifact.power ?? []) {
    if (p?.active && (p?.name ?? "").trim()) mod += 1;
  }
  const w = artifact.weakness;
  if (w?.active && (w?.name ?? "").trim()) mod -= 1;
  return mod;
}
function rememberActiveTab(app, html) {
  const active = html.find('nav.sheet-tabs a.item.active, nav.tabs a.item.active').data("tab");
  app._comArtifactsLastTab = active || app._comArtifactsLastTab;
}

function restoreActiveTab(app) {
  const tab = app._comArtifactsLastTab;
  const tabs = app?._tabs?.[0];
  if (tab && tabs) tabs.activate(tab);
}


/* -------------------- Sheet UI: Add "Artifacts" tab -------------------- */

function ensureArtifactsTab(app, html, actor) {
  // show to owners + GM
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  const nav = html.find('nav.sheet-tabs, nav.tabs');
  if (!nav.length) return;

  // Add tab button if missing
  if (nav.find(`a.item[data-tab="${MODULE_ID}"]`).length === 0) {
    nav.append(`<a class="item" data-tab="${MODULE_ID}">Artifacts</a>`);
  }

  const body = html.find(".sheet-body");
  if (!body.length) return;

  // Add tab content container if missing
  if (!body.find(`.tab[data-tab="${MODULE_ID}"]`).length) {
    body.append(`
      <div class="tab" data-tab="${MODULE_ID}">
        <div class="com-artifacts-grid"></div>
      </div>
    `);
  }

  // Render slots
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
            <input type="text" data-field="name" value="${Handlebars.escapeExpression(a.name ?? "")}" />
          </div>
        </header>

        <div class="controls">
          <button type="button" class="com-pick-img"><i class="fas fa-image"></i> Image</button>
          <button type="button" class="com-clear-img"><i class="fas fa-trash"></i> Clear</button>
        </div>

        <div class="tags">
          <label>Power Tags (toggle active)</label>

          <div class="tag-row">
            <input type="checkbox" data-field="power.0.active" ${a.power?.[0]?.active ? "checked" : ""}/>
            <input type="text" data-field="power.0.name" value="${Handlebars.escapeExpression(a.power?.[0]?.name ?? "")}" placeholder="Power tag 1"/>
          </div>

          <div class="tag-row">
            <input type="checkbox" data-field="power.1.active" ${a.power?.[1]?.active ? "checked" : ""}/>
            <input type="text" data-field="power.1.name" value="${Handlebars.escapeExpression(a.power?.[1]?.name ?? "")}" placeholder="Power tag 2"/>
          </div>

          <label style="margin-top:8px; display:block;">Weakness Tag (toggle active)</label>
          <div class="tag-row">
            <input type="checkbox" data-field="weakness.active" ${a.weakness?.active ? "checked" : ""}/>
            <input type="text" data-field="weakness.name" value="${Handlebars.escapeExpression(a.weakness?.name ?? "")}" placeholder="Weakness tag"/>
          </div>
        </div>

        <div class="hint">
          Modifier = +1 per active Power tag, -1 per active Weakness tag.
        </div>
      </section>`;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // Save changes
    grid.off("change.comArtifacts").on("change.comArtifacts", "input", async (ev) => {
      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const field = ev.currentTarget.dataset.field;
      if (!field) return;

      const artifacts2 = await getArtifacts(actor);
      const path = field.split(".");
      let ref = artifacts2[idx];
      for (let i = 0; i < path.length - 1; i++) ref = ref[path[i]];
      const lastKey = path[path.length - 1];

      if (ev.currentTarget.type === "checkbox") ref[lastKey] = ev.currentTarget.checked;
      else ref[lastKey] = ev.currentTarget.value;

      await setArtifacts(actor, artifacts2);
    });

    // Image pick/clear
    grid.off("click.comArtifacts").on("click.comArtifacts", ".com-pick-img", async (ev) => {
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
        }
      }).browse();
    });

    grid.on("click.comArtifacts", ".com-clear-img", async (ev) => {
      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const artifacts2 = await getArtifacts(actor);
      artifacts2[idx].img = "";
      await setArtifacts(actor, artifacts2);
      app.render(false);
    });
  })();
}

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app?.actor;
  if (!actor) return;

  // Remember what tab was active before this render finishes
  rememberActiveTab(app, html);

  ensureArtifactsTab(app, html, actor);

  // Restore the last active tab after our tab exists
  restoreActiveTab(app);
});


/* -------------------- RollDialog: Inject artifact modifier into Custom Modifier -------------------- */

function findCustomModifierInput(html) {
  // Find label "Custom Modifier" then the input in the same form-group block
  const labels = html.find("label");
  for (const el of labels) {
    const txt = (el.textContent ?? "").trim().toLowerCase();
    if (txt === "custom modifier") {
      const input = $(el).closest(".form-group, .form-fields, div").find("input").first();
      if (input?.length) return input;
    }
  }

  // Fallback: any input with placeholder/aria containing modifier
  const inputs = html.find("input");
  for (const el of inputs) {
    const $el = $(el);
    const ph = ($el.attr("placeholder") ?? "").toLowerCase();
    const aria = ($el.attr("aria-label") ?? "").toLowerCase();
    if (ph.includes("modifier") || aria.includes("modifier")) return $el;
  }

  // Last resort
  const any = html.find('input[type="number"], input[type="text"]').first();
  return any?.length ? any : null;
}

Hooks.on("renderRollDialog", async (app, html) => {
  try {
    // Resolve actor
    const actor =
      app.actor ??
      app.options?.actor ??
      (app.options?.actorId ? game.actors.get(app.options.actorId) : null) ??
      game.user.character;

    if (!actor) return;

    const artifacts = await getArtifacts(actor);
    if (!artifacts) return;

    const panel = $(`
      <fieldset class="com-artifacts-roll" style="margin-top:10px; padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
        <legend>Artifacts</legend>

        <div class="form-group" style="display:flex; gap:8px; align-items:center;">
          <label style="flex:0 0 auto;">Use:</label>
          <select name="comArtifactSlot" style="flex:1;">
            <option value="0">${Handlebars.escapeExpression(artifacts[0]?.name ?? "Artifact 1")}</option>
            <option value="1">${Handlebars.escapeExpression(artifacts[1]?.name ?? "Artifact 2")}</option>
            <option value="-1">None</option>
          </select>
        </div>

        <div class="form-group" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Computed modifier:</span>
          <strong class="com-artifacts-mod">+0</strong>
        </div>

        <p class="notes" style="margin:0;">
          Uses the active toggles from your Artifact sheet.
        </p>
      </fieldset>
    `);

    const form = html.find("form");
    if (form.length) form.append(panel);
    else html.append(panel);

    const modInput = findCustomModifierInput(html);

    function getSelectedMod() {
      const slot = Number(panel.find('select[name="comArtifactSlot"]').val());
      let mod = 0;
      if (slot === 0 || slot === 1) mod = computeArtifactMod(artifacts[slot]);
      const sign = mod >= 0 ? "+" : "";
      panel.find(".com-artifacts-mod").text(`${sign}${mod}`);
      return mod;
    }

    getSelectedMod();

    panel.on("change", 'select[name="comArtifactSlot"]', () => {
      getSelectedMod();
    });

    // Hook Confirm specifically (CoM dialog uses Confirm)
    const confirmBtn = html.find('button:contains("Confirm")');
    if (!confirmBtn.length) return;

    // Avoid double-binding if the dialog re-renders
    confirmBtn.off("click.comArtifacts").on("click.comArtifacts", async () => {
  const slot = Number(panel.find('select[name="comArtifactSlot"]').val());
  const mod = getSelectedMod();

  if (mod && modInput && modInput.length) {
    const current = Number(modInput.val() ?? 0);
    const next = (Number.isFinite(current) ? current : 0) + mod;

    modInput.val(next);
    modInput.trigger("input");
    modInput.trigger("change");

    panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod} (applied)`);
  }

  // Auto-clear toggles after roll confirm (only the selected artifact)
  if (slot === 0 || slot === 1) {
    try {
      const artifactsNow = await getArtifacts(actor);

      // Clear active toggles
      for (const p of artifactsNow[slot].power ?? []) p.active = false;
      if (artifactsNow[slot].weakness) artifactsNow[slot].weakness.active = false;

      await setArtifacts(actor, artifactsNow);

      // Keep the sheet on the Artifacts tab if it re-renders
      // (this prevents “jump back” after the update)
      actor.sheet?._comArtifactsLastTab = MODULE_ID;
    } catch (e) {
      console.error("com-artifacts | auto-clear after roll failed", e);
    }
  }
});


  } catch (e) {
    console.error("com-artifacts | renderRollDialog failed", e);
  }
});
