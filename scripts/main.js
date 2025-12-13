const MODULE_ID = "com-artifacts";

/* =====================================================================================
 * SOCKET + APPROVAL PATH (chat-based GM approval)
 * ===================================================================================== */
const COMA_SOCKET = `module.${MODULE_ID}`;
globalThis._comaOpenRollDialogs ??= new Map(); // requestId -> RollDialog app
globalThis._comaPendingExec ??= new Map();     // userId -> { requestId, actorId, ts }

function comaLog(...a) { console.log(`${MODULE_ID} |`, ...a); }
function comaWarn(...a) { console.warn(`${MODULE_ID} |`, ...a); }

function comaNow() { return Date.now(); }
function comaRand() { return (foundry?.utils?.randomID?.() ?? randomID()); }

function comaGetGMIds() {
  const gms = (game.users ?? []).filter(u => u.isGM);
  return gms.map(u => u.id);
}

function comaWhisperToGMsData() {
  return { whisper: comaGetGMIds() };
}

/** Build the GM chat card HTML. */
function comaBuildGMChatContent({ requestId, fromUserName, actorName, entries }) {
  const safe = (s) => Handlebars.escapeExpression(String(s ?? ""));
  const rows = (entries?.length ? entries : []).map((e) => {
    const idx = Number(e.idx);
    const mod = Number(e.mod ?? 0);
    const sign = mod > 0 ? "+1" : "-1";
    return `
      <label style="display:flex; align-items:center; gap:8px; margin:4px 0;">
        <input type="checkbox" class="coma-approve" data-idx="${idx}" ${e.checked ? "checked" : ""}/>
        <span>${safe(e.label ?? "")}</span>
        <span style="margin-left:auto; opacity:.8;">${sign}</span>
      </label>
    `;
  }).join("");

  return `
    <div class="coma-approval-card" data-request-id="${safe(requestId)}" style="display:flex; flex-direction:column; gap:8px;">
      <div style="opacity:.9;">
        <div><strong>From:</strong> ${safe(fromUserName)}</div>
        <div><strong>Actor:</strong> ${safe(actorName)}</div>
      </div>

      <fieldset style="padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
        <legend>Artifacts (Approval)</legend>
        <div style="display:flex; flex-direction:column; gap:2px; max-height:260px; overflow:auto;">
          ${rows || `<div style="opacity:.8;">No artifact tags selected.</div>`}
        </div>
      </fieldset>

      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button type="button" class="coma-approve-btn" data-request-id="${safe(requestId)}">
          Approve
        </button>
      </div>

      <div style="opacity:.75; font-size:12px;">
        Tip: uncheck any tags you don't allow, then click Approve.
      </div>
    </div>
  `;
}

/** Send GM approval request as a GM-only chat message. */
async function comaSendGMApprovalChat({ requestId, fromUserId, fromUserName, actorId, actorName, entries }) {
  try {
    // Store payload on the message flags so the GM can approve even if HTML changes.
    const flags = {
      [MODULE_ID]: {
        type: "coma-approval",
        requestId,
        fromUserId,
        actorId,
        actorName,
        entries: Array.isArray(entries) ? entries : []
      }
    };

    const content = comaBuildGMChatContent({
      requestId,
      fromUserName,
      actorName,
      entries
    });

    await ChatMessage.create({
      content,
      speaker: { alias: "GM Approval" },
      ...comaWhisperToGMsData(),
      flags
    });
  } catch (e) {
    comaWarn("Failed to send GM approval chat message", e);
  }
}

/** Find a RollDialog confirm button inside a root. */
function comaFindConfirmButton($root) {
  return $root.find("button.dialog-button")
    .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
    .first();
}

/** Create/refresh the gray blocker overlay above the Confirm button. */
function comaBlockConfirm(app, $root, label = "Waiting for GM approval...") {
  try {
    const $btn = comaFindConfirmButton($root);
    if (!$btn?.length) return;

    // Disable actual button too (overlay is visual + catches clicks).
    $btn.prop("disabled", true);

    const $container = $btn.closest(".dialog-buttons");
    if (!$container.length) return;

    $container.css("position", "relative");

    let $overlay = $container.find(".coma-confirm-overlay");
    if (!$overlay.length) {
      $overlay = $(`<div class="coma-confirm-overlay"></div>`);
      $container.append($overlay);
    }

    const contRect = $container[0].getBoundingClientRect();
    const btnRect = $btn[0].getBoundingClientRect();

    const left = Math.max(0, btnRect.left - contRect.left);
    const top  = Math.max(0, btnRect.top  - contRect.top);

    $overlay.css({
      position: "absolute",
      left: `${left}px`,
      top: `${top}px`,
      width: `${btnRect.width}px`,
      height: `${btnRect.height}px`,
      background: "rgba(160,160,160,0.45)",
      borderRadius: "6px",
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "auto",
      userSelect: "none",
      fontSize: "12px",
      fontWeight: "600",
      color: "rgba(0,0,0,0.75)"
    }).text(label);

    app._comaConfirmBlocked = true;
    app._comaConfirmOverlayMounted = true;
  } catch (e) {
    comaWarn("comaBlockConfirm failed", e);
  }
}

/** Remove the confirm blocker overlay and re-enable Confirm. */
function comaUnblockConfirm(app, $root) {
  try {
    // Re-enable the confirm button if we can find it
    const $btn = comaFindConfirmButton($root);
    if ($btn?.length) $btn.prop("disabled", false);

    // Remove overlays wherever they are inside this dialog
    $root.find(".coma-confirm-overlay").remove();

    app._comaConfirmBlocked = false;
  } catch (e) {
    comaWarn("comaUnblockConfirm failed", e);
  }
}

/** Apply GM toggles to the player's artifacts panel checkboxes. */
function comaApplyTogglesToRollDialog(app, toggles) {
  const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
  if (!$root?.length) return;

  const $panel = $root.find(".com-artifacts-roll");
  if (!$panel.length) return;

  const inputs = $panel.find("input.com-approve").toArray();
  for (const t of (toggles ?? [])) {
    const idx = Number(t.idx);
    const el = inputs[idx];
    if (!el) continue;

    const newChecked = !!t.checked;
    const changed = el.checked !== newChecked;
    el.checked = newChecked;

    if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (typeof app._comArtifactsRecompute === "function") {
    try { app._comArtifactsRecompute(); } catch (_) {}
  }
}

/** Fallback: find the open RollDialog even if the map lost it. */
function comaFindOpenRollDialogByRequestId(requestId) {
  try {
    const fromMap = globalThis._comaOpenRollDialogs?.get?.(requestId);
    if (fromMap) return fromMap;

    const wins = Object.values(ui?.windows ?? {});
    for (const w of wins) {
      if (!w) continue;

      const isRollDialog =
        w.constructor?.name === "RollDialog" ||
        w.options?.template?.includes("roll-dialog") ||
        w.options?.id?.toLowerCase?.().includes("roll");

      if (!isRollDialog) continue;
      if (w._comaRequestId === requestId) return w;
    }
    return null;
  } catch (e) {
    comaWarn("comaFindOpenRollDialogByRequestId failed", e);
    return null;
  }
}

/* =====================================================================================
 * READY: socket receive + chat approve button wiring
 * ===================================================================================== */
Hooks.once("ready", () => {
  comaLog("READY", { user: game.user?.name, isGM: game.user?.isGM });

  // Socket handler: apply result to player dialog, unblock confirm.
  game.socket.on(COMA_SOCKET, (msg) => {
    try {
      if (!msg?.type) return;

      if (msg.type === "coma-mirror-result" && msg.toUserId === game.user.id) {
        const app = comaFindOpenRollDialogByRequestId(msg.requestId);
        if (!app) {
          comaWarn("No RollDialog found to unblock for requestId", msg.requestId);
          return;
        }

        // Apply check toggles (keep current behavior)
        comaApplyTogglesToRollDialog(app, msg.toggles);

        // Unblock confirm overlay + button
        const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
        if ($root?.length) {
          comaUnblockConfirm(app, $root);
          app._comaGateApproved = true;
        } else {
          comaWarn("RollDialog found but has no root element yet for requestId", msg.requestId);
        }
      }
    } catch (e) {
      comaWarn("socket handler error", e);
    }
  });
});

/**
 * Foundry v13+: renderChatMessageHTML provides HTMLElement (not jQuery).
 * We attach click handlers for GM approval buttons inside chat cards.
 */
Hooks.on("renderChatMessageHTML", (message, htmlEl) => {
  try {
    if (!game.user.isGM) return;
    if (!(htmlEl instanceof HTMLElement)) return;

    const flags = message?.flags?.[MODULE_ID];
    if (!flags || flags.type !== "coma-approval") return;

    const card = htmlEl.querySelector(`.coma-approval-card[data-request-id="${CSS.escape(flags.requestId)}"]`);
    if (!card) return;

    // Avoid double-binding
    if (card.dataset._comaBound === "1") return;
    card.dataset._comaBound = "1";

    const btn = card.querySelector(".coma-approve-btn");
    if (!btn) return;

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const requestId = flags.requestId;
      const fromUserId = flags.fromUserId;

      // Canonical list from flags
      const entries = Array.isArray(flags.entries) ? flags.entries : [];

      // Read checkbox states from rendered HTML
      const checks = Array.from(card.querySelectorAll("input.coma-approve[data-idx]"));
      const toggles = entries.map((e) => {
        const idx = Number(e.idx);
        const c = checks.find(x => Number(x.getAttribute("data-idx")) === idx);
        return { ...e, checked: c ? c.checked : !!e.checked };
      });

      // Send result to player via socket
      game.socket.emit(COMA_SOCKET, {
        type: "coma-mirror-result",
        requestId,
        toUserId: fromUserId,
        toggles
      });

      // Visual mark
      try {
        btn.disabled = true;
        btn.textContent = "Approved";
      } catch (_) {}
    });
  } catch (e) {
    comaWarn("renderChatMessageHTML hook error", e);
  }
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
    comaWarn("failed to read selection flag", e);
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
      comaWarn("failed to save selection flag", e);
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
      $el.find(".com-tag-pill.com-picked").removeClass("com-picked");
      $el.find(".com-tag-pick.com-picked").removeClass("com-picked");
    }
  } catch (e) {
    comaWarn("clearSelAndUnhighlight failed", e);
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
 * LOCK DETECTION
 * ===================================================================================== */
function isSheetUnlocked(html) {
  const ref = html
    .find(`.sheet-body .tab:not([data-tab="${MODULE_ID}"]) input, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) textarea, .sheet-body .tab:not([data-tab="${MODULE_ID}"]) select`)
    .filter((_, el) => el.offsetParent !== null);

  if (ref.length) return ref.toArray().some(el => !el.disabled);
  return true;
}

/* =====================================================================================
 * SHEET UI: ARTIFACTS TAB (NO REFRESH when entering edit; only save on exit)
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

      .com-edit-fields input:focus, .com-name-input:focus{
        outline: none;
        box-shadow: 0 0 0 2px rgba(120, 80, 160, .25);
      }

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

  // Optional: if they click the sheet lock button, re-render so edit buttons enable/disable correctly.
  try {
    if (!app._comArtifactsLockHooked) {
      app._comArtifactsLockHooked = true;
      html.off("click.comArtifactsLock").on("click.comArtifactsLock", "a.sheet-lock-button", () => {
        setTimeout(() => { try { app.render(false); } catch (_) {} }, 0);
      });
    }
  } catch (_) {}

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);
    const sheetUnlocked = isSheetUnlocked(html);

    const pill = (key, txt, isWeak, iconClass) => `
      <div class="com-tag-pill ${isWeak ? "com-weak" : ""}" data-pick="${key}">
        <i class="fas ${iconClass}"></i>
        <span class="com-pill-text">${Handlebars.escapeExpression(txt)}</span>
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
              <div class="com-name-display com-name-text">${Handlebars.escapeExpression(nameDisplay)}</div>
            </div>

            <div class="com-edit-only">
              <input class="com-name-input" type="text" data-field="name" value="${Handlebars.escapeExpression(a.name ?? "")}">
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
                  <input type="text" data-field="power.0.name" value="${Handlebars.escapeExpression(p0)}">
                  <label>Power Tag 2</label>
                  <input type="text" data-field="power.1.name" value="${Handlebars.escapeExpression(p1)}">
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
                  <input type="text" data-field="weakness.name" value="${Handlebars.escapeExpression(w)}">
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

    // Ensure all cards start NOT editing
    grid.find(".com-artifact").each((_, el) => setCardEditing($(el), false));

    // View mode: click to select/deselect (blocked in edit mode)
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pill", (ev) => {
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      if ($sec.hasClass("com-editing")) return;

      const key = ev.currentTarget.dataset.pick;
      const set = toggleSel(actor.id, key);
      $(ev.currentTarget).toggleClass("com-picked", set.has(key));
    });

    // Edit toggle: enter edit mode (no refresh), exit saves (no refresh)
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

      const s = getSel(actor.id);
      $sec.find(".com-tag-pill").each((_, el2) => {
        const key = el2.dataset.pick;
        $(el2).toggleClass("com-picked", s.has(key));
      });

      setCardEditing($sec, false);
      forceActivateTab(app, app._comLastTab || MODULE_ID);
    });

    // Image pick only in edit mode + unlocked (no refresh)
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

    // =====================================================================
    // EXECUTE MOVE HOOK (mark next RollDialog for approval)
    // =====================================================================
    if (!app._comaExecuteHooked) {
      app._comaExecuteHooked = true;

      $html.off("click.comaExecute").on("click.comaExecute", "button.execute-move-button", (ev) => {
        try {
          if (game.user.isGM) return; // only gate players
          const requestId = comaRand();

          globalThis._comaPendingExec.set(game.user.id, {
            requestId,
            actorId: actor.id,
            ts: comaNow()
          });

          // Debug (you used this): send "test"
          ChatMessage.create({
            content: "test",
            speaker: ChatMessage.getSpeaker({ actor }),
          });

        } catch (e) {
          comaWarn("execute-move hook failed", e);
        }
      });
    }
    // =====================================================================

  } catch (e) {
    console.error(`${MODULE_ID} | renderActorSheet failed`, e);
  }
});

/* =====================================================================================
 * ROLLDIALOG INJECTION + GM APPROVAL GATE
 * ===================================================================================== */
function findCustomModifierInput($root) {
  const labels = $root.find("label").toArray();
  for (const el of labels) {
    const txt = (el.textContent ?? "").trim().toLowerCase();
    if (txt === "custom modifier") {
      const $wrap = $(el).closest("div");
      const $input = $wrap.find("input").first();
      if ($input.length) return $input;
    }
  }
  const $cand = $root.find('input[type="number"], input[type="text"]').filter((_, i) => i.offsetParent !== null).first();
  return $cand.length ? $cand : null;
}

function buildSelectedEntries(artifacts, selSet) {
  const out = [];
  for (let a = 0; a < 2; a++) {
    const art = artifacts[a];
    if (selSet.has(`a${a}.p0`) && (art.power?.[0]?.name ?? "").trim()) out.push({ label: art.power[0].name, mod: +1 });
    if (selSet.has(`a${a}.p1`) && (art.power?.[1]?.name ?? "").trim()) out.push({ label: art.power[1].name, mod: +1 });
    if (selSet.has(`a${a}.w`)  && (art.weakness?.name ?? "").trim())   out.push({ label: art.weakness.name, mod: -1 });
  }
  return out;
}

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

    // Avoid double-inject
    if ($root.find(".com-artifacts-roll").length) return;

    const $modInput = findCustomModifierInput($root);
    if (!$modInput || !$modInput.length) return;

    // Base mod per dialog instance
    if (!Number.isFinite(app._comArtifactsBaseMod)) {
      const base = Number($modInput.val() ?? 0);
      app._comArtifactsBaseMod = Number.isFinite(base) ? base : 0;
    }

    const artifacts = await getArtifacts(actor);
    const sel = getSel(actor.id);
    const entries = buildSelectedEntries(artifacts, sel);

    const $form = $root.find("form").first();
    const $mount = $form.length ? $form : $root;

    const $panel = $(`
      <fieldset class="com-artifacts-roll" style="margin-top:10px; padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
        <legend>Artifacts</legend>
        <div class="com-artifacts-approve" style="display:flex; flex-direction:column; gap:6px;">
          ${
            entries.length
              ? entries.map(e => `
                <label style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" class="com-approve" data-mod="${e.mod}" checked />
                  <span>${Handlebars.escapeExpression(e.label)}</span>
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

    // =====================================================================
    // GM APPROVAL GATE: only if player clicked EXECUTE MOVE just before this
    // =====================================================================
    if (!game.user.isGM) {
      const pending = globalThis._comaPendingExec.get(game.user.id);

      const isValidPending =
        pending &&
        pending.actorId === actor.id &&
        (comaNow() - Number(pending.ts ?? 0) < 15000);

      if (isValidPending) {
        globalThis._comaPendingExec.delete(game.user.id);

        app._comaRequestId = pending.requestId;
        globalThis._comaOpenRollDialogs.set(app._comaRequestId, app);

        comaBlockConfirm(app, $root, "Waiting for GM approval...");

        const gmEntries = entries.map((e, idx) => ({
          idx,
          label: e.label,
          mod: e.mod,
          checked: true
        }));

        await comaSendGMApprovalChat({
          requestId: app._comaRequestId,
          fromUserId: game.user.id,
          fromUserName: game.user.name,
          actorId: actor.id,
          actorName: actor.name,
          entries: gmEntries
        });
      }
    }
    // =====================================================================

    // ===== CLEAR ARTIFACT SELECTION AFTER CONFIRM (DEFERRED + CLOSE-SAFE) =====
    app._comArtifactsActorId = actor.id;
    app._comArtifactsConfirmed = false;

    const $confirmBtn = comaFindConfirmButton($root);
    if ($confirmBtn?.length) {
      $confirmBtn.off("click.comArtifactsClearOnConfirm").on("click.comArtifactsClearOnConfirm", () => {
        app._comArtifactsConfirmed = true;

        setTimeout(() => { try { clearSelAndUnhighlight(actor.id); } catch (_) {} }, 0);
        setTimeout(() => { try { clearSelAndUnhighlight(actor.id); } catch (_) {} }, 250);
      });
    }
    // ========================================================================

  } catch (e) {
    console.error(`${MODULE_ID} | renderRollDialog failed`, e);
  }
});

/* =====================================================================================
 * CLEANUP + FINAL CLEAR ON DIALOG CLOSE (only if confirmed)
 * ===================================================================================== */
Hooks.on("closeApplication", (app) => {
  try {
    if (app?._comaRequestId) globalThis._comaOpenRollDialogs.delete(app._comaRequestId);

    if (app?._comArtifactsConfirmed && app?._comArtifactsActorId) {
      try { clearSelAndUnhighlight(app._comArtifactsActorId); } catch (_) {}
    }
  } catch (_) {}
});

