/* =====================================================================================
 * com-artifacts — Foundry v13 — SINGLE FILE (paste-ready)
 * Goal: NO CoM review hooks. Independent GM approval window + hotbar macro + auto-pop.
 * Player Confirm is blocked until GM approves.
 * ===================================================================================== */

const MODULE_ID = "com-artifacts";
const COMA_SOCKET = `module.${MODULE_ID}`;

globalThis._comaOpenRollDialogs ??= new Map();          // requestId -> player RollDialog app
globalThis._comaGMRequests ??= new Map();              // requestId -> request payload (GM)
globalThis._comaGMApp ??= null;

function comaLog(...a) { console.log(`${MODULE_ID} |`, ...a); }
function esc(s) { return Handlebars.escapeExpression(String(s ?? "")); }

/* =====================================================================================
 * STORAGE (Artifacts)
 * ===================================================================================== */
function defaultArtifacts() {
  return [
    { name: "Artifact 1", img: "", power: [{ name: "" }, { name: "" }], weakness: { name: "" } },
    { name: "Artifact 2", img: "", power: [{ name: "" }, { name: "" }], weakness: { name: "" } }
  ];
}

async function getArtifacts(actor) {
  const data = (await actor.getFlag(MODULE_ID, "artifacts")) ?? defaultArtifacts();
  if (!Array.isArray(data) || data.length !== 2) return defaultArtifacts();
  return data;
}

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

function clearSelAndUnhighlight(actorId) {
  try {
    globalThis.comArtifactsSelection.delete(actorId);
    scheduleSaveSelection(actorId);

    const actor = game.actors.get(actorId);
    const sheet = actor?.sheet;
    if (sheet?.rendered && sheet?.element) {
      const $el = sheet.element.jquery ? sheet.element : $(sheet.element);
      $el.find(".com-tag-pick.com-picked").removeClass("com-picked");
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | clearSelAndUnhighlight failed`, e);
  }
}

/* =====================================================================================
 * ROLLDIALOG HELPERS
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
  const $cand = $root
    .find('input[type="number"], input[type="text"]')
    .filter((_, i) => i.offsetParent !== null)
    .first();
  return $cand.length ? $cand : null;
}

function buildArtifactEntries(artifacts, selSet) {
  const out = [];
  for (let a = 0; a < 2; a++) {
    const art = artifacts[a] ?? {};
    const p0 = (art.power?.[0]?.name ?? "").trim();
    const p1 = (art.power?.[1]?.name ?? "").trim();
    const w  = (art.weakness?.name ?? "").trim();

    if (selSet.has(`a${a}.p0`) && p0) out.push({ kind: "artifact-power", artifactIdx: a, label: p0, mod: +1, checked: true });
    if (selSet.has(`a${a}.p1`) && p1) out.push({ kind: "artifact-power", artifactIdx: a, label: p1, mod: +1, checked: true });

    // weakness exists but default unchecked unless player explicitly selected it
    if (w) out.push({ kind: "artifact-weak", artifactIdx: a, label: w, mod: -1, checked: selSet.has(`a${a}.w`) });
  }
  return out;
}

/**
 * Optional “normal tags” sniffing.
 * This is deliberately conservative: if it finds nothing, GM normal review just won’t be used.
 * It does NOT hook CoM review system.
 */
function scanNormalTagsFromRollDialog($root) {
  try {
    const out = [];
    const $rows = $root.find(".tag-name-block.tag, .tag-name-block.story-tag, .tag-name-block").filter((_, el) => el.offsetParent !== null);
    if (!$rows.length) return out;

    $rows.each((i, el) => {
      const name = ($(el).find(".flex-tag-name, .tag-name, .name").text() || el.textContent || "").trim();
      if (!name) return;
      const hasWeak = $(el).find(".fa-angle-double-down").length > 0;
      const mod = hasWeak ? -1 : +1;
      out.push({ label: name, mod, checked: true });
    });

    const seen = new Set();
    return out.filter(e => (seen.has(e.label) ? false : (seen.add(e.label), true)));
  } catch (_) {
    return [];
  }
}

/* =====================================================================================
 * PLAYER CONFIRM BLOCK / UNBLOCK
 * ===================================================================================== */
function ensureBlockerStyles() {
  if (document.getElementById("coma-blocker-style")) return;
  const s = document.createElement("style");
  s.id = "coma-blocker-style";
  s.textContent = `
    .coma-confirm-blocker{
      position:absolute; inset:0;
      background:rgba(140,140,140,.35);
      border-radius:6px;
      cursor:not-allowed;
      display:flex;
      align-items:center;
      justify-content:center;
      pointer-events:auto;
      z-index:10;
    }
    .coma-confirm-blocker .inner{
      background:rgba(255,255,255,.70);
      padding:4px 8px;
      border-radius:6px;
      font-size:12px;
      opacity:.95;
      user-select:none;
    }
    .coma-waitline{
      margin-top:8px;
      opacity:.85;
      font-size:12px;
    }
  `;
  document.head.appendChild(s);
}

function blockConfirm(app, $root) {
  ensureBlockerStyles();
  const $confirmBtn =
    $root.find("button.dialog-button")
      .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
      .first();

  if (!$confirmBtn.length) return;

  const $wrap = $confirmBtn.parent();
  $wrap.css("position", "relative");
  if ($wrap.find(".coma-confirm-blocker").length) return;

  $wrap.append(`
    <div class="coma-confirm-blocker">
      <div class="inner">Waiting for GM approval…</div>
    </div>
  `);

  if (!$root.find(".coma-waitline").length) {
    $root.find("form").first().append(`<div class="coma-waitline"><strong>Waiting for GM approval…</strong></div>`);
  }

  app._comaConfirmBlocked = true;
}

function unblockConfirm(app) {
  try {
    const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
    if (!$root?.length) return;
    $root.find(".coma-confirm-blocker").remove();
    $root.find(".coma-waitline").remove();
    app._comaConfirmBlocked = false;
  } catch (_) {}
}

/* =====================================================================================
 * GM APPROVAL APP (independent window; no CoM dependencies)
 * ===================================================================================== */
class ComaGMApprovalApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "coma-gm-approvals",
      title: "Pending Roll Approvals",
      width: 460,
      height: "auto",
      resizable: true
    });
  }

  async _renderInner() {
    const reqs = Array.from(globalThis._comaGMRequests.values())
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    if (!reqs.length) {
      return `<div style="padding:10px; opacity:.85;">No pending approvals.</div>`;
    }

    const cards = reqs.map(r => {
      const art = Array.isArray(r.artifactEntries) ? r.artifactEntries : [];
      const norm = Array.isArray(r.normalEntries) ? r.normalEntries : [];

      // group artifacts by artifactIdx so GM can add weakness easily
      const powerArtifacts = new Set(art.filter(e => e.kind === "artifact-power" && e.checked).map(e => Number(e.artifactIdx)));
      const weaknessOptions = (r.artifactsMeta ?? [])
        .filter(m => powerArtifacts.has(Number(m.artifactIdx)) && (m.weaknessLabel ?? "").trim())
        .map(m => `
          <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
            <input type="checkbox" class="coma-gm-add-weak" data-req="${esc(r.requestId)}" data-artifact-idx="${Number(m.artifactIdx)}">
            <span><strong>Add weakness:</strong> ${esc(m.weaknessLabel)}</span>
            <span style="margin-left:auto; opacity:.8;">-1</span>
          </label>
        `).join("");

      return `
        <section class="coma-card" style="border:1px solid var(--color-border-light-primary); border-radius:8px; padding:10px; margin:10px;">
          <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
            <div style="opacity:.9;">
              <div><strong>Player:</strong> ${esc(r.fromUserName)}</div>
              <div><strong>Actor:</strong> ${esc(r.actorName)}</div>
            </div>
            <div style="opacity:.7; font-size:12px; white-space:nowrap;">${esc(r.requestId)}</div>
          </div>

          <div style="margin-top:10px;">
            <fieldset style="padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px;">
              <legend>Artifacts</legend>
              <div style="display:flex; flex-direction:column; gap:6px; max-height:220px; overflow:auto;">
                ${
                  art.length
                    ? art.map((e, idx) => `
                      <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox"
                               class="coma-gm-art"
                               data-req="${esc(r.requestId)}"
                               data-idx="${idx}"
                               ${e.checked ? "checked" : ""}>
                        <span>${esc(e.label)}</span>
                        <span style="margin-left:auto; opacity:.8;">${Number(e.mod) > 0 ? "+1" : "-1"}</span>
                      </label>
                    `).join("")
                    : `<div style="opacity:.75;">(no artifacts)</div>`
                }
              </div>

              ${weaknessOptions ? `<hr style="opacity:.35; margin:8px 0;">${weaknessOptions}` : ``}
            </fieldset>

            <fieldset style="padding:8px; border:1px solid var(--color-border-light-primary); border-radius:6px; margin-top:10px;">
              <legend>Normal Tags</legend>
              <div style="display:flex; flex-direction:column; gap:6px; max-height:180px; overflow:auto;">
                ${
                  norm.length
                    ? norm.map((e, idx) => `
                      <label style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox"
                               class="coma-gm-norm"
                               data-req="${esc(r.requestId)}"
                               data-idx="${idx}"
                               ${e.checked ? "checked" : ""}>
                        <span>${esc(e.label)}</span>
                        <span style="margin-left:auto; opacity:.8;">${Number(e.mod) > 0 ? "+1" : "-1"}</span>
                      </label>
                    `).join("")
                    : `<div style="opacity:.75;">(no normal tags detected)</div>`
                }
              </div>
            </fieldset>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
            <button type="button" class="coma-gm-reject" data-req="${esc(r.requestId)}">Reject</button>
            <button type="button" class="coma-gm-approve" data-req="${esc(r.requestId)}">Approve</button>
          </div>
        </section>
      `;
    }).join("");

    return `<div>${cards}</div>`;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.off("click.comaApprove").on("click.comaApprove", ".coma-gm-approve", async (ev) => {
      ev.preventDefault();
      const requestId = ev.currentTarget.dataset.req;
      const r = globalThis._comaGMRequests.get(requestId);
      if (!r) return;

      // read artifact toggles
      const art = (r.artifactEntries ?? []).map(e => ({ ...e }));
      html.find(`input.coma-gm-art[data-req="${CSS.escape(requestId)}"]`).each((_, el) => {
        const idx = Number(el.dataset.idx);
        if (!Number.isFinite(idx) || !art[idx]) return;
        art[idx].checked = !!el.checked;
      });

      // apply “add weakness” selections: turn on the corresponding weakness entry (if exists)
      const addWeak = [];
      html.find(`input.coma-gm-add-weak[data-req="${CSS.escape(requestId)}"]`).each((_, el) => {
        if (el.checked) addWeak.push(Number(el.dataset.artifactIdx));
      });
      if (addWeak.length) {
        for (const aIdx of addWeak) {
          const wIdx = art.findIndex(x => x.kind === "artifact-weak" && Number(x.artifactIdx) === Number(aIdx));
          if (wIdx >= 0) art[wIdx].checked = true;
        }
      }

      // read normal toggles
      const norm = (r.normalEntries ?? []).map(e => ({ ...e }));
      html.find(`input.coma-gm-norm[data-req="${CSS.escape(requestId)}"]`).each((_, el) => {
        const idx = Number(el.dataset.idx);
        if (!Number.isFinite(idx) || !norm[idx]) return;
        norm[idx].checked = !!el.checked;
      });

      game.socket.emit(COMA_SOCKET, {
        type: "coma-gate-result",
        requestId,
        toUserId: r.fromUserId,
        actorId: r.actorId,
        approved: true,
        artifactEntries: art,
        normalEntries: norm
      });

      globalThis._comaGMRequests.delete(requestId);
      this.render(false);
    });

    html.off("click.comaReject").on("click.comaReject", ".coma-gm-reject", async (ev) => {
      ev.preventDefault();
      const requestId = ev.currentTarget.dataset.req;
      const r = globalThis._comaGMRequests.get(requestId);
      if (!r) return;

      game.socket.emit(COMA_SOCKET, {
        type: "coma-gate-result",
        requestId,
        toUserId: r.fromUserId,
        actorId: r.actorId,
        approved: false,
        artifactEntries: [],
        normalEntries: []
      });

      globalThis._comaGMRequests.delete(requestId);
      this.render(false);
    });
  }
}

function openGMApprovals() {
  if (!game.user?.isGM) return ui.notifications?.warn?.("GM only.");
  if (!globalThis._comaGMApp) globalThis._comaGMApp = new ComaGMApprovalApp();
  globalThis._comaGMApp.render(true);
}

/* =====================================================================================
 * SOCKET HANDLERS
 * ===================================================================================== */
Hooks.once("ready", async () => {
  game.socket.on(COMA_SOCKET, (msg) => {
    try {
      if (!msg?.type) return;

      // GM receives a gate request -> store -> auto-open approvals window
      if (msg.type === "coma-gate-request" && game.user.isGM) {
        const requestId = String(msg.requestId ?? "");
        if (!requestId) return;

        globalThis._comaGMRequests.set(requestId, {
          ...msg,
          requestId,
          createdAt: Date.now()
        });

        // auto-pop
        try { openGMApprovals(); } catch (_) {}
        return;
      }

      // Player receives GM decision -> apply -> unblock confirm
      if (msg.type === "coma-gate-result" && msg.toUserId === game.user.id) {
        const app = globalThis._comaOpenRollDialogs.get(msg.requestId);
        if (!app) return;

        app._comaGateApproved = !!msg.approved;

        // If rejected: keep blocked, show message
        if (!msg.approved) {
          try {
            const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
            $root?.find?.(".coma-waitline")?.html?.(`<strong>GM rejected.</strong> Close and try again.`);
          } catch (_) {}
          return;
        }

        // If we injected artifact checkboxes, apply GM toggles to them
        try {
          const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
          const $panel = $root?.find?.(".com-artifacts-roll");
          if ($panel?.length) {
            const inputs = $panel.find("input.com-approve").toArray();
            const toggles = Array.isArray(msg.artifactEntries) ? msg.artifactEntries : [];

            // Our inputs are in the same order we built; update by data-idx
            for (let i = 0; i < inputs.length; i++) {
              const el = inputs[i];
              const t = toggles[i];
              if (!t) continue;
              const changed = el.checked !== !!t.checked;
              el.checked = !!t.checked;
              if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
            }

            // recompute
            try { app._comArtifactsRecompute?.(); } catch (_) {}
          }
        } catch (_) {}

        // unblock
        unblockConfirm(app);
        app._comaGateDone = true;

        return;
      }

    } catch (e) {
      console.warn(`${MODULE_ID} | socket handler error`, e);
    }
  });

  // expose macro function
  game.comaOpenApprovals = openGMApprovals;

  // Create and assign hotbar macro (GM only)
  if (game.user?.isGM) {
    try {
      const name = "GM Approvals (com-artifacts)";
      let macro = game.macros?.find(m => m.name === name);
      if (!macro) {
        macro = await Macro.create({
          name,
          type: "script",
          scope: "global",
          command: `game.comaOpenApprovals?.();`
        });
      }

      // find empty hotbar slot 1-10
      let slot = null;
      for (let i = 1; i <= 10; i++) {
        const existing = game.user.hotbar?.[i];
        if (!existing) { slot = i; break; }
      }
      if (!slot) slot = 10;

      await game.user.assignHotbarMacro(macro, slot);
      comaLog(`Hotbar macro ready in slot ${slot}`);
    } catch (e) {
      console.warn(`${MODULE_ID} | macro assign failed`, e);
    }
  }
});

/* =====================================================================================
 * ROLLDIALOG INJECTION + GATE (player Confirm sends request, then blocks)
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

    // avoid double inject
    if ($root.find(".com-artifacts-roll").length) {
      // still ensure confirm hook exists
    }

    const $modInput = findCustomModifierInput($root);
    if (!$modInput || !$modInput.length) return;

    if (!Number.isFinite(app._comArtifactsBaseMod)) {
      const base = Number($modInput.val() ?? 0);
      app._comArtifactsBaseMod = Number.isFinite(base) ? base : 0;
    }

    // inject artifacts panel if not present
    if ($root.find(".com-artifacts-roll").length === 0) {
      const artifacts = await getArtifacts(actor);
      const sel = getSel(actor.id);
      const entries = buildArtifactEntries(artifacts, sel);

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
                    <input type="checkbox" class="com-approve" data-mod="${e.mod}" ${e.checked ? "checked" : ""} />
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
        $panel.find("input.com-approve:checked").each((_, el) => { mod += Number(el.dataset.mod ?? 0); });
        $panel.find(".com-artifacts-mod").text(`${mod >= 0 ? "+" : ""}${mod}`);
        $modInput.val((app._comArtifactsBaseMod ?? 0) + mod);
        $modInput.trigger("input");
        $modInput.trigger("change");
      }

      app._comArtifactsRecompute = recomputeAndApply;
      recomputeAndApply();
      $panel.on("change", "input.com-approve", recomputeAndApply);
    }

    // Confirm gating (player only)
    if (!game.user.isGM) {
      if (!app._comaRequestId) app._comaRequestId = foundry.utils.randomID();

      globalThis._comaOpenRollDialogs.set(app._comaRequestId, app);

      const $confirmBtn =
        $root.find("button.dialog-button")
          .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
          .first();

      if ($confirmBtn?.length) {
        $confirmBtn.off("click.comaGate").on("click.comaGate", async (ev) => {
          // If already approved, let it pass
          if (app._comaGateDone && app._comaGateApproved) return;

          // Prevent roll until GM approves
          ev.preventDefault();
          ev.stopPropagation();

          // If already pending, just keep blocked
          if (app._comaGatePending) {
            blockConfirm(app, $root);
            return false;
          }

          app._comaGatePending = true;
          blockConfirm(app, $root);

          // Build request payload
          const artifacts = await getArtifacts(actor);
          const sel = getSel(actor.id);
          const artifactEntries = buildArtifactEntries(artifacts, sel);

          // include meta so GM can “add weakness for used artifact”
          const artifactsMeta = [0, 1].map(aIdx => ({
            artifactIdx: aIdx,
            weaknessLabel: (artifacts?.[aIdx]?.weakness?.name ?? "").trim()
          }));

          // optional normal tags scan
          const normalEntries = scanNormalTagsFromRollDialog($root);

          game.socket.emit(COMA_SOCKET, {
            type: "coma-gate-request",
            requestId: app._comaRequestId,
            fromUserId: game.user.id,
            fromUserName: game.user.name,
            actorId: actor.id,
            actorName: actor.name,
            artifactEntries,
            artifactsMeta,
            normalEntries
          });

          return false;
        });
      }
    }

    // Clear selection after confirm (still useful)
    app._comArtifactsActorId = actor.id;
    app._comArtifactsConfirmed = false;

    const $confirmBtn2 =
      $root.find("button.dialog-button")
        .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
        .first();

    if ($confirmBtn2?.length) {
      $confirmBtn2.off("click.comArtifactsClearOnConfirm").on("click.comArtifactsClearOnConfirm", () => {
        // only clear if GM approved and player can actually roll
        if (!(app._comaGateDone && app._comaGateApproved)) return;

        app._comArtifactsConfirmed = true;
        setTimeout(() => { try { clearSelAndUnhighlight(actor.id); } catch (_) {} }, 0);
        setTimeout(() => { try { clearSelAndUnhighlight(actor.id); } catch (_) {} }, 250);
      });
    }

  } catch (e) {
    console.error(`${MODULE_ID} | renderRollDialog failed`, e);
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
