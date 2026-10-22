import { getState, setTheme } from "../state/store.js";
import { registerOverlay, openOverlay, closeOverlay, isOverlayOpen } from "./overlay.js";

const escapeHtml = (value) => {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
};

const AVATAR_PALETTE = [
  "#3e6378", // slate ocean
  "#486b72", // slate pine
  "#536573", // cool slate
  "#4a5f78", // deep slate
  "#3c6975", // teal slate
  "#46686b", // muted moss slate
];

export function bindAccountMenu({ openAuth, openMixes }) {
  const root = document.querySelector("#accountMenu");
  const button = document.querySelector("#accountButton");
  const popover = document.querySelector("#accountPopover");
  const shortcutDialog = document.querySelector("#shortcutDialog");
  const shortcutClose = document.querySelector("#shortcutClose");
  let user = null;
  let accountsAvailable = true;

  function userName(value = user) {
    return value?.displayName?.trim() || value?.email?.split("@")[0] || "";
  }

  function initials(name) {
    const words = name.split(/\s+/).filter(Boolean);
    return (words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}` : name.slice(0, 2)).toUpperCase();
  }

  function avatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }

  function themeMarkup() {
    return `<div class="account-theme"><span>Theme</span><div class="theme-options" role="group" aria-label="Choose colour theme">
      <button type="button" data-theme-choice="light" role="menuitemradio">Light</button>
      <button type="button" data-theme-choice="auto" role="menuitemradio">Auto</button>
      <button type="button" data-theme-choice="dark" role="menuitemradio">Dark</button>
    </div></div>`;
  }

  function item(label, action, extra = "") {
    return `<button type="button" class="account-menu-item" role="menuitem" data-account-action="${action}" ${extra}>${label}</button>`;
  }

  function render() {
    const name = userName();
    const signedIn = Boolean(user);
    button.classList.toggle("account-avatar-button", signedIn);
    button.style.backgroundColor = signedIn ? avatarColor(name) : "";
    button.textContent = signedIn ? initials(name) : "♙ Sign in";
    button.setAttribute("aria-label", signedIn ? `Account menu for ${name}` : "Account menu. Sign in");
    const unavailable = !accountsAvailable;
    popover.innerHTML = signedIn
      ? `<div class="account-user-block"><span class="account-avatar" style="background-color:${avatarColor(name)}">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(user.email || "")}</span></div></div>
        ${item("My mixes", "mixes")}${item("Save current mix", "save")}${themeMarkup()}${item("Keyboard shortcuts", "shortcuts")}<div class="account-divider"></div>${item("Sign out", "signout")}`
      : `${unavailable ? '<p class="account-unavailable">Accounts are temporarily unavailable</p>' : item("Sign in", "signin")}${unavailable ? "" : item("Create account", "register")}${themeMarkup()}${item("Keyboard shortcuts", "shortcuts")}`;
    updateTheme();
  }

  function updateTheme() {
    const current = getState().theme;
    popover.querySelectorAll("[data-theme-choice]").forEach((choice) => {
      choice.setAttribute("aria-pressed", String(choice.dataset.themeChoice === current));
      choice.addEventListener("click", () => {
        setTheme(choice.dataset.themeChoice);
        window.dispatchEvent(new CustomEvent("theme:changed"));
        updateTheme();
      });
    });
  }

  function menuItems() {
    return [...popover.querySelectorAll("[role^=menuitem]")].filter((element) => !element.hidden);
  }

  function positionPopover() {
    if (window.innerWidth <= 480) {
      popover.style.top = "";
      popover.style.right = "";
      popover.style.left = "";
      return;
    }
    const rect = button.getBoundingClientRect();
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;
    popover.style.right = `${Math.round(Math.max(12, window.innerWidth - rect.right))}px`;
    popover.style.left = "auto";
  }

  window.addEventListener("resize", () => {
    if (isOverlayOpen("accountMenu")) positionPopover();
  });

  window.addEventListener("scroll", () => {
    if (isOverlayOpen("accountMenu")) positionPopover();
  }, { passive: true });

  registerOverlay("accountMenu", {
    element: popover,
    contentElement: popover,
    usesScrim: false,
    open: () => {
      render();
      positionPopover();
      popover.hidden = false;
      button.setAttribute("aria-expanded", "true");
    },
    close: () => {
      popover.hidden = true;
      button.setAttribute("aria-expanded", "false");
    },
    trapFocus: false,
  });

  if (shortcutDialog) {
    registerOverlay("shortcutDialog", {
      element: shortcutDialog,
      contentElement: shortcutDialog.querySelector(".shortcut-dialog-content"),
      usesScrim: true,
      open: () => {
        shortcutDialog.hidden = false;
      },
      close: () => {
        shortcutDialog.hidden = true;
      },
      trapFocus: true,
    });
  }

  function openShortcuts() {
    openOverlay("shortcutDialog", {
      trigger: button,
      focusTarget: shortcutClose,
    });
  }

  function activate(action) {
    closeOverlay("accountMenu");
    if (action === "signin") return openAuth("login");
    if (action === "register") return openAuth("register");
    if (action === "mixes") return openMixes();
    if (action === "save") return window.dispatchEvent(new CustomEvent("mix:save-request", { detail: { signedIn: Boolean(user), source: "manual" } }));
    if (action === "shortcuts") return openShortcuts();
    if (action === "signout") return window.dispatchEvent(new CustomEvent("auth:signout-request"));
  }

  button.addEventListener("click", () => {
    if (isOverlayOpen("accountMenu")) {
      closeOverlay("accountMenu");
    } else {
      openOverlay("accountMenu", {
        trigger: button,
        focusTarget: menuItems()[0],
      });
    }
  });

  popover.addEventListener("click", (event) => {
    const target = event.target.closest("[data-account-action]");
    if (target) activate(target.dataset.accountAction);
  });

  popover.addEventListener("keydown", (event) => {
    const items = menuItems();
    const index = items.indexOf(document.activeElement);
    if (event.key === "Tab") {
      closeOverlay("accountMenu");
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[nextIndex]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      document.activeElement?.click();
    }
  });

  document.addEventListener("click", (event) => {
    if (isOverlayOpen("accountMenu") && !root.contains(event.target)) {
      closeOverlay("accountMenu", { returnFocus: false });
    }
  });

  if (shortcutClose) {
    shortcutClose.addEventListener("click", () => closeOverlay("shortcutDialog"));
  }

  window.addEventListener("auth:change", (event) => {
    user = event.detail?.user || null;
    render();
  });

  window.addEventListener("auth:availability", (event) => {
    accountsAvailable = event.detail?.available !== false;
    render();
  });

  render();
}
