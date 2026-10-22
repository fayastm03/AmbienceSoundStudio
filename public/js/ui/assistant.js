// Conversational Ambience Assistant UI component.
// Non-modal floating chat panel on desktop, responsive bottom sheet on mobile.

import { registerOverlay, openOverlay, closeOverlay, isOverlayOpen } from "./overlay.js";
import { parseCommand } from "../assistant/commands.js";
import { createAssistantExecutor } from "../assistant/executor.js";
import { askAssistant, getChatHistory, recordLocalChat } from "../assistant/ai-client.js";
import { isCrisisText, CRISIS_MESSAGE, HELPLINE_URL, HELPLINE_LABEL } from "../config/safety.js";

const MAX_MESSAGES = 30;

export function bindAssistant({ soundscapes, state, engine, render, getSavedMixes, onNowPlayingChange }) {
  const button = document.querySelector("#assistantButton");
  const panel = document.querySelector("#assistantPanel");
  const closeButton = document.querySelector("#closeAssistant");
  const messagesList = document.querySelector("#assistantMessages");
  const form = document.querySelector("#assistantForm");
  const input = document.querySelector("#assistantInput");
  const sendButton = document.querySelector("#assistantSend");
  const undoButton = document.querySelector("#assistantUndo");
  const timerBanner = document.querySelector("#assistantTimerBanner");
  const timerLabel = document.querySelector("#assistantTimerLabel");
  const timerCancelBtn = document.querySelector("#assistantTimerCancel");
  const liveStatus = document.querySelector("#assistantLiveStatus");
  const chipsRow = document.querySelector("#assistantChips");
  const quotaLabel = document.querySelector("#assistantQuota");

  let currentMoodTags = [];
  let aiRemaining = null;
  let mockMode = false;
  let currentUserProfile = null;
  let currentUsualLevels = null;

  const messages = [
    {
      role: "assistant",
      text: "Hi! I can adjust sounds, set sleep timers, or blend moods. What kind of space would you like?",
    },
  ];

  function announce(text) {
    if (liveStatus) liveStatus.textContent = text;
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  const executor = createAssistantExecutor({
    soundscapes,
    state,
    engine,
    render,
    onTimerTick: (remainingSeconds) => {
      if (remainingSeconds === null || remainingSeconds <= 0) {
        if (timerBanner) timerBanner.hidden = true;
      } else {
        if (timerBanner) {
          timerBanner.hidden = false;
          if (timerLabel) timerLabel.textContent = `Sleep timer: ${formatTime(remainingSeconds)}`;
        }
      }
    },
    onNowPlayingChange,
  });

  function updateUndoButton() {
    if (undoButton) {
      undoButton.disabled = !executor.canUndo();
    }
  }

  function updateQuota(remaining) {
    if (typeof remaining === "number") {
      aiRemaining = remaining;
      if (quotaLabel) {
        quotaLabel.textContent = mockMode
          ? "Test mode: replies are fake"
          : `AI replies left today: ${remaining}`;
      }
    }
  }

  function setMockMode(on) {
    mockMode = on;
    if (quotaLabel) {
      quotaLabel.textContent = on ? "Test mode: replies are fake" : "";
    }
  }

  // Render the safety bubble with CRISIS_MESSAGE and a real helpline link.
  // Uses only textContent and createElement — no innerHTML.
  function appendCrisisBubble() {
    const bubble = document.createElement("div");
    bubble.className = "assistant-bubble assistant-bubble-assistant assistant-bubble-safety";

    const textEl = document.createElement("p");
    textEl.className = "assistant-bubble-text";
    textEl.textContent = CRISIS_MESSAGE + " ";
    bubble.appendChild(textEl);

    const link = document.createElement("a");
    link.href = HELPLINE_URL;
    link.textContent = HELPLINE_LABEL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "assistant-helpline-link";
    textEl.appendChild(link);

    const period = document.createTextNode(". If you want, I can also play something quiet in the background.");
    textEl.appendChild(period);

    // Cap message history to MAX_MESSAGES
    messages.push({ role: "assistant", text: CRISIS_MESSAGE, safety: true });
    while (messages.length > MAX_MESSAGES) messages.shift();

    if (messagesList) {
      messagesList.appendChild(bubble);
      messagesList.scrollTop = messagesList.scrollHeight;
    }
    announce(CRISIS_MESSAGE);
  }

  function appendMessage(role, text, options = {}) {
    let opts = {};
    if (typeof options === "boolean") {
      opts = { thinking: options };
    } else if (Array.isArray(options)) {
      opts = { examples: options };
    } else if (options && typeof options === "object") {
      opts = options;
    }
    messages.push({
      role,
      text,
      thinking: Boolean(opts.thinking),
      safety: Boolean(opts.safety),
      mixChip: opts.mixChip || null,
      hasUndo: Boolean(opts.hasUndo),
      undoDone: false,
    });
    while (messages.length > MAX_MESSAGES) {
      messages.shift();
    }
    renderMessages();
    announce(text);
  }

  function renderMessages() {
    if (!messagesList) return;
    messagesList.innerHTML = "";

    messages.forEach((msg) => {
      const bubble = document.createElement("div");
      bubble.className = `assistant-bubble assistant-bubble-${msg.role}${msg.thinking ? " assistant-bubble-thinking" : ""}${msg.safety ? " assistant-bubble-safety" : ""}`;

      const textEl = document.createElement("p");
      textEl.className = "assistant-bubble-text";

      if (msg.safety) {
        textEl.textContent = CRISIS_MESSAGE + " ";
        const link = document.createElement("a");
        link.href = HELPLINE_URL;
        link.textContent = HELPLINE_LABEL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "assistant-helpline-link";
        textEl.appendChild(link);
        textEl.appendChild(document.createTextNode(". If you want, I can also play something quiet in the background."));
      } else {
        textEl.textContent = msg.text;
      }

      bubble.appendChild(textEl);

      if (msg.mixChip) {
        const actionRow = document.createElement("div");
        actionRow.className = "assistant-mix-row";

        const chip = document.createElement("span");
        chip.className = "assistant-mix-chip";
        chip.textContent = msg.mixChip;
        actionRow.appendChild(chip);

        if (msg.hasUndo) {
          const undoBtn = document.createElement("button");
          undoBtn.type = "button";
          undoBtn.className = "assistant-undo-chip";
          undoBtn.textContent = msg.undoDone ? "Undone" : "Undo";
          undoBtn.disabled = Boolean(msg.undoDone);
          undoBtn.setAttribute("aria-label", "Undo mix changes");
          undoBtn.addEventListener("click", async () => {
            msg.undoDone = true;
            undoBtn.disabled = true;
            undoBtn.textContent = "Undone";
            await executor.undo();
            updateUndoButton();
            announce("Undid mix adjustments.");
          });
          actionRow.appendChild(undoBtn);
        }

        bubble.appendChild(actionRow);
      }

      messagesList.appendChild(bubble);
    });

    messagesList.scrollTop = messagesList.scrollHeight;
    messagesList.lastElementChild?.scrollIntoView({ block: "end", inline: "nearest" });
  }

  function formatMixChip(mix) {
    if (!mix || typeof mix !== "object") return "";
    const parts = [];
    const channelMap = [
      { key: "rain", label: "Rain" },
      { key: "cafe", alt: "coffee", label: "Cafe" },
      { key: "fire", label: "Fire" },
    ];
    for (const ch of channelMap) {
      const val = mix[ch.key] !== undefined ? mix[ch.key] : (ch.alt ? mix[ch.alt] : undefined);
      if (typeof val === "number" && val > 0) {
        parts.push(`${ch.label} ${Math.round(val)}`);
      }
    }
    if (parts.length > 0) {
      return parts.join(", ");
    }
    for (const [k, v] of Object.entries(mix)) {
      if (typeof v === "number" && v > 0) {
        const cleanKey = k.charAt(0).toUpperCase() + k.slice(1).replace("-", " ");
        parts.push(`${cleanKey} ${Math.round(v)}`);
        if (parts.length >= 2) break;
      }
    }
    return parts.join(", ");
  }

  function getActiveChannelsSummary() {
    const parts = [];
    const channelMap = [
      { key: "rain", label: "Rain" },
      { key: "coffee", label: "Cafe" },
      { key: "fire", label: "Fire" },
    ];
    for (const ch of channelMap) {
      const chState = state?.channels?.[ch.key];
      const vol = chState ? Math.round(chState.volume * 100) : 0;
      if (vol > 0) {
        parts.push(`${ch.label} ${vol}`);
      }
    }
    return parts.join(", ");
  }

  function getCurrentMixSnapshot() {
    if (!state?.channels) return {};
    const mix = {};
    soundscapes.forEach((config) => {
      const chState = state.channels[config.id];
      if (chState) {
        mix[config.id] = Math.round((chState.volume ?? 0) * 100);
        if (config.id === "coffee") {
          mix.cafe = mix[config.id];
        }
        if (chState.layers) {
          config.layers.forEach((layer) => {
            mix[layer.id] = Math.round((chState.layers[layer.id] ?? 0) * 100);
          });
        }
      }
    });
    return mix;
  }

  function mixToLevels(mix) {
    if (!mix || typeof mix !== "object") return null;
    const levels = {};
    soundscapes.forEach((config) => {
      let chVal = mix[config.id];
      if (chVal === undefined && config.id === "coffee") {
        chVal = mix.cafe;
      }
      const channelVol = chVal !== undefined
        ? Math.max(0, Math.min(1, Number(chVal) / 100))
        : (state.channels[config.id]?.volume ?? 0);

      const layers = {};
      config.layers.forEach((layer) => {
        if (mix[layer.id] !== undefined) {
          layers[layer.id] = Math.max(0, Math.min(1, Number(mix[layer.id]) / 100));
        } else {
          layers[layer.id] = state.channels[config.id]?.layers?.[layer.id] ?? 0;
        }
      });

      levels[config.id] = {
        channel: channelVol,
        layers,
      };
    });
    return levels;
  }

  async function handleUserMessage(userText) {
    const clean = userText.trim().slice(0, 500);
    if (!clean) return;

    // 1. Crisis check FIRST — before any model call
    if (isCrisisText(clean)) {
      appendMessage("user", clean);
      if (input) input.value = "";
      appendCrisisBubble();
      return;
    }

    // 2. Local-first parser: fast, deterministic, zero-token cost
    const savedMixes = typeof getSavedMixes === "function" ? getSavedMixes() : [];
    const localCmd = parseCommand(clean, {
      state,
      soundscapes,
      savedMixes,
      usualLevels: currentUsualLevels,
    });
    if (localCmd) {
      appendMessage("user", clean);
      if (input) input.value = "";
      if (localCmd.actions?.length) {
        const { masterClipped } = await executor.executeActions(localCmd.actions, { fromChat: true });
        updateUndoButton();
        if (masterClipped && !localCmd.reply.includes("comfortable level")) {
          localCmd.reply += " I kept the volume at a comfortable level.";
        }
        const hasMixChange = localCmd.actions.some((a) =>
          ["preset", "surprise", "apply_mix", "target_delta", "target_set", "set", "adjust"].includes(a.type)
        );
        const mixChip = hasMixChange ? getActiveChannelsSummary() : null;
        appendMessage("assistant", localCmd.reply, { mixChip, hasUndo: Boolean(mixChip) });

        // Record locally handled command to user history and mood in MongoDB
        const presetAction = localCmd.actions.find((a) => a.type === "preset" || a.type === "surprise");
        const lowerClean = clean.toLowerCase();
        const detectedMood = presetAction?.name || (lowerClean.includes("warm") ? "cozy" : lowerClean.includes("crowd") ? "calm" : lowerClean.includes("focus") ? "focused" : lowerClean.includes("sleep") ? "sleepy" : null);
        const mixSnapshot = getCurrentMixSnapshot();
        recordLocalChat(clean, localCmd.reply, detectedMood, mixSnapshot);
      } else {
        appendMessage("assistant", localCmd.reply);
        recordLocalChat(clean, localCmd.reply);
      }
      return;
    }

    appendMessage("user", clean);
    if (input) input.value = "";

    // 3. Fallback to AI when local parser returns null
    const thinkingMsg = { role: "assistant", text: "Thinking…", thinking: true };
    messages.push(thinkingMsg);
    renderMessages();
    announce("Thinking…");

    if (input) input.disabled = true;
    if (sendButton) sendButton.disabled = true;

    try {
      // Keep token usage low: last 6 messages only
      const recentMessages = messages
        .filter((m) => !m.thinking && (m.role === "user" || m.role === "assistant"))
        .slice(-6);

      const currentMix = getCurrentMixSnapshot();
      const aiResult = await askAssistant(clean, recentMessages, currentMix);

      // Remove typing indicator
      const thinkingIdx = messages.indexOf(thinkingMsg);
      if (thinkingIdx !== -1) {
        messages.splice(thinkingIdx, 1);
      }

      if (aiResult.safety) {
        appendCrisisBubble();
      } else {
        let mixChip = null;
        // If AI returned mix adjustments, apply them smoothly over 2s to sliders and sound
        if (aiResult.mix && typeof aiResult.mix === "object" && Object.keys(aiResult.mix).length > 0) {
          const targetLevels = mixToLevels(aiResult.mix);
          if (targetLevels) {
            await executor.executeActions([
              { type: "preset", name: aiResult.mood || "AI Mix", levels: targetLevels }
            ], { fromChat: true });
            updateUndoButton();
            mixChip = formatMixChip(aiResult.mix);
          }
        }
        appendMessage("assistant", aiResult.reply, { mixChip, hasUndo: Boolean(mixChip) });
      }
    } finally {
      if (input) {
        input.disabled = false;
        input.focus();
      }
      if (sendButton) sendButton.disabled = false;
    }
  }

  let historyLoaded = false;
  async function loadHistory() {
    if (historyLoaded) return;
    try {
      const { messages: hist, profile } = await getChatHistory();
      if (profile) {
        currentUserProfile = profile;
        if (profile.usualMix) {
          currentUsualLevels = mixToLevels(profile.usualMix);
        }
      }

      if (Array.isArray(hist) && hist.length > 0) {
        messages.length = 0;
        hist.forEach((m) => {
          messages.push({
            role: m.role === "user" ? "user" : "assistant",
            text: m.text,
          });
        });
        // If user has a personalized profile greeting, show it as the session greeting
        if (profile?.greeting) {
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.text !== profile.greeting) {
            messages.push({
              role: "assistant",
              text: profile.greeting,
            });
          }
        }
        while (messages.length > MAX_MESSAGES) {
          messages.shift();
        }
      } else if (profile?.greeting) {
        // Personalized first-message greeting using mood history
        messages[0] = {
          role: "assistant",
          text: profile.greeting,
        };
      }
      renderMessages();
      historyLoaded = true;
    } catch {
      historyLoaded = true;
    }
  }

  // Register non-modal overlay
  if (panel) {
    registerOverlay("assistantPanel", {
      element: panel,
      contentElement: panel,
      usesScrim: false,
      trapFocus: false,
      dismissOnOutside: false,
      open: async () => {
        panel.hidden = false;
        button?.setAttribute("aria-expanded", "true");
        await loadHistory();
        renderMessages();
        updateUndoButton();
        announce("Sound assistant opened.");
      },
      close: () => {
        panel.hidden = true;
        button?.setAttribute("aria-expanded", "false");
        announce("Sound assistant closed.");
      },
    });
  }

  if (button) {
    button.addEventListener("click", () => {
      if (isOverlayOpen("assistantPanel")) {
        closeOverlay("assistantPanel");
      } else {
        openOverlay("assistantPanel", {
          trigger: button,
          focusTarget: input,
        });
      }
    });
  }

  if (closeButton) {
    closeButton.addEventListener("click", () => {
      closeOverlay("assistantPanel");
    });
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!input) return;
      handleUserMessage(input.value);
    });
  }

  if (undoButton) {
    undoButton.addEventListener("click", async () => {
      await executor.undo();
      appendMessage("assistant", "Undid last adjustment.");
      updateUndoButton();
    });
  }

  if (timerCancelBtn) {
    timerCancelBtn.addEventListener("click", () => {
      executor.cancelSleepTimer();
      appendMessage("assistant", "Sleep timer cancelled.");
    });
  }

  // Quick Chips
  if (chipsRow) {
    chipsRow.querySelectorAll("[data-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const action = chip.dataset.chip;
        if (!action) return;
        handleUserMessage(action);
      });
    });
  }

  renderMessages();
  updateUndoButton();
  loadHistory();

  return {
    open: () => openOverlay("assistantPanel", { trigger: button, focusTarget: input }),
    close: () => closeOverlay("assistantPanel"),
    isAssistantOpen: () => isOverlayOpen("assistantPanel"),
    getCurrentMoodTags: () => [...currentMoodTags],
  };
}

