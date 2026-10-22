// Centralized overlay manager for Ambient Sound Studio.
// Coordinates scrims, background inerting, scroll lock, focus trapping, Escape handling, and focus restoration.
// Enforces that at most ONE overlay is active at any time.

const registry = new Map();
let activeOverlay = null;

function getAppRoot() {
  return document.querySelector("#app-root") || document.querySelector("main.studio");
}

function getScrim() {
  return document.querySelector("#overlayScrim");
}

function setInert(element, inert) {
  if (!element) return;
  if (inert) {
    element.inert = true;
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  } else {
    element.inert = false;
    element.removeAttribute("inert");
    element.removeAttribute("aria-hidden");
  }
}

export function getFocusableElements(container) {
  if (!container) return [];
  const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  return [...container.querySelectorAll(selector)].filter((el) => {
    if (el.disabled || el.closest("[hidden]")) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

export function registerOverlay(id, handlers) {
  const element = handlers.element;
  const contentElement = handlers.contentElement || element?.querySelector(".panel-content, .auth-dialog, .shortcut-dialog-content") || element;
  registry.set(id, {
    element,
    contentElement,
    open: handlers.open,
    close: handlers.close,
    trapFocus: handlers.trapFocus !== false,
    usesScrim: handlers.usesScrim !== false,
    dismissOnOutside: handlers.dismissOnOutside !== false,
  });
}

export function openOverlay(id, options = {}) {
  const definition = registry.get(id);
  if (!definition) return;

  // If another overlay is open, close it cleanly first
  if (activeOverlay) {
    if (activeOverlay.id === id) return;
    closeOverlay(activeOverlay.id, { returnFocus: false });
  }

  const trigger = options.trigger || document.activeElement;
  activeOverlay = {
    id,
    definition,
    trigger: trigger && typeof trigger.focus === "function" ? trigger : null,
  };

  const scrim = getScrim();
  const appRoot = getAppRoot();

  if (definition.usesScrim) {
    document.body.classList.add("modal-open");
    if (scrim) {
      scrim.hidden = false;
      scrim.setAttribute("data-scrim-for", id);
    }
    setInert(appRoot, true);
  }

  if (typeof definition.open === "function") {
    definition.open();
  }

  requestAnimationFrame(() => {
    if (options.focusTarget && typeof options.focusTarget.focus === "function") {
      options.focusTarget.focus();
    } else if (definition.contentElement || definition.element) {
      const focusables = getFocusableElements(definition.contentElement || definition.element);
      focusables[0]?.focus();
    }

    // Diagnostic check in debug mode (?debug=1)
    if (new URLSearchParams(window.location.search).get("debug") === "1") {
      const focusables = getFocusableElements(definition.contentElement || definition.element);
      const target = focusables[0];
      if (target) {
        const rect = target.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (hit && !target.contains(hit) && !hit.contains(target) && !definition.element.contains(hit)) {
          console.warn(`[Overlay Debug] ${id} focus target is covered by:`, hit);
        }
      }
    }
  });
}

export function closeOverlay(id, options = {}) {
  if (!activeOverlay) return;
  if (id && activeOverlay.id !== id) return;

  const current = activeOverlay;
  activeOverlay = null;

  if (typeof current.definition.close === "function") {
    current.definition.close();
  }

  const scrim = getScrim();
  const appRoot = getAppRoot();

  if (current.definition.usesScrim) {
    if (scrim) {
      scrim.hidden = true;
      scrim.removeAttribute("data-scrim-for");
    }
    setInert(appRoot, false);
    document.body.classList.remove("modal-open");
  }

  const shouldReturnFocus = options.returnFocus !== false;
  if (shouldReturnFocus && current.trigger && document.body.contains(current.trigger)) {
    try {
      current.trigger.focus();
    } catch {
      // Ignore if element is not focusable
    }
  }
}

export function closeActiveOverlay(options) {
  if (activeOverlay) {
    closeOverlay(activeOverlay.id, options);
  }
}

export function getActiveOverlay() {
  return activeOverlay ? activeOverlay.id : null;
}

export function isOverlayOpen(id) {
  return activeOverlay?.id === id;
}

// Global keyboard trap & Escape handling
document.addEventListener("keydown", (event) => {
  if (!activeOverlay) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeActiveOverlay();
    return;
  }

  if (event.key === "Tab" && activeOverlay.definition.trapFocus) {
    const container = activeOverlay.definition.contentElement || activeOverlay.definition.element;
    if (!container) return;
    const focusables = getFocusableElements(container);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first || !container.contains(document.activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !container.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  }
}, true);

// Global outside click / scrim / dismissal listener
document.addEventListener("pointerdown", (event) => {
  if (!activeOverlay) return;

  const target = event.target;
  const current = activeOverlay;
  const content = current.definition.contentElement || current.definition.element;

  // 1. If explicit close button was clicked, let its handler handle it or close
  if (target.closest("[data-close-overlay], [data-close-panel], [data-close-mixes], [data-auth-close], [data-shortcut-close], .close-button")) {
    return;
  }

  // 2. If click is inside the overlay content, DO NOT close
  if (content && content.contains(target)) {
    return;
  }

  // 3. For popover menus (usesScrim: false, e.g. accountMenu):
  // If click is on the trigger button, let the button click listener toggle it
  if (!current.definition.usesScrim) {
    if (current.definition.dismissOnOutside === false) {
      return;
    }
    if (current.trigger && (current.trigger === target || current.trigger.contains(target))) {
      return;
    }
    // Clicked outside popover -> close
    closeActiveOverlay();
    return;
  }

  // 4. For overlays with scrim:
  // If click is on the scrim or outside the contentElement:
  const scrim = getScrim();
  if (target === scrim || (current.definition.element && current.definition.element.contains(target))) {
    event.preventDefault();
    closeActiveOverlay();
  }
});
