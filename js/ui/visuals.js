// Updates animated card intensity from channel mix and playback state.
export function updateVisuals(state, playing) { document.querySelectorAll("[data-channel]").forEach((card) => { const value = playing ? state.channels[card.dataset.channel].volume : 0; card.style.setProperty("--intensity", Math.max(.12, value)); }); }
