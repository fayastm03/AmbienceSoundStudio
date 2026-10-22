# PLAN-CHAT.md: Conversational Ambience Assistant Architecture

## 1. Overview & Objective
Ambient Sound Studio provides soundscapes across 3 channels (Rain, Coffee Shop, Fireplace) with 10 total layers, session-authenticated saved mixes, and an AI mood mixer. 

This plan defines the architecture for a conversational ambience assistant that allows users to adjust sound balances, switch moods, manage playback, control volume, and set sleep timers directly via natural language. 

The system follows a strict **Local-First** design:
- Any command understandable via local heuristics, keyword matching, and typo-tolerant fuzzy parsing **never** calls a cloud model.
- A future cloud model (e.g. Groq / Llama 3) will only be invoked when `parseCommand()` returns `null`.
- In Phase 1, `askAssistant()` returns `{ unavailable: true }`, with helpful example prompts displayed to guide the user.

---

## 2. Token Budget Table (Future AI Call Targets)

When cloud model integration is introduced in later phases, model tokens are strictly bounded:

| Component | Target Tokens | Allocation Strategy & Content |
|---|:---:|---|
| **System Prompt** | ~280 tokens | Concise instructions, role definition, JSON schema definition, strict whitelist of valid channel (`rain`, `coffee`, `fire`) and layer IDs (`heavy-rain`, `light-rain`, `window`, `roof`, `thunder`, `chatter`, `espresso`, `crackle`, `firewood`, `embers`). Strict output format requirement. |
| **Catalog & Context** | ~170 tokens | Compact state summary: current master volume, active channels/layers with non-zero gains, sleep timer status, user's saved mix titles (up to 5 titles). |
| **User Message** | ~50 tokens | User input truncated to a hard limit of 160 characters (~40-50 tokens max). |
| **Conversation History** | ~100 tokens | At most the last 1 user turn and 1 assistant reply (if relevant), otherwise omitted. |
| **Total Input Budget** | **≤ 600 tokens** | Guarantees ultra-fast inference and minimal rate limit consumption. |
| **Output Response** | **≤ 150 tokens** | Structured JSON object: `{ "actions": [...], "reply": "Short conversational acknowledgment (max 1 sentence)." }`. |

---

## 3. Files to Add or Change

### New Files to Create:
1. `public/js/assistant/commands.js`
   - Exports `parseCommand(text, ctx)`.
   - Normalizes text (lowercase, removes filler words and punctuation).
   - Typo-tolerant fuzzy matching (Levenshtein distance $\le 1$ or $\le 2$ for longer tokens).
   - Recognizes:
     - Playback: `play`, `pause`, `stop`, `mute`, `unmute`.
     - Master volume: `louder`, `quieter`, `volume up`, `volume down` ($\pm 0.15$), `volume 40%`.
     - Target adjustment: `more X`, `less X`, `X up`, `X down`, `turn up X` ($\pm 0.2$), `set X to N%`, `turn off X` ($0$).
     - Presets: `sleep`, `focus`, `reading`, `calm`, `cosy`, `storm`.
     - Quick modifiers: `warmer` (+fire, -coffee), `less crowded` (-chatter).
     - Mix operations: `surprise me` (random constrained generation), `apply <saved mix>` (fuzzy match).
     - State queries & utilities: `what's playing`, `reset`, `undo`, `help`.
     - Sleep timer: `sleep in N minutes/hours`, `timer N min`, `cancel timer`.
   - Returns `{ actions, reply }` or `null` (signals need for AI).

2. `public/js/assistant/executor.js`
   - Validates and applies actions through smoothed transitions (~1.5s animation).
   - Enforces parameter bounds (clamps volume to $0.0 - 1.0$, verifies valid channel/layer IDs).
   - Manages an in-memory Undo stack of the last 10 snapshots (`channels`, `master`).
   - Manages sleep timer lifecycle:
     - Tracks countdown timer.
     - Smoothly fades master volume to 0 over the final 60 seconds (or proportionally for timers $<1$ min).
     - Pauses playback upon expiration and restores master gain.
     - Cancellable at any time.
   - Enforces user gesture rules: triggers `engine.start()` or `engine.resume()` only within user event handlers (e.g. clicking Send or chip buttons).

3. `public/js/assistant/ai-client.js`
   - Exports `askAssistant(message, ctx)`.
   - Phase 1 mock: enforces a 2-second cooldown and returns `{ unavailable: true }`.
   - Designed to swap seamlessly with a Groq API client in subsequent iterations.

4. `public/js/ui/assistant.js`
   - Floating non-modal assistant UI component:
     - Desktop: Fixed bottom-right card above dock controls.
     - Mobile: Bottom sheet drawer, responsive and touch-friendly.
   - Contains message history (in-memory only, capped at 20 messages), quick-action chips, input field (max 160 chars), Send button, and Undo button.
   - Accessible: ARIA live regions for replies, labeled form controls, 44px min touch targets, full keyboard accessibility.

5. `scripts/test-commands.mjs`
   - Automated unit test suite using `node:test` covering at least 40 distinct command phrases, typo variations, edge cases, and unrecognized phrases returning `null`.

### Existing Files to Modify:
1. `public/index.html`
   - Add `#assistantButton` to the top bar actions next to `#accountMenu`.
   - Add `<aside id="assistantPanel" class="assistant-panel" ...>` inside `#overlay-root`.
2. `public/css/components.css` & `public/css/layout.css`
   - Styles for `.assistant-panel`, `.assistant-messages`, `.assistant-chips`, `.assistant-form`, and responsive bottom-sheet rules.
3. `public/js/ui/overlay.js`
   - Support `dismissOnOutside: false` so clicking sliders on the main page does not dismiss the non-modal assistant panel.
4. `public/js/main.js`
   - Initialize and bind `bindAssistant()` with `engine`, `state`, `soundscapes`, and `savedMixes`.
5. `package.json`
   - Add `"test:commands": "node scripts/test-commands.mjs"` and include it in `npm run check`.
6. `scripts/overlay-check.mjs`
   - Verify `#assistantPanel` is included in `#overlay-root`.

---

## 4. Overlay Manager (`overlay.js`) Integration

The assistant panel must remain accessible alongside main canvas controls without blocking user interactions:
1. **Non-Modal Configuration**:
   - Registered with `registerOverlay("assistantPanel", { element, contentElement, usesScrim: false, trapFocus: false, dismissOnOutside: false })`.
   - `usesScrim: false`: No dark scrim backdrop is rendered.
   - Background inerting disabled: `#app-root` is **never** given `inert` or `aria-hidden="true"`, allowing sliders, channel cards, and transport buttons to remain fully interactive while the chat is visible.
   - `dismissOnOutside: false`: Clicking main canvas sliders does not dismiss the assistant chat.
2. **Dismissal & Focus Rules**:
   - `Escape` key closes the assistant panel and returns focus to `#assistantButton`.
   - Opening any modal (e.g. `#authModal`, `#mixesPanel`, `#detailPanel`, `#shortcutDialog`) immediately closes the assistant panel via `openOverlay()`.
   - Close button (`#closeAssistant`) explicitly closes the panel.
3. **Z-Index Layering**:
   - Positioned at `z-index: var(--z-panel)` (310), ensuring it renders above the transport controls (`--z-dock`: 110) and canvas elements (`--z-topbar`: 100).
   - Full dialog modals (`--z-modal`: 400) stack above the assistant panel if triggered.

---

## 5. Potential Risks & Mitigations

1. **Audio Context User Gesture Restriction**:
   - *Risk*: Web Audio requires a user gesture to resume or start an `AudioContext`. If the assistant tries to execute "play" asynchronously or after a delayed response, browsers will block playback.
   - *Mitigation*: The `executor.js` initiates `engine.start()` / `engine.resume()` synchronously within the click event listener of the Send button or quick-action chip.
2. **Untrusted Input & XSS**:
   - *Risk*: Rendering user messages or model replies via `innerHTML` can expose XSS vulnerabilities.
   - *Mitigation*: Strictly render all chat bubbles and system messages using `textContent` and `createElement`.
3. **Out-of-Bounds or Malicious Actions**:
   - *Risk*: User requests or model hallucinations specify invalid channels, negative gains, or unbounded values.
   - *Mitigation*: Every action is whitelisted and clamped between `0.0` and `1.0`. Any unknown channel or layer ID is rejected.
4. **Layout Collision with Transport Dock / Play Controls**:
   - *Risk*: On small viewports, the bottom sheet could obscure transport playback buttons.
   - *Mitigation*: Styled as a bottom sheet drawer with clear visual demarcation and z-index positioning; does not trap focus, leaving controls reachable.
5. **Memory Leak in Message History**:
   - *Risk*: Long chat sessions bloating browser memory.
   - *Mitigation*: Maximum of 20 messages stored strictly in-memory; older messages are pruned on push.

