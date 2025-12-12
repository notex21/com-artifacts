const MODULE_ID = "com-artifacts";

/* =========================
   DATA
========================= */

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
  const data = await actor.getFlag(MODULE_ID, "artifacts");
  if (!Array.isArray(data) || data.length !== 2) {
    const d = defaultArtifacts();
    await actor.setFlag(MODULE_ID, "artifacts", d);
    return d;
  }
  return data;
}

async function setArtifacts(actor, artifacts) {
  return actor.setFlag(MODULE_ID, "artifacts", artifacts);
}

function computeArtifactMod(artifact) {
  let mod = 0;
  for (const p of artifact.power ?? []) {
    if (p?.active && (p?.name ?? "").trim()) mod += 1;
  }
  if (artifact.weakness?.active && (artifact.weakness?.name ?? "").trim()) mod -= 1;
  return mod;
}

/* =========================
   TAB STICKINESS
========================= */

function getActiveTabFromHtml(html) {
  return html.find('nav.sheet-tabs a.item.active, nav.tabs a.item.active').data("tab");
}

function forceActivateTab(app, tabName) {
  const tabs = app?._tabs?.[0];
  if (!tabs || !tabName) return;
  // Must run after render settles (CoM likes to reset)
  setTimeout(() => {
    try { tabs.activate(tabName); } catch (_) {}
  }, 0);
}

/* =========================
   SHEET UI (CityCharacterSheet)
========================= */

function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  const nav = html.find("nav.sheet-tabs, nav.tabs");
  if (!nav.length) return;

  if (!nav.find(`a.item[data-tab="${MODULE_ID}"]`).length) {
    nav.append(`<a class="item" data-tab="${MODULE_ID}">Artifacts</a>`);
  }

  const body = html.find(".sheet-body");
  if (!body.length) return;

  if (!body.find(`.tab[data-tab="${MODULE_ID}"]`).length) {
    body.append(`<div class="tab" data-tab="${MODULE_ID}"><div class="com-artifacts-grid"></div></div>`);
  }

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);

    const slotHtml = (a, idx) => {
      const imgStyle = a.img
        ? `style="background-image:url('${a.img.replace(/'/g, "%27")}')"`
        : `style="background-image:none"`;
      return `
      <section class="com-artifact" data-idx="${idx}"
        style="border:1px solid var(--color-border-light-primary); border-radius:8px; padding:10px; margin-bottom:10px;">
        <header style="display:flex; gap:10px; align-items:center;">
          <div class="img" ${imgStyle}
            style="width:64px;height:64px;border:1px solid var(--color-border-light-primary);border-radius:6px;background-size:cover;background-position:center;"></div>
          <div style="flex:1;">
            <label>Artifact Name</label>
            <input type="text" data-field="name" value="${Handlebars.escapeExpression(a.name ?? "")}" />
          </div>
        </header>

        <div style="display:flex; gap:8px; margin-top:8px;">
          <button type="button" class="com-pick-img"><i class="fas fa-image"></i> Image</button>
          <button type="button" class="com-clear-img"><i class="fas fa-trash"></i> Clear</button>
        </div>

        <div style="margin-top:10px;">
          <label>Power Tags (toggle active)</label>

          <div style="display:grid; grid-template-columns: 26px 1fr; gap:8px; margin-top:6px;">
            <input type="checkbox" data-field="power.0.active" ${a.power?.[0]?.active ? "checked" : ""}/>
            <input type="text" data-field="power.0.name" value="${Handlebars.escapeExpression(a.power?.[0]?.name ?? "")}" placeholder="Power tag 1"/>
          </div>

          <div style="display:grid; grid-template-columns: 26px 1fr; gap:8px; margin-top:6px;">
            <input type="checkbox" data-field="power.1.active" ${a.power?.[1]?.active ? "checked" : ""}/>
            <input type="text" data-field="power.1.name" value="${Handlebars.escapeExpression(a.power?.[1]?.name ?? "")}" placeholder="Power tag 2"/>
          </div>

          <label style="margin-top:10px; display:block;">Weakness Tag (toggle active)</label>
          <div style="display:grid; grid-template-columns: 26px 1fr; gap:8px; margin-top:6px;">
            <input type="checkbox" data-field="weakness.active" ${a.weakness?.active ? "checked" : ""}/>
            <input type="text" data-field="weakness.name" value="${Handlebars.escapeExpression(a.weakness?.name ?? "")}" placeholder="Weakness tag"/>
          </div>

          <div style="opacity:.8; font-size:12px; margin-top:8px;">
            Modifier = +1 per active Power tag, -1 per active Weakness tag.
          </div>
        </div>
      </section>`;
    };

    grid.html([slotHtml(artifacts[0], 0), slotHtml(artifacts[1], 1)].join(""));

    // Save changes; keep tab on Artifacts
    grid.off("change.comArtifacts").on("change.comArtifacts", "input", async (ev) => {
      // Remember that Artifacts is the desired tab
      app._comLastTab = MODULE_ID;

      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const field = ev.currentTarget.dataset.field;
      if (!field) return;

      const arts = await getArtifacts(actor);

      const parts = field.split(".");
      let ref = arts[idx];
      for (let i = 0; i < parts.length - 1; i++) ref = ref[parts[i]];
      const key = parts[parts.length - 1];

      ref[key] = (ev.currentTarget.type === "checkbox")
        ? ev.currentTarget.checked
        : ev.currentTarget.value;

      await setArtifacts(actor, arts);

      // After the sheet re-renders, jump back to Artifacts
      forceActivateTab(app, MODULE_ID);
    });

    grid.off("click.comArtifacts").on("click.comArtifacts", ".com-pick-img", async (ev) => {
      app._comLastTab = MODULE_ID;
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
          forceActivateTab(app, MODULE_ID);
        }
      }).browse();
    });

    grid.on("click.comArtifacts", ".com-clear-img", async (ev) => {
      app._comLastTab = MODULE_ID;
      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const arts = await getArtifacts(actor);
      arts[idx].img = "";
      await setArtifacts(actor, arts);
      app.render(false);
      forceActivateTab(app, MODULE_ID);
    });
  })();
}

// Use the sheet class you actually have: CityCharacterSheet
Hooks.on("renderCityCharacterSheet", (app, html) => {
  // Remember current active tab
  const active = getActiveTabFromHtml(html);
  if (active) app._comLastTab = active;

  ensureArtifactsTab(app, html, app.actor);

  // Restore tab (default to Artifacts if we just edited artifacts)
  forceActivateTab(app, app._comLastTab);
});

// Fallback (in case system changes hook name)
Hooks.on("renderActorSheet", (app, html) => {
  if (app?.constructor?.name !== "CityCharacterSheet") return;

  const active = getActiveTabFromHtml(html);
  if (active) app._comLastTab = active;

  ensureArtifactsTab(app, html, app.actor);
  forceActivateTab(app, app._comLastTab);
});

/* =========================
   ROLLDIALOG INJECTION
========================= */

function findCustomModifierInput(html) {
  // Find the label containing "Custom Modifier", then the nearest input
  const labels = html.find("label");
  for (const l of labels) {
    const t = (l.textContent ?? "").trim().toLowerCase();
    if (t.includes("custom modifier")) {
      const group = $(l).closest(".form-group, .form-fields, div");
      const input = group.find("input").first();
      if (input.length) return input;
    }
  }

  // Fallback: input whose name/id hints modifier
  const candidates = html.find('input[name*="mod" i], input[id*="mod" i], input[name*="modifier" i], input[id*="modifier" i]');
  if (candidates.length) return candidates.first();

  // Last resort
  const any = html.find('input[type="number"], input[type="text"]').first();
  return any.length ? any : null;
}

Hooks.on("renderRollDialog", async (app, html) => {
  try {
    const actor = app.actor ?? app.options?.actor ?? game.user.character;
    if (!actor) return;

    const artifacts = await getArtifacts(actor);
    const form = html.find("form");
    if (!form.length) return;

    // Avoid duplicate panel on re-render
    if (form.find(".com-artifacts-roll").length) return;

    const panel = $(`
      <fieldset class="com-artifacts-roll" style="margin-top:10px; padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
        <legend>Artifacts</legend>

        <div class="form-group" style="display:flex; gap:8px; align-items:center;">
          <label style="flex:0 0 auto;">Use:</label>
          <select name="comArtifactSlot" style="flex:1;">
            <option value="-1">None</option>
            <option value="0">${Handlebars.escapeExpression(artifacts[0]?.name ?? "Artifact 1")}</option>
            <option value="1">${Handlebars.escapeExpression(artifacts[1]?.name ?? "Artifact 2")}</option>
          </select>
        </div>

        <div class="form-group" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Computed modifier:</span>
          <strong class="com-artifacts-mod">+0</strong>
        </div>

        <p class="notes" style="margin:0;">
          Uses active toggles from the Artifacts tab.
        </p>
      </fieldset>
    `);

    form.append(panel);

    const modInput = findCustomModifierInput(html);

    function calc() {
      const slot = Number(panel.find('select[name="comArtifactSlot"]').val());
      let mod = 0;
      if (slot === 0 || slot === 1) mod = computeArtifactMod(artifacts[slot]);
      panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod}`);
      return { slot, mod };
    }

    calc();
    panel.on("change", "select", calc);

    // IMPORTANT: inject right before submit (works regardless of button label)
    form.off("submit.comArtifacts").on("submit.comArtifacts", async () => {
      const { slot, mod } = calc();
      if (!mod) return;

      if (!modInput || !modInput.length) {
        ui.notifications?.warn("Artifacts: Could not find Custom Modifier input.");
        return;
      }

      const current = Number(modInput.val() ?? 0);
      const next = (Number.isFinite(current) ? current : 0) + mod;
      modInput.val(next);
      modInput.trigger("input");
      modInput.trigger("change");

      // Auto-uncheck after the roll
      if (slot === 0 || slot === 1) {
        const arts = await getArtifacts(actor);
        for (const p of arts[slot].power ?? []) p.active = false;
        if (arts[slot].weakness) arts[slot].weakness.active = false;
        await setArtifacts(actor, arts);
      }
    });

  } catch (e) {
    console.error(`${MODULE_ID} | renderRollDialog failed`, e);
  }
});
