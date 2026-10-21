// Connects playback, mute, master, keyboard, and loading controls.
import { setMaster, setMuted, saveState } from "../state/store.js";

function isInteractiveOrTyping(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, button, [contenteditable], [role='button'], [role='tab'], a"));
}

function isAnyModalOrPanelOpen() {
  const authModal = document.querySelector("#authModal");
  if (authModal && !authModal.hidden) return true;
  const detailPanel = document.querySelector("#detailPanel");
  if (detailPanel && detailPanel.getAttribute("aria-hidden") === "false") return true;
  const mixesPanel = document.querySelector("#mixesPanel");
  if (mixesPanel && mixesPanel.getAttribute("aria-hidden") === "false") return true;
  return document.body.classList.contains("modal-open");
}

export function bindControls(engine, state, render) {
  const play = document.querySelector("#playButton");
  const mute = document.querySelector("#muteButton");
  let playing = false;

  play.onclick = async () => {
    try {
      if (!engine.context) {
        document.querySelector("#loading").hidden = false;
        await engine.start();
        playing = true;
      } else if (playing) {
        await engine.pause();
        playing = false;
      } else {
        await engine.resume();
        playing = true;
      }
      render(playing);
    } catch (error) {
      document.querySelector("#audioMessage").textContent = error.message;
      await engine.close();
      playing = false;
      render(false);
    }
  };

  mute.onclick = () => {
    state.muted = !state.muted;
    setMuted(state.muted);
    engine.fadeMaster(state.muted ? 0 : state.master ** 2);
    render(playing);
  };

  document.querySelector("#masterVolume").oninput = (event) => {
    state.master = Number(event.target.value) / 100;
    setMaster(state.master);
    engine.fadeMaster(state.muted ? 0 : state.master ** 2);
    render(playing);
  };

  document.addEventListener("keydown", (event) => {
    if (isAnyModalOrPanelOpen()) return;
    if (isInteractiveOrTyping(event.target)) return;

    if (event.code === "Space") {
      event.preventDefault();
      play.click();
    } else if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      mute.click();
    }
  });

  saveState();
}
