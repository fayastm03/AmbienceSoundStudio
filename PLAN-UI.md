# Ambient Sound Studio UI plan

## Files to add or change

- `public/index.html`: replace the header's separate account, mixes, and theme controls with one account-menu mount; add the save-mix control, toast/live-region mount, shortcut dialog, now-playing chip, and guest tip mounts.
- `public/js/ui/account-menu.js`: own account-button rendering, guest/signed-in menu actions, menu keyboard navigation, theme segmented control, shortcut dialog, and overlay/focus coordination.
- `public/js/ui/auth.js`: expose the existing modal open flow for account-menu actions, preserve authentication state and availability handling, and notify the account menu/toasts after auth changes.
- `public/js/ui/theme.js`: render the existing Light/Auto/Dark control wherever the account menu places it without changing persisted theme tokens or transitions.
- `public/js/ui/saved-mixes.js`: integrate account-menu actions and feedback, save/apply/rename/delete affordances, level bars, filtering, loading/empty states, and focus behavior.
- `public/js/ui/controls.js`: add the Save mix transport action and ensure global shortcuts ignore menus, dialogs, panels, and all interactive/typing targets.
- `public/js/ui/main.js`: compose the new modules, close overlays consistently, and wire now-playing/toast updates without changing audio-engine behavior.
- `public/js/ui/toast.js`: add the non-blocking polite toast region and timed dismissal.
- `public/css/base.css`, `public/css/layout.css`, `public/css/components.css`, and `public/css/themes.css`: style the account popover/sheet, dialogs, toast, tip, now-playing chip, save control, cards, and responsive states while retaining current visual tokens.
- `tools/check-contrast.mjs`: extend the existing fixed-token checks for the new account/menu/feedback surfaces.
- `README.md`: add a short account-menu and keyboard-shortcuts note.

## Risks and mitigations

- Overlay state can otherwise leave two panels open or the body locked. Use one shared `panel:open`/close path, a single `modal-open` body state, explicit return-focus elements, and Escape/outside-click handling.
- Account availability is discovered asynchronously. Keep the guest UI usable, hide Sign in only after `accountsAvailable:false` is reported, and retain calm unavailable messaging.
- Keyboard handling can accidentally make Space play while activating a menu item. The existing shortcut listener already ignores buttons and interactive controls and open panels; extend that guard to the account menu/dialog and keep menu key handling on the menu itself with `preventDefault()`.
- Initials/background colors must be deterministic and readable in both themes. Generate a stable name hash, choose a soft palette, and check foreground contrast against the palette background.
- Saved-mix rendering is user data. Continue escaping names before HTML insertion and use inline forms/events rather than browser dialogs.
- Responsive changes must not cover playback controls. Keep the toast above the transport on narrow screens and switch the menu to a full-width sheet below 480px.

## Existing global shortcut guards

`public/js/ui/controls.js` listens at `document` level. It exits before handling a shortcut when a modal or detail/mixes panel is open, when `body.modal-open` is set, or when the event target is an input, textarea, select, contenteditable element, button, link, or ARIA button/tab. Therefore Space and M currently cannot toggle playback from those controls. Phase 1 will add the account menu and shortcut dialog to the same overlay guard and will keep menu item activation on its own keydown handler, so Space activates the focused item instead of reaching playback.
