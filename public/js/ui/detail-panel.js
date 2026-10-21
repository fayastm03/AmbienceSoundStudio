// Manages the accessible channel detail side panel and bottom sheet.
export function createDetailPanel(configs, state, onLayerChange, onChannelChange, onReset, getStatus) {
  const panel = document.querySelector("#detailPanel");
  const list = document.querySelector("#layerList");
  const closeButton = document.querySelector("#closePanel");
  const backdrop = panel.querySelector("[data-close-panel]");
  const resetButton = document.querySelector("#resetLayers");
  const channelInput = document.querySelector("#detailChannelVolume");
  const channelOutput = document.querySelector("#detailChannelValue");

  let activeId;
  let returnFocus;

  function focusable() {
    return [...panel.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])")].filter(
      (element) => !element.disabled && !element.closest("[hidden]")
    );
  }

  function open(id) {
    // Notify other panels to close so panels never overlap
    window.dispatchEvent(new CustomEvent("panel:open", { detail: { name: "detail" } }));

    activeId = id;
    returnFocus = document.querySelector(`[data-channel="${id}"]`);
    const config = configs.find((item) => item.id === id);

    document.querySelector("#detailTitle").textContent = config.name;
    document.querySelector("#detailDescription").textContent = config.description;

    const channelVolPercent = Math.round(state.channels[id].volume * 100);
    channelInput.value = channelVolPercent;
    channelInput.style.setProperty("--value", `${channelVolPercent}%`);
    channelOutput.textContent = `${channelVolPercent}%`;

    channelInput.oninput = () => {
      const val = Number(channelInput.value);
      channelInput.style.setProperty("--value", `${val}%`);
      channelOutput.textContent = `${val}%`;
      onChannelChange(id, val / 100);
    };

    list.innerHTML = config.layers.map((layer) => {
      const status = getStatus(id, layer.id);
      const layerPercent = Math.round(state.channels[id].layers[layer.id] * 100);
      return `<div class="layer-item">
        <label class="layer-name" for="layer-${layer.id}">
          <span>${escapeHtml(layer.label)}${status ? `<span class="generated-tag">${escapeHtml(status)}</span>` : ""}</span>
          <output id="layerValue-${layer.id}">${layerPercent}%</output>
        </label>
        <input id="layer-${layer.id}" type="range" min="0" max="100" value="${layerPercent}" aria-label="${escapeHtml(layer.label)} volume">
      </div>`;
    }).join("");

    list.querySelectorAll("input").forEach((input, index) => {
      const layer = config.layers[index];
      input.style.setProperty("--value", `${input.value}%`);
      input.addEventListener("input", () => {
        const val = Number(input.value);
        onLayerChange(id, layer.id, val / 100);
        input.style.setProperty("--value", `${val}%`);
        document.querySelector(`#layerValue-${layer.id}`).textContent = `${val}%`;
      });
    });

    panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    closeButton.focus();
  }

  function close() {
    panel.setAttribute("aria-hidden", "true");
    // Check if any other overlay is still open before removing modal-open
    const authModal = document.querySelector("#authModal");
    const mixesPanel = document.querySelector("#mixesPanel");
    const isOtherOpen = (authModal && !authModal.hidden) || (mixesPanel && mixesPanel.getAttribute("aria-hidden") === "false");
    if (!isOtherOpen) {
      document.body.classList.remove("modal-open");
    }
    returnFocus?.focus();
  }

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  resetButton.addEventListener("click", () => onReset(activeId));

  // Focus trap and Escape handling
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return close();
    if (event.key !== "Tab") return;

    const elements = focusable();
    if (!elements.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first || !elements.includes(document.activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !elements.includes(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // Close when another panel opens
  window.addEventListener("panel:open", (event) => {
    if (event.detail?.name !== "detail" && panel.getAttribute("aria-hidden") === "false") {
      panel.setAttribute("aria-hidden", "true");
    }
  });

  return { open, close };
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
