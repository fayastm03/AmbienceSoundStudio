import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { createMix } from "../services/gemini.js";
import { mixRateLimit } from "../middleware/rateLimit.js";
import { isCrisisText, CRISIS_MESSAGE } from "../../public/js/config/safety.js";

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

    response.json(await createMix({ ...input, mock: env.mixMock, provider: env.provider, apiKey: env.geminiApiKey, model: env.geminiModel }));
  } catch (error) {
    if (error instanceof z.ZodError) return response.status(400).json({ error: "bad_request" });
    return next(error);
  }
});

export default router;
