import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { soundscapes } from "../../public/js/config/soundscapes.js";
import { SavedMix } from "../models/SavedMix.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { mixesRateLimit } from "../middleware/rateLimit.js";
import { isDatabaseConnected } from "../config/db.js";

const router = Router();

// Build strictly validated catalog schemas from central soundscape definitions
const channelSchemas = {};
for (const soundscape of soundscapes) {
  const layerSchemas = {};
  for (const layer of soundscape.layers) {
    layerSchemas[layer.id] = z.number().min(0).max(1);
  }
  const chSchema = z.object({
    channel: z.number().min(0).max(1),
    layers: z.object(layerSchemas).strict(),
  }).strict();
  if (soundscape.id === "nature") {
    channelSchemas[soundscape.id] = chSchema.optional();
  } else {
    channelSchemas[soundscape.id] = chSchema;
  }
}

const levelsSchema = z.object(channelSchemas).strict();

const createMixSchema = z.object({
  name: z.string().trim().min(1).max(40),
  levels: levelsSchema,
  source: z.enum(["manual", "ai"]).optional().default("manual"),
}).strict();

const renameMixSchema = z.object({
  name: z.string().trim().min(1).max(40),
}).strict();

function bodySizeLimit(maxBytes = 8192) {
  return (request, response, next) => {
    const contentLength = request.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      return response.status(413).json({ error: "Payload too large" });
    }
    if (request.body && Buffer.byteLength(JSON.stringify(request.body)) > maxBytes) {
      return response.status(413).json({ error: "Payload too large" });
    }
    next();
  };
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
}

function publicMix(mix) {
  return {
    id: mix._id.toString(),
    _id: mix._id.toString(),
    name: mix.name,
    levels: mix.levels,
    source: mix.source,
    createdAt: mix.createdAt,
    updatedAt: mix.updatedAt,
  };
}

router.use(mixesRateLimit);
router.use(requireAuth);
router.use((request, response, next) => {
  if (!isDatabaseConnected()) {
    return response.status(503).json({ error: "Accounts are temporarily unavailable" });
  }
  next();
});

// GET /api/mixes - List user's mixes, newest first
router.get("/", async (request, response, next) => {
  try {
    const mixes = await SavedMix.find({ userId: request.session.userId })
      .sort({ createdAt: -1 })
      .lean();
    return response.json({ mixes: mixes.map(publicMix) });
  } catch (error) {
    return next(error);
  }
});

// GET /api/mixes/:id - Read single mix
router.get("/:id", async (request, response, next) => {
  try {
    const { id } = request.params;
    if (!isValidObjectId(id)) {
      return response.status(404).json({ error: "Mix not found" });
    }
    const mix = await SavedMix.findOne({ _id: id, userId: request.session.userId }).lean();
    if (!mix) {
      return response.status(404).json({ error: "Mix not found" });
    }
    return response.json({ mix: publicMix(mix) });
  } catch (error) {
    return next(error);
  }
});

// POST /api/mixes - Create a new mix (max 50 per user)
router.post("/", bodySizeLimit(8192), async (request, response, next) => {
  try {
    const count = await SavedMix.countDocuments({ userId: request.session.userId });
    if (count >= 50) {
      return response.status(409).json({ error: "Maximum limit of 50 mixes reached" });
    }

    const input = createMixSchema.parse(request.body);
    const mix = await SavedMix.create({
      userId: request.session.userId,
      name: input.name,
      levels: input.levels,
      source: input.source || "manual",
    });

    return response.status(201).json({ mix: publicMix(mix) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: "Invalid mix payload", details: error.errors });
    }
    return next(error);
  }
});

// PATCH /api/mixes/:id - Rename mix only
router.patch("/:id", bodySizeLimit(8192), async (request, response, next) => {
  try {
    const { id } = request.params;
    if (!isValidObjectId(id)) {
      return response.status(404).json({ error: "Mix not found" });
    }

    const input = renameMixSchema.parse(request.body);
    const mix = await SavedMix.findOneAndUpdate(
      { _id: id, userId: request.session.userId },
      { name: input.name },
      { new: true }
    );

    if (!mix) {
      return response.status(404).json({ error: "Mix not found" });
    }

    return response.json({ mix: publicMix(mix) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: "Invalid rename payload", details: error.errors });
    }
    return next(error);
  }
});

// DELETE /api/mixes/:id - Delete mix
router.delete("/:id", async (request, response, next) => {
  try {
    const { id } = request.params;
    if (!isValidObjectId(id)) {
      return response.status(404).json({ error: "Mix not found" });
    }

    const deleted = await SavedMix.findOneAndDelete({ _id: id, userId: request.session.userId });
    if (!deleted) {
      return response.status(404).json({ error: "Mix not found" });
    }

    return response.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default router;

