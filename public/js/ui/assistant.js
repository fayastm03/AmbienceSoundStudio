// Conversational Ambience Assistant UI component.
// Non-modal floating chat panel on desktop, responsive bottom sheet on mobile.

import { registerOverlay, openOverlay, closeOverlay, isOverlayOpen } from "./overlay.js";
import { parseCommand } from "../assistant/commands.js";
import { createAssistantExecutor } from "../assistant/executor.js";
import { askAssistant } from "../assistant/ai-client.js";
import { isCrisisText, CRISIS_MESSAGE, HELPLINE_URL, HELPLINE_LABEL } from "../config/safety.js";

const MAX_MESSAGES = 20;

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

  function appendMessage(role, text, examples = [], thinking = false) {
    messages.push({ role, text, examples, thinking });
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
      messagesList.appendChild(bubble);
    });

    messagesList.scrollTop = messagesList.scrollHeight;
    messagesList.lastElementChild?.scrollIntoView({ block: "end", inline: "nearest" });
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

    appendMessage("user", clean);
    if (input) input.value = "";

    // 2. Typing indicator
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

      const aiResult = await askAssistant(clean, recentMessages);

      // Remove typing indicator
      const thinkingIdx = messages.indexOf(thinkingMsg);
      if (thinkingIdx !== -1) {
        messages.splice(thinkingIdx, 1);
      }

      if (aiResult.safety) {
        appendCrisisBubble();
      } else {
        appendMessage("assistant", aiResult.reply);
      }
    } finally {
      if (input) {
        input.disabled = false;
        input.focus();
      }
      if (sendButton) sendButton.disabled = false;
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
      open: () => {
        panel.hidden = false;
        button?.setAttribute("aria-expanded", "true");
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

  return {
    open: () => openOverlay("assistantPanel", { trigger: button, focusTarget: input }),
    close: () => closeOverlay("assistantPanel"),
    isAssistantOpen: () => isOverlayOpen("assistantPanel"),
    getCurrentMoodTags: () => [...currentMoodTags],
  };
}

