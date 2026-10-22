# UI Audit: Ambient Sound Studio

> **Environment Note**: Browser automation (Puppeteer/Playwright/Chromium) is not available in this environment. This document is a comprehensive code-based audit of all public assets, stylesheets, scripts, templates, layout structures, and accessibility trees, detailing the exact files, lines, root causes, and planned fixes, along with the checklist for manual verification.

---

## 1. Executive Summary & Reported Issues

| ID | Issue Description | Location | Severity | Root Cause | Planned Fix |
|---|---|---|---|---|---|
| **ISSUE-1** | Account avatar button renders above scrim & above My mixes panel, overlapping heading | `public/css/components.css:3, 51`, `public/index.html:18-21` | **Critical** | `.account-menu` has hardcoded `z-index: 25`, whereas `.detail-panel` and `.mixes-panel` have `z-index: 5`. When the panel opens, `.account-menu` stays on top of both the backdrop and the panel content. | Define a unified z-index scale tokens (`--z-topbar: 100`, `--z-dock: 110`, `--z-menu: 200`, `--z-scrim: 300`, `--z-panel: 310`, `--z-modal: 400`, `--z-toast: 500`). Lower `.account-menu` below scrim and manage all overlay stacking through `js/ui/overlay.js`. |
| **ISSUE-2** | In My mixes, "Filter mixes" label appears with no visible input, even with only 2 mixes | `public/index.html:94-95`, `public/css/components.css:47`, `public/js/ui/saved-mixes.js:135-137` | **Major** | In `components.css:47`, `.mix-filter-label { display: block; }` overrides the HTML `hidden` attribute. The `<input>` has no such CSS override so it remains hidden, leaving an orphan label visible at all times. In addition, the filter should only be present when mixes count > 8. | In CSS, ensure `[hidden] { display: none !important; }` or style the filter input and label together. Only show the filter input and label when `mixes.length > 8`. Add clear button and accessible search styling. |
| **ISSUE-3** | Mix cards have empty gap where level bars should be; bars do not render | `public/js/ui/saved-mixes.js:184-188`, `public/css/components.css:48-49`, `server/index.js:17-27` | **Major** | `saved-mixes.js` constructs `<span class="mix-level-bar" style="--level:${level}%;--bar-color:rgb(...)">` via `innerHTML`. Content Security Policy (`styleSrc: ["'self'"]` without `'unsafe-inline'`) blocks inline `style="..."` attributes, so `--level` and `--bar-color` are never set. The CSS gradient evaluates to transparent, rendering an invisible bar. | Implement bar layout with an inner fill element (`<span class="mix-level-bar" role="progressbar" aria-valuenow="..." aria-label="..."><span class="mix-level-fill"></span></span>`) whose width/color are populated via DOM properties or structured classes, or allow a safe scoped CSS custom property representation. |
| **ISSUE-4** | Inconsistent button styles (dark Save, teal Apply, outlined Rename/Delete; Delete not destructive) | `public/css/components.css:63, 75-80, 100, 112-117` | **Moderate** | Multiple ad-hoc button classes (`.save-mix-submit`, `.mix-button`, `.mix-button-apply`, `.mix-button-delete`) with inconsistent colors, borders, paddings, and hover effects. Delete only changes color on hover instead of looking clearly destructive. | Implement unified button system in `components.css`: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`. Standardize minimum height to 44px, uniform border radii, focus rings, hover, active, and disabled states. |
| **ISSUE-5** | Uneven spacing & type sizes (gap between description & name field; oversized description text; uneven card padding; cards with fixed heights & empty space) | `public/css/components.css:23, 29, 52, 98`, `public/css/layout.css:4, 20` | **Moderate** | Channel cards have `min-height: 300px` and asymmetric padding (`27px 26px 25px`). Panel headers have `font-size: 30px` and description margin `18px 0 32px` while save row has margin `18px 0 24px`, creating a 56px whitespace canyon. | Standardize type scale and spacing scale. Set channel cards to content-based height with equal flex/grid stretching and uniform padding (`var(--space-4)` / 16px or 20px). Normalize panel header typography and description spacing. |
| **ISSUE-6** | Play/Pause, Mute, Master controls below the fold on standard laptop screens (1280x720); hero title wastes vertical space | `public/css/layout.css:1, 9, 13, 21`, `public/index.html:15, 42-48` | **Major** | Hero `h1` has `font-size: clamp(32px, 5vw, 57px)` with large top padding (`53px`) and intro margin (`68px`). Transport controls are situated at the bottom of the main document stream instead of being pinned in a persistent dock. Total page height exceeds 760px on desktop. | Refactor header into a slim sticky top bar. Replace in-flow `.transport` with a sticky bottom player dock containing Play/Pause (prominent), Mute, Master slider with percentage, Save mix button, and "now playing" chip. Compact hero typography and margins so the entire studio is visible at 1280x720 without scrolling. |
| **ISSUE-7** | Avatar colour (pink) clashes with calm blue-grey palette | `public/js/ui/account-menu.js:28-33` | **Moderate** | `avatarColor(name)` computes `hash % 360` with `hsl(hue 42% 78%)`. Full 360-degree hue distribution generates magenta, hot pink, and saturated tones that clash with the app's slate/slate-blue palette. | Select from a curated array of 6 calm, palette-matched colors (slate, ocean, mist, pine, dusk, warm pebble) that guarantee high contrast with dark initials in both light and dark modes. |

---

## 2. In-Depth Component & Code Audit

### 2.1 DOM Nesting & Structural Bugs
- **`public/index.html:122-128`**: The `<div class="shortcut-dialog" id="shortcutDialog" hidden>` is erroneously nested **inside** `<form id="signInPanel">`. If submitted via Enter, form submission can inadvertently target buttons inside the shortcut dialog, and the dialog is subjected to form styling and validation constraints.
  - *Fix*: Move `#shortcutDialog` out of `<form id="signInPanel">` into the root body overlay container.

### 2.2 Stacking Contexts & Z-Index Hierarchy
- Current hardcoded values in `public/css/components.css`:
  - `.account-menu`: `z-index: 25`
  - `.detail-panel`: `z-index: 5`
  - `.debug-panel`: `z-index: 10`
  - `.auth-modal`: `z-index: 20`
  - `.shortcut-dialog`: `z-index: 30`
  - `.toast-region`: `z-index: 40`
- **Failure Mode**: When `.mixes-panel` or `.detail-panel` (`z-index: 5`) is open, `.account-menu` (`z-index: 25`) paints on top of the panel and backdrop. Clicking in the top right activates the account menu instead of closing or interacting with the panel.
- *Fix*: Create standard z-index tokens in `base.css`:
  ```css
  --z-topbar: 100;
  --z-dock: 110;
  --z-menu: 200;
  --z-scrim: 300;
  --z-panel: 310;
  --z-modal: 400;
  --z-toast: 500;
  ```

### 2.3 Overlays, Focus Traps, and Scroll Lock
- **Absence of Shared Overlay Manager**: Overlays currently toggle `document.body.classList.toggle("modal-open")` independently. If the account menu opens a modal, closing the modal removes `modal-open` even if a panel is still active.
- **Missing `inert` Attribute**: Background content remains discoverable by assistive technologies and screen readers when a modal or drawer is open.
- **Escape Key Inconsistencies**: Each overlay attaches separate `Escape` handlers to `document` or its container, causing multiple overlays to fight or race.
- *Fix*: Centralize in `public/js/ui/overlay.js`:
  - Manage overlays: `accountMenu`, `detailPanel`, `mixesPanel`, `authModal`, `shortcutDialog`.
  - Enforce single active overlay rule: opening an overlay closes any currently open overlay.
  - Apply `inert` to `<main class="studio">` and other background containers while an overlay is open.
  - Trap `Tab` and `Shift+Tab` strictly within the active overlay.
  - Dismiss on `Escape` or clicking the shared scrim.
  - Return focus cleanly to the element that triggered the overlay.

### 2.4 Touch Target Sizes (< 44px)
- **`public/css/components.css:43`**: `.guest-tip button` is 30px × 30px.
- **`public/css/components.css:53`**: `.close-button` is 36px × 36px.
- **`public/css/components.css:112`**: `.mix-button` is padding 6px 12px with height ~28px.
- **`public/css/components.css:90`**: `.mood-save-button` has height ~24px.
- **`public/css/components.css:21`**: `.theme-options button` has height ~26px.
- *Fix*: Enforce `min-height: 44px; min-width: 44px;` across all interactive buttons and inputs. Use generous hit areas on close icon buttons.

### 2.5 Contrast & Theme Tokens
- Verified with `tools/check-contrast.mjs`:
  - Text pairs pass WCAG AA (>= 4.5:1).
  - Sliders pass graphical contrast (>= 3:1).
- **Potential Failure**: Ad-hoc color tokens or pink avatar generation (`hsl(hue 42% 78%)`) against white initials yields poor contrast (< 3:1 on light pastels).
- *Fix*: Use fixed 6-color palette with verified luminance ratios >= 4.5:1 against the avatar initial color `#18232d`.

### 2.6 Responsive Layout & Viewports
- **320px & 360px Viewports**:
  - Topbar contains app title, account button, theme buttons, resulting in horizontal wrapping conflicts.
  - Transport controls wrap unevenly, pushing sliders off-screen.
- **768px & 1024px Tablets**:
  - Channel cards grid collapses abruptly to 1 column at 720px (`@media (max-width: 720px)`), making cards excessively tall on iPad portrait (768px).
- **1280x720 & 1440x900 Desktops**:
  - Vertical viewport clipping of controls.
- *Fix*:
  - Sticky top bar: left-aligned logo/app title, right-aligned account avatar.
  - Persistent bottom dock: 2 compact rows on mobile (<= 25% screen height), 1 row on desktop.
  - Content-based card sizing with CSS Grid `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`.

### 2.7 Reduced Motion
- Animations (`rain`, `steam`, `flicker`, `ember`, slider transitions) must strictly honor `@media (prefers-reduced-motion: reduce)`.
- JavaScript animations in `saved-mixes.js` and `mood-mixer.js` must verify `window.matchMedia("(prefers-reduced-motion: reduce)").matches` and snap to final levels instantly.

---

## 3. Manual Inspection Checklist (for Browser Verification)

When running the application in a browser:
1. **Desktop Viewport (1280x720 & 1440x900)**:
   - [ ] Top bar, mood mixer, 3 channel cards, and bottom dock all visible without scrolling.
   - [ ] No vertical scrollbar on the main window at 1280x720 when cards are in default state.
2. **Mobile Viewport (360x740 & 390x844)**:
   - [ ] Bottom dock is sticky and occupies <= 25% of viewport height.
   - [ ] Play/Pause button is the primary tactile target.
   - [ ] No horizontal scrolling at 320px or 360px.
3. **Overlay & Stacking**:
   - [ ] Open "My mixes": Account button is dim behind the scrim, NOT hovering above the panel.
   - [ ] Open Channel Detail panel: Closes "My mixes" panel if open; locks background scroll.
   - [ ] Open Account Menu: Closes any open panel.
   - [ ] Open Sign-in Modal: Scrim covers entire page; `Escape` closes modal and returns focus to "Sign in".
4. **My Mixes Panel**:
   - [ ] 0 mixes: Shows calm empty state ("No saved mixes yet").
   - [ ] 2 mixes: Shows cards with 3 clearly rendered level bars; "Filter mixes" input and label are **NOT** present.
   - [ ] > 8 mixes: "Filter mixes" search field and clear button appear cleanly at the top.
   - [ ] Mix cards display uniform primary/secondary/danger buttons.
   - [ ] Clicking "Delete" reveals inline "Yes / No" confirmation in destructive red styling.
5. **Color & Theme**:
   - [ ] Avatar initial uses calm blue-grey/slate tones; never magenta or pink.
   - [ ] Light, dark, and auto themes maintain high contrast on all text and UI elements.
   - [ ] `node tools/check-contrast.mjs` executes and passes.

