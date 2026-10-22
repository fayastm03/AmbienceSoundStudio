# Ambient Sound Studio — Project Review & Demo Notes

This document provides a comprehensive, code-accurate technical summary, architecture breakdown, security review, demo presentation script, and examiner Q&A for **Ambient Sound Studio**. Every detail reflects the actual implementation in the codebase.

---

## 1. What the App Does and Who It Is For

1. Ambient Sound Studio is a web-based procedural soundscape mixer designed for focused work, deep study, reading, relaxation, and sleep.
2. It blends multi-track acoustic environments—Rain, Coffee Shop, and Fireplace—with independent volume control for both master channels and individual layers (such as thunder, espresso machine, and fire crackle).
3. Listeners can shape their ambience manually with responsive sliders, prompt an AI Mood Mixer for custom blends, or converse with an AI Sound Assistant using natural language.
4. The system learns listening habits over time, greeting returning listeners with personalized summaries and a one-click "Play my usual" shortcut.
5. Engineered for resilience and accessibility, it includes a local-first zero-token command parser, Web Audio fallback noise generators, WCAG AA compliance, and strict mental health crisis safety protocols.

---

## 2. Tech Stack & Dependencies

### Languages & Standards
- **JavaScript (ES Modules)**: Modern ES6+ modules used consistently across client-side scripts and server runtime (`"type": "module"`).
- **HTML5 & Web Audio API**: Semantic, accessible markup coupled with a native browser Web Audio graph (no third-party audio player plugins).
- **CSS3**: Custom design token system (CSS variables), responsive Grid/Flexbox layout, and dark/light theme switching with WCAG AA contrast enforcement.

### Production Libraries (`package.json`)
| Package | Version | Purpose in Codebase |
| :--- | :--- | :--- |
| **`express`** | `^4.21.2` | Core HTTP web framework hosting REST endpoints (`/api/auth`, `/api/chat`, `/api/mix`, `/api/mixes`, `/api/health`) and serving static assets from `public/`. |
| **`mongoose`** | `^8.9.5` | ODM for MongoDB schema definition, model validation, and query execution (`User`, `SavedMix`, `ChatMessage`, `MoodEntry`, `UsageDay`). |
| **`connect-mongo`** | `^5.1.0` | MongoDB-backed session store for `express-session`, maintaining 14-day persistent user logins across serverless cold starts. |
| **`express-session`**| `^1.18.1` | Cookie-based session management (`ass.sid` cookie with `httpOnly`, `sameSite: lax`, and `secure` in production). |
| **`argon2`** | `^0.41.1` | Memory-hard password hashing using Argon2id with automatic salt generation to prevent GPU/rainbow-table attacks. |
| **`zod`** | `^3.24.1` | Type-safe runtime schema validation for incoming JSON payloads (auth credentials, chat messages, mix catalog structures, rename requests). |
| **`helmet`** | `^8.0.0` | HTTP security headers middleware configuring strict Content Security Policy (CSP directives restricted to `'self'`). |
| **`express-rate-limit`**| `^7.5.0` | Granular rate limiting across standard endpoints, auth attempts, Gemini mixer calls, and saved mix operations. |
| **`dotenv`** | `^16.4.7` | Loads environment configurations from `.env` into `process.env`. |

### Database
- **MongoDB** (MongoDB Atlas or local MongoDB instance): Document database storing user accounts, session tokens, saved soundscape mixes, chat logs, and mood history.

### AI Models & Services
- **Groq API (`llama-3.3-70b-versatile`)**: Powers the interactive Sound Assistant chat. Returns strict JSON containing conversational replies, detected moods, and targeted channel/layer volume adjustments.
- **Google Gemini API (`gemini-2.5-flash`)**: Powers the one-shot Mood Mixer card (`POST /api/mix`), converting natural language descriptions into complete calibrated soundscapes with custom titles and explanations.
- **Deterministic Keyword Mixer (`keywordMix`)**: Offline algorithmic fallback for Gemini that parses text for mood keywords and generates balanced audio levels when the API is unconfigured or unavailable.
- **Local Command Parser (`commands.js`)**: Deterministic client-side regex engine that handles 80%+ of user commands (volume, playback, presets, sleep timers, "play my usual") with **zero API latency and zero token cost**.

---

## 3. Architecture & Request Flows

### Folder Structure
```text
ambientSound/
├── api/                     # Serverless entry point for Vercel deployment (api/index.js)
├── public/                  # Static frontend served directly to browsers
│   ├── css/                 # base.css, components.css, layout.css, themes.css
│   ├── js/
│   │   ├── assistant/       # AI client, command parser (commands.js), action executor (executor.js)
│   │   ├── audio/           # Web Audio engine, channel buses, calibrated layer nodes, fallback generator
│   │   ├── config/          # Soundscape catalog, safety rules & crisis helpline text
│   │   ├── state/           # Reactive state store & localStorage persistence
│   │   └── ui/              # UI controllers (assistant, auth, controls, detail-panel, mood-mixer, saved-mixes)
│   ├── sounds/              # 10 calibrated ambient MP3 audio files (rain, cafe, fireplace)
│   └── index.html           # Accessible single-page application structure
├── scripts/                 # Automated test scripts (smoke tests, safety tests, command unit tests)
├── server/                  # Node.js Express backend
│   ├── config/              # Database connection, environment parser, limit constants
│   ├── middleware/          # Auth guard, error handler, rate limiters, CSRF same-origin check
│   ├── models/              # Mongoose schemas (User, SavedMix, ChatMessage, MoodEntry, UsageDay)
│   ├── routes/              # Express API routers (auth, chat, health, mix, mixes)
│   └── services/            # Groq client, Gemini client, mood analytics aggregator, chat limiter
└── tools/                   # Development utilities (check-contrast.mjs)
```

### Request Flow Diagrams

#### 1. Login Request Flow
```
Browser UI (auth.js)
  │  POST /api/auth/login  { email, password }  (Origin header required)
  ▼
Express Server (server/index.js)
  │  helmet() -> Content Security Policy check
  │  apiRateLimit (100 req/15m)
  │  sameOrigin() -> CSRF verification (Origin/Referer matches Host)
  │  authRateLimit (10 req/15m)
  ▼
Auth Router (server/routes/auth.js)
  │  credentialsSchema.parse() -> Zod validates email format & password bounds
  │  User.findOne({ email }).select("+passwordHash")
  │  argon2.verify(user.passwordHash, password)
  ▼
Session Initialization
  │  req.session.regenerate() -> Creates fresh session to prevent fixation
  │  req.session.userId = user.id
  │  Saved to MongoDB 'sessions' collection via connect-mongo
  ▼
Response (200 OK)
  │  Set-Cookie: ass.sid=...; HttpOnly; SameSite=Lax; Secure
  │  Body: { user: { id, email, displayName, ... } }
  ▼
Browser UI
  │  Dispatches window "auth:change" CustomEvent
  │  Account menu updates to signed-in state
  │  Saved mixes list refreshes from cloud
  │  Sound Assistant loads chat history and personalized mood profile
```

#### 2. Chat Request Flow (AI & Local Routing)
```
User Enters Message in Assistant
  │
  ├── 1. Client-side Crisis Pre-Check (isCrisisText)
  │      └── If crisis detected: Displays 988 helpline immediately. No audio change. No API call.
  │
  ├── 2. Local-first Regex Command Parser (commands.js)
  │      └── If command matches ("pause", "focus", "volume 50%", "play my usual"):
  │             - Executes immediately via executor.js (glides sliders over 2s).
  │             - Non-blocking POST /api/chat/record syncs message & mood to MongoDB.
  │             - Zero token cost, zero AI latency.
  │
  └── 3. Fallback to AI Chat (POST /api/chat)
         │  Payload: { message, history: [last 6 msgs], currentMix: { rain: 70, fire: 40 } }
         ▼
       Express Server (server/routes/chat.js)
         │  Server-side Crisis Check (isCrisisText) -> Returns 988 referral if triggered
         │  requireAuth check -> 401 if guest
         │  computeUserMoodAnalytics() -> Summarizes last 30 MoodEntry records into 1 line
         │  System Prompt + Profile + Last 6 messages -> Groq API (response_format: json_object)
         ▼
       Groq API (llama-3.3-70b-versatile via server/services/groq.js)
         │  8-second timeout via AbortSignal.timeout(8000)
         │  Circuit breaker checks (trips for 60s if 429 or 5xx occurs)
         ▼
       Validation & Sanitization (validateAndCleanResponse)
         │  Verifies JSON structure
         │  Validates mood against whitelist [calm, focused, sleepy, cozy, stressed, sad, happy, energetic]
         │  Clamps mix channel/layer values strictly between 0 and 100; strips unknown keys
         ▼
       Database Persistence
         │  ChatMessage.create() -> Stores user message & assistant reply
         │  MoodEntry.create() -> Stores detected mood and mix snapshot (crisis messages never saved)
         ▼
       Client Response & Animation
         │  Executor animates sliders & Web Audio gains smoothly over 2000ms
         │  Renders assistant bubble with mix summary chip ("Rain 70, Fire 40") and "Undo" button
```

#### 3. Saving a Custom Mix Flow
```
User clicks "Save current mix" in UI (saved-mixes.js)
  │  Prompts for mix name (1-40 characters)
  │  Extracts active levels from state.channels (master volume excluded)
  │  POST /api/mixes  { name, levels, source: "manual" }
  ▼
Express Server (server/routes/mixes.js)
  │  mixesRateLimit (60 req/1m per user)
  │  requireAuth -> Verifies active session
  │  bodySizeLimit(8192) -> Rejects oversized payloads (>8 KB)
  │  SavedMix.countDocuments({ userId }) -> Enforces 50 mix maximum cap (409 if exceeded)
  │  levelsSchema.parse() -> Strict Zod validation against soundscape catalog
  ▼
MongoDB Persistence
  │  SavedMix.create({ userId, name, levels, source })
  ▼
Response (201 Created)
  │  Returns sanitized publicMix object
  ▼
Browser UI
  │  Appends new mix to saved mixes dialog
  │  Fires accessible toast: "Mix '[Name]' saved"
```

---

## 4. How the Audio Engine Works

### Web Audio Node Graph Architecture
The sound engine (`public/js/audio/engine.js`) constructs a modular, single-bus routing graph that feeds directly into `AudioDestinationNode`:

```
[Layer 1: AudioBufferSourceNode (loop: true, random start offset)]
    │
    ▼
[Trim: GainNode (10^(gainDb / 20))] ── Calibrated per sound layer
    │
    ▼
[Layer Gain: GainNode (volume^2)] ── User slider control
    │
    ▼
[Drift: GainNode (±8% subtle modulation)] ── Organic movement
    │
    ▼
[Panner: StereoPannerNode (pan: -1.0 to 1.0)] ── Spatial placement
    │
    └──────────────► [Channel Bus: GainNode (channel volume^2)] (Rain, Cafe, Fire)
                            │
                            ▼
                     [Mix Highpass: BiquadFilterNode (40 Hz, highpass)]
                            │  Cuts sub-bass rumble
                            ▼
                     [Mix Bus Gain: GainNode (0.6 headroom)]
                            │
                            ▼
                     [Glue Compressor: DynamicsCompressorNode]
                            │  Threshold: -18 dB, Knee: 24 dB, Ratio: 3:1
                            │  Attack: 10 ms, Release: 250 ms
                            ▼
                     [Master Gain: GainNode (master volume^2)]
                            │
                            ▼
                     [Brickwall Limiter: DynamicsCompressorNode]
                            │  Threshold: -3 dB, Knee: 0 dB, Ratio: 20:1
                            │  Attack: 3 ms, Release: 100 ms (Zero clipping)
                            ▼
                     [Analyser: AnalyserNode] ── Real-time dB peak meter
                            │
                            ▼
                     [AudioContext.destination (Speakers / Headphones)]
```

### Key Audio Features
1. **Perceptual Volume Scaling**: Human hearing responds logarithmically. Direct linear volume changes sound jarring. The engine applies quadratic scaling ($G = V^2$) across all channels and layers, ensuring smooth, natural volume curves.
2. **De-correlated Looping**: Rather than starting all loops at 0:00, each layer initializes at `Math.random() * (buffer.duration - 0.05)`. This prevents repetitive phase alignment, creating a seamless, non-repeating environment.
3. **Pops and Clicks Prevention**: Volume changes never use instant `.value = x`. Instead, they use `setTargetAtTime(target, currentTime, timeConstant)` for exponential micro-ramps.
4. **Master Fades & Context Lifecycle**: Pausing fades master gain to 0 over 100ms and waits 320ms before suspending the `AudioContext`. Resuming ramps layers smoothly over 1.2s.
5. **Natural Drift**: When enabled, an asynchronous timer modulates individual active layers by $\pm 8\%$ every 10–25 seconds using gentle exponential transitions.
6. **Zero-Volume Invariant Monitoring**: An internal analyzer continually verifies that whenever a slider is set to 0, its audio gain node is strictly zero, logging warnings if any phantom audio leaks through.
7. **Algorithmic Fallback Generator (`fallback.js`)**: If an MP3 fails to download or decode, the engine synthesizes a 12-second algorithmic brown/pink noise buffer directly in memory so playback never halts.

---

## 5. How the AI Chat Works

### System Prompt & Persona
The Sound Assistant operates under a compact system prompt (~170 tokens) defining its role as an ambience sound engineer:
- Warm, concise tone (1–2 sentences).
- Mandatory JSON output format.
- Output volume levels strictly on a 0 to 100 scale for channels and layers.
- Context awareness: Evaluates incoming `currentMix` to make relative adjustments (e.g., "turn up the fire slightly" $\to$ current fire + 30).
- Dynamically injected one-line user mood profile from MongoDB analytics.

### Strict JSON Response Schema
```json
{
  "reply": "Turned up the fire crackle and embers for a warmer atmosphere.",
  "mood": "cozy",
  "mix": {
    "fire": 70,
    "crackle": 60,
    "embers": 40
  },
  "changes": "Increased fire and crackle volume for warmth."
}
```

### Validation & Sanitization Pipeline (`validateAndCleanResponse`)
1. **JSON Parsing Guard**: Safely parses output in a `try...catch` block. If parsing fails, returns `null` to trigger graceful fallback.
2. **Mood Whitelist Enforcement**: `mood` must match one of the 8 allowed moods: `calm`, `focused`, `sleepy`, `cozy`, `stressed`, `sad`, `happy`, `energetic`.
3. **Catalog Key Filtering**: Any key not listed in the official catalog (`rain`, `coffee`, `fire`, `heavy-rain`, `light-rain`, `window`, `roof`, `thunder`, `chatter`, `espresso`, `crackle`, `firewood`, `embers`) is stripped.
4. **Value Clamping**: All numeric values are clamped strictly between `0` and `100`. Non-numeric values are discarded.
5. **Partial Output Safety**: If `mix` is malformed but `reply` is intact, the assistant presents the reply without modifying the audio.

### Failover Order
```
1. Client-Side Regex Parser (commands.js)   ── Zero tokens, instant local execution
     │
     ▼ (if unhandled)
2. Crisis Keyword Filter (safety.js)        ── Fixed 988 referral, zero model calls
     │
     ▼ (if normal message)
3. Groq API (llama-3.3-70b-versatile)       ── Fast JSON completion (8s timeout)
     │
     ▼ (if API error or timeout)
4. In-Memory Circuit Breaker                ── Trips for 60s on 429/5xx to protect quota
     │
     ▼ (if unavailable)
5. Graceful Assistant Fallback Message      ── "I'm here to help with your ambient soundscape."
```

### Token-Saving & Efficiency Measures
- **Short History Window**: Only the last 6 messages (`.slice(-6)`) are sent to the model.
- **Compressed State**: Silent channels are excluded from the prompt context.
- **One-Line User Profile**: The user's past 30 mood entries are pre-computed on the server into a concise summary string (e.g., *"User usually feels: focused (75%), tends to prefer rain 70 / fire 40 in the morning."*), consuming under 20 tokens.
- **Local-First Routing**: Common actions (pause, volume, presets, sleep timer, "play my usual") bypass the AI model completely.

---

## 6. Security and Safety

### Authentication & Session Security
- **Argon2id Hashing**: Passwords hashed with memory-hard parameters; raw passwords are never logged or stored.
- **Session Fixation Defense**: Sessions are regenerated upon login or registration (`req.session.regenerate()`).
- **Cookie Flags**: Session cookie `ass.sid` is configured with `HttpOnly`, `SameSite=Lax`, and `Secure` (in production/Vercel).
- **Password Masking**: The `passwordHash` field in the Mongoose schema is marked with `select: false` to prevent accidental inclusion in user queries.

### CSRF & Origin Protection (`sameOrigin.js`)
- All state-changing requests (`POST`, `PUT`, `DELETE`, `PATCH`) require an `application/json` Content-Type and an `Origin` or `Referer` header matching the server's `Host` header.
- Cross-origin form submissions and unauthorized scripts receive an immediate `403 Forbidden`.

### Rate Limiting Matrix
| Route Group | Limit | Window | Key / Identifier |
| :--- | :--- | :--- | :--- |
| **All API Endpoints (`/api`)** | 100 requests | 15 minutes | Client IP |
| **Authentication (`/api/auth`)** | 10 requests | 15 minutes | Client IP |
| **Mood Mixer (`/api/mix`)** | 8 requests | 1 minute | Client IP |
| **Saved Mixes (`/api/mixes`)** | 60 requests | 1 minute | User ID (or IP) |

### Mental Health Crisis Protocol
- Evaluated **both client-side and server-side** before any AI model invocation or database write.
- Matches critical phrases relating to suicide, self-harm, depression crisis, or abuse.
- Bypasses the AI model completely and returns the official 988 Suicide & Crisis Lifeline and 741741 Crisis Text Line referral.
- **Zero audio disruption**: Audio levels remain untouched.
- **Zero logging**: Crisis messages are **never** stored in MongoDB as mood entries or listening events.

### API Key Isolation
- All secrets (`GROQ_API_KEY`, `GEMINI_API_KEY`, `MONGODB_URI`, `SESSION_SECRET`) are stored in `.env` and accessed exclusively server-side via `server/config/env.js`.
- Frontend code never contains API keys or connects directly to external AI providers.
- Helmet Content Security Policy prevents the client browser from connecting to external APIs (`connectSrc: ["'self'"]`).

---

## 7. Database Collections & Fields

### `users` (`server/models/User.js`)
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Primary Key | MongoDB internal identifier |
| `email` | String | Required, Unique, Lowercase, Trimmed | User's login email |
| `passwordHash`| String | Required, `select: false` | Argon2id password hash |
| `displayName` | String | Optional, Trimmed, Max 40 chars | User's display name |
| `createdAt` | Date | Default: `Date.now` | Account creation timestamp |
| `lastLoginAt` | Date | Default: `null` | Updated on successful login |
| `consent.personalization` | Boolean | Default: `false` | Personalization consent flag |
| `consent.updatedAt` | Date | Default: `Date.now` | Timestamp of consent update |

### `savedmixes` (`server/models/SavedMix.js`)
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Primary Key | Mix identifier |
| `userId` | ObjectId | Required, Indexed, ref: `User` | Owner's user ID |
| `name` | String | Required, Trimmed, 1–40 chars | User-assigned mix name |
| `levels` | Mixed | Required | Object of channel & layer gains (0.0 to 1.0) |
| `source` | String | Enum: `["manual", "ai"]`, Default: `"manual"` | Origin of the mix |
| `createdAt` | Date | Auto-timestamp | Creation timestamp |
| `updatedAt` | Date | Auto-timestamp | Last update timestamp |
*Compound Index*: `{ userId: 1, createdAt: -1 }` (enforces fast sorted retrieval).

### `chatmessages` (`server/models/ChatMessage.js`)
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Primary Key | Message identifier |
| `userId` | ObjectId | Required, Indexed, ref: `User` | Owner's user ID |
| `role` | String | Enum: `["user", "assistant"]` | Speaker role |
| `text` | String | Required | Message content |
| `time` | Date | Default: `Date.now`, Indexed | Creation timestamp |
*Compound Index*: `{ userId: 1, time: 1 }` (optimizes sequential history retrieval).

### `moodentries` (`server/models/MoodEntry.js`)
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Primary Key | Entry identifier |
| `userId` | ObjectId | Required, Indexed, ref: `User` | Owner's user ID |
| `mood` | String | Required | Detected mood (e.g., "focused", "cozy") |
| `mix` | Mixed | Default: `{}` | Channel volumes snapshot at that moment |
| `time` | Date | Default: `Date.now`, Indexed | Timestamp for time-of-day analytics |
*Compound Index*: `{ userId: 1, time: 1 }` (enforces fast recent 30 entries query).

### `usage_days` (`server/models/UsageDay.js`)
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Primary Key | Record identifier |
| `key` | String | Required, Indexed | Caller hash or `"global"` |
| `date` | String | Required, Indexed | Formatted date string (`YYYY-MM-DD`) |
| `count` | Number | Default: `0` | Requests consumed on that date |
| `createdAt` | Date | Default: `Date.now`, Expire: 3 days | TTL index auto-deleting stale tracking docs |
*Unique Index*: `{ key: 1, date: 1 }`

### `sessions` (Managed by `connect-mongo`)
| Field | Type | Description |
| :--- | :--- | :--- |
| `_id` | String | Session ID (`ass.sid`) |
| `expires` | Date | Expiration timestamp (14-day TTL auto-purged by MongoDB) |
| `session` | String | Serialized session JSON containing `userId` |

---

## 8. Feature Status Matrix

| Feature | Status | Notes |
| :--- | :---: | :--- |
| **Web Audio Graph** (3 channels, 10 layers, buses, limiter, panners) | **Working** | Calibrated MP3s, sub-bass cut, glue compressor, zero-clipping limiter. |
| **Audio Loading & Resilient Fallback** | **Working** | Asynchronous load; synthesized noise buffer prevents crash if asset missing. |
| **Natural Drift Modulation** | **Working** | Subtle $\pm 8\%$ procedural gain modulation on active layers. |
| **Master Controls & Sliders** | **Working** | Master volume, channel volumes, layer sliders, mute toggle, spacebar/M shortcuts. |
| **User Authentication** | **Working** | Argon2id password hashing, MongoStore sessions, 14-day session cookies. |
| **Saved Mixes CRUD** | **Working** | Create, view, rename, delete, load mix; strictly capped at 50 mixes per user. |
| **One-Shot Mood Mixer** | **Working** | Generates soundscapes from natural language via Gemini (with keyword fallback). |
| **Local-First Assistant Parser** | **Working** | Deterministic regex handles volume, presets, sleep timers with zero latency. |
| **AI Assistant Chat** | **Working** | Groq API (`llama-3.3-70b-versatile`) in strict JSON mode with 8s timeout. |
| **Smooth Mix Animation (2s)** | **Working** | 2000ms cubic ease-out transition on sliders & audio gains with undo chip. |
| **Sleep Timer** | **Working** | Set by local command or assistant; displays live banner and smooth fade-out. |
| **Mood Analytics & "Play my usual"** | **Working** | Analyzes last 30 entries; custom greeting on reload + one-click signature mix. |
| **Crisis Safety Protocol** | **Working** | Client and server interceptors return 988 referral; zero audio changes. |
| **CSRF & Rate Limiting** | **Working** | Same-origin header checks + express-rate-limit across all endpoints. |
| **Accessibility & Dark/Light Themes** | **Working** | WCAG AA contrast tested, ARIA live regions, focus trapping in dialogs. |
| **Serverless Deployment (Vercel)** | **Working** | Deployed on `ambiencesoundstudio.vercel.app` with cached DB connections. |
| **Personalization Consent Settings Toggle** | **Not finished** | Database model field exists, but no client UI settings toggle is built yet. |
| **Daily Token Limiter Integration** | **Partly working** | `chatLimiter.js` & `UsageDay` model exist; `/api/chat` currently relies on session auth + `apiRateLimit`. |
| **Audio Credits Table** | **Not finished** | `CREDITS.md` table structure exists but individual attribution rows are unpopulated. |
| **Offline PWA / Service Worker** | **Not working** | No service worker installed; application requires network connection for initial load. |

---

## 9. 5-Minute Step-by-Step Demo Script

### Minute 0:00 – 1:00: Overview & Manual Mixer Experience
- **Action**: Open `https://ambiencesoundstudio.vercel.app` (or `http://localhost:3000`).
- **Explain**: *"Ambient Sound Studio is an ambient audio workspace designed for concentration and calm. Notice the clean, high-contrast interface and instant load time."*
- **Click**: Click the big **Play** button at the top.
- **Listen**: Sound fades in gently over 1.2 seconds.
- **Interact**: Click on the **Rain** channel card to expand the detail panel. Adjust the **Window** and **Thunder** sliders.
- **Highlight**: *"Each channel uses perceptual quadratic volume curves, true stereo panning, and calibrated trims so sounds sit naturally in the stereo field without muddying the mix."*

### Minute 1:00 – 2:00: Account Sign-In & Cloud Sync
- **Click**: Click the account button at the top right $\to$ choose **Sign In** (or create a new test account).
- **Enter**: `reviewer@example.com` / `Password123!` $\to$ click **Sign In**.
- **Highlight**: *"Authentication uses memory-hard Argon2id hashing and MongoDB persistent session cookies. Sessions survive serverless cold starts on Vercel."*
- **Click**: Click **Save Mix** $\to$ enter `Midnight Study` $\to$ click **Save**.
- **Explain**: *"Mixes are saved to MongoDB with strict Zod validation against the catalog schema, isolated per user with a 50-mix safety cap."*

### Minute 2:00 – 3:15: Sound Assistant, Smooth Animation & Undo
- **Click**: Click the **Chat / Assistant** button on the top right to open the drawer.
- **Type**: Type `warmer` and press **Enter** (or click the **Warmer** chip).
- **Watch**: The sliders glide smoothly over 2 seconds (`ANIMATION_DURATION_MS = 2000`) as Fireplace crackle and embers ramp up.
- **Highlight**: *"Notice the smooth 2-second ease-out animation on the UI sliders and Web Audio gains, accompanied by a mix summary chip below the response."*
- **Click**: Click the **Undo** button next to the mix chip. The sliders smoothly return to their previous levels.
- **Type**: Type `sleep timer in 15 minutes`.
- **Highlight**: *"The assistant parser executes local commands instantly in the browser with zero tokens and zero latency, showing an active countdown banner."*

### Minute 3:15 – 4:00: Personalized Experience & "Play My Usual"
- **Action**: Press `Cmd + R` (or `F5`) to reload the entire web page.
- **Click**: Re-open the **Sound Assistant** chat drawer.
- **Highlight**: Show the bottom greeting:
  > *"Welcome back! Ready for your usual cozy mix with rain 70 / fire 40?"*
- **Explain**: *"The server analyzes the user's past 30 mood records in MongoDB, calculates their top mood, average channel blend, and preferred time of day, and greets them on reload."*
- **Click**: Click the **"Play my usual"** chip at the top of the chat drawer.
- **Watch**: The sliders smoothly glide to the signature mix in 2 seconds.

### Minute 4:00 – 4:45: AI Mood Mixer & Safety Protocol
- **Action**: Scroll to the **Mood Mixer** card on the main screen.
- **Type**: Enter `reading an old book by the window during an autumn storm` $\to$ click **Create mix**.
- **Highlight**: *"Gemini generates a custom calibrated soundscape, assigns creative naming and descriptions, and smoothly adjusts the audio channels."*
- **Click**: Open the Assistant drawer once more.
- **Type**: Enter `I feel overwhelmed and want to hurt myself`.
- **Watch**: Instant crisis response appears with the 988 Suicide & Crisis Lifeline link.
- **Highlight**: *"Safety first: crisis detection runs before any AI model call. It never modifies audio, never calls paid tokens, and never stores crisis text as a mood."*

### Minute 4:45 – 5:00: Wrap-Up & Production Readiness
- **Explain**: *"The app is fully responsive, passes 100% of automated unit, smoke, and contrast checks, and runs in production on Vercel with MongoDB Atlas."*

---

## 10. 10 Questions a Reviewer Might Ask (with Code-Accurate Answers)

### Q1: Why use Web Audio API instead of standard `<audio>` elements?
**Answer**: `<audio>` tags only play single audio streams linearly. The Web Audio API allows us to build a multi-node DSP graph with sub-bass high-pass filtering (40 Hz), glue compression, brickwall limiting, true stereo panning, perceptual volume scaling, and algorithmic noise fallbacks with sample-accurate scheduling.

### Q2: Why quadratic scaling ($G = V^2$) instead of linear volume sliders?
**Answer**: Human perception of sound loudness is logarithmic. A linear slider ($0.5 = 50\%$ gain) sounds quiet for the lower half and barely changes in the upper half. Squaring the slider value ($V^2$) provides a smooth, natural taper that matches the ear's response curve.

### Q3: How do you prevent audio clipping when all 10 layers are turned to 100%?
**Answer**: In `public/js/audio/engine.js`, the mix bus passes through a two-stage dynamic control system: first a glue compressor (`threshold: -18dB, ratio: 3:1`) to consolidate the signals, followed by a dedicated brickwall limiter (`threshold: -3dB, ratio: 20:1, attack: 3ms`) before output to the speakers.

### Q4: How does the system achieve zero-token execution for common commands?
**Answer**: The client-side command parser (`public/js/assistant/commands.js`) evaluates input using regex patterns before contacting the backend. Requests like volume changes, mutes, presets, sleep timers, and "play my usual" execute instantly in the browser without any API latency or token usage.

### Q5: How do you handle cold starts and database drops on Vercel serverless?
**Answer**: In `server/config/db.js`, the Mongoose connection promise is cached globally so concurrent requests await the in-flight connection. If MongoDB is completely unreachable, static assets and audio playback still work normally, and endpoints return structured JSON status messages (`accounts_unavailable`) rather than unhandled 500 crashes.

### Q6: What prevents Cross-Site Request Forgery (CSRF) attacks?
**Answer**: The `sameOrigin.js` middleware validates that every state-changing HTTP request (`POST`, `PUT`, `DELETE`, `PATCH`) has `Content-Type: application/json` and an `Origin` or `Referer` header matching the server's `Host` (or forwarded host). Cross-site HTML forms cannot forge JSON payloads with custom origin headers.

### Q7: Why use Argon2id instead of bcrypt for password hashing?
**Answer**: Argon2id is the winner of the Password Hashing Competition (PHC). Unlike bcrypt, which is vulnerable to GPU-accelerated brute-force attacks due to low memory usage, Argon2id is memory-hard and parameterized against both GPU and side-channel timing attacks.

### Q8: How is the personalized greeting generated without leaking past messages to the model?
**Answer**: `server/services/moodAnalytics.js` performs aggregation over the user's last 30 `MoodEntry` records in MongoDB. It computes the top mood, average channel percentages, and time-of-day bucket in Node.js. It passes only a single-line summary (under 20 tokens) to the model and formats the greeting directly on the server.

### Q9: What happens if an audio asset is missing or fails to decode?
**Answer**: `public/js/audio/loader.js` wraps individual layer fetches in separate try/catch blocks. If an asset fails with an HTTP error or corrupt buffer, `createFallbackBuffer()` synthesizes a 12-second algorithmic brown/pink noise buffer on the fly. Playback continues uninterrupted, and a small badge notes fallback status in the debug panel.

### Q10: How is user privacy maintained with third-party LLMs?
**Answer**: The Groq API client strictly logs only metadata (token count, latency in ms, caller type). It never logs user prompts, raw messages, or AI responses. Furthermore, crisis messages are caught by regex on the server and never forwarded to LLM APIs or stored in database mood collections.

---

## 11. Not Finished / Planned Scope

To ensure complete presentation transparency, the following items are partially implemented or planned for future milestones:

1. **Personalization Consent UI Toggle**:
   - *Status*: The database schema (`server/models/User.js`) includes `consent.personalization` and `consent.updatedAt`, but there is currently no client settings panel or checkbox in the UI allowing the user to toggle this preference.
2. **Dedicated Chat Token Limiter Integration**:
   - *Status*: `server/services/chatLimiter.js` and the `UsageDay` Mongoose model are written and tested (providing daily IP/user quota tracking and cooldowns), but `/api/chat` currently relies on session authentication and general Express rate limiting (`apiRateLimit`) rather than strictly calling `checkAndConsumeUsage()`.
3. **Audio Attribution Metadata in `CREDITS.md`**:
   - *Status*: `CREDITS.md` contains the markdown table header for file, title, author, source link, and license, but the individual attribution rows for the 10 MP3 files have not yet been filled in.
4. **Offline PWA / Service Worker**:
   - *Status*: The application has no registered Service Worker. While the audio engine can run fallbacks if individual assets fail, the web app itself cannot be loaded initially without an active Internet connection.

