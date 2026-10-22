// Manages the accessible Saved Mixes side panel, animation, and storage interactions.
import { fetchSavedMixes, createSavedMix, renameSavedMix, deleteSavedMix, apiRequest } from "../api/client.js";
import { getState, setChannelVolume, setLayerVolume, saveState } from "../state/store.js";
import { openAuthModal } from "./auth.js";
import { showToast } from "./toast.js";
import { registerOverlay, openOverlay, closeOverlay } from "./overlay.js";

export function bindSavedMixes({ soundscapes, state, engine, render }) {
  const panel = document.querySelector("#mixesPanel");
  const openButton = document.querySelector("#mixesOpen");
  const closeButton = document.querySelector("#closeMixes");
  const statusMessage = document.querySelector("#mixesStatus");
  const guestView = document.querySelector("#mixesGuestView");
  const userView = document.querySelector("#mixesUserView");
  const signInButton = document.querySelector("#mixesSignInButton");
  const saveForm = document.querySelector("#saveMixForm");
  const saveNameInput = document.querySelector("#saveMixName");
  const saveSubmitButton = document.querySelector("#saveMixSubmit");
  const loadingIndicator = document.querySelector("#mixesLoading");
  const emptyIndicator = document.querySelector("#mixesEmpty");
  const errorIndicator = document.querySelector("#mixesError");
  const unavailableNotice = document.querySelector("#mixesUnavailable");
  const mixesList = document.querySelector("#mixesList");
  const mixesFilterRow = document.querySelector("#mixesFilterRow");
  const mixesFilter = document.querySelector("#mixesFilter");
  const mixesFilterClear = document.querySelector("#mixesFilterClear");

  let currentUser = null;
  let accountsAvailable = true;
  let mixes = [];
  let pendingSource = "manual";
  let activeDeleteId = null;
  let activeRenameId = null;
  let isApplying = false;
  let filterText = "";

  function announce(message) {
    if (statusMessage) statusMessage.textContent = message;
  }

  registerOverlay("mixesPanel", {
    element: panel,
    contentElement: panel.querySelector(".panel-content"),
    usesScrim: true,
    open: () => {
      panel.setAttribute("aria-hidden", "false");
    },
    close: () => {
      panel.setAttribute("aria-hidden", "true");
      activeDeleteId = null;
      activeRenameId = null;
      announce("");
    },
    trapFocus: true,
  });

  function open(initialName = "", source = "manual") {
    pendingSource = source;
    announce("");

    if (unavailableNotice) unavailableNotice.hidden = accountsAvailable;
    if (saveSubmitButton) saveSubmitButton.disabled = !accountsAvailable;

    if (currentUser) {
      guestView.hidden = true;
      userView.hidden = false;
      if (initialName) {
        saveNameInput.value = initialName;
      } else {
        saveNameInput.value = "";
      }
      if (accountsAvailable) {
        loadMixes();
      } else {
        loadingIndicator.hidden = true;
        emptyIndicator.hidden = true;
      }
    } else {
      guestView.hidden = false;
      userView.hidden = true;
    }

    const focusTarget = currentUser
      ? (initialName ? saveNameInput : closeButton)
      : signInButton;

    openOverlay("mixesPanel", {
      trigger: openButton || document.activeElement,
      focusTarget,
    });
  }

  function close() {
    closeOverlay("mixesPanel");
  }

  async function loadMixes() {
    if (!currentUser || !accountsAvailable) return;
    loadingIndicator.hidden = false;
    emptyIndicator.hidden = true;
    errorIndicator.hidden = true;
    mixesList.innerHTML = "<li class=\"mix-skeleton\"></li><li class=\"mix-skeleton\"></li><li class=\"mix-skeleton\"></li>";

    try {
      mixes = await fetchSavedMixes();
      renderList();
    } catch (error) {
      if (error.status === 401) {
        currentUser = null;
        guestView.hidden = false;
        userView.hidden = true;
        announce("Please sign in to view your saved mixes.");
        return;
      }
      if (error.status === 503) {
        accountsAvailable = false;
        if (unavailableNotice) unavailableNotice.hidden = false;
        announce("Saved mixes are temporarily unavailable.");
        return;
      }
      errorIndicator.textContent = "Unable to load saved mixes. Please try again.";
      errorIndicator.hidden = false;
      announce("Unable to load saved mixes.");
    } finally {
      loadingIndicator.hidden = true;
    }
  }

  function renderList() {
    mixesList.innerHTML = "";
    const showFilter = mixes.length > 8;
    if (mixesFilterRow) {
      mixesFilterRow.hidden = !showFilter;
    }
    if (!showFilter) {
      if (mixesFilter) mixesFilter.value = "";
      if (mixesFilterClear) mixesFilterClear.hidden = true;
      filterText = "";
    }

    if (!mixes || mixes.length === 0) {
      emptyIndicator.hidden = false;
      return;
    }
    emptyIndicator.hidden = true;

    const visibleMixes = filterText
      ? mixes.filter((mix) => mix.name.toLowerCase().includes(filterText))
      : mixes;

    visibleMixes.forEach((mix) => {
      const item = document.createElement("li");
      item.className = "mix-item";
      item.dataset.mixId = mix.id;

      const isRenaming = activeRenameId === mix.id;
      const isDeleting = activeDeleteId === mix.id;

      const formattedDate = new Date(mix.createdAt || Date.now()).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

      if (isRenaming) {
        item.innerHTML = `
          <form class="mix-rename-form" data-rename-form="${mix.id}">
            <label class="sr-only" for="renameInput-${mix.id}">New name for ${escapeHtml(mix.name)}</label>
            <input id="renameInput-${mix.id}" type="text" maxlength="40" value="${escapeHtml(mix.name)}" required autocomplete="off">
            <div class="mix-actions">
              <button type="submit" class="btn btn-primary btn-sm mix-button-save" aria-label="Confirm rename for ${escapeHtml(mix.name)}">Save</button>
              <button type="button" class="btn btn-secondary btn-sm mix-button-cancel" data-cancel-rename aria-label="Cancel renaming">Cancel</button>
            </div>
          </form>
        `;
        const input = item.querySelector(`#renameInput-${mix.id}`);
        input.focus();
        input.select();
      } else if (isDeleting) {
        item.innerHTML = `
          <div class="mix-confirm-delete" role="alert">
            <p>Delete <strong>${escapeHtml(mix.name)}</strong>?</p>
            <div class="mix-actions">
              <button type="button" class="btn btn-danger btn-sm" data-confirm-delete="${mix.id}" aria-label="Yes, delete ${escapeHtml(mix.name)}">Yes, delete</button>
              <button type="button" class="btn btn-secondary btn-sm" data-cancel-delete aria-label="Cancel deletion">Cancel</button>
            </div>
          </div>
        `;
        item.querySelector("[data-confirm-delete]").focus();
      } else {
        const sourceLabel = mix.source === "ai" ? `<span class="mix-badge mix-badge-ai" title="Created by AI">AI</span>` : "";
        item.innerHTML = `
          <div class="mix-meta">
            <div class="mix-title-row">
              <span class="mix-name">${escapeHtml(mix.name)}</span>
              ${sourceLabel}
            </div>
            <span class="mix-date">${formattedDate}</span>
          </div>
          <div class="mix-levels-container"></div>
          <div class="mix-actions">
            <button type="button" class="btn btn-accent btn-sm mix-button-apply" data-apply-mix="${mix.id}" aria-label="Apply mix ${escapeHtml(mix.name)}">Apply</button>
            <button type="button" class="btn btn-secondary btn-sm mix-button-rename" data-rename-mix="${mix.id}" aria-label="Rename mix ${escapeHtml(mix.name)}">Rename</button>
            <button type="button" class="btn btn-danger btn-sm mix-button-delete" data-delete-mix="${mix.id}" aria-label="Delete mix ${escapeHtml(mix.name)}">Delete</button>
          </div>
        `;

        // Render level bars using DOM elements so CSP blocks never occur
        const levelsWrap = item.querySelector(".mix-levels-container");
        const levelsRow = document.createElement("div");
        levelsRow.className = "mix-levels";
        levelsRow.setAttribute("aria-label", `Levels: ${soundscapes.map((config) => `${config.name} ${Math.round((mix.levels?.[config.id]?.channel || 0) * 100)}%`).join(", ")}`);

        soundscapes.forEach((config) => {
          const level = Math.round((mix.levels?.[config.id]?.channel || 0) * 100);
          const track = document.createElement("span");
          track.className = "mix-level-track";
          track.setAttribute("role", "progressbar");
          track.setAttribute("aria-valuenow", String(level));
          track.setAttribute("aria-valuemin", "0");
          track.setAttribute("aria-valuemax", "100");
          track.setAttribute("aria-label", `${config.name} ${level}%`);
          track.title = `${config.name} ${level}%`;

          const fill = document.createElement("span");
          fill.className = `mix-level-fill mix-level-fill-${config.id}`;
          fill.style.width = `${level}%`;

          track.appendChild(fill);
          levelsRow.appendChild(track);
        });

        levelsWrap.appendChild(levelsRow);
      }

      mixesList.appendChild(item);
    });

    bindItemEvents();
  }

  function bindItemEvents() {
    mixesList.querySelectorAll("[data-apply-mix]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.applyMix;
        const mix = mixes.find((m) => m.id === id);
        if (mix) applyMix(mix);
      });
    });

    mixesList.querySelectorAll("[data-rename-mix]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeRenameId = btn.dataset.renameMix;
        activeDeleteId = null;
        renderList();
      });
    });

    mixesList.querySelectorAll("[data-cancel-rename]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeRenameId = null;
        renderList();
      });
    });

    mixesList.querySelectorAll("[data-rename-form]").forEach((form) => {
      form.querySelector("input").addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          activeRenameId = null;
          renderList();
        }
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const id = form.dataset.renameForm;
        const input = form.querySelector("input");
        const newName = input.value.trim().slice(0, 40);
        if (!newName) return;
        try {
          const updated = await renameSavedMix(id, newName);
          const index = mixes.findIndex((m) => m.id === id);
          if (index !== -1) mixes[index] = updated;
          activeRenameId = null;
          renderList();
          announce(`Renamed mix to "${newName}"`);
          showToast("Mix renamed");
        } catch (error) {
          announce(error.message || "Failed to rename mix.");
        }
      });
    });

    mixesList.querySelectorAll("[data-delete-mix]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeDeleteId = btn.dataset.deleteMix;
        activeRenameId = null;
        renderList();
      });
    });

    mixesList.querySelectorAll("[data-cancel-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeDeleteId = null;
        renderList();
      });
    });

    mixesList.querySelectorAll("[data-confirm-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.confirmDelete;
        const mix = mixes.find((m) => m.id === id);
        const name = mix?.name || "Mix";
        try {
          await deleteSavedMix(id);
          mixes = mixes.filter((m) => m.id !== id);
          activeDeleteId = null;
          renderList();
          announce(`Deleted mix "${name}"`);
          showToast("Mix deleted");
        } catch (error) {
          announce(error.message || "Failed to delete mix.");
        }
      });
    });
  }

  function readCurrentLevels() {
    const currentState = getState();
    const levels = {};
    for (const config of soundscapes) {
      const channelState = currentState.channels[config.id] || {};
      const channelVol = typeof channelState.volume === "number" && Number.isFinite(channelState.volume)
        ? Math.max(0, Math.min(1, channelState.volume))
        : 0;

      const layers = {};
      for (const layer of config.layers) {
        const layerVol = typeof channelState.layers?.[layer.id] === "number" && Number.isFinite(channelState.layers[layer.id])
          ? Math.max(0, Math.min(1, channelState.layers[layer.id]))
          : layer.defaultVolume;
        layers[layer.id] = layerVol;
      }

      levels[config.id] = { channel: channelVol, layers };
    }
    return levels;
  }

  async function applyMix(savedMix) {
    if (isApplying) return;
    isApplying = true;

    // Push undo snapshot if undo feature exists
    if (typeof window.pushUndo === "function") {
      try { window.pushUndo(); } catch {}
    } else if (typeof state.pushUndo === "function") {
      try { state.pushUndo(); } catch {}
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      soundscapes.forEach((config) => {
        const targetConfig = savedMix.levels?.[config.id];
        if (!targetConfig) return;
        const targetChannel = targetConfig.channel;
        setChannelVolume(config.id, targetChannel);
        if (engine.context) engine.setChannel(config.id, targetChannel);

        config.layers.forEach((layer) => {
          const targetLayer = targetConfig.layers?.[layer.id] ?? 0;
          setLayerVolume(config.id, layer.id, targetLayer);
          if (engine.context) engine.setLayer(config.id, layer.id, targetLayer);
        });
      });
      render(engine.context?.state === "running");
      saveState();
      isApplying = false;
      announce(`Applied mix "${savedMix.name}"`);
      showToast("Mix applied");
      window.dispatchEvent(new CustomEvent("mix:applied", { detail: { name: savedMix.name } }));
      return;
    }

    const start = performance.now();
    const duration = 1500;
    const initial = Object.fromEntries(
      soundscapes.map((config) => [
        config.id,
        {
          channel: state.channels[config.id]?.volume ?? 0,
          layers: Object.fromEntries(
            config.layers.map((layer) => [
              layer.id,
              state.channels[config.id]?.layers?.[layer.id] ?? 0,
            ])
          ),
        },
      ])
    );

    return new Promise((resolve) => {
      function frame(now) {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - progress) ** 3;

        soundscapes.forEach((config) => {
          const targetConfig = savedMix.levels?.[config.id];
          if (!targetConfig) return;

          const initChannel = initial[config.id].channel;
          const targetChannel = targetConfig.channel;
          const currentChannel = progress >= 1 ? targetChannel : initChannel + (targetChannel - initChannel) * eased;

          setChannelVolume(config.id, currentChannel);
          if (engine.context) engine.setChannel(config.id, currentChannel);

          config.layers.forEach((layer) => {
            const initLayer = initial[config.id].layers[layer.id];
            const targetLayer = targetConfig.layers?.[layer.id] ?? 0;
            let currentLayer;
            if (initLayer === 0 && targetLayer === 0) {
              currentLayer = 0;
            } else if (progress >= 1) {
              currentLayer = targetLayer;
            } else {
              currentLayer = initLayer + (targetLayer - initLayer) * eased;
            }

            setLayerVolume(config.id, layer.id, currentLayer);
            if (engine.context) engine.setLayer(config.id, layer.id, currentLayer);
          });
        });

        render(engine.context?.state === "running");

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          // Strictly guarantee zero volume invariant for silent layers
          soundscapes.forEach((config) => {
            const targetConfig = savedMix.levels?.[config.id];
            if (!targetConfig) return;
            config.layers.forEach((layer) => {
              if ((targetConfig.layers?.[layer.id] ?? 0) === 0) {
                setLayerVolume(config.id, layer.id, 0);
                if (engine.context) engine.setLayer(config.id, layer.id, 0);
              }
            });
          });

          saveState();
          isApplying = false;
          announce(`Applied mix "${savedMix.name}"`);
          showToast("Mix applied");
          window.dispatchEvent(new CustomEvent("mix:applied", { detail: { name: savedMix.name } }));
          resolve();
        }
      }

      requestAnimationFrame(frame);
    });
  }

  // Event Listeners
  openButton?.addEventListener("click", () => open("", "manual"));
  closeButton.addEventListener("click", close);

  signInButton.addEventListener("click", () => {
    close();
    openAuthModal();
  });

  saveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) {
      guestView.hidden = false;
      userView.hidden = true;
      return;
    }

    if (!accountsAvailable) {
      announce("Saved mixes are temporarily unavailable.");
      return;
    }

    const name = saveNameInput.value.trim().slice(0, 40);
    if (!name) return;

    saveSubmitButton.disabled = true;
    saveSubmitButton.textContent = "Saving…";
    saveSubmitButton.classList.add("btn-loading");

    try {
      const levels = readCurrentLevels();
      const newMix = await createSavedMix({
        name,
        levels,
        source: pendingSource || "manual",
      });
      pendingSource = "manual";
      saveNameInput.value = "";
      mixes.unshift(newMix);
      renderList();
      announce(`Saved mix "${name}"`);
      showToast("Mix saved");
    } catch (error) {
      if (error.status === 409) {
        announce("Limit of 50 mixes reached. Please delete an older mix.");
      } else if (error.status === 401) {
        currentUser = null;
        guestView.hidden = false;
        userView.hidden = true;
        announce("Please sign in to save mixes.");
      } else if (error.status === 503) {
        accountsAvailable = false;
        if (unavailableNotice) unavailableNotice.hidden = false;
        announce("Saved mixes are temporarily unavailable.");
      } else {
        announce(error.message || "Failed to save mix.");
      }
    } finally {
      saveSubmitButton.disabled = !accountsAvailable;
      saveSubmitButton.textContent = "Save";
      saveSubmitButton.classList.remove("btn-loading");
    }
  });

  // Handle auth change events
  window.addEventListener("auth:change", (event) => {
    const user = event.detail?.user;
    currentUser = user || null;

    if (panel.getAttribute("aria-hidden") === "false") {
      if (currentUser) {
        guestView.hidden = true;
        userView.hidden = false;
        if (accountsAvailable) loadMixes();
      } else {
        guestView.hidden = false;
        userView.hidden = true;
      }
    }
  });

  // Handle mix save requests (e.g. from AI mood mixer or account menu)
  window.addEventListener("mix:save-request", (event) => {
    const { name, source, signedIn } = event.detail || {};
    if (signedIn === false || (signedIn === undefined && !currentUser)) {
      close();
      openAuthModal("login", "Sign in to save your mixes");
      return;
    }
    open(name || "", source || "manual");
  });

  if (mixesFilter) {
    mixesFilter.addEventListener("input", () => {
      filterText = mixesFilter.value.trim().toLowerCase();
      if (mixesFilterClear) mixesFilterClear.hidden = !filterText;
      renderList();
    });

    mixesFilter.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && filterText) {
        event.stopPropagation();
        mixesFilter.value = "";
        filterText = "";
        if (mixesFilterClear) mixesFilterClear.hidden = true;
        renderList();
      }
    });
  }

  if (mixesFilterClear) {
    mixesFilterClear.addEventListener("click", () => {
      mixesFilter.value = "";
      filterText = "";
      mixesFilterClear.hidden = true;
      mixesFilter.focus();
      renderList();
    });
  }

  // Fetch initial auth state quietly
  apiRequest("/api/auth/me")
    .then(({ user, accountsAvailable: available }) => {
      currentUser = user;
      accountsAvailable = available !== false;
      if (unavailableNotice) unavailableNotice.hidden = accountsAvailable;
      if (saveSubmitButton) saveSubmitButton.disabled = !accountsAvailable;
    })
    .catch(() => {
      currentUser = null;
    });

  return { open, close, applyMix };
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
