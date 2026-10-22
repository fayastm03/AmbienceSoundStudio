// Action validator and animated executor for Ambient Sound Studio assistant.
// Applies mixer changes smoothly, maintains an Undo stack, and manages the sleep timer.

import { saveState, setMaster, setMuted, resetLayers } from "../state/store.js";
import { DEFAULT_CHANNEL_VOLUMES, CHANNELS, LAYERS } from "../config/soundscapes.js";

const MAX_UNDO = 10;
const ANIMATION_DURATION_MS = 2000;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function createAssistantExecutor({ soundscapes, state, engine, render, onTimerTick, onNowPlayingChange }) {
  const undoStack = [];
  let sleepTimerId = null;
  let sleepTimerEndTime = null;
  let preTimerMaster = null;

  function saveSnapshot() {
    undoStack.push({
      master: state.master,
      muted: state.muted,
      channels: Object.fromEntries(
        soundscapes.map((cfg) => [
          cfg.id,
          {
            channel: state.channels[cfg.id].volume,
            volume: state.channels[cfg.id].volume,
            layers: clone(state.channels[cfg.id].layers),
          },
        ])
      ),
    });
    if (undoStack.length > MAX_UNDO) {
      undoStack.shift();
    }
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  // Smoothly transition soundscape levels over ~1.5s
  function animateLevels(targetLevels) {
    if (targetLevels && typeof targetLevels === "object") {
      Object.keys(targetLevels).forEach((k) => {
        if (!CHANNELS.includes(k)) {
          console.warn("[executor] Unknown mixer key ignored:", k);
        } else if (targetLevels[k]?.layers && typeof targetLevels[k].layers === "object") {
          Object.keys(targetLevels[k].layers).forEach((lk) => {
            if (!LAYERS.includes(lk)) {
              console.warn("[executor] Unknown mixer key ignored:", lk);
            }
          });
        }
      });
    }

    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (reduceMotion) {
      soundscapes.forEach((config) => {
        const target = targetLevels[config.id];
        if (!target) return;
        const targetVol = clamp(target.channel !== undefined ? target.channel : target.volume);
        state.channels[config.id].volume = targetVol;
        if (engine.context) engine.setChannel(config.id, targetVol);

        config.layers.forEach((layer) => {
          if (target.layers?.[layer.id] !== undefined) {
            state.channels[config.id].layers[layer.id] = clamp(target.layers[layer.id]);
            if (engine.context) engine.setLayer(config.id, layer.id, state.channels[config.id].layers[layer.id]);
          }
        });
      });
      render(engine.active);
      saveState();
      return Promise.resolve();
    }

    const start = performance.now();
    const initial = Object.fromEntries(
      soundscapes.map((config) => [
        config.id,
        {
          channel: state.channels[config.id].volume,
          layers: Object.fromEntries(config.layers.map((l) => [l.id, state.channels[config.id].layers[l.id]])),
        },
      ])
    );

    return new Promise((resolve) => {
      function frame(now) {
        const progress = Math.min(1, (now - start) / ANIMATION_DURATION_MS);
        const eased = 1 - (1 - progress) ** 3;

        soundscapes.forEach((config) => {
          const target = targetLevels[config.id];
          if (!target) return;

          const chStart = initial[config.id].channel;
          const chTarget = clamp(target.channel !== undefined ? target.channel : target.volume);
          const chVal = chStart + (chTarget - chStart) * eased;
          state.channels[config.id].volume = chVal;
          if (engine.context) engine.setChannel(config.id, chVal);

          config.layers.forEach((layer) => {
            if (target.layers?.[layer.id] !== undefined) {
              const lStart = initial[config.id].layers[layer.id];
              const lTarget = clamp(target.layers[layer.id]);
              const lVal = lStart + (lTarget - lStart) * eased;
              state.channels[config.id].layers[layer.id] = lVal;
              if (engine.context) engine.setLayer(config.id, layer.id, lVal);
            }
          });
        });

        render(engine.active);

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          saveState();
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  // Sleep timer implementation
  function startSleepTimer(durationInSeconds) {
    cancelSleepTimer();
    const durationSec = Math.max(1, Math.min(43200, Math.round(Number(durationInSeconds) || 1800)));
    const totalMs = durationSec * 1000;
    sleepTimerEndTime = Date.now() + totalMs;
    preTimerMaster = state.master;

    const tick = async () => {
      const remainingMs = Math.max(0, sleepTimerEndTime - Date.now());
      const remainingSec = Math.ceil(remainingMs / 1000);

      if (typeof onTimerTick === "function") {
        onTimerTick(remainingSec);
      }

      // In final window (if total duration < 60s, fade over last ~30% of time e.g. 9s for 30s; otherwise last 60s)
      const fadeWindowSec = durationSec < 60 ? Math.max(2, Math.floor(durationSec * 0.3)) : Math.min(60, durationSec);
      if (remainingSec <= fadeWindowSec && remainingSec > 0) {
        const factor = remainingSec / fadeWindowSec;
        const targetMaster = clamp(preTimerMaster * factor);
        state.master = targetMaster;
        setMaster(targetMaster);
        if (engine.context) engine.fadeMaster(state.muted ? 0 : targetMaster ** 2, 0.5);
        render(engine.active);
      }

      if (remainingMs <= 0) {
        const savedPreMaster = preTimerMaster;
        if (sleepTimerId) {
          clearInterval(sleepTimerId);
          sleepTimerId = null;
        }
        sleepTimerEndTime = null;
        preTimerMaster = null;

        if (engine.active) {
          await engine.pause();
        }
        if (savedPreMaster !== null) {
          state.master = savedPreMaster;
          setMaster(savedPreMaster);
        }
        render(false);
        if (typeof onTimerTick === "function") {
          onTimerTick(0);
        }
      }
    };

    tick();
    sleepTimerId = setInterval(tick, 1000);
  }

  function cancelSleepTimer() {
    if (sleepTimerId) {
      clearInterval(sleepTimerId);
      sleepTimerId = null;
    }
    sleepTimerEndTime = null;
    if (preTimerMaster !== null) {
      state.master = preTimerMaster;
      setMaster(preTimerMaster);
      if (engine.context) engine.fadeMaster(state.muted ? 0 : preTimerMaster ** 2, 0.5);
      preTimerMaster = null;
      render(engine.active);
    }
    if (typeof onTimerTick === "function") {
      onTimerTick(null);
    }
  }

  function getTimerRemaining() {
    if (!sleepTimerEndTime) return null;
    return Math.max(0, Math.ceil((sleepTimerEndTime - Date.now()) / 1000));
  }

  // Execute a parsed action list
  async function executeActions(actions, opts = {}) {
    if (!Array.isArray(actions) || actions.length === 0) return {};
    const fromChat = Boolean(opts.fromChat);
    const CHAT_MASTER_MAX = 0.8;
    const CHAT_MASTER_DELTA_MAX = 0.3;
    let masterClipped = false;

    for (const action of actions) {
      switch (action.type) {
        case "play": {
          if (!engine.context) {
            await engine.start();
          } else if (!engine.active) {
            await engine.resume();
          }
          render(true);
          break;
        }

        case "pause": {
          if (engine.active) {
            await engine.pause();
          }
          render(false);
          break;
        }

        case "mute": {
          state.muted = Boolean(action.value);
          setMuted(state.muted);
          if (engine.context) {
            engine.fadeMaster(state.muted ? 0 : state.master ** 2, 0.1);
          }
          render(engine.active);
          break;
        }

        case "master_delta": {
          saveSnapshot();
          const rawDelta = action.delta;
          const guardedDelta = fromChat
            ? Math.min(rawDelta, CHAT_MASTER_DELTA_MAX)
            : rawDelta;
          let newMaster = clamp(state.master + guardedDelta);
          if (fromChat && newMaster > CHAT_MASTER_MAX) {
            newMaster = CHAT_MASTER_MAX;
            masterClipped = true;
          }
          state.master = newMaster;
          setMaster(newMaster);
          if (engine.context) {
            engine.fadeMaster(state.muted ? 0 : newMaster ** 2, 0.2);
          }
          render(engine.active);
          break;
        }

        case "master_set": {
          saveSnapshot();
          let target = clamp(action.value);
          if (fromChat && target > CHAT_MASTER_MAX) {
            target = CHAT_MASTER_MAX;
            masterClipped = true;
          }
          state.master = target;
          setMaster(target);
          if (engine.context) {
            engine.fadeMaster(state.muted ? 0 : target ** 2, 0.2);
          }
          render(engine.active);
          break;
        }

        case "target_delta": {
          saveSnapshot();
          const { target, delta } = action;
          if (fromChat) {
            const levels = Object.fromEntries(
              soundscapes.map((cfg) => [
                cfg.id,
                {
                  channel: state.channels[cfg.id].volume,
                  layers: { ...state.channels[cfg.id].layers },
                },
              ])
            );
            if (target.type === "channel") {
              const ch = levels[target.channelId];
              if (ch) ch.channel = clamp(ch.channel + delta);
            } else if (target.type === "layer") {
              const ch = levels[target.channelId];
              if (ch && ch.layers?.[target.layerId] !== undefined) {
                ch.layers[target.layerId] = clamp(ch.layers[target.layerId] + delta);
                if (delta > 0 && ch.channel < 0.25) {
                  ch.channel = 0.35;
                }
              }
            }
            await animateLevels(levels);
          } else {
            if (target.type === "channel") {
              const ch = state.channels[target.channelId];
              if (ch) {
                const newVol = clamp(ch.volume + delta);
                ch.volume = newVol;
                if (engine.context) engine.setChannel(target.channelId, newVol);
              }
            } else if (target.type === "layer") {
              const ch = state.channels[target.channelId];
              if (ch && ch.layers?.[target.layerId] !== undefined) {
                const newVol = clamp(ch.layers[target.layerId] + delta);
                ch.layers[target.layerId] = newVol;
                if (engine.context) engine.setLayer(target.channelId, target.layerId, newVol);
                if (delta > 0 && ch.volume < 0.25) {
                  ch.volume = 0.35;
                  if (engine.context) engine.setChannel(target.channelId, 0.35);
                }
              }
            }
            render(engine.active);
            saveState();
          }
          break;
        }

        case "target_set": {
          saveSnapshot();
          const { target, value } = action;
          const val = clamp(value);
          if (fromChat) {
            const levels = Object.fromEntries(
              soundscapes.map((cfg) => [
                cfg.id,
                {
                  channel: state.channels[cfg.id].volume,
                  layers: { ...state.channels[cfg.id].layers },
                },
              ])
            );
            if (target.type === "channel") {
              const ch = levels[target.channelId];
              if (ch) ch.channel = val;
            } else if (target.type === "layer") {
              const ch = levels[target.channelId];
              if (ch && ch.layers?.[target.layerId] !== undefined) {
                ch.layers[target.layerId] = val;
                if (val > 0 && ch.channel < 0.25) {
                  ch.channel = 0.35;
                }
              }
            }
            await animateLevels(levels);
          } else {
            if (target.type === "channel") {
              const ch = state.channels[target.channelId];
              if (ch) {
                ch.volume = val;
                if (engine.context) engine.setChannel(target.channelId, val);
              }
            } else if (target.type === "layer") {
              const ch = state.channels[target.channelId];
              if (ch && ch.layers?.[target.layerId] !== undefined) {
                ch.layers[target.layerId] = val;
                if (engine.context) engine.setLayer(target.channelId, target.layerId, val);
                if (val > 0 && ch.volume < 0.25) {
                  ch.volume = 0.35;
                  if (engine.context) engine.setChannel(target.channelId, 0.35);
                }
              }
            }
            render(engine.active);
            saveState();
          }
          break;
        }

        case "set": {
          saveSnapshot();
          const target = action.layer
            ? { type: "layer", channelId: action.channel, layerId: action.layer }
            : { type: "channel", channelId: action.channel };
          const val = clamp(action.value ?? 0.5);
          if (target.type === "channel") {
            const ch = state.channels[target.channelId];
            if (ch) {
              ch.volume = val;
              if (engine.context) engine.setChannel(target.channelId, val);
            }
          } else if (target.type === "layer") {
            const ch = state.channels[target.channelId];
            if (ch && ch.layers?.[target.layerId] !== undefined) {
              ch.layers[target.layerId] = val;
              if (engine.context) engine.setLayer(target.channelId, target.layerId, val);
              if (val > 0 && ch.volume < 0.25) {
                ch.volume = 0.35;
                if (engine.context) engine.setChannel(target.channelId, 0.35);
              }
            }
          }
          render(engine.active);
          saveState();
          break;
        }

        case "adjust": {
          saveSnapshot();
          const target = action.layer
            ? { type: "layer", channelId: action.channel, layerId: action.layer }
            : { type: "channel", channelId: action.channel };
          const delta = action.delta ?? 0.15;
          if (target.type === "channel") {
            const ch = state.channels[target.channelId];
            if (ch) {
              const newVol = clamp(ch.volume + delta);
              ch.volume = newVol;
              if (engine.context) engine.setChannel(target.channelId, newVol);
            }
          } else if (target.type === "layer") {
            const ch = state.channels[target.channelId];
            if (ch && ch.layers?.[target.layerId] !== undefined) {
              const newVol = clamp(ch.layers[target.layerId] + delta);
              ch.layers[target.layerId] = newVol;
              if (engine.context) engine.setLayer(target.channelId, target.layerId, newVol);
              if (delta > 0 && ch.volume < 0.25) {
                ch.volume = 0.35;
                if (engine.context) engine.setChannel(target.channelId, 0.35);
              }
            }
          }
          render(engine.active);
          saveState();
          break;
        }

        case "master": {
          saveSnapshot();
          if (typeof action.value === "number") {
            let target = clamp(action.value);
            if (fromChat && target > CHAT_MASTER_MAX) {
              target = CHAT_MASTER_MAX;
              masterClipped = true;
            }
            state.master = target;
            setMaster(target);
            if (engine.context) engine.fadeMaster(state.muted ? 0 : target ** 2, 0.2);
          } else if (typeof action.delta === "number") {
            const guardedDelta = fromChat
              ? Math.min(action.delta, CHAT_MASTER_DELTA_MAX)
              : action.delta;
            let newMaster = clamp(state.master + guardedDelta);
            if (fromChat && newMaster > CHAT_MASTER_MAX) {
              newMaster = CHAT_MASTER_MAX;
              masterClipped = true;
            }
            state.master = newMaster;
            setMaster(newMaster);
            if (engine.context) engine.fadeMaster(state.muted ? 0 : newMaster ** 2, 0.2);
          }
          render(engine.active);
          break;
        }

        case "timer": {
          const secs = typeof action.seconds === "number"
            ? action.seconds
            : typeof action.minutes === "number"
              ? action.minutes * 60
              : 1800;
          startSleepTimer(secs);
          break;
        }

        case "reset": {
          saveSnapshot();
          soundscapes.forEach((config) => {
            resetLayers(config.id);
            config.layers.forEach((layer) => {
              if (engine.context) engine.setLayer(config.id, layer.id, state.channels[config.id].layers[layer.id]);
            });
            // Reset channel volume to safe default
            state.channels[config.id].volume = DEFAULT_CHANNEL_VOLUMES[config.id] ?? 0.35;
            if (engine.context) engine.setChannel(config.id, state.channels[config.id].volume);
          });
          if (typeof onNowPlayingChange === "function") onNowPlayingChange("");
          render(engine.active);
          saveState();
          break;
        }

        case "undo": {
          if (undoStack.length > 0) {
            const prev = undoStack.pop();
            state.master = prev.master;
            setMaster(prev.master);
            if (prev.muted !== undefined) {
              state.muted = prev.muted;
              setMuted(prev.muted);
            }
            await animateLevels(prev.channels);
            if (engine.context) {
              engine.fadeMaster(state.muted ? 0 : state.master ** 2, 0.2);
            }
          }
          break;
        }

        case "preset": {
          saveSnapshot();
          if (typeof onNowPlayingChange === "function") onNowPlayingChange(action.name);
          await animateLevels(action.levels);
          break;
        }

        case "surprise": {
          saveSnapshot();
          if (typeof onNowPlayingChange === "function") onNowPlayingChange("Surprise mix");
          await animateLevels(action.levels);
          break;
        }

        case "apply_mix": {
          saveSnapshot();
          if (action.mix?.levels) {
            if (typeof onNowPlayingChange === "function") onNowPlayingChange(action.mix.name);
            await animateLevels(action.mix.levels);
          }
          break;
        }

        case "timer_start": {
          const secs = typeof action.seconds === "number"
            ? action.seconds
            : typeof action.minutes === "number"
              ? action.minutes * 60
              : 1800;
          startSleepTimer(secs);
          break;
        }

        case "timer_cancel": {
          cancelSleepTimer();
          break;
        }

        default:
          break;
      }
    }

    return { masterClipped };
  }

  return {
    executeActions,
    canUndo,
    saveSnapshot,
    undo: () => executeActions([{ type: "undo" }]),
    getTimerRemaining,
    cancelSleepTimer,
  };
}

