import { env, getEnv } from "../config/env.js";
import { LIMITS } from "../config/limits.js";

let circuitBreakerUntil = 0;
const ringBuffer = [];
const RING_BUFFER_LIMIT = 200;

export function recordCallStat(entry) {
  ringBuffer.push({
    timestamp: entry.timestamp || new Date().toISOString(),
    duration: entry.duration ?? 0,
    promptTokens: entry.promptTokens ?? 0,
    completionTokens: entry.completionTokens ?? 0,
    callerType: entry.callerType || "guest",
    status: entry.status || "success",
  });
  while (ringBuffer.length > RING_BUFFER_LIMIT) {
    ringBuffer.shift();
  }
}

export function getCallStats() {
  return [...ringBuffer];
}

export function resetCircuitBreaker() {
  circuitBreakerUntil = 0;
}

export function tripCircuitBreaker(seconds = 60) {
  circuitBreakerUntil = Date.now() + seconds * 1000;
}

export function isCircuitOpen() {
  if (Date.now() < circuitBreakerUntil) {
    return Math.ceil((circuitBreakerUntil - Date.now()) / 1000);
  }
  return 0;
}

function generateMockChat(userText, currentMix = {}) {
  const text = (userText || "").toLowerCase();

  // Crisis protocol check
  if (/(?:suicide|self-harm|kill\s+myself|end\s+it\s+all|hurt\s+myself|abuse|depression\s+crisis)/i.test(text)) {
    return {
      reply: "Please know you are not alone. Reach out to the Suicide & Crisis Lifeline by calling or texting 988, or text HOME to 741741.",
      mood: "calm",
      mix: {},
      changes: "Safety message provided.",
    };
  }

  if (/(?:warmer|warm|cozier|cozy)/i.test(text)) {
    const curFire = Number(currentMix.fire ?? 30);
    const curCrackle = Number(currentMix.crackle ?? 20);
    return {
      reply: "Turned up the fire crackle and embers for a warmer atmosphere.",
      mood: "cozy",
      mix: {
        fire: Math.min(100, curFire + 30),
        crackle: Math.min(100, curCrackle + 30),
        embers: 40,
      },
      changes: "Increased fire and crackle volume for warmth.",
    };
  }

  if (/(?:less\s+crowded|crowded|quiet|quieter\s+cafe)/i.test(text)) {
    const curChatter = Number(currentMix.chatter ?? 50);
    return {
      reply: "Lowered background chatter for a quieter, more peaceful space.",
      mood: "calm",
      mix: {
        cafe: 30,
        coffee: 30,
        chatter: Math.max(0, curChatter - 30),
      },
      changes: "Reduced cafe chatter volume.",
    };
  }

  if (/(?:nature|forest|wind|stream|birds|waves|crickets)/i.test(text)) {
    return {
      reply: "Surrounded you with forest breeze, flowing water, and birdsong.",
      mood: "calm",
      mix: {
        nature: 60,
        wind: 40,
        stream: 35,
        birds: 30,
      },
      changes: "Increased nature volume with wind and running stream.",
    };
  }

  if (/(?:storm|thunder|rain)/i.test(text)) {
    return {
      reply: "Deepened the rain layers and added gentle thunder.",
      mood: "focused",
      mix: {
        rain: 70,
        "heavy-rain": 60,
        thunder: 30,
      },
      changes: "Increased rain intensity and added thunder.",
    };
  }

  if (/(?:study|work|focus)/i.test(text)) {
    return {
      reply: "Set up a focused soundscape for deep work.",
      mood: "focused",
      mix: {
        cafe: 35,
        coffee: 35,
        espresso: 25,
        window: 30,
      },
      changes: "Blended light cafe ambience with window rain.",
    };
  }

  if (/(?:sleep|sleepy|night|bed)/i.test(text)) {
    return {
      reply: "Softened the ambience for a restful sleep.",
      mood: "sleepy",
      mix: {
        rain: 25,
        "light-rain": 25,
        embers: 20,
      },
      changes: "Reduced overall volume to soft rain and embers.",
    };
  }

  return {
    reply: "Adjusted the ambience to match your space.",
    mood: "calm",
    mix: {
      rain: 40,
      window: 30,
      fire: 20,
    },
    changes: "Created a balanced, calming mix.",
  };
}

export async function callGroq({
  system,
  user,
  messages,
  maxTokens = LIMITS.MAX_OUTPUT_TOKENS,
  apiKey = env.groqApiKey,
  model = env.groqChatModel,
  mock,
  jsonMode = false,
  currentMix,
}) {
  const isMock =
    mock ??
    (process.env.CHAT_MOCK === "1" ||
      getEnv("CHAT_MOCK") === "1" ||
      process.env.NODE_ENV === "test" ||
      getEnv("NODE_ENV") === "test" ||
      env.chatMock ||
      env.nodeEnv === "test");

  const retryAfter = isCircuitOpen();
  if (retryAfter > 0) {
    return { error: "busy", retryAfter };
  }

  if (isMock) {
    const lastUserMsg = user || messages?.filter((m) => m.role === "user").pop()?.content || "";
    const mockData = generateMockChat(lastUserMsg, currentMix);
    const rawText = JSON.stringify(mockData);
    const replyText = typeof mockData === "object" ? mockData.reply : String(mockData);
    const usage = {
      prompt_tokens: Math.min(120, 20 + Math.floor((lastUserMsg.length || 0) / 4)),
      completion_tokens: Math.min(60, 15 + Math.floor(replyText.length / 4)),
      total_tokens: 0,
    };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    return {
      text: rawText,
      reply: replyText,
      usage,
      durationMs: 15,
    };
  }

  if (!apiKey || !model) {
    return { error: "ai_unavailable" };
  }

  const payloadMessages = Array.isArray(messages) && messages.length > 0
    ? messages
    : [
        ...(system ? [{ role: "system", content: system }] : []),
        ...(user ? [{ role: "user", content: user }] : []),
      ];

  const requestBody = {
    model,
    messages: payloadMessages,
    temperature: 0.3,
    max_tokens: maxTokens,
  };

  // Reasoning models (e.g., openai/gpt-oss) spend hidden reasoning tokens;
  // configure lowest reasoning effort as required by the docs to avoid token exhaustion.
  if (/gpt-oss|reasoning|o1|o3/i.test(model)) {
    requestBody.reasoning_effort = "low";
  }

  if (jsonMode) {
    requestBody.response_format = { type: "json_object" };
  }

  const start = performance.now();
  let response;

  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(LIMITS.GROQ_TIMEOUT_MS),
    });
  } catch (error) {
    const ms = Math.round(performance.now() - start);
    if (error.name === "TimeoutError" || error.code === 23) {
      return { error: "timeout", durationMs: ms };
    }
    tripCircuitBreaker(60);
    return { error: "service_unavailable", durationMs: ms };
  }

  const ms = Math.round(performance.now() - start);

  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      tripCircuitBreaker(60);
    }
    if (response.status === 401 || response.status === 403) {
      return { error: "auth_error", durationMs: ms };
    }
    if (response.status === 429) {
      return { error: "busy", retryAfter: 60, durationMs: ms };
    }
    return { error: "service_unavailable", durationMs: ms };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { error: "service_unavailable", durationMs: ms };
  }

  const usage = data.usage || {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  // Only log token numbers and latency - NEVER log prompt, user text or response text.
  console.log(`[groq] tokens=${usage.total_tokens} (prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}) duration=${ms}ms`);

  const text = data.choices?.[0]?.message?.content || "";
  let reply = text.trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.reply === "string") {
      reply = parsed.reply;
    }
  } catch {}

  return {
    text,
    reply,
    usage,
    durationMs: ms,
  };
}
