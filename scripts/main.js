/* com-artifacts | Foundry VTT v13 build 350 | City of Mist (unofficial) 4.0.4
 * - Injects an "Artifacts" tab into actor sheets
 * - Stores data in actor flags: actor.flags["com-artifacts"]
 * - Normalizes old/bad flag data to avoid crashes
 * - Clickable tag chips; selected tags injected into roll dialogs (best-effort)
 */

const MOD_ID = "com-artifacts";
const FLAG_SCOPE = MOD_ID;

function log(...args) { console.log(`[${MOD_ID}]`, ...args); }
function warn(...args) { console.warn(`[${MOD_ID}]`, ...args); }
function err(...args) { console.error(`[${MOD_ID}]`, ...args); }

function safeGet(obj, path, fallback) {
  try {
    return path.split(".").reduce((o, k) => (o?.[k] ?? undefined), obj) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Expected flag shape:
 * {
 *   artifacts: [
 *     { id, name, description, tags: ["tag1","tag2"], selectedTagIds: []? (deprecated) }
 *   ],
 *   selected: { tagKeys: ["artifactId::tag"] }
 * }
 */
function normalizeArtifactsFlag(raw) {
  // Hard fail-safe: always return a valid shape.
  const out = {
    artifacts: [],
    selected: { tagKeys: [] }
  };

  // If raw is missing or not object, return defaults
  if (!raw || typeof raw !== "object") return out;

  // Handle legacy shapes:
  // - raw might be an array (artifacts)
  // - raw might have { artifacts: ... } but artifacts malformed
  // - selected might be array or missing
  let artifacts = raw.artifacts ?? raw;
  if (Array.isArray(artifacts)) {
    out.artifacts = artifacts
      .filter(a => a && typeof a === "object")
      .map(a => ({
        id: String(a.id ?? randomID()),
        name: String(a.name ?? "Unnamed Artifact"),
        description: String(a.description ?? ""),
        tags: Array.isArray(a.tags) ? a.tags.map(t => String(t).trim()).filter(Boolean) : []
      }));
  } else if (artifacts && typeof artifacts === "object") {
    // If someone stored keyed object
    out.artifacts = Object.values(artifacts)
      .filter(a => a && typeof a === "object")
      .map(a => ({
        id: String(a.id ?? randomID()),
        name: String(a.name ?? "Unnamed Artifact"),
        description: String(a.description ?? ""),
        tags: Array.isArray(a.tags) ? a.tags.map(t => String(t).trim()).filter(Boolean) : []
      }));
  }

  // Normalize selected tags
  const sel = raw.selected ?? {};
  let tagKeys = sel.tagKeys ?? sel ?? [];
  if (!Array.isArray(tagKeys)) tagKeys = [];
  out.selected.tagKeys = tagKeys.map(String).filter(Boolean);

  // Ensure uniqueness
  out.selected.tagKeys = Array.from(new Set(out.selected.tagKeys));

  return out;
}

async function getActorFlag(actor) {
  const raw = actor.getFlag(FLAG_SCOPE, "data");
  return normalizeArtifactsFlag(raw);
}

async function setActorFlag(actor, data) {
  const normalized = normalizeArtifactsFlag(data);
  return actor.setFlag(FLAG_SCOPE, "data", normalized);
}

async function ensureActorFlagNormalized(actor) {
  const raw = actor.getFlag(FLAG_SCOPE, "data");
  const normalized = normalizeArtifactsFlag(raw);
  // Only write if it actually changes shape materially
  const rawStr = JSON.stringify(raw ?? null);
  const normStr = JSON.stringify(normalized);
  if (rawStr !== normStr) {
    await actor.setFlag(FLAG_SCOPE, "data", normalized);
    log(`Normalized flags for actor: ${actor.name}`);
  }
}

function buildTagKey(artifactId, tag) {
  return `${artifactId}::${tag}`;
}

function renderArtifactsTabHtml(actor, flagData, isEditable) {
  const artifacts = flagData.artifacts ?? [];
  const selectedKeys = new Set(flagData.selected?.tagKeys ?? []);

  const artifactsHtml = artifacts.map((a) => {
    const tags = (a.tags ?? []).map((t) => {
      const key = buildTagKey(a.id, t);
      const active = selectedKeys.has(key);
      return `
        <span class="com-artifact-tag ${active ? "active" : ""}"
              data-action="toggle-tag"
              data-artifact-id="${a.id}"
              data-tag="${escapeHtml(t)}"
              title="Click to ${active ? "unselect" : "select"}">
          ${escapeHtml(t)}
        </span>`;
    }).join("");

    return `
      <div class="com-artifact-card" data-artifact-id="${a.id}">
        <div class="com-artifact-row">
          <input class="com-artifact-name" type="text" value="${escapeHtml(a.name ?? "")}"
                 data-action="edit-artifact" data-field="name" ${isEditable ? "" : "disabled"} />
          <div class="com-artifact-actions">
            <button type="button" data-action="delete-artifact" ${isEditable ? "" : "disabled"} title="Delete">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>

        <textarea class="com-artifact-desc"
                  data-action="edit-artifact" data-field="description"
                  rows="2" ${isEditable ? "" : "disabled"}>${escapeHtml(a.description ?? "")}</textarea>

        <div class="com-artifact-tags">
          <div class="com-artifact-tags-header">
            <span>Tags</span>
            <button type="button" data-action="add-tag" ${isEditable ? "" : "disabled"} title="Add Tag">
              <i class="fas fa-plus"></i> Add
            </button>
          </div>
          <div class="com-artifact-tags-list">
            ${tags || `<span class="com-muted">No tags</span>`}
          </div>
        </div>
      </div>`;
  }).join("");

  const selectedList = Array.from(selectedKeys.values()).map(k => {
    const [aid, tag] = k.split("::");
    const art = artifacts.find(x => x.id === aid);
    const label = art ? `${art.name}: ${tag}` : tag;
    return `<li>${escapeHtml(label)}</li>`;
  }).join("");

  return `
  <section class="com-artifacts-root">
    <style>
      .com-artifacts-root { padding: 10px; }
      .com-artifacts-toolbar { display:flex; gap:8px; align-items:center; margin-bottom:10px; }
      .com-artifacts-toolbar .spacer { flex:1; }
      .com-muted { opacity:0.7; font-style:italic; }

      .com-artifact-card {
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px;
        padding: 10px;
        margin-bottom: 10px;
        background: rgba(0,0,0,0.12);
      }
      .com-artifact-row { display:flex; gap:8px; align-items:center; }
      .com-artifact-name { flex:1; }
      .com-artifact-actions button { width:32px; height:32px; }

      .com-artifact-desc { width:100%; margin-top:8px; }
      .com-artifact-tags { margin-top:8px; }
      .com-artifact-tags-header { display:flex; align-items:center; gap:8px; }
      .com-artifact-tags-header span { font-weight:600; }
      .com-artifact-tags-header button { margin-left:auto; }

      .com-artifact-tags-list { margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; }
      .com-artifact-tag {
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 999px;
        padding: 2px 8px;
        cursor: pointer;
        user-select: none;
      }
      .com-artifact-tag.active {
        border-color: rgba(255,255,255,0.6);
        box-shadow: 0 0 0 1px rgba(255,255,255,0.35) inset;
        font-weight: 600;
      }

      .com-selected-box {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.12);
      }
      .com-selected-box h4 { margin: 0 0 6px 0; }
      .com-selected-box ul { margin: 0; padding-left: 18px; }
    </style>

    <div class="com-artifacts-toolbar">
      <button type="button" data-action="add-artifact" ${isEditable ? "" : "disabled"}>
        <i class="fas fa-plus"></i> Add Artifact
      </button>
      <button type="button" data-action="clear-selected" ${isEditable ? "" : "disabled"} title="Unselect all tags">
        <i class="fas fa-eraser"></i> Clear Selected
      </button>
      <div class="spacer"></div>
      <span class="com-muted">${isEditable ? "Editable" : "Locked / Read-only"}</span>
    </div>

    <div class="com-artifacts-list">
      ${artifactsHtml || `<div class="com-muted">No artifacts yet.</div>`}
    </div>

    <div class="com-selected-box">
      <h4>Selected Artifact Tags (for rolls)</h4>
      ${selectedList ? `<ul>${selectedList}</ul>` : `<div class="com-muted">None selected.</div>`}
    </div>
  </section>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getIsEditable(app) {
  // Foundry sheets typically expose isEditable; fallback to permission checks.
  if (typeof app.isEditable === "boolean") return app.isEditable;
  const actor = app.object ?? app.actor;
  if (!actor) return false;
  return actor.isOwner;
}

async function upsertArtifactsTab(app, html) {
  const actor = app.object ?? app.actor;
  if (!actor) return;

  const isEditable = getIsEditable(app);
  const flagData = await getActorFlag(actor);

  // Best-effort tab injection:
  // Works for many sheets that have .tabs + [data-tab] content containers.
  // If the system uses a nonstandard layout, it still won't crash—just won't inject.
  const tabsNav = html.find('nav.tabs, .tabs[data-group], nav.sheet-tabs');
  const tabsContent = html.find('.tab[data-group], .sheet-body, section.sheet-body, .tabs-content');

  if (!tabsNav.length || !tabsContent.length) return;

  const group = tabsNav.attr("data-group") || "primary";
  const existing = tabsNav.find(`a.item[data-tab="com-artifacts"]`);
  if (!existing.length) {
    tabsNav.append(`<a class="item" data-tab="com-artifacts"><i class="fas fa-gem"></i> Artifacts</a>`);
  }

  // Find a reference tab to match structure; create container tab
  let container = html.find(`.tab[data-tab="com-artifacts"]`);
  if (!container.length) {
    // Try to place in common body container
    const body = html.find(".sheet-body");
    if (body.length) {
      body.append(`<div class="tab" data-group="${group}" data-tab="com-artifacts"></div>`);
    } else {
      // fallback: append near end of form
      html.find("form").first().append(`<div class="tab" data-group="${group}" data-tab="com-artifacts"></div>`);
    }
    container = html.find(`.tab[data-tab="com-artifacts"]`);
  }

  container.html(renderArtifactsTabHtml(actor, flagData, isEditable));

  // Ensure tabs controller sees the new tab (many sheets use TabsV2)
  try {
    const tabs = app._tabs?.[0] ?? app.tabs?.[0];
    tabs?.bind?.(html[0]);
  } catch (e) {
    // non-fatal
  }

  wireArtifactsHandlers(app, html, actor);
}

function wireArtifactsHandlers(app, html, actor) {
  const root = html.find('.tab[data-tab="com-artifacts"] .com-artifacts-root');
  if (!root.length) return;

  const isEditable = getIsEditable(app);

  // Add Artifact
  root.find('[data-action="add-artifact"]').off("click").on("click", async () => {
    if (!isEditable) return;
    const data = await getActorFlag(actor);
    data.artifacts.push({ id: randomID(), name: "New Artifact", description: "", tags: [] });
    await setActorFlag(actor, data);
    app.render(true);
  });

  // Clear Selected
  root.find('[data-action="clear-selected"]').off("click").on("click", async () => {
    if (!isEditable) return;
    const data = await getActorFlag(actor);
    data.selected.tagKeys = [];
    await setActorFlag(actor, data);
    app.render(true);
  });

  // Delete Artifact
  root.find('[data-action="delete-artifact"]').off("click").on("click", async (ev) => {
    if (!isEditable) return;
    const card = $(ev.currentTarget).closest(".com-artifact-card");
    const aid = card.attr("data-artifact-id");
    const data = await getActorFlag(actor);

    data.artifacts = data.artifacts.filter(a => a.id !== aid);
    data.selected.tagKeys = (data.selected.tagKeys ?? []).filter(k => !k.startsWith(`${aid}::`));

    await setActorFlag(actor, data);
    app.render(true);
  });

  // Edit fields (name/description)
  root.find('[data-action="edit-artifact"]').off("change").on("change", async (ev) => {
    if (!isEditable) return;
    const el = ev.currentTarget;
    const field = el.dataset.field;
    const card = $(el).closest(".com-artifact-card");
    const aid = card.attr("data-artifact-id");
    const data = await getActorFlag(actor);

    const art = data.artifacts.find(a => a.id === aid);
    if (!art) return;

    art[field] = el.value ?? "";
    await setActorFlag(actor, data);
    // no full rerender needed
  });

  // Toggle tag selection
  root.find('[data-action="toggle-tag"]').off("click").on("click", async (ev) => {
    const el = ev.currentTarget;
    const aid = el.dataset.artifactId;
    const tag = el.dataset.tag;
    if (!aid || !tag) return;

    const data = await getActorFlag(actor);
    data.selected.tagKeys = Array.isArray(data.selected.tagKeys) ? data.selected.tagKeys : [];
    const key = buildTagKey(aid, tag);

    const idx = data.selected.tagKeys.indexOf(key);
    if (idx >= 0) data.selected.tagKeys.splice(idx, 1);
    else data.selected.tagKeys.push(key);

    data.selected.tagKeys = Array.from(new Set(data.selected.tagKeys));

    await setActorFlag(actor, data);
    app.render(true);
  });

  // Add tag
  root.find('[data-action="add-tag"]').off("click").on("click", async (ev) => {
    if (!isEditable) return;
    const card = $(ev.currentTarget).closest(".com-artifact-card");
    const aid = card.attr("data-artifact-id");
    const data = await getActorFlag(actor);
    const art = data.artifacts.find(a => a.id === aid);
    if (!art) return;

    const content = `
      <p>Add a tag (comma-separated allowed):</p>
      <input type="text" style="width:100%" name="tag" placeholder="e.g. Relic, Cursed, Rumor" />
    `;
    new Dialog({
      title: "Add Artifact Tag",
      content,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: "Add",
          callback: async (dlgHtml) => {
            const val = dlgHtml.find('input[name="tag"]').val();
            const tags = String(val ?? "")
              .split(",")
              .map(t => t.trim())
              .filter(Boolean);

            art.tags = Array.isArray(art.tags) ? art.tags : [];
            for (const t of tags) if (!art.tags.includes(t)) art.tags.push(t);

            await setActorFlag(actor, data);
            app.render(true);
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "add"
    }).render(true);
  });
}

/** Roll dialog injection (best-effort)
 * - Adds a small block showing currently selected artifact tags for the speaker actor (if present)
 * - Does not modify system logic; just surfaces selected tags in the UI
 */
async function injectIntoDialog(app, html) {
  try {
    // Find an actor context from speaker or last controlled token
    let actor = null;

    const speaker = ChatMessage.getSpeaker();
    actor = ChatMessage.getSpeakerActor(speaker) ?? actor;

    if (!actor) {
      const tok = canvas?.tokens?.controlled?.[0];
      actor = tok?.actor ?? null;
    }
    if (!actor) return;

    const data = await getActorFlag(actor);
    const selected = data.selected?.tagKeys ?? [];
    if (!selected.length) return;

    // Build readable list
    const items = selected.map(k => {
      const [aid, tag] = k.split("::");
      const art = (data.artifacts ?? []).find(a => a.id === aid);
      const label = art ? `${art.name}: ${tag}` : tag;
      return `<li>${escapeHtml(label)}</li>`;
    }).join("");

    const block = `
      <div class="com-roll-inject" style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.12);">
        <h4 style="margin:0 0 6px 0;">Selected Artifact Tags</h4>
        <ul style="margin:0; padding-left:18px;">${items}</ul>
      </div>
    `;

    // Insert near the bottom of dialog content
    const content = html.find(".dialog-content");
    if (!content.length) return;

    // Avoid duplicates
    if (content.find(".com-roll-inject").length) return;

    content.append(block);
  } catch (e) {
    // Must never break dialogs
    warn("Dialog injection failed (non-fatal):", e);
  }
}

/* ----------------- Hooks ----------------- */

Hooks.once("init", () => {
  log("Initializing…");
});

Hooks.once("ready", async () => {
  // Normalize all actors once to prevent old/bad data crashes.
  try {
    for (const actor of game.actors ?? []) {
      await ensureActorFlagNormalized(actor);
    }
    log("Ready.");
  } catch (e) {
    err("Normalization pass failed:", e);
  }
});

// Actor sheet injection (legacy sheets)
Hooks.on("renderActorSheet", async (app, html) => {
  await upsertArtifactsTab(app, html);
});

// Some systems use renderActorSheetV2 in v13; support it as well
Hooks.on("renderActorSheetV2", async (app, html) => {
  await upsertArtifactsTab(app, html);
});

// Dialog injection (best-effort across systems)
Hooks.on("renderDialog", async (app, html) => {
  await injectIntoDialog(app, html);
});
