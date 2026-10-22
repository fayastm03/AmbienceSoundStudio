// Owns persisted mixer settings and provides safe defaults.
import { soundscapes } from "../config/soundscapes.js";
const key = "ambient-sound-studio";
const defaults = { channels: Object.fromEntries(soundscapes.map((soundscape) => [soundscape.id, { volume: soundscape.id === "rain" ? .64 : soundscape.id === "coffee" ? .36 : soundscape.id === "nature" ? .40 : .28, layers: Object.fromEntries(soundscape.layers.map((layer) => [layer.id, layer.defaultVolume])) }])), master: .78, muted: false, theme: "auto", naturalDrift: true };
const clone = (value) => JSON.parse(JSON.stringify(value));
let state = clone(defaults);
export function getState() { return state; }
const numberInRange = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
export function loadState() { try { const saved = JSON.parse(localStorage.getItem(key)); state = { ...clone(defaults), ...saved, channels: { ...clone(defaults.channels), ...saved?.channels } }; soundscapes.forEach((item) => { const savedChannel = state.channels[item.id] || {}; state.channels[item.id] = { ...clone(defaults.channels[item.id]), ...savedChannel, volume: numberInRange(savedChannel.volume, defaults.channels[item.id].volume), layers: { ...clone(defaults.channels[item.id].layers), ...savedChannel.layers } }; item.layers.forEach((layer) => { state.channels[item.id].layers[layer.id] = numberInRange(state.channels[item.id].layers[layer.id], layer.defaultVolume); }); }); state.master = numberInRange(state.master, defaults.master); state.muted = Boolean(state.muted); state.naturalDrift = saved?.naturalDrift !== false; state.theme = ["light", "dark", "auto"].includes(state.theme) ? state.theme : "auto"; } catch { state = clone(defaults); } return state; }
export function saveState() { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }
export function setChannelVolume(id, volume) { state.channels[id].volume = volume; saveState(); }
export function setLayerVolume(channelId, layerId, volume) { state.channels[channelId].layers[layerId] = volume; saveState(); }
export function setMaster(volume) { state.master = volume; saveState(); }
export function setMuted(muted) { state.muted = muted; saveState(); }
export function setTheme(theme) { state.theme = theme; saveState(); }
export function setNaturalDrift(value) { state.naturalDrift = Boolean(value); saveState(); }
export function resetLayers(id) { soundscapes.find((item) => item.id === id).layers.forEach((layer) => { state.channels[id].layers[layer.id] = layer.defaultVolume; }); saveState(); }
