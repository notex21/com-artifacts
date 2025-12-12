const MODULE_ID = "com-artifacts";

/* -------------------- Data Model -------------------- */

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

function computeModifier(artifact) {
  let mod = 0;
  for (const p of artifact.power ?? []) {
    if (p?.active && (p?.name ?? "").trim()) mod += 1;
  }
  const w = artifact.weakness;
  if (w?.active && (w?.name ?? "").trim()) mod -= 1;
  return mod;
}

function summarizeSelected(artifact) {
  const power = (artifact.power ?? []).filter(t => t.active && (t.name ?? "").trim()).map(t => t.name.trim());
  const weakness = (artifact.weakness?.active && (artifact.weakness?.name ?? "").trim()) ? artifact.weakness.name.trim() : null;
  return { power, weakness };
}

function renderArtifactCard(actorName, artifact, mod) {
  const sign = mod >= 0 ? "+" : "";
  const { power, weakness } = summarizeSelected(artifact);
  const li = (t) => `<li>${Handlebars.escapeExpression(t)}</li>`;

  return `
  <div class="chat-card">
    <header class="card-header">
      <h3>Artifact Applied: ${Handlebars.escapeExpression(actorName)} — ${Handlebars.escapeExpression(artifact.name ?? "Artifact")}</h3>
    </header>
    <div class="card-content">
      <p><strong>Modifier:</strong> ${sign}${mod}</p>
      ${power.length ? `<p><strong>Power tags:</strong></p><ul>${power.map(li).join("")}</ul>` : `<p><em>No active power tags.</em></p>`}
      ${weakness ? `<p><strong>Weakness tag:</strong></p><ul>${li(weakness)}</ul>` : ""}
    </div>
  </div>`;
}

/* -------------------- Arm / Disarm -------------------- */

async function armArtifact(actor, artifactIndex, mode /* "next" | "persistent" */) {
  const artifacts = await getArtifacts(actor);
  const artifact = artifacts[artifactIndex];
  const mod = computeModifier(artifact);

  const payload = {
    artifactIndex,
    mode,
    armedAt: Date.now(),
    modifier: mod,
    artifactSnapshot: artifact // snapshot so it won’t change mid-roll
  };

  await actor.setFlag(MODULE_ID, "armed", payload);

  ui.notifications?.info(
    mode === "persistent"
      ? `Artifact armed (persistent): ${artifact.name} (${mod >= 0 ? "+" : ""}${mod})`
      : `Artifact armed (next roll): ${artifact.name} (${mod >= 0 ? "+" : ""}${mod})`
  );
}

async function disarmArtifact(actor) {
  await actor.unsetFlag(MODULE_ID, "armed");
  ui.notifications?.info("Artifact disarmed.");
}

/* -------------------- Roll Intercept -------------------- */
/**
 * We intercept chat message creation:
 * - If message has a speaker actor with an armed artifact flag, we:
 *   1) post an Artifact Applied card
 *   2) if msg.rolls has a standard roll formula, we also post an adjusted roll
 *   3) clear the arm flag if mode === "next"
 *
 * This avoids any dependence on CoM internal APIs.
 */
Hooks.on("preCreateChatMessage", async (doc, data, options, userId) => {
  try {
    // 1. Ignore messages created by this module itself
    if (data.flags?.["com-artifacts"]?.internal) return;

    // 2. Only react to messages that actually contain a roll
    const rolls = data.rolls ?? [];
    if (!Array.isArray(rolls) || rolls.length === 0) return;

    // 3. Identify the actor
    const speaker = data.speaker;
    const actorId = speaker?.actor;
    if (!actorId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    // 4. Check if an artifact is armed
    const armed = await actor.getFlag("com-artifacts", "armed");
    if (!armed) return;

    // 5. Consume immediately (VERY IMPORTANT)
    await actor.unsetFlag("com-artifacts", "armed");

    const artifact = armed.artifactSnapshot;
    const mod = Number(armed.modifier ?? 0);

    // 6. Post artifact card (marked as internal!)
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="chat-card">
          <header class="card-header">
            <h3>Artifact Applied: ${artifact.name}</h3>
          </header>
          <div class="card-content">
            <p><strong>Modifier:</strong> ${mod >= 0 ? "+" : ""}${mod}</p>
          </div>
        </div>
      `,
      flags: {
        "com-artifacts": {
          internal: true
        }
      }
    });

  } catch (err) {
    console.error("com-artifacts hook error:", err);
  }
});

/* -------------------- Sheet UI -------------------- */

function addArtifactsTab(app, html, actor) {
  // Show to owners (players) and GM
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  const nav = html.find('nav.sheet-tabs, nav.tabs');
  if (!nav.length) return;

  if (nav.find(`a.item[data-tab="${MODULE_ID}"]`).length === 0) {
    nav.append(`<a class="item" data-tab="${MODULE_ID}">Artifacts</a>`);
  }

  const body = html.find(".sheet-body");
  if (!body.length || body.find(`.tab[data-tab="${MODULE_ID}"]`).length) return;

  body.append(`
    <div class="tab" data-tab="${MODULE_ID}">
      <div class="com-artifacts-grid"></div>
      <hr/>
      <div class="com-artifacts-global" style="margin-top:10px;">
        <button type="button" class="com-disarm"><i class="fas fa-ban"></i> Disarm Artifact</button>
        <p class="notes" style="margin-top:6px;">
          Arm applies to your next roll (or persists if you choose persistent).
        </p>
      </div>
    </div>
  `);

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

        <div class="controls">
          <button type="button" class="com-arm-next"><i class="fas fa-bolt"></i> Arm (Next Roll)</button>
          <button type="button" class="com-arm-persist"><i class="fas fa-broadcast-tower"></i> Arm (Persistent Aura)</button>
        </div>

        <div class="hint">
          Modifier = +1 per active Power tag, -1 per active Weakness tag.
        </div>
      </section>`;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // Save changes
    grid.on("change", "input", async (ev) => {
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
    grid.on("click", ".com-pick-img", async (ev) => {
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

    grid.on("click", ".com-clear-img", async (ev) => {
      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const artifacts2 = await getArtifacts(actor);
      artifacts2[idx].img = "";
      await setArtifacts(actor, artifacts2);
      app.render(false);
    });

    // Arm buttons
    grid.on("click", ".com-arm-next", async (ev) => {
      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      await armArtifact(actor, idx, "next");
    });

    grid.on("click", ".com-arm-persist", async (ev) => {
      const section = ev.currentTarget.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      await armArtifact(actor, idx, "persistent");
    });

    // Disarm
    body.find(`.tab[data-tab="${MODULE_ID}"] .com-disarm`).on("click", async () => {
      await disarmArtifact(actor);
    });
  })();
}

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app?.actor;
  if (!actor) return;
  addArtifactsTab(app, html, actor);
});
const COM_ART_MODULE = "com-artifacts";

// Reuse your existing flag format (artifacts stored on actor flags)
async function comGetArtifacts(actor) {
  const data = (await actor.getFlag(COM_ART_MODULE, "artifacts")) ?? null;
  if (!Array.isArray(data) || data.length < 2) return null;
  return data;
}

function comComputeArtifactMod(artifact) {
  if (!artifact) return 0;
  let mod = 0;
  for (const p of artifact.power ?? []) {
    if (p?.active && (p?.name ?? "").trim()) mod += 1;
  }
  const w = artifact.weakness;
  if (w?.active && (w?.name ?? "").trim()) mod -= 1;
  return mod;
}

function comFindModInput(html) {
  // Try the most common input names used by roll dialogs
  const candidates = [
    'input[name="modifier"]',
    'input[name="mod"]',
    'input[name="bonus"]',
    'input[name="rollMod"]',
    'input[name="rollModifier"]'
  ];

  for (const sel of candidates) {
    const el = html.find(sel);
    if (el.length) return el.first();
  }

  // Fallback: first number input in the dialog
  const numberInputs = html.find('input[type="number"]');
  if (numberInputs.length) return numberInputs.first();

  return null;
}

Hooks.on("renderRollDialog", async (app, html) => {
  try {
    // Best-effort actor resolution
    const actor =
      app.actor ??
      app.options?.actor ??
      (app.options?.actorId ? game.actors.get(app.options.actorId) : null) ??
      game.user.character;

    if (!actor) return;

    const artifacts = await comGetArtifacts(actor);
    if (!artifacts) return;

    // Build UI
    const panel = $(`
      <fieldset class="com-artifacts-roll" style="margin-top:10px; padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
        <legend>Artifacts</legend>

        <div class="form-group" style="display:flex; gap:8px; align-items:center;">
          <label style="flex:0 0 auto;">Use:</label>
          <select name="comArtifactSlot" style="flex:1;">
            <option value="0">${artifacts[0]?.name ?? "Artifact 1"}</option>
            <option value="1">${artifacts[1]?.name ?? "Artifact 2"}</option>
            <option value="-1">None</option>
          </select>
        </div>

        <div class="form-group" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Computed modifier:</span>
          <strong class="com-artifacts-mod">+0</strong>
        </div>

        <p class="notes" style="margin:0;">
          Modifier = +1 per active Power tag, -1 per active Weakness tag (as toggled on the sheet).
        </p>
      </fieldset>
    `);

    // Insert panel near the bottom of the dialog form
    const form = html.find("form");
    if (form.length) form.append(panel);
    else html.append(panel);

    const modInput = comFindModInput(html);

    function updateDisplayedMod() {
      const slot = Number(panel.find('select[name="comArtifactSlot"]').val());
      let mod = 0;
      if (slot === 0 || slot === 1) mod = comComputeArtifactMod(artifacts[slot]);
      const sign = mod >= 0 ? "+" : "";
      panel.find(".com-artifacts-mod").text(`${sign}${mod}`);
      return mod;
    }

    updateDisplayedMod();

    panel.on("change", 'select[name="comArtifactSlot"]', () => {
      updateDisplayedMod();
    });

    // Intercept submit: add artifact mod into the modifier field right before rolling
    // We hook the submit button click so it works regardless of RollDialog internals.
    const submitButtons = html.find('button[type="submit"], button.roll, button[name="roll"]');

    submitButtons.on("click.comArtifacts", () => {
      const mod = updateDisplayedMod();
      if (!mod) return;

      if (!modInput || !modInput.length) {
        ui.notifications?.warn("Artifacts: Could not find a modifier input in this RollDialog.");
        return;
      }

      const current = Number(modInput.val() ?? 0);
      const next = (Number.isFinite(current) ? current : 0) + mod;
      modInput.val(next);

      // Optional: small visual confirmation in the dialog
      // (prevents “did it apply?” confusion)
      panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod} (applied)`);
    });

  } catch (e) {
    console.error("com-artifacts | renderRollDialog failed", e);
  }
});
