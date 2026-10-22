import crypto from "node:crypto";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { LIMITS } from "../config/limits.js";
import { UsageDay } from "../models/UsageDay.js";

const memoryUsage = new Map();
const lastCallMap = new Map();

export function getCallerInfo(request) {
  const userId = request.session?.userId || request.session?.user?._id;
  if (userId) {
    return {
      callerKey: `user:${userId}`,
      callerType: "user",
      cap: LIMITS.USER_DAILY_AI,
    };
  }

  const ip = request.ip || request.connection?.remoteAddress || "127.0.0.1";
  const secret = env.sessionSecret || "ambient-fallback-secret-at-least-32-chars";
  const hmac = crypto.createHmac("sha256", secret).update(ip).digest("hex");
  return {
    callerKey: `guest:${hmac}`,
    callerType: "guest",
    cap: LIMITS.GUEST_DAILY_AI,
  };
}

export function checkCooldown(callerKey) {
  const now = Date.now();
  const lastTime = lastCallMap.get(callerKey) || 0;
  const elapsed = now - lastTime;
  if (elapsed < LIMITS.CLIENT_COOLDOWN_MS) {
    const retryAfter = Math.ceil((LIMITS.CLIENT_COOLDOWN_MS - elapsed) / 1000) || 1;
    return { allowed: false, retryAfter };
  }
  lastCallMap.set(callerKey, now);
  return { allowed: true };
}

export async function checkAndConsumeUsage(callerKey, callerType, cap) {
  const date = new Date().toISOString().slice(0, 10);

  // If DB is ready, persist in UsageDay
  if (mongoose.connection.readyState === 1) {
    try {
      const doc = await UsageDay.findOneAndUpdate(
        { key: callerKey, date },
        { $inc: { count: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      const globalDoc = await UsageDay.findOneAndUpdate(
        { key: "global", date },
        { $inc: { count: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (globalDoc.count > LIMITS.GLOBAL_DAILY_AI) {
        return { allowed: false, reason: "daily_limit", remaining: 0 };
      }
      if (doc.count > cap) {
        return { allowed: false, reason: "daily_limit", remaining: 0 };
      }
      return { allowed: true, remaining: Math.max(0, cap - doc.count) };
    } catch (error) {
      console.error(`[chat-limiter] DB error (${error.name}), falling back to in-memory store`);
    }
  }

  // Fast in-memory fallback
  const globalKey = `global:${date}`;
  const memCallerKey = `${callerKey}:${date}`;

  const callerCount = (memoryUsage.get(memCallerKey) || 0) + 1;
  memoryUsage.set(memCallerKey, callerCount);

  const globalCount = (memoryUsage.get(globalKey) || 0) + 1;
  memoryUsage.set(globalKey, globalCount);

  if (globalCount > LIMITS.GLOBAL_DAILY_AI) {
    return { allowed: false, reason: "daily_limit", remaining: 0 };
  }
  if (callerCount > cap) {
    return { allowed: false, reason: "daily_limit", remaining: 0 };
  }
  return { allowed: true, remaining: Math.max(0, cap - callerCount) };
}

export function resetChatLimiter() {
  memoryUsage.clear();
  lastCallMap.clear();
}

export function resetCooldown() {
  lastCallMap.clear();
}
