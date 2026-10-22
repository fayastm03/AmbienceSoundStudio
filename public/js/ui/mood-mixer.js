// Creates AI or keyword-based mixes and animates them through the live audio controls.
import { saveState } from "../state/store.js";

const COOLDOWN_MS = 3000;
const REQUEST_TIMEOUT_MS = 25000;
let lastRequestAt = 0;
let cooldownTimer;

function showCooldown(status, message) {
  clearInterval(cooldownTimer);
  const update = () => {
    const remaining = COOLDOWN_MS - (Date.now() - lastRequestAt);
    status.textContent = remaining > 0 ? `${message} · next mix in ${Math.ceil(remaining / 1000)}s` : message;
    if (remaining <= 0) clearInterval(cooldownTimer);
  };
  update();
  cooldownTimer = setInterval(update, 250);
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function channelByHint(configs, hint) {
  return configs.find((config) => config.name.toLowerCase().includes(hint))?.id;
}

function createKeywordMix(text, configs) {
  const mood = text.toLowerCase();
  const is = (...words) => words.some((word) => mood.includes(word));
  const weights = Object.fromEntries(configs.map((config) => [config.id, is("coffee", "work", "cafe") && config.name.toLowerCase().includes("coffee") ? .55 : is("fire", "cosy", "cozy", "warm") && config.name.toLowerCase().includes("fire") ? .6 : is("storm") && config.name.toLowerCase().includes("rain") ? .8 : is("sleep", "focus", "reading", "calm") && config.name.toLowerCase().includes("rain") ? .42 : is("sleep", "calm") ? .2 : .12]));
  if (is("focus", "reading")) {
    const coffee = channelByHint(configs, "coffee");
    if (coffee) weights[coffee] = .28;
  }
  return {
    name: is("sleep") ? "Sleepy shelter" : is("focus", "reading") ? "Quiet concentration" : is("storm") ? "Storm watch" : is("cosy", "cozy", "warm") ? "Fireside comfort" : is("coffee", "work") ? "Café focus" : is("calm") ? "Gentle reset" : "A considered moment",
    explanation: is("storm") ? "A deep rain-led mix with a little weather in the distance." : is("sleep") ? "A low, gentle blend designed to stay soft and unhurried." : is("focus", "reading") ? "Steady rain and a touch of room tone make a calm focus bed." : "A balanced blend shaped from your words, ready to adjust by ear.",
    levels: Object.fromEntries(configs.map((config) => [config.id, { channel: weights[config.id], layers: Object.fromEntries(config.layers.map((layer) => [layer.id, layer.defaultVolume * (is("storm") && layer.id.includes("thunder") ? 1.5 : 1)])) }])),
  };
}

function sanitizeMix(candidate, configs) {
  if (!candidate || typeof candidate !== "object" || typeof candidate.levels !== "object") throw new Error("Invalid mix response");
  const levels = {};
  configs.forEach((config) => {
    const source = candidate.levels[config.id];
    levels[config.id] = {
      channel: clamp(source?.channel),
      layers: Object.fromEntries(config.layers.map((layer) => [layer.id, clamp(source?.layers?.[layer.id])])),
    };
  });
  return {
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim().slice(0, 40) : "Your new mix",
    explanation: typeof candidate.explanation === "string" && candidate.explanation.trim() ? candidate.explanation.trim().slice(0, 160) : "A new soundscape shaped around your moment.",
    levels,
  };
}

function animateMix(result, configs, state, engine, render) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    configs.forEach((config) => {
      const target = result.levels[config.id];
      state.channels[config.id].volume = target.channel;
      if (engine.context) engine.setChannel(config.id, target.channel);
      config.layers.forEach((layer) => {
        const value = target.layers[layer.id];
        state.channels[config.id].layers[layer.id] = value;
        if (engine.context) engine.setLayer(config.id, layer.id, value);
      });
    });
    render(engine.active);
    saveState();
    return Promise.resolve();
  }

  const start = performance.now();
  const duration = 2000;
  const initial = Object.fromEntries(configs.map((config) => [config.id, { channel: state.channels[config.id].volume, layers: Object.fromEntries(config.layers.map((layer) => [layer.id, state.channels[config.id].layers[layer.id]])) }]));
  return new Promise((resolve) => {
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      configs.forEach((config) => {
        const target = result.levels[config.id];
        const channel = initial[config.id].channel + (target.channel - initial[config.id].channel) * eased;
        state.channels[config.id].volume = channel;
        if (engine.context) engine.setChannel(config.id, channel);
        config.layers.forEach((layer) => {
          const value = initial[config.id].layers[layer.id] + (target.layers[layer.id] - initial[config.id].layers[layer.id]) * eased;
          state.channels[config.id].layers[layer.id] = value;
          if (engine.context) engine.setLayer(config.id, layer.id, value);
        });
      });
      render(engine.active);
      if (progress < 1) requestAnimationFrame(frame);
      else { saveState(); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

export function bindMoodMixer({ configs, state, engine, render, onSaveAiMix }) {
  const form = document.querySelector("#moodForm");
  const input = document.querySelector("#moodInput");
  const button = document.querySelector("#moodButton");
  const status = document.querySelector("#moodStatus");
  const explanation = document.querySelector("#moodExplanation");
  const moodSaveButton = document.querySelector("#moodSaveButton");
  if (moodSaveButton) moodSaveButton.hidden = true;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim().slice(0, 200);
    if (!text) { status.textContent = "Describe a moment first."; return; }
    const remaining = COOLDOWN_MS - (Date.now() - lastRequestAt);
    if (remaining > 0) { showCooldown(status, "Please wait"); return; }
    lastRequestAt = Date.now();
    button.disabled = true;
    button.textContent = "Creating…";
    status.textContent = "Listening for the mood…";
    explanation.textContent = "";
    if (moodSaveButton) moodSaveButton.hidden = true;
    let result;
    let fallbackReason = "";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await fetch("/api/mix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, channels: configs.map((config) => ({ id: config.id, layers: config.layers.map((layer) => layer.id) })) }), signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.error || `Mix service returned ${response.status}`);
        error.status = response.status;
        error.code = payload.error;
        throw error;
      }
      const payload = await response.json();
      result = sanitizeMix(payload, configs);
      if (payload.source === "keyword" && payload.fallbackReason) {
        fallbackReason = payload.fallbackReason === "ai_rate_limited"
          ? "Quick mix ready — AI is temporarily rate-limited"
          : payload.fallbackReason === "ai_timeout"
            ? "Quick mix ready — AI took too long to respond"
            : "Quick mix ready — using local mode";
      }
      status.textContent = fallbackReason || result.name;
    } catch (error) {
      console.warn("Mood mix request failed:", error.code || error.message);
      result = createKeywordMix(text, configs);
      fallbackReason = error.status === 429
        ? "Quick mix ready — AI is temporarily rate-limited"
        : error.name === "AbortError"
          ? "Quick mix ready — AI took too long to respond"
          : "Quick mix ready — using local mode";
      status.textContent = fallbackReason;
    } finally {
      button.disabled = false;
      button.textContent = "Create mix";
    }
    explanation.textContent = result.explanation;
    window.dispatchEvent(new CustomEvent("mix:ai-applied", { detail: { name: result.name } }));
    if (moodSaveButton) {
      moodSaveButton.hidden = false;
      moodSaveButton.onclick = () => {
        if (typeof onSaveAiMix === "function") {
          onSaveAiMix({ name: result.name, source: "ai" });
        }
        window.dispatchEvent(new CustomEvent("mix:save-request", { detail: { name: result.name, source: "ai" } }));
      };
    }
    showCooldown(status, fallbackReason || result.name);
    Promise.resolve().then(async () => {
      try {
        if (!engine.context) await engine.start();
        if (!engine.active) await engine.resume();
        await animateMix(result, configs, state, engine, render);
      } catch {
        status.textContent = `${status.textContent} · press Play to hear it`;
        await animateMix(result, configs, state, engine, render);
      }
    });
  });
}
