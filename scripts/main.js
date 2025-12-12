/* com-artifacts | Foundry v13 build 350 | City of Mist 4.0.4
 * - 2 artifact slots (image + 2 power + 1 weakness)
 * - Click pen to name; click tag to toggle selected/highlight
 * - Power selected = +1, Weakness selected = -1
 * - Player RollDialog: show artifact tags + apply modifier to Custom Modifier input
 * - GM TagReviewDialog: show artifact tags (UI injection)
 */

const MOD_ID = "com-artifacts";
const FLAG_SCOPE = MOD_ID;
const FLAG_KEY = "data";

/* ---------------- Utils ---------------- */

function asJQ(x) {
  return (x && x.jquery) ? x : globalThis.jQuery(x);
}
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function randomID() {
  return foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2);
}

/* ---------------- Flags ---------------- */

function normalizeFlag(raw) {
  const mkSlot = () => ({
    id: randomID(),
    img: "",
    power: [{ name: "", selected: false }, { name: "", selected: false }],
    weakness: { name: "", selected: false }
  });

  const out = { artifacts: [mkSlot(), mkSlot()] };
  if (!raw || typeof raw !== "object") return out;

  const arts = Array.isArray(raw.artifacts) ? raw.artifacts : [];
  for (let i = 0; i < 2; i++) {
    const src = (arts[i] && typeof arts[i] === "object") ? arts[i] : {};
    const slot = out.artifacts[i];

    slot.id = String(src.id ?? slot.id);
    slot.img = String(src.img ?? slot.img);

    const p = Array.isArray(src.power) ? src.power : [];
    for (let j = 0; j < 2; j++) {
      const pj = (p[j] && typeof p[j] === "object") ? p[j] : {};
      slot.power[j].name = String(pj.name ?? slot.power[j].name);
      slot.power[j].selected = Boolean(pj.selected ?? slot.power[j].selected);
      if (!slot.power[j].name) slot.power[j].selected = false;
    }

    const w = (src.weakness && typeof src.weakness === "object") ? src.weakness : {};
    slot.weakness.name = String(w.name ?? slot.weakness.name);
    slot.weakness.selected = Boolean(w.selected ?? slot.weakness.selected);
    if (!slot.weakness.name) slot.weakness.selected = false;
  }

  return out;
}

async function getFlag(actor) {
  return normalizeFlag(actor.getFlag(FLAG_SCOPE, FLAG_KEY));
}
async function setFlag(actor, data) {
  return actor.setFlag(FLAG_SCOPE, FLAG_KEY, normalizeFlag(data));
}
async function ensureNormalized(actor) {
  const raw = actor.getFlag(FLAG_SCOPE, FLAG_KEY);
  const norm = normalizeFlag(raw);
  if (JSON.stringify(raw ?? null) !== JSON.stringify(norm)) {
    await actor.setFlag(FLAG_SCOPE, FLAG_KEY, norm);
  }
}

function computeSelected(flagData) {
  const selected = [];
  let mod = 0;

  for (const slot of flagData.artifacts) {
    for (const p of slot.power) {
      if (p.name && p.selected) {
        selected.push({ label: p.name, value: +1 });
        mod += 1;
      }
    }
    if (slot.weakness.name && slot.weakness.selected) {
      selected.push({ label: slot.weakness.name, value: -1 });
      mod -= 1;
    }
  }
  return { selected, mod };
}

/* ---------------- Actor resolution ---------------- */

function resolveActorForApp(app) {
  return (
    app?.actor ||
    app?.options?.actor ||
    (app?.options?.actorId ? game.actors.get(app.options.actorId) : null) ||
    (app?.object?.actor ?? null) ||
    (app?.object && app?.object?.documentName === "Actor" ? app.object : null) ||
    game.user?.character ||                   // critical for players
    canvas?.tokens?.controlled?.[0]?.actor ||
    null
  );
}

/* ---------------- Sheet tab UI ---------------- */

function isEditable(app) {
  if (typeof app.isEditable === "boolean") return app.isEditable;
  const actor = app.object ?? app.actor;
  return Boolean(actor?.isOwner);
}

function renderTabHtml(data, editable) {
  const slots = data.artifacts;

  const slotHtml = (slot, idx) => {
    const img = slot.img
      ? `<img src="${escapeHtml(slot.img)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:.7;">
           <i class="fas fa-image"></i>&nbsp;No Image
         </div>`;

    const powerLines = slot.power.map((p, j) => {
      const hasName = !!p.name;
      const active = hasName && p.selected;
      return `
        <div class="com-line" data-kind="power" data-slot="${idx}" data-line="${j}">
          <span class="com-label">Power Tag</span>
          <span class="com-tag ${hasName ? "filled" : "empty"} ${active ? "active" : ""}" data-action="toggle">
            ${hasName ? escapeHtml(p.name) : "—"}
          </span>
          <button type="button" class="com-icon" data-action="edit" ${editable ? "" : "disabled"} title="Edit">
            <i class="fas fa-pen"></i>
          </button>
        </div>`;
    }).join("");

    const w = slot.weakness;
    const wHasName = !!w.name;
    const wActive = wHasName && w.selected;

    const weaknessLine = `
      <div class="com-line" data-kind="weakness" data-slot="${idx}" data-line="0">
        <span class="com-label">Weakness Tag</span>
        <span class="com-tag ${wHasName ? "filled" : "empty"} ${wActive ? "active" : ""}" data-action="toggle">
          ${wHasName ? escapeHtml(w.name) : "—"}
        </span>
        <button type="button" class="com-icon" data-action="edit" ${editable ? "" : "disabled"} title="Edit">
          <i class="fas fa-pen"></i>
        </button>
      </div>`;

    return `
      <div class="com-slot" data-slot="${idx}">
        <div class="com-slot-header">
          <div class="com-slot-title">Artifact ${idx + 1}</div>
          <button type="button" class="com-btn" data-action="set-image" ${editable ? "" : "disabled"}>
            <i class="fas fa-image"></i> Set Image
          </button>
          <button type="button" class="com-btn" data-action="clear-image" ${editable ? "" : "disabled"}>
            <i class="fas fa-times"></i> Clear
          </button>
        </div>

        <div class="com-grid">
          <div class="com-imgbox">${img}</div>
          <div class="com-tags">
            <div class="com-box-title">Power Tags</div>
            <div class="com-box">${powerLines}</div>

            <div class="com-box-title" style="margin-top:10px;">Weakness Tag</div>
            <div class="com-box">${weaknessLine}</div>
          </div>
        </div>
      </div>`;
  };

  return `
  <section class="com-root">
    <style>
      .com-root { padding:10px; }
      .com-slot { border:1px solid rgba(255,255,255,.12); border-radius:14px; padding:10px; background:rgba(0,0,0,.10); margin-bottom:12px; }
      .com-slot-header { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
      .com-slot-title { font-weight:700; }
      .com-btn { height:28px; }
      .com-grid { display:grid; grid-template-columns: 160px 1fr; gap:10px; }
      .com-imgbox { width:160px; height:160px; border:1px solid rgba(255,255,255,.12); border-radius:14px; overflow:hidden; background:rgba(0,0,0,.08); }
      .com-box-title { font-weight:700; opacity:.9; margin-bottom:6px; }
      .com-box { border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:8px; background:rgba(0,0,0,.06); }
      .com-line { display:flex; align-items:center; gap:8px; padding:4px 0; }
      .com-label { width:90px; font-size:12px; opacity:.75; }
      .com-tag { flex:1; border:1px solid rgba(255,255,255,.18); border-radius:999px; padding:2px 10px; user-select:none; }
      .com-tag.empty { opacity:.6; font-style:italic; }
      .com-tag.filled { cursor:pointer; }
      .com-tag.active { border-color: rgba(255,255,255,.55); box-shadow: 0 0 0 1px rgba(255,255,255,.25) inset; font-weight:700; }
      .com-icon { width:32px; height:28px; }
    </style>

    <div style="opacity:.75;font-size:12px;margin-bottom:10px;">
      Click the pen to name a tag. If named, click the tag to select it.
      Power tags add +1 each; weakness tags add -1.
    </div>

    ${slotHtml(slots[0], 0)}
    ${slotHtml(slots[1], 1)}
  </section>`;
}

async function upsertTab(app, html) {
  const actor = app.object ?? app.actor;
  if (!actor) return;

  const $html = asJQ(html);
  const editable = isEditable(app);
  const data = await getFlag(actor);

  const tabsNav = $html.find('nav.tabs, nav.sheet-tabs, .tabs[data-group]');
  if (!tabsNav.length) return;

  const group = tabsNav.attr("data-group") || "primary";

  if (!tabsNav.find(`a.item[data-tab="${MOD_ID}"]`).length) {
    tabsNav.append(`<a class="item" data-tab="${MOD_ID}"><i class="fas fa-gem"></i> Artifacts</a>`);
  }

  let container = $html.find(`.tab[data-tab="${MOD_ID}"]`);
  if (!container.length) {
    const body = $html.find(".sheet-body");
    if (body.length) body.append(`<div class="tab" data-group="${group}" data-tab="${MOD_ID}"></div>`);
    else $html.find("form").first().append(`<div class="tab" data-group="${group}" data-tab="${MOD_ID}"></div>`);
    container = $html.find(`.tab[data-tab="${MOD_ID}"]`);
  }

  container.html(renderTabHtml(data, editable));
  wireSheetHandlers(app, $html, actor);
}

function wireSheetHandlers(app, $html, actor) {
  const root = $html.find(`.tab[data-tab="${MOD_ID}"] .com-root`);
  if (!root.length) return;

  const editable = isEditable(app);

  root.find('[data-action="set-image"]').off(`click.${MOD_ID}`).on(`click.${MOD_ID}`, async (ev) => {
    if (!editable) return;
    const slotIdx = Number(asJQ(ev.currentTarget).closest(".com-slot").attr("data-slot"));
    const data = await getFlag(actor);

    new Dialog({
      title: `Artifact ${slotIdx + 1} Image`,
      content: `<p>Paste an image URL or Foundry file path:</p><input type="text" name="img" style="width:100%"/>`,
      buttons: {
        ok: {
          label: "Save",
          callback: async (dlgHtml) => {
            data.artifacts[slotIdx].img = String(dlgHtml.find('input[name="img"]').val() ?? "").trim();
            await setFlag(actor, data);
            app.render(true);
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  });

  root.find('[data-action="clear-image"]').off(`click.${MOD_ID}`).on(`click.${MOD_ID}`, async (ev) => {
    if (!editable) return;
    const slotIdx = Number(asJQ(ev.currentTarget).closest(".com-slot").attr("data-slot"));
    const data = await getFlag(actor);
    data.artifacts[slotIdx].img = "";
    await setFlag(actor, data);
    app.render(true);
  });

  root.find('[data-action="edit"]').off(`click.${MOD_ID}`).on(`click.${MOD_ID}`, async (ev) => {
    if (!editable) return;
    const line = asJQ(ev.currentTarget).closest(".com-line");
    const slotIdx = Number(line.attr("data-slot"));
    const kind = String(line.attr("data-kind"));
    const lineIdx = Number(line.attr("data-line"));

    const data = await getFlag(actor);
    const current = (kind === "power")
      ? data.artifacts[slotIdx].power[lineIdx].name
      : data.artifacts[slotIdx].weakness.name;

    new Dialog({
      title: `Edit ${kind === "power" ? "Power Tag" : "Weakness Tag"}`,
      content: `<p>Tag name:</p><input type="text" name="name" style="width:100%" value="${escapeHtml(current)}"/>`,
      buttons: {
        ok: {
          label: "Save",
          callback: async (dlgHtml) => {
            const val = String(dlgHtml.find('input[name="name"]').val() ?? "").trim();
            if (kind === "power") {
              data.artifacts[slotIdx].power[lineIdx].name = val;
              if (!val) data.artifacts[slotIdx].power[lineIdx].selected = false;
            } else {
              data.artifacts[slotIdx].weakness.name = val;
              if (!val) data.artifacts[slotIdx].weakness.selected = false;
            }
            await setFlag(actor, data);
            app.render(true);
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  });

  root.find('[data-action="toggle"]').off(`click.${MOD_ID}`).on(`click.${MOD_ID}`, async (ev) => {
    const line = asJQ(ev.currentTarget).closest(".com-line");
    const slotIdx = Number(line.attr("data-slot"));
    const kind = String(line.attr("data-kind"));
    const lineIdx = Number(line.attr("data-line"));

    const data = await getFlag(actor);
    if (kind === "power") {
      const p = data.artifacts[slotIdx].power[lineIdx];
      if (!p.name) return;
      p.selected = !p.selected;
    } else {
      const w = data.artifacts[slotIdx].weakness;
      if (!w.name) return;
      w.selected = !w.selected;
    }
    await setFlag(actor, data);
    app.render(true);
  });
}

/* ---------------- RollDialog injection (PLAYER FIX) ---------------- */

function findVisibleRollDialogRoot() {
  const $wins = globalThis.jQuery(".window-app:visible");
  for (let i = $wins.length - 1; i >= 0; i--) {
    const $w = globalThis.jQuery($wins[i]);
    if ($w.find(".roll-dialog").length) return $w;
  }
  return globalThis.jQuery();
}

function findCustomModifierInput($roll) {
  // 1) find label == "Custom Modifier"
  const $labels = $roll.find("label");
  let $label = globalThis.jQuery();
  for (const el of $labels) {
    if ((el.textContent ?? "").trim() === "Custom Modifier") {
      $label = globalThis.jQuery(el);
      break;
    }
  }
  if ($label.length) {
    // a) direct parent search
    let $inp = $label.parent().find("input").first();
    if ($inp.length) return $inp;

    // b) closest wrapper search
    $inp = $label.closest("div, .form-group, .form-fields, p, label").find("input").first();
    if ($inp.length) return $inp;

    // c) next siblings search (common CoM layout)
    $inp = $label.nextAll("input").first();
    if ($inp.length) return $inp;

    // d) next wrapper search
    $inp = $label.parent().nextAll("div, .form-group, .form-fields").find("input").first();
    if ($inp.length) return $inp;

    // e) global: first input after label within roll dialog
    const labelEl = $label[0];
    const all = $roll.find("input").toArray();
    const idx = all.findIndex(i => i.compareDocumentPosition(labelEl) & Node.DOCUMENT_POSITION_PRECEDING);
    // idx can be 0 if first input already after label; if not found, fallback below.
    if (idx >= 0 && all[idx]) return globalThis.jQuery(all[idx]);
  }

  // 2) fallback: any input that looks like modifier
  let $inp = $roll.find('#roll-modifier-amt').first();
  if ($inp.length) return $inp;

  $inp = $roll.find('input[id*="modifier" i], input[name*="modifier" i]').first();
  if ($inp.length) return $inp;

  // 3) last resort
  return $roll.find('input[type="number"], input[type="text"]').first();
}

async function injectIntoRollDialogDOM(app, attempt = 0) {
  if (attempt > 12) return; // ~600ms total

  const actor = resolveActorForApp(app);
  if (!actor) return;

  const $root = findVisibleRollDialogRoot();
  if (!$root.length) return setTimeout(() => injectIntoRollDialogDOM(app, attempt + 1), 50);

  const $roll = $root.find(".roll-dialog").first();
  if (!$roll.length) return setTimeout(() => injectIntoRollDialogDOM(app, attempt + 1), 50);

  if ($roll.find(".com-artifacts-inject").length) return;

  const flagData = await getFlag(actor);
  const { selected, mod } = computeSelected(flagData);
  if (!selected.length && mod === 0) return;

  const $host = $roll.find(".modifier-list").first().length ? $roll.find(".modifier-list").first() : $roll;

  const items = selected.map(t => {
    const sign = t.value > 0 ? "+1" : "-1";
    return `<div style="display:flex;gap:8px;align-items:center;">
              <span style="font-weight:600;">${escapeHtml(t.label)}</span>
              <span style="opacity:.75;">(${sign})</span>
            </div>`;
  }).join("");

  $host.append(`
    <div class="com-artifacts-inject" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12);">
      <div style="font-weight:700;margin-bottom:4px;">Artifact Tags</div>
      ${items}
      <div style="margin-top:4px;opacity:.9;">Artifact modifier total: <b>${mod}</b></div>
    </div>
  `);

  const $modInput = findCustomModifierInput($roll);
  if ($modInput?.length) {
    if (!Number.isFinite(app._comArtifactsBaseMod)) {
      const base = Number($modInput.val() ?? 0);
      app._comArtifactsBaseMod = Number.isFinite(base) ? base : 0;
    }
    $modInput.val((app._comArtifactsBaseMod ?? 0) + mod);
    $modInput.trigger("input");
    $modInput.trigger("change");
  }
}

/* ---------------- TagReviewDialog injection (GM) ---------------- */

async function injectIntoTagReviewDialog(app, html) {
  const $html = asJQ(html);
  if ($html.find(".com-artifacts-review").length) return;

  const actor = resolveActorForApp(app);
  if (!actor) return;

  const flagData = await getFlag(actor);
  const { selected, mod } = computeSelected(flagData);
  if (!selected.length && mod === 0) return;

  const selectedHdr = $html.find("*").filter((_, el) => (el.textContent || "").trim() === "SelectedItems").first();
  const $host = selectedHdr.length ? selectedHdr.closest("div") : $html.find("form, .dialog-content").first();
  if (!$host.length) return;

  const items = selected.map(t => {
    const sign = t.value > 0 ? "+1" : "-1";
    const icon = t.value > 0 ? "fa-bolt" : "fa-skull";
    return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
              <i class="fas ${icon}" style="opacity:.85;"></i>
              <span style="font-weight:600;">${escapeHtml(t.label)}</span>
              <span style="opacity:.75;">(${sign})</span>
            </div>`;
  }).join("");

  $host.append(`
    <div class="com-artifacts-review" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12);">
      <div style="font-weight:700;margin-bottom:4px;">Artifact Tags</div>
      ${items}
      <div style="margin-top:4px;opacity:.9;">Artifact modifier total: <b>${mod}</b></div>
    </div>
  `);
}

/* ---------------- Hooks ---------------- */

Hooks.once("ready", async () => {
  try {
    for (const a of (game.actors ?? [])) await ensureNormalized(a);
  } catch (e) {
    console.error(`${MOD_ID} | ensureNormalized failed:`, e);
  }
});

Hooks.on("renderActorSheet", async (app, html) => upsertTab(app, html));
Hooks.on("renderActorSheetV2", async (app, html) => upsertTab(app, html));

Hooks.on("renderApplication", (app, html) => {
  const name = app?.constructor?.name ?? "";
  if (name === "RollDialog") {
    injectIntoRollDialogDOM(app).catch(e => console.error(`${MOD_ID} | RollDialog inject failed`, e));
  }
  if (name === "TagReviewDialog") {
    injectIntoTagReviewDialog(app, html).catch(e => console.error(`${MOD_ID} | TagReview inject failed`, e));
  }
});
