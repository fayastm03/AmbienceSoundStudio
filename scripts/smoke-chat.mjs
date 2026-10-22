// Smoke test for POST /api/chat (auth required, crisis-first, low token model call)

process.env.CHAT_MOCK = "1";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import express from "express";
import chatRouter from "../server/routes/chat.js";
import { sameOrigin } from "../server/middleware/sameOrigin.js";
import { CRISIS_MESSAGE } from "../public/js/config/safety.js";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));
app.use("/api", sameOrigin);

// Simulated session middleware for testing auth
let testUserId = null;
app.use((req, res, next) => {
  req.session = testUserId ? { userId: testUserId } : {};
  next();
});

app.use("/api/chat", chatRouter);

function dispatch(method, url, body, headers = {}) {
  return new Promise((resolve) => {
    const rawBody = typeof body === "object" ? JSON.stringify(body) : (body ?? "");
    const req = new Readable({
      read() {
        if (rawBody) this.push(rawBody);
        this.push(null);
      },
    });
    req.method = method;
    req.url = url;
    req.headers = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(rawBody),
      origin: "http://localhost:3000",
      host: "localhost:3000",
      ...headers,
    };
    req.ip = "127.0.0.1";
    req.connection = { remoteAddress: "127.0.0.1" };

    const resHeaders = {};
    const chunks = [];
    const res = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.setHeader = (name, val) => {
      resHeaders[name.toLowerCase()] = val;
    };
    res.getHeader = (name) => resHeaders[name.toLowerCase()];
    res.writeHead = (status, h = {}) => {
      res.statusCode = status;
      Object.assign(resHeaders, h);
    };
    res.end = function (chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      const resText = Buffer.concat(chunks).toString();
      let parsed = {};
      try {
        parsed = JSON.parse(resText);
      } catch {
        parsed = resText;
      }
      resolve({ status: res.statusCode, body: parsed, headers: resHeaders });
    };

    app.handle(req, res);
  });
}

async function request(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body;
  const headers = options.headers || {};
  return dispatch(method, path, body, headers);
}

function expect(status, actual, label) {
  if (actual !== status) {
    throw new Error(`${label}: expected status ${status}, got ${actual}`);
  }
}

console.log("[smoke-chat] Running smoke tests for POST /api/chat...");

// 1. Unauthenticated request without crisis -> 401
testUserId = null;
console.log("[smoke-chat] 1. Testing unauthenticated request -> 401...");
const unauthRes = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({ message: "hello" }),
});
expect(401, unauthRes.status, "unauthenticated request");
assert.equal(unauthRes.body.error, "Authentication required");

// 2. Crisis prompt (works even if unauthenticated) -> 200 with fixed crisis reply
console.log("[smoke-chat] 2. Testing crisis prompt (unauthenticated) -> 200 fixed crisis reply...");
const crisisRes = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({ message: "I want to end it all and kill myself" }),
});
expect(200, crisisRes.status, "crisis response status");
assert.equal(crisisRes.body.safety, true, "crisis safety flag");
assert.equal(crisisRes.body.reply, CRISIS_MESSAGE, "crisis fixed message");

// 3. Authenticated request with normal message -> 200 with { reply }
testUserId = "user-smoke-123";
console.log("[smoke-chat] 3. Testing authenticated request -> 200 with reply...");
const authRes = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({
    message: "can you help me focus with quiet sounds?",
    history: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello! how can I help?" },
    ],
  }),
});
expect(200, authRes.status, "authenticated request");
assert.ok(typeof authRes.body.reply === "string", "reply should be string");
assert.ok(authRes.body.reply.length > 0, "reply should not be empty");

// 4. Missing message field -> 400
console.log("[smoke-chat] 4. Testing missing message -> 400...");
const missingRes = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({}),
});
expect(400, missingRes.status, "missing message");
assert.equal(missingRes.body.error, "Message is required");

console.log("[smoke-chat] All smoke tests passed successfully!");
