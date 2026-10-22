import { apiRequest } from "../api/client.js";
import { registerOverlay, openOverlay, closeOverlay } from "./overlay.js";

let openModalFn = () => {};

export function openAuthModal(tab = "login", message = "") {
  openModalFn(tab, message);
}

export function formatUserName(user) {
  if (!user) return "";
  let name = user.displayName?.trim();
  if (!name && user.email) {
    name = user.email.split("@")[0] || "";
  }
  if (!name) return "";
  return name.length > 20 ? `${name.slice(0, 19)}…` : name;
}

export function bindAuth() {
  const modal = document.querySelector("#authModal");
  const closeButton = document.querySelector("#authClose");
  const errorMessage = document.querySelector("#authError");
  const unavailableNotice = document.querySelector("#authUnavailable");
  const tabs = [...document.querySelectorAll(".auth-tabs [role=tab]")];
  const panels = [...document.querySelectorAll("[data-auth-form]")];
  let accountsAvailable = true;

  function clearErrors() {
    errorMessage.textContent = "";
    modal.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; });
    modal.querySelectorAll("input").forEach((input) => {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    });
  }

  function setGeneralError(message) {
    errorMessage.textContent = message;
  }

  function setFieldError(inputId, errorId, message) {
    const input = document.querySelector(`#${inputId}`);
    const errorEl = document.querySelector(`#${errorId}`);
    if (errorEl) errorEl.textContent = message;
    if (input) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", errorId);
    }
  }

  function setTab(name) {
    const login = name === "login";
    tabs.forEach((tab) => {
      const active = tab.id === (login ? "signInTab" : "registerTab");
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.authForm !== name; });
    document.querySelector("#authTitle").textContent = login ? "Sign in" : "Create account";
    clearErrors();
  }

  registerOverlay("authModal", {
    element: modal,
    contentElement: modal.querySelector(".auth-dialog"),
    usesScrim: true,
    open: () => {
      modal.hidden = false;
    },
    close: () => {
      modal.hidden = true;
      clearErrors();
    },
    trapFocus: true,
  });

  function close() {
    closeOverlay("authModal");
  }

  function open(tab = "login", message = "") {
    setTab(tab);
    const intro = modal.querySelector(".auth-intro");
    intro.textContent = message || "Sign in to keep your studio ready across visits. You can continue as a guest at any time.";
    const firstInput = document.querySelector(tab === "register" ? "#registerName" : "#loginEmail");

    openOverlay("authModal", {
      trigger: document.activeElement,
      focusTarget: firstInput && !firstInput.disabled ? firstInput : closeButton,
    });
  }

  openModalFn = open;
  window.addEventListener("auth:open", (event) => open(event.detail?.tab || "login", event.detail?.message || ""));
  window.addEventListener("auth:signout-request", signOut);

  function renderUser(user) {
    window.dispatchEvent(new CustomEvent("auth:change", { detail: { user } }));
  }

  async function signOut() {
    try {
      await apiRequest("/api/auth/logout", { method: "POST", body: "{}" });
      renderUser(null);
    } catch {
      setGeneralError("Unable to sign out right now.");
    }
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.id === "signInTab" ? "login" : "register")));
  tabs.forEach((tab) => tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[index];
    next.focus();
    setTab(next.id === "signInTab" ? "login" : "register");
  }));

  closeButton.addEventListener("click", close);

  // Password visibility toggles
  modal.querySelectorAll("[data-toggle-password]").forEach((button) => button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.togglePassword}`);
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Show" : "Hide";
    button.setAttribute("aria-label", input.type === "password" ? "Show password" : "Hide password");
  }));

  // Clear errors when typing
  modal.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      clearErrors();
    });
  });

  panels.forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();

    if (!accountsAvailable) {
      setGeneralError("Accounts are temporarily unavailable. You can continue as a guest.");
      return;
    }

    const formType = form.dataset.authForm;
    const isLogin = formType === "login";
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector("button[type=submit]");
    const originalText = isLogin ? "Sign in" : "Create account";

    // Client-side validation matching server rules
    const email = (data.email || "").trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      const inputId = isLogin ? "loginEmail" : "registerEmail";
      const errorId = isLogin ? "loginEmailError" : "registerEmailError";
      setFieldError(inputId, errorId, "Please enter a valid email address");
      setGeneralError("Please enter a valid email address");
      document.querySelector(`#${inputId}`).focus();
      return;
    }

    const password = data.password || "";
    if (isLogin) {
      if (!password) {
        setFieldError("loginPassword", "loginPasswordError", "Password is required");
        setGeneralError("Password is required");
        document.querySelector("#loginPassword").focus();
        return;
      }
    } else {
      if (password.length < 10) {
        setFieldError("registerPassword", "registerPasswordError", "Password must be at least 10 characters");
        setGeneralError("Password must be at least 10 characters");
        document.querySelector("#registerPassword").focus();
        return;
      }
      if (password.length > 128) {
        setFieldError("registerPassword", "registerPasswordError", "Password must be at most 128 characters");
        setGeneralError("Password must be at most 128 characters");
        document.querySelector("#registerPassword").focus();
        return;
      }
    }

    submit.disabled = true;
    submit.textContent = isLogin ? "Signing in…" : "Creating account…";
    submit.classList.add("btn-loading");

    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const body = isLogin
        ? { email, password }
        : { email, password, displayName: data.displayName?.trim() || undefined };

      const result = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });

      renderUser(result.user);
      form.reset();
      close();
    } catch (error) {
      if (error.field) {
        const inputId = `${formType}${error.field.charAt(0).toUpperCase()}${error.field.slice(1)}`;
        const errorId = `${inputId}Error`;
        setFieldError(inputId, errorId, error.message);
      }
      setGeneralError(error.message || "An unexpected error occurred. Please try again.");
    } finally {
      submit.disabled = false;
      submit.textContent = originalText;
      submit.classList.remove("btn-loading");
    }
  }));

  // Initial session check
  apiRequest("/api/auth/me")
    .then((data) => {
      accountsAvailable = data.accountsAvailable !== false;
      if (unavailableNotice) unavailableNotice.hidden = accountsAvailable;
      renderUser(data.user);
    })
    .catch(() => {
      accountsAvailable = false;
      if (unavailableNotice) unavailableNotice.hidden = false;
      renderUser(null);
    })
    .finally(() => {
      window.dispatchEvent(new CustomEvent("auth:availability", { detail: { available: accountsAvailable } }));
    });
}
