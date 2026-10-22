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

  // App overview & feature questions (answering accurately about this app)
  if (/(?:what\s+is\s+this\s+app|what\s+does\s+this\s+app\s+do|about\s+this\s+app|about\s+ambient\s+sound\s+studio)/i.test(text)) {
    return {
      reply: "Ambient Sound Studio is an ambient soundscape mixer designed for focused work, deep study, reading, relaxation, and sleep. You can mix 4 distinct soundscapes (Rain, Coffee Shop, Fireplace, and procedural Nature), control 14 individual acoustic layers, use the AI Mood Mixer, set sleep timers, and save custom soundscapes.",
      mood: "calm",
      mix: {},
      changes: "Provided app overview.",
    };
  }

  if (/(?:what\s+features|app\s+features|feature\s+list|features\s+list|what\s+can\s+this\s+app\s+do|what\s+can\s+you\s+do)/i.test(text)) {
    return {
      reply: "Ambient Sound Studio features 4 soundscapes (Rain, Cafe, Fireplace, Nature), 14 acoustic layers, 100% procedural Web Audio synthesis for Nature, Natural Drift volume modulation, a Sleep Timer with 30s auto-fadeout, AI Mood Mixer, saved mixes with MongoDB storage, and accessibility keyboard shortcuts.",
      mood: "calm",
      mix: {},
      changes: "Listed app features.",
    };
  }

  if (/(?:what\s+sounds|available\s+sounds|channels|available\s+channels|layers)/i.test(text)) {
    return {
      reply: "We offer 4 soundscapes with 14 layers: Rain (Heavy rain, Light rain, Window, Roof, Thunder), Coffee Shop (Cafe atmosphere, Espresso, Chatter), Fireplace (Crackle, Firewood, Embers), and Nature (Wind, Stream, Waves, Crickets, Birds).",
      mood: "calm",
      mix: {},
      changes: "Described sound catalog.",
    };
  }

  if (/(?:nature\s+channel|how\s+does\s+nature|procedural)/i.test(text)) {
    return {
      reply: "The Nature channel is 100% procedurally synthesized in real-time with Web Audio nodes (noise generators, band-pass filters, LFO oscillators). Zero audio files are needed, and setting a layer to 0% suspends its nodes for 0 CPU usage.",
      mood: "calm",
      mix: {},
      changes: "Explained procedural Nature channel.",
    };
  }

  if (/(?:drift|natural\s+drift)/i.test(text)) {
    return {
      reply: "Natural Drift gently modulates active layer volumes by ±5–10% over slow cycles so background soundscapes feel organic and never repeat like a static loop.",
      mood: "calm",
      mix: {},
      changes: "Explained Natural Drift.",
    };
  }

  if (/(?:how\s+does\s+(?:the\s+)?sleep\s+timer|how\s+does\s+(?:the\s+)?timer|sleep\s+timer\s+features?)/i.test(text)) {
    return {
      reply: "The Sleep Timer counts down live in the bottom dock and softly fades out your soundscape over 30 seconds before pausing playback. You can set it via the UI slider or say 'sleep in 30 mins' or 'sleep timer 10s'.",
      mood: "sleepy",
      mix: {},
      changes: "Explained Sleep Timer.",
    };
  }

  if (/(?:save\s+(?:a\s+)?mix|saved\s+mixes|how\s+to\s+save)/i.test(text)) {
    return {
      reply: "Sign in and click 'Save Mix' in the top right or bottom dock to save your current soundscape to your account. You can rename, delete, or reload it anytime, or trigger 'Play my usual'!",
      mood: "calm",
      mix: {},
      changes: "Explained Saved Mixes.",
    };
  }

  if (/(?:shortcuts|keyboard\s+shortcuts|hotkeys)/i.test(text)) {
    return {
      reply: "Keyboard shortcuts: Space (Play/Pause), M (Mute/Unmute), and Esc (Close dialogs and drawers).",
      mood: "calm",
      mix: {},
      changes: "Explained Keyboard Shortcuts.",
    };
  }

  // Out-of-scope / general knowledge check (app-only assistant refusal)
  if (/(?:factorial|\bcode\b|python|javascript|java|c\+\+|html|css|sql|math|\d+\s*[\+\-\*\/]\s*\d+|capital\s+of|recipe|who\s+is|who\s+was|who\s+won|joke|calculate|derivative|integral|equation|weather|president|population|translate|poem|flight|hotel|ticket|movie|game|news|sports)/i.test(text)) {
    return {
      reply: "I'm specifically the assistant for Ambient Sound Studio! I can only help you explore ambient soundscapes (Rain, Coffee Shop, Fireplace, Nature), set sleep timers, adjust audio levels, or explain app features. I can't answer general questions or math/coding problems, but I'd be happy to play a quiet focus mix if you're studying!",
      mood: "focused",
      mix: {},
      changes: "No sound changes for off-topic query.",
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

  // Exclusive / Solo sound requests
  if (/(?:waves|ocean|surf|sea)/i.test(text)) {
    if (/(?:nothing\s+else|only|just|solo)/i.test(text)) {
      return {
        reply: "Sure, playing just the soothing ocean waves for you.",
        mood: "calm",
        mix: {
          nature: 65,
          waves: 70,
          wind: 0,
          stream: 0,
          birds: 0,
          crickets: 0,
          rain: 0,
          cafe: 0,
          fire: 0,
        },
        changes: "Playing only ocean waves, muted all other sounds.",
      };
    }
    return {
      reply: "Turned up the soothing ocean waves.",
      mood: "calm",
      mix: {
        nature: 65,
        waves: 70,
      },
      changes: "Increased ocean waves.",
    };
  }

  if (/(?:rain|storm|thunder)/i.test(text) && /(?:nothing\s+else|only|just|solo)/i.test(text)) {
    return {
      reply: "Playing only the rain, with all other sounds muted.",
      mood: "calm",
      mix: {
        rain: 70,
        "heavy-rain": 50,
        "light-rain": 30,
        cafe: 0,
        fire: 0,
        nature: 0,
      },
      changes: "Playing only rain.",
    };
  }

  if (/(?:fire|fireplace|crackle)/i.test(text) && /(?:nothing\s+else|only|just|solo)/i.test(text)) {
    return {
      reply: "Playing only the warm fireplace, with all other sounds muted.",
      mood: "cozy",
      mix: {
        fire: 70,
        crackle: 60,
        firewood: 40,
        rain: 0,
        cafe: 0,
        nature: 0,
      },
      changes: "Playing only fireplace.",
    };
  }

  if (/(?:coffee|cafe|chatter)/i.test(text) && /(?:nothing\s+else|only|just|solo)/i.test(text)) {
    return {
      reply: "Playing only the coffee shop ambience, with all other sounds muted.",
      mood: "focused",
      mix: {
        cafe: 65,
        chatter: 50,
        espresso: 30,
        rain: 0,
        fire: 0,
        nature: 0,
      },
      changes: "Playing only coffee shop.",
    };
  }

  if (/(?:turn\s+off\s+(?:the\s+)?rain|mute\s+(?:the\s+)?rain|stop\s+(?:the\s+)?rain)/i.test(text)) {
    return {
      reply: "Muted the rain channel and all rain layers.",
      mood: "calm",
      mix: {
        rain: 0,
        "heavy-rain": 0,
        "light-rain": 0,
        window: 0,
        roof: 0,
        thunder: 0,
      },
      changes: "Turned off rain channel.",
    };
  }

  if (/(?:forest\s+at\s+night|take\s+me\s+to\s+a\s+forest\s+at\s+night)/i.test(text)) {
    return {
      reply: "Transported you to a quiet forest at night with gentle wind and crickets.",
      mood: "calm",
      mix: {
        nature: 65,
        crickets: 45,
        wind: 35,
        stream: 25,
        rain: 0,
        cafe: 0,
        fire: 0,
      },
      changes: "Set night forest ambience with crickets and wind.",
    };
  }

  if (/(?:more\s+natural|natural\s+vibe|natural|nature|forest|wind|stream|birds|waves|crickets)/i.test(text)) {
    const curNature = Number(currentMix.nature ?? 0);
    const newNature = Math.min(100, Math.max(50, curNature + 25));
    const curWind = Number(currentMix.wind ?? 0);
    const curStream = Number(currentMix.stream ?? 0);
    const curBirds = Number(currentMix.birds ?? 0);
    const curCrickets = Number(currentMix.crickets ?? 0);
    return {
      reply: "Surrounded you with forest breeze, flowing water, and birdsong.",
      mood: "calm",
      mix: {
        nature: newNature,
        wind: Math.min(100, curWind + 30),
        stream: Math.min(100, curStream + 25),
        birds: Math.min(100, curBirds + 20),
        crickets: curCrickets > 0 ? curCrickets : 20,
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

  // Fallback for general or unrecognized queries: strictly maintain app-only identity without touching mix
  return {
    reply: "I'm specifically the assistant for Ambient Sound Studio! I can help you create ambient soundscapes (Rain, Coffee Shop, Fireplace, Nature), set sleep timers, adjust sound levels, or answer questions about this app's features. Would you like a focus or relaxation mix?",
    mood: "calm",
    mix: {},
    changes: "No sound changes for unrecognized query.",
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
