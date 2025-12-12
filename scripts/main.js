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

    // Imag
