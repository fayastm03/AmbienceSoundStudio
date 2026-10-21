# Stabilization Audit: Ambient Sound Studio

This audit inspects the full server and client implementation to identify failure modes, security gaps, accessibility issues, and UI edge cases.

---

## Findings Matrix

| ID | File & Line | Severity | Category | Summary & Root Cause | Planned Fix |
|---|---|---|---|---|---|
| **DB-1** | `server/index.js:37, 47-49`, `server/config/db.js:4-6` | **Critical** | Database / Stability | `MongoStore.create` creates an unhandled promise rejection on `clientP`/`collectionP` and emits unhandled `'error'` events when Atlas connection fails. In addition, `mongoose.connection` lacks an `'error'` event handler. Any connection drop or SSL failure crashes the entire Node.js process, taking down guest mode and static file serving. | 1. Attach `catch()` to `sessionStore.clientP` and `sessionStore.collectionP`.<br>2. Add `sessionStore.on("error", ...)` and `mongoose.connection.on("error", ...)`.<br>3. Set `serverSelectionTimeoutMS: 5000` and `bufferCommands: false` in Mongoose to prevent process termination on DB drops. |
| **DB-2** | `server/index.js:32-39, 44` | **Critical** | Architecture / Stability | `app.use(session(...))` is mounted before `app.use(express.static("public"))`. If the session store is down, static asset requests (`/`, `/js/*`, `/sounds/*`) go through session middleware and fail, preventing guests from loading the app or audio. | Mount `express.static("public")` before session middleware, or ensure session store failures cleanly fall back so static guest assets always serve. |
| **DB-3** | `server/routes/auth.js:73-85`, `server/routes/mixes.js:58-69` | **Major** | Resilience / Performance | When MongoDB is disconnected, Mongoose defaults to buffering operations for 10 seconds (`bufferCommands: true`), causing `/api/auth/me` and `/api/mixes` to hang before throwing. | Check `mongoose.connection.readyState === 1`. If disconnected, `/api/auth/me` immediately returns `{ user: null, accountsAvailable: false }` with HTTP 200, and protected mutating routes return HTTP 503 `Accounts are temporarily unavailable`. |
| **SYS-1** | `server/index.js:47-50` | **Moderate** | Lifecycle | Server lacks graceful shutdown handlers (`SIGTERM`, `SIGINT`). Terminating or restarting the server abruptly severs active HTTP connections and leaves Mongo sockets open. | Add `SIGTERM` and `SIGINT` handlers that close the HTTP server and cleanly disconnect Mongoose with a 5-second force timeout. |
| **SEC-1** | `server/middleware/sameOrigin.js:7-11` | **Major** | Security / Usability | `sourceUrl.host !== request.get("host")` does a strict string match. When browsing via `http://127.0.0.1:3000` while `Host` is `localhost:3000` (or vice versa, or across local ports in development), legitimate requests are blocked with HTTP 403 `Origin not allowed`. | In development (`env.nodeEnv !== "production"`), permit both `localhost` and `127.0.0.1` on the configured `PORT`. Retain strict host matching in production. |
| **SEC-2** | `server/middleware/rateLimit.js:11-17` | **Moderate** | Rate Limiting | `authRateLimit` allows only 10 requests per 15 minutes per IP. Running automated smoke tests or failing password entry temporarily locks the user's IP out of all auth endpoints. | Differentiate login attempts from generic auth requests; retain brute-force limits on login while ensuring normal development and smoke tests do not permanently lock out the user. |
| **SEC-3** | `server/middleware/errorHandler.js:4` | **Minor** | Error Handling | `errorHandler` checks `error.statusCode || 500`, ignoring `error.status`. Custom HTTP 4xx errors with `.status` get converted to HTTP 500. | Check `error.status || error.statusCode || 500`. |
| **SEC-4** | `server/index.js:17-27` | **Minor** | CSP | CSP specifies `styleSrc: ["'self'"]` without `'unsafe-inline'`. Dynamic CSS custom properties injected via `innerHTML` (e.g. `style="--value: ..."` in `detail-panel.js`) trigger CSP violation warnings in browser consoles. | Set dynamic styles via DOM `element.style.setProperty()` in `detail-panel.js` rather than inline template strings. |
| **UI-1** | `public/js/ui/controls.js:22` | **Major** | Global Shortcuts | Global shortcuts (`Space` for play/pause, `M` for mute) fire when typing in `<textarea>`, `<select>`, `[contenteditable]`, and whenever any modal or panel is open (`#authModal`, `#mixesPanel`, `#detailPanel`). Typing "m" in a password mutes the audio, and pressing Space on a focused button toggles playback. | Guard shortcut listener: skip if `event.target.closest("input, textarea, select, button, [contenteditable], [role='button'], [role='tab']")` or if any dialog/panel is open (`#authModal:not([hidden])`, `[aria-hidden='false']`, or `body.modal-open`). |
| **UI-2** | `public/css/layout.css:1-3`, `public/css/components.css:2, 44` | **Moderate** | Responsive Layout | On small mobile viewports (360px), `.header-actions` contains 4 elements ("My mixes", username, "Sign in", and theme toggle with 3 buttons) totaling ~440px width. Without `flex-wrap: wrap`, the header overflows the screen horizontally. | Add `flex-wrap: wrap; gap: 10px;` to `.header-actions` and adjust layout at 360px, 768px, and 1280px so buttons and theme controls wrap neatly without clipping. |
| **UI-3** | `public/js/ui/auth.js:29` | **Minor** | User Identity | Header displays `user.displayName || user.email`. If a user has no display name, their full email address is displayed in the header. | If `displayName` is missing, format as the part of the email before `@` (`email.split("@")[0]`), safely truncated. |
| **UI-4** | `public/js/ui/detail-panel.js:2`, `public/js/ui/saved-mixes.js:46-60` | **Major** | Modal & Panel Overlap | Both `#detailPanel` and `#mixesPanel` use `z-index: 5` and fixed positioning. Opening one panel while the other is open causes visual overlap. In addition, `detail-panel.js` fails to add `modal-open` to lock background scrolling. | 1. Opening `#mixesPanel` must close `#detailPanel`, and vice-versa.<br>2. Opening `#authModal` closes or stacks over open panels.<br>3. Both panels lock background scrolling via `body.modal-open` and restore scroll only when all overlays close. |
| **UI-5** | `public/js/ui/auth.js:45-52`, `public/js/ui/saved-mixes.js:240-255` | **Moderate** | Accessibility / Focus Trap | Focus trap in modals only tests boundary elements if already focused; if focus is on dialog background or exterior, Tab escapes the modal. | Standardize focus trap: if active element is outside dialog focusable list, redirect to first element. Trap `Shift+Tab` on first and `Tab` on last element. |
| **UI-6** | `public/js/ui/auth.js:63-71` | **Moderate** | Form Usability | Submit button is disabled on click but displays no loading text ("Signing in…", "Creating account…"). Double clicks or network latency leave the user without visual feedback. Inline error messages for invalid email or password length do not appear under input fields. | Add visible loading text during submission, add field-level error containers with `aria-describedby` and aria-live announcements, and prevent double submission. |
| **UI-7** | `public/css/components.css:67` | **Moderate** | Theme / Contrast | `.mix-button-apply` uses `background: var(--accent-fill); color: #fff;`. In dark theme, `--accent-fill` is `[151, 202, 197]` (light teal), resulting in an illegible **1.81:1** contrast ratio with `#fff`. | Set `.mix-button-apply` to `background: var(--accent); color: var(--surface);` which maintains **>6:1** contrast in both Light and Dark themes. Extend `tools/check-contrast.mjs` to test all new component tokens. |
| **UI-8** | `public/js/ui/saved-mixes.js:192-230`, `public/js/ui/mood-mixer.js:60-84` | **Minor** | Accessibility / Motion | `applyMix` and `animateMix` run 1.5–2.0 second `requestAnimationFrame` animations regardless of `prefers-reduced-motion: reduce`. | Check `window.matchMedia("(prefers-reduced-motion: reduce)").matches` in both animation functions and apply targets immediately if reduce-motion is active. |

---

## Detailed Root Cause Analysis

### 1. Database Failure & Process Termination (DB-1, DB-2, DB-3)
- **Root Cause**: `connect-mongo` v5 initializes a MongoClient via an internal promise stored at `store.clientP`. When DNS resolution (`querySrv`) or TLS negotiation fails (such as an Atlas "SSL alert number 80"), Node.js triggers an unhandled promise rejection because no `.catch()` was attached to `store.clientP` or `store.collectionP`. In addition, `store` emits an `'error'` event with 0 registered listeners, prompting Node.js to throw `Unhandled 'error' event` and exit.
- **Root Cause (Static Assets)**: Because `session` is mounted globally before `express.static("public")`, every static asset request attempts to query the session store. When MongoDB is down, requests hang or crash rather than serving the static guest studio.
- **Root Cause (Buffering Queries)**: When Mongoose is disconnected, `bufferCommands: true` intercepts queries and holds them for up to 10 seconds before throwing. Any user loading `/` causes a 10s delay on `/api/auth/me`.

### 2. Same-Origin Middleware Port & Host Matching (SEC-1)
- **Root Cause**: `server/middleware/sameOrigin.js` compares `new URL(source).host !== request.get("host")`. In local development, developers and test tools alternate between `http://localhost:3000` and `http://127.0.0.1:3000`. This strict comparison rejects cross-loopback requests with HTTP 403.

### 3. Global Shortcuts (UI-1)
- **Root Cause**: `controls.js` line 22 checks `if (event.target.matches("input, button")) return;`. This guard fails when:
  1. The user focuses any element inside `#authModal`, `#mixesPanel`, or `#detailPanel` that is not an `<input>` or `<button>` (e.g. tab headers, dialog container, form labels).
  2. The user types inside a `<textarea>`, `<select>`, or `[contenteditable]` element.
  3. A button is focused: pressing Space triggers native button activation while simultaneously firing `play.click()`.
  4. Typing "m" while entering a password or mix name triggers `mute.click()`.

### 4. Color Contrast in Dark Theme (UI-7)
- **Root Cause**: In `public/css/components.css`, `.mix-button-apply` specifies `color: #fff` against `background: var(--accent-fill)`. In Dark theme, `--accent-fill` resolves to `rgb(151, 202, 197)`. The contrast ratio is 1.81:1, severely violating WCAG AA (minimum 4.5:1).

---

## Verification Plan

1. **Phase 2 (Login & Account Fixes)**:
   - Handle Mongo connection drops without crashing.
   - Guard `/api/auth/me` with `accountsAvailable: false` on DB failure.
   - Update `sameOrigin.js` to accept `localhost` and `127.0.0.1` on configured port in development.
   - Implement field-level inline error display and aria-live announcements.
   - Enforce display name / email truncation.
2. **Phase 3 (UI Fixes)**:
   - Fix global shortcut guard for all input types, buttons, and open modals/panels.
   - Fix panel/modal mutual exclusion, scroll locking, and focus traps.
   - Fix responsive layout of header actions at 360px, 768px, and 1280px.
   - Fix contrast of `.mix-button-apply` and update `tools/check-contrast.mjs`.
   - Add reduced-motion checks to slider animations.
3. **Phase 4 (Offline Smoke & Verification)**:
   - Add `npm run check` and `npm run smoke:offline`.
   - Verify `smoke:offline` passes when MongoDB is disconnected.
   - Update documentation in `README.md` and `DATA-MODEL.md`.

