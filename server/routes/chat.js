import { Router } from "express";
import { z } from "zod";
import { isCrisisText, CRISIS_MESSAGE } from "../../public/js/config/safety.js";
import {
  soundscapes,
  CHANNELS,
  LAYERS,
  ALL_VALID_MIX_KEYS,
  CHANNEL_BY_LAYER,
  normalizeMixKey,
} from "../../public/js/config/soundscapes.js";
import { callGroq } from "../services/groq.js";
import { isDatabaseConnected } from "../config/db.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { MoodEntry } from "../models/MoodEntry.js";
import { computeUserMoodAnalytics } from "../services/moodAnalytics.js";

const router = Router();

const ALLOWED_MOODS = [
  "calm",
  "focused",
  "sleepy",
  "cozy",
  "stressed",
  "sad",
  "happy",
  "energetic",
];

const MOOD_SYNONYMS = {
  relaxing: "calm",
  soothing: "calm",
  peaceful: "calm",
  gentle: "calm",
  serene: "calm",
  tranquil: "calm",
  nature: "calm",
  ocean: "calm",
  meditative: "calm",
  chill: "calm",
  productive: "focused",
  study: "focused",
  work: "focused",
  concentrated: "focused",
  tired: "sleepy",
  bedtime: "sleepy",
  rest: "sleepy",
  restful: "sleepy",
  night: "sleepy",
  warm: "cozy",
  comfy: "cozy",
  comfort: "cozy",
  fireside: "cozy",
  anxious: "stressed",
  overwhelmed: "stressed",
};

const chatSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(500),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().max(500),
      })
    )
    .max(6)
    .optional(),
  currentMix: z.record(z.any()).optional(),
});

const SYSTEM_PROMPT = `You are exclusively the Sound Assistant for Ambient Sound Studio, an ambient soundscape mixer web application.
You ONLY assist with ambient soundscapes (Rain, Coffee Shop, Fireplace, Nature), mood blends, volume levels, sleep timers, and explaining this app's features.

CRITICAL APP-ONLY SCOPE RULES:
1. You are NOT a general-purpose AI, public search engine, math calculator, or coding assistant.
2. If the user asks ANY general knowledge, math (e.g. "find factorial of 9", "1+2"), coding/programming (e.g. "write code in python"), trivia, recipes, homework, weather, or off-topic questions unrelated to Ambient Sound Studio:
   - NEVER answer the general question.
   - Politely decline and state clearly that you are exclusively the Ambient Sound Studio assistant for ambient sounds, sleep timers, and app features.
   - Example decline: "I'm specifically the assistant for Ambient Sound Studio! I can only help you explore ambient soundscapes (Rain, Coffee Shop, Fireplace, Nature), set sleep timers, adjust audio levels, or explain app features. I can't answer general questions or math/coding problems, but I'd be happy to play a relaxing focus mix if you're working or studying!"
   - Set "mix": {} (do NOT alter sound levels for off-topic queries).
   - Set "changes": "No sound changes for off-topic query."
3. APP FEATURES & SOUNDSCAPES KNOWLEDGE BASE (use this to accurately answer questions about this app):
   • Soundscapes (4 channels):
     - Rain: Heavy rain, Light rain, Rain on window, Rain on roof, Distant thunder.
     - Coffee Shop: Cafe atmosphere, Espresso machine, Background chatter.
     - Fireplace: Fire crackle, Burning firewood, Glowing embers.
     - Nature: 100% procedural Web Audio synthesis (zero MP3 files) featuring Wind, Flowing Stream, Ocean Waves, Crickets, and Bird chirps.
   • Web Audio Procedural Synthesis: Nature sounds are synthesized in the browser in real-time using Web Audio API nodes (band-pass filtered noise, LFO oscillators, dynamic pitch sweeps). Setting a layer slider to 0% suspends audio nodes for 0 CPU usage.
   • Natural Drift: Slowly modulates active layer levels by ±5-10% over time so background audio feels organic and never repeats like a static loop.
   • Sleep Timer: Live countdown in bottom transport dock and assistant banner; automatically fades out audio smoothly over 30 seconds before pausing.
   • AI Mood Mixer: One-shot mood generator (POST /api/mix) creating custom blends from descriptive prompts.
   • Saved Mixes & Personalization: MongoDB-stored custom mixes, renaming, deleting, and 1-click 'Play my usual' presets.
   • Keyboard Shortcuts: Space (Play/Pause), M (Mute/Unmute), Esc (Close dialogs and drawers).
   When explaining app features, answer clearly and accurately, and set "mix": {} unless the user specifically asks to play or change sounds.
4. For soundscape and mood requests:
   - "reply": 1-2 warm, concise sentences acknowledging what was changed.
   - "mood": exactly one of [calm, focused, sleepy, cozy, stressed, sad, happy, energetic] (default to "calm" or "cozy").
   - "mix": A JSON OBJECT mapping sound keys to integer percentages 0 to 100.
     CRITICAL: "mix" MUST be an object like {"coffee": 60, "chatter": 50}. NEVER output a string or an array!
     Available Channel keys: rain, coffee, fire, nature.
     Available Layer keys: heavy-rain, light-rain, window, roof, thunder, chatter, espresso, crackle, firewood, embers, wind, stream, birds, crickets, waves.
   - SEMANTIC MAPPINGS FOR NATURAL USER REQUESTS:
     • "crowd", "conversation", "talking", "voices", "people", "chatter" -> {"coffee": 55, "chatter": 50}
     • "coffee shop", "cafe", "cofee", "espresso" -> {"coffee": 60, "chatter": 40, "espresso": 25}
     • "rain", "storm", "rainfall" -> {"rain": 60, "heavy-rain": 50}
     • "nature", "natural", "forest", "breeze", "birds", "stream" -> {"nature": 60, "wind": 35, "stream": 30, "birds": 30}
     • "fire", "fireplace", "warmth", "cozy", "crackle" -> {"fire": 60, "crackle": 50}
   - ADDING / BLENDING REQUESTS (e.g. "add rain", "add cofee shop crowd to this", "need to add warm conversation", "natural vibe with rain"):
     Keep the existing active sounds from (Current mix: ...) and ADD the new sound levels! Do NOT mute current active sounds unless user explicitly requested "only", "just", "solo", or "exclusive".
   - "changes": short description of adjustments made.

Output valid JSON only with keys: "reply", "mood", "mix", "changes".`;

export function computeMixDiff(currentMix = {}, newMix = {}) {
  const diffs = [];
  const checkedKeys = new Set();
  const allKeys = [...Object.keys(currentMix), ...Object.keys(newMix)];

  for (const rawKey of allKeys) {
    const key = normalizeMixKey(rawKey) || rawKey;
    if (checkedKeys.has(key)) continue;
    checkedKeys.add(key);

    if (!ALL_VALID_MIX_KEYS.includes(key) && key !== "cafe") continue;

    const oldRaw = currentMix[rawKey] !== undefined ? currentMix[rawKey] : currentMix[key];
    const oldVal = oldRaw !== undefined && Number.isFinite(Number(oldRaw)) ? Number(oldRaw) : 0;
    const newRaw = newMix[key] !== undefined ? newMix[key] : (newMix[rawKey] !== undefined ? newMix[rawKey] : oldVal);
    const newVal = newRaw !== undefined && Number.isFinite(Number(newRaw)) ? Number(newRaw) : oldVal;

    if (Math.abs(newVal - oldVal) >= 2) {
      diffs.push({
        key,
        oldVal: Math.round(oldVal),
        newVal: Math.round(newVal),
        delta: Math.round(newVal - oldVal),
      });
    }
  }
  return diffs;
}

export function buildChangesSummary(diffs) {
  if (!diffs || diffs.length === 0) return "No sound changes.";
  return diffs
    .map((d) => {
      const sign = d.delta > 0 ? "+" : "";
      return `${d.key}: ${d.newVal}% (${sign}${d.delta}%)`;
    })
    .join(", ");
}

export function buildHonestReply(diffs, originalReply = "") {
  if (!diffs || diffs.length === 0) {
    return "I couldn't change anything for that, try asking for a specific sound.";
  }
  const parts = diffs.map((d) => {
    const action = d.delta > 0 ? "raised" : "lowered";
    return `${action} ${d.key} to ${d.newVal}%`;
  });
  return `Adjusted your mix: ${parts.join(", ")}.`;
}

export function applyRelativeFallback(message, currentMix = {}) {
  const text = (message || "").toLowerCase().replace(/[.,!?;]/g, " ");
  const resMix = { ...currentMix };
  let applied = false;

  // Rain requests (e.g. "add rain", "natural vibe with rain", "rain")
  if (/(?:rain|rainy|storm|thunder|downpour|rainfall)/i.test(text)) {
    const curRain = Number(currentMix.rain ?? 0);
    resMix.rain = Math.max(55, curRain + 25);
    resMix["heavy-rain"] = Math.max(40, Number(currentMix["heavy-rain"] ?? 0) + 20);
    if (/thunder|storm/i.test(text)) {
      resMix.thunder = 35;
    }
    applied = true;
  }

  // Coffee / Cafe / Crowd / Conversation requests (including typos like cofee, coffe)
  if (/(?:coffe|cofee|cafe|caffee|espresso|latte|chatter|crowd|conversation|people|talking|voices|bustle)/i.test(text)) {
    const curCoffee = Number(currentMix.coffee ?? currentMix.cafe ?? 0);
    resMix.coffee = Math.max(55, curCoffee + 25);
    resMix.cafe = resMix.coffee;
    if (/(?:crowd|conversation|talking|people|voices|chatter|bustle)/i.test(text)) {
      resMix.chatter = Math.max(50, Number(currentMix.chatter ?? 0) + 25);
    }
    if (/(?:espresso|machine)/i.test(text)) {
      resMix.espresso = Math.max(30, Number(currentMix.espresso ?? 0) + 20);
    }
    applied = true;
  }

  // Nature / breeze / stream / birds / waves / crickets
  if (/(?:nature|natural|forest|trees|woodland|breeze|wind|stream|river|water|creek|bird|chirp|wave|ocean|sea|cricket|cicada)/i.test(text)) {
    const curNature = Number(currentMix.nature ?? 0);
    resMix.nature = Math.max(55, curNature + 25);
    if (/(?:wind|breeze)/i.test(text) || !/(?:stream|bird|cricket|wave)/i.test(text)) {
      resMix.wind = Math.max(35, Number(currentMix.wind ?? 0) + 20);
    }
    if (/(?:stream|water|river|creek)/i.test(text) || !/(?:wind|bird|cricket|wave)/i.test(text)) {
      resMix.stream = Math.max(30, Number(currentMix.stream ?? 0) + 20);
    }
    if (/(?:bird|birds|chirp)/i.test(text) || !/(?:wind|stream|cricket|wave)/i.test(text)) {
      resMix.birds = Math.max(30, Number(currentMix.birds ?? 0) + 20);
    }
    if (/(?:cricket|cicada)/i.test(text)) {
      resMix.crickets = Math.max(25, Number(currentMix.crickets ?? 0) + 20);
    }
    if (/(?:wave|ocean|sea|surf)/i.test(text)) {
      resMix.waves = Math.max(50, Number(currentMix.waves ?? 0) + 25);
    }
    applied = true;
  }

  // Fire / warmth / crackle
  if (/(?:fire|fireplace|warm|warmth|cozy|cozier|crackle|embers|wood)/i.test(text)) {
    const curFire = Number(currentMix.fire ?? 0);
    resMix.fire = Math.max(55, curFire + 25);
    resMix.crackle = Math.max(45, Number(currentMix.crackle ?? 0) + 20);
    applied = true;
  }

  // Less crowded / quieter cafe
  if (/(?:less\s+crowded|quieter\s+cafe|less\s+noise|quiet\s+cafe)/i.test(text)) {
    const curChatter = Number(currentMix.chatter ?? 50);
    const curCoffee = Number(currentMix.coffee ?? currentMix.cafe ?? 40);
    resMix.chatter = Math.max(0, curChatter - 30);
    resMix.coffee = Math.max(0, curCoffee - 20);
    resMix.cafe = resMix.coffee;
    applied = true;
  }

  // Night forest preset
  if (/(?:forest\s+at\s+night|take\s+me\s+to\s+a\s+forest\s+at\s+night)/i.test(text)) {
    resMix.nature = 65;
    resMix.crickets = 45;
    resMix.wind = 35;
    resMix.stream = 25;
    resMix.rain = 0;
    resMix.coffee = 0;
    resMix.cafe = 0;
    resMix.fire = 0;
    applied = true;
  }

  // Turn off rain
  if (/(?:turn\s+off\s+(?:the\s+)?rain|mute\s+(?:the\s+)?rain|stop\s+(?:the\s+)?rain)/i.test(text)) {
    resMix.rain = 0;
    resMix["heavy-rain"] = 0;
    resMix["light-rain"] = 0;
    resMix.window = 0;
    resMix.roof = 0;
    resMix.thunder = 0;
    applied = true;
  }

  // Exclusive / Solo sound requests
  if (/(?:nothing\s+else|only|just|solo|exclusive)/i.test(text)) {
    if (!/(?:rain|storm)/i.test(text)) resMix.rain = 0;
    if (!/(?:coffe|cofee|cafe|crowd|conversation)/i.test(text)) { resMix.coffee = 0; resMix.cafe = 0; }
    if (!/(?:fire|warm|crackle)/i.test(text)) resMix.fire = 0;
    if (!/(?:nature|natural|wind|stream|bird|cricket|wave)/i.test(text)) resMix.nature = 0;
  }

  return applied ? resMix : null;
}

export function validateAndCleanResponse(rawText, currentMix = {}) {
  if (!rawText || typeof rawText !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  if (typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    return null;
  }
  const reply = parsed.reply.trim();

  // Normalize mood through synonyms (e.g. "soothing" -> "calm", "relaxing" -> "calm", "warm" -> "cozy")
  let mood = typeof parsed.mood === "string" ? parsed.mood.toLowerCase().trim() : "";
  if (MOOD_SYNONYMS[mood]) {
    mood = MOOD_SYNONYMS[mood];
  }

  // If mood is missing or not allowed, fall back to { reply } only
  if (!ALLOWED_MOODS.includes(mood)) {
    return { reply };
  }

  // If mix is missing or not an object, fall back to { reply } only
  if (!parsed.mix || typeof parsed.mix !== "object" || Array.isArray(parsed.mix)) {
    return { reply };
  }

  // Validate and clamp mix values (0-100), map aliases, drop unknown keys
  const clampedMix = {};
  for (const [key, val] of Object.entries(parsed.mix)) {
    const normalizedKey = normalizeMixKey(key);
    if (normalizedKey && ALL_VALID_MIX_KEYS.includes(normalizedKey)) {
      const num = Number(val);
      if (Number.isFinite(num)) {
        clampedMix[normalizedKey] = Math.max(0, Math.min(100, Math.round(num)));
      }
    }
  }

  // Ensure parent channel is audible if a layer was set > 0
  for (const [key, val] of Object.entries(clampedMix)) {
    const parentChannel = CHANNEL_BY_LAYER[key];
    if (parentChannel && val > 0 && clampedMix[parentChannel] === undefined) {
      const curParent = Number(currentMix[parentChannel] || 0);
      clampedMix[parentChannel] = Math.max(curParent, Math.max(40, val));
    }
  }

  const changes = typeof parsed.changes === "string" ? parsed.changes.trim() : "";

  return {
    reply,
    mood,
    mix: clampedMix,
    changes,
  };
}

router.post("/", async (request, response) => {
  let parsed;
  try {
    parsed = chatSchema.parse(request.body);
  } catch {
    return response.status(400).json({ error: "Message is required" });
  }

  const { message, history, currentMix } = parsed;

  // 1. Run isCrisisText first. If crisis is detected, immediately return the fixed helpline message.
  if (isCrisisText(message)) {
    return response.json({
      reply: CRISIS_MESSAGE,
      safety: true,
    });
  }

  // 2. Auth required for chatting with the model
  if (!request.session?.userId) {
    return response.status(401).json({ error: "Authentication required" });
  }

  // Format current mix for relative adjustments if provided
  let mixContext = "";
  if (currentMix && typeof currentMix === "object" && Object.keys(currentMix).length > 0) {
    const entries = Object.entries(currentMix)
      .map(([k, v]) => [normalizeMixKey(k) || k.toLowerCase(), v])
      .filter(([k, v]) => ALL_VALID_MIX_KEYS.includes(k) && Number.isFinite(Number(v)))
      .map(([k, v]) => `${k}:${Math.round(Number(v))}`);
    if (entries.length > 0) {
      mixContext = `\n(Current mix: ${entries.join(", ")})`;
    }
  }

  // 3. Keep token usage low: short system prompt + one-line user mood profile + last 6 messages only
  let userProfileOneLiner = "";
  if (request.session?.userId && isDatabaseConnected()) {
    try {
      const profile = await computeUserMoodAnalytics(request.session.userId);
      if (profile?.summary) {
        userProfileOneLiner = `\n${profile.summary}`;
      }
    } catch {}
  }

  const recentHistory = (history || []).slice(-6);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT + userProfileOneLiner },
    ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message + mixContext },
  ];

  const result = await callGroq({
    messages,
    maxTokens: 600,
    jsonMode: true,
    currentMix,
  });

  if (result.error) {
    if (result.error === "busy") {
      return response.status(429).json({ error: "busy", retryAfter: result.retryAfter || 60 });
    }
    return response.status(503).json({ error: "service_unavailable" });
  }

  const validated = validateAndCleanResponse(result.text, currentMix);
  const responseData = validated || {
    reply: result.reply || result.text || "I'm here to help with your ambient soundscape.",
    mix: {},
    changes: "",
  };

  // If model output string/array in mix, recover polymorphic keys
  if (!responseData.mix || Object.keys(responseData.mix).length === 0) {
    try {
      const parsed = JSON.parse(result.text);
      if (typeof parsed?.mix === "string" || Array.isArray(parsed?.mix)) {
        const rawItems = Array.isArray(parsed.mix) ? parsed.mix : [parsed.mix];
        const extracted = {};
        for (const item of rawItems) {
          if (typeof item === "string") {
            const k = normalizeMixKey(item);
            if (k) extracted[k] = 60;
            else if (/coffee|cafe|crowd|conversation|chatter/i.test(item)) { extracted.coffee = 60; extracted.chatter = 50; }
            else if (/rain/i.test(item)) { extracted.rain = 60; }
            else if (/fire/i.test(item)) { extracted.fire = 60; }
            else if (/nature|wind|stream|bird|cricket|wave/i.test(item)) { extracted.nature = 60; }
          }
        }
        if (Object.keys(extracted).length > 0) {
          responseData.mix = extracted;
          if (!responseData.mood) responseData.mood = "calm";
        }
      }
    } catch {}
  }

  // Compute real diff between current mix and proposed new mix
  let diffs = computeMixDiff(currentMix, responseData.mix || {});

  // Check if user requested sound changes or if model claimed sound changes
  const isOffTopicOrInfo =
    (typeof responseData.changes === "string" && /no sound changes|provided app|explained|listed/i.test(responseData.changes)) ||
    /(?:specifically the assistant for Ambient Sound Studio|Ambient Sound Studio is an ambient soundscape mixer)/i.test(responseData.reply || "");

  // If diff is empty, check for deterministic relative fallback
  const relativeFallback = applyRelativeFallback(message, currentMix);
  if (diffs.length === 0) {
    if (relativeFallback) {
      responseData.mix = relativeFallback;
      diffs = computeMixDiff(currentMix, responseData.mix);
      if (!responseData.mood) responseData.mood = "calm";
    }
  } else if (relativeFallback && !isOffTopicOrInfo) {
    // If user asked for compound sounds (e.g. "natural vibe with rain"), ensure all mentioned sounds are blended
    for (const [k, v] of Object.entries(relativeFallback)) {
      if (responseData.mix[k] === undefined) {
        responseData.mix[k] = v;
      }
    }
    diffs = computeMixDiff(currentMix, responseData.mix);
  }

  const claimsChange =
    !isOffTopicOrInfo &&
    (/(?:added|increased|raised|lowered|boosted|turned up|turned down|playing only|enriched|surrounded you)/i.test(responseData.reply || "") ||
      (typeof responseData.changes === "string" && responseData.changes.length > 0 && !responseData.changes.includes("No sound changes")));

  if (diffs.length === 0) {
    if (claimsChange) {
      // Model claimed changes, but nothing actually changed: give honest message
      responseData.reply = "I couldn't change anything for that, try asking for a specific sound.";
      responseData.changes = "No sound changes.";
      responseData.mix = {};
    }
  } else {
    // There ARE real changes: ensure changes summary is strictly computed from diff
    responseData.changes = buildChangesSummary(diffs);
    if (!responseData.reply || claimsChange) {
      responseData.reply = buildHonestReply(diffs, responseData.reply);
    }
  }

  // In MongoDB, store per user: chat messages (role, text, time) and a mood entry (mood, mix, time)
  // after each successful reply. Do not store crisis messages as moods.
  if (request.session?.userId && isDatabaseConnected()) {
    try {
      const now = new Date();
      await ChatMessage.create([
        {
          userId: request.session.userId,
          role: "user",
          text: message,
          time: now,
        },
        {
          userId: request.session.userId,
          role: "assistant",
          text: responseData.reply,
          time: new Date(now.getTime() + 1),
        },
      ]);

      if (responseData.mood) {
        await MoodEntry.create({
          userId: request.session.userId,
          mood: responseData.mood,
          mix: responseData.mix || {},
          time: now,
        });
      }
    } catch (err) {
      console.error("[chat-db] failed to record chat/mood:", err?.message || err);
    }
  }

  return response.json(responseData);
});

router.get("/history", async (request, response) => {
  if (!request.session?.userId || !isDatabaseConnected()) {
    return response.json({ messages: [], profile: null });
  }

  try {
    const msgs = await ChatMessage.find({ userId: request.session.userId })
      .sort({ time: -1 })
      .limit(30)
      .lean();

    msgs.reverse();

    const profile = await computeUserMoodAnalytics(request.session.userId);

    return response.json({
      messages: msgs.map((m) => ({
        role: m.role,
        text: m.text,
        time: m.time,
      })),
      profile,
    });
  } catch (error) {
    return response.json({ messages: [], profile: null });
  }
});

const recordSchema = z.object({
  message: z.string().trim().min(1).max(500),
  reply: z.string().trim().min(1).max(500),
  mood: z.string().trim().max(50).nullable().optional(),
  mix: z.record(z.any()).nullable().optional(),
});

router.post("/record", async (request, response) => {
  if (!request.session?.userId || !isDatabaseConnected()) {
    return response.json({ ok: false });
  }

  try {
    const { message, reply, mood, mix } = recordSchema.parse(request.body);
    const now = new Date();
    await ChatMessage.create([
      { userId: request.session.userId, role: "user", text: message, time: now },
      { userId: request.session.userId, role: "assistant", text: reply, time: new Date(now.getTime() + 1) },
    ]);

    if (mood) {
      await MoodEntry.create({
        userId: request.session.userId,
        mood,
        mix: mix || {},
        time: now,
      });
    }

    return response.json({ ok: true });
  } catch {
    return response.json({ ok: false });
  }
});

export default router;
