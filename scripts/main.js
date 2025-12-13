const MODULE_ID = "com-artifacts";

/* =====================================================================================
 * SOCKET: GM APPROVAL (Artifacts + Normal Tags)
 * ===================================================================================== */
const COMA_SOCKET = `module.${MODULE_ID}`;
globalThis._comaOpenRollDialogs ??= new Map();
globalThis._comaGMReviewAnchor ??= null; // {left, top, width, height}

function comaLog(...a) { console.log(`${MODULE_ID} |`, ...a); }

/** Basic escape */
function esc(s) { return Handlebars.escapeExpression(String(s ?? "")); }

/** Place GM dialogs next to each other (best effort) */
function positionGMDialog(app) {
  try {
    const a = globalThis._comaGMReviewAnchor;
    if (!a) return;
    app.setPosition({ left: a.left + (a.width ?? 380) + 10, top: a.top });
  } catch (_) {}
}

/* =====================================================================================
 * READY: SOCKET LISTENER
 * ===================================================================================== */
Hooks.once("ready", () => {
  comaLog("READY", { user: game.user?.name, isGM: game.user?.isGM });

  game.socket.on(COMA_SOCKET, async (msg) => {
    try {
      if (!msg?.type) return;

// --- GM: ARTIFACT REVIEW (SAFE RENDER) ---
if (msg.type === "coma-approval-artifacts-request" && game.user.isGM) {
  const entries = Array.isArray(msg.entries) ? msg.entries : [];
  const artifactsMeta = Array.isArray(msg.artifactsMeta) ? msg.artifactsMeta : [];

  const powerSelectedByArtifact = new Map();
  for (const e of entries) {
    if (e?.kind === "artifact-power" && Number.isFinite(e.artifactIdx)) {
      powerSelectedByArtifact.set(Number(e.artifactIdx), true);
    }
  }

  const weaknessBlocks = artifactsMeta
    .filter(m => powerSelectedByArtifact.get(Number(m.artifactIdx)))
    .map(m => {
      const wLabel = (m.weaknessLabel ?? "").trim();
      if (!wLabel) return "";
      return `
        <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input type="checkbox" class="coma-art-weak" data-artifact-idx="${Number(m.artifactIdx)}" />
          <span><strong>Add weakness:</strong> ${esc(wLabel)}</span>
          <span style="margin-left:auto; opacity:.8;">-1</span>
        </label>
      `;
    })
    .join("");

  const content = `
    <div>
      <div style="opacity:.85; margin-bottom:6px;">
        <div><strong>From:</strong> ${esc(msg.fromUserName ?? "")}</div>
        <div><strong>Actor:</strong> ${esc(msg.actorName ?? "")}</div>
      </div>

      <fieldset style="padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
        <legend>Artifacts (GM Review)</legend>

        <div style="display:flex; flex-direction:column; gap:6px; max-height:320px; overflow:auto;">
          ${
            entries.length
              ? entries.map((e) => `
                <label style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" class="coma-approve-art" data-idx="${Number(e.idx)}" ${e.checked ? "checked" : ""}/>
                  <span>${esc(e.label ?? "")}</span>
                  <span style="margin-left:auto; opacity:.8;">${Number(e.mod) > 0 ? "+1" : "-1"}</span>
                </label>
              `).join("")
              : `<div style="opacity:.8;">No artifact tags requested.</div>`
          }
        </div>

        ${weaknessBlocks ? `<hr style="opacity:.35; margin:8px 0;">${weaknessBlocks}` : ``}
      </fieldset>
    </div>
  `;

  // Defer creation/render so other app errors don't swallow this call stack
  setTimeout(() => {
    try {
      const d = new Dialog({
        title: "Review: Artifacts",
        content,
        buttons: {
          apply: {
            label: "Confirm",
            callback: (html) => {
              const root = html?.[0];
              const checks = Array.from(root.querySelectorAll("input.coma-approve-art[data-idx]"));

              const toggles = entries.map((e) => {
                const idx = Number(e.idx);
                const c = checks.find(x => Number(x.getAttribute("data-idx")) === idx);
                return { ...e, checked: c ? c.checked : !!e.checked };
              });

              const weakChecks = Array.from(root.querySelectorAll("input.coma-art-weak[data-artifact-idx]"));
              const addWeaknessFor = weakChecks
                .filter(c => c.checked)
                .map(c => Number(c.getAttribute("data-artifact-idx")));

              game.socket.emit(COMA_SOCKET, {
                type: "coma-approval-artifacts-result",
                requestId: msg.requestId,
                toUserId: msg.fromUserId,
                toggles,
                addWeaknessFor
              });
            }
          },
          close: { label: "Close" }
        },
        default: "apply"
      });

      d.render(true);

      // After render: bring to top + store anchor safely
      setTimeout(() => {
        try {
          d.bringToTop?.();
          if (d.position) globalThis._comaGMReviewAnchor = { ...d.position };
        } catch (_) {}
      }, 50);

    } catch (e) {
      console.warn(`${MODULE_ID} | GM artifacts review dialog failed`, e);
    }
  }, 0);

  return;
}

// --- GM: NORMAL REVIEW (SAFE RENDER) ---
if (msg.type === "coma-approval-normal-request" && game.user.isGM) {
  const entries = Array.isArray(msg.entries) ? msg.entries : [];

  const content = `
    <div>
      <div style="opacity:.85; margin-bottom:6px;">
        <div><strong>From:</strong> ${esc(msg.fromUserName ?? "")}</div>
        <div><strong>Actor:</strong> ${esc(msg.actorName ?? "")}</div>
      </div>

      <fieldset style="padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
        <legend>Normal Tags (GM Review)</legend>
        <div style="display:flex; flex-direction:column; gap:6px; max-height:320px; overflow:auto;">
          ${
            entries.length
              ? entries.map((e) => `
                <label style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" class="coma-approve-norm" data-idx="${Number(e.idx)}" ${e.checked ? "checked" : ""}/>
                  <span>${esc(e.label ?? "")}</span>
                  <span style="margin-left:auto; opacity:.8;">${Number(e.mod) > 0 ? "+1" : "-1"}</span>
                </label>
              `).join("")
              : `<div style="opacity:.8;">No normal tags detected.</div>`
          }
        </div>
      </fieldset>
    </div>
  `;

  setTimeout(() => {
    try {
      const d = new Dialog({
        title: "Review: Normal Tags",
        content,
        buttons: {
          apply: {
            label: "Confirm",
            callback: (html) => {
              const root = html?.[0];
              const checks = Array.from(root.querySelectorAll("input.coma-approve-norm[data-idx]"));
              const toggles = entries.map((e) => {
                const idx = Number(e.idx);
                const c = checks.find(x => Number(x.getAttribute("data-idx")) === idx);
                return { ...e, checked: c ? c.checked : !!e.checked };
              });

              game.socket.emit(COMA_SOCKET, {
                type: "coma-approval-normal-result",
                requestId: msg.requestId,
                toUserId: msg.fromUserId,
                toggles
              });
            }
          },
          close: { label: "Close" }
        },
        default: "apply"
      });

      d.render(true);

      setTimeout(() => {
        try {
          d.bringToTop?.();
          // place next to anchor if we have one
          if (globalThis._comaGMReviewAnchor?.left != null) {
            const a = globalThis._comaGMReviewAnchor;
            d.setPosition?.({ left: a.left + (a.width ?? 380) + 10, top: a.top });
          }
        } catch (_) {}
      }, 60);

    } catch (e) {
      console.warn(`${MODULE_ID} | GM normal review dialog failed`, e);
    }
  }, 0);

  return;
}


        d.render(true);

        // place next to anchor if present
        setTimeout(() => positionGMDialog(d), 0);
        return;
      }

      /* -------------------------- PLAYER: APPLY ARTIFACT RESULT -------------------------- */
      if (msg.type === "coma-approval-artifacts-result" && msg.toUserId === game.user.id) {
        const app = globalThis._comaOpenRollDialogs.get(msg.requestId);
        if (!app) return;

        const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
        if (!$root?.length) return;

        // Apply to artifact approval panel (our injected checkboxes)
        const $panel = $root.find(".com-artifacts-roll");
        if ($panel.length) {
          const inputs = $panel.find("input.com-approve").toArray();
          for (const t of (msg.toggles ?? [])) {
            const el = inputs[Number(t.idx)];
            if (!el) continue;
            const changed = el.checked !== !!t.checked;
            el.checked = !!t.checked;
            if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
          }

          // Add weakness for artifacts where GM checked it
          const addWeak = Array.isArray(msg.addWeaknessFor) ? msg.addWeaknessFor : [];
          if (addWeak.length) {
            // For each artifact idx, find the corresponding weakness checkbox in our panel and check it
            // (We tag weakness entries by data-kind + data-artifact-idx)
            for (const aIdx of addWeak) {
              const $w = $panel.find(`input.com-approve[data-kind="artifact-weakness"][data-artifact-idx="${Number(aIdx)}"]`).first();
              if ($w.length && !$w[0].checked) {
                $w[0].checked = true;
                $w[0].dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          }
        }

        app._comaArtifactsApproved = true;
        tryUnlockPlayerConfirm(app);
        return;
      }

      /* --------------------------- PLAYER: APPLY NORMAL RESULT -------------------------- */
      if (msg.type === "coma-approval-normal-result" && msg.toUserId === game.user.id) {
        const app = globalThis._comaOpenRollDialogs.get(msg.requestId);
        if (!app) return;

        const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
        if (!$root?.length) return;

        // Apply to normal tag checkboxes we discovered (stored on app)
        const list = Array.isArray(app._comaNormalInputs) ? app._comaNormalInputs : [];
        for (const t of (msg.toggles ?? [])) {
          const el = list[Number(t.idx)];
          if (!el) continue;
          const changed = el.checked !== !!t.checked;
          el.checked = !!t.checked;
          if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        app._comaNormalApproved = true;
        tryUnlockPlayerConfirm(app);
        return;
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | socket handler error`, e);
    }
  });
});

/* =====================================================================================
 * SELECTION (per-user, persisted on user flags)
 * ===================================================================================== */
globalThis.comArtifactsSelection ??= new Map();

function loadSelectionFromUserFlag(actorId) {
  try {
    const all = game.user.getFlag(MODULE_ID, "selection") ?? {};
    const arr = Array.isArray(all?.[actorId]) ? all[actorId] : [];
    return new Set(arr.filter(Boolean));
  } catch (e) {
    console.warn(`${MODULE_ID} | failed to read selection flag`, e);
    return new Set();
  }
}

let _selSaveTimer = null;
function scheduleSaveSelection(actorId) {
  if (_selSaveTimer) clearTimeout(_selSaveTimer);
  _selSaveTimer = setTimeout(async () => {
    try {
      const all = game.user.getFlag(MODULE_ID, "selection") ?? {};
      const set = globalThis.comArtifactsSelection.get(actorId) ?? new Set();
      all[actorId] = Array.from(set);
      await game.user.setFlag(MODULE_ID, "selection", all);
    } catch (e) {
      console.warn(`${MODULE_ID} | failed to save selection flag`, e);
    }
  }, 150);
}

function getSel(actorId) {
  if (!globalThis.comArtifactsSelection.has(actorId)) {
    globalThis.comArtifactsSelection.set(actorId, loadSelectionFromUserFlag(actorId));
  }
  return globalThis.comArtifactsSelection.get(actorId);
}

function toggleSel(actorId, key) {
  const s = getSel(actorId);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  scheduleSaveSelection(actorId);
  return s;
}

function clearSel(actorId) {
  globalThis.comArtifactsSelection.delete(actorId);
  scheduleSaveSelection(actorId);
}

/** Clears selection AND immediately removes yellow highlight on the open sheet (if any). */
function clearSelAndUnhighlight(actorId) {
  try {
    clearSel(actorId);

    const actor = game.actors.get(actorId);
    const sheet = actor?.sheet;

    if (sheet?.rendered && sheet?.element) {
      const $el = sheet.element.jquery ? sheet.element : $(sheet.element);
      $el.find(".com-tag-pill.com-picked, .com-tag-pick.com-picked").removeClass("com-picked");
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | clearSelAndUnhighlight failed`, e);
  }
}

/* =====================================================================================
 * STORAGE
 * ===================================================================================== */
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

/* =====================================================================================
 * TAB HELPERS
 * ===================================================================================== */
function getActiveTab(html) {
  return html.find('nav.sheet-tabs a.item.active, nav.tabs a.item.active').data("tab");
}

function forceActivateTab(app, tab) {
  const tabs = app?._tabs?.[0];
  if (!tabs || !tab) return;
  setTimeout(() => { try { tabs.activate(tab); } catch (_) {} }, 0);
}

/* =====================================================================================
 * LOCK DETECTION (for your artifacts tab UI)
 * ===================================================================================== */
function isSheetUnlocked(html) {
  const ref = html
    .find(`.sheet-body .tab:not([data-tab="${MODULE_ID}"]) input, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) textarea, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) select`)
    .filter((_, el) => el.offsetParent !== null);

  if (ref.length) return ref.toArray().some(el => !el.disabled);
  return true;
}

/* =====================================================================================
 * SHEET UI: ARTIFACTS TAB (your existing “stable” UI)
 * NOTE: If your current working UI differs, keep yours. This is here only so this file
 * remains all-in-one pasteable.
 * ===================================================================================== */
function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  if (!document.getElementById("com-artifacts-inline-style")) {
    const style = document.createElement("style");
    style.id = "com-artifacts-inline-style";
    style.textContent = `
      .com-artifacts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .com-artifact { border: 1px solid var(--color-border-light-primary); border-radius: 10px; padding: 12px; box-sizing: border-box; }
      .com-topbar { display:flex; justify-content:flex-end; margin-bottom:6px; }
      .com-edit-toggle{
        background: rgba(120, 80, 160, .12);
        border: 1px solid rgba(120, 80, 160, .55);
        border-radius: 10px;
        width: 36px;
        height: 24px;
        cursor:pointer;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        color: var(--color-text-hyperlink);
      }
      .com-edit-toggle[disabled]{ opacity:.55; cursor:default; }

      .com-center { display:flex; flex-direction:column; align-items:center; gap:10px; }
      .com-name-display{
        font-size: 1.5em;
        font-weight: 600;
        color: var(--color-text-hyperlink);
        text-align:center;
        line-height: 1.1;
        max-width: 100%;
        word-break: break-word;
        margin-top: 2px;
      }
      .com-name-input{ width: 100%; max-width: 320px; box-sizing:border-box; }

      .com-artifact-img{
        width: 192px;
        height: 192px;
        border: 1px solid var(--color-border-light-primary);
        border-radius: 10px;
        background-size: cover;
        background-position: center;
        background-repeat:no-repeat;
        display:flex;
        align-items:center;
        justify-content:center;
        user-select:none;
        box-sizing: border-box;
      }
      .com-artifact-img.com-img-clickable{ cursor:pointer; }
      .com-artifact-img.com-img-disabled{ cursor:default; opacity:.85; }
      .com-artifact-img .com-img-ph{
        font-size: 42px;
        opacity: .85;
        color: var(--color-text-hyperlink);
      }

      .com-tag-box{
        width: 192px;
        border-radius: 10px;
        padding: 8px 10px;
        margin-top: 8px;
        border: 1px solid rgba(120, 80, 160, .55);
        background: rgba(120, 80, 160, .10);
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .08);
        box-sizing: border-box;
        overflow: hidden;
      }
      .com-tag-box-title{
        font-size: 12px;
        opacity: .85;
        margin-bottom: 6px;
        text-align:center;
      }

      .com-tag-pill{
        display:inline-flex;
        align-items:center;
        gap: 8px;
        padding: 4px 10px;
        border-radius: 10px;
        cursor:pointer;
        user-select:none;
        border: 1px solid transparent;
        margin: 6px 0;
        box-sizing: border-box;
        max-width: 100%;
      }
      .com-tag-pill:hover{
        border-color: rgba(120, 80, 160, .45);
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .12);
      }

      .com-tag-pill.com-picked { background: #ffeb3b; }
      .com-tag-pill.com-weak.com-picked { background: #ffd54f; }

      .com-view-only{ display: block; }
      .com-edit-only{ display: none; }
      .com-artifact.com-editing .com-view-only{ display:none; }
      .com-artifact.com-editing .com-edit-only{ display:block; }

      .com-edit-fields{ width: 100%; box-sizing:border-box; display:flex; flex-direction:column; gap:8px; }
      .com-edit-fields label{ font-size: 12px; opacity:.85; }
      .com-edit-fields input{ width: 100%; max-width: 100%; box-sizing:border-box; }

      .com-artifact .hint { opacity: .8; font-size: 12px; margin-top: 10px; text-align:center; }
    `;
    document.head.appendChild(style);
  }

  const nav = html.find("nav.sheet-tabs, nav.tabs");
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

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);
    const sheetUnlocked = isSheetUnlocked(html);

    const pill = (key, txt, isWeak, iconClass) => `
      <div class="com-tag-pill ${isWeak ? "com-weak" : ""}" data-pick="${key}">
        <i class="fas ${iconClass}"></i>
        <span class="com-pill-text">${esc(txt)}</span>
      </div>
    `;

    const renderCard = (a, idx) => {
      const nameDisplay = ((a.name ?? "").trim()) || `Artifact ${idx + 1}`;
      const p0 = (a.power?.[0]?.name ?? "").trim();
      const p1 = (a.power?.[1]?.name ?? "").trim();
      const w  = (a.weakness?.name ?? "").trim();

      const imgStyle = a.img ? `style="background-image:url('${a.img.replace(/'/g, "%27")}')"` : "";
      const hasImg = !!(a.img ?? "").trim();

      return `
        <section class="com-artifact" data-idx="${idx}">
          <div class="com-topbar">
            <button type="button" class="com-edit-toggle" data-idx="${idx}" ${sheetUnlocked ? "" : "disabled"} title="${sheetUnlocked ? "Toggle edit" : "Sheet is locked"}">
              <i class="fas fa-lock"></i>
            </button>
          </div>

          <div class="com-center">
            <div class="com-view-only">
              <div class="com-name-display com-name-text">${esc(nameDisplay)}</div>
            </div>

            <div class="com-edit-only">
              <input class="com-name-input" type="text" data-field="name" value="${esc(a.name ?? "")}">
            </div>

            <div class="com-artifact-img com-img-disabled" data-action="pick-image" ${imgStyle}>
              ${hasImg ? "" : `<i class="fas fa-image com-img-ph"></i>`}
            </div>

            <div class="com-tag-box">
              <div class="com-tag-box-title">Power Tags</div>

              <div class="com-view-only com-power-view">
                ${p0 ? pill(`a${idx}.p0`, p0, false, "fa-bolt") : ""}
                ${p1 ? pill(`a${idx}.p1`, p1, false, "fa-bolt") : ""}
                ${(!p0 && !p1) ? `<div style="opacity:.6; text-align:center; font-size:12px;">(empty)</div>` : ""}
              </div>

              <div class="com-edit-only com-power-edit">
                <div class="com-edit-fields">
                  <label>Power Tag 1</label>
                  <input type="text" data-field="power.0.name" value="${esc(p0)}">
                  <label>Power Tag 2</label>
                  <input type="text" data-field="power.1.name" value="${esc(p1)}">
                </div>
              </div>
            </div>

            <div class="com-tag-box">
              <div class="com-tag-box-title">Weakness Tag</div>

              <div class="com-view-only com-weak-view">
                ${w ? pill(`a${idx}.w`, w, true, "fa-angle-double-down") : `<div style="opacity:.6; text-align:center; font-size:12px;">(empty)</div>`}
              </div>

              <div class="com-edit-only com-weak-edit">
                <div class="com-edit-fields">
                  <label>Weakness Tag</label>
                  <input type="text" data-field="weakness.name" value="${esc(w)}">
                </div>
              </div>
            </div>

            <div class="hint com-hint-text">Click tags to select/deselect.</div>
          </div>
        </section>
      `;
    };

    grid.html(artifacts.map(renderCard).join(""));

    // restore highlight from selection
    const sel = getSel(actor.id);
    grid.find(".com-tag-pill").each((_, el) => {
      const key = el.dataset.pick;
      if (sel.has(key)) $(el).addClass("com-picked");
    });

    function setCardEditing($sec, on) {
      $sec.toggleClass("com-editing", !!on);

      const $btn = $sec.find(".com-edit-toggle").first();
      const $icon = $btn.find("i.fas").first();
      $icon.removeClass("fa-lock fa-lock-open").addClass(on ? "fa-lock-open" : "fa-lock");

      const canClickImg = on && isSheetUnlocked(html);
      const $img = $sec.find(".com-artifact-img").first();
      $img.toggleClass("com-img-clickable", canClickImg);
      $img.toggleClass("com-img-disabled", !canClickImg);

      const $hint = $sec.find(".com-hint-text").first();
      $hint.text(on ? "Editing: update fields and click the lock again to save." : "Click tags to select/deselect.");
    }

    grid.find(".com-artifact").each((_, el) => setCardEditing($(el), false));

    // View mode: click to select/deselect (blocked in edit mode)
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pill", (ev) => {
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      if ($sec.hasClass("com-editing")) return;

      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $(ev.currentTarget).toggleClass("com-picked", set.has(key));
    });

    // Edit toggle (no actor sheet refresh)
    grid.off("click.comArtifactsToggle").on("click.comArtifactsToggle", ".com-edit-toggle", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (!isSheetUnlocked(html)) return;

      const $sec = $(ev.currentTarget).closest(".com-artifact");
      const idx = Number($sec.data("idx"));
      const isEditing = $sec.hasClass("com-editing");

      if (!isEditing) {
        setCardEditing($sec, true);
        return;
      }

      // Leaving edit mode -> commit changes
      const artifacts2 = await getArtifacts(actor);

      const name = ($sec.find(`input[data-field="name"]`).val() ?? "").toString();
      const p0 = ($sec.find(`input[data-field="power.0.name"]`).val() ?? "").toString();
      const p1 = ($sec.find(`input[data-field="power.1.name"]`).val() ?? "").toString();
      const w  = ($sec.find(`input[data-field="weakness.name"]`).val() ?? "").toString();

      artifacts2[idx].name = name;
      artifacts2[idx].power[0].name = p0;
      artifacts2[idx].power[1].name = p1;
      artifacts2[idx].weakness.name = w;

      const tab = getActiveTab(html) || MODULE_ID;
      app._comLastTab = tab;

      await setArtifacts(actor, artifacts2);

      // Update view DOM
      const dispName = (name ?? "").trim() || `Artifact ${idx + 1}`;
      $sec.find(".com-name-text").text(dispName);

      const $pView = $sec.find(".com-power-view").first();
      $pView.empty();
      const pp0 = (p0 ?? "").trim();
      const pp1 = (p1 ?? "").trim();
      if (pp0) $pView.append($(pill(`a${idx}.p0`, pp0, false, "fa-bolt")));
      if (pp1) $pView.append($(pill(`a${idx}.p1`, pp1, false, "fa-bolt")));
      if (!pp0 && !pp1) $pView.append($(`<div style="opacity:.6; text-align:center; font-size:12px;">(empty)</div>`));

      const $wView = $sec.find(".com-weak-view").first();
      $wView.empty();
      const ww = (w ?? "").trim();
      if (ww) $wView.append($(pill(`a${idx}.w`, ww, true, "fa-angle-double-down")));
      else $wView.append($(`<div style="opacity:.6; text-align:center; font-size:12px;">(empty)</div>`));

      // Re-apply selection highlight
      const s = getSel(actor.id);
      $sec.find(".com-tag-pill").each((_, el2) => {
        const key = el2.dataset.pick;
        $(el2).toggleClass("com-picked", s.has(key));
      });

      setCardEditing($sec, false);
      forceActivateTab(app, app._comLastTab || MODULE_ID);
    });

    // Image pick only in edit mode + sheet unlocked
    grid.off("click.comArtifactsImg").on("click.comArtifactsImg", ".com-artifact-img[data-action='pick-image']", async (ev) => {
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      const idx = Number($sec.data("idx"));

      if (!isSheetUnlocked(html)) return;
      if (!$sec.hasClass("com-editing")) return;

      const artifacts2 = await getArtifacts(actor);

      new FilePicker({
        type: "image",
        current: artifacts2[idx].img || "",
        callback: async (path) => {
          artifacts2[idx].img = path;
          await setArtifacts(actor, artifacts2);

          const $img = $sec.find(".com-artifact-img").first();
          $img.css("background-image", path ? `url('${String(path).replace(/'/g, "%27")}')` : "");
          if (path) $img.find(".com-img-ph").remove();
          else if (!$img.find(".com-img-ph").length) $img.append(`<i class="fas fa-image com-img-ph"></i>`);
        }
      }).browse();
    });

  })().catch(e => console.error(`${MODULE_ID} | ensureArtifactsTab render failed`, e));
}

Hooks.on("renderActorSheet", (app, html) => {
  try {
    const actor = app?.actor;
    if (!actor) return;

    const $html = html?.jquery ? html : $(html);

    const tab = getActiveTab($html);
    if (tab) app._comLastTab = tab;

    ensureArtifactsTab(app, $html, actor);
    forceActivateTab(app, app._comLastTab);
  } catch (e) {
    console.error(`${MODULE_ID} | renderActorSheet failed`, e);
  }
});

/* =====================================================================================
 * ROLLDIALOG: INJECT ARTIFACT PANEL + GM-APPROVAL BLOCK OVER CONFIRM
 * ===================================================================================== */

/** Find Custom Modifier input in CoM roll dialog (best effort) */
function findCustomModifierInput($root) {
  // Prefer label match
  const labels = $root.find("label").toArray();
  for (const el of labels) {
    const txt = (el.textContent ?? "").trim().toLowerCase();
    if (txt === "custom modifier") {
      const $wrap = $(el).closest("div");
      const $input = $wrap.find("input").first();
      if ($input.length) return $input;
    }
  }
  // fallback
  const $cand = $root.find('input[type="number"], input[type="text"]').filter((_, i) => i.offsetParent !== null).first();
  return $cand.length ? $cand : null;
}

/** Build artifact entries from your selection */
function buildSelectedArtifactEntries(artifacts, selSet) {
  const out = [];
  for (let a = 0; a < 2; a++) {
    const art = artifacts[a];
    const p0 = (art.power?.[0]?.name ?? "").trim();
    const p1 = (art.power?.[1]?.name ?? "").trim();
    const w  = (art.weakness?.name ?? "").trim();

    if (selSet.has(`a${a}.p0`) && p0) out.push({ label: p0, mod: +1, kind: "artifact-power", artifactIdx: a });
    if (selSet.has(`a${a}.p1`) && p1) out.push({ label: p1, mod: +1, kind: "artifact-power", artifactIdx: a });
    if (selSet.has(`a${a}.w`)  && w)  out.push({ label: w,  mod: -1, kind: "artifact-weakness", artifactIdx: a });
  }
  return out;
}

/**
 * Discover "normal" tag checkboxes in the RollDialog (heuristic).
 * We look for checked checkboxes not belonging to our artifacts panel.
 * This is best-effort because CoM implementations vary.
 */
function discoverNormalTagInputs($root) {
  const $form = $root.find("form").first();
  const $scope = $form.length ? $form : $root;

  const all = $scope.find('input[type="checkbox"]').toArray();

  // Exclude our own injected ones
  const filtered = all.filter(el => {
    const $el = $(el);
    if ($el.hasClass("com-approve")) return false;
    if ($el.closest(".com-artifacts-roll").length) return false;
    // ignore hidden/offscreen
    if (el.offsetParent === null) return false;
    return true;
  });

  // Keep only checked ones as "selected tags"
  const checked = filtered.filter(el => !!el.checked);

  // Attempt label extraction
  const entries = checked.map((el, idx) => {
    let label = "";
    const $el = $(el);
    const $lbl = $el.closest("label");
    if ($lbl.length) label = ($lbl.text() ?? "").trim();
    if (!label) {
      // sibling text
      label = ($el.parent().text() ?? "").trim();
    }
    label = label.replace(/\s+/g, " ").trim();

    // Mod guess: if label contains "weak" -> -1 else +1 (you can refine later)
    const mod = /weak/i.test(label) ? -1 : +1;

    return { idx, el, label: label || "Tag", mod, checked: true };
  });

  return { inputs: checked, entries };
}

/* ----------------------------- Player confirm-block overlay ---------------------------- */
function ensureConfirmBlocker($root, on, reasonText) {
  try {
    const $dlg = $root.closest(".app");
    if (!$dlg.length) return;

    // Prefer overlay on dialog buttons area if found, else overlay whole form
    const $btnRow = $root.find(".dialog-buttons").first();
    const $mount = $btnRow.length ? $btnRow : $root.find("form").first();

    const $m = $mount.length ? $mount : $root;
    if (!$m.length) return;

    $m.css("position", "relative");

    const existing = $m.find(".coma-confirm-blocker").first();

    if (!on) {
      existing.remove();
      // also re-enable dialog buttons if we disabled them
      $root.find("button.dialog-button").prop("disabled", false);
      return;
    }

    if (!existing.length) {
      const blocker = $(`
        <div class="coma-confirm-blocker"
             style="
               position:absolute;
               inset:0;
               z-index:1000;
               background: rgba(120,120,120,.38);
               border-radius: 6px;
               display:flex;
               align-items:center;
               justify-content:center;
               pointer-events:auto;
               user-select:none;
             ">
          <div style="
            padding:6px 10px;
            background: rgba(0,0,0,.35);
            border: 1px solid rgba(255,255,255,.18);
            border-radius: 8px;
            color: #fff;
            font-size: 12px;
            text-align:center;
            max-width: 90%;
          ">
            ${esc(reasonText ?? "Waiting for GM approval…")}
          </div>
        </div>
      `);
      $m.append(blocker);
      // optional: disable buttons as well (belt & suspenders)
      $root.find("button.dialog-button").prop("disabled", true);
    } else {
      existing.find("div").first().html(esc(reasonText ?? "Waiting for GM approval…"));
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | ensureConfirmBlocker failed`, e);
  }
}

function tryUnlockPlayerConfirm(app) {
  try {
    const needA = !!app._comaNeedArtifacts;
    const needN = !!app._comaNeedNormal;

    const okA = !needA || !!app._comaArtifactsApproved;
    const okN = !needN || !!app._comaNormalApproved;

    if (okA && okN) {
      const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
      if ($root?.length) ensureConfirmBlocker($root, false);
    } else {
      const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
      if ($root?.length) ensureConfirmBlocker($root, true, "Waiting for GM approval…");
    }
  } catch (_) {}
}

/* ----------------------------- RollDialog injection + approval ---------------------------- */
Hooks.on("renderRollDialog", async (app, html) => {
  try {
    const $root =
      html?.jquery ? html :
      html ? $(html) :
      app?.element ? (app.element.jquery ? app.element : $(app.element)) :
      null;
    if (!$root || !$root.length) return;

    const actor =
      app.actor ??
      app.options?.actor ??
      (app.options?.actorId ? game.actors.get(app.options.actorId) : null) ??
      game.user.character;
    if (!actor) return;

    // Avoid double-inject artifacts panel
    if ($root.find(".com-artifacts-roll").length === 0) {
      const $modInput = findCustomModifierInput($root);
      if ($modInput && $modInput.length) {
        if (!Number.isFinite(app._comArtifactsBaseMod)) {
          const base = Number($modInput.val() ?? 0);
          app._comArtifactsBaseMod = Number.isFinite(base) ? base : 0;
        }

        const artifacts = await getArtifacts(actor);
        const sel = getSel(actor.id);
        const entries = buildSelectedArtifactEntries(artifacts, sel);

        const $form = $root.find("form").first();
        const $mount = $form.length ? $form : $root;

        const $panel = $(`
          <fieldset class="com-artifacts-roll" style="margin-top:10px; padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
            <legend>Artifacts</legend>
            <div class="com-artifacts-approve" style="display:flex; flex-direction:column; gap:6px;">
              ${
                entries.length
                  ? entries.map((e, idx) => `
                    <label style="display:flex; align-items:center; gap:8px;">
                      <input type="checkbox"
                             class="com-approve"
                             data-kind="${esc(e.kind)}"
                             data-artifact-idx="${Number.isFinite(e.artifactIdx) ? Number(e.artifactIdx) : ""}"
                             data-mod="${e.mod}"
                             checked />
                      <span>${esc(e.label)}</span>
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

        $mount.append($panel);

        function recomputeAndApply() {
          let mod = 0;
          $panel.find("input.com-approve:checked").each((_, el) => {
            mod += Number(el.dataset.mod ?? 0);
          });

          $panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod}`);

          $modInput.val((app._comArtifactsBaseMod ?? 0) + mod);
          $modInput.trigger("input");
          $modInput.trigger("change");
        }

        app._comArtifactsRecompute = recomputeAndApply;
        recomputeAndApply();
        $panel.on("change", "input.com-approve", recomputeAndApply);
      }
    }

    // GM does not need approval gating from themselves
    if (game.user.isGM) return;

    // Establish requestId + register app in map
    if (!app._comaRequestId) app._comaRequestId = foundry.utils.randomID();
    globalThis._comaOpenRollDialogs.set(app._comaRequestId, app);

    // Determine needs: artifacts selected?
    const artifacts = await getArtifacts(actor);
    const sel = getSel(actor.id);
    const artifactEntries = buildSelectedArtifactEntries(artifacts, sel)
      .map((e, idx) => ({ idx, label: e.label, mod: e.mod, checked: true, kind: e.kind, artifactIdx: e.artifactIdx }));

    // Determine needs: normal tags selected in dialog (best-effort)
    const normalFound = discoverNormalTagInputs($root);
    app._comaNormalInputs = normalFound.inputs;
    const normalEntries = normalFound.entries
      .filter(e => (e.label ?? "").trim())
      .map((e, idx) => ({ idx, label: e.label, mod: e.mod, checked: true }));

    app._comaNeedArtifacts = artifactEntries.length > 0;
    app._comaNeedNormal = normalEntries.length > 0;

    // If nothing selected, do not block
    if (!app._comaNeedArtifacts && !app._comaNeedNormal) {
      ensureConfirmBlocker($root, false);
      return;
    }

    // Block confirm until GM approves
    app._comaArtifactsApproved = !app._comaNeedArtifacts;
    app._comaNormalApproved = !app._comaNeedNormal;
    ensureConfirmBlocker($root, true, "Waiting for GM approval…");

    // Send requests only once per dialog render cycle
    if (!app._comaSentApprovalRequests) {
      app._comaSentApprovalRequests = true;

      // ARTIFACT REQUEST
      if (app._comaNeedArtifacts) {
        const artifactsMeta = [
          { artifactIdx: 0, weaknessLabel: (artifacts[0]?.weakness?.name ?? "").trim() },
          { artifactIdx: 1, weaknessLabel: (artifacts[1]?.weakness?.name ?? "").trim() }
        ];

        game.socket.emit(COMA_SOCKET, {
          type: "coma-approval-artifacts-request",
          requestId: app._comaRequestId,
          fromUserId: game.user.id,
          fromUserName: game.user.name,
          actorId: actor.id,
          actorName: actor.name,
          entries: artifactEntries,
          artifactsMeta
        });
      }

      // NORMAL REQUEST
      if (app._comaNeedNormal) {
        game.socket.emit(COMA_SOCKET, {
          type: "coma-approval-normal-request",
          requestId: app._comaRequestId,
          fromUserId: game.user.id,
          fromUserName: game.user.name,
          actorId: actor.id,
          actorName: actor.name,
          entries: normalEntries
        });
      }

      // Safety timeout: if GM never answers, unblock after 60s (prevents permanent soft-lock)
      setTimeout(() => {
        try {
          const $r = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
          if (!$r?.length) return;
          // Only unblock if still pending
          const needA = !!app._comaNeedArtifacts;
          const needN = !!app._comaNeedNormal;
          const okA = !needA || !!app._comaArtifactsApproved;
          const okN = !needN || !!app._comaNormalApproved;
          if (!(okA && okN)) {
            ui.notifications?.warn?.("GM approval timeout. Unblocking roll.");
            app._comaArtifactsApproved = true;
            app._comaNormalApproved = true;
            ensureConfirmBlocker($r, false);
          }
        } catch (_) {}
      }, 60000);
    }
  } catch (e) {
    console.error(`${MODULE_ID} | renderRollDialog approval hook failed`, e);
  }
});

/* =====================================================================================
 * CLEAR ARTIFACT SELECTION AFTER CONFIRM (DEFERRED + ON CLOSE)
 * (keeps your existing behavior)
 * ===================================================================================== */
Hooks.on("renderRollDialog", async (app, html) => {
  try {
    const $root =
      html?.jquery ? html :
      html ? $(html) :
      app?.element ? (app.element.jquery ? app.element : $(app.element)) :
      null;
    if (!$root || !$root.length) return;

    const actor =
      app.actor ??
      app.options?.actor ??
      (app.options?.actorId ? game.actors.get(app.options.actorId) : null) ??
      game.user.character;
    if (!actor) return;

    app._comArtifactsActorId = actor.id;
    app._comArtifactsConfirmed = false;

    const $confirmBtn =
      $root.find("button.dialog-button")
        .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
        .first();

    if ($confirmBtn?.length) {
      $confirmBtn.off("click.comArtifactsClearOnConfirm").on("click.comArtifactsClearOnConfirm", () => {
        app._comArtifactsConfirmed = true;

        setTimeout(() => { try { clearSelAndUnhighlight(actor.id); } catch (_) {} }, 0);
        setTimeout(() => { try { clearSelAndUnhighlight(actor.id); } catch (_) {} }, 250);
      });
    }
  } catch (e) {
    console.error(`${MODULE_ID} | renderRollDialog clear-on-confirm failed`, e);
  }
});

/* =====================================================================================
 * CLEANUP
 * ===================================================================================== */
Hooks.on("closeApplication", (app) => {
  try {
    if (app?._comaRequestId) globalThis._comaOpenRollDialogs.delete(app._comaRequestId);

    if (app?._comArtifactsConfirmed && app?._comArtifactsActorId) {
      try { clearSelAndUnhighlight(app._comArtifactsActorId); } catch (_) {}
    }
  } catch (_) {}
});
