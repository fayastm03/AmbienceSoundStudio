import { Router } from "express";
import { z } from "zod";
import { isCrisisText, CRISIS_MESSAGE } from "../../public/js/config/safety.js";
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

const MIX_KEY_ALIASES = {
  ocean: "waves",
  "ocean-waves": "waves",
  wave: "waves",
  bird: "birds",
  birdsong: "birds",
  creek: "stream",
  river: "stream",
  water: "stream",
  cicadas: "crickets",
  cicada: "crickets",
  cricket: "crickets",
  breeze: "wind",
  fireplace: "fire",
  campfire: "fire",
  coffeeshop: "coffee",
  cafe: "coffee",
};

const ALLOWED_MIX_KEYS = [
  "rain",
  "cafe",
  "coffee",
  "fire",
  "nature",
  "heavy-rain",
  "light-rain",
  "window",
  "roof",
  "thunder",
  "chatter",
  "espresso",
  "crackle",
  "firewood",
  "embers",
  "wind",
  "stream",
  "birds",
  "crickets",
  "waves",
];

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
   - "reply": 1-2 warm, concise sentences acknowledging the mood and adjustments.
   - "mood": exactly one of [calm, focused, sleepy, cozy, stressed, sad, happy, energetic].
   - "mix": object with channels and layers set from 0 to 100.
     Channels: rain, cafe, fire, nature.
     Layers: heavy-rain, light-rain, window, roof, thunder, chatter, espresso, crackle, firewood, embers, wind, stream, birds, crickets, waves.
   - "changes": short description of adjustments made.
   - EXCLUSIVE REQUESTS (e.g. "ocean waves, nothing else", "only rain", "just fire", "solo cafe", "play waves"):
     Set the requested channel and layers to audible levels (50-70%), and explicitly set all other channels to 0 (rain: 0, cafe: 0, fire: 0, nature: 0 except the chosen channel)!
   - For relative requests like "warmer" or "less crowded", adjust relative to the current mix.

Output valid JSON only with keys: "reply", "mood", "mix", "changes".`;

export function validateAndCleanResponse(rawText) {
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

  // Normalize mood through synonyms (e.g. "soothing" -> "calm", "relaxing" -> "calm")
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
    let normalizedKey = key.toLowerCase().trim();
    if (MIX_KEY_ALIASES[normalizedKey]) {
      normalizedKey = MIX_KEY_ALIASES[normalizedKey];
    }
    if (ALLOWED_MIX_KEYS.includes(normalizedKey)) {
      const num = Number(val);
      if (Number.isFinite(num)) {
        clampedMix[normalizedKey] = Math.max(0, Math.min(100, Math.round(num)));
      }
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
      .filter(([k, v]) => ALLOWED_MIX_KEYS.includes(k.toLowerCase()) && Number.isFinite(Number(v)))
      .map(([k, v]) => `${k.toLowerCase()}:${Math.round(Number(v))}`);
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

  const validated = validateAndCleanResponse(result.text);
  const responseData = validated || {
    reply: result.reply || result.text || "I'm here to help with your ambient soundscape.",
  };

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
