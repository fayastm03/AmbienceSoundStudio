import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { createMix } from "../services/gemini.js";
import { mixRateLimit } from "../middleware/rateLimit.js";
import { isCrisisText, CRISIS_MESSAGE } from "../../public/js/config/safety.js";
import { isDatabaseConnected } from "../config/db.js";
import { MoodEntry } from "../models/MoodEntry.js";

const router = Router();
const requestSchema = z.object({
  text: z.string().trim().min(1).max(200),
  channels: z.array(z.object({ id: z.string().min(1), layers: z.array(z.string().min(1)) })).min(1),
});

router.post("/", mixRateLimit, async (request, response, next) => {
  try {
    const input = requestSchema.parse(request.body);

    // Crisis check FIRST — before any quota use or model call.
    if (isCrisisText(input.text)) {
      return response.json({
        safety: true,
        reply: CRISIS_MESSAGE,
        actions: [],
        tags: [],
      });
    }

    const result = await createMix({ ...input, mock: env.mixMock, provider: env.provider, apiKey: env.geminiApiKey, model: env.geminiModel });

    if (request.session?.userId && isDatabaseConnected() && result.levels) {
      try {
        const moodName = result.tags?.[0] || input.text.slice(0, 30);
        await MoodEntry.create({
          userId: request.session.userId,
          mood: moodName,
          mix: result.levels,
          time: new Date(),
        });
      } catch (err) {
        console.error("[mix-db] failed to record mood:", err?.message || err);
      }
    }

    response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return response.status(400).json({ error: "bad_request" });
    return next(error);
  }
});

export default router;
