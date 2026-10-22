# STATUS-CHAT.md: AI Assistant (Groq API) Integration

## 1. Summary of Completed Work

### Backend Service & Route Architecture
- **Groq API Service (`server/services/groq.js`)**:
  - Connects to Groq chat completions endpoint (`https://api.groq.com/openai/v1/chat/completions`) using `GROQ_API_KEY` and `GROQ_CHAT_MODEL` via `getEnv()`.
  - JSON mode enabled via `response_format: { type: "json_object" }`.
  - 8-second timeout via `AbortSignal.timeout(8000)`.
  - Zero-retry design to preserve token quotas.
  - 60-second in-memory circuit breaker that trips on 429 or 5xx responses.
  - Safe error mapping (`auth_error`, `busy`, `service_unavailable`, `timeout`, `ai_unavailable`).
  - Strict privacy logging: only token counts and latency numbers are logged (`[groq] tokens=N (prompt=X completion=Y) duration=Zms`). Never logs user messages, prompts, or AI outputs.
  - Deterministic mock mode when `CHAT_MOCK=1` or `NODE_ENV=test`.
  - In-memory ring buffer (last 200 calls) storing duration, token metrics, caller type, and status.

- **Rate Limiting & DB-Down Resilience (`server/services/chatLimiter.js`, `server/models/UsageDay.js`)**:
  - Dual caller identity: Guests tracked by HMAC-SHA256 of client IP using `SESSION_SECRET`; authenticated users tracked by session user ID.
  - Daily caps: Guest = 5 calls/day, User = 30 calls/day, Global = 300 calls/day.
  - Fast repeat cooldown: 2-second rate limiter between requests per caller.
  - Persistent storage in MongoDB `UsageDay` collection with 3-day TTL index.
  - Instant in-memory fallback if MongoDB Atlas is disconnected or fails. Guest mode and audio playback never fail.

- **Input/Output Validation & Crisis Protocol (`server/routes/chat.js`)**:
  - Request validation: message trimmed and clamped to max 160 characters, compact state, max 2 user history turns.
  - Compact system prompt (~170 tokens) defining channel/layer IDs, mood tags, +/-0.1 to 0.4 relative adjustments rule, and crisis protocol.
  - Crisis Protocol: if user mentions self-harm, suicide, depression crisis, or abuse, immediate kind referral to 988 or text HOME to 741741 with zero audio actions.
  - Response sanitization: parses JSON safely, clamps reply to 120 chars, validates actions against soundscape whitelist (max 8 actions, channel/layer validation, 0.0-1.0 / -1.0-1.0 clamping), and validates tags against `VALID_TAGS` (max 3 tags).
  - Stats route: `GET /api/chat/stats` exposes the ring buffer in non-production environments (returns 404 in production).

- **Tag Vocabulary (`public/js/config/tags.js`)**:
  - Exports frozen `VALID_TAGS` array: `["focus", "study", "work", "reading", "relax", "calm", "sleep", "cozy", "social", "energize", "storm", "nostalgic"]`.

### Frontend & UI Integration
- **AI Client (`public/js/assistant/ai-client.js`)**:
  - `askAssistant(message, ctx)`: builds compact payload (omitting silent layers), sends history, enforces 2s client cooldown, handles errors (`daily_limit`, `busy`, `cooldown`, `ai_unavailable`, network failures).
- **Executor Enhancement (`public/js/assistant/executor.js`)**:
  - Added support for AI action schemas (`set`, `adjust`, `master`, `timer`) integrating directly with smooth level transitions, undo stack, and sleep timer.
- **UI Enhancements (`public/js/ui/assistant.js`, `public/index.html`, `public/css/components.css`)**:
  - Local-first routing: `parseCommand()` evaluates text first. AI is called only when `parseCommand` returns `null`.
  - Thinking state: shows subtle "Thinking…" bubble and disables inputs while waiting for AI response.
  - AI quota display: displays "AI replies left today: N". Informs user when quota reaches 0 that local commands remain available.
  - Subjective chips: "Warmer" and "Less crowded" route to the AI model; "Sleep", "Focus", "Surprise me" execute local commands.
  - Stores returned mood tags in `currentMoodTags` in memory.

### Verification & Automated Testing
- **Automated Smoke Test (`scripts/smoke-chat.mjs`)**:
  - Tested normal subjective prompts (actions, reply, tags, remaining quota).
  - Tested crisis prompt protocol (empty actions, 988 referral).
  - Tested oversized input (> 160 chars) -> 400.
  - Tested malformed payloads and missing fields -> 400.
  - Tested fast repeat cooldown (< 2s) -> 429 `cooldown`.
  - Tested guest rate limit (> 5 calls) -> 429 `daily_limit`.
  - Tested `GET /api/chat/stats` ring buffer output.
  - Tested MongoDB disconnected fallback (operates with MongoDB state = 0).
- **Static Analysis & Suite**:
  - `node --check` passes on all modified and newly created JS files.
  - `npm run check` runs clean:
    - Overlay architecture and contrast checks pass.
    - 55 unit tests in `scripts/test-commands.mjs` pass.
    - 8 smoke scenarios in `scripts/smoke-chat.mjs` pass.

---

## 2. Status
- **Phase Status**: Complete.
- **Breaking Changes**: None. Web Audio engine, auth system, and visual branding are fully preserved.
