// Connects playback, mute, master, keyboard, and loading controls.
import { setMaster, setMuted, saveState } from "../state/store.js";
export function bindControls(engine, state, render) {
  const play = document.querySelector("#playButton");
  const mute = document.querySelector("#muteButton");
  let playing = false;
  play.onclick = async () => {
    try {
      if (!engine.context) { document.querySelector("#loading").hidden = false; await engine.start(); playing = true; }
      else if (playing) { await engine.pause(); playing = false; }
      else { await engine.resume(); playing = true; }
      render(playing);
    } catch (error) {
      document.querySelector("#audioMessage").textContent = error.message;
      await engine.close();
      playing = false;
      render(false);
    }
  };
  mute.onclick = () => { state.muted = !state.muted; setMuted(state.muted); engine.fadeMaster(state.muted ? 0 : state.master ** 2); render(playing); };
  document.querySelector("#masterVolume").oninput = (event) => { state.master = Number(event.target.value) / 100; setMaster(state.master); engine.fadeMaster(state.muted ? 0 : state.master ** 2); render(playing); };
  document.addEventListener("keydown", (event) => { if (event.target.matches("input, button")) return; if (event.code === "Space") { event.preventDefault(); play.click(); } if (event.key.toLowerCase() === "m") mute.click(); });
  saveState();
}
