const MODULE_ID = "com-artifacts";

/* -------------------- Storage -------------------- */

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
  return (await actor.getFlag(MODULE_ID, "artifacts")) ?? defaultArtifacts();
}

async function setArtifacts(actor, artifacts) {
  return actor.setFlag(MODULE_ID, "artifacts", artifacts);
}

/* -------------------- Lock helpers -------------------- */

function isSheetEditable(html) {
  const inputs = html.find('.sheet-body .tab:not([data-tab="com-artifacts"]) input');
  if (!inputs.length) return true;
  return inputs.toArray().some(i => !i.disabled);
}

function setArtifactsEditable(html, editable) {
  const tab = html.find(`.tab[data-tab="${MODULE_ID}"]`);
  if (!tab.length) return;

  if (editable) {
    tab.find(".com-editor-only").show().prop("disabled", false);
    tab.find(".com-tag-pick").show();
  } else {
    tab.find(".com-editor-only").hide().prop("disabled", true);
    tab.find(".com-tag-pick").each((_, el) => {
      const hasText = el.textContent.trim().length > 0;
      el.style.display = hasText ? "" : "none";
    });
  }
}

function installLockObserver(app, html) {
  if (app._comLockObserverInstalled) return;
  app._comLockObserverInstalled = true;

  const obs = new MutationObserver(() => {
    setArtifactsEditable(html, isSheetEditable(html));
  });

  obs.observe(html[0], { subtree: true, attributes: true, childList: true });
}

/* -------------------- Sheet UI -------------------- */

function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  const nav = html.find("nav.sheet-tabs");
  if (!nav.find(`[data-tab="${MODULE_ID}"]`).length) {
    nav.append(`<a class="item" data-tab="${MODULE_ID}">Artifacts</a>`);
  }

  const body = html.find(".sheet-body");
  if (!body.find(`.tab[data-tab="${MODULE_ID}"]`).length) {
    body.append(`<div class="tab" data-tab="${MODULE_ID}"><div class="com-artifacts-grid"></div></div>`);
  }

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(".com-artifacts-grid");

    grid.html(artifacts.map((a, idx) => `
      <section class="com-artifact" data-idx="${idx}">
        <header>
          <input class="com-editor-only" type="text" data-field="name" value="${a.name ?? ""}">
        </header>

        <div class="tags">
          <label>Power Tags</label>
          ${a.power.map((p, i) => `
            <div class="tag-row">
              <span class="com-tag-pick" data-pick="a${idx}.p${i}">${p.name ?? ""}</span>
              <input class="com-editor-only" type="text" data-field="power.${i}.name" value="${p.name ?? ""}">
            </div>
          `).join("")}

          <label>Weakness</label>
          <div class="tag-row">
            <span class="com-tag-pick com-weak" data-pick="a${idx}.w">${a.weakness.name ?? ""}</span>
            <input class="com-editor-only" type="text" data-field="weakness.name" value="${a.weakness.name ?? ""}">
          </div>
        </div>
      </section>
    `).join(""));

    grid.on("change", "input", async ev => {
      const section = ev.target.closest(".com-artifact");
      const idx = Number(section.dataset.idx);
      const path = ev.target.dataset.field.split(".");
      const data = await getArtifacts(actor);

      let ref = data[idx];
      while (path.length > 1) ref = ref[path.shift()];
      ref[path[0]] = ev.target.value;

      await setArtifacts(actor, data);

      const pick =
        ev.target.dataset.field === "power.0.name" ? `.com-tag-pick[data-pick="a${idx}.p0"]` :
        ev.target.dataset.field === "power.1.name" ? `.com-tag-pick[data-pick="a${idx}.p1"]` :
        ev.target.dataset.field === "weakness.name" ? `.com-tag-pick[data-pick="a${idx}.w"]` :
        null;

      if (pick) section.querySelector(pick).textContent = ev.target.value;
    });

  })();
}

/* -------------------- Hooks -------------------- */

Hooks.on("renderActorSheet", (app, html) => {
  ensureArtifactsTab(app, html, app.actor);
  setArtifactsEditable(html, isSheetEditable(html));
  installLockObserver(app, html);
});
