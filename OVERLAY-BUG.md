# OVERLAY-BUG.md: Root Cause Diagnosis & Evidence

*Note on browser control:* Headless browser automation (Puppeteer/Playwright/Chromium) is not installed in the environment. This diagnosis is conducted through static code and CSS stacking context analysis with exact line references and DOM hierarchy verification.

---

## 1. Stacking Context & Z-Index Analysis

### Root Cause 1.1: Backdrop Rendered Over Panel Content
- **Location**: `public/css/components.css`, lines 364 & 370
- **Code**:
  ```css
  /* line 364 */
  .panel-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.4); z-index: var(--z-scrim); }
  .panel-content { position: absolute; top: 0; right: 0; width: min(440px, 100%); height: 100%; padding: 34px; overflow: auto; background: var(--surface); color: var(--text); ... }

  /* line 370 */
  .auth-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); z-index: var(--z-scrim); }
  .auth-dialog { position: relative; width: min(420px, 100%); ... }
  ```
- **Evidence**:
  - In `public/index.html` lines 102–115 & 117–158:
    `.panel-backdrop` and `.panel-content` are sibling children inside `<aside class="detail-panel">`.
    `.auth-backdrop` and `.auth-dialog` are sibling children inside `<div class="auth-modal">`.
  - In CSS, `--z-scrim` is set to `300`.
  - `.panel-backdrop` has `position: absolute; inset: 0; z-index: 300;`.
  - `.panel-content` has `position: absolute;` but **no z-index** (evaluates to `z-index: auto`, stacking level 0).
  - Similarly, `.auth-backdrop` has `z-index: 300`, while `.auth-dialog` has **no z-index** (stacking level 0).
  - Therefore, `.panel-backdrop` and `.auth-backdrop` form stacking contexts with $z=300$ that paint **directly on top** of `.panel-content` and `.auth-dialog`!
  - Because the backdrop is full-bleed (`inset: 0`) and sits on top, the panel appears tinted/greyed out (the dark scrim tint covers the panel surface), and every mouse click anywhere on the panel strikes the backdrop element instead of the buttons.

---

## 2. Click Handling & Overlay Dismissal

### Root Cause 2.1: Backdrop Click Closes the Overlay
- **Location**: `public/js/ui/overlay.js`, lines 157–173
- **Code**:
  ```javascript
  document.addEventListener("click", (event) => {
    if (!activeOverlay) return;
    const target = event.target;
    if (
      target.matches("[data-close-overlay]") ||
      target.matches("[data-close-panel]") ||
      target.matches("[data-close-mixes]") ||
      target.matches("[data-auth-close]") ||
      target.matches("[data-shortcut-close]") ||
      target.classList.contains("panel-backdrop") ||
      target.classList.contains("auth-backdrop") ||
      target.classList.contains("shortcut-backdrop")
    ) {
      event.preventDefault();
      closeActiveOverlay();
    }
  });
  ```
- **Evidence**:
  - When the user attempts to click any button inside "My mixes" (e.g. Apply, Rename, Delete, Save) or Channel Details or Auth Modal, the click hit-test resolves to `.panel-backdrop` / `.auth-backdrop` because the backdrop is stacked above the content.
  - The document-level click listener sees `target.classList.contains("panel-backdrop")` and calls `closeActiveOverlay()`, closing the entire panel immediately ("it goes back").

### Root Cause 2.2: Document Click Listener Triggered on Open
- In `account-menu.js` (lines 135–139), a document click listener was bound synchronously. In general, click listeners that listen to bubbling can observe the opening click if not decoupled. Switching to a single `pointerdown` listener on a shared scrim, registered after the opening event tick, prevents ghost closures.

---

## 3. DOM Hierarchy & `inert` Application

### Root Cause 3.1: Overlay Elements Not Isolated in `#overlay-root`
- **Location**: `public/index.html` lines 21–24, 102, 117, 160, 204
- **Evidence**:
  - `#accountPopover` is currently inside `<div id="accountMenu" class="account-menu">` inside `<header class="topbar" id="studioTopbar">`.
  - When a panel or modal opened, `overlay.js` (lines 8–15) called `setInert([main, topbar], true)`.
  - If `#accountPopover` is inside `topbar`, applying `inert` to `topbar` makes the popover inert, preventing any user interaction.
  - Furthermore, having individual backdrop elements inside each panel/modal duplicates scrims and causes intra-panel stacking bugs.
- **Architectural Fix Required**:
  - Create `#app-root` wrapping `#studioTopbar`, `#studioMain`, and `#transportDock`.
  - Create `#overlay-root` as a sibling of `#app-root` directly under `<body>`.
  - Move `#overlayScrim`, `#accountPopover`, `#detailPanel`, `#mixesPanel`, `#authModal`, and `#shortcutDialog` into `#overlay-root`.
  - Apply `inert` and `aria-hidden="true"` strictly to `#app-root` (never to `#overlay-root`).

---

## 4. Visibility Overrides by `.btn` & Missing `[hidden]` CSS Rule

### Root Cause 4.1: Stray "Save this mix" and Empty "Now playing" Pill
- **Location**: `public/css/base.css` (missing `[hidden]` rule) & `public/css/components.css` line 3 (`.btn { display: inline-flex; }`) & line 194 (`.now-playing { display: inline-block; }`)
- **Evidence**:
  - Browsers apply `[hidden] { display: none; }` with specificity $(0, 1, 0)$.
  - `.btn` in `components.css` specifies `display: inline-flex;`.
  - `.now-playing` in `components.css` specifies `display: inline-block;`.
  - Because `[hidden] { display: none !important; }` was absent in `base.css`, `.btn` and `.now-playing` overrode `hidden` on elements that had both attributes.
  - As seen in the user's screenshots:
    1. `<button id="moodSaveButton" class="btn btn-secondary mood-save-button" hidden>` was rendered with `display: inline-flex`, making "Save this mix" visible before a mix was created!
    2. `<p id="nowPlaying" class="now-playing" hidden></p>` was rendered with `display: inline-block`, displaying a stray empty grey pill in the transport dock!

### Root Cause 4.2: Guest Tip Visibility for Signed-in Users
- **Location**: `public/js/main.js` lines 48–52
- **Evidence**:
  - On page load, `main.js` initialized `guestTip.hidden` using only `localStorage.getItem("ambient-tip-dismissed") === "1"`.
  - Because the initial `/api/auth/me` call is asynchronous, the tip displayed for signed-in users until `auth:change` resolved (or stayed visible if the event didn't update before snapshot).
  - The guest tip must also be guaranteed to sit above the sticky dock without clipping.

---

## 5. Stacking Context Verification Summary

| Element | Desired Z-Index Token | Value | Problem Identified | Fix |
|---|---|:---:|---|---|
| `#studioTopbar` | `--z-topbar` | 100 | Stacks inside `#app-root` | Placed inside `#app-root` |
| `#transportDock` | `--z-dock` | 110 | Stacks inside `#app-root` | Placed inside `#app-root` |
| `#accountPopover` | `--z-menu` | 200 | Inside topbar (became inert) | Moved to `#overlay-root` |
| `#overlayScrim` | `--z-scrim` | 300 | Was duplicated inside panels | Single shared scrim in `#overlay-root` |
| `.detail-panel`, `.mixes-panel` | `--z-panel` | 310 | Backdrop was sibling with $z=300$ while content had $z=\text{auto}$ | Scrim separated; panel content has $z=310 > 300$ |
| `.auth-modal`, `.shortcut-dialog` | `--z-modal` | 400 | Backdrop was sibling with $z=300$ while dialog had $z=\text{auto}$ | Scrim separated; modal dialog has $z=400 > 300$ |
| `#toastRegion` | `--z-toast` | 500 | Correct | In `#overlay-root` or direct body child |

---

## 6. Diagnosis Complete
Phase 0 diagnosis is complete with root causes proven and documented. Proceeding to Phase 1.

