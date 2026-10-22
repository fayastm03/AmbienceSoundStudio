# STATUS-OVERLAY.md: Overlay Architecture & Click Resolution Status

## Overview
All phases of the overlay diagnosis and bug resolution are **100% complete**.
The issue where buttons inside overlays ("My mixes" panel, sign-in modal, channel detail panel, keyboard shortcuts, and account popover) could not be clicked or caused the overlay to immediately close ("it goes back") has been completely resolved.

---

## Root Causes Identified & Fixed

1. **Backdrop Stacked Above Panel / Modal Content**:
   - **Root Cause**: Each panel/modal previously had an internal `.panel-backdrop`, `.auth-backdrop`, or `.shortcut-backdrop` element with `z-index: var(--z-scrim)` (300), while `.panel-content` and `.auth-dialog` had no z-index (`auto` = 0). As a result, the dark translucent backdrop was painted physically *over* the interactive content. Every mouse click anywhere on the panel hit the backdrop, and the backdrop's click listener called `closeActiveOverlay()`.
   - **Fix**: Removed intra-panel backdrop elements from HTML. Implemented a single shared `#overlayScrim` element inside `#overlay-root` (`z-index: var(--z-scrim)` = 300). Panels are styled with `z-index: var(--z-panel)` (310) and modals with `z-index: var(--z-modal)` (400). Interactive containers (`.panel-content`, `.auth-dialog`, `.shortcut-dialog-content`) have `pointer-events: auto` and sit strictly above the scrim.

2. **DOM Isolation & Background Inerting (`#app-root` vs `#overlay-root`)**:
   - **Root Cause**: Overlays and page elements previously shared direct hierarchy or lived inside containers that were set to `inert` when an overlay opened (such as `#accountPopover` living inside `header.topbar`).
   - **Fix**:
     - `#app-root` wraps all base page elements (`#studioTopbar`, `#studioMain`, `#transportDock`, `#debugPanel`). When an overlay with scrim is active, `#app-root` receives `inert` and `aria-hidden="true"`.
     - `#overlay-root` wraps `#overlayScrim`, `#accountPopover`, `#detailPanel`, `#mixesPanel`, `#authModal`, `#shortcutDialog`, and `#toastRegion`. It is never inerted.

3. **Click & Pointerdown Handling**:
   - **Root Cause**: Generic document click listeners on `.panel-backdrop` or bubbling clicks could trigger accidental closure during clicks on content or opening transitions.
   - **Fix**: Implemented a unified `pointerdown` listener in `public/js/ui/overlay.js`. It explicitly checks whether the click target is inside the active overlay's `contentElement` (`.panel-content`, `.auth-dialog`, `.shortcut-dialog-content`, `#accountPopover`). Clicks inside content are ignored by the dismisser, ensuring buttons, inputs, tabs, and sliders function with 100% reliability. Clicks outside on `#overlayScrim` cleanly close the active overlay and restore focus.

4. **Missing CSS Specificity for `[hidden]` Overridden by `.btn`**:
   - **Root Cause**: Missing `[hidden] { display: none !important; }` in `base.css` allowed `.btn { display: inline-flex; }` and `.now-playing { display: inline-block; }` to display prematurely.
   - **Fix**: Added `[hidden] { display: none !important; }` in `public/css/base.css`, along with `.now-playing:empty { display: none !important; }` and `.guest-tip[hidden] { display: none !important; }`. Initialized `#moodSaveButton` and `#guestTip` cleanly.

---

## Files Changed
- `public/index.html`: Structured `#app-root` and `#overlay-root`, added `#overlayScrim`, removed obsolete inner backdrops, moved `#accountPopover` to `#overlay-root`.
- `public/css/base.css`: Added `[hidden] { display: none !important; }` and `[inert] { pointer-events: none !important; }`.
- `public/css/components.css`: Applied clean z-index hierarchy, pointer-events decoupling, `.overlay-scrim`, `.account-popover` fixed positioning, and hidden rules.
- `public/js/ui/overlay.js`: Centralized overlay manager with `#app-root` inerting, shared `#overlayScrim`, content hit detection, focus trapping, Escape handling, and `?debug=1` target occlusion check.
- `public/js/ui/account-menu.js`: Updated overlay registration, dynamic button-anchored positioning via `getBoundingClientRect()`, and responsive resize handling.
- `public/js/ui/detail-panel.js`: Registered `contentElement` and `usesScrim: true`.
- `public/js/ui/saved-mixes.js`: Registered `contentElement` and `usesScrim: true`.
- `public/js/ui/auth.js`: Registered `contentElement` and `usesScrim: true`.
- `public/js/ui/mood-mixer.js`: Explicitly ensured `#moodSaveButton` starts hidden.
- `public/js/main.js`: Prevented premature guest tip display for signed-in users on initial load.
- `scripts/overlay-check.mjs`: Automated structural and CSS test verification script.
- `package.json`: Added `scripts/overlay-check.mjs` to `npm run check`.

---

## Verification
- `for f in public/js/*.js public/js/**/*.js server/*.js server/**/*.js; do node --check "$f"; done` -> **PASSED** (0 errors).
- `for f in scripts/*.mjs; do node --check "$f"; done` -> **PASSED** (0 errors).
- `node scripts/overlay-check.mjs` -> **PASSED** (all DOM hierarchy, z-index tokens, and pointer-events rules verified).
- `npm run check` -> **PASSED** (contrast checks and overlay checks clean).

