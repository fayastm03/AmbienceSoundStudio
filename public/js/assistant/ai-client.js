// AI client for Ambient Sound Studio assistant.
// Calls POST /api/chat with { message, history, currentMix }.

export async function askAssistant(message, history = [], currentMix = null) {
  const clean = (message || "").trim().slice(0, 500);
  if (!clean) {
    return {
      reply: "Please enter a message.",
    };
  }

  // Keep token usage low: last 6 messages only
  const recentHistory = (history || [])
    .slice(-6)
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content || m.text || "").slice(0, 300),
    }));

  const payload = {
    message: clean,
    history: recentHistory,
  };

  if (currentMix && typeof currentMix === "object") {
    payload.currentMix = currentMix;
  }

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        return {
          authRequired: true,
          reply: "Please sign in to chat with the sound assistant.",
        };
      }
      if (response.status === 429) {
        return {
          reply: "The assistant is currently busy. Please try again in a few moments.",
        };
      }
      return {
        reply: data.error || "Something went wrong while reaching the assistant.",
      };
    }

    return {
      reply: data.reply || "I'm here to help with your ambient soundscape.",
      mood: data.mood,
      mix: data.mix,
      changes: data.changes,
      safety: Boolean(data.safety),
    };
  } catch {
    return {
      reply: "Could not reach the assistant. Please check your connection.",
    };
  }
}

export async function getChatHistory() {
  try {
    const response = await fetch("/api/chat/history");
    if (!response.ok) return { messages: [], profile: null };
    const data = await response.json();
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      profile: data.profile || null,
    };
  } catch {
    return { messages: [], profile: null };
  }
}
