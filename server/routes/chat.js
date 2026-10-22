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

const ALLOWED_MIX_KEYS = [
  "rain",
  "cafe",
  "coffee",
  "fire",
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

const SYSTEM_PROMPT = `You are the ambience sound assistant for Ambient Sound Studio.
Analyze the user's message and current mix levels, then respond in strict JSON with keys:
- "reply": 1-2 warm, concise sentences acknowledging the mood and adjustments.
- "mood": exactly one of [calm, focused, sleepy, cozy, stressed, sad, happy, energetic].
- "mix": object with channels and layers set from 0 to 100.
Channels: rain, cafe, fire.
Layers: heavy-rain, light-rain, window, roof, thunder, chatter, espresso, crackle, firewood, embers.
- "changes": short description of adjustments made.

For relative requests like "warmer" or "less crowded", adjust relative to the current mix. Output valid JSON only.`;

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

  // If mood is missing or not allowed, fall back to { reply } only
  if (typeof parsed.mood !== "string" || !ALLOWED_MOODS.includes(parsed.mood.toLowerCase())) {
    return { reply };
  }
  const mood = parsed.mood.toLowerCase();

  // If mix is missing or not an object, fall back to { reply } only
  if (!parsed.mix || typeof parsed.mix !== "object" || Array.isArray(parsed.mix)) {
    return { reply };
  }

  // Validate and clamp mix values (0-100), drop unknown keys
  const clampedMix = {};
  for (const [key, val] of Object.entries(parsed.mix)) {
    const normalizedKey = key.toLowerCase();
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

export default router;
