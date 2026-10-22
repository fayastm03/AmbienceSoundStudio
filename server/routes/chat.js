import { Router } from "express";
import { z } from "zod";
import { isCrisisText, CRISIS_MESSAGE } from "../../public/js/config/safety.js";
import { callGroq } from "../services/groq.js";

const router = Router();

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
});

const SYSTEM_PROMPT =
  "You are the calm ambient sound assistant for Ambient Sound Studio. Answer warmly, helpfully, and concisely in 1-2 sentences.";

router.post("/", async (request, response) => {
  let parsed;
  try {
    parsed = chatSchema.parse(request.body);
  } catch {
    return response.status(400).json({ error: "Message is required" });
  }

  const { message, history } = parsed;

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

  // 3. Keep token usage low: short system prompt + last 6 messages only
  const recentHistory = (history || []).slice(-6);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const result = await callGroq({
    messages,
    maxTokens: 150,
  });

  if (result.error) {
    if (result.error === "busy") {
      return response.status(429).json({ error: "busy", retryAfter: result.retryAfter || 60 });
    }
    return response.status(503).json({ error: "service_unavailable" });
  }

  return response.json({
    reply: result.reply || result.text || "I'm here to help with your ambient soundscape.",
  });
});

export default router;
