// Manages the accessible channel detail side panel and bottom sheet.
import { registerOverlay, openOverlay, closeOverlay } from "./overlay.js";

export function createDetailPanel(configs, state, onLayerChange, onChannelChange, onReset, getStatus) {
  const panel = document.querySelector("#detailPanel");
  const list = document.querySelector("#layerList");
  const closeButton = document.querySelector("#closePanel");
  const resetButton = document.querySelector("#resetLayers");
  const channelInput = document.querySelector("#detailChannelVolume");
  const channelOutput = document.querySelector("#detailChannelValue");

  let activeId;

  function renderChannel(id) {
    activeId = id;
    const config = configs.find((item) => item.id === id);
    if (!config) return;

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
  }

  registerOverlay("detailPanel", {
    element: panel,
    contentElement: panel.querySelector(".panel-content"),
    usesScrim: true,
    open: () => {
      panel.setAttribute("aria-hidden", "false");
    },
    close: () => {
      panel.setAttribute("aria-hidden", "true");
    },
    trapFocus: true,
  });

  function open(id) {
    renderChannel(id);
    const trigger = document.querySelector(`[data-channel="${id}"]`);
    openOverlay("detailPanel", {
      trigger,
      focusTarget: closeButton,
    });
  }

  function close() {
    closeOverlay("detailPanel");
  }

  closeButton.addEventListener("click", close);
  resetButton.addEventListener("click", () => onReset(activeId));

  return { open, close };
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
