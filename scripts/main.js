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
    await actor.setFlag(MODULE_ID, "artifacts", defaultArtifacts());
    return defaultArtifacts();
  }
  return data;
}

async function setArtifacts(actor, artifacts) {
  return actor.setFlag(MODULE_ID, "artifacts", artifacts);
}

function computeArtifactMod(artifact) {
  let mod = 0;
  for (const p of artifact.power ?? []) {
    if (p.active && p.name?.trim()) mod += 1;
  }
  if (artifact.weakness?.active && artifact.weakness?.name?.trim()) mod -= 1;
  return mod;
}

/* =========================
   TAB MEMORY (NO JUMPING)
========================= */

function rememberActiveTab(app, html) {
  const active = html.find('nav.sheet-tabs a.item.active, nav.tabs a.item.active').data("tab");
  if (active) app._comLastTab = active;
}

function restoreActiveTab(app) {
  const tabs = app?._tabs?.[0];
  if (tabs && app._comLastTab) tabs.activate(app._comLastTab);
}

/* =========================
   ACTOR SHEET UI
========================= */

function ensureArtifactsTab(app, html, actor) {
  if (!actor.testUserPermission(game.user, "OWNER")) return;

  const nav = html.find('nav.sheet-tabs, nav.tabs');
  if (!nav.find(`[data-tab="${MODULE_ID}"]`).length) {
    nav.append(`<a class="item" data-tab="${MODULE_ID}">Artifacts</a>`);
  }

  const body = html.find(".sheet-body");
  if (!body.find(`.tab[data-tab="${MODULE_ID}"]`).length) {
    body.append(`<div class="tab" data-tab="${MODULE_ID}"><div class="com-artifacts-grid"></div></div>`);
  }

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);

    grid.html(artifacts.map((a, i) => `
      <section class="com-artifact" data-i="${i}">
        <header style="display:flex;gap:8px">
          <div class="img" style="width:64px;height:64px;background-size:cover;background-image:url('${a.img}')"></div>
          <input type="text" data-f="name" value="${a.name}" placeholder="Artifact name"/>
        </header>

        <button class="pick-img">Image</button>
        <button class="clear-img">Clear</button>

        <label>Power Tags</label>
        ${a.power.map((p, pi) => `
          <div>
            <input type="checkbox" data-f="power.${pi}.active" ${p.active ? "checked" : ""}/>
            <input type="text" data-f="power.${pi}.name" value="${p.name}" placeholder="Power tag"/>
          </div>`).join("")}

        <label>Weakness</label>
        <div>
          <input type="checkbox" data-f="weakness.active" ${a.weakness.active ? "checked" : ""}/>
          <input type="text" data-f="weakness.name" value="${a.weakness.name}" placeholder="Weakness tag"/>
        </div>
      </section>
    `).join(""));

    grid.off().on("change", "input", async ev => {
      rememberActiveTab(app, html);

      const sec = ev.currentTarget.closest(".com-artifact");
      const i = Number(sec.dataset.i);
      const path = ev.currentTarget.dataset.f.split(".");
      const arts = await getArtifacts(actor);

      let ref = arts[i];
      while (path.length > 1) ref = ref[path.shift()];
      ref[path[0]] = ev.currentTarget.type === "checkbox"
        ? ev.currentTarget.checked
        : ev.currentTarget.value;

      await setArtifacts(actor, arts);
      restoreActiveTab(app);
    });

    grid.on("click", ".pick-img", ev => {
      const i = ev.currentTarget.closest(".com-artifact").dataset.i;
      new FilePicker({
        type: "image",
        callback: async p => {
          const arts = await getArtifacts(actor);
          arts[i].img = p;
          await setArtifacts(actor, arts);
          app.render(false);
        }
      }).browse();
    });

    grid.on("click", ".clear-img", async ev => {
      const i = ev.currentTarget.closest(".com-artifact").dataset.i;
      const arts = await getArtifacts(actor);
      arts[i].img = "";
      await setArtifacts(actor, arts);
      app.render(false);
    });
  })();
}

Hooks.on("renderActorSheet", (app, html) => {
  rememberActiveTab(app, html);
  ensureArtifactsTab(app, html, app.actor);
  restoreActiveTab(app);
});

/* =========================
   ROLL DIALOG
========================= */

function findCustomModifierInput(html) {
  const labels = html.find("label");
  for (const l of labels) {
    if (l.textContent.trim().toLowerCase() === "custom modifier") {
      return $(l).closest("div").find("input").first();
    }
  }
  return html.find('input[type="number"],input[type="text"]').first();
}

Hooks.on("renderRollDialog", async (app, html) => {
  const actor = app.actor ?? game.user.character;
  if (!actor) return;

  const artifacts = await getArtifacts(actor);

  const panel = $(`
    <fieldset>
      <legend>Artifacts</legend>
      <select>
        <option value="-1">None</option>
        <option value="0">${artifacts[0].name}</option>
        <option value="1">${artifacts[1].name}</option>
      </select>
      <div>Modifier: <strong class="mod">+0</strong></div>
    </fieldset>
  `);

  html.find("form").append(panel);

  const modInput = findCustomModifierInput(html);

  const calc = () => {
    const i = Number(panel.find("select").val());
    const mod = i >= 0 ? computeArtifactMod(artifacts[i]) : 0;
    panel.find(".mod").text((mod >= 0 ? "+" : "") + mod);
    return { i, mod };
  };

  panel.on("change", "select", calc);

  html.find('button:contains("Confirm")').off(".com").on("click.com", async () => {
    const { i, mod } = calc();
    if (!mod) return;

    modInput.val(Number(modInput.val() || 0) + mod).trigger("input");

    // auto-reset after roll
    if (i >= 0) {
      const arts = await getArtifacts(actor);
      arts[i].power.forEach(p => p.active = false);
      arts[i].weakness.active = false;
      await setArtifacts(actor, arts);
    }
  });
});
