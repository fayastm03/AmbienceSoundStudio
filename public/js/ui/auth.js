import { apiRequest } from "../api/client.js";

let openModalFn = () => {};

export function openAuthModal() {
  openModalFn();
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
  const openButton = document.querySelector("#authOpen");
  const closeButton = document.querySelector("#authClose");
  const errorMessage = document.querySelector("#authError");
  const unavailableNotice = document.querySelector("#authUnavailable");
  const status = document.querySelector("#authStatus");
  const tabs = [...document.querySelectorAll(".auth-tabs [role=tab]")];
  const panels = [...document.querySelectorAll("[data-auth-form]")];
  let lastFocused;
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

  function focusable() {
    return [...modal.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])")].filter(
      (element) => !element.disabled && !element.closest("[hidden]")
    );
  }

  function close() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    clearErrors();
    lastFocused?.focus();
  }

  function open() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setTab("login");
    const firstInput = document.querySelector("#loginEmail");
    if (firstInput && !firstInput.disabled) firstInput.focus();
    else closeButton.focus();
  }

  openModalFn = open;
  window.addEventListener("auth:open", open);

  function renderUser(user) {
    status.textContent = user ? formatUserName(user) : "";
    openButton.textContent = user ? "Sign out" : "Sign in";
    openButton.onclick = user
      ? async () => {
          try {
            await apiRequest("/api/auth/logout", { method: "POST", body: "{}" });
            renderUser(null);
          } catch {
            setGeneralError("Unable to sign out right now.");
          }
        }
      : open;
    window.dispatchEvent(new CustomEvent("auth:change", { detail: { user } }));
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

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  modal.querySelector("[data-auth-close]").addEventListener("click", close);

  // Focus trap
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return close();
    if (event.key !== "Tab") return;

    const elements = focusable();
    if (!elements.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first || !elements.includes(document.activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !elements.includes(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // Password visibility toggles
  modal.querySelectorAll("[data-toggle-password]").forEach((button) => button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.togglePassword}`);
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Show" : "Hide";
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
    if (password.length < 10 || password.length > 128) {
      const inputId = isLogin ? "loginPassword" : "registerPassword";
      const errorId = isLogin ? "loginPasswordError" : "registerPasswordError";
      const msg = "Password must be between 10 and 128 characters";
      setFieldError(inputId, errorId, msg);
      setGeneralError(msg);
      document.querySelector(`#${inputId}`).focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = isLogin ? "Signing in…" : "Creating account…";

    try {
      const result = await apiRequest(`/api/auth/${formType}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      renderUser(result.user);
      close();
      form.reset();
    } catch (error) {
      if (error.status === 503) {
        setGeneralError("Accounts are temporarily unavailable. You can continue as a guest.");
      } else if (error.status === 429) {
        setGeneralError("Too many attempts. Please try again later.");
      } else if (error.data?.fieldErrors) {
        // Map server validation field errors to inputs
        for (const [field, msg] of Object.entries(error.data.fieldErrors)) {
          if (field === "email") {
            setFieldError(isLogin ? "loginEmail" : "registerEmail", isLogin ? "loginEmailError" : "registerEmailError", msg);
          } else if (field === "password") {
            setFieldError(isLogin ? "loginPassword" : "registerPassword", isLogin ? "loginPasswordError" : "registerPasswordError", msg);
          } else if (field === "displayName") {
            setFieldError("registerName", "registerNameError", msg);
          }
        }
        setGeneralError(error.data.error || "Please check your details.");
      } else {
        setGeneralError(error.message || "An error occurred. Please try again.");
      }
    } finally {
      submit.disabled = false;
      submit.textContent = originalText;
    }
  }));

  // Page load check
  apiRequest("/api/auth/me")
    .then(({ user, accountsAvailable: available }) => {
      accountsAvailable = available !== false;
      if (unavailableNotice) unavailableNotice.hidden = accountsAvailable;
      renderUser(user);
    })
    .catch(() => {
      renderUser(null);
    });
}
