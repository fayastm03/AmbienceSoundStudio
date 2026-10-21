import { Router } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { User } from "../models/User.js";
import { authRateLimit } from "../middleware/rateLimit.js";
import { isDatabaseConnected } from "../config/db.js";
import { env } from "../config/env.js";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "Please enter a valid email address" }),
  password: z.string().min(10, { message: "Password must be at least 10 characters" }).max(128, { message: "Password cannot exceed 128 characters" }),
});

const registerSchema = credentialsSchema.extend({
  displayName: z.string().trim().max(40, { message: "Display name cannot exceed 40 characters" }).optional(),
});

const dummyHash = "$argon2id$v=19$m=65536,t=3,p=4$e3NVP/POJ9F9g36jhpPpQg$99BROJ9Y8jw7Xn54ey4vPJLxb6vheItjtMplhAhWpqE";

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    consent: user.consent,
  };
}

function mapZodErrors(zodError) {
  const fieldErrors = {};
  for (const issue of zodError.errors) {
    const field = issue.path[0];
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}

router.post("/register", authRateLimit, async (request, response, next) => {
  if (!isDatabaseConnected()) {
    return response.status(503).json({ error: "Accounts are temporarily unavailable" });
  }

  try {
    const input = registerSchema.parse(request.body);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await User.create({
      email: input.email,
      passwordHash,
      displayName: input.displayName || undefined,
    });

    if (request.session) {
      await new Promise((resolve) => request.session.regenerate(() => resolve()));
      request.session.userId = user.id;
    }

    return response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response.status(400).json({
        error: "Invalid registration details",
        fieldErrors: mapZodErrors(error),
      });
    }
    if (error?.code === 11000) {
      return response.status(409).json({
        error: "An account with that email already exists",
        fieldErrors: { email: "An account with that email already exists" },
      });
    }
    return next(error);
  }
});

router.post("/login", authRateLimit, async (request, response, next) => {
  if (!isDatabaseConnected()) {
    return response.status(503).json({ error: "Accounts are temporarily unavailable" });
  }

  try {
    const input = credentialsSchema.parse(request.body);
    const user = await User.findOne({ email: input.email }).select("+passwordHash");
    const passwordHash = user?.passwordHash || dummyHash;
    const valid = await argon2.verify(passwordHash, input.password);

    if (!user || !valid) {
      return response.status(401).json({ error: "Invalid email or password" });
    }

    if (request.session) {
      await new Promise((resolve) => request.session.regenerate(() => resolve()));
      request.session.userId = user.id;
    }

    user.lastLoginAt = new Date();
    await user.save();

    return response.json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response.status(400).json({
        error: "Invalid email or password",
        fieldErrors: mapZodErrors(error),
      });
    }
    return next(error);
  }
});

router.post("/logout", async (request, response, next) => {
  try {
    if (request.session) {
      await new Promise((resolve) => {
        request.session.destroy(() => resolve());
      });
    }
    response.clearCookie("ass.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: env.nodeEnv === "production",
    });
    return response.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", async (request, response, next) => {
  try {
    if (!isDatabaseConnected()) {
      return response.json({ user: null, accountsAvailable: false });
    }

    if (!request.session?.userId) {
      return response.json({ user: null, accountsAvailable: true });
    }

    const user = await User.findById(request.session.userId);
    if (!user) {
      if (request.session) request.session.userId = undefined;
      return response.json({ user: null, accountsAvailable: true });
    }

    return response.json({ user: publicUser(user), accountsAvailable: true });
  } catch (error) {
    return next(error);
  }
});

export default router;
