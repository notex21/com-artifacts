/* =====================================================================================
 * com-artifacts (Foundry VTT v13) — single-file paste (main.js)
 * UI: per-artifact lock toggle (no sheet refresh on toggle), edit-on-demand,
 * image-click-to-pick (edit mode only), tag panels styled, selection works in view mode.
 * Roll: inject artifact approvals; GM review gate overlays Confirm until GM confirms.
 * ===================================================================================== */

const MODULE_ID = "com-artifacts";
const COMA_SOCKET = `module.${MODULE_ID}`;
globalThis._comaOpenRollDialogs ??= new Map();
globalThis._comaGMReviewAnchor ??= null;

function comaLog(...a) { console.log(`${MODULE_ID} |`, ...a); }
function esc(s) { return Handlebars.escapeExpression(String(s ?? "")); }

/* =====================================================================================
 * SOCKET: GM REVIEW + OPTIONAL MIRROR (kept safe)
 * ===================================================================================== */
Hooks.once("ready", () => {
  comaLog("READY", { user: game.user?.name, isGM: game.user?.isGM });

  game.socket.on(COMA_SOCKET, (msg) => {
    try {
      if (!msg?.type) return;

      /* ===================== GM: ARTIFACTS REVIEW (SAFE RENDER) ===================== */
      if (msg.type === "coma-approval-artifacts-request" && game.user.isGM) {
        const entries = Array.isArray(msg.entries) ? msg.entries : [];
        const artifactsMeta = Array.isArray(msg.artifactsMeta) ? msg.artifactsMeta : [];

        // If player selected any power from artifact X, GM may optionally invoke weakness X
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

        // Defer so other system errors in the same tick do not swallow this
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
                    const checks = Array.from(root?.querySelectorAll?.("input.coma-approve-art[data-idx]") ?? []);

                    const toggles = entries.map((e) => {
                      const idx = Number(e.idx);
                      const c = checks.find(x => Number(x.getAttribute("data-idx")) === idx);
                      return { ...e, checked: c ? c.checked : !!e.checked };
                    });

                    const weakChecks = Array.from(root?.querySelectorAll?.("input.coma-art-weak[data-artifact-idx]") ?? []);
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

            setTimeout(() => {
              try {
                d.bringToTop?.();
                if (d.position) globalThis._comaGMReviewAnchor = { ...d.position };
              } catch (_) {}
            }, 60);
          } catch (e) {
            console.warn(`${MODULE_ID} | GM artifacts review dialog failed`, e);
          }
        }, 0);

        return;
      }

      /* ===================== GM: NORMAL REVIEW (SAFE RENDER) ===================== */
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
                    const checks = Array.from(root?.querySelectorAll?.("input.coma-approve-norm[data-idx]") ?? []);
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
                const a = globalThis._comaGMReviewAnchor;
                if (a?.left != null && a?.top != null) {
                  d.setPosition?.({ left: a.left + (a.width ?? 380) + 10, top: a.top });
                }
              } catch (_) {}
            }, 70);

          } catch (e) {
            console.warn(`${MODULE_ID} | GM normal review dialog failed`, e);
          }
        }, 0);

        return;
      }

      /* ===================== PLAYER: APPLY ARTIFACTS REVIEW RESULT ===================== */
      if (msg.type === "coma-approval-artifacts-result" && msg.toUserId === game.user.id) {
        const app = globalThis._comaOpenRollDialogs.get(msg.requestId);
        if (!app) return;

        const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
        if (!$root?.length) return;

        const $panel = $root.find(".com-artifacts-roll");
        if (!$panel.length) return;

        const inputs = $panel.find("input.com-approve").toArray();
        for (const t of (msg.toggles ?? [])) {
          const el = inputs[Number(t.idx)];
          if (!el) continue;
          const changed = el.checked !== !!t.checked;
          el.checked = !!t.checked;
          if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // If GM invoked weakness for artifact X, enable that weakness checkbox if present
        const addWeaknessFor = Array.isArray(msg.addWeaknessFor) ? msg.addWeaknessFor : [];
        if (addWeaknessFor.length) {
          for (const artIdx of addWeaknessFor) {
            const wEl = $panel.find(`input.com-approve[data-kind="artifact-weak"][data-artifact-idx="${Number(artIdx)}"]`)[0];
            if (wEl && !wEl.checked) {
              wEl.checked = true;
              wEl.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
        }

        try { app._comArtifactsRecompute?.(); } catch (_) {}

        app._comaPendingArtifacts = false;
        tryUnblockPlayerConfirm(app);

        return;
      }

      /* ===================== PLAYER: APPLY NORMAL REVIEW RESULT ===================== */
      if (msg.type === "coma-approval-normal-result" && msg.toUserId === game.user.id) {
        const app = globalThis._comaOpenRollDialogs.get(msg.requestId);
        if (!app) return;

        // If we had a normal panel, apply toggles; otherwise just unblock.
        try {
          const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
          const $panel = $root?.find?.(".com-normal-roll");
          if ($panel?.length) {
            const inputs = $panel.find("input.com-norm-approve").toArray();
            for (const t of (msg.toggles ?? [])) {
              const el = inputs[Number(t.idx)];
              if (!el) continue;
              const changed = el.checked !== !!t.checked;
              el.checked = !!t.checked;
              if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
        } catch (_) {}

        app._comaPendingNormal = false;
        tryUnblockPlayerConfirm(app);
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

function clearSelAndUnhighlight(actorId) {
  try {
    clearSel(actorId);
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
 * STORAGE
 * ===================================================================================== */
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
 * SHEET UI: ARTIFACTS TAB (per-artifact lock button; no sheet rerender on toggle)
 * ===================================================================================== */
function ensureArtifactsTab(app, html, actor) {
  if (!actor?.testUserPermission(game.user, "OWNER")) return;

  if (!document.getElementById("com-artifacts-inline-style")) {
    const style = document.createElement("style");
    style.id = "com-artifacts-inline-style";
    style.textContent = `
      .com-artifacts-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .com-artifact { border:1px solid var(--color-border-light-primary); border-radius: 10px; padding: 10px; position:relative; overflow:hidden; }
      .com-artifact .com-topbar { display:flex; justify-content:center; margin-bottom: 6px; }
      .com-artifact .com-lock-btn {
        width: 100%;
        display:flex; align-items:center; justify-content:center;
        gap:8px;
        border:1px solid rgba(120, 80, 160, .35);
        border-radius: 8px;
        padding: 6px 8px;
        background: rgba(120, 80, 160, .06);
        cursor:pointer;
      }
      .com-artifact .com-lock-btn i { font-size: 14px; opacity:.9; }
      .com-artifact .com-lock-btn span { opacity:.85; font-size: 12px; }
      .com-artifact .com-name-display {
        text-align:center;
        color: rgba(120, 80, 160, 1);
        font-weight: 700;
        font-size: 1.5em;
        margin: 6px 0 10px 0;
        line-height: 1.1;
      }
      .com-artifact .com-name-input {
        width:100%;
        margin: 6px 0 10px 0;
      }

      .com-artifact .com-imgbox {
        width: 192px; height: 192px;
        margin: 0 auto 10px auto;
        border:1px solid rgba(120, 80, 160, .25);
        border-radius: 10px;
        background-size: cover;
        background-position: center;
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .com-artifact .com-imgbox.com-clickable { cursor:pointer; }
      .com-artifact .com-imgbox i { font-size: 42px; color: rgba(120, 80, 160, .9); }

      .com-panel {
        width: 192px;
        margin: 10px auto;
        border: 1px solid rgba(120, 80, 160, .35);
        border-radius: 10px;
        background: rgba(120, 80, 160, .06);
        padding: 8px;
        box-sizing: border-box;
      }
      .com-panel .com-panel-title { text-align:center; font-size: 12px; opacity:.8; margin-bottom: 6px; }
      .com-tagline { display:flex; align-items:center; gap:8px; padding: 6px 6px; border-radius: 8px; }
      .com-tagline:hover { background: rgba(120, 80, 160, .06); }
      .com-tagline .com-ico { width: 16px; text-align:center; opacity:.85; }
      .com-tag-pick {
        flex: 1;
        display:inline-block;
        border-radius: 8px;
        cursor:pointer;
        user-select:none;
        padding: 2px 6px;
        min-width: 0;
        overflow:hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .com-tag-pick.com-picked { background: #ffeb3b; }
      .com-tag-pick.com-weak.com-picked { background: #ffd54f; }
      .com-edit-input {
        width: 100%;
        box-sizing: border-box;
        margin: 0;
      }
      .com-hint { opacity:.75; font-size: 12px; text-align:center; margin-top: 10px; }
      .com-hidden { display:none !important; }

      /* Ensure inputs never overflow card */
      .com-artifact input, .com-artifact textarea, .com-artifact select { max-width: 100%; box-sizing: border-box; }
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

  function isArtifactEditing($section) {
    return $section.attr("data-editing") === "1";
  }

  function setArtifactEditing($section, editing) {
    $section.attr("data-editing", editing ? "1" : "0");

    // show/hide name display vs input
    $section.find(".com-name-display").toggleClass("com-hidden", editing);
    $section.find(".com-name-input").toggleClass("com-hidden", !editing);

    // show/hide tag edit inputs (but keep view tags visible always)
    $section.find("input.com-edit-input").prop("disabled", !editing).toggleClass("com-hidden", !editing);

    // image clickable only in edit
    $section.find(".com-imgbox").toggleClass("com-clickable", editing);

    // lock icon state
    const $btn = $section.find(".com-lock-btn");
    $btn.find("i").removeClass("fa-lock fa-lock-open");
    $btn.find("i").addClass(editing ? "fa-lock-open" : "fa-lock");
    $btn.find("span").text(editing ? "Done" : "Edit");

    // tag clicking allowed only when NOT editing
    $section.find(".com-tag-pick").css("pointer-events", editing ? "none" : "auto");
    $section.find(".com-tagline").css("cursor", editing ? "default" : "pointer");
  }

  async function saveSectionToFlags($section) {
    const idx = Number($section.attr("data-idx"));
    if (!Number.isFinite(idx)) return;

    const artifacts = await getArtifacts(actor);

    const nameVal = String($section.find('input.com-name-input').val() ?? "").trim();
    artifacts[idx].name = nameVal || artifacts[idx].name || `Artifact ${idx + 1}`;

    const p0 = String($section.find('input[data-field="power.0.name"]').val() ?? "").trim();
    const p1 = String($section.find('input[data-field="power.1.name"]').val() ?? "").trim();
    const w  = String($section.find('input[data-field="weakness.name"]').val() ?? "").trim();

    artifacts[idx].power ??= [{ name: "" }, { name: "" }];
    artifacts[idx].power[0] ??= { name: "" };
    artifacts[idx].power[1] ??= { name: "" };
    artifacts[idx].weakness ??= { name: "" };

    artifacts[idx].power[0].name = p0;
    artifacts[idx].power[1].name = p1;
    artifacts[idx].weakness.name = w;

    await setArtifacts(actor, artifacts);

    // update visible labels in-place (no sheet rerender)
    $section.find(".com-name-display").text(artifacts[idx].name);

    $section.find('.com-tag-pick[data-pick="a' + idx + '.p0"]').text(p0).toggleClass("com-hidden", !p0);
    $section.find('.com-tag-pick[data-pick="a' + idx + '.p1"]').text(p1).toggleClass("com-hidden", !p1);
    $section.find('.com-tag-pick[data-pick="a' + idx + '.w"]').text(w).toggleClass("com-hidden", !w);

    // keep selection highlight consistent if labels disappear
    const sel = getSel(actor.id);
    if (!p0) sel.delete(`a${idx}.p0`);
    if (!p1) sel.delete(`a${idx}.p1`);
    if (!w)  sel.delete(`a${idx}.w`);
    scheduleSaveSelection(actor.id);
  }

  (async () => {
    const artifacts = await getArtifacts(actor);
    const grid = body.find(`.tab[data-tab="${MODULE_ID}"] .com-artifacts-grid`);
    if (!grid.length) return;

    const renderSlot = (a, idx) => {
      const imgStyle = a.img ? `style="background-image:url('${String(a.img).replace(/'/g, "%27")}')"` : "";
      const p0 = (a.power?.[0]?.name ?? "").trim();
      const p1 = (a.power?.[1]?.name ?? "").trim();
      const w  = (a.weakness?.name ?? "").trim();

      return `
        <section class="com-artifact" data-idx="${idx}" data-editing="0">
          <div class="com-topbar">
            <button type="button" class="com-lock-btn">
              <i class="fas fa-lock"></i>
              <span>Edit</span>
            </button>
          </div>

          <div class="com-name-display">${esc((a.name ?? `Artifact ${idx + 1}`).trim())}</div>
          <input class="com-name-input com-hidden" type="text" value="${esc(a.name ?? "")}" />

          <div class="com-imgbox" ${imgStyle} title="Edit image">
            ${a.img ? "" : `<i class="fas fa-image"></i>`}
          </div>

          <div class="com-panel com-power">
            <div class="com-panel-title">Power Tags</div>

            <div class="com-tagline">
              <div class="com-ico"><i class="fas fa-bolt"></i></div>
              <span class="com-tag-pick ${p0 ? "" : "com-hidden"}" data-pick="a${idx}.p0">${esc(p0)}</span>
            </div>
            <input class="com-edit-input com-hidden" type="text" data-field="power.0.name" value="${esc(p0)}" />

            <div class="com-tagline">
              <div class="com-ico"><i class="fas fa-bolt"></i></div>
              <span class="com-tag-pick ${p1 ? "" : "com-hidden"}" data-pick="a${idx}.p1">${esc(p1)}</span>
            </div>
            <input class="com-edit-input com-hidden" type="text" data-field="power.1.name" value="${esc(p1)}" />
          </div>

          <div class="com-panel com-weak">
            <div class="com-panel-title">Weakness Tag</div>

            <div class="com-tagline">
              <div class="com-ico"><i class="fas fa-angle-double-down"></i></div>
              <span class="com-tag-pick com-weak ${w ? "" : "com-hidden"}" data-pick="a${idx}.w">${esc(w)}</span>
            </div>
            <input class="com-edit-input com-hidden" type="text" data-field="weakness.name" value="${esc(w)}" />
          </div>

          <div class="com-hint">Click tags to select/deselect.</div>
        </section>
      `;
    };

    grid.html(artifacts.map(renderSlot).join(""));

    // restore highlight from selection
    const s = getSel(actor.id);
    grid.find(".com-tag-pick").each((_, el) => {
      const key = el.dataset.pick;
      if (key && s.has(key)) $(el).addClass("com-picked");
    });

    // click-to-highlight (only when NOT editing)
    grid.off("click.comArtifactsPick").on("click.comArtifactsPick", ".com-tag-pick", (ev) => {
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      if (isArtifactEditing($sec)) return;

      const key = ev.currentTarget.dataset.pick;
      if (!key) return;

      // don't toggle empty labels
      const txt = ($(ev.currentTarget).text() ?? "").trim();
      if (!txt) return;

      const set = toggleSel(actor.id, key);
      $(ev.currentTarget).toggleClass("com-picked", set.has(key));
    });

    // per-artifact edit toggle (no sheet rerender on enter; save on exit)
    grid.off("click.comArtifactsLock").on("click.comArtifactsLock", ".com-lock-btn", async (ev) => {
      ev.preventDefault();
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      const editing = isArtifactEditing($sec);

      if (!editing) {
        // enter edit mode (no save, no refresh)
        setArtifactEditing($sec, true);
        return;
      }

      // exit edit mode: save to flags, then switch back
      try { await saveSectionToFlags($sec); } catch (e) { console.warn(`${MODULE_ID} | save failed`, e); }
      setArtifactEditing($sec, false);
    });

    // image click-to-pick (edit mode only)
    grid.off("click.comArtifactsImg").on("click.comArtifactsImg", ".com-imgbox", async (ev) => {
      const $sec = $(ev.currentTarget).closest(".com-artifact");
      if (!isArtifactEditing($sec)) return;

      const idx = Number($sec.attr("data-idx"));
      if (!Number.isFinite(idx)) return;

      const artifacts2 = await getArtifacts(actor);

      new FilePicker({
        type: "image",
        current: artifacts2[idx].img || "",
        callback: async (path) => {
          artifacts2[idx].img = path;
          await setArtifacts(actor, artifacts2);

          // update box immediately (no rerender)
          const $box = $sec.find(".com-imgbox");
          $box.css("background-image", `url('${String(path).replace(/'/g, "%27")}')`);
          $box.find("i.fas.fa-image").remove();
        }
      }).browse();
    });

    // Prevent Enter in text inputs from submitting/doing weird stuff
    grid.off("keydown.comArtifactsInputs").on("keydown.comArtifactsInputs", "input", (ev) => {
      if (ev.key === "Enter") ev.preventDefault();
    });
  })();
}

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app?.actor;
  if (!actor) return;

  const $html = html?.jquery ? html : $(html);
  const tab = getActiveTab($html);
  if (tab) app._comLastTab = tab;

  ensureArtifactsTab(app, $html, actor);
  forceActivateTab(app, app._comLastTab);
});

/* =====================================================================================
 * ROLLDIALOG INJECTION + GM GATE OVER CONFIRM
 * ===================================================================================== */
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

function buildSelectedEntries(artifacts, selSet) {
  const out = [];
  for (let a = 0; a < 2; a++) {
    const art = artifacts[a] ?? {};
    const p0 = (art.power?.[0]?.name ?? "").trim();
    const p1 = (art.power?.[1]?.name ?? "").trim();
    const w  = (art.weakness?.name ?? "").trim();

    if (selSet.has(`a${a}.p0`) && p0) out.push({ label: p0, mod: +1, kind: "artifact-power", artifactIdx: a });
    if (selSet.has(`a${a}.p1`) && p1) out.push({ label: p1, mod: +1, kind: "artifact-power", artifactIdx: a });

    // include weakness as an option always if it exists (unchecked by default unless selected)
    if (w) out.push({ label: w, mod: -1, kind: "artifact-weak", artifactIdx: a, autoChecked: selSet.has(`a${a}.w`) });
  }
  return out;
}

/** Create a grey overlay over the Confirm button until GM approvals are done. */
function blockPlayerConfirm(app, $root) {
  const $confirmBtn =
    $root.find("button.dialog-button")
      .filter((_, el) => ((el.textContent ?? "").trim().toLowerCase() === "confirm"))
      .first();

  if (!$confirmBtn.length) return;

  const $wrap = $confirmBtn.parent();
  $wrap.css("position", "relative");

  if ($wrap.find(".coma-confirm-blocker").length) return;

  const $block = $(`
    <div class="coma-confirm-blocker"
         style="position:absolute; inset:0; background:rgba(140,140,140,.35);
                border-radius:6px; cursor:not-allowed; display:flex;
                align-items:center; justify-content:center; pointer-events:auto; z-index:10;">
      <div style="background:rgba(255,255,255,.65); padding:4px 8px; border-radius:6px; font-size:12px; opacity:.9;">
        Waiting for GM approval…
      </div>
    </div>
  `);

  $wrap.append($block);
  app._comaConfirmBlocked = true;
}

function unblockPlayerConfirm(app) {
  try {
    const $root = app?.element ? (app.element.jquery ? app.element : $(app.element)) : null;
    if (!$root?.length) return;
    $root.find(".coma-confirm-blocker").remove();
    app._comaConfirmBlocked = false;
  } catch (_) {}
}

function tryUnblockPlayerConfirm(app) {
  const pendingA = !!app._comaPendingArtifacts;
  const pendingN = !!app._comaPendingNormal;
  if (!pendingA && !pendingN) unblockPlayerConfirm(app);
}

/** Very conservative normal-tag scan: if your system doesn't produce these, it returns []. */
function scanNormalTagsFromRollDialog($root) {
  // Try to detect any existing selected tags list in the roll dialog (system-dependent).
  // If not found, return none (no normal review).
  const out = [];
  const $rows = $root.find(".tag-name-block.tag, .tag-name-block.story-tag, .tag-name-block").filter((_, el) => el.offsetParent !== null);
  if (!$rows.length) return out;

  $rows.each((i, el) => {
    const name = ($(el).find(".flex-tag-name, .tag-name, .name").text() || el.textContent || "").trim();
    if (!name) return;
    // Guess mod from icons: bolt => +1, angle-double-down => -1; otherwise +1
    const hasWeak = $(el).find(".fa-angle-double-down").length > 0;
    const mod = hasWeak ? -1 : +1;
    out.push({ label: name, mod, checked: true });
  });

  // de-dupe
  const seen = new Set();
  return out.filter(e => (seen.has(e.label) ? false : (seen.add(e.label), true)));
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
              ? entries.map((e, idx) => `
                <label style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" class="com-approve"
                         data-idx="${idx}"
                         data-mod="${e.mod}"
                         data-kind="${esc(e.kind)}"
                         data-artifact-idx="${Number.isFinite(e.artifactIdx) ? Number(e.artifactIdx) : ""}"
                         ${e.kind === "artifact-weak" ? (e.autoChecked ? "checked" : "") : "checked"} />
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

    // ===================== GM APPROVAL GATE =====================
    // We block Confirm until GM confirms reviews (Artifacts and/or Normal).
    if (!game.user.isGM) {
      if (!app._comaRequestId) app._comaRequestId = foundry.utils.randomID();
      globalThis._comaOpenRollDialogs.set(app._comaRequestId, app);

      // Always request artifacts review if any artifact entries were present/checked
      const artReviewEntries = entries
        .map((e, idx) => ({
          idx,
          label: e.label,
          mod: e.mod,
          checked: (e.kind === "artifact-weak" ? !!e.autoChecked : true),
          kind: e.kind,
          artifactIdx: e.artifactIdx
        }))
        .filter(e => (e.label ?? "").trim());

      const artifactsMeta = [0, 1].map(aIdx => ({
        artifactIdx: aIdx,
        weaknessLabel: (artifacts?.[aIdx]?.weakness?.name ?? "").trim()
      }));

      // Normal tags: conservative scan (if none, we won't request)
      const normalScan = scanNormalTagsFromRollDialog($root);
      const wantNormal = normalScan.length > 0;

      app._comaPendingArtifacts = artReviewEntries.length > 0;
      app._comaPendingNormal = wantNormal;

      if (app._comaPendingArtifacts || app._comaPendingNormal) {
        blockPlayerConfirm(app, $root);
      }

      if (app._comaPendingArtifacts) {
        game.socket.emit(COMA_SOCKET, {
          type: "coma-approval-artifacts-request",
          requestId: app._comaRequestId,
          fromUserId: game.user.id,
          fromUserName: game.user.name,
          actorId: actor.id,
          actorName: actor.name,
          entries: artReviewEntries,
          artifactsMeta
        });
      } else {
        app._comaPendingArtifacts = false;
      }

      if (app._comaPendingNormal) {
        game.socket.emit(COMA_SOCKET, {
          type: "coma-approval-normal-request",
          requestId: app._comaRequestId,
          fromUserId: game.user.id,
          fromUserName: game.user.name,
          actorId: actor.id,
          actorName: actor.name,
          entries: normalScan.map((e, idx) => ({ idx, label: e.label, mod: e.mod, checked: true }))
        });
      } else {
        app._comaPendingNormal = false;
      }

      // If neither requested, ensure not blocked
      tryUnblockPlayerConfirm(app);
    }
    // ============================================================

    // CLEAR ARTIFACT SELECTION AFTER CONFIRM (deferred + close-safe)
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
