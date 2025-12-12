/* com-artifacts | Foundry v13 build 350 | City of Mist (unofficial) v4.0.4
 * - Adds an Artifacts tab with exactly 2 slots
 * - Each slot: image + 2 power tag lines + 1 weakness tag line
 * - Click pencil to edit tag name; click tag name to select/highlight
 * - On EXECUTE MOVE: inject selected tags into roll dialog Review section + add modifier if possible
 */

const MOD_ID = "com-artifacts";
const FLAG_SCOPE = MOD_ID;
const FLAG_KEY = "data";

function log(...a) { console.log(`[${MOD_ID}]`, ...a); }
function warn(...a) { console.warn(`[${MOD_ID}]`, ...a); }

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

function normalizeFlag(raw) {
  // Required shape:
  // {
  //   artifacts: [
  //     { id, img, power:[{name,selected},{name,selected}], weakness:{name,selected} },
  //     { ...slot2... }
  //   ]
  // }
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
    const src = arts[i] && typeof arts[i] === "object" ? arts[i] : {};
    const slot = out.artifacts[i];

    slot.id = String(src.id ?? slot.id);
    slot.img = String(src.img ?? slot.img);

    const p = Array.isArray(src.power) ? src.power : [];
    for (let j = 0; j < 2; j++) {
      const pj = p[j] && typeof p[j] === "object" ? p[j] : {};
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
  const raw = actor.getFlag(FLAG_SCOPE, FLAG_KEY);
  return normalizeFlag(raw);
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

function isEditable(app) {
  if (typeof app.isEditable === "boolean") return app.isEditable;
  const actor = app.object ?? app.actor;
  return Boolean(actor?.isOwner);
}

function computeSelectedModifier(flagData) {
  let mod = 0;
  for (const slot of flagData.artifacts) {
    for (const p of slot.power) if (p.name && p.selected) mod += 1;
    if (slot.weakness.name && slot.weakness.selected) mod -= 1;
  }
  return mod;
}

function listSelectedTags(flagData) {
  const selected = [];
  flagData.artifacts.forEach((slot, idx) => {
    slot.power.forEach((p, j) => {
      if (p.name && p.selected) selected.push({ type: "power", label: p.name, slot: idx + 1, line: j + 1, value: +1 });
    });
    if (slot.weakness.name && slot.weakness.selected) selected.push({ type: "weakness", label: slot.weakness.name, slot: idx + 1, line: 1, value: -1 });
  });
  return selected;
}

function renderTabHtml(actor, data, editable) {
  const slots = data.artifacts;

  const slotHtml = (slot, idx) => {
    const img = slot.img ? `<img src="${escapeHtml(slot.img)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">` : `
      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:.7;">
        <i class="fas fa-image"></i>&nbsp;No Image
      </div>`;

    const powerLines = slot.power.map((p, j) => {
      const hasName = !!p.name;
      const active = hasName && p.selected;
      return `
        <div class="com-line" data-kind="power" data-slot="${idx}" data-line="${j}">
          <span class="com-label">Power Tag</span>
          <span class="com-tag ${hasName ? "filled" : "empty"} ${active ? "active" : ""}"
                data-action="toggle"
                title="${hasName ? "Click to toggle" : ""}">
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
        <span class="com-tag ${wHasName ? "filled" : "empty"} ${wActive ? "active" : ""}"
              data-action="toggle"
              title="${wHasName ? "Click to toggle" : ""}">
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

            <div class="com-summary">
              Selected modifier from artifacts: <b>${computeSelectedModifier(data)}</b>
            </div>
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
      .com-summary { margin-top:10px; opacity:.9; }
      .com-hint { opacity:.75; font-size:12px; margin-bottom:10px; }
    </style>

    <div class="com-hint">
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

  const editable = isEditable(app);
  const data = await getFlag(actor);

  const tabsNav = html.find('nav.tabs, nav.sheet-tabs, .tabs[data-group]');
  const group = tabsNav.attr("data-group") || "primary";
  if (!tabsNav.length) return;

  if (!tabsNav.find(`a.item[data-tab="${MOD_ID}"]`).length) {
    tabsNav.append(`<a class="item" data-tab="${MOD_ID}"><i class="fas fa-gem"></i> Artifacts</a>`);
  }

  let container = html.find(`.tab[data-tab="${MOD_ID}"]`);
  if (!container.length) {
    const body = html.find(".sheet-body");
    if (body.length) body.append(`<div class="tab" data-group="${group}" data-tab="${MOD_ID}"></div>`);
    else html.find("form").first().append(`<div class="tab" data-group="${group}" data-tab="${MOD_ID}"></div>`);
    container = html.find(`.tab[data-tab="${MOD_ID}"]`);
  }

  container.html(renderTabHtml(actor, data, editable));
  wireHandlers(app, html, actor);
  wireExecuteMoveIntercept(app, html, actor);
}

function wireHandlers(app, html, actor) {
  const root = html.find(`.tab[data-tab="${MOD_ID}"] .com-root`);
  if (!root.length) return;

  const editable = isEditable(app);

  root.find('[data-action="set-image"]').off("click").on("click", async (ev) => {
    if (!editable) return;
    const slotIdx = Number($(ev.currentTarget).closest(".com-slot").attr("data-slot"));
    const data = await getFlag(actor);

    const content = `<p>Paste an image URL (or a Foundry file path):</p>
                     <input type="text" name="img" style="width:100%" placeholder="systems/... or worlds/... or https://..." />`;

    new Dialog({
      title: `Artifact ${slotIdx + 1} Image`,
      content,
      buttons: {
        ok: {
          label: "Save",
          callback: async (dlgHtml) => {
            const val = String(dlgHtml.find('input[name="img"]').val() ?? "").trim();
            data.artifacts[slotIdx].img = val;
            await setFlag(actor, data);
            app.render(true);
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  });

  root.find('[data-action="clear-image"]').off("click").on("click", async (ev) => {
    if (!editable) return;
    const slotIdx = Number($(ev.currentTarget).closest(".com-slot").attr("data-slot"));
    const data = await getFlag(actor);
    data.artifacts[slotIdx].img = "";
    await setFlag(actor, data);
    app.render(true);
  });

  root.find('[data-action="edit"]').off("click").on("click", async (ev) => {
    if (!editable) return;
    const line = $(ev.currentTarget).closest(".com-line");
    const slotIdx = Number(line.attr("data-slot"));
    const kind = String(line.attr("data-kind"));
    const lineIdx = Number(line.attr("data-line"));

    const data = await getFlag(actor);
    const current =
      kind === "power" ? data.artifacts[slotIdx].power[lineIdx].name : data.artifacts[slotIdx].weakness.name;

    const content = `<p>Tag name:</p>
                     <input type="text" name="name" style="width:100%" value="${escapeHtml(current)}" />`;

    new Dialog({
      title: `Edit ${kind === "power" ? "Power Tag" : "Weakness Tag"}`,
      content,
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

  root.find('[data-action="toggle"]').off("click").on("click", async (ev) => {
    const line = $(ev.currentTarget).closest(".com-line");
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

function wireExecuteMoveIntercept(app, html, actor) {
  // Attach once per render; use namespace to avoid stacking.
  const btn = html.find('button:contains("EXECUTE MOVE"), button.execute-move, .execute-move button').first();
  if (!btn.length) return;

  btn.off(`click.${MOD_ID}`).on(`click.${MOD_ID}`, async () => {
    try {
      const data = await getFlag(actor);
      const selected = listSelectedTags(data);
      const mod = computeSelectedModifier(data);

      // Store transient “last execute move selection” on the client, so renderDialog can find it.
      // This avoids guessing internal system structures.
      window[`${MOD_ID}_last`] = {
        actorId: actor.id,
        selected,
        mod,
        ts: Date.now()
      };
    } catch (e) {
      warn("Failed to capture Execute Move selection (non-fatal):", e);
    }
  });
}

async function injectIntoMoveDialog(app, html) {
  // Only act if we have a recent selection
  const last = window[`${MOD_ID}_last`];
  if (!last || (Date.now() - last.ts) > 15000) return;

  const actor = game.actors?.get(last.actorId);
  if (!actor) return;

  // Try to detect the City of Mist move dialog by structure:
  // - there is usually a “Review” tab/section, or a dialog content region.
  const content = html.find(".dialog-content");
  if (!content.length) return;

  // Avoid duplicates
  if (content.find(`.com-artifacts-inject`).length) return;

  const items = (last.selected ?? []).map(t => {
    const sign = t.value > 0 ? "+1" : "-1";
    return `<li><b>${escapeHtml(t.label)}</b> <span style="opacity:.75">(${sign})</span></li>`;
  }).join("");

  const block = `
    <div class="com-artifacts-inject" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12);">
      <h4 style="margin:0 0 6px 0;">Artifact Tags (pending GM approval)</h4>
      ${items ? `<ul style="margin:0;padding-left:18px;">${items}</ul>` : `<div style="opacity:.7;font-style:italic;">None selected.</div>`}
      <div style="margin-top:6px;opacity:.9;">Artifact modifier total: <b>${last.mod ?? 0}</b></div>
    </div>
  `;

  // Best-effort: put it near “Review” if we can find it, otherwise append to content
  const reviewLike =
    content.find('[data-tab="review"], .tab.review, .review, .review-tab, h3:contains("Review"), h2:contains("Review")').first();

  if (reviewLike.length) {
    // If it’s a header, inject after it; if it’s a container, inject inside.
    if (reviewLike.is("h2,h3,h4")) reviewLike.after(block);
    else reviewLike.append(block);
  } else {
    content.append(block);
  }

  // Best-effort: add modifier to a numeric field if present.
  // Common patterns: input[name="modifier"], input[name="mod"], input.modifier
  if (typeof last.mod === "number" && last.mod !== 0) {
    const modInput =
      content.find('input[name="modifier"], input[name="mod"], input.modifier, input[data-role="modifier"]').first();

    if (modInput.length) {
      const cur = Number(modInput.val() ?? 0) || 0;
      modInput.val(cur + last.mod).trigger("change");
    }
  }
}

/* Hooks */
Hooks.once("ready", async () => {
  for (const a of (game.actors ?? [])) await ensureNormalized(a);
});

Hooks.on("renderActorSheet", async (app, html) => { await upsertTab(app, html); });
Hooks.on("renderActorSheetV2", async (app, html) => { await upsertTab(app, html); });

// Inject into dialog shown after Execute Move
Hooks.on("renderDialog", async (app, html) => {
  await injectIntoMoveDialog(app, html);
});
