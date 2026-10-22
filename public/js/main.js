// Application entry point: compose config, state, audio, and UI modules.
import { soundscapes } from "./config/soundscapes.js";
import { getState, loadState, setChannelVolume, setLayerVolume, setMaster, setMuted, setNaturalDrift, resetLayers, saveState } from "./state/store.js";
import { createEngine } from "./audio/engine.js";
import { renderCards, updateCard } from "./ui/cards.js";
import { createDetailPanel } from "./ui/detail-panel.js";
import { bindControls } from "./ui/controls.js";
import { applyTheme } from "./ui/theme.js";
import { updateVisuals } from "./ui/visuals.js";
import { bindMoodMixer } from "./ui/mood-mixer.js";
import { bindAuth } from "./ui/auth.js";
import { bindSavedMixes } from "./ui/saved-mixes.js";
import { openAuthModal } from "./ui/auth.js";
import { bindAccountMenu } from "./ui/account-menu.js";
import { bindToast, showToast } from "./ui/toast.js";

const state = loadState();
let generated = new Set();
const layerStatuses = new Map();
let failedCount = 0;
const debug = new URLSearchParams(location.search).get("debug") === "1";
let panel;
let nowPlayingName = "";
let authKnown = false;
const engine = createEngine(state, (done, total) => { const loading = document.querySelector("#loading"); loading.hidden = false; loading.classList.toggle("complete", done === total); document.querySelector("#loadProgress").value = done / total * 100; document.querySelector("#loadLabel").textContent = `${Math.round(done / total * 100)}%`; if (done === total) setTimeout(() => { loading.hidden = true; }, 450); }, (channelId, layerId, entry) => { const key = `${channelId}:${layerId}`; layerStatuses.set(key, entry.generated ? "generated" : ""); if (entry.generated) { failedCount += 1; generated.add(key); } if (debug) updateDebugLayer(channelId, layerId, entry); }, debug ? (peak) => { const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity; document.querySelector("#debugPeak").style.width = `${Math.min(100, Math.max(0, (db + 60) / 60 * 100))}%`; document.querySelector("#debugPeakLabel").textContent = `Peak ${Number.isFinite(db) ? db.toFixed(1) : "-∞"} dB`; } : null);
function render(playing = false) { soundscapes.forEach((config) => updateCard(config, state)); document.querySelector("#masterVolume").value = state.master * 100; document.querySelector("#masterValue").textContent = `${Math.round(state.master * 100)}%`; document.querySelector("#masterVolume").style.setProperty("--value", `${state.master * 100}%`); document.querySelector("#muteText").textContent = state.muted ? "Unmute" : "Mute"; document.querySelector("#muteButton").setAttribute("aria-pressed", state.muted); document.querySelector("#playText").textContent = playing ? "Pause" : "Play"; document.querySelector("#playIcon").textContent = playing ? "Ⅱ" : "▶"; document.querySelector("#playButton").setAttribute("aria-pressed", playing); document.querySelector("#naturalDrift").checked = state.naturalDrift; applyTheme(state, playing, soundscapes); updateVisuals(state, playing); if (playing && failedCount) setMessage(`${failedCount} layer${failedCount === 1 ? "" : "s"} generated because an audio file could not load.`); if (debug) renderDebug(); }
renderCards(soundscapes, state, (id) => panel.open(id), (id, volume) => { setChannelVolume(id, volume); engine.setChannel(id, volume); markEdited(); render(engine.context?.state === "running"); });
panel = createDetailPanel(soundscapes, state, (id, layerId, volume) => { setLayerVolume(id, layerId, volume); engine.setLayer(id, layerId, volume); markEdited(); updateCard(soundscapes.find((config) => config.id === id), state); }, (id, volume) => { setChannelVolume(id, volume); engine.setChannel(id, volume); markEdited(); render(engine.context?.state === "running"); }, (id) => { resetLayers(id); soundscapes.find((config) => config.id === id).layers.forEach((layer) => engine.setLayer(id, layer.id, state.channels[id].layers[layer.id])); nowPlayingName = ""; updateNowPlaying(); render(engine.context?.state === "running"); panel.open(id); }, (id, layerId) => layerStatuses.get(`${id}:${layerId}`) || "");
bindControls(engine, state, render);
document.querySelector("#naturalDrift").addEventListener("change", (event) => { setNaturalDrift(event.target.checked); engine.setDrift(event.target.checked); });
window.addEventListener("theme:changed", () => render(engine.context?.state === "running"));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && panel) panel.close(); });
render(false);
const savedMixes = bindSavedMixes({ soundscapes, state, engine, render });
bindMoodMixer({ configs: soundscapes, state, engine, render });
bindAuth();
bindToast();
document.querySelector("#saveMixTransport").addEventListener("click", () => window.dispatchEvent(new CustomEvent("mix:save-request")));
window.addEventListener("mix:applied", (event) => { nowPlayingName = event.detail?.name || ""; updateNowPlaying(); });
window.addEventListener("mix:ai-applied", (event) => { nowPlayingName = event.detail?.name || ""; updateNowPlaying(); });
window.addEventListener("auth:change", (event) => {
  const user = event.detail?.user;
  if (authKnown) showToast(user ? "Signed in" : "Signed out");
  authKnown = true;
  const tip = document.querySelector("#guestTip");
  if (tip) tip.hidden = Boolean(user) || localStorage.getItem("ambient-tip-dismissed") === "1";
});
const guestTip = document.querySelector("#guestTip");
if (guestTip) {
  guestTip.hidden = true; // Wait for initial auth:change event to determine user status
  document.querySelector("#guestTipClose").addEventListener("click", () => { localStorage.setItem("ambient-tip-dismissed", "1"); guestTip.hidden = true; });
}
bindAccountMenu({
  openAuth: openAuthModal,
  openMixes: () => savedMixes.open(),
});
saveState();

function setMessage(text) {
  document.querySelector("#audioMessage").textContent = text;
}

function updateNowPlaying() {
  const chip = document.querySelector("#nowPlaying");
  chip.hidden = !nowPlayingName;
  chip.textContent = nowPlayingName ? `Now playing: ${nowPlayingName}` : "";
}

function markEdited() {
  if (!nowPlayingName || nowPlayingName.endsWith(" (edited)")) return;
  nowPlayingName += " (edited)";
  updateNowPlaying();
}

function updateDebugLayer(channelId, layerId, entry) {
  const row = document.querySelector(`[data-debug-layer="${channelId}:${layerId}"]`);
  if (row) row.querySelector(".debug-status").textContent = entry.generated ? `generated (${entry.failure || "fallback"})` : `file · ${entry.duration.toFixed(2)}s`;
}
function renderDebug() {
  const panel = document.querySelector("#debugPanel");
  panel.hidden = false;
  if (document.querySelector("[data-debug-layer]")) return;
  const layers = soundscapes.flatMap((config) => config.layers.map((layer) => {
    const value = state.channels[config.id].layers[layer.id] ** 2 * state.channels[config.id].volume ** 2 * state.master ** 2 * .6 * 10 ** (layer.gainDb / 20);
    const gain = value > 0 ? (20 * Math.log10(value)).toFixed(1) : "-∞";
    return `<div class="debug-layer" data-debug-layer="${config.id}:${layer.id}"><span>${config.name} / ${layer.label}</span><small class="debug-status">waiting</small><small>final gain ${gain} dB</small></div>`;
  })).join("");
  document.querySelector("#debugLayers").innerHTML = layers;
}
