# Saved Mixes Implementation Plan

## Overview

Ambient Sound Studio allows signed-in users to save, browse, apply, rename, and
delete custom soundscape mixes. The feature builds upon the existing Express +
Mongoose + session authentication infrastructure while preserving full guest
playback and leaving the Web Audio engine and visual design intact.

---

## Target File Layout

```text
.
├── public/
│   ├── index.html                     (modify: add "My mixes" button, saved mixes panel markup, AI save button container)
│   ├── css/
│   │   └── components.css             (modify: add styles for mixes panel, list, save row, and states)
│   ├── js/
│   │   ├── api/client.js              (modify: add mix CRUD client functions, enforce JSON headers)
│   │   ├── config/soundscapes.js      (read-only: catalog shared with server validation)
│   │   ├── main.js                    (modify: bind saved mixes module and wire auth/engine)
│   │   ├── ui/
│   │   │   ├── auth.js                (modify: export openAuthModal, dispatch/notify on auth state changes)
│   │   │   ├── mood-mixer.js          (modify: display "Save this mix" button after mix generation)
│   │   │   └── saved-mixes.js         (new: panel controls, focus trap, animation, live feedback)
│   │   └── state/store.js             (read-only: state access for channel & layer levels)
├── server/
│   ├── index.js                       (modify: mount /api/mixes router)
│   ├── middleware/
│   │   ├── rateLimit.js               (modify: add mixesRateLimit: 60 req/min/user)
│   │   └── requireAuth.js             (read-only: gate /api/mixes endpoints)
│   ├── models/
│   │   └── SavedMix.js                (new: Mongoose schema and compound index)
│   └── routes/
│       └── mixes.js                   (new: GET, POST, PATCH /:id, DELETE /:id with Zod validation)
├── scripts/
│   ├── smoke-auth.mjs                 (read-only)
│   └── smoke-mixes.mjs                (new: comprehensive test suite for saved mixes & user isolation)
├── package.json                       (modify: add npm run smoke:mixes script)
├── DATA-MODEL.md                      (modify: document SavedMix schema, limits, and indexes)
├── PLAN-MIXES.md                      (new: this plan)
└── README.md                          (modify: document feature, endpoints, tests, and manual verification)
```

---

## Phase 1: Server Implementation

### 1. Data Model (`server/models/SavedMix.js`)
- **Collection**: `savedmixes` (Mongoose Model `SavedMix`)
- **Fields**:
  - `userId`: `mongoose.Schema.Types.ObjectId`, required, indexed, references `User`.
  - `name`: `String`, required, trimmed, min length 1, max length 40.
  - `levels`: `mongoose.Schema.Types.Mixed`, required. Represents:
    `{ <channelId>: { channel: number (0-1), layers: { <layerId>: number (0-1) } } }`.
  - `source`: `String`, enum `["manual", "ai"]`, default `"manual"`, required.
  - `createdAt`: `Date`, default `Date.now`.
  - `updatedAt`: `Date`, default `Date.now`.
- **Index**: Compound index `{ userId: 1, createdAt: -1 }`.
- **Constraint**: Master volume is **NOT** stored.

### 2. Routes (`server/routes/mixes.js`)
Mounted at `/api/mixes`, all routes protected by `requireAuth`:
- `GET /api/mixes`:
  - Finds all mixes for `request.session.userId`, sorted by `createdAt: -1`.
  - Returns `{ mixes: [...] }`.
- `POST /api/mixes`:
  - Body size checked to not exceed 8 KB (413 if exceeded).
  - Validates body against Zod `createMixSchema`.
  - Counts existing mixes for `request.session.userId`. If count >= 50, returns `409 Conflict`.
  - Creates mix with `userId: request.session.userId` (never from body/URL).
  - Returns `201 Created` with `{ mix: ... }`.
- `PATCH /api/mixes/:id`:
  - Body size checked to not exceed 8 KB.
  - Validates `:id` as valid ObjectId. Returns `404` if invalid.
  - Validates body against Zod `renameMixSchema` (strictly `name` only, trimmed, 1-40 chars, no extra fields).
  - Updates matching `{ _id: id, userId: request.session.userId }`.
  - Returns `404` if no matching record found (prevents probing other users' IDs).
  - Returns `200 OK` with `{ mix: ... }`.
- `DELETE /api/mixes/:id`:
  - Validates `:id` as valid ObjectId. Returns `404` if invalid.
  - Deletes matching `{ _id: id, userId: request.session.userId }`.
  - Returns `404` if no matching record found.
  - Returns `200 OK` with `{ ok: true }`.

### 3. Zod Validation & Catalog Re-use
- Import `soundscapes` directly from `public/js/config/soundscapes.js` (verified to have no browser-specific globals).
- Construct dynamic Zod schema based on catalog:
  - Channels must strictly match `soundscapes.map(s => s.id)`.
  - Layers for each channel must strictly match that channel's `s.layers.map(l => l.id)`.
  - Volumes must be numbers between `0` and `1`.
  - `.strict()` is enforced at the root and nested levels to reject unknown fields (e.g. `master`, `userId`, unexpected channels/layers).
- Request body limit: Middleware enforces max 8,192 bytes.

### 4. Middleware & Rate Limiting
- Reuses `sameOrigin` from `server/middleware/sameOrigin.js` (enforcing origin/referer check and JSON content).
- Adds `mixesRateLimit` in `server/middleware/rateLimit.js`:
  - 60 requests per minute per user (`keyGenerator: (req) => req.session?.userId || req.ip`).

### 5. Automated Testing (`scripts/smoke-mixes.mjs`)
- Tests:
  1. Guest access to GET/POST/PATCH/DELETE returns `401 Unauthorized`.
  2. Authenticated user can create, list, rename, and delete a mix.
  3. Limit enforcement: invalid payloads (unknown channel, unknown layer, out-of-range volume, extra field `master`, invalid ObjectId, blank name, >40 character name) are rejected with `400` or `404`.
  4. Isolation check: User B cannot view, rename, or delete User A's mix (must return `404 Not Found`).

---

## Phase 2: Front End Implementation

### 1. Panel & UI Markup (`public/index.html`)
- Add `<button type="button" id="mixesOpen" class="auth-button">My mixes</button>` in `.header-actions`.
- Add slide-in `<aside class="detail-panel mixes-panel" id="mixesPanel" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="mixesTitle">`:
  - Identical slide-in structure as `.detail-panel`: backdrop (`data-close-mixes`), `.panel-content`, header with close button.
  - Aria-live polite status region for accessibility feedback.
  - Guest section: "Sign in to save mixes" with action button opening the sign-in modal.
  - Authenticated section:
    - "Save current mix" row with text input (`#saveMixName`), save button (`#saveMixButton`).
    - Mix list container (`#mixesList`) with loading, empty, and error templates.
    - Each mix item contains: title, date, source badge, Apply button, Rename button (inline input toggle or prompt), and Delete button with two-step confirmation ("Confirm delete").
- In AI mood mixer section, add a container next to `#moodExplanation` for a "Save this mix" button.

### 2. Client API Helper (`public/js/api/client.js`)
- Extend `apiRequest` to ensure `Content-Type: application/json` is sent even on `DELETE` / empty bodies so `sameOrigin` middleware accepts the request.
- Add typed helper functions:
  - `getSavedMixes()`
  - `createSavedMix({ name, levels, source })`
  - `renameSavedMix(id, name)`
  - `deleteSavedMix(id)`

### 3. Saved Mixes Component (`public/js/ui/saved-mixes.js`)
- Manages panel open/close, focus trap (`Tab`/`Shift+Tab`), `Escape` key dismissal, and returns focus to the trigger button.
- "Save current mix":
  - Reads current channel volumes and layer volumes from `getState()` (excludes master).
  - Calls `createSavedMix()`, updates list, and announces success via aria-live region.
- "Apply mix":
  - Checks for undo function (`window.pushUndo?.()`).
  - Animates channel and layer sliders to target levels over 1.5 seconds using cubic easing (`1 - (1 - progress) ** 3`).
  - Passes volume changes through `engine.setChannel(channelId, vol)` and `engine.setLayer(channelId, layerId, vol)`.
  - Invariant guarantee: If a layer's saved value is `0`, ensure it is set to `0` and stays completely silent (audio engine zeros drift and gain).
  - Calls `render(engine.active)` on each frame and saves state at conclusion.
- AI mood mixer integration:
  - When AI mood mix succeeds, renders "Save this mix" button.
  - Clicking pre-fills the save name with the AI-suggested title, sets source to `"ai"`, and opens the mixes panel (or prompts sign-in if guest).
- Guest handling:
  - If user is not signed in, buttons are visible but panel displays the guest sign-in prompt.
  - A 401 error caught from API calls cleanly switches UI to guest state without throwing uncaught errors or affecting audio playback.
  - List refreshes automatically upon sign-in.

### 4. Styling & Theming (`public/css/components.css`)
- Style `.mixes-panel`, `.save-mix-row`, `.mix-item`, `.mix-actions`, `.confirm-dialog`, `.source-badge`.
- Use existing design tokens: `var(--surface)`, `var(--surface-2)`, `var(--text)`, `var(--muted)`, `var(--line)`, `var(--accent)`, `var(--accent-soft)`, `var(--shadow)`.
- Support Light, Dark, and Auto modes seamlessly with high contrast and focus rings.

---

## Phase 3: Documentation and Verification

1. Update `DATA-MODEL.md`:
   - Document `SavedMix` schema, compound index, 50-mix ceiling, and master volume exclusion.
2. Update `README.md`:
   - Document saved mixes API routes, rate limiting, smoke tests, and manual testing instructions.
3. Validate all JavaScript files with `node --check`.

---

## Risks and Mitigations

1. **Database Unreachability in Test Environment**:
   - *Risk*: MongoDB cluster URI in `.env` is remote/unreachable from offline sandbox environments, preventing live DB queries during automated tooling runs.
   - *Mitigation*: Ensure code is statically verified with `node --check`. Provide a self-contained smoke script `scripts/smoke-mixes.mjs` that connects when a reachable database is configured, and clearly document manual verification steps.
2. **`sameOrigin` Middleware 415 on Empty Payloads**:
   - *Risk*: `sameOrigin` rejects any `DELETE` or `PATCH` request missing `Content-Type: application/json`.
   - *Mitigation*: In `public/js/api/client.js`, ensure `Content-Type: application/json` is always passed on mutating HTTP methods, and provide `{}` payload in `fetch` calls.
3. **Audio Zero-Volume Invariant**:
   - *Risk*: Web Audio engine logs a zero-volume invariant violation if gain is not strictly zeroed when slider is 0.
   - *Mitigation*: In the mix animation loop, ensure any target volume of `0` strictly executes the engine's zero-gain branches and clears drift timers.
4. **Guest Mode Disruption**:
   - *Risk*: Unauthenticated API requests throwing uncaught rejections could break UI rendering or stop audio.
   - *Mitigation*: Wrap all mix client calls in try/catch; if 401 occurs, gracefully fall back to guest display without altering engine state.
5. **Cross-User Data Leaks & Probing**:
   - *Risk*: A user attempting to access or modify another user's mix might distinguish between "forbidden" (403) and "does not exist" (404), allowing mix ID enumeration.
   - *Mitigation*: Every database query filters by `_id AND userId`. If no document matches, always return `404 Not Found`. Validate all IDs as valid MongoDB ObjectIds before querying.

