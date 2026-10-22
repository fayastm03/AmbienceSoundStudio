import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import helmet from "helmet";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/db.js";
import { apiRateLimit } from "./middleware/rateLimit.js";
import { sameOrigin } from "./middleware/sameOrigin.js";
import { errorHandler } from "./middleware/errorHandler.js";
import healthRouter from "./routes/health.js";
import mixRouter from "./routes/mix.js";
import chatRouter from "./routes/chat.js";
import authRouter from "./routes/auth.js";
import mixesRouter from "./routes/mixes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const isProduction = env.nodeEnv === "production";
const SESSION_DAYS = 14;

const app = express();
if (isProduction || Boolean(process.env.VERCEL)) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        styleSrc: ["'self'"],
        objectSrc: ["'none'"],
        // Safari does not treat http://localhost as secure, so only upgrade in production.
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
  })
);

// Static files first: guests always get the app and the audio, even if the database is down.
app.use(express.static(publicDir));

app.use(express.json({ limit: "32kb" }));

// Ensure database connection is initialized for API calls (especially on serverless cold starts)
app.use("/api", async (request, response, next) => {
  if (!databaseReady() && env.mongoUri) {
    try {
      await connectDatabase();
    } catch {}
  }
  next();
});

app.use("/api", apiRateLimit);
app.use("/api", sameOrigin);

const databaseReady = () => mongoose.connection.readyState === 1;

// The session middleware is created lazily, once the database connection exists,
// and it reuses Mongoose's connection (one connection for the whole app).
let sessionMiddleware = null;
function getSessionMiddleware() {
  if (sessionMiddleware) return sessionMiddleware;
  if (!databaseReady() || !env.sessionSecret) return null;

  const store = MongoStore.create({
    clientPromise: Promise.resolve(mongoose.connection.getClient()),
    ttl: SESSION_DAYS * 24 * 60 * 60,
  });
  store.on("error", (error) => console.error(`[session-store] ${error.name}`));

  sessionMiddleware = session({
    name: "ass.sid",
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    },
  });
  return sessionMiddleware;
}

// Used only on routes that need accounts. Guests and the AI mixer never touch it.
function withSession(request, response, next) {
  const middleware = getSessionMiddleware();
  if (!middleware) {
    return response.status(503).json({ error: "accounts_unavailable" });
  }
  return middleware(request, response, next);
}

function optionalSession(request, response, next) {
  const middleware = getSessionMiddleware();
  if (!middleware) return next();
  return middleware(request, response, (err) => {
    if (err) console.error(`[chat-session] ${err.name}`);
    next();
  });
}

app.use("/api/health", healthRouter);
app.use("/api/mix", mixRouter);
app.use("/api/chat", optionalSession, chatRouter);

// While the database is down, the front end can still ask "am I signed in?" and gets a calm answer.
app.get("/api/auth/me", (request, response, next) => {
  if (databaseReady()) return next();
  return response.json({ user: null, accountsAvailable: false });
});

app.use("/api/auth", withSession, authRouter);
app.use("/api/mixes", withSession, mixesRouter);
app.use(errorHandler);

// Connect in the background: a database problem must never stop the server from starting.
Promise.resolve()
  .then(() => connectDatabase())
  .catch((error) => console.error(`[db] connection attempt failed: ${error?.name ?? "Error"}`));

if (!process.env.VERCEL) {
  const server = app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[server] port ${env.port} is already in use. Stop the other server (Ctrl+C in its terminal tab) and try again.`);
    } else {
      console.error(`[server] ${error.name}: ${error.message}`);
    }
    process.exit(1);
  });

  let shuttingDown = false;
  function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] received ${signal}, shutting down`);
    server.close(async () => {
      try {
        await mongoose.disconnect();
      } catch {}
      process.exit(0);
    });
    server.closeAllConnections?.();
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

process.on("unhandledRejection", (reason) => {
  console.error(`[server] unhandled rejection: ${reason?.name ?? "Error"}`);
});
process.on("uncaughtException", (error) => {
  console.error(`[server] uncaught exception: ${error.name}`);
  if (!process.env.VERCEL) process.exit(1);
});

export default app;
export { app };