// Smoke test for POST /api/chat (auth required, crisis-first, low token model call)

process.env.CHAT_MOCK = "1";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import express from "express";
import chatRouter, { validateAndCleanResponse } from "../server/routes/chat.js";
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

// 3. Authenticated request with normal message -> 200 with strict JSON { reply, mood, mix, changes }
testUserId = "user-smoke-123";
console.log("[smoke-chat] 3. Testing authenticated request -> 200 with strict JSON...");
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
assert.ok(typeof authRes.body.mood === "string", "mood should be string");
assert.ok(["calm", "focused", "sleepy", "cozy", "stressed", "sad", "happy", "energetic"].includes(authRes.body.mood), "mood must be one of allowed values");
assert.ok(typeof authRes.body.mix === "object" && authRes.body.mix !== null, "mix should be an object");
assert.ok(typeof authRes.body.changes === "string", "changes should be string");

// 4. Missing message field -> 400
console.log("[smoke-chat] 4. Testing missing message -> 400...");
const missingRes = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({}),
});
expect(400, missingRes.status, "missing message");
assert.equal(missingRes.body.error, "Message is required");

// 5. Relative command with currentMix -> adjusts relative to current mix
console.log("[smoke-chat] 5. Testing relative command with currentMix...");
const relativeRes = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({
    message: "warmer please",
    currentMix: {
      fire: 20,
      crackle: 10,
    },
  }),
});
expect(200, relativeRes.status, "relative request");
assert.equal(relativeRes.body.mood, "cozy");
assert.ok(relativeRes.body.mix.fire > 20, "fire should increase relative to current mix");

// 6. Direct server validation test: clamp values, drop unknown keys, fallback to { reply }
console.log("[smoke-chat] 6. Testing server validation rules...");

// 6a. Clamping and dropping unknown keys
const testRawJson = JSON.stringify({
  reply: "Turned up rain.",
  mood: "focused",
  mix: {
    rain: 150, // should clamp to 100
    thunder: -20, // should clamp to 0
    crackle: 45,
    unknown_instrument: 99, // unknown key should be dropped
  },
  changes: "Made it rainier.",
});
const validated = validateAndCleanResponse(testRawJson);
assert.equal(validated.reply, "Turned up rain.");
assert.equal(validated.mood, "focused");
assert.equal(validated.mix.rain, 100, "rain should be clamped to 100");
assert.equal(validated.mix.thunder, 0, "thunder should be clamped to 0");
assert.equal(validated.mix.crackle, 45);
assert.equal(validated.mix.unknown_instrument, undefined, "unknown key must be dropped");
assert.equal(validated.changes, "Made it rainier.");

// 6b. Fallback to { reply only } when JSON is invalid
const invalidJsonResult = validateAndCleanResponse("I cannot output JSON right now.");
assert.equal(invalidJsonResult, null, "invalid JSON string should return null to trigger fallback");

// 6c. Fallback to { reply only } when mood is not in allowed list
const badMoodJson = JSON.stringify({
  reply: "Here is your sound.",
  mood: "unsupported_mood",
  mix: { rain: 50 },
  changes: "Changed sound",
});
const badMoodResult = validateAndCleanResponse(badMoodJson);
assert.deepEqual(badMoodResult, { reply: "Here is your sound." }, "bad mood falls back to reply only");

// 6d. Fallback to { reply only } when mix is missing or not an object
const badMixJson = JSON.stringify({
  reply: "Here is your sound.",
  mood: "calm",
  mix: "not an object",
  changes: "Changed sound",
});
const badMixResult = validateAndCleanResponse(badMixJson);
assert.deepEqual(badMixResult, { reply: "Here is your sound." }, "bad mix falls back to reply only");

// 7. GET /api/chat/history
console.log("[smoke-chat] 7. Testing GET /api/chat/history...");
testUserId = null;
const unauthHistRes = await request("/api/chat/history", { method: "GET" });
expect(200, unauthHistRes.status, "unauthenticated history status");
assert.deepEqual(unauthHistRes.body, { messages: [], profile: null }, "unauthenticated returns empty messages and null profile");

testUserId = "user-smoke-123";
const authHistRes = await request("/api/chat/history", { method: "GET" });
expect(200, authHistRes.status, "authenticated history status");
assert.ok(Array.isArray(authHistRes.body.messages), "history messages should be an array");
assert.ok("profile" in authHistRes.body, "history response should contain profile key");

// 8. POST /api/chat/record
console.log("[smoke-chat] 8. Testing POST /api/chat/record...");
testUserId = null;
const unauthRecRes = await request("/api/chat/record", {
  method: "POST",
  body: JSON.stringify({ message: "Focus", reply: "Focused mix applied." }),
});
expect(200, unauthRecRes.status, "record status");
assert.equal(unauthRecRes.body.ok, false, "unauthenticated cannot record");

// 9. Off-topic query (e.g. math / factorial) -> polite decline and empty mix {}
console.log("[smoke-chat] 9. Testing off-topic query decline...");
testUserId = "user-smoke-123";
const offTopicRes = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({ message: "how to find factorial of a number" }),
});
expect(200, offTopicRes.status, "off-topic response status");
assert.ok(offTopicRes.body.reply.includes("Ambient Sound Studio"), "reply should identify as Ambient Sound Studio assistant");
assert.deepEqual(offTopicRes.body.mix, {}, "off-topic queries should not alter sounds (mix must be empty)");

console.log("[smoke-chat] All smoke tests passed successfully!");
